// Nat's training set-up and the shape of his days (Build O): where he can train (equipment, travel, when it's open to
// him), the sessions he needs each week, Owen's days, this week's game, read-only sessions he wants ignored, and how a
// day is built around his morning and night routines. Defaults come from his brief (11 Oct 2026) and count as guesses
// until he answers (lib/gaps.ts asks him); plans mark what rests on a guess. Everything lives in profiles.planning and
// is editable by chat (lib/setup-edit.ts) and in Settings. Pure: no database, no clock.
import { expandEvents, isSchool } from './events'
import { moreSettings, DAYS_OF_WEEK } from './settings'
import { addDays, dowShort, isoDow, minutesOf, weekStartISO, zonedToUTC } from './time'
import type { EventException, EventRow, Goal } from './types'
import type { Intensity } from './load'

const obj = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
const KEY = /^[a-z][a-z0-9_]{0,24}$/
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export const hm = (m: number) => `${String(Math.floor(Math.max(0, Math.min(m, 24 * 60 - 1)) / 60)).padStart(2, '0')}:${String(Math.max(0, Math.min(m, 24 * 60 - 1)) % 60).padStart(2, '0')}`

// ---------------------------------------------------------------------------
// Places he can train
// ---------------------------------------------------------------------------

/** Equipment words the app understands ('full' = a full gym). Shown to him in plain words. */
export const EQUIPMENT: Record<string, string> = {
  full: 'full gym', barbell: 'barbells', squat_rack: 'squat rack', free_weights: 'free weights', dumbbells: 'dumbbells', bench: 'a bench',
  incline_bench: 'incline bench', leg_press: 'leg press', lunges: 'room for lunges', chest_machines: 'chest machines', cables: 'cables',
  upper_machines: 'upper-body machines', lower_machines: 'lower-body machines', plyo_space: 'plyo space', circuit_space: 'circuit space',
  mat: 'a mat', track: 'track / sprint space',
}

/**
 * access: 'any' = whenever he's free (travel from where he is) · 'school' = school days only, straight after school
 * (or in free periods if freePeriods) · 'owen' = Owen's sessions. Travel minutes null = not known yet (a guess is used).
 */
export type TrainingPlace = {
  key: string; name: string; address?: string | null
  equipment: string[]; poor?: string[]; goodFor?: string
  access: 'any' | 'school' | 'owen'
  fromHome: number | null; fromSchool: number | null; toHome: number | null
  mode?: string | null; bestAfterSchool?: boolean; freePeriods?: boolean | null
  archived?: boolean
}

/** From his brief (11 Oct). */
export const DEFAULT_PLACES: TrainingPlace[] = [
  { key: 'home', name: 'Home', address: '29 New End, Hampstead', equipment: ['plyo_space', 'circuit_space', 'bench', 'dumbbells', 'lunges', 'mat'],
    goodFor: 'plyos and circuits, injury prevention, lunges, Bulgarians, core, stretching', access: 'any', fromHome: 0, fromSchool: null, toHome: 0, mode: 'walk' },
  { key: 'school_gym', name: 'School gym', address: 'UCS Hampstead', equipment: ['barbell', 'squat_rack', 'free_weights', 'incline_bench', 'leg_press', 'lunges', 'chest_machines', 'cables', 'dumbbells', 'bench', 'upper_machines', 'lower_machines'],
    poor: ['upper_machines', 'lower_machines'], goodFor: 'barbells, squat rack, free weights, incline bench, leg press; good chest machines and cables', access: 'school', fromHome: null, fromSchool: 0, toHome: null, mode: 'walk', freePeriods: null },
  { key: 'puregym', name: 'PureGym Swiss Cottage', address: 'Swiss Cottage, London', equipment: ['full'], goodFor: 'everything', access: 'any',
    fromHome: 30, fromSchool: 15, toHome: 30, mode: 'bus', bestAfterSchool: true },
  { key: 'owen', name: 'Owen', equipment: ['track', 'plyo_space'], goodFor: 'speed sessions with Owen', access: 'owen', fromHome: null, fromSchool: null, toHome: null },
]

/** What a journey is guessed to take until he says (minutes). */
export const GUESS_TRAVEL = { schoolHome: 10, other: 20 }

