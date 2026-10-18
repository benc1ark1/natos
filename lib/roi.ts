// Time savings and better returns (Build O part 6), worked out by plain code from the optimiser's week: a shorter
// version of a long session, a nearer gym when the kit fits, stacking two home sessions, fewer uppers in a test-heavy
// week. Each says the time saved a week and the trade-off; applying one is a normal checked change (his set-up, or
// this week's upper count) with Undo. Also where his week's time goes: school, study, training, travel, routines, free.
// Pure: no database, no clock.
import { expandEvents, isSchool } from './events'
import type { OptPlan, OptWorld } from './optimiser'
import { EQUIPMENT, findSession, hasEquipment, missingWants, parseSessionTitle, sessionMinutes, travelOf, type DayShape } from './setup'
import { dowShort, minutesOf } from './time'
import type { MentalDay } from './mental'
import type { EventException, EventRow } from './types'

/** A suggestion: what to change (a set-up change in chat words, or this week's upper count), what it saves, the catch. */
export type Suggestion = {
  key: string; title: string; short: string; savesMin: number; tradeoff: string
  change: { op: 'setup_set'; value: string } | { op: 'upper_week'; count: number }
}

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5)

export function suggest(w: OptWorld, plan: OptPlan, mental: MentalDay[]): Suggestion[] {
  const out: Suggestion[] = []
  const placed = plan.placed
  const count = (key: string) => placed.filter((p) => plan.sessionOf[p.key] === key).length

  // 1. a long session in a shorter version (upper: supersets, fewer accessories)
  const upper = w.sessions.find((s) => s.key === 'upper')
  if (upper && count('upper')) {
    const m = sessionMinutes(upper).minutes
    const short = round5(Math.max(40, m * 0.67))
    if (m >= 60 && m - short >= 10) {
      const saves = (m - short) * count('upper')
      out.push({ key: `short:upper:${short}`, savesMin: saves, title: `Upper is ${m} min${upper.minutes == null ? ' (guess)' : ''}. A ${short} min version (supersets, cut the low-value accessories) keeps about 90% of the benefit and saves ${saves} min this week.`,
        short: `Upper in ${short} min instead of ${m}: saves ${saves} min a week`, tradeoff: 'a little less volume on accessories', change: { op: 'setup_set', value: `session=upper; minutes=${short}` } })
    }
  }

  // 2. a nearer place when the kit fits (PureGym → the school gym straight after school)
  for (const p of placed.filter((x) => x.place && x.from === 'school')) {
    const s = w.sessions.find((x) => x.key === plan.sessionOf[p.key])
    if (!s) continue
    const here = w.places.find((x) => x.key === p.place)
    for (const alt of w.places.filter((x) => x.key !== p.place && !x.archived && (s.places.includes(x.key)) && (s.needs ?? []).every((e) => hasEquipment(x, e)))) {
      if (alt.access !== 'school' && alt.key !== 'home') continue
      if (!here) continue
      const now = travelOf(here, 'school', w.places), then = travelOf(alt, 'school', w.places)
      const saves = now.there + now.back - (then.there + then.back)
      if (saves < 15) continue
      const lacks = missingWants(s, alt)
      out.push({ key: `place:${s.key}:${alt.key}:${p.date}`, savesMin: saves,
        title: `Train at the ${alt.name.toLowerCase().replace(/^the /, '')} on ${dowShort(p.date)} instead of ${here.name}: saves ${saves} min of travel, and the kit fits${s.needs?.length ? ` (${s.needs.map((e) => EQUIPMENT[e] ?? e).join(', ')})` : ''}.`,
        short: `${s.name} at the ${alt.name.toLowerCase()} (${dowShort(p.date)}): saves ${saves} min travel`,
        tradeoff: lacks.length ? `fewer ${lacks.map((e) => EQUIPMENT[e] ?? e).join(', ')}${s.type === 'upper' ? ': make it a chest, cables and free-weight day' : ''}` : 'none',
        change: { op: 'setup_set', value: `session=${s.key}; places=${[alt.name, ...s.places.filter((k) => k !== alt.key).map((k) => w.places.find((x) => x.key === k)?.name ?? k)].join(', ')}` } })
      break
    }
  }

  // 3. two home sessions on different days → one (core straight after injury prevention)
  const core = w.sessions.find((s) => s.key === 'core'), inj = w.sessions.find((s) => s.key === 'injury')
  const coreAt = placed.find((p) => plan.sessionOf[p.key] === 'core'), injAt = placed.find((p) => plan.sessionOf[p.key] === 'injury')
  if (core && inj && !core.stackWith && coreAt && injAt && coreAt.date !== injAt.date) {
    out.push({ key: 'stack:core:injury', savesMin: 10, title: `Stack core onto injury prevention: one home session instead of two (one warm-up, ~10 min saved) and ${dowShort(coreAt.date)} gets lighter.`,
      short: 'Core straight after injury prevention: saves ~10 min and a day', tradeoff: 'a slightly longer session that day', change: { op: 'setup_set', value: 'session=core; stack=Injury prevention' } })
  }

  // 4. a test-heavy week: one upper fewer
  const highs = mental.filter((m) => m.level === 'high' || m.test)
  if (plan.upper && plan.upper.count >= 3 && highs.length >= 2 && upper) {
    const m = sessionMinutes(upper).minutes
    out.push({ key: 'upper2:test-week', savesMin: m, title: `Test-heavy week (${highs.map((h) => dowShort(h.date)).join(', ')}), so drop to upper 2×: saves ${m} min.`,
      short: `Upper 2× this test-heavy week: saves ${m} min`, tradeoff: 'one upper session fewer this week only', change: { op: 'upper_week', count: 2 } })
  }
  return out.sort((a, b) => b.savesMin - a.savesMin || a.key.localeCompare(b.key))
}

