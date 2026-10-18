// Server-only: the messages the bot starts itself (Build O), run by the 5-minute tick after the usual ones. Each goes
// out once (a key in telegram_sent), and nothing new is sent in his quiet hours (from quietFrom until the morning
// brief) or during school, except the end-of-day wrap-up at its own time.
// - After the first brief of this build: the gap questions (first), the calendar clean-up, Owen's days, Your week.
// - Gap questions: a round after the brief and after school, one at a time (lib/telegram/gapask.ts).
// - A low-Whoop morning, or his calendar changing under an applied week: a short "moved X — ✅?" card.
// - Sunday at his week-reset time: the Your week card for the coming week.
// - At the end-of-day time: what's done, and what isn't moved to tomorrow with one ✅.
// - Once a day: if his weekly pattern changed, whether Owen's days still fit.
import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkinRange } from '../ask/week'
import { loadPlannerContext } from '../ask/server'
import { expandEvents, isSchool } from '../events'
import { freeDays } from '../freetime'
import { moreSettings } from '../settings'
import { boundsOf, hm, parseSessionTitle } from '../setup'
import { addDays, dowShort, isoDow, minutesOf, timeOf } from '../time'
import { minus } from '../week'
import { deadlineOf } from '../tasks'
import { isLowRecovery, whoopDay } from '../whoop/sync'
import { esc } from './api'
import { askNextGap } from './gapask'
import { sendCleanup } from './cleanup'
import { proposeOwenDays, recheckOwen } from './owen'
import { refitAfterChange } from './refit'
import { claim, release } from './sent'
import { plain, say } from './turns'
import { loadViewData, type ViewData } from './views'
import { proposeYourWeek } from './yourweek'

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
  const quiet = minutesOf(now) >= minutesOf(s.quietFrom) || minutesOf(now) < minutesOf(s.briefAt)
  let data: ViewData | null = null
  const view = async () => (data ??= await loadViewData(sb, today, nowDate))
  const inSchool = async () => {
    const d = await view()
    return expandEvents(d.events, today, today, d.changes).some((o) => o.date === today && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.start && o.end
      && minutesOf(now) >= minutesOf(o.start) - 15 && minutesOf(now) < minutesOf(o.end) + 15)
  }
  const step = async (name: string, run: () => Promise<boolean | void>) => { try { if (await run()) sent.push(name) } catch { /* one failing never stops the rest */ } }

  // the end-of-day wrap-up (its own time, an hour to catch a missed tick)
  if (within(now, s.endOfDayAt, 60)) await step('wrapup', () => once(sb, `eod:${today}`, async () => { await wrapUp(sb, chatId, await view(), nowDate) }))
  if (quiet) return sent

  // right after this build's first brief: the gap questions first (so the week uses his answers), then the clean-up,
  // Owen's days and this week's card (sent again once he has answered: lib/telegram/refit.ts)
  const briefed = within(now, s.briefAt, 180) && await has(sb, `brief:${today}`)
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

// ---------------------------------------------------------------------------
// The end-of-day wrap-up
// ---------------------------------------------------------------------------

