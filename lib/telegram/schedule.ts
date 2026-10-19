// Server-only: the messages the bot starts itself (Build O), run by the 5-minute tick after the usual ones. Each goes
// out once (a key in telegram_sent), and nothing new is sent in his quiet hours (from quietFrom until the morning
// brief) or during school, except the end-of-day wrap-up at its own time.
// - After the first brief of this build: the gap questions (first), the calendar clean-up, Owen's days, Your week.
// - Gap questions: a round after the brief and after school, one at a time (lib/telegram/gapask.ts).
// - A low-Whoop morning, or his calendar changing under an applied week: a short "moved X — ✅?" card.
// - Sunday at his week-reset time: the Your week card for the coming week.
// - At the end-of-day time: the evening message (item 5): tap what you did; the rest rolls on by itself.
// - Once a day: if his weekly pattern changed, whether Owen's days still fit.
import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkinRange } from '../ask/week'
import { loadPlannerContext } from '../ask/server'
import { expandEvents, isSchool } from '../events'
import { moreSettings } from '../settings'
import { addDays, isoDow, minutesOf, timeOf } from '../time'
import { isLowRecovery, whoopDay } from '../whoop/sync'
import { askNextGap } from './gapask'
import { sendCleanup } from './cleanup'
import { proposeOwenDays, recheckOwen } from './owen'
import { refitAfterChange } from './refit'
import { claim, release } from './sent'
import { loadViewData, type ViewData } from './views'
import { proposeYourWeek } from './yourweek'
import { morningAt } from '../today/holidays'
import { sendEvening, sendMorning } from '../today/send'

/** Is it at or after `at`, within `span` minutes? */
const within = (now: string, at: string, span: number) => minutesOf(now) >= minutesOf(at) && minutesOf(now) < minutesOf(at) + span

/** Run once (by key); if it throws, the key is released so a later tick tries again. */
async function once(sb: SupabaseClient, key: string, run: () => Promise<unknown>): Promise<boolean> {
  if (!(await claim(sb, key))) return false
  try { await run(); return true } catch (e) { await release(sb, key); throw e }
}
const has = async (sb: SupabaseClient, key: string) => !!(await sb.from('telegram_sent').select('key').eq('key', key).maybeSingle()).data

/** Read-only sessions pre-set to Archive on the first clean-up card (his words, 11 Oct: "EFA training no longer happens"). */
export const FIRST_CLEANUP_ARCHIVE = ['EFA training']

