// Server-only: runs every 5 minutes (Supabase pg_cron -> /api/telegram/tick) and sends whatever is due.
// All times are Europe/London (BST/GMT handled by lib/time). Each message is sent at most once:
// its key is recorded in telegram_sent before sending (and released again if sending fails).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEvents } from '../events'
import { rows } from '../data'
import { addDays, dateISOOf, dowShort, isoDow, minutesOf, shortDate, timeOf } from '../time'
import { leaveBy, withTravel } from '../travel'
import { loadTravel } from '../travel-data'
import { refreshTravel } from './maps'
import type { Reminder, Task } from '../types'
import { offerSlot } from './dayplan'
import { loadViewData } from './views'
import { esc, send, setCommands, setMenuButton, type Button } from './api'
import { buildBrief, buildNudge, loadDay } from './brief'
import { refreshPinned } from './pinned'
import { COMMANDS, appUrl } from './bot'
import { runPluginTicks } from './plugins'
import { claim, release } from './sent'
import { isChatOnly } from '../chat-only'
import { missingEnvText } from '../health'
import { askNextType } from './asktype'
import { syncGoogle } from '../google/sync'
import { syncWhoop } from '../whoop/sync'
import { processMail } from '../mail/watcher'
import { checkinDow, moreSettings } from '../settings'
import { planningSettings } from '../freetime'
import { proactive } from './schedule'
import { morningAt } from '../today/holidays'
import { weeklyCheckOn } from '../weekly/settings'
import { checkCoversNudge } from './plugins/weekly'

// The brief, the nudge, the check-in day and the "leave in …" lead are his settings (lib/settings.ts: briefAt 07:30,
// nudgeAt 18:00, checkinDay Sunday, leaveAlertMin 10 unless he changes them).
const CATCH_UP_MIN = 3 * 60          // a missed tick still sends within 3 hours, never later

/** Is `now` (HH:MM) at or after `at`, but not more than the catch-up window later? */
export const inWindow = (now: string, at: string, span = CATCH_UP_MIN) =>
  minutesOf(now) >= minutesOf(at) && minutesOf(now) < minutesOf(at) + span

