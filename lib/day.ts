// One day in time order (Build O part 10): the morning routine, school, his events, study and training blocks (each
// training block with its place and when to leave), the night routine. The 07:00 brief and the pinned Today message
// both show it; plan blocks can be ticked. If the day is overloaded (🧠 high and 💪 high), one line says so and
// suggests what to move. Pure: no database, no clock.
import { expandEvents, isBackground, isSchool, timeRange } from './events'
import { costOf, total } from './load'
import { schoolDays, windowIcon } from './school'
import { mentalDays } from './mental'
import { moreSettings } from './settings'
import { activePlaces, activeSessions, findPlace, findSession, parseSessionTitle, travelOf, hm, type DayShape } from './setup'
import { planningSettings } from './freetime'
import { addDays, dowShort, minutesOf } from './time'
import { leaveBy, withTravel, type TravelWorld } from './travel'
import { typeOf } from './training-data'
import { trainingTypes } from './training'
import type { CostRow } from './load'
import type { EventException, EventRow, Goal, Task } from './types'

export type DayBlock = { id: string; start_time: string; end_time: string; title: string; kind: string; task_id: string | null; status: string; target_id?: string | null; goal_id?: string | null }
export type DayItem = {
  at: string; end: string | null; kind: 'routine' | 'school' | 'window' | 'event' | 'study' | 'training' | 'light' | 'rest'
  icon: string; title: string; block?: DayBlock; leave?: string | null; how?: string | null
}

/** Where he leaves from for a block, and when (training at a place: from school if it starts right after school). */
export function blockLeave(b: { start_time: string; title: string }, planning: unknown, schoolEnd: number | null, bufferMin: number): { leave: string; how: string } | null {
  const t = parseSessionTitle(b.title)
  if (!t.place) return null
  const places = activePlaces(planning)
  const p = findPlace(places, t.place)
  if (!p || p.key === 'home') return null
  const start = minutesOf(b.start_time)
  const fromSchool = schoolEnd != null && start - schoolEnd <= 60
  const tr = travelOf(p, fromSchool ? 'school' : 'home', places)
  if (!tr.there) return null
  return { leave: hm(start - tr.there), how: `${tr.there} min${fromSchool ? ' from school' : ''}${tr.guess ? ', a guess' : ''}` }
}

export type DayInput = { date: string; events: EventRow[]; changes: EventException[]; travel: TravelWorld | null; shape: DayShape | null; blocks: DayBlock[]; planning: unknown; bufferMin: number }

export function dayItems(x: DayInput): DayItem[] {
  const items: DayItem[] = []
  if (x.shape) items.push({ at: x.shape.wake, end: x.shape.morningEnd, kind: 'routine', icon: '☀️', title: `Morning routine${x.shape.wakeWhy ? ` (${x.shape.wakeWhy})` : ''}` })
  const occ = withTravel(expandEvents(x.events, x.date, x.date, x.changes), x.travel).filter((o) => o.date === x.date && !o.cancelled && o.start)
  const school = occ.filter((o) => isSchool(o.event) && o.event.is_busy && o.end)
  let schoolEnd: number | null = null
  if (school.length) schoolEnd = minutesOf(school.map((o) => o.end!).sort().at(-1)!) + x.bufferMin
  // school as one line (both calendars' School merged, lessons hidden), then its free periods, break and lunch
  const sd = schoolDays(x.events, x.changes, x.date, x.date, planningSettings(x.planning).schoolFreePeriods).get(x.date)
  if (sd) {
    items.push({ at: sd.start, end: sd.end, kind: 'school', icon: '🏫', title: 'School' })
    for (const w of sd.windows) items.push({ at: w.start, end: w.end, kind: 'window', icon: windowIcon(w), title: w.label })
  } else if (school.length) {
    items.push({ at: school.map((o) => o.start!).sort()[0], end: school.map((o) => o.end!).sort().at(-1)!, kind: 'school', icon: '🏫', title: 'School' })
  }
  for (const o of occ.filter((y) => !isSchool(y.event) && !sd?.hidden.has(y.key) && !(y.event.external_source === 'google' && isBackground(y.event)))) {
    const l = leaveBy(o)
    const type = typeOf(o.event as never, trainingTypes(x.planning))?.type
    items.push({ at: o.start!, end: o.end, kind: 'event', icon: type === 'match' ? '⚽' : type === 'football' ? '⚽' : type ? '🏃' : '📅', title: o.event.title, leave: l?.at ?? null, how: l?.words ?? null })
  }
  for (const b of x.blocks) {
    const kind = b.kind === 'training' ? 'training' : b.kind === 'focus' ? 'study' : b.kind === 'rest' ? 'rest' : 'light'
    const l = kind === 'training' ? blockLeave(b, x.planning, schoolEnd, x.bufferMin) : null
    items.push({ at: b.start_time.slice(0, 5), end: b.end_time.slice(0, 5), kind, icon: kind === 'training' ? '🏋️' : kind === 'study' ? '📚' : kind === 'rest' ? '🛌' : '•', title: b.title, block: b, leave: l?.leave ?? null, how: l?.how ?? null })
  }
  if (x.shape) items.push({ at: x.shape.nightStart, end: x.shape.bed, kind: 'routine', icon: '🌙', title: `Night routine → bed ${x.shape.bed}${x.shape.bedWhy ? ` (${x.shape.bedWhy})` : ''}` })
  return items.sort((a, b) => a.at.localeCompare(b.at) || Number(a.kind === 'routine' && a.icon === '🌙') - Number(b.kind === 'routine' && b.icon === '🌙'))
}