/** What's done today, and what isn't, moved to tomorrow's free time with one ✅ (study and training alike). */
export async function wrapUp(sb: SupabaseClient, chatId: number, d: ViewData, nowDate: Date): Promise<boolean> {
  const now = timeOf(nowDate)
  const done = d.blocks.filter((b) => b.status === 'done')
  const missed = d.blocks.filter((b) => b.status === 'planned' && b.start_time < now && b.kind !== 'rest')
  // due today and not done (one with a missed block is in the "not done" line instead)
  const inMissed = new Set(missed.map((b) => b.task_id).filter(Boolean))
  const open = d.tasks.filter((t) => t.importance === 'must' && t.due_at && t.due_at.slice(0, 10) === d.today && t.status !== 'completed' && !inMissed.has(t.id))
  if (!done.length && !missed.length && !open.length) return false
  const name = (t: string) => parseSessionTitle(t).name
  const lines = ['🌙 <b>Today, wrapped up</b>']
  if (done.length) lines.push(`✅ Done: ${esc(done.map((b) => name(b.title)).join(', '))}`)
  if (open.length) lines.push(`📌 Still open (due today): ${esc(open.map((t) => t.title).join(', '))}`)
  if (!missed.length) {
    lines.push(done.length ? '<i>Everything in the plan done. 👏</i>' : '')
    await say(sb, chatId, lines.filter(Boolean).join('\n'), undefined, { intent: 'plan' })
    return true
  }
  // the next free time that fits (after school on school days), tomorrow first, then the two days after
  const s = { ...d.settings, dayBounds: boundsOf(d.shapes) }
  const moves = []
  const left: string[] = []
  const taken = new Map<string, [number, number][]>()
  for (const b of missed) {
    const len = minutesOf(b.end_time) - minutesOf(b.start_time)
    const heavy = b.kind === 'focus' || b.kind === 'training'
    // never after it's due: homework by its deadline (overdue: tomorrow), test prep before the test
    const task = b.task_id ? d.tasks.find((t) => t.id === b.task_id) : null
    const due = task ? deadlineOf(task) : null
    const test = b.goal_id ? d.goals.find((g) => g.id === b.goal_id)?.target_date ?? null : null
    const last = test ? addDays(test, -1) : due ? (due > d.today ? due : addDays(d.today, 1)) : addDays(d.today, 3)
    let found: { date: string; start: string; end: string } | null = null
    for (let k = 1; k <= 3 && !found && addDays(d.today, k) <= last; k++) {
      const date = addDays(d.today, k)
      const [f] = freeDays(d.events, d.changes, date, date, s, d.today, 0, d.travel ?? null)
      if (!taken.has(date)) {
        const { data: there } = await sb.from('plan_blocks').select('start_time,end_time').eq('on_date', date).eq('status', 'planned')
        taken.set(date, ((there ?? []) as { start_time: string; end_time: string }[]).map((x) => [minutesOf(x.start_time.slice(0, 5)), minutesOf(x.end_time.slice(0, 5)) + s.bufferMin]))
      }
      const school = expandEvents(d.events, date, date, d.changes).filter((o) => o.date === date && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.end).map((o) => o.end!).sort().at(-1)
      const slot = minus(f.slots, taken.get(date)!).filter((x) => !school || x.start >= school)
        .find((x) => minutesOf(x.end) - minutesOf(x.start) >= len && (!heavy || minutesOf(x.start) + len <= minutesOf(s.heavyUntil)))
      if (slot) {
        found = { date, start: slot.start, end: hm(minutesOf(slot.start) + len) }
        taken.get(date)!.push([minutesOf(found.start), minutesOf(found.end) + s.bufferMin])
      }
    }
    if (!found) { left.push(`${name(b.title)}${test ? ` (the test is ${dowShort(test)})` : due ? ` (due ${dowShort(due)})` : ''}`); continue }
    moves.push({ blockId: b.id, title: b.title, from: `${dowShort(d.today)} ${b.start_time}`, to: { date: found.date, start: found.start, end: found.end, title: b.title, kind: b.kind }, reason: 'not done today' })
  }
  const tomorrow = addDays(d.today, 1)
  if (moves.length) lines.push(`⏭ Not done → ${moves.every((m) => m.to.date === tomorrow) ? 'tomorrow' : 'the next free time'}: ${esc(moves.map((m) => `${name(m.title)} ${m.to.date === tomorrow ? '' : `${dowShort(m.to.date)} `}${m.to.start}`).join(', '))}`)
  if (left.length) lines.push(`⚠️ No free time before it’s needed for: ${esc(left.join(', '))}. Tonight, before school, or drop something?`)
  if (!moves.length) { await say(sb, chatId, lines.join('\n'), undefined, { intent: 'plan' }); return true }
  const payload = { date: tomorrow, energy: 'normal', energyGiven: false, add: true, blocks: [], unplaced: [], note: '', pushBack: '', ripple: { moves, warnings: [], tbc: [] }, summary: plain(lines.join('\n')) }
  const { data: row } = await sb.from('telegram_pending').insert({ kind: 'plan', text: 'end of day', payload }).select('id').single()
  if (!row) throw new Error('Couldn’t hold the wrap-up')
  await say(sb, chatId, `${lines.join('\n')}\n\n✅ to move ${moves.length === 1 ? 'it' : 'them'}?`, [[{ text: moves.every((m) => m.to.date === tomorrow) ? '✅ Move to tomorrow' : '✅ Move them', callback_data: `a:${row.id}` }, { text: '✖ Leave them', callback_data: `x:${row.id}` }]], { pending_id: row.id, intent: 'plan' })
  return true
}