// ---------------------------------------------------------------------------
// Where the week's time goes
// ---------------------------------------------------------------------------

export type TimeSplit = { school: number; study: number; training: number; travel: number; routines: number; free: number }

/** Minutes this week: school, planned study, training (sessions and fixed ones), travel, routines, and what's left free. */
export function timeSplit(x: { from: string; to: string; events: EventRow[]; changes: EventException[]; blocks: { on_date: string; start_time: string; end_time: string; kind: string; title: string }[]
  plan: OptPlan | null; shapes: Map<string, DayShape>; sessions: OptWorld['sessions']; places: OptWorld['places']; isTraining: (e: EventRow) => boolean }): TimeSplit {
  const out: TimeSplit = { school: 0, study: 0, training: 0, travel: 0, routines: 0, free: 0 }
  let awake = 0
  for (let d = x.from; d <= x.to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    const s = x.shapes.get(d)
    if (s) { awake += minutesOf(s.bed) - minutesOf(s.wake); out.routines += minutesOf(s.morningEnd) - minutesOf(s.wake) + minutesOf(s.bed) - minutesOf(s.nightStart) }
    else awake += 16 * 60
  }
  for (const o of expandEvents(x.events, x.from, x.to, x.changes).filter((y) => !y.cancelled && y.start && y.end && y.event.is_busy)) {
    const len = Math.max(0, minutesOf(o.end!) - minutesOf(o.start!))
    if (isSchool(o.event)) out.school += len
    else if (x.isTraining(o.event)) out.training += len
    out.travel += 2 * (o.event.travel_minutes ?? 0)
  }
  // school copies of lessons overlap the school day: count the school day once (the longest per day)
  const blocks = x.blocks.filter((b) => b.on_date >= x.from && b.on_date <= x.to)
  for (const b of blocks) {
    const len = minutesOf(b.end_time.slice(0, 5)) - minutesOf(b.start_time.slice(0, 5))
    if (b.kind === 'training') {
      out.training += len
      const p = parseSessionTitle(b.title).place
      const pl = p ? x.places.find((y) => y.name === p) : null
      if (pl && pl.key !== 'home') { const t = travelOf(pl, 'home', x.places); out.travel += t.there + t.back }
    } else out.study += len
  }
  if (!blocks.some((b) => b.kind === 'training') && x.plan) {
    for (const p of x.plan.placed) { out.training += minutesOf(p.end) - minutesOf(p.start); out.travel += (p.before ?? 0) + (p.after ?? 0) }
  }
  out.free = Math.max(0, awake - out.school - out.study - out.training - out.travel - out.routines)
  void findSession
  return out
}

export const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
