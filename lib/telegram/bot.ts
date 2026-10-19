// Server-only: what the bot does with one message or button tap from Nat.
// Messages queue up and are handled one at a time, in order (lib/telegram/turns.ts); each goes to the
// brain (lib/telegram/converse.ts). Button taps are handled straight away (lib/telegram/cards.ts).
// Only called after lib/telegram/guard.ts has checked the secret and that the update is Nat's.
// Speed (queue item 3): "typing…" goes out before anything else; the queue takes as few round trips as it can; each
// message's timings are logged (supabase/speed.sql) and /speed shows them.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { usageReport } from '../ai/usage'
import { timeOf, todayISO } from '../time'
import { esc, keepTyping, send, setMenuButton } from './api'
import { buildBrief, loadDay } from './brief'
import { refreshPinned } from './pinned'
import { cancelOpenCard, newCard, onTap } from './cards'
import { converse, forgetContext, type Outcome } from './converse'
import type { TgUpdate } from './guard'
import { openOwnerSession } from './owner-session'
import { claim } from './sent'
import { ideasCommand } from './ideas'
import { flushWrites, markPath, runTimed, timingOf } from './speed'
import { mailText } from '../mail/draft'
import { loadConnection } from '../integrations/store'
import { syncGoogle } from '../google/sync'
import { isLowRecovery, syncWhoop, whoopDay, whoopWords } from '../whoop/sync'
import { enqueue, extendLock, isDone, nextQueued, releaseLock, say, setStatus, speedText, takeLock, type TurnRow, type TurnTiming } from './turns'
import { pluginCommand, pluginCommands } from './plugins'
import { helpCommandsTelegram, helpTelegram } from '../help'

export const appUrl = () => {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL
  return host ? `https://${host}` : null
}

// /help (and /start): the one-screen guide (his times, the 15 most useful messages, ✅, the ideas inbox, the backup);
// "/help all": every command. One source for these, the Help page and docs/HOW-TO-USE.md: lib/help.ts (item 8).
// HELP is the guide with the default times (used when his settings can't be read).
export const HELP = helpTelegram()

/** His settings for /help's times: one quick read, the defaults if it fails or takes over 1.5 s (/help stays fast). */
async function helpPlanning(sb?: SupabaseClient): Promise<unknown> {
  const read = (async () => {
    const s = sb ?? await openOwnerSession()
    const { data, error } = await s.from('profiles').select('planning').maybeSingle()
    return error ? null : data?.planning ?? null
  })().catch(() => null)
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), 1500) })
  try { return await Promise.race([read, late]) } finally { clearTimeout(timer) }
}

/** The /help reply: "/help all" (or "/help commands") = every command; anything else = the one-screen guide. */
export async function helpReply(text: string, sb?: SupabaseClient): Promise<string> {
  if (/^\/help(?:@\w+)?\s+(?:all|commands|everything)\b/i.test(text)) return helpCommandsTelegram()
  return helpTelegram(await helpPlanning(sb))
}

/** The commands in Telegram's “/” menu (set once, with the menu button). Plug-in commands replace a built-in one of the same name. */
const BUILTIN_COMMANDS = [
  ['today', 'The rest of today'], ['week', 'The next 7 days'], ['coming', 'Deadlines, tests and events soon'], ['free', 'Free time (add a day)'],
  ['inbox', 'Your Inbox'], ['brief', 'Today’s brief'], ['pin', 'Refresh the pinned Today'], ['app', 'Open the dashboard'],
  ['google', 'Google Calendar status'], ['sync', 'Sync Google Calendar now'], ['whoop', 'Whoop recovery'], ['mail', 'Email watcher'],
  ['maths', 'Maths tracker'], ['ideas', 'Things I can’t do yet'], ['usage', 'AI spend'], ['speed', 'My reply times'], ['cancel', 'Drop the open card'], ['help', 'How to use me'],
].map(([command, description]) => ({ command, description }))
export const COMMANDS = (() => {
  const extra = pluginCommands()
  const names = new Set(extra.map((c) => c.command))
  const help = BUILTIN_COMMANDS.filter((c) => c.command === 'help' && !names.has('help'))
  // Telegram allows up to 100; the built-in ones first (except /help, kept last), then the plug-ins'
  return [...BUILTIN_COMMANDS.filter((c) => !names.has(c.command) && c.command !== 'help'), ...extra, ...help].slice(0, 100)
})()

const MAX_RUN_MS = 100_000   // stop starting new messages after this; the next message picks up the rest
const WAIT_MS = 60_000       // how long a message waits for the one before it to finish

