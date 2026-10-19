// Holiday mode (item 5): the `holidays` setting (date ranges) makes a day a half-term day: DayContext.mode 'half_term',
// no school that day (his school events are skipped), and the morning message waits for his holiday wake time.
// Pure: no database, no clock.
import { expandEvents, isSchool } from '../events'
import { setting } from '../settings'
import { addDays, isoDow, minutesOf } from '../time'
import type { EventException, EventRow } from '../types'

export type Range = { from: string; to: string }
const ISO = /^\d{4}-\d{2}-\d{2}$/

/** "2026-10-17..2026-11-01, 2026-12-21" → ranges (a single date is a one-day range). "none" / odd parts → nothing. */
export function parseHolidays(text: string | null | undefined): Range[] {
  const out: Range[] = []
  for (const part of String(text ?? '').split(/\s*,\s*/)) {
    const m = part.trim().match(/^(\d{4}-\d{2}-\d{2})(?:\s*(?:\.\.|–|—|\bto\b)\s*(\d{4}-\d{2}-\d{2}))?$/)
    if (!m || !ISO.test(m[1])) continue
    const to = m[2] ?? m[1]
    if (to < m[1]) continue
    out.push({ from: m[1], to })
  }
  return out
}

export const holidaysOf = (planning: unknown): Range[] => parseHolidays(setting<string>(planning, 'holidays'))

export const isHoliday = (planning: unknown, date: string) => holidaysOf(planning).some((r) => r.from <= date && date <= r.to)

/** Half-term (a holiday) or a normal school week (weekends count as school weeks). */
export const dayMode = (planning: unknown, date: string): 'half_term' | 'school' => (isHoliday(planning, date) ? 'half_term' : 'school')

/** ISO weekday helper for DayContext. */
export const dowOf = (date: string) => isoDow(date)

/** When the morning message goes: his brief time; on a holiday not before his holiday wake time. */
export function morningAt(planning: unknown, date: string): string {
  const brief = setting<string>(planning, 'briefAt')
  if (!isHoliday(planning, date)) return brief
  const wake = setting<string>(planning, 'holidayWakeAt')
  return minutesOf(wake) > minutesOf(brief) ? wake : brief
}

/**
 * School on holidays, skipped: one "cancelled" change per school occurrence on a holiday date, added to the real
 * changes (lib/events.ts expandEvents keeps them out). Nothing is saved: it's only how the day is worked out.
 */
export function holidayChanges(events: EventRow[], changes: EventException[], planning: unknown, from: string, to: string): EventException[] {
  const ranges = holidaysOf(planning).filter((r) => r.to >= from && r.from <= to)
  if (!ranges.length) return changes
  const inHoliday = (d: string) => ranges.some((r) => r.from <= d && d <= r.to)
  const extra: EventException[] = []
  for (const o of expandEvents(events.filter((e) => isSchool(e)), addDays(from, -1), addDays(to, 1), changes)) {
    if (o.cancelled || !inHoliday(o.date)) continue
    if (o.event.starts_at) continue   // a one-off event he added himself (a trip, a mock) still happens
    extra.push({ id: `holiday:${o.event.id}:${o.usualDate}`, event_id: o.event.id, on_date: o.usualDate, cancelled: true, new_date: null, new_start: null, new_end: null, missed: false })
  }
  // a real change for the same occurrence is replaced by the holiday one (it's off either way)
  const off = new Set(extra.map((x) => `${x.event_id}|${x.on_date}`))
  return [...changes.filter((c) => !off.has(`${c.event_id}|${c.on_date}`)), ...extra]
}
