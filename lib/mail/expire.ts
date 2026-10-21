// A tutor's homework that is only for his next lesson (fix round 21): Sam's CS homework is archived by itself (reason
// "expired", never deleted) once Sam's next lesson after it was set (or after its due day) has passed. Which tutors is
// his setting "Tutors whose homework expires after their next lesson" (names or task sources, e.g. "Sam, CS tutor");
// their lessons are the calendar events whose title names them, so nothing about his week is in the code.
// Runs with the email watcher on every 5-minute tick (lib/mail/watcher.ts processMail).
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEvents } from '../events'
import { taskSources, type Source } from '../lists'
import { moreSettings } from '../settings'
import { addDays, dateISOOf, zonedToUTC } from '../time'
import type { EventException, EventRow } from '../types'
import { HOMEWORK_WORDS } from './homework'

/** One tutor from his setting: the task sources that are theirs, and the words their lessons' titles contain. */
export type Tutor = { item: string; keys: string[]; names: string[] }

const words = (s: string) => ` ${s.toLowerCase().replace(/[’']s\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `
/** Does the text contain this phrase as whole words ("CS tutor" in "CS tutor (Sam)", not "Samantha")? */
const has = (text: string | null | undefined, phrase: string) => { const p = words(phrase).trim(); return !!p && words(text ?? '').includes(` ${p} `) }

/** "Sam, CS tutor" with his sources ("CS tutor (Sam)") → each tutor's source keys and lesson words. "none" → []. */
export function tutorsOf(setting: string, sources: Source[]): Tutor[] {
  if (/^\s*none\s*$/i.test(setting)) return []
  return setting.split(/[,;\n]+/).map((x) => x.trim()).filter((x) => x.length >= 2).map((item) => {
    const mine = sources.filter((s) => s.key !== 'own' && (s.key === item.toLowerCase() || has(s.label, item)))
    const names = [item, ...mine.flatMap((s) => [s.label.replace(/\(.*?\)/g, '').trim(), ...[...s.label.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim())])]
    return { item, keys: mine.map((s) => s.key), names: [...new Set(names.filter((n) => n.length >= 2))] }
  })
}

export type HomeworkRow = { id: string; title: string; details: string | null; source_text: string | null; origin: string | null; due_at: string | null; created_at: string; is_system?: boolean }

/** Is this task that tutor's homework? Its source is theirs, it's homework naming them, or it came from their email. */
export function isTutorHomework(t: HomeworkRow, tutor: Tutor): boolean {
  if (t.is_system) return false
  if (t.origin && tutor.keys.includes(t.origin)) return true
  const fromEmail = (t.details ?? '').match(/From (\S+?)’s email/)?.[1]
  if (fromEmail && tutor.names.some((n) => words(n) === words(fromEmail))) return true
  return HOMEWORK_WORDS.test(t.title) && tutor.names.some((n) => has(t.title, n) || has(t.source_text, n))
}

const isLesson = (ev: EventRow, tutor: Tutor) => !ev.archived_at && !ev.all_day && tutor.names.some((n) => has(ev.title, n))

/** The open homework whose tutor's next lesson (the first one starting after it was set, and not before its due day)
 *  has ended by `now`. Pure: the caller archives them. */
export function expiredHomework(tasks: HomeworkRow[], tutors: Tutor[], events: EventRow[], changes: EventException[], now: Date): { id: string; title: string; lesson: string }[] {
  const out: { id: string; title: string; lesson: string }[] = []
  const today = dateISOOf(now.toISOString())
  for (const t of tasks) {
    const tutor = tutors.find((x) => isTutorHomework(t, x))
    const lessons = tutor ? events.filter((ev) => isLesson(ev, tutor)) : []
    if (!lessons.length) continue
    const set = Date.parse(t.created_at)
    const anchor = Math.max(set, t.due_at ? Date.parse(zonedToUTC(dateISOOf(t.due_at), '00:00')) : 0)
    const from = dateISOOf(new Date(anchor).toISOString())
    if (from > today) continue
    const next = expandEvents(lessons, from, today, changes)
      .filter((o) => !o.cancelled && o.start && Date.parse(zonedToUTC(o.date, o.start)) >= anchor)
      .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`))[0]
    if (!next) continue
    const end = next.end ? Date.parse(zonedToUTC(next.date, next.end)) : Date.parse(zonedToUTC(next.date, next.start!)) + 3_600_000
    if (end <= now.getTime()) out.push({ id: t.id, title: t.title, lesson: `${next.event.title} ${next.date} ${next.start}` })
  }
  return out
}

/** Archive (never delete) the homework whose tutor's next lesson has passed. Returns the ids archived. */
export async function expireTutorHomework(sb: SupabaseClient, now = new Date()): Promise<string[]> {
  const planning = await sb.from('profiles').select('planning').maybeSingle().then((r) => r.data?.planning ?? null)
  const tutors = tutorsOf(String(moreSettings(planning).homeworkUntilLesson ?? ''), taskSources(planning))
  if (!tutors.length) return []
  const { data, error } = await sb.from('tasks').select('id,title,details,source_text,origin,due_at,created_at,is_system')
    .is('archived_at', null).neq('status', 'completed').order('created_at').limit(500)
  if (error) throw new Error(`Couldn’t read tasks: ${error.message}`)
  const tasks = ((data ?? []) as HomeworkRow[]).filter((t) => tutors.some((x) => isTutorHomework(t, x)))
  if (!tasks.length) return []
  const first = tasks.reduce((a, t) => (t.created_at < a ? t.created_at : a), tasks[0].created_at)
  const today = dateISOOf(now.toISOString())
  const [{ data: evs }, { data: chs }] = await Promise.all([
    sb.from('events').select('*').is('archived_at', null),
    sb.from('event_exceptions').select('id,event_id,on_date,cancelled,new_date,new_start,new_end,missed').gte('on_date', addDays(dateISOOf(first), -7)).lte('on_date', addDays(today, 7)),
  ])
  const gone = expiredHomework(tasks, tutors, (evs ?? []) as EventRow[], (chs ?? []) as EventException[], now)
  if (!gone.length) return []
  const { data: done, error: e2 } = await sb.from('tasks').update({ archived_at: now.toISOString(), archive_reason: 'expired' })
    .in('id', gone.map((x) => x.id)).is('archived_at', null).select('id')
  if (e2) throw new Error(`Couldn’t archive expired homework: ${e2.message}`)
  return (done ?? []).map((r) => r.id as string)
}
