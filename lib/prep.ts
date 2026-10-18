// Prep sessions for a test (section 35). Rule-based for now; the AI improves the plan in Step 7.
// Sessions are ordinary tasks linked to the test (goal_id) and marked is_system.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventException, EventRow, Goal, Task } from './types'
import { rows } from './data'
import { expandEvents } from './events'
import { autoStatus } from './tasks'
import { moreSettings } from './settings'
import { addDays, daysBetween, dowShort, dueAtFromDate, minutesOf, shortDate } from './time'

/** 2–5 sessions: more when there are more days left, one more for high priority, one fewer for low. */
export function sessionCount(daysLeft: number, priority: Goal['priority']): number {
  const base = daysLeft <= 3 ? 2 : daysLeft <= 7 ? 3 : daysLeft <= 14 ? 4 : 5
  const n = base + (priority === 'high' ? 1 : priority === 'low' ? -1 : 0)
  return Math.max(2, Math.min(5, n))
}

/** His prep-session length (setting prepMinutes, 40 unless he changes it): 5 more for high priority, 10 fewer for low. */
export const sessionMinutes = (p: Goal['priority'], base = 40) => (p === 'high' ? base + 5 : p === 'low' ? Math.max(10, base - 10) : base)

/** Days a session can go on: tomorrow up to the day before the test (today too, if that leaves under 2 days). */
export function prepDays(today: string, testDate: string): string[] {
  const days: string[] = []
  for (let d = addDays(today, 1); d < testDate; d = addDays(d, 1)) days.push(d)
  if (days.length < 2 && today < testDate) days.unshift(today)
  return days
}

/** Busy minutes per day: timed events plus travel before and after. Cancelled ones don't count. */
export function busyByDay(events: EventRow[], changes: EventException[], from: string, to: string): Map<string, number> {
  const busy = new Map<string, number>()
  for (const o of expandEvents(events, from, to, changes)) {
    if (o.cancelled || !o.start || !o.event.is_busy) continue
    const len = o.end ? minutesOf(o.end) - minutesOf(o.start) : 60
    busy.set(o.date, (busy.get(o.date) ?? 0) + Math.max(0, len) + 2 * (o.event.travel_minutes ?? 0))
  }
  return busy
}

/** Spread n sessions evenly: split the days into n slices and take the least busy day in each. */
export function pickDays(days: string[], n: number, busy: Map<string, number>): string[] {
  const k = Math.min(n, days.length)
  const out: string[] = []
  for (let i = 0; i < k; i++) {
    const slice = days.slice(Math.floor((i * days.length) / k), Math.floor(((i + 1) * days.length) / k))
    out.push(slice.reduce((best, d) => ((busy.get(d) ?? 0) < (busy.get(best) ?? 0) ? d : best)))
  }
  return out
}

/** "Physics test Fri 9 Oct: session 2/4" */
export const sessionTitle = (test: Pick<Goal, 'title' | 'target_date'>, no: number, total: number) =>
  `${test.title} ${dowShort(test.target_date!)} ${shortDate(test.target_date!)}: session ${no}/${total}`

async function loadBusy(sb: SupabaseClient, from: string, to: string) {
  const [ev, ch] = await Promise.all([
    sb.from('events').select('*').is('archived_at', null),
    sb.from('event_exceptions').select('id,event_id,on_date,cancelled,new_date,new_start,new_end,missed')
      .gte('on_date', addDays(from, -7)).lte('on_date', to),
  ])
  return busyByDay(rows<EventRow>(ev, 'events'), rows<EventException>(ch, 'calendar changes'), from, to)
}