export function trainingPlaces(planning: unknown): TrainingPlace[] {
  const v = obj(planning).trainingPlaces
  if (!Array.isArray(v)) return DEFAULT_PLACES
  const out: TrainingPlace[] = []
  const seen = new Set<string>()
  const mins = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 240 ? (x as number) : null)
  const words = (x: unknown) => (Array.isArray(x) ? x.filter((w): w is string => typeof w === 'string' && KEY.test(w)).slice(0, 30) : [])
  for (const raw of v) {
    const p = obj(raw)
    const key = typeof p.key === 'string' && KEY.test(p.key) ? p.key : ''
    const name = typeof p.name === 'string' ? p.name.trim().slice(0, 60) : ''
    if (!key || !name || seen.has(key)) continue
    seen.add(key)
    out.push({
      key, name, address: typeof p.address === 'string' ? p.address.slice(0, 120) : null, equipment: words(p.equipment), poor: words(p.poor),
      goodFor: typeof p.goodFor === 'string' ? p.goodFor.slice(0, 200) : '', access: p.access === 'school' || p.access === 'owen' ? p.access : 'any',
      fromHome: mins(p.fromHome), fromSchool: mins(p.fromSchool), toHome: mins(p.toHome), mode: typeof p.mode === 'string' ? p.mode.slice(0, 12) : null,
      bestAfterSchool: p.bestAfterSchool === true, freePeriods: typeof p.freePeriods === 'boolean' ? p.freePeriods : null, ...(p.archived === true ? { archived: true } : {}),
    })
  }
  return out.length ? out : DEFAULT_PLACES
}

export const activePlaces = (planning: unknown) => trainingPlaces(planning).filter((p) => !p.archived)

/** Does a place have it (well)? 'full' has everything. */
export const hasEquipment = (p: TrainingPlace, e: string) => p.equipment.includes('full') || p.equipment.includes(e)
export const goodAt = (p: TrainingPlace, e: string) => hasEquipment(p, e) && !(p.poor ?? []).includes(e)

/**
 * Minutes to get there from home or from school (a guess if he hasn't said), and back home afterwards. Home from
 * school is the walk home; the school gym is at school (no travel from school, then the walk home).
 */
export function travelOf(p: TrainingPlace, from: 'home' | 'school', places: TrainingPlace[]): { there: number; back: number; guess: boolean } {
  const schoolHome = places.find((x) => x.key === 'home')?.fromSchool ?? null
  if (p.key === 'home') {
    const there = from === 'home' ? 0 : schoolHome
    return { there: there ?? GUESS_TRAVEL.schoolHome, back: 0, guess: there == null }
  }
  if (p.access === 'school') {
    const there = from === 'school' ? 0 : p.fromHome
    const back = p.toHome ?? schoolHome
    return { there: there ?? GUESS_TRAVEL.schoolHome, back: back ?? GUESS_TRAVEL.schoolHome, guess: there == null || back == null }
  }
  const there = from === 'home' ? p.fromHome : p.fromSchool
  return { there: there ?? GUESS_TRAVEL.other, back: p.toHome ?? GUESS_TRAVEL.other, guess: there == null || p.toHome == null }
}

// ---------------------------------------------------------------------------
// The sessions he needs each week
// ---------------------------------------------------------------------------

/**
 * type: a training type key (costs and rules: lib/load.ts, lib/training.ts). minutes null = not known yet (a guess is
 * used). perWeek..maxPerWeek: the optimiser decides within the range (upper 2–3). needs: equipment it must have;
 * wants: equipment that makes it better (a place without it is a worse fit). owen: Owen programmes it.
 */
export type SessionType = {
  key: string; name: string; type: string; intensity: Intensity
  minutes: number | null; extraMinutes?: number; extraLabel?: string
  perWeek: number; maxPerWeek?: number
  needs?: string[]; wants?: string[]; places: string[]
  owen?: boolean; target?: string | null; flexible?: boolean; noLower?: boolean; stackWith?: string | null
  noLighter?: boolean   // always at its intensity: never planned lighter (upper is always heavy)
  archived?: boolean
}