// Taps that do some work before they answer (apply, save, undo, a draft, slot options…) get "typing…" while they do.
// Taps that redraw a card in place (q, c, k, j) or answer at once (e, x) don't.
const WORK_TAP = /^[asi12ufptgdo]:/
// When each message reached this instance, so it's timed from its arrival (not from when its turn came)
const arrivals = new Map<number, number>()

/** Main entry: runs after the webhook has answered Telegram. Errors become a message to Nat. */
export async function handleUpdate(update: TgUpdate): Promise<void> {
  const arrived = Date.now()
  const chatId = (update.message?.chat?.id ?? update.callback_query?.message?.chat?.id)!
  const text = update.message?.text?.trim()
  const helpOnly = !!text && /^\/(start|help)\b/.test(text)
  // the very first thing, before the session or the queue: Nat sees at once that the bot is on it
  const stopTyping = (text && !helpOnly) || WORK_TAP.test(update.callback_query?.data ?? '') ? keepTyping(chatId) : null
  const { done } = runTimed(arrived, async () => {
    try {
      if (helpOnly) {   // no queue: one quick read of his settings for the times
        await send(chatId, await helpReply(text!))
        const url = appUrl()
        if (url) await setMenuButton(chatId, `${url}/tg`).catch(() => null)   // "Dashboard" opens the app inside Telegram
        return
      }

      const sb = await openOwnerSession()
      if (update.callback_query) {
        forgetContext()   // a tap can change his data: the next message reads everything fresh
        // Telegram may resend an update; handle each tap once.
        if (typeof update.update_id === 'number' && !(await claim(sb, `upd:${update.update_id}`))) return
        return await onTap(sb, chatId, update.callback_query)
      }
      if (!text) { await send(chatId, 'I can only read text for now. Try the dictation mic on your keyboard.'); return }

      // queue the message and try for the lock at the same time (one round trip instead of two)
      const [queued, lock] = await Promise.allSettled([enqueue(sb, text, update.message?.message_id ?? null), takeLock(sb)])
      const locked = lock.status === 'fulfilled' && lock.value
      if (queued.status === 'rejected' || queued.value === null) {
        if (locked) await releaseLock(sb).catch(() => null)
        if (queued.status === 'rejected') throw queued.reason
        return   // Telegram resent a message that's already queued or handled
      }
      if (lock.status === 'rejected') throw lock.reason
      arrivals.set(queued.value, arrived)
      // handled by now (here or by another instance's drain): never left behind in the map
      try { await drain(sb, chatId, queued.value, locked) } finally { arrivals.delete(queued.value) }
    } catch (e) {
      await send(chatId, `⚠️ ${esc(e instanceof Error ? e.message : 'Something went wrong.')}`).catch(() => null)
    }
  })
  try {
    await done
  } finally {
    stopTyping?.()
    await flushWrites()
  }
}

export { claim }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Handle queued messages in order until none are left. Only one run at a time holds the lock; a message
 * that arrives meanwhile waits until its turn has been handled (by whichever run holds the lock).
 * `locked`: this run already holds the lock (taken while its message was queued).
 */
export async function drain(sb: SupabaseClient, chatId: number, mine: number, locked = false): Promise<void> {
  const started = Date.now()
  let have = locked
  while (Date.now() - started < WAIT_MS) {
    if (have || await takeLock(sb)) {
      have = true
      try {
        let { next, lost } = await nextQueued(sb)
        for (;;) {
          for (const t of lost) await say(sb, chatId, `⚠️ Sorry, I lost track of “${esc(t.text.slice(0, 80))}”. Send it again?`)
          if (!next || Date.now() - started >= MAX_RUN_MS) return
          const turn = next
          const { outcome, timing } = await runTurn(sb, chatId, turn)
          // its status, the lock and the next message in one round trip (after this turn's memory is written)
          const [, , queue] = await Promise.all([
            setStatus(sb, turn.id, 'done', outcome, timing),
            extendLock(sb),
            flushWrites().then(() => nextQueued(sb, turn.id)),
          ])
          ;({ next, lost } = queue)
        }
      } finally {
        forgetContext()
        await flushWrites()
        await releaseLock(sb)
      }
    }
    if (await isDone(sb, mine)) return
    await sleep(700)
  }
}

