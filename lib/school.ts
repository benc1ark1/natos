// School as one line in the week and day views: the School blocks from his calendars merged (earliest start, latest
// end), lessons hidden, and under it only his free periods (break and lunch are worked out but never shown or used). Lessons are Google events inside the
// school day from a calendar that has a School block (or a calendar he marked as school). Free periods are
// "Private Study" lessons and periods with no lesson; break and lunch are the gaps no day of the week has a lesson in.
// Pure: no database, no clock.
import { expandEvents, isSchool, type Occurrence } from './events'
import { addDays, minutesOf } from './time'
import type { EventException, EventRow } from './types'

export type SchoolWindow = { start: string; end: string; label: 'Free' | 'Break' | 'Lunch' }
export type SchoolDay = { date: string; start: string; end: string; windows: SchoolWindow[]; hidden: Set<string> }

const len = (o: Occurrence) => minutesOf(o.end!) - minutesOf(o.start!)
const FREE_TITLE = /\b(private study|study period|free( period)?)\b/i
const MIN = 10   // shorter gaps are lesson changeovers
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** A whole-day School block (his own repeating one or a copy from Google). He can say "not school" on an event. */
const isBlock = (o: Occurrence) => o.event.is_school !== false && !o.event.all_day && o.event.is_busy && !!o.start && !!o.end &&
  (isSchool(o.event) || /^\s*school\s*$/i.test(o.event.title)) && len(o) >= 180

export const windowIcon = (w: SchoolWindow) => (w.label === 'Break' ? '☕' : w.label === 'Lunch' ? '🍽' : '🆓')
export const windowLine = (w: SchoolWindow) => `${w.start}–${w.end} ${windowIcon(w)} ${w.label}`

const DOWS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const PERIOD = /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(\d{1,2})[:.](\d{2})\s*[-–]\s*(\d{1,2})[:.](\d{2})$/i
/** His free periods every week ("mon 11:40-12:50, tue 09:10-10:15") by ISO weekday; null if a piece doesn't read. */
export function fixedFreePeriods(v: string | undefined): Map<number, SchoolWindow[]> | null {
  const items = (v ?? '').split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)
  if (!items.length) return null
  const out = new Map<number, SchoolWindow[]>()
  for (const it of items) {
    const m = it.match(PERIOD)
    if (!m) return null
    const a = Number(m[2]) * 60 + Number(m[3]), b = Number(m[4]) * 60 + Number(m[5])
    if (b <= a || b > 24 * 60) return null
    const dow = DOWS.indexOf(m[1].toLowerCase()) + 1
    out.set(dow, [...(out.get(dow) ?? []), { start: hm(a), end: hm(b), label: 'Free' as const }].sort((x, y) => x.start.localeCompare(y.start)))
  }
  return out
}

/** School days between from and to (inclusive), keyed by date. Uses the week either side to learn the period times.
 *  fixedFree (his setting): his free periods every week, used instead of the ones worked out from the timetable. */