/** The proactive messages due now. Returns what went out (for the tick's log). */
export async function proactive(sb: SupabaseClient, chatId: number, nowDate: Date, today: string, planning: unknown): Promise<string[]> {
  const s = moreSettings(planning)
  const now = timeOf(nowDate)
  const sent: string[] = []
  // (item 5: the morning ends at the morning message's time: on holidays, his holiday wake time)
  const morning = morningAt(planning, today)
  const quiet = minutesOf(now) >= minutesOf(s.quietFrom) || minutesOf(now) < minutesOf(morning)
  let data: ViewData | null = null
  const view = async () => (data ??= await loadViewData(sb, today, nowDate))
  const inSchool = async () => {
    const d = await view()
    return expandEvents(d.events, today, today, d.changes).some((o) => o.date === today && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.start && o.end
      && minutesOf(now) >= minutesOf(o.start) - 15 && minutesOf(now) < minutesOf(o.end) + 15)
  }
  const step = async (name: string, run: () => Promise<boolean | void>) => { try { if (await run()) sent.push(name) } catch { /* one failing never stops the rest */ } }

  // item 5: the morning message (Today, pinned) goes first, so whatever else the morning brings comes after it
  if (within(now, morning, 180)) await step('morning', () => sendMorning(sb, chatId, nowDate))

  // the evening message (its own time, an hour to catch a missed tick). Item 5: a tap per Today item; whatever isn't
  // ticked rolls on to tomorrow by itself (lib/today/send.ts), in place of the old "move the rest? ✅" wrap-up
  if (within(now, s.endOfDayAt, 60)) await step('wrapup', () => once(sb, `eod:${today}`, async () => { await sendEvening(sb, chatId, nowDate) }))
  if (quiet) return sent

  // right after this build's first brief: the gap questions first (so the week uses his answers), then the clean-up,
  // Owen's days and this week's card (sent again once he has answered: lib/telegram/refit.ts)
  const briefed = within(now, morning, 180) && await has(sb, `brief:${today}`)
  if (briefed && !(await inSchool())) {
    const before = sent.length
    await step('onboard:gaps', () => once(sb, 'onboard:gaps', async () => { await askNextGap(sb, chatId, nowDate, { intro: true, data: await view() }) }))
    await step('onboard:cleanup', () => once(sb, 'onboard:cleanup', async () => { await sendCleanup(sb, chatId, FIRST_CLEANUP_ARCHIVE) }))
    await step('onboard:owen', () => once(sb, 'onboard:owen', async () => { await proposeOwenDays(sb, chatId, await view()) }))
    // the week card plans with the AI: on its own tick (5 minutes later), so no tick runs out of time
    if (sent.length === before) await step('onboard:week', () => once(sb, 'onboard:week', async () => {
      const ctx = await loadPlannerContext(sb)
      if (!(await proposeYourWeek(sb, chatId, 'your week', ctx, await view(), { range: checkinRange(today) }))) throw new Error('no card')
    }))
    // a low-Whoop morning: today's hard training moves or goes light (a ✅ card)
    await step('whoop', async () => {
      const w = await whoopDay(sb, today)
      if (!isLowRecovery(w, planning) || !(await claim(sb, `whoop-refit:${today}`))) return false
      return !!(await refitAfterChange(sb, chatId, `for your ${w?.recovery}% recovery`, { days: [today], data: await view() }))
    })
  }
  if (await inSchool()) return sent

  // the Sunday week reset: the Your week card for the coming week (two hours to catch a missed tick)
  if (isoDow(today) === 7 && within(now, s.resetAt, 120)) {
    await step('yourweek', () => once(sb, `yourweek:${today}`, async () => {
      const ctx = await loadPlannerContext(sb)
      if (!(await proposeYourWeek(sb, chatId, 'your week (Sunday reset)', ctx, await view(), { range: checkinRange(today), auto: true }))) throw new Error('no card')
    }))
  }

  // gap questions: a try every half hour outside school (askNextGap keeps to one waiting, and the day's number)
  const half = `${now.slice(0, 2)}${Number(now.slice(3)) < 30 ? 'a' : 'b'}`
  if (await has(sb, 'onboard:gaps')) await step('gap', async () => (await claim(sb, `gap-try:${today}:${half}`)) && askNextGap(sb, chatId, nowDate, { data: await view() }))

  // his calendar changed under a week already applied (a session cancelled or moved in Google): re-fit it
  await step('drift', async () => {
    const d = await view()
    const sig = expandEvents(d.events, today, addDays(today, 6), d.changes).filter((o) => o.event.is_busy && o.start)
      .map((o) => `${o.event.title}|${o.date}|${o.start}|${o.end}|${o.cancelled ? 'x' : ''}`).sort().join(';')
    const key = `drift:${today}:${createHash('sha256').update(sig).digest('hex').slice(0, 20)}`
    const seen = await sb.from('telegram_sent').select('key').like('key', `drift:${today}:%`).limit(1)
    if (!(await claim(sb, key)) || !seen.data?.length) return false   // first look today: nothing to compare with
    return !!(await refitAfterChange(sb, chatId, 'after a calendar change', { data: d }))
  })

  // once a day, after school: does his weekly pattern still suit Owen's days?
  if (minutesOf(now) >= 16 * 60) await step('owen', async () => (await claim(sb, `owen-day:${today}`)) && recheckOwen(sb, chatId, await view()))
  return sent
}