/** One message, on its own clock (from when it arrived): its outcome, and its timings for telegram_turns. */
async function runTurn(sb: SupabaseClient, chatId: number, turn: TurnRow): Promise<{ outcome: Outcome | 'command'; timing: TurnTiming }> {
  const start = arrivals.get(turn.id) ?? (Date.parse(turn.created_at) || Date.now())
  arrivals.delete(turn.id)
  // 'working' goes in alongside the turn's first reads (it only matters if this run dies mid-message)
  const working = setStatus(sb, turn.id, 'working').catch(() => null)
  let outcome: Outcome | 'command' = 'failed'
  const { clock, done } = runTimed(start, async () => {
    try {
      outcome = await respond(sb, chatId, turn)
    } catch (e) {
      await say(sb, chatId, `⚠️ ${esc(e instanceof Error ? e.message : 'Something went wrong.')}`).catch(() => null)
    }
  })
  await done
  await working
  return { outcome, timing: timingOf(clock) }
}

async function respond(sb: SupabaseClient, chatId: number, turn: TurnRow): Promise<Outcome | 'command'> {
  const text = turn.text
  const ctx = { claim: (key: string) => claim(sb, key) }
  if (!text.startsWith('/')) return converse(sb, chatId, turn, ctx)
  markPath('command')
  // a plug-in's command (lib/telegram/plugins) wins over a built-in one of the same name
  const pc = pluginCommand(text)
  // any command but the built-in lists may change his data: the next message reads everything fresh
  if (pc || !/^\/(ask|inbox|week|coming|free|postponed|next|today|maths)\b/.test(text)) forgetContext()
  if (pc) {
    const out = await pc.run({ sb, chatId, today: todayISO(), now: new Date(), args: pc.args, appUrl: appUrl() })
    if (out) await say(sb, chatId, out.html, out.buttons)
    return 'command'
  }

  if (/^\/ask\b/.test(text)) return converse(sb, chatId, turn, { ...ctx, forceQuestion: true })
  if (/^\/(inbox|week|coming|free|postponed|next|today|maths)\b/.test(text)) return converse(sb, chatId, turn, ctx)   // instant lists
  const add = text.match(/^\/add\b\s*(.*)$/s)
  if (add) {
    if (!add[1].trim()) { await say(sb, chatId, 'Send what to add, e.g. /add Physics homework due Friday'); return 'command' }
    await newCard(sb, chatId, add[1])
    return 'new'
  }
  if (/^\/brief\b/.test(text)) {
    const d = await loadDay(sb, todayISO())
    const b = await buildBrief(sb, d, new Date(), appUrl())
    await say(sb, chatId, b.html, b.buttons)
    return 'command'
  }
  if (/^\/cancel\b/.test(text)) { await cancelOpenCard(sb, chatId); return 'command' }
  if (/^\/(app|dashboard)\b/.test(text)) {
    const url = appUrl()
    await say(sb, chatId, url ? 'Your dashboard, inside Telegram (signed in):' : 'The dashboard link isn’t set up here.', url ? [[{ text: '📱 Open dashboard', web_app: { url: `${url}/tg` } }]] : undefined)
    return 'command'
  }
  if (/^\/pin\b/.test(text)) {
    const r = await refreshPinned(sb, chatId, new Date(), { byNat: true })
    if (r !== 'sent') await say(sb, chatId, r === 'failed' ? '⚠️ Couldn’t update the pinned Today message.' : '📌 Today is pinned at the top and up to date.')
    return 'command'
  }
  if (/^\/usage\b/.test(text)) { await say(sb, chatId, await usageText(sb)); return 'command' }
  const ideas = text.match(/^\/ideas\b\s*([\s\S]*)$/)
  if (ideas) { await say(sb, chatId, await ideasCommand(sb, ideas[1])); return 'command' }
  if (/^\/speed\b/.test(text)) { await say(sb, chatId, await speedText(sb)); return 'command' }
  if (/^\/(google|sync)\b/.test(text)) { await say(sb, chatId, await googleText(sb, /^\/sync\b/.test(text))); return 'command' }
  if (/^\/whoop\b/.test(text)) { await say(sb, chatId, await whoopText(sb)); return 'command' }
  if (/^\/mail\b/.test(text)) { await say(sb, chatId, await mailText(sb)); return 'command' }
  const cap = text.match(/^\/cap\b\s*\$?\s*([\d.]*)\s*$/)
  if (cap) { await say(sb, chatId, await setCap(sb, cap[1])); return 'command' }
  await say(sb, chatId, await helpReply(text, sb))
  return 'command'
}

