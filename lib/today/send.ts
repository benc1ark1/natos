// Server-only: Today in Telegram. The morning message (07:30, on holidays not before his holiday wake time) IS the
// pinned Today: one message, pinned, edited in place as things get ticked (lib/telegram/pinned.ts). The evening message
// (endOfDayAt, 21:00) has a tap per item; whatever isn't ticked rolls on to tomorrow by itself (tomorrow's list marks
// it rolled_from when the planner picks it again: it only moves his plan, never his records, so no ✅ is needed).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { editCard, esc, send } from '../telegram/api'
import { refreshPinned } from '../telegram/pinned'
import { claim, release } from '../telegram/sent'
import { remember, say } from '../telegram/turns'
import { dateISOOf } from '../time'
import { isMissingColumn } from './data'
import { toggleBlock, toggleTask } from './done'
import { loadToday } from './load'
import { eveningHtml, todayButtons, todayHtml, type Button } from './message'

/** The Today list as a message (/today, /brief): saved first, so every item has its tap. `all`: the hidden ones too. */
export async function todayMessage(sb: SupabaseClient, opts: { now?: Date; all?: boolean } = {}): Promise<{ html: string; buttons: Button[][] }> {
  const t = await loadToday(sb, { now: opts.now, save: true })
  return { html: todayHtml(t.plan, { all: opts.all }), buttons: todayButtons(t.plan, 'm') }
}

/**
 * The morning message, once a day (key brief:<date>, so the old brief can't also go): Today, sent and pinned in place of
 * yesterday's (never deleted). Returns whether it went out.
 */
export async function sendMorning(sb: SupabaseClient, chatId: number, now = new Date()): Promise<boolean> {
  const today = dateISOOf(now.toISOString())
  const key = `brief:${today}`
  if (!(await claim(sb, key))) return false
  const r = await refreshPinned(sb, chatId, now, { fresh: true })
  if (r !== 'sent') { await release(sb, key); return false }
  try {
    const { error } = await sb.from('plan_blocks').select('pick_key,done_hint').limit(1)
    await sqlNotes(sb, isMissingColumn(error), chatId)
  } catch { /* only a reminder */ }
  return true
}

/** The evening message: a tap per item. false when there was no list today (nothing to tick). */
export async function sendEvening(sb: SupabaseClient, chatId: number, now = new Date()): Promise<boolean> {
  const t = await loadToday(sb, { now })
  if (t.plan.source === 'new') return false   // no list was saved today (he never looked): nothing to tick
  const html = eveningHtml(t.plan)
  if (!html) return false
  await say(sb, chatId, html, todayButtons(t.plan, 'e'), { intent: 'plan' })
  return true
}

/** A `tdy:` tap: tick (or untick) the item, then redraw the pinned Today and the tapped message. */
export async function onTodayTap(sb: SupabaseClient, chatId: number, data: string, messageId: number | undefined): Promise<void> {
  // tdy:mb1:<id> = make it done, mb0 = not done; tdy:mb:<id> (messages sent before) = toggle
  const m = data.match(/^tdy:([me])([bt])([01]?):([0-9a-f-]{36})$/)
  if (!m) return
  const want = m[3] === '' ? undefined : m[3] === '1'
  const r = m[2] === 'b' ? await toggleBlock(sb, m[4], new Date(), want) : await toggleTask(sb, m[4], new Date(), want)
  if (!r.ok) { await say(sb, chatId, `⚠️ ${esc(r.error)}`); return }
  if (r.note) await say(sb, chatId, `↩️ ${esc(r.note)}`)
  await remember(sb, 'nat', `(ticked “${r.title}” ${r.done ? 'done' : 'off again'} on Today${r.changed ? `: ${r.changed}` : ''})`, { intent: 'tap' })
  await refreshPinned(sb, chatId, new Date(), { byNat: true })
  const { data: st } = await sb.from('telegram_state').select('today_message_id').maybeSingle()
  if (messageId && messageId !== st?.today_message_id) {
    const t = await loadToday(sb, { date: r.date })
    const html = m[1] === 'e' ? eveningHtml(t.plan) : todayHtml(t.plan)
    if (html) await editCard(chatId, messageId, html, todayButtons(t.plan, m[1] as 'm' | 'e')).catch(() => null)
  }
  if (r.ask) await say(sb, chatId, r.ask, undefined, { intent: 'question' })
}

/** Once each, after the morning message: SQL files still to run (the app works without them). */
export async function sqlNotes(sb: SupabaseClient, todayMissing: boolean, chatId: number | null): Promise<void> {
  if (chatId == null) return
  const once = async (key: string, html: string) => {
    if (!(await claim(sb, key))) return
    try { await send(chatId, html) } catch { await release(sb, key) }
  }
  if (todayMissing) await once('sql-reminder:today', '🛠 <b>One thing</b>: paste <code>supabase/today.sql</code> into Supabase → SQL Editor → Run (2 min). Today works without it, but a tick can’t yet move topics, tests and programmes forward.')
  // (the old brief's reminder, which now comes here: lib/telegram/brief.ts)
  const { error } = await sb.from('gap_answers').select('id', { head: true, count: 'exact' }).limit(1)
  if (error) await once('sql-reminder:build-o', '🛠 <b>One thing for today</b>: paste <code>supabase/build-o.sql</code> into Supabase → SQL Editor → Run (2 min). Everything works without it; it adds your own 🧠 numbers per session and keeps a history of your answers and suggestions.')
}
