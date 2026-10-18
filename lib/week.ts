// The week, worked out by plain code (Jarvis phase D2): which training sessions are fixed (events) and which still
// need placing (gym targets), where they go without breaking a rule, and what a change knocks on. Pure: no
// database, no clock, no AI. The AI only picks the study work (lib/telegram/planner.ts).
import { expandEvents, isSchool, type Occurrence } from './events'
import { freeDays, freeSlots, leaveSchool, toHHMM, type PlanningSettings, type Slot } from './freetime'
import { schoolDays } from './school'
import type { Block, Energy } from './plan'
import type { WeekCount } from './targets'
import { costOf, intensityOf, loadOfIntensity, type CostRow, type LoadPlaced, type LoadSession, type LoadSettings, type Pin } from './load'
import { DEFAULT_MORE, daysOf, type MoreSettings } from './settings'
import { DEFAULT_TYPES, ruleProblems, type DayRoom, type Need, type Placed, type Rule, type Session, type TypeDef } from './training'
import { typeOf } from './training-data'
import { withTravel, type TravelWorld } from './travel'
import { addDays, isoDow, minutesOf, weekStartISO } from './time'
import type { EventException, EventRow, TargetLog, WeeklyTarget } from './types'
import { optimise, setupNeeds, type OptPlan, type OptWorld } from './optimiser'
import { activePlaces, activeSessions, findSession, owenBaseline, owenDays, parseSessionTitle, sessionTimes } from './setup'
import type { MentalDay } from './mental'
import { upperWeek } from './setup-edit'

/** A block already in the plan (from plan_blocks). */
export type Planned = { id: string; on_date: string; start_time: string; end_time: string; title: string; kind: string; target_id: string | null; task_id: string | null }

export type WeekWorld = {
  today: string; nowMin: number; from: string; to: string; settings: PlanningSettings
  events: EventRow[]; changes: EventException[]; targets: WeeklyTarget[]; logs: TargetLog[]; weekCounts: WeekCount[]
  rules: Rule[]; energy: Map<string, Energy>; planned: Planned[]
  travel?: TravelWorld | null
  types?: TypeDef[]         // his training types (the defaults if left out)
  trainingFrom?: string     // gym sessions prefer to start from this time
  costs?: CostRow[]         // his recovery costs (load_costs); none = the defaults
  load?: LoadSettings       // his load limits (settings); the defaults if left out
  whoop?: { recovery: number | null; strain: number | null } | null   // today's recovery, yesterday's strain
  tiredWhy?: Map<string, string>   // why a day is a tired day ("Whoop recovery 28%")
  pins?: Map<string, Pin>   // sessions he placed himself on the card
  sent?: { date: string; title: string; start: string; end: string; guessed_time?: boolean }[]   // the week he sent (already in events)
  // Build O: his set-up and rhythm (profiles.planning), each day's 🧠 load, and training blocks he ticked this week
  planning?: unknown
  mental?: MentalDay[]
  done?: { on_date: string; title: string }[]
}

export const datesIn = (from: string, to: string) => { const out: string[] = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out }
const hm = (m: number) => toHHMM(Math.max(0, Math.min(m, 24 * 60 - 1)))

/** Fixed training sessions (events with a training type), a day either side of the range so rules see them. */
export function fixedSessions(w: WeekWorld): Session[] {
  return expandEvents(w.events, addDays(w.from, -1), addDays(w.to, 1), w.changes)
    .filter((o) => !o.cancelled && !o.event.archived_at)
    .flatMap((o) => {
      const t = typeOf(o.event as EventRow & { training_type?: string | null; load?: string | null }, w.types)
      return t ? [{ date: o.date, start: o.start, type: t.type, load: t.load, title: o.event.title, fixed: true, key: `event:${o.key}` }] : []
    })
}