/** One line per item: "16:25 🏋️ Upper @ PureGym (leave school 16:10)"; ✅ for ticked blocks. */
export function itemLine(it: DayItem, esc: (s: string) => string): string {
  const done = it.block?.status === 'done'
  const span = it.end && it.kind !== 'training' && it.kind !== 'study' ? `–${it.end}` : ''
  const mins = it.block && it.end ? ` <i>${minutesOf(it.end) - minutesOf(it.at)}m</i>` : ''
  const leave = it.leave ? ` <i>(leave ${it.how?.includes('from school') ? 'school ' : ''}${it.leave}${it.how ? `, ${esc(it.how.replace(/ from school/, ''))}` : ''})</i>` : ''
  const text = `${it.kind === 'window' ? '   ' : ''}${it.at}${span} ${it.icon} ${esc(it.title)}${mins}${leave}`
  return done ? `✅ <s>${text}</s>` : text
}

// ---------------------------------------------------------------------------
// How heavy the day is, and what to move if it's too much
// ---------------------------------------------------------------------------

export type DayLevel = { mental: 'low' | 'med' | 'high'; mentalTotal: number; physical: 'rest' | 'low' | 'med' | 'high'; physicalTotal: number }

export function dayLevel(x: { date: string; planning: unknown; events: EventRow[]; changes: EventException[]; goals: Pick<Goal, 'kind' | 'target_date' | 'title'>[]; tasks: Task[]; blocks: DayBlock[]; costs: CostRow[] }): DayLevel {
  const s = moreSettings(x.planning)
  const types = trainingTypes(x.planning)
  const m = mentalDays({ from: x.date, to: x.date, planning: x.planning, events: x.events, changes: x.changes, goals: x.goals, tasks: x.tasks,
    blocks: x.blocks.map((b) => ({ on_date: x.date, start_time: b.start_time, end_time: b.end_time, kind: b.kind, title: b.title })) })[0]
  let phys = 0
  for (const o of expandEvents(x.events, x.date, x.date, x.changes).filter((y) => y.date === x.date && !y.cancelled && y.start)) {
    const t = typeOf(o.event as never, types)
    if (t) phys += total(costOf({ title: o.event.title, type: t.type, intensity: t.load === 'hard' ? 'heavy' : t.load, date: x.date }, x.costs, types, s))
  }
  const sessions = activeSessions(x.planning)
  for (const b of x.blocks.filter((y) => y.kind === 'training')) {
    const t = parseSessionTitle(b.title), st = findSession(sessions, t.name)
    phys += total(costOf({ title: t.name, type: st?.type ?? 'gym', intensity: t.intensity ?? st?.intensity ?? 'heavy', date: x.date }, x.costs, types, s))
  }
  phys = Math.round(phys * 10) / 10
  return { mental: m?.level ?? 'low', mentalTotal: m?.total ?? 0, physical: !phys ? 'rest' : phys >= s.dayHighLoad ? 'high' : phys >= s.dayMedLoad ? 'med' : 'low', physicalTotal: phys }
}

/** Too much today? Both high, or over the day's limit. The block easiest to move (not due soon; not heavy lower or speed). */
export function overload(level: DayLevel, blocks: DayBlock[], tasks: Task[], planning: unknown, date: string): { line: string; move: DayBlock | null } | null {
  const s = moreSettings(planning)
  const tooMuch = (level.mental === 'high' && level.physical === 'high') || level.physicalTotal > s.dayMaxLoad
  if (!tooMuch) return null
  const due = new Set(tasks.filter((t) => t.due_at && t.due_at.slice(0, 10) <= addDays(date, 1)).map((t) => t.id))
  const sessions = activeSessions(planning)
  const movable = blocks.filter((b) => b.status === 'planned').filter((b) => {
    if (b.kind === 'training') { const st = findSession(sessions, parseSessionTitle(b.title).name); return !st || !['lower', 'sprint', 'plyo'].includes(st.type) }
    return !(b.task_id && due.has(b.task_id))
  }).sort((a, b) => Number(b.kind === 'training') - Number(a.kind === 'training') || (minutesOf(b.end_time) - minutesOf(b.start_time)) - (minutesOf(a.end_time) - minutesOf(a.start_time)))[0] ?? null
  const why = level.physicalTotal > s.dayMaxLoad ? `💪 ${level.physicalTotal} is over your day limit (${s.dayMaxLoad})` : '🧠 high and 💪 high'
  return { line: `⚠️ Heavy day: ${why}.${movable ? ` Move ${parseSessionTitle(movable.title).name} to ${dowShort(addDays(date, 1))}?` : ' Keep the evening light.'}`, move: movable }
}

export { timeRange }

/** Free slots with the ones after school first on a school day (study and training belong after school). */
export function afterSchoolFirst<T extends { start: string }>(slots: T[], events: EventRow[], changes: EventException[], date: string): T[] {
  const ends = expandEvents(events, date, date, changes).filter((o) => o.date === date && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.end).map((o) => o.end!).sort()
  if (!ends.length) return slots
  const end = ends.at(-1)!
  return [...slots.filter((s) => s.start >= end), ...slots.filter((s) => s.start < end)]
}