/** Create a new test's sessions. Returns an error message, or null once the database confirmed them. */
export async function createSessions(sb: SupabaseClient, test: Goal, today: string): Promise<string | null> {
  const days = prepDays(today, test.target_date!)
  if (days.length === 0) return null   // the test is today: nothing to plan
  const n = Math.min(sessionCount(daysBetween(today, test.target_date!), test.priority), days.length)
  let busy: Map<string, number>
  try { busy = await loadBusy(sb, days[0], days[days.length - 1]) } catch (e) { return e instanceof Error ? e.message : 'Couldn’t read your calendar.' }
  const picked = pickDays(days, n, busy)
  const base = moreSettings(await sb.from('profiles').select('planning').maybeSingle().then((r) => (r.error ? null : r.data?.planning ?? null))).prepMinutes
  const values = picked.map((d, i) => ({
    title: sessionTitle(test, i + 1, picked.length),
    goal_id: test.id, subject_id: test.subject_id, project_id: test.project_id,
    is_system: true, session_no: i + 1, duration_minutes: sessionMinutes(test.priority, base),
    due_at: dueAtFromDate(d), status: autoStatus(d, today), source: 'dashboard',
  }))
  const { data, error } = await sb.from('tasks').insert(values).select('id')
  if (error || !data || data.length !== values.length) return `Sessions not created: ${error?.message ?? 'not saved'}`
  return null
}

/**
 * Re-spread a test's open sessions over the days left (after a skip, or when the test's date changes).
 * Keeps their numbers; titles follow the test's name and date.
 */
export async function replanSessions(sb: SupabaseClient, test: Goal, open: Task[], total: number, today: string): Promise<string | null> {
  const days = prepDays(today, test.target_date!)
  const list = [...open].sort((a, b) => (a.session_no ?? 0) - (b.session_no ?? 0))
  if (list.length === 0) return null
  let busy: Map<string, number>
  try { busy = days.length ? await loadBusy(sb, days[0], days[days.length - 1]) : new Map() } catch (e) { return e instanceof Error ? e.message : 'Couldn’t read your calendar.' }
  // more sessions than days left: the extras share the last day
  const picked = pickDays(days.length ? days : [today], list.length, busy)
  for (let i = 0; i < list.length; i++) {
    const d = picked[Math.min(i, picked.length - 1)]
    const { data, error } = await sb.from('tasks').update({
      title: sessionTitle(test, list[i].session_no ?? i + 1, total),
      subject_id: test.subject_id, due_at: dueAtFromDate(d), status: autoStatus(d, today),
    }).eq('id', list[i].id).select('id').single()
    if (error || !data) return `Re-plan stopped part-way: ${error?.message ?? 'not saved'}`
  }
  return null
}

/** Skip a session (archived as "skipped", never deleted) and re-spread the rest. */
export async function skipSession(sb: SupabaseClient, s: Task): Promise<string | null> {
  const { data, error } = await sb.from('tasks')
    .update({ archived_at: new Date().toISOString(), archive_reason: 'skipped' }).eq('id', s.id).select('id').single()
  return error || !data ? `Couldn't skip: ${error?.message ?? 'not saved'}` : null
}

/** Undo a skip: back to open. */
export async function unskipSession(sb: SupabaseClient, s: Task): Promise<string | null> {
  const { data, error } = await sb.from('tasks')
    .update({ archived_at: null, archive_reason: null, due_at: s.due_at, status: s.status }).eq('id', s.id).select('id').single()
  return error || !data ? `Couldn't undo: ${error?.message ?? 'not saved'}` : null
}

/** All of a test's sessions, open and archived, in order. */
export async function loadSessions(sb: SupabaseClient, testId: string): Promise<Task[]> {
  const res = await sb.from('tasks').select('*').eq('goal_id', testId).eq('is_system', true).order('session_no')
  return rows<Task>(res, 'sessions')
}

/** Re-spread a test's open sessions over the days left before its (new) date. Shared by the test sheet and the bot. */
export async function replanTest(sb: SupabaseClient, test: Goal, today: string): Promise<string | null> {
  let all: Task[]
  try { all = await loadSessions(sb, test.id) } catch (e) { return e instanceof Error ? e.message : 'Couldn’t read the sessions.' }
  const open = all.filter((s) => !s.archived_at)
  return replanSessions(sb, test, open, all.filter((s) => s.archive_reason !== 'expired').length, today)
}
