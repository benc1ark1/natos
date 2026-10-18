// Each day's mental (🧠) load, worked out by plain code (Build O). A school day has a baseline, tutor sessions and
// focused study add to it, a test or mock is high, and tests and deadlines also weigh on the days before them. Rest
// costs nothing. Every number is a setting (Settings → Mental load), and one session can have its own number
// (load_costs.mental, build-o.sql). The optimiser keeps hard training off high-🧠 days and test eves.
// Pure: no database, no clock.
import { expandEvents, isSchool } from './events'
import { moreSettings } from './settings'
import { addDays, minutesOf } from './time'
import { deadlineOf } from './tasks'
import type { EventException, EventRow, Goal, Task } from './types'

export type MentalItem = { what: string; load: number }
export type MentalDay = { date: string; total: number; level: 'low' | 'med' | 'high'; items: MentalItem[]; test: boolean; testEve: boolean }
/** One session's own mental number ("the SMC mock is max mental"), by its name. */
export type MentalOverride = { title: string; mental: number }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const TEST = /\b(test|mock|mocks|exam|exams|olympiad)\b/i
const TUTOR = /\btutor|tutoring|lesson with\b/i

export type MentalInput = {
  from: string; to: string; planning: unknown
  events: EventRow[]; changes: EventException[]
  goals: Pick<Goal, 'kind' | 'target_date' | 'title'>[]
  tasks: Pick<Task, 'importance' | 'status' | 'title' | 'due_at' | 'window_end' | 'archived_at'>[]
  blocks?: { on_date: string; start_time: string; end_time: string; kind: string; title: string }[]   // planned study (focus) blocks
  overrides?: MentalOverride[]
}

/** 🧠 per day: what adds up and the level (low / med / high from his settings). */
export function mentalDays(x: MentalInput): MentalDay[] {
  const s = moreSettings(x.planning)
  const occ = expandEvents(x.events, x.from, addDays(x.to, 2), x.changes).filter((o) => !o.cancelled)
  const own = new Map((x.overrides ?? []).map((o) => [norm(o.title), o.mental]))
  const tests = new Map<string, string[]>()
  for (const g of x.goals) if (g.kind === 'test' && g.target_date) tests.set(g.target_date, [...(tests.get(g.target_date) ?? []), g.title])
  // tests in the calendar ("Physics mock") count too
  for (const o of occ) if (TEST.test(o.event.title) && !isSchool(o.event)) tests.set(o.date, [...new Set([...(tests.get(o.date) ?? []), o.event.title])])
  const out: MentalDay[] = []
  for (let d = x.from; d <= x.to; d = addDays(d, 1)) {
    const items: MentalItem[] = []
    const today = occ.filter((o) => o.date === d)
    const titled = new Set<string>()
    for (const o of today) {
      const n = norm(o.event.title)
      if (own.has(n) && !titled.has(n)) { titled.add(n); items.push({ what: o.event.title, load: own.get(n)! }); continue }
    }
    if (today.some((o) => isSchool(o.event) && o.event.is_busy && !titled.has(norm(o.event.title)))) items.push({ what: 'school', load: s.mentalSchool })
    for (const o of today.filter((o) => TUTOR.test(o.event.title) && !titled.has(norm(o.event.title)))) items.push({ what: o.event.title, load: s.mentalTutor })
    const test = tests.get(d) ?? []
    for (const t of test) if (!titled.has(norm(t))) items.push({ what: t, load: s.mentalTest })
    const eve = tests.get(addDays(d, 1)) ?? []
    if (eve.length) items.push({ what: `${eve[0]} tomorrow`, load: s.mentalTestEve })
    const study = (x.blocks ?? []).filter((b) => b.on_date === d && b.kind === 'focus').reduce((a, b) => a + minutesOf(b.end_time.slice(0, 5)) - minutesOf(b.start_time.slice(0, 5)), 0)
    if (study) items.push({ what: `${Math.round(study / 6) / 10} h focused study`, load: Math.round((study / 60) * s.mentalStudyHour * 10) / 10 })
    const due = x.tasks.filter((t) => !t.archived_at && t.status !== 'completed' && t.status !== 'someday' && t.importance === 'must' && deadlineOf(t as Task) === addDays(d, 1))
    if (due.length) items.push({ what: `${due.length} must-do${due.length > 1 ? 's' : ''} due tomorrow`, load: Math.min(3, due.length) * s.mentalDeadline })
    const total = Math.round(items.reduce((a, i) => a + i.load, 0) * 10) / 10
    out.push({ date: d, total, level: total >= s.mentalHigh ? 'high' : total >= s.mentalMed ? 'med' : 'low', items, test: test.length > 0, testEve: eve.length > 0 })
  }
  return out
}

export const DOT = { low: '🟢', med: '🟡', high: '🔴' } as const