/** From his brief (11 Oct). Days are the optimiser's job, never fixed here. */
export const DEFAULT_SESSIONS: SessionType[] = [
  { key: 'speed', name: 'Speed + circuits', type: 'sprint', intensity: 'heavy', minutes: null, extraMinutes: 7, extraLabel: '5–7 min circuits after', perWeek: 1, places: ['owen'], owen: true, target: null },
  { key: 'heavy_lower', name: 'Heavy lower', type: 'lower', intensity: 'heavy', minutes: null, perWeek: 1, needs: ['barbell', 'squat_rack'], wants: ['leg_press', 'lower_machines'], places: ['school_gym', 'puregym'], owen: true, target: 'Lower + plyo' },
  { key: 'injury', name: 'Injury prevention', type: 'injury', intensity: 'moderate', minutes: null, perWeek: 1, places: ['home'], owen: true, target: null },
  { key: 'core', name: 'Core', type: 'core', intensity: 'light', minutes: null, perWeek: 1, places: ['home'], owen: true, target: null, noLower: true },
  { key: 'stretch', name: 'Stretching', type: 'mobility', intensity: 'light', minutes: null, perWeek: 2, maxPerWeek: 4, places: ['home'], flexible: true, target: null },
  // queue item 6 (19 Oct, his words): "upper 2×/week heavy ~90 min, Mon PureGym + Sat" — 2× (not 2–3), always heavy;
  // the 90 minutes stay a guess until he says (GUESS_MINUTES); its days are his fixed days (owen_days "upper=mon, sat")
  { key: 'upper', name: 'Upper', type: 'upper', intensity: 'heavy', minutes: null, perWeek: 2, noLighter: true, wants: ['upper_machines', 'cables', 'chest_machines', 'free_weights'], places: ['puregym', 'school_gym'], target: 'Upper' },
]

/** Minutes guessed until he says. */
export const GUESS_MINUTES: Record<string, number> = { speed: 60, heavy_lower: 60, injury: 30, core: 20, stretch: 15, upper: 90 }

export function sessionTypes(planning: unknown): SessionType[] {
  const v = obj(planning).sessionTypes
  if (!Array.isArray(v)) return DEFAULT_SESSIONS
  const out: SessionType[] = []
  const seen = new Set<string>()
  const words = (x: unknown) => (Array.isArray(x) ? x.filter((w): w is string => typeof w === 'string' && KEY.test(w)).slice(0, 20) : undefined)
  for (const raw of v) {
    const s = obj(raw)
    const key = typeof s.key === 'string' && KEY.test(s.key) ? s.key : ''
    const name = typeof s.name === 'string' ? s.name.trim().slice(0, 40) : ''
    const type = typeof s.type === 'string' && KEY.test(s.type) ? s.type : ''
    if (!key || !name || !type || seen.has(key)) continue
    seen.add(key)
    const n = (x: unknown, lo: number, hi: number) => (Number.isInteger(x) && (x as number) >= lo && (x as number) <= hi ? (x as number) : null)
    const perWeek = n(s.perWeek, 0, 14) ?? 1
    const max = n(s.maxPerWeek, perWeek, 14)
    out.push({
      key, name, type, intensity: s.intensity === 'light' || s.intensity === 'moderate' ? s.intensity : 'heavy',
      minutes: n(s.minutes, 5, 240), ...(n(s.extraMinutes, 1, 60) ? { extraMinutes: n(s.extraMinutes, 1, 60)!, extraLabel: typeof s.extraLabel === 'string' ? s.extraLabel.slice(0, 60) : undefined } : {}),
      perWeek, ...(max && max > perWeek ? { maxPerWeek: max } : {}),
      needs: words(s.needs), wants: words(s.wants), places: words(s.places) ?? [],
      owen: s.owen === true, target: typeof s.target === 'string' ? s.target.slice(0, 80) : null, flexible: s.flexible === true, noLower: s.noLower === true,
      stackWith: typeof s.stackWith === 'string' && KEY.test(s.stackWith) ? s.stackWith : null, ...(s.noLighter === true ? { noLighter: true } : {}), ...(s.archived === true ? { archived: true } : {}),
    })
  }
  return out.length ? out : DEFAULT_SESSIONS
}