export async function runTick(sb: SupabaseClient, chatId: number, nowDate = new Date()) {
  const today = dateISOOf(nowDate.toISOString())
  const now = timeOf(nowDate)
  const sent: string[] = []
  const planning = await sb.from('profiles').select('planning').maybeSingle().then((r) => (r.error ? null : r.data?.planning ?? null))
  const set = moreSettings(planning)
  const BRIEF_AT = set.briefAt, NUDGE_AT = set.nudgeAt
  // item 5: the day starts at the morning message (on holidays his holiday wake time), not before
  const MORNING = morningAt(planning, today)
  const once = async (key: string, html: () => Promise<string | { html: string; buttons?: Button[][] } | null>) => {
    if (!(await claim(sb, key))) return
    let delivered = false
    try {
      const out = await html()
      const text = typeof out === 'string' ? out : out?.html
      if (text) { await send(chatId, text, typeof out === 'string' ? undefined : out?.buttons); delivered = true; sent.push(key) }
    } finally {
      // nothing went out (nothing to say, or sending failed): release the key so a later tick can try again
      if (!delivered) await release(sb, key)
    }
  }

  const needDay = inWindow(now, BRIEF_AT) || inWindow(now, NUDGE_AT)
  const d = needDay ? await loadDay(sb, today) : null

  // the brief; the first one after build-o.sql is missing says so, once (the app works without it)
  if (d && inWindow(now, BRIEF_AT)) await once(`brief:${today}`, async () => buildBrief(sb, d, nowDate, appUrl(), { note: await sqlNote(sb) }))
  // (Item 7: on the check-in day, once the weekly check has gone out or while it still can today, this nudge waits /
  // is skipped: the check lists the same things, so that day gets one message. If the check can't go out (quiet
  // hours, its window over without it), the nudge goes as usual: lib/telegram/plugins/weekly.ts checkCoversNudge)
  if (d && inWindow(now, NUDGE_AT) && !(await checkCoversNudge(sb, planning, today, now))) await once(`nudge:${today}`, async () => buildNudge(d))
  // (Item 7: with the weekly check on, the default, its one message replaces this reminder: lib/telegram/plugins/weekly.ts)
  if (isoDow(today) === checkinDow(planning) && inWindow(now, NUDGE_AT) && !weeklyCheckOn(planning)) {
    const url = appUrl()
    await once(`checkin:${today}`, async () => `🗓 <b>Weekly check-in</b>: 5 minutes to look back, pick your top 3 and plan the week.${url ? `\n<a href="${esc(url)}">Open Nat OS</a> → Ask AI → Weekly check-in` : ''}`)
  }

  // Time reminders whose time has come (up to 3 hours late if ticks were missed).
  const since = new Date(nowDate.getTime() - CATCH_UP_MIN * 60_000).toISOString()
  const rem = rows<Reminder>(await sb.from('reminders').select('*').eq('kind', 'time').is('done_at', null)
    .lte('remind_at', nowDate.toISOString()).gte('remind_at', since), 'reminders')
  for (const r of rem) await once(`rem:${r.id}`, async () => `🔔 ${esc(r.body)}`)

  // "Leave in 10 min" for today's events with a journey: from where he'll be, by the recommended way (lib/travel.ts).
  const { data: evs, error } = await sb.from('events').select('*').is('archived_at', null)
  if (error) throw new Error(`Couldn't read events: ${error.message}`)
  if (evs?.length) {
    const { data: ch } = await sb.from('event_exceptions').select('id,event_id,on_date,cancelled,new_date,new_start,new_end,missed').gte('on_date', today)
    let travel = await loadTravel(sb, evs, planning)
    // once a day: map positions from postcodes, and tube/bus times for today's and tomorrow's journeys (TfL)
    if (travel && minutesOf(now) >= 5 * 60 && await claim(sb, `travel:${today}`)) {
      if (await refreshTravel(sb, travel, evs, ch ?? [], today, addDays(today, 1))) travel = await loadTravel(sb, evs, planning)
    }
    for (const o of withTravel(expandEvents(evs, today, today, ch ?? []), travel)) {
      const l = o.cancelled ? null : leaveBy(o)
      if (!l) continue
      const leave = minutesOf(l.at)
      if (minutesOf(now) >= leave - set.leaveAlertMin && minutesOf(now) < leave + 5) {
        const mins = Math.max(0, leave - minutesOf(now))
        await once(`leave:${o.key}`, async () => `🚶 ${mins > 0 ? `Leave in ${mins} min` : 'Time to leave'} for <b>${esc(o.event.title)}</b> (${o.start}; ${esc(l.words)}).`)
      }
    }
  }
  // Google Calendar (if connected): Life OS both ways every tick, his other calendars every 15 minutes. New homework
  // from Google Classroom gets one message; a sign-in Google stopped accepting gets one message (then sync stops).
  const google = await syncGoogle(sb, { now: nowDate })
  if (google?.homework.length) {
    await send(chatId, [`📚 <b>New homework from Google Classroom</b>`, ...google.homework.map((h) => `• ${h.subject ? `${esc(h.subject)}: ` : ''}${esc(h.title)} <i>(due ${dowShort(h.due)} ${shortDate(h.due)}${h.time ? `, ${h.time}` : ''})</i>`), '<i>Added as must-dos. Say “drop …” if one isn’t yours.</i>'].join('\n'))
    sent.push('homework')
    // Build O: if this week is planned, offer each new one a slot before it's due (outside quiet hours)
    if (minutesOf(now) >= minutesOf(MORNING) && minutesOf(now) < minutesOf(set.quietFrom)) {
      const { data: fresh } = await sb.from('tasks').select('*').in('title', google.homework.map((h) => h.title)).is('archived_at', null).eq('source', 'import').order('created_at', { ascending: false }).limit(3)
      const vd = fresh?.length ? await loadViewData(sb, today, nowDate) : null
      for (const t of (fresh ?? []) as Task[]) await offerSlot(sb, chatId, t, vd!).catch(() => false)
    }
  }
  if (google?.reconnect) await once(`google-reconnect:${today}`, async () => `⚠️ Google Calendar stopped accepting the sign-in, so syncing has paused. Open Settings → Google Calendar → Connect.`)
  // any other sync problem is said once a day too (it used to fail quietly: Settings only showed "last sync 2 h ago")
  else if (google && !google.ok) await once(`google-error:${today}`, async () => `⚠️ The Google Calendar sync failed: ${esc(google.error ?? 'unknown problem')}. Settings → Google Calendar → Sync now tries again.`)
  // a secret setting missing in Vercel (names only): what stopped, and where to add it
  // (on Vercel only: a test run or his own PC doesn't have, or need, all of them)
  const health = process.env.VERCEL ? missingEnvText() : ''
  if (health) await once(`health:${today}`, async () => esc(health))

  // Whoop (if connected): every 30 minutes. Workouts that count toward a target get one message.
  const whoop = await syncWhoop(sb, { now: nowDate })
  if (whoop?.logged.length) {
    await send(chatId, `🏃 <b>Counted from Whoop</b>\n${whoop.logged.map((l) => `• ${esc(l.target)} +1 <i>(${esc(l.sport)}, ${dowShort(l.date)})</i>`).join('\n')}`)
    sent.push('whoop')
  }
  if (whoop?.reconnect) await once(`whoop-reconnect:${today}`, async () => `⚠️ Whoop stopped accepting the sign-in, so its data has paused. Open Settings → Whoop → Connect.`)

  // The email watcher: sort what the Gmail scripts sent and announce it (a few per tick; lib/mail/watcher.ts). A watcher
  // that was working and has been quiet for 2 hours gets one warning a day.
  try { if ((await processMail(sb, chatId)).notified) sent.push('mail') } catch {}
  const { data: watchers } = await sb.from('mail_accounts').select('account,last_seen_at')
  for (const w of (watchers ?? []) as { account: string; last_seen_at: string | null }[]) {
    if (!w.last_seen_at || nowDate.getTime() - Date.parse(w.last_seen_at) < 2 * 3_600_000) continue
    await once(`mail-quiet:${w.account}:${today}`, async () => `⚠️ The ${esc(w.account)} email watcher hasn’t checked in since ${dowShort(dateISOOf(w.last_seen_at!))} ${timeOf(w.last_seen_at!)}. In that Google account open script.google.com → Mail watcher → Executions to see why.`)
  }

  // "What type of training is …?": one question at a time, between the brief and his "nothing heavy after" time
  // (21:30 unless he changes it), for sessions/targets added or renamed without a type (asked once per name;
  // lib/telegram/asktype.ts)
  // (Build O: the gap questions ask what a session is, among everything else the planner needs: lib/telegram/gapask.ts.
  // This older one-per-tick question only runs until the first round of gap questions has started.)
  if (minutesOf(now) >= minutesOf(MORNING) && minutesOf(now) < minutesOf(planningSettings(planning).heavyUntil)
    && !(await sb.from('telegram_sent').select('key').eq('key', 'onboard:gaps').maybeSingle()).data) {
    if (await askNextType(sb, chatId).catch(() => false)) sent.push('type')
  }

  // The bot's menu button opens the dashboard inside Telegram: set once (again if the address changes).
  const url = appUrl()
  if (url && await claim(sb, `menu:${url}`)) await setMenuButton(chatId, `${url}/tg`).catch(() => release(sb, `menu:${url}`))
  // the "/" menu lists the commands (set again when the list changes)
  const cmdKey = `commands:${COMMANDS.map((c) => c.command).join(',')}`
  if (await claim(sb, cmdKey)) await setCommands(COMMANDS).catch(() => release(sb, cmdKey))

  // Build O: the Sunday "Your week" card, the morning queue, gap questions, the 21:00 wrap-up and the cards that
  // keep the plan right as things change (lib/telegram/schedule.ts). Quiet hours are kept there.
  try { sent.push(...await proactive(sb, chatId, nowDate, today, planning)) } catch {}

  // once: chat that was saved as an item before the app learned not to ("hello", "That okay maybe"): archived, never
  // deleted, and he's told which (he asked for this on 19 Oct 2026)
  try {
    if (await claim(sb, 'cleanup:chat-items')) {
      const { data: inbox } = await sb.from('tasks').select('id,title').eq('status', 'inbox').is('archived_at', null).limit(500)
      const chat = ((inbox ?? []) as { id: string; title: string }[]).filter((t) => isChatOnly(t.title))
      if (chat.length) {
        const { data: done } = await sb.from('tasks').update({ archived_at: new Date().toISOString(), archive_reason: 'dropped' }).in('id', chat.map((t) => t.id)).is('archived_at', null).select('title')
        if (done?.length) { await send(chatId, `🧹 Archived ${done.length} chat message${done.length > 1 ? 's' : ''} that had been saved as items: ${done.map((t) => `“${esc(t.title)}”`).join(', ')}. <i>(Kept in Archive, not deleted.)</i>`); sent.push('cleanup') }
      }
    }
  } catch { /* only a tidy-up */ }

  // plug-ins' own messages (lib/telegram/plugins): the morning Today, the weekly check, a Classroom test question…
  await runPluginTicks({ sb, chatId, now: nowDate, today, time: now, planning, once: async (key, build) => { await once(key, async () => { const out = await build(); if (out) sent.push(key); return out }) } })

  // The pinned "Today" message: catches dashboard changes and events passing (a new day's starts at 07:00).
  const pinned = await refreshPinned(sb, chatId, nowDate, { startAfter: BRIEF_AT })
  return { now, sent, pinned, google: google ? { ok: google.ok, pushed: google.pushed, changed: google.changed, removed: google.removed, pulled: google.pulled, read: google.read } : null }
}

/** Once, in the first brief after this build: run supabase/build-o.sql if its tables aren't there yet. */
async function sqlNote(sb: SupabaseClient): Promise<string | null> {
  const { error } = await sb.from('gap_answers').select('id', { head: true, count: 'exact' }).limit(1)
  if (!error) return null
  if (!(await claim(sb, 'sql-reminder:build-o'))) return null
  return '🛠 <b>One thing for today</b>: paste <code>supabase/build-o.sql</code> into Supabase → SQL Editor → Run (2 min). Everything works without it; it adds your own 🧠 numbers per session and keeps a history of your answers and suggestions.'
}