/** The sessions the week still needs (his set-up, minus what's done), as plain needs (lists, old callers). */
export function weekNeeds(w: WeekWorld): Need[] {
  const more = { ...DEFAULT_MORE, ...(w.load ?? {}) } as MoreSettings
  const ow = { ...weekProgress(w), settings: more } as unknown as OptWorld
  return setupNeeds(ow).required.map((n) => ({ key: n.key, title: n.title, type: n.type, load: loadOfIntensity(n.intensity), minutes: n.minutes, preferred: n.preferred ?? null }))
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Friday evening stays free; the Sunday week reset is protected. Cuts a day's free slots for planning. */
export function rhythmCut(date: string, slots: { start: string; end: string }[], more: Pick<MoreSettings, 'fridayFreeFrom' | 'resetAt' | 'resetMin'>): { start: string; end: string }[] {
  const dow = isoDow(date)
  if (dow === 5) return minus(slots, [[minutesOf(more.fridayFreeFrom), 24 * 60]])
  if (dow === 7) return minus(slots, [[minutesOf(more.resetAt), minutesOf(more.resetAt) + more.resetMin]])
  return slots
}

/** The world the optimiser (lib/optimiser.ts) works in: the load world plus places, school days, done sessions, 🧠 load. */
export function optWorldOf(w: WeekWorld, keep: Planned[] = w.planned.filter((b) => b.kind !== 'training')): OptWorld {
  const more = { ...DEFAULT_MORE, ...(w.load ?? {}) } as MoreSettings
  const types = w.types ?? DEFAULT_TYPES
  const tired = new Map<string, string>()
  for (const [d, e] of w.energy) if (e === 'tired') tired.set(d, w.tiredWhy?.get(d) ?? 'you’re tired')
  // school days: when he's free after school (the school block's end, its travel and the buffer)
  // (his leave-school time: "I leave at 16:05")
  const schoolEnd = new Map<string, number>()
  for (const sd of schoolDays(w.events, w.changes, w.from, w.to, w.settings.schoolFreePeriods).values()) schoolEnd.set(sd.date, leaveSchool(sd, w.settings))
  const rooms = trainingRooms(w, keep).map((r) => ({ ...r, slots: rhythmCut(r.date, r.slots, more) }))
  return {
    from: w.from, to: w.to, today: w.today, rooms, fixed: fixedLoad(w), rules: w.rules, settings: more,
    costs: w.costs ?? [], types, heavyUntil: w.settings.heavyUntil, trainingFrom: w.trainingFrom ?? more.trainingFrom,
    tired, whoop: w.whoop ?? null, pins: w.pins,
    mental: new Map((w.mental ?? []).map((m) => [m.date, { total: m.total, high: m.level === 'high', testEve: m.testEve,
      what: m.testEve ? (m.items.find((i) => / tomorrow$/.test(i.what))?.what.replace(/ tomorrow$/, '') ?? 'a test') : m.items.map((i) => i.what).join(', ') }])),
    fridayLight: more.fridayLight === 'yes', weekendUpper: true,
    schoolEnd, maxTravel: more.maxTravelMin, fridayFreeFrom: minutesOf(more.fridayFreeFrom),
    weights: { travel: more.wTravel, poorFit: more.wPoorFit, afterSchool: more.wAfterSchool, upperThird: more.wUpperThird },
    owenDays: owenDays(w.planning), baseline: owenBaseline(w.planning), sessionTimes: sessionTimes(w.planning), ...weekProgress(w),
  }
}

/** His set-up for the week and what's already done: sessions, places, the target each counts toward, sessions done this
 *  week (ticked blocks, target logs, or a calendar session of that kind) and the days sessions already have. */
export function weekProgress(w: WeekWorld) {
  const sessions = activeSessions(w.planning), places = activePlaces(w.planning)
  // what's done this week: ticked training blocks, logs for the target a session counts toward, and calendar
  // sessions of the same kind (an Owen session in his calendar is this week's speed session)
  const weekStart = weekStartISO(w.from), weekEnd = addDays(weekStart, 6)
  const targetIds = new Map<string, string>()
  for (const s of sessions) {
    const t = s.target ? w.targets.find((x) => x.is_active !== false && norm(x.name) === norm(s.target!)) : null
    if (t) targetIds.set(s.key, t.id)
  }
  const done = new Map<string, number>()
  const ticked = new Map<string, number>()
  for (const b of w.done ?? []) { const s = findSession(sessions, parseSessionTitle(b.title).name); if (s) ticked.set(s.key, (ticked.get(s.key) ?? 0) + 1) }
  for (const s of sessions) {
    const t = targetIds.get(s.key)
    const logs = t ? w.logs.filter((l) => l.target_id === t && l.done_on >= weekStart && l.done_on <= weekEnd).reduce((a, l) => a + l.amount, 0) : 0
    const cal = ['sprint', 'lower', 'upper', 'injury', 'core'].includes(s.type)
      ? fixedLoad(w).filter((f) => f.type === s.type && f.date >= weekStart && f.date <= weekEnd).length : 0
    const n = Math.max(logs, ticked.get(s.key) ?? 0) + cal
    if (n) done.set(s.key, n)
  }
  // the days sessions already had in the plan (kept where that costs nothing)
  const preferred = new Map<string, string[]>()
  for (const b of w.planned.filter((x) => x.kind === 'training' && x.on_date >= w.today).sort((a, b2) => a.on_date.localeCompare(b2.on_date))) {
    const s = findSession(sessions, parseSessionTitle(b.title).name)
    if (s) preferred.set(s.key, [...(preferred.get(s.key) ?? []), b.on_date])
  }
  return { sessions, places, done, targetIds, preferred }
}

/** Free time for training each day: real free slots, minus planned study blocks; none when ill (tired: light only, weighed in lib/load.ts). */
export function trainingRooms(w: WeekWorld, keep: Planned[]): DayRoom[] {
  const days = freeDays(w.events, w.changes, w.from, w.to, w.settings, w.today, w.nowMin, w.travel ?? null)
  // days with no extra training ("nothing extra on Wednesday")
  const off = daysOf({ ...DEFAULT_MORE, ...(w.load ?? {}) }.noTrainingDays)
  return days.filter((d) => d.date >= w.today && w.energy.get(d.date) !== 'ill' && !off.includes(isoDow(d.date))).map((d) => ({
    date: d.date,
    slots: minus(d.slots, keep.filter((b) => b.on_date === d.date).map((b) => [minutesOf(b.start_time), minutesOf(b.end_time) + w.settings.bufferMin])),
  }))
}

/** Free slots with some intervals taken out. */
export function minus(slots: { start: string; end: string }[], cuts: [number, number][]): { start: string; end: string }[] {
  let out = slots.map((s) => [minutesOf(s.start), minutesOf(s.end)] as [number, number])
  for (const [a, b] of cuts) out = out.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y] as [number, number]] : [[x, Math.min(a, y)] as [number, number], [Math.max(b, x), y] as [number, number]].filter(([p, q]) => q - p >= 15)))
  return out.map(([x, y]) => ({ start: hm(x), end: hm(y) }))
}