export const activeSessions = (planning: unknown) => sessionTypes(planning).filter((s) => !s.archived && s.perWeek + (s.maxPerWeek ?? 0) > 0)

/** How long one session takes (the session plus anything done straight after), and whether that's a guess. */
export function sessionMinutes(s: SessionType): { minutes: number; guess: boolean } {
  const base = s.minutes ?? GUESS_MINUTES[s.key] ?? (s.type === 'mobility' ? 15 : s.type === 'core' ? 20 : s.type === 'injury' ? 30 : 60)
  return { minutes: base + (s.extraMinutes ?? 0), guess: s.minutes == null }
}

/** The places a session may use: its own list, filtered to places that have what it needs. */
export function placesFor(s: SessionType, places: TrainingPlace[]): TrainingPlace[] {
  const live = places.filter((p) => !p.archived)
  const listed = s.places.map((k) => live.find((p) => p.key === k)).filter((p): p is TrainingPlace => !!p)
  const pool = listed.length ? listed : live.filter((p) => p.access === 'any')
  return pool.filter((p) => (s.needs ?? []).every((e) => hasEquipment(p, e)))
}

/** Equipment it would like that a place lacks or has only poorly (a worse fit). */
export const missingWants = (s: SessionType, p: TrainingPlace) => (s.wants ?? []).filter((e) => !goodAt(p, e))

// ---------------------------------------------------------------------------
// Owen's days, and Owen's own suggestion to compare against
// ---------------------------------------------------------------------------

/** A session type's weekday(s) (1 = Mon … 7 = Sun). */
export type DayMap = Record<string, number[]>

const dayMap = (raw: unknown): DayMap | null => {
  const o = obj(raw)
  const out: DayMap = {}
  for (const [k, v] of Object.entries(o)) {
    if (!KEY.test(k)) continue
    const list = (Array.isArray(v) ? v : [v]).filter((d): d is number => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7)
    if (list.length) out[k] = [...new Set(list)].sort()
  }
  return Object.keys(out).length ? out : null
}

/** The days he has given Owen, and days he fixed for his own sessions ("upper Mon and Sat"); null = not settled: the
 *  optimiser picks freely. */
export const owenDays = (planning: unknown): DayMap | null => dayMap(obj(planning).owenDays)

/** A start time for a session on a fixed day ("upper Sat 09:30"): session key → weekday ("1"–"7") → "HH:MM". No time =
 *  the usual (straight after school on a school day). */
export type DayTimes = Record<string, Record<string, string>>
export function sessionTimes(planning: unknown): DayTimes {
  const out: DayTimes = {}
  for (const [k, v] of Object.entries(obj(obj(planning).sessionTimes))) {
    if (!KEY.test(k)) continue
    const days = Object.fromEntries(Object.entries(obj(v)).filter(([d, t]) => /^[1-7]$/.test(d) && typeof t === 'string' && HHMM.test(t))) as Record<string, string>
    if (Object.keys(days).length) out[k] = days
  }
  return out
}

/** Owen's current suggestion (11 Oct): only a starting point to compare against, never assumed right. */
export const DEFAULT_OWEN_BASELINE: DayMap = { speed: [2], heavy_lower: [4], injury: [5], core: [6], stretch: [1, 3] }
export const owenBaseline = (planning: unknown): DayMap => dayMap(obj(planning).owenBaseline) ?? DEFAULT_OWEN_BASELINE

export const DAY3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const daysWords = (days: number[]) => days.map((d) => DAY3[d - 1]).join('/')

// ---------------------------------------------------------------------------
// This week's game (usually Sunday, changes every week; sometimes Saturday)
// ---------------------------------------------------------------------------

export type Game = { date: string; leave: string; back: string; guess: boolean; source: 'usual' | 'week' }
type GameWeek = { date?: string; leave?: string; back?: string; none?: boolean }
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** The game in the week starting `weekStart` (a Monday): his answer for that week, else the usual day. null = no game. */
export function gameFor(weekStart: string, planning: unknown): Game | null {
  const weeks = obj(obj(planning).gameWeeks)
  const w = obj(weeks[weekStart]) as GameWeek
  const s = moreSettings(planning)
  if (w.none === true) return null
  if (typeof w.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w.date)) {
    return { date: w.date, leave: HHMM.test(w.leave ?? '') ? w.leave! : s.gameLeave, back: HHMM.test(w.back ?? '') ? w.back! : s.gameBack, guess: false, source: 'week' }
  }
  if (s.gameDay === 'none') return null
  const dow = DAYS_OF_WEEK.indexOf(s.gameDay) + 1
  return { date: addDays(weekStart, dow - 1), leave: s.gameLeave, back: s.gameBack, guess: true, source: 'usual' }
}

