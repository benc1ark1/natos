// Free time, worked out by plain code (never by the AI). Busy = each busy event + its travel both ways
// + a buffer either side. Free = the gaps inside the day (from now, if it's today). All times are London
// wall-clock "HH:MM", so BST/GMT changes need no special handling. Pure: no database, no clock.
import { expandEvents, isSchool, type Occurrence } from './events'
import { fixedFreePeriods, schoolDays, type SchoolDay } from './school'
import { withTravel, type TravelWorld } from './travel'
import { addDays, minutesOf } from './time'
import type { EventException, EventRow } from './types'

/** Nat's planning settings (profiles.planning). Defaults from my-spec 41; facts can still override in AI answers. */
export type PlanningSettings = {
  dayStart: string             // free time starts (if nothing earlier is booked)
  dayEnd: string               // nothing gets planned after this
  heavyUntil: string           // nothing heavy after this
  bufferMin: number            // around every busy event
  schoolNightFocusMin: number  // focused work on a school night
  leaveSchoolAt?: string       // when he walks out of school (busy until then on a school day; earlier if school ends earlier)
  schoolFreePeriods?: string   // his free periods every week ("mon 11:40-12:50, tue 09:10-10:15"); replace the ones worked out from the timetable
  /** Each day's own start and end, so the morning and night routines and sleep stay protected (lib/setup.ts
   *  shapesFor: wake + morning routine … night routine before bed; earlier before a test or a game). */
  dayBounds?: (date: string) => { start: string; end: string } | null
}
export const DEFAULT_PLANNING: PlanningSettings = { dayStart: '07:00', dayEnd: '22:30', heavyUntil: '21:30', bufferMin: 10, schoolNightFocusMin: 150 }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
/** Settings from the profile, each checked; anything missing or odd falls back to the default. */
export function planningSettings(raw: unknown): PlanningSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const time = (k: keyof PlanningSettings) => (typeof o[k] === 'string' && HHMM.test(o[k] as string) ? (o[k] as string) : DEFAULT_PLANNING[k] as string)
  const num = (k: keyof PlanningSettings, max: number) => (Number.isInteger(o[k]) && (o[k] as number) >= 0 && (o[k] as number) <= max ? (o[k] as number) : DEFAULT_PLANNING[k] as number)
  const s = { dayStart: time('dayStart'), dayEnd: time('dayEnd'), heavyUntil: time('heavyUntil'), bufferMin: num('bufferMin', 60), schoolNightFocusMin: num('schoolNightFocusMin', 600),
    ...(typeof o.leaveSchoolAt === 'string' && HHMM.test(o.leaveSchoolAt) ? { leaveSchoolAt: o.leaveSchoolAt } : {}),
    ...(typeof o.schoolFreePeriods === 'string' && fixedFreePeriods(o.schoolFreePeriods) ? { schoolFreePeriods: o.schoolFreePeriods } : {}) } as PlanningSettings
  if (minutesOf(s.dayEnd) <= minutesOf(s.dayStart)) { s.dayStart = DEFAULT_PLANNING.dayStart; s.dayEnd = DEFAULT_PLANNING.dayEnd }
  return s
}

export const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export type Busy = { start: number; end: number; title: string }   // minutes after midnight, incl. travel + buffer
export type Slot = { start: string; end: string; minutes: number; heavyMinutes: number }   // heavyMinutes: the part before heavyUntil

const DEFAULT_EVENT_MIN = 60   // an event with a start but no end

/** When he's free after school that day: his leave time (or when school ends, if that's earlier); without one, when
 *  school ends plus the buffer. */
export const leaveSchool = (sd: Pick<SchoolDay, 'end'>, s: Pick<PlanningSettings, 'leaveSchoolAt' | 'bufferMin'>) =>
  s.leaveSchoolAt ? Math.min(minutesOf(s.leaveSchoolAt), minutesOf(sd.end)) : minutesOf(sd.end) + s.bufferMin

/** The busy blocks of one day: busy events only, cancelled ones left out, moved ones where they moved to. On a school
 *  day (sd), school and its lessons are one block: from school's start until he leaves. */
export function busyBlocks(occ: Occurrence[], date: string, s: PlanningSettings, sd?: SchoolDay): Busy[] {
  const dayStart = 0, dayEnd = 24 * 60
  const out: Busy[] = []
  if (sd) out.push({ start: Math.max(dayStart, minutesOf(sd.start) - s.bufferMin), end: leaveSchool(sd, s), title: 'School' })
  for (const o of occ) {
    if (o.date !== date || o.cancelled || !o.event.is_busy || sd?.hidden.has(o.key)) continue
    if (!o.start) { out.push({ start: dayStart, end: dayEnd, title: o.event.title }); continue }   // all-day and busy
    const start = minutesOf(o.start)
    let end = o.end ? minutesOf(o.end) : start + DEFAULT_EVENT_MIN
    if (end <= start) end = dayEnd                                                                  // runs past midnight
    const before = Math.max(0, o.travelBefore ?? o.event.travel_minutes ?? 0)
    const after = Math.max(0, o.travelAfter ?? o.event.travel_minutes ?? 0)
    out.push({ start: Math.max(dayStart, start - before - s.bufferMin), end: Math.min(dayEnd, end + after + s.bufferMin), title: o.event.title })
  }
  return out.sort((a, b) => a.start - b.start)
}