/** The load settings in use (his, else the defaults). */
const loadSettingsOf = (w: WeekWorld): LoadSettings => w.load ?? DEFAULT_MORE

/** Fixed sessions with their recovery cost, three days either side so limits and rest days see them. */
export function fixedLoad(w: WeekWorld): LoadSession[] {
  const types = w.types ?? DEFAULT_TYPES
  const occ = expandEvents(w.events, addDays(w.from, -3), addDays(w.to, 3), w.changes)
  // a read-only session that comes every week with "game" in its name (school Games) isn't his game: until he says
  // what it is, it counts as football (moderate); the week's game comes from his set-up (lib/setup.ts gameEvents)
  // (counted over a month either side: one week only ever has one copy)
  const weekly = new Set<string>()
  const seen = new Map<string, number>()
  for (const o of expandEvents(w.events.filter((e) => e.external_source === 'google'), addDays(w.from, -28), addDays(w.to, 28), w.changes)) {
    const k = `${norm(o.event.title)}|${isoDow(o.date)}|${o.start}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
    if (seen.get(k)! >= 2) weekly.add(norm(o.event.title))
  }
  const list = occ
    .filter((o) => !o.cancelled && !o.event.archived_at && o.start)
    .flatMap((o) => {
      let t = typeOf(o.event as EventRow & { training_type?: string | null; load?: string | null }, types)
      if (t?.type === 'match' && !o.event.training_type && (o.event.repeat_days?.length || weekly.has(norm(o.event.title)))) t = { type: 'football', load: 'moderate' }
      if (!t) return []
      const intensity = intensityOf(t.load)
      return [{ key: `event:${o.key}`, title: o.event.title, type: t.type, intensity, date: o.date, start: o.start!, end: o.end ?? o.start!, fixed: true,
        cost: costOf({ title: o.event.title, type: t.type, intensity, date: o.date }, w.costs ?? [], types, loadSettingsOf(w)) }]
    })
  // one session split over back-to-back lessons (school Games: three periods) counts once
  const out: LoadSession[] = []
  for (const s of list.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))) {
    const prev = out.findLast((x) => x.date === s.date && norm(x.title) === norm(s.title))
    if (prev && minutesOf(s.start) - minutesOf(prev.end) <= 10 && minutesOf(s.start) >= minutesOf(prev.start)) { if (s.end > prev.end) prev.end = s.end; continue }
    out.push(s)
  }
  return out
}

/** Where the week's training goes: the optimiser over his set-up (lib/optimiser.ts), the one planner every card uses. */
export function planTraining(w: WeekWorld, opts: { only?: string[] | null; pins?: Map<string, Pin>; upperCount?: number | null; compare?: boolean; exclude?: string[] } = {}): OptPlan {
  const study = w.planned.filter((b) => b.kind !== 'training')
  // his own choice of uppers for this week ("upper 3x this week"), unless the card says otherwise
  const upperCount = opts.upperCount ?? upperWeek(w.planning, weekStartISO(w.from))
  return optimise(optWorldOf(w, study), { ...opts, upperCount, pins: opts.pins ?? w.pins })
}

/** Where the week's training goes (as Placed: what the rest of the week code uses). */
export function placeTraining(w: WeekWorld): { placed: (Placed & Pick<LoadPlaced, 'intensity' | 'why' | 'place' | 'label' | 'before' | 'after' | 'from' | 'targetId'>)[]; tbc: { title: string; reason: string }[]; plan: OptPlan } {
  const plan = planTraining(w)
  return { plan, placed: plan.placed.map((p) => ({ key: p.key, title: p.title, type: p.type, load: p.intensity === 'heavy' ? 'hard' : p.intensity, date: p.date, start: p.start, end: p.end, intensity: p.intensity, why: p.why,
    place: p.place, label: p.label, before: p.before, after: p.after, from: p.from, targetId: p.targetId })), tbc: plan.tbc }
}

/** Each day's free time for study once training is placed (what the planner and the placement then use). */
export function studySlots(w: WeekWorld, training: { date: string; start: string; end: string; before?: number; after?: number }[]): Map<string, Slot[]> {
  const out = new Map<string, Slot[]>()
  const heavy = minutesOf(w.settings.heavyUntil)
  const more = { ...DEFAULT_MORE, ...(w.load ?? {}) } as MoreSettings
  // school free periods count for study (never for training)
  for (const d of freeDays(w.events, w.changes, w.from, w.to, w.settings, w.today, w.nowMin, w.travel ?? null, { freePeriods: true })) {
    if (d.date < w.today) continue
    // training takes its travel there and back too; Friday evening and the Sunday reset stay free
    const cut = minus(rhythmCut(d.date, d.slots, more), training.filter((t) => t.date === d.date).map((t) => [minutesOf(t.start) - ((t as { before?: number }).before ?? 0), minutesOf(t.end) + ((t as { after?: number }).after ?? 0) + w.settings.bufferMin]))
    out.set(d.date, cut.map((s) => ({ ...s, minutes: minutesOf(s.end) - minutesOf(s.start), heavyMinutes: Math.max(0, Math.min(minutesOf(s.end), heavy) - minutesOf(s.start)) })))
  }
  return out
}

// ---------------------------------------------------------------------------
// What a change knocks on
// ---------------------------------------------------------------------------

export type Move = { blockId: string; title: string; from: string; to: Block & { date: string } | null; reason: string }
export type Ripple = { moves: Move[]; warnings: string[]; tbc: string[] }
const dayName = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '')

/**
 * Compare the plan as it is with the week after the change: gym sessions that now break a rule or lost their time
 * move (each with the reason), study blocks the change lands on move later that day (or drop out), and any rule a
 * fixed session now breaks is a warning. Nothing about the plan changes unless he applies the card.
 */
export function ripple(before: WeekWorld, after: WeekWorld): Ripple {
  const moves: Move[] = []
  const warnings: string[] = []
  // only what hasn't started yet can move
  const planned = before.planned.filter((b) => b.on_date > before.today || (b.on_date === before.today && minutesOf(b.start_time) > before.nowMin))
  const training = planned.filter((b) => b.kind === 'training')
  const study = planned.filter((b) => b.kind !== 'training')

  // 1. training sessions, re-placed around the new week (each matched to its session type by name)
  const placedAfter = placeTraining({ ...after, planned })
  const sessions = activeSessions(after.planning)
  const sessionOf = (title: string, targetId: string | null) => findSession(sessions, parseSessionTitle(title).name)?.key ?? targetId ?? norm(title)
  const fixedAfter = fixedSessions(after)
  const freeAfter = (date: string) => freeSlots(withTravel(expandEvents(after.events, date, date, after.changes), after.travel ?? null), date, after.settings, date === after.today ? after.nowMin : null, 0)
  const bySession = new Map<string, (typeof placedAfter.placed)[number][]>()
  for (const p of placedAfter.placed) { const k = placedAfter.plan.sessionOf[p.key] || sessionOf(p.title, p.targetId ?? null); bySession.set(k, [...(bySession.get(k) ?? []), p]) }
  const used = new Map<string, number>()
  // left at its old time while the plan has it elsewhere that day (checked below: it mustn't sit on one that moved)
  const kept: { b: (typeof training)[number]; now: (typeof placedAfter.placed)[number]; title: string }[] = []
  const usualOf = (k: string) => (sessions.find((x) => x.key === k)?.intensity ?? 'heavy') as string
  const titleOf = (b: (typeof training)[number], now: (typeof placedAfter.placed)[number] | null, usual: string) =>
    now ? `${now.label ? `${parseSessionTitle(b.title).name} @ ${now.label}` : parseSessionTitle(b.title).name}${now.intensity !== usual ? ` · ${now.intensity}` : ''}` : b.title
  for (const b of [...training].sort((x, y) => (x.on_date + x.start_time).localeCompare(y.on_date + y.start_time))) {
    const k = sessionOf(b.title, b.target_id)
    const list = bySession.get(k) ?? []
    const i = used.get(k) ?? 0
    used.set(k, i + 1)
    const now = list[i] ?? null
    // the same slot but a different intensity (a low-Whoop day: go light) is a change too
    const usual = usualOf(k)
    const was = parseSessionTitle(b.title).intensity ?? usual
    const lighter = !!now && now.intensity !== was
    if (now && now.date === b.on_date && now.start === b.start_time && !lighter) continue
    // why it has to move
    const asWas: Session = { date: b.on_date, start: b.start_time, type: now?.type ?? 'gym', load: now?.load ?? 'hard', title: b.title, fixed: false, key: b.id }
    const broken = ruleProblems([...fixedAfter, asWas], after.rules).find((p) => p.keys.includes(b.id))
    const stillFree = freeAfter(b.on_date).some((s) => minutesOf(s.start) <= minutesOf(b.start_time) && minutesOf(b.end_time) <= minutesOf(s.end))
    // only the time shuffled: leave it
    if (now && now.date === b.on_date && stillFree && !broken && !lighter) { kept.push({ b, now, title: titleOf(b, now, usual) }); continue }
    // a flexible unit (stretching) only moves when it has to
    if (sessions.find((x) => x.key === k)?.flexible && stillFree && !broken) { if (now) kept.push({ b, now, title: titleOf(b, now, usual) }); continue }
    const reason = broken ? broken.rule : !stillFree ? 'its time is busy now' : lighter && now!.date === b.on_date ? `${now!.intensity} today: ${now!.why}` : 'the week changed'
    const title = titleOf(b, now, usual)
    moves.push({ blockId: b.id, title: b.title, from: `${dayName(b.on_date)} ${b.start_time}`, to: now ? { date: now.date, start: now.start, end: now.end, title, kind: 'training', ref: b.target_id ? { kind: 'target', id: b.target_id } : null } : null, reason })
  }

  // a session left at its old time that a moved one now sits on takes its new time too (and so on)
  const buffer = after.settings.bufferMin
  const onTop = (date: string, start: string, end: string) => moves.some((m) => m.to && m.to.date === date && minutesOf(m.to.start) < minutesOf(end) + buffer && minutesOf(start) < minutesOf(m.to.end) + buffer)
  for (let again = true; again;) {
    again = false
    for (let i = kept.length - 1; i >= 0; i--) {
      const { b, now, title } = kept[i]
      if (!onTop(b.on_date, b.start_time, b.end_time)) continue
      kept.splice(i, 1)
      again = true
      moves.push({ blockId: b.id, title: b.title, from: `${dayName(b.on_date)} ${b.start_time}`, to: { date: now.date, start: now.start, end: now.end, title, kind: 'training', ref: b.target_id ? { kind: 'target', id: b.target_id } : null }, reason: 'to make room' })
    }
  }

  // 2. study blocks the change now sits on (busy in his calendar, or a session moved onto it)
  const movedTo = moves.filter((m) => m.to).map((m) => m.to!)
  for (const b of study) {
    const free = freeAfter(b.on_date)
    if (free.some((s) => minutesOf(s.start) <= minutesOf(b.start_time) && minutesOf(b.end_time) <= minutesOf(s.end)) && !onTop(b.on_date, b.start_time, b.end_time)) continue
    const len = minutesOf(b.end_time) - minutesOf(b.start_time)
    const others = [...study.filter((x) => x !== b && x.on_date === b.on_date && !moves.some((m) => m.blockId === x.id)), ...training.filter((x) => x.on_date === b.on_date && !moves.some((m) => m.blockId === x.id))]
      .map((x) => [minutesOf(x.start_time), minutesOf(x.end_time) + after.settings.bufferMin] as [number, number])
    const extra = movedTo.filter((t) => t.date === b.on_date).map((t) => [minutesOf(t.start), minutesOf(t.end) + after.settings.bufferMin] as [number, number])
    const room = minus(free, [...others, ...extra])
    const heavyEnd = minutesOf(after.settings.heavyUntil)
    const heavy = b.kind === 'focus'
    const slot = room.find((s) => Math.min(minutesOf(s.end), heavy ? heavyEnd : 24 * 60) - minutesOf(s.start) >= len)
    const to = slot ? { date: b.on_date, start: slot.start, end: hm(minutesOf(slot.start) + len), title: b.title, kind: b.kind as Block['kind'], ref: b.task_id ? { kind: 'task', id: b.task_id } : null } : null
    moves.push({ blockId: b.id, title: b.title, from: `${dayName(b.on_date)} ${b.start_time}`, to, reason: 'something is booked then now' })
    if (to) movedTo.push(to)
  }

  // 3. rules two fixed sessions now break (the app can't move those: he decides)
  const key = (p: { text: string }) => p.text
  const beforeFixed = new Set(ruleProblems(fixedSessions(before), before.rules).map(key))
  for (const p of ruleProblems(fixedAfter, after.rules)) if (!beforeFixed.has(key(p))) warnings.push(`${p.text} (${p.rule})`)

  return { moves, warnings, tbc: placedAfter.tbc.filter((t) => training.some((b) => parseSessionTitle(b.title).name === t.title)).map((t) => t.title) }
}

/** Is a session (after the change) on top of another busy event that day? Returns that event's occurrence. */
export function overlapOf(events: EventRow[], changes: EventException[], eventId: string, date: string, start: string, end: string): Occurrence | null {
  const s = minutesOf(start), e = minutesOf(end)
  return expandEvents(events, date, date, changes).find((o) => o.date === date && o.event.id !== eventId && !o.cancelled && o.event.is_busy && o.start
    && minutesOf(o.start) < e && minutesOf(o.end ?? o.start) > s) ?? null
}

/** The nearest free start that day for something `len` minutes long, closest to `wanted` (the session itself left out). */
export function nearestFree(events: EventRow[], changes: EventException[], eventId: string, date: string, wanted: string, len: number, s: PlanningSettings): string | null {
  const slots = freeSlots(expandEvents(events.filter((e) => e.id !== eventId), date, date, changes), date, s, null, len)
  let best: number | null = null
  for (const x of slots) {
    const a = minutesOf(x.start), b = minutesOf(x.end) - len
    if (b < a) continue
    const w = minutesOf(wanted)
    const at = Math.max(a, Math.min(b, w))
    if (best === null || Math.abs(at - w) < Math.abs(best - w)) best = at
  }
  return best === null ? null : hm(best)
}