/**
 * The game as a calendar-like event (in memory only) for each week in the range, unless his calendar already has a
 * match that week (`hasMatch`: the calendar is the source of truth for events).
 */
export function gameEvents(from: string, to: string, planning: unknown, hasMatch: (weekStart: string) => boolean, testDays: string[] = []): EventRow[] {
  const out: EventRow[] = []
  for (let wk = weekStartISO(from); wk <= to; wk = addDays(wk, 7)) {
    if (hasMatch(wk)) continue
    const g = gameFor(wk, planning)
    if (!g || g.date < from || g.date > to || minutesOf(g.back) <= minutesOf(g.leave)) continue
    // a test that day (the ACT retake on Sun 25 Oct): no game from his usual day; one he says is on that week still counts
    if (g.source === 'usual' && testDays.includes(g.date)) continue
    out.push({
      id: `game:${g.date}`, title: 'Game', category_id: null, subject_id: null, location: null,
      starts_at: zonedToUTC(g.date, g.leave), ends_at: zonedToUTC(g.date, g.back), repeat_days: null, start_time: null, end_time: null, repeat_from: null, repeat_until: null,
      is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, training_type: 'match', load: 'hard', external_source: 'setup', is_school: false, sync_google: false,
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Read-only sessions he wants ignored ("EFA training is over")
// ---------------------------------------------------------------------------

export const ignoredSessions = (planning: unknown): string[] => {
  const v = obj(planning).ignoredSessions
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.slice(0, 120)) : []
}

/** His events without the read-only copies he asked the app to ignore (they stay in Google; the app leaves them out). */
export function liveEvents<T extends { title: string; external_source?: string }>(events: T[], planning: unknown): T[] {
  const ignored = new Set(ignoredSessions(planning).map(norm))
  return ignored.size ? events.filter((e) => e.external_source !== 'google' || !ignored.has(norm(e.title))) : events
}

/** His events as the app plans with them: read-only sessions he asked it to ignore left out, and the week's game
 *  (his usual game day, or this week's answer) added unless his calendar already has a match that week. */
export function planningEvents(events: EventRow[], changes: EventException[], planning: unknown, from: string, to: string, testDays: string[] = []): EventRow[] {
  const live = liveEvents(events, planning)
  const hasMatch = (wk: string) => expandEvents(live, wk, addDays(wk, 6), changes).some((o) => !o.cancelled && o.event.training_type === 'match')
  return [...live, ...gameEvents(from, to, planning, hasMatch, testDays)]
}

// ---------------------------------------------------------------------------
// The shape of a day: wake, morning routine, …, night routine, bed
// ---------------------------------------------------------------------------

export type DayShape = { date: string; wake: string; morningEnd: string; nightStart: string; bed: string; why: string[]; wakeWhy: string | null; bedWhy: string | null; guess: boolean; schoolDay: boolean }

/**
 * Wake and bed for a day: school days use wakeAt, other days weekendWakeAt; a game day wakes in time to leave; the night
 * before a test or a game goes to bed earlier (earlierNightMin). The routines are fixed blocks either side.
 */
export function dayShape(date: string, planning: unknown, ctx: { schoolDay: boolean; testTomorrow: boolean; gameTomorrow: boolean; gameLeave?: string | null }): DayShape {
  const s = moreSettings(planning)
  const o = obj(planning)
  let wakeWhy: string | null = null, bedWhy: string | null = null
  let wake = minutesOf(ctx.schoolDay ? s.wakeAt : s.weekendWakeAt)
  if (ctx.gameLeave) {
    const need = minutesOf(ctx.gameLeave) - s.morningMin - 15
    if (need < wake) { wake = need; wakeWhy = 'up early for the game' }
  }
  let bed = minutesOf(s.bedAt)
  if (ctx.testTomorrow || ctx.gameTomorrow) { bed -= s.earlierNightMin; bedWhy = `${ctx.testTomorrow ? 'test' : 'game'} tomorrow` }
  const guess = !('wakeAt' in o) || !('bedAt' in o) || !('morningMin' in o) || !('nightMin' in o)
  return { date, wake: hm(wake), morningEnd: hm(wake + s.morningMin), nightStart: hm(bed - s.nightMin), bed: hm(bed), why: [wakeWhy, bedWhy ? `earlier night: ${bedWhy}` : null].filter((x): x is string => !!x), wakeWhy, bedWhy, guess, schoolDay: ctx.schoolDay }
}

/**
 * Day shapes for a range of dates from his events and tests (school days, test and game eves). Returns a lookup the
 * free-time code uses to keep the routines and sleep protected (lib/freetime.ts PlanningSettings.dayBounds).
 */
export function shapesFor(planning: unknown, events: EventRow[], changes: EventException[], goals: Pick<Goal, 'kind' | 'target_date'>[], from: string, to: string): Map<string, DayShape> {
  const occ = expandEvents(events, from, addDays(to, 1), changes).filter((o) => !o.cancelled && o.event.is_busy)
  const out = new Map<string, DayShape>()
  const tests = new Set(goals.filter((g) => g.kind === 'test' && g.target_date).map((g) => g.target_date!))
  const gameOn = (d: string) => occ.find((o) => o.date === d && (o.event.training_type === 'match' || o.event.id.startsWith('game:')) && o.start)
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const schoolDay = occ.some((o) => o.date === d && isSchool(o.event))
    const next = addDays(d, 1)
    const game = gameOn(d)
    out.set(d, dayShape(d, planning, { schoolDay, testTomorrow: tests.has(next), gameTomorrow: !!gameOn(next), gameLeave: game?.start ?? null }))
  }
  return out
}

/** The free-time bounds those shapes give each day (lib/freetime.ts PlanningSettings.dayBounds). */
export const boundsOf = (shapes: Map<string, DayShape>) => (d: string) => { const x = shapes.get(d); return x ? { start: x.morningEnd, end: x.nightStart } : null }

/** "Mon 12 Oct" style label helper for lines. */
export const dayWord = (iso: string) => dowShort(iso)

// ---------------------------------------------------------------------------
// For the AI and the cards: the set-up in words (guesses marked)
// ---------------------------------------------------------------------------

const eq = (list: string[]) => list.map((e) => EQUIPMENT[e] ?? e.replace(/_/g, ' ')).join(', ')

export function placeWords(p: TrainingPlace, places: TrainingPlace[] = DEFAULT_PLACES): string {
  const t = (n: number, g: boolean) => `${n} min${g ? ' (guess)' : ''}`
  const s = travelOf(p, 'school', places), h = travelOf(p, 'home', places)
  const homeFromSchool = places.find((x) => x.key === 'home')?.fromSchool ?? null
  const access = p.access === 'school' ? `school days only${p.freePeriods ? ', also in free periods' : ''}` : p.access === 'owen' ? 'Owen’s sessions' : 'any time'
  const parts = [p.access === 'school' ? 'at school' : `from school ${t(s.there, p.fromSchool == null)}`]
  if (p.key !== 'home' && p.access !== 'school') parts.push(`from home ${t(h.there, p.fromHome == null)}`)
  if (p.key !== 'home') parts.push(`back home ${t(s.back, p.toHome == null && (p.access !== 'school' || homeFromSchool == null))}`)
  return `${p.name}${p.address ? ` (${p.address})` : ''}: ${eq(p.equipment.filter((e) => !(p.poor ?? []).includes(e)))}${p.poor?.length ? `; poor: ${eq(p.poor)}` : ''} · ${access} · ${parts.join(', ')}${p.bestAfterSchool ? ' · best straight after school' : ''}`
}

export function sessionWords(s: SessionType, places: TrainingPlace[]): string {
  const m = sessionMinutes(s)
  const where = s.places.map((k) => places.find((p) => p.key === k)?.name ?? k).join(' or ')
  return `${s.name}: ${s.perWeek}${s.maxPerWeek ? `–${s.maxPerWeek}` : ''}× a week, ${m.minutes} min${m.guess ? ' (guess)' : ''}${s.extraLabel ? ` incl. ${s.extraLabel}` : ''}, ${s.intensity}, type ${s.type}${where ? ` at ${where}` : ''}${s.needs?.length ? `; needs ${eq(s.needs)}` : ''}${s.owen ? '; Owen programmes it' : ''}${s.noLighter ? '; never lighter' : ''}${s.target ? `; counts toward ${s.target}` : ''}${s.stackWith ? `; done straight after ${s.stackWith}` : ''}`
}

export function setupForAI(planning: unknown, weekStart: string): string[] {
  const places = activePlaces(planning)
  const owen = owenDays(planning)
  const base = owenBaseline(planning)
  const game = gameFor(weekStart, planning)
  const ignored = ignoredSessions(planning)
  const sessions = activeSessions(planning)
  const name = (k: string) => sessions.find((s) => s.key === k)?.name ?? k
  return [
    'Places he trains (change with setup_set place=…):', ...places.map((p) => `- ${placeWords(p, places)}`),
    'Sessions he needs each week (days are the optimiser’s job; change with setup_set session=…):', ...sessions.map((s) => `- ${sessionWords(s, places)}`),
    `Fixed days (Owen’s sessions and his own; change with owen_days, e.g. "upper=mon, sat 09:30"): ${owen ? Object.entries(owen).map(([k, d]) => `${name(k)} ${d.map((x) => `${DAY3[x - 1]}${sessionTimes(planning)[k]?.[String(x)] ? ` ${sessionTimes(planning)[k][String(x)]}` : ''}`).join('/')}`).join(', ') : 'not settled (ask “which days should I give Owen?”)'}`,
    `Owen’s own suggestion (a starting point only): ${Object.entries(base).map(([k, d]) => `${name(k)} ${daysWords(d)}`).join(', ')}`,
    `Game this week: ${game ? `${dowShort(game.date)} ${game.date}, leave ${game.leave}, back ${game.back}${game.guess ? ' (usual day: a guess until he says)' : ''}` : 'none'} (change with game_week)`,
    `Read-only sessions he has the app ignore: ${ignored.length ? ignored.join(', ') : 'none'} (session_ignore)`,
  ]
}

/** A plan block's title for a session: "Upper @ PureGym Swiss Cottage" (+ " · moderate" when not its usual). */
export const sessionTitle = (name: string, place: string | null) => (place ? `${name} @ ${place}` : name)

/** Back from a block title: the session name and the place (if any). */
export function parseSessionTitle(title: string): { name: string; place: string | null; intensity: Intensity | null } {
  const m = title.match(/^(.*?)(?: @ (.*?))?(?: · (light|moderate|heavy))?$/)
  return { name: (m?.[1] ?? title).trim(), place: m?.[2]?.trim() || null, intensity: (m?.[3] as Intensity | undefined) ?? null }
}

/** Find a place by his words ("puregym", "the school gym"). */
export function findPlace(places: TrainingPlace[], words: string): TrainingPlace | null {
  const w = norm(words).replace(/^(the|my) /, '')
  if (!w) return null
  return places.find((p) => p.key === w.replace(/ /g, '_') || norm(p.name) === w) ?? places.find((p) => norm(p.name).includes(w) || w.includes(norm(p.name)))
    ?? places.find((p) => norm(p.name).split(' ').some((x) => x.length > 3 && w.split(' ').includes(x))) ?? null
}

/** Find a session type by his words ("upper", "heavy lower", "injury prevention", "speed"). */
export function findSession(sessions: SessionType[], words: string): SessionType | null {
  const w = norm(words)
  if (!w) return null
  return sessions.find((s) => s.key === w.replace(/ /g, '_') || norm(s.name) === w)
    ?? sessions.find((s) => norm(s.name).startsWith(w) || w.startsWith(norm(s.name)))
    ?? sessions.find((s) => norm(s.name).split(' ').some((x) => x.length > 3 && w.split(' ').includes(x)))
    ?? sessions.find((s) => s.type === w) ?? null
}