export function schoolDays(events: EventRow[], changes: EventException[], from: string, to: string, fixedFree?: string): Map<string, SchoolDay> {
  const fixed = fixedFreePeriods(fixedFree)
  const occ = expandEvents(events, addDays(from, -7), addDays(to, 7), changes).filter((o) => !o.cancelled && o.start && o.end)
  const byDate = new Map<string, Occurrence[]>()
  for (const o of occ) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])

  // each date's school span, and what could be a lesson (a short Google event inside it)
  const days = new Map<string, { start: string; end: string; blocks: Occurrence[]; lessons: Occurrence[] }>()
  for (const [date, list] of byDate) {
    const blocks = list.filter(isBlock)
    if (!blocks.length) continue
    const start = blocks.map((o) => o.start!).sort()[0], end = blocks.map((o) => o.end!).sort().at(-1)!
    const lessons = list.filter((o) => !blocks.includes(o) && o.event.external_source === 'google' && !o.event.all_day && o.event.is_school !== false &&
      o.start! >= start && o.end! <= end && len(o) <= 120)
    days.set(date, { start, end, blocks, lessons })
  }
  // the timetable: calendars he marked as school, else the one with the most of these (his own calendar keeps its events)
  const count = new Map<string | null | undefined, number>()
  for (const d of days.values()) for (const o of d.lessons) count.set(o.event.calendar_id, (count.get(o.event.calendar_id) ?? 0) + 1)
  const top = [...count].sort((a, b) => b[1] - a[1])[0]
  const timetable = (o: Occurrence) => o.event.is_school === true || (!!top && top[1] >= 5 && o.event.calendar_id === top[0])
  for (const d of days.values()) d.lessons = d.lessons.filter(timetable)

  // the period grid: every lesson time in these weeks; break and lunch are the gaps no day has a lesson in
  const slots = [...days.values()].flatMap((d) => d.lessons.map((o) => [minutesOf(o.start!), minutesOf(o.end!)] as const))
  const gridStart = Math.min(...slots.map((s) => s[0])), gridEnd = Math.max(...slots.map((s) => s[1]))
  const common = slots.length ? gaps(gridStart, gridEnd, slots) : []

  const out = new Map<string, SchoolDay>()
  for (const [date, d] of days) {
    if (date < from || date > to) continue
    const hidden = new Set([...d.blocks, ...d.lessons].map((o) => o.key))
    let windows: SchoolWindow[] = []
    if (d.lessons.length) {
      const s = Math.max(gridStart, minutesOf(d.start)), e = Math.min(gridEnd, minutesOf(d.end))
      const busy = d.lessons.filter((o) => !FREE_TITLE.test(o.event.title)).map((o) => [minutesOf(o.start!), minutesOf(o.end!)] as const)
      const pieces: { s: number; e: number; label: SchoolWindow['label'] }[] = []
      for (const [fs, fe] of gaps(s, e, busy)) {
        // split by break and lunch
        let at = fs
        for (const [cs, ce] of common) {
          if (ce <= at || cs >= fe) continue
          if (cs > at) pieces.push({ s: at, e: cs, label: 'Free' })
          pieces.push({ s: Math.max(cs, at), e: Math.min(ce, fe), label: ce - cs >= 40 ? 'Lunch' : 'Break' })
          at = Math.min(ce, fe)
        }
        if (at < fe) pieces.push({ s: at, e: fe, label: 'Free' })
      }
      // join pieces split only by a changeover; drop crumbs
      const joined: typeof pieces = []
      for (const p of pieces) {
        const last = joined.at(-1)
        if (last && last.label === p.label && p.s - last.e <= MIN) last.e = p.e
        else joined.push({ ...p })
      }
      // free periods start and end on period times, not in the changeover
      for (const p of joined.filter((x) => x.label === 'Free')) {
        p.s = slots.map((x) => x[0]).filter((v) => v >= p.s && v - p.s < MIN).sort((a, b) => a - b)[0] ?? p.s
        p.e = slots.map((x) => x[1]).filter((v) => v <= p.e && p.e - v < MIN).sort((a, b) => b - a)[0] ?? p.e
      }
      // only free periods are shown and used (he doesn't work in break or lunch)
      windows = joined.filter((p) => p.label === 'Free').filter((p) => p.e - p.s >= MIN).map((p) => ({ start: hm(p.s), end: hm(p.e), label: p.label }))
    }
    if (fixed) windows = (fixed.get(isoDow(date)) ?? []).filter((w) => w.start >= d.start && w.end <= d.end)
    out.set(date, { date, start: d.start, end: d.end, windows, hidden })
  }
  return out
}

const isoDow = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1

/** The parts of [s, e] not covered by any of the spans, MIN minutes or longer. */
function gaps(s: number, e: number, spans: readonly (readonly [number, number])[]): [number, number][] {
  const sorted = [...spans].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  let at = s
  for (const [a, b] of sorted) {
    if (a > at && Math.min(a, e) - at >= MIN) out.push([at, Math.min(a, e)])
    at = Math.max(at, b)
    if (at >= e) break
  }
  if (e - at >= MIN) out.push([at, e])
  return out
}

/**
 * A day's lines in time order with school as one line: things before school, "🏫 School 08:45–16:15", then the free
 * periods, break and lunch (indented) with anything planned in school hours under them, then the rest.
 */
export function withSchool(sd: Pick<SchoolDay, 'start' | 'end' | 'windows'> | undefined, items: { at: string; line: string }[], indent = '  ', windows = sd?.windows ?? []): string[] {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at))
  if (!sd) return sorted.map((x) => x.line)
  const before = sorted.filter((x) => x.at < sd.start), during = sorted.filter((x) => x.at >= sd.start && x.at < sd.end), after = sorted.filter((x) => x.at >= sd.end)
  const inner = [...windows.map((w) => ({ at: w.start, line: windowLine(w), w: 0 })), ...during.map((x) => ({ ...x, w: 1 }))]
    .sort((a, b) => a.at.localeCompare(b.at) || a.w - b.w)
    .map((x) => `${indent}${x.w ? indent : ''}${x.line}`)
  return [...before.map((x) => x.line), `🏫 School ${sd.start}–${sd.end}`, ...inner, ...after.map((x) => x.line)]
}