const usd = (n: number) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`
const JOB: Record<string, string> = { chat: 'chat', sort: 'sorting', ask: 'Ask AI (dashboard)', plan: 'planning', mail: 'email watcher' }

async function usageText(sb: SupabaseClient): Promise<string> {
  const r = await usageReport(sb)
  const lines = [`<b>AI spend</b>`, `Today: ${usd(r.today)} of your ${usd(r.cap)} daily limit (${r.todayCalls} calls)`]
  for (const [f, v] of r.byFeature) lines.push(`• ${JOB[f] ?? esc(f)}: ${usd(v.cost)} (${v.calls})`)
  lines.push(`This month: ${usd(r.month)} (${r.monthCalls} calls)`, '', '<i>/cap 2 sets the daily limit to $2.</i>')
  return lines.join('\n')
}

/** /cap 2: Nat sets his own daily limit (his explicit command, so no card needed). */
async function setCap(sb: SupabaseClient, raw: string): Promise<string> {
  const n = Number(raw)
  if (!raw || !Number.isFinite(n) || n < 0 || n > 100) return 'Send the daily limit in dollars, e.g. /cap 2 (0 to 100).'
  const value = Math.round(n * 100) / 100
  const { data, error } = await sb.from('profiles').update({ ai_daily_cap_usd: value }).not('user_id', 'is', null).select('user_id')
  if (error) return `⚠️ Not changed: ${esc(error.message)}`
  if (!data?.length) {
    const ins = await sb.from('profiles').insert({ ai_daily_cap_usd: value })
    if (ins.error) return `⚠️ Not changed: ${esc(ins.error.message)}`
  }
  return `Daily AI limit set to ${usd(value)}.`
}

/** /google: the connection and his calendars; /sync also runs a sync now. */
async function googleText(sb: SupabaseClient, run: boolean): Promise<string> {
  const c = await loadConnection(sb, 'google')
  const url = appUrl()
  const settings = url ? ` <a href="${esc(url)}/settings">Settings</a>` : ' the Settings page'
  if (!c || c.status === 'disconnected') return `📆 Google Calendar isn’t connected. Connect it on${settings} (Google Calendar → Connect).`
  if (c.status !== 'connected') return `⚠️ Google Calendar needs connecting again: open${settings} → Google Calendar → Connect again.`
  const lines: string[] = []
  if (run) {
    const r = await syncGoogle(sb, { readOthers: true })
    lines.push(r?.ok ? `🔄 Synced: ${r.pushed} added, ${r.changed} updated, ${r.removed} removed in Life OS; ${r.pulled} change${r.pulled === 1 ? '' : 's'} from Google; ${r.read} events read.${r.homework.length ? ` New homework: ${esc(r.homework.map((h) => h.title).join(', '))}.` : ''}` : `⚠️ Sync failed: ${esc(r?.error ?? 'not connected')}`)
  }
  const fresh = await loadConnection(sb, 'google')
  const cals = ((fresh?.settings ?? {}) as { calendars?: { name: string; read: boolean; school: boolean }[] }).calendars ?? []
  lines.push(`📆 <b>Google Calendar</b>: connected${c.account ? ` as ${esc(c.account)}` : ''}. Last sync ${fresh?.last_sync_at ? timeOf(fresh.last_sync_at) : 'not yet'}.`)
  if (fresh?.last_error) lines.push(`Last problem: ${esc(fresh.last_error)}`)
  if (cals.length) lines.push(...cals.map((x) => `• ${esc(x.name)}: ${x.read ? `read${x.school ? ' (school)' : ''}` : 'not read'}`))
  lines.push('<i>“Stop reading the Family calendar”, “the Timetable calendar is school”, or /sync to sync now.</i>')
  return lines.join('\n')
}

/** /whoop: syncs, then today's recovery and sleep (and whether it makes today lighter). */
async function whoopText(sb: SupabaseClient): Promise<string> {
  const c = await loadConnection(sb, 'whoop')
  const url = appUrl()
  const settings = url ? ` <a href="${esc(url)}/settings">Settings</a>` : ' the Settings page'
  if (!c || c.status === 'disconnected') return `⌚ Whoop isn’t connected. Connect it on${settings} (Whoop → Connect).`
  if (c.status !== 'connected') return `⚠️ Whoop needs connecting again: open${settings} → Whoop → Connect again.`
  const r = await syncWhoop(sb, { force: true })
  const d = await whoopDay(sb)
  const planning = await sb.from('profiles').select('planning').maybeSingle().then((x) => x.data?.planning ?? null)
  const lines = [d ? `⌚ <b>Today</b>: ${esc(whoopWords(d)) || 'no score yet'}` : '⌚ No Whoop score for today yet.']
  if (isLowRecovery(d, planning)) lines.push('<i>Low recovery: plans today are lighter (no gym placed), and protect your sleep.</i>')
  if (r && !r.ok) lines.push(`⚠️ Sync problem: ${esc(r.error ?? '')}`)
  if (r?.logged.length) lines.push(`Counted: ${esc(r.logged.map((l) => `${l.target} +1 (${l.sport})`).join(', '))}`)
  return lines.join('\n')
}
