// Programmes: an ordered series with a weekly target and an optional end date (STEP, the ACT books…), paused, changed
// or stopped by chat; new ones are just data (plans/contracts.md §3.5). Pure: no database, no clock.
// CONTRACT STUB (pr/0-setup): queue item 1 completes these (gaps_only, optional, days); the signatures stay.
import { addDays, weekStartISO } from '../time'
import type { Programme, ProgrammeItem } from './types'

/** Is it running on `today`? (active, not paused, within its dates) */
export function isRunning(p: Programme, today: string): boolean {
  if (p.status !== 'active') return false
  if (p.pausedUntil && today <= p.pausedUntil) return false
  if (p.startsOn && today < p.startsOn) return false
  if (p.endsOn && today > p.endsOn) return false
  return true
}

/** Items done in the week (Mon–Sun) that holds `today`. */
export const doneThisWeek = (p: Programme, today: string) => {
  const from = weekStartISO(today), to = addDays(from, 6)
  return p.items.filter((i) => i.status === 'done' && i.doneOn && i.doneOn >= from && i.doneOn <= to).length
}

/** The next item to do (in_order: the first not done or skipped). */
export function nextItem(p: Programme): ProgrammeItem | null {
  return [...p.items].sort((a, b) => a.position - b.position).find((i) => i.status === 'todo' || i.status === 'doing') ?? null
}

/** Should it be on today's list? Running, the weekly target not met yet, and today is one of its days. */
export function isDueToday(p: Programme, today: string, dow: number): boolean {
  if (!isRunning(p, today) || p.mode === 'optional') return false
  if (doneThisWeek(p, today) >= p.perWeek) return false
  return dayAllowed(p.days, dow) && !!nextItem(p)
}

/** 'weekend' · 'weekdays' · 'mon, wed' · null (any day). dow: 1 = Mon … 7 = Sun. */
export function dayAllowed(days: string | null, dow: number): boolean {
  const v = (days ?? '').trim().toLowerCase()
  if (!v || v === 'any') return true
  if (v === 'weekend') return dow >= 6
  if (v === 'weekdays') return dow <= 5
  const names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  return v.split(/\s*,\s*|\s+/).some((d) => names.indexOf(d.slice(0, 3)) + 1 === dow)
}
