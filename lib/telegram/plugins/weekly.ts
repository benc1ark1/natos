// Item 7: the weekly check (plans/contracts.md §10). ONE message on his check-in day (Sunday unless he changes it) at
// his week-reset time (18:00), outside quiet hours and school: done vs planned per subject, tracker movement, the ACT
// trend, gym PRs, what's behind and one suggestion, then "Plan next week? ✅", which sends the usual Your week card
// (lib/telegram/yourweek.ts; nothing is applied until he taps ✅ Apply on that card). The same message any day for
// "how was my week?" / "weekly check" / /weekly (on a Monday it looks back on the week that just ended). Read-only: it
// changes no records (the start-of-week snapshot it keeps is its own, lib/weekly/data.ts). On the check-in day it also
// takes the place of the daily "don't forget" nudge (checkCoversNudge). With the weeklyCheck setting off, Sunday goes
// back to the Your week card by itself.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BotPlugin, TickEnv } from '../plugin-types'
import { checkinDow, moreSettings } from '../../settings'
import { isoDow, minutesOf, timeOf, todayISO, weekStartISO } from '../../time'
import { checkinRange } from '../../ask/week'
import { weeklyCheckOn } from '../../weekly/settings'
import { reviewedWeekOf } from '../../weekly/summary'
import { takeSnapshot, weeklyCheck } from '../../weekly/data'
import { clearButtons, typing } from '../api'
import { claim, release } from '../sent'
import { plain, remember, say } from '../turns'

/** Is `now` (HH:MM) at or after `at`, within `span` minutes? (as lib/telegram/schedule.ts) */
const within = (now: string, at: string, span: number) => minutesOf(now) >= minutesOf(at) && minutesOf(now) < minutesOf(at) + span
/** How long after the week-reset time a missed tick may still send it. */
const CATCH_UP_MIN = 120

/** "how was my week?", "how's my week been", "weekly check", "week review"… (strict: no AI needed). */
export const WEEKLY_WORDS = /^(?:(?:so |ok |okay |hey )?(?:how (?:was|is|has|did) (?:my|the|this) week(?: been| go| going| gone)?(?: so far)?|how'?s (?:my|the|this) week (?:been|going|gone)(?: so far)?|how did i do this week|(?:show me |give me |send me |do )?(?:my |the )?(?:weekly|week'?s?) (?:check|check-?up|check-?in|review|recap|summary|report)|review (?:my|the|this) week|week in review))$/

const normal = (m: string) => m.toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()

/** The check, and once (the first time it's shown) the SQL file to run if its table isn't there yet. */
async function checkMessage(sb: SupabaseClient, today: string, planning?: unknown, time?: string) {
  const m = await weeklyCheck(sb, today, planning, time)
  const note = m.needsSql && (await claim(sb, 'sql-reminder:weekly'))
    ? '\n🛠 <b>One thing</b>: paste <code>supabase/weekly.sql</code> into Supabase → SQL Editor → Run (1 min), so next week’s check can say which topics went up a colour.'
    : ''
  return { html: `${m.html}${note}`, buttons: m.buttons }
}

/** The key the scheduled check goes out under: the Monday of the week it looks back on. */
export const weeklyKey = (today: string) => `weekly:${weekStartISO(reviewedWeekOf(today))}`
const sentAlready = async (sb: SupabaseClient, key: string) => !!(await sb.from('telegram_sent').select('key').eq('key', key).maybeSingle()).data

/** Today is his check-in day, at the week-reset time, not in quiet hours. */
export function checkDue(planning: unknown, today: string, time: string): boolean {
  if (!weeklyCheckOn(planning) || isoDow(today) !== checkinDow(planning)) return false
  const s = moreSettings(planning)
  const quiet = minutesOf(time) >= minutesOf(s.quietFrom) || minutesOf(time) < minutesOf(s.briefAt)
  return within(time, s.resetAt, CATCH_UP_MIN) && !quiet
}

/** Can the check still go out later today (from `time`)? Its window (the reset time + 2 hours) isn't over yet and
 * isn't all in quiet hours. */
export function checkStillPossible(planning: unknown, time: string): boolean {
  const s = moreSettings(planning)
  const start = Math.max(minutesOf(time), minutesOf(s.resetAt), minutesOf(s.briefAt))
  return start < Math.min(minutesOf(s.resetAt) + CATCH_UP_MIN, minutesOf(s.quietFrom))
}

/** On his check-in day the weekly check takes the place of the daily "Before tomorrow, don't forget" nudge
 * (lib/telegram/tick.ts), once it has gone out or while it still can today. Otherwise the nudge goes as usual. */
export async function checkCoversNudge(sb: SupabaseClient, planning: unknown, today: string, time: string): Promise<boolean> {
  if (!weeklyCheckOn(planning) || isoDow(today) !== checkinDow(planning)) return false
  return checkStillPossible(planning, time) || (await sentAlready(sb, weeklyKey(today)))
}