/** The free gaps of one day, at least `min` minutes long. `nowMin`: minutes after midnight now, if it's today.
 *  freePeriods: school free periods count too (study and homework, never training). */
export function freeSlots(occ: Occurrence[], date: string, s: PlanningSettings, nowMin: number | null = null, min = 15, sd?: SchoolDay, freePeriods = false): Slot[] {
  const b = s.dayBounds?.(date) ?? null
  const from = Math.max(minutesOf(s.dayStart), b ? minutesOf(b.start) : 0, nowMin === null ? 0 : Math.ceil(nowMin / 5) * 5)
  const to = Math.min(minutesOf(s.dayEnd), b ? minutesOf(b.end) : 24 * 60)
  const heavy = minutesOf(s.heavyUntil)
  const slots: Slot[] = []
  let cursor = from
  const add = (a: number, b: number) => {
    if (b - a >= min) slots.push({ start: toHHMM(a), end: toHHMM(b), minutes: b - a, heavyMinutes: Math.max(0, Math.min(b, heavy) - a) })
  }
  const busy = busyBlocks(occ, date, s, sd)
  for (const b of busy) {
    if (b.end <= cursor) continue
    if (b.start >= to) break
    add(cursor, Math.min(b.start, to))
    cursor = Math.max(cursor, b.end)
  }
  if (cursor < to) add(cursor, to)
  if (sd && freePeriods) {
    // a free period is free unless something else is booked in it
    const others = busy.filter((b) => b.title !== 'School')
    for (const w of sd.windows.filter((x) => x.label === 'Free')) {
      let parts: [number, number][] = [[Math.max(minutesOf(w.start), nowMin ?? 0), minutesOf(w.end)]]
      for (const b of others) parts = parts.flatMap(([x, y]) => (b.end <= x || b.start >= y ? [[x, y] as [number, number]] : [[x, Math.min(b.start, y)], [Math.max(b.end, x), y]] as [number, number][]))
      for (const [a, b] of parts) add(a, b)
    }
    slots.sort((a, b) => a.start.localeCompare(b.start))
  }
  return slots
}

/** A school night: tomorrow has an every-weekday busy event (like School) that isn't cancelled. */
export function isSchoolNight(occ: Occurrence[], date: string): boolean {
  const next = addDays(date, 1)
  return occ.some((o) => o.date === next && !o.cancelled && o.event.is_busy && isSchool(o.event))
}

export type DayFree = { date: string; slots: Slot[]; total: number; schoolNight: boolean; focusMin: number | null }

/** Free time for each day from `from` to `to`, from the raw events and this week's changes. */
export function freeDays(events: EventRow[], changes: EventException[], from: string, to: string, s: PlanningSettings, today: string, nowMin: number, travel: TravelWorld | null = null, opts: { freePeriods?: boolean } = {}): DayFree[] {
  const occ = withTravel(expandEvents(events, from, addDays(to, 1), changes), travel)
  const school = schoolDays(events, changes, from, to, s.schoolFreePeriods)
  const out: DayFree[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const slots = freeSlots(occ, d, s, d === today ? nowMin : null, 15, school.get(d), opts.freePeriods)
    const schoolNight = isSchoolNight(occ, d)
    out.push({ date: d, slots, total: slots.reduce((a, x) => a + x.minutes, 0), schoolNight, focusMin: schoolNight ? s.schoolNightFocusMin : null })
  }
  return out
}

/** One day's free time in words, e.g. "16:10–17:20 (70 min) · 19:50–22:30 (160 min, heavy work until 21:30)". */
export function slotsText(day: DayFree, s: PlanningSettings): string {
  if (!day.slots.length) return 'no free time'
  const parts = day.slots.map((x) => {
    const late = x.heavyMinutes < x.minutes ? (x.heavyMinutes > 0 ? `, nothing heavy after ${s.heavyUntil}` : ', light things only') : ''
    return `${x.start}–${x.end} (${x.minutes} min${late})`
  })
  return `${parts.join(' · ')}${day.schoolNight ? ` · school night: about ${Math.round(day.focusMin! / 15) * 15} min of focused work max` : ''}`
}