/** At school right now (a weekday check-in day only; the default Sunday never is). */
async function inSchool(sb: SupabaseClient, today: string, time: string, now: Date): Promise<boolean> {
  if (isoDow(today) >= 6) return false
  const [{ loadViewData }, { expandEvents, isSchool }] = await Promise.all([import('../views'), import('../../events')])
  const d = await loadViewData(sb, today, now)
  return expandEvents(d.events, today, today, d.changes).some((o) => o.date === today && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.start && o.end
    && minutesOf(time) >= minutesOf(o.start) - 15 && minutesOf(time) < minutesOf(o.end) + 15)
}

async function tick(env: TickEnv): Promise<void> {
  // Monday: the week's starting point (topic colours, redo stages), once, so Sunday can say what moved. A cheap look
  // first, so the rest of Monday's ticks don't each try (and fail) to claim it again.
  if (isoDow(env.today) === 1) {
    const key = `weekly-snap:${env.today}`
    if (!(await sentAlready(env.sb, key)) && await claim(env.sb, key)) {
      try { await takeSnapshot(env.sb, env.today) } catch { await release(env.sb, key) }   // a missing table stays claimed: next Monday tries again
    }
  }
  if (!checkDue(env.planning, env.today, env.time)) return
  const key = weeklyKey(env.today)
  if (await sentAlready(env.sb, key)) return   // sent already (cheap check first)
  if (await inSchool(env.sb, env.today, env.time, env.now)) return
  await env.once(key, async () => {
    const m = await checkMessage(env.sb, env.today, env.planning, env.time)
    await remember(env.sb, 'bot', plain(m.html), { intent: 'question' })   // so "plan it" / "why?" next has the context
    return m
  })
}

/** A Your week card for the week starting `from` that's waiting for ✅ or was applied (cancelled or undone don't count). */
async function yourWeekCard(sb: SupabaseClient, from: string): Promise<boolean> {
  const { data } = await sb.from('telegram_pending').select('id').eq('kind', 'plan').in('status', ['open', 'editing', 'saved'])
    .eq('payload->week->>from', from).not('payload->yourWeek', 'is', null).limit(1)
  return !!data?.length
}

/** How long one tap may take to plan the week (the webhook's own limit is 3 minutes); an older claim is a run that died. */
const PLANNING_MS = 4 * 60_000

/** "Plan next week? ✅" → the Your week card (the tap is his yes; the card still has its own ✅ Apply). The button names
 * the Monday of the week it plans; tapped once that isn't the week to plan any more, it says so. */
async function planTap(sb: SupabaseClient, chatId: number, data: string, messageId: number | undefined): Promise<void> {
  const m = data.match(/^wk:plan:(\d{4}-\d{2}-\d{2})$/)
  if (!m) return
  const today = todayISO()
  const range = checkinRange(today)
  if (weekStartISO(range.from) !== m[1]) {
    if (messageId) await clearButtons(chatId, messageId).catch(() => null)
    await say(sb, chatId, 'That check is from an earlier week — say “plan my week”.', undefined, { intent: 'plan' })
    return
  }
  // already planned: a card for that week is waiting above (or was applied)
  if (await yourWeekCard(sb, range.from)) {
    await say(sb, chatId, 'The Your week card for that went out above ↑. Say “plan my week” for a fresh one.', undefined, { intent: 'plan' })
    return
  }
  // one plan at a time from this button: a second tap while the first is still planning waits for it
  const key = `weekly-plan:${range.from}`
  if (!(await claim(sb, key))) {
    const { data: row } = await sb.from('telegram_sent').select('created_at').eq('key', key).maybeSingle()
    if (row?.created_at && Date.now() - Date.parse(row.created_at) < PLANNING_MS) {
      await say(sb, chatId, 'Planning it now: the Your week card comes in a moment.', undefined, { intent: 'plan' })
      return
    }
    // an earlier tap's run stopped before its card went out (no card above): plan it now
  }
  try {
    await typing(chatId)
    const [{ loadPlannerContext }, { loadViewData }, { proposeYourWeek }] = await Promise.all([import('../../ask/server'), import('../views'), import('../yourweek')])
    const [ctx, view] = await Promise.all([loadPlannerContext(sb), loadViewData(sb, today)])
    const id = await proposeYourWeek(sb, chatId, isoDow(today) >= 6 ? 'your week (Sunday reset)' : 'your week', ctx, view, { range, auto: true })
    if (!id) { await release(sb, key); return }
    if (messageId) await clearButtons(chatId, messageId).catch(() => null)
  } catch (e) {
    await release(sb, key)
    throw e
  }
}

export const plugin: BotPlugin = {
  name: 'weekly',
  fast: async (message, env) => {
    if (!WEEKLY_WORDS.test(normal(message))) return null
    const m = await checkMessage(env.sb, env.today, undefined, timeOf(env.now))
    return { kind: 'answer', html: m.html, buttons: m.buttons }
  },
  commands: [{
    command: 'weekly', description: 'How your week went (weekly check)',
    run: (env) => checkMessage(env.sb, env.today, undefined, timeOf(env.now)),
  }],
  tick,
  taps: [{ prefix: 'wk', run: planTap }],
}
