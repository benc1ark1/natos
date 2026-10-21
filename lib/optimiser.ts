// The week optimiser (Build O). It turns his set-up (lib/setup.ts: the sessions he needs, where he can train, travel)
// into needs for the load planner (lib/load.ts planLoad), which searches day × time × place × intensity for every
// session and scores each week on recovery per body area, the days around the game, daily and 7-day load, the 🧠 load
// of each day (no hard training on high days or test eves), travel and equipment fit, the Friday rule, routines and
// sleep (free time already stops at the night routine) and Whoop. Upper 2× or 3× is decided by trying both: 3× only
// when it fits without hurting heavy lower and speed. Stretching units go in afterwards, where it's easy. Every rule is
// a weighted guideline (his optimiser weights), never a hard block. Pure and deterministic: no database, no clock, no AI.
import { addDays, daysBetween, dowShort, isoDow, minutesOf } from './time'
import { assess, costOf, dayLoads, loadOfIntensity, planLoad, weightsOf, type DayLoad, type LoadNeed, type LoadPlaced, type LoadPlan, type LoadSession, type LoadWorld, type Pin, type Where } from './load'
import { loadRank } from './training'
import {
  DAY3, daysWords, hm, missingWants, placesFor, sessionMinutes, travelOf, EQUIPMENT,
  type DayMap, type DayTimes, type SessionType, type TrainingPlace,
} from './setup'

/** Everything the optimiser needs beyond the load world. */
export type OptWorld = LoadWorld & {
  sessions: SessionType[]; places: TrainingPlace[]
  schoolEnd: Map<string, number>          // school days: the minute he's free after school (buffer included)
  maxTravel: number                       // longest trip each way (minutes)
  fridayFreeFrom: number | null           // Friday evening kept free from (minute of day)
  weights: { travel: number; poorFit: number; afterSchool: number; upperThird: number }
  owenDays: DayMap | null; baseline: DayMap
  sessionTimes?: DayTimes                 // a start time on a fixed day ("upper Sat 09:30")
  done: Map<string, number>               // sessions of each type already done this week
  targetIds?: Map<string, string>         // session type → the weekly target it counts toward
  preferred?: Map<string, string[]>       // session type → the days it already has in the plan (kept where that costs nothing)
  holiday?: boolean                       // a holiday week: sessions that can only happen at school are off
  testDays?: Map<string, string>          // his test days (no training at all): date → the test
}

export type OptPlan = LoadPlan & {
  upper: { count: number; reason: string } | null
  compare: string | null                  // vs Owen's current days
  needs: LoadNeed[]                       // what was placed (for 🔁 and re-fits)
  sessionOf: Record<string, string>       // need key → session type key
}

const DAY_MIN = 24 * 60
const PREFER = 2   // the bonus for the place a session lists first
const day = (iso: string) => dowShort(iso)

// ---------------------------------------------------------------------------
// Needs: the sessions still to do this week, from his set-up
// ---------------------------------------------------------------------------

/** The week's needs: required ones, plus optional extras (a 3rd upper) with what leaving them out costs. */
export function setupNeeds(w: OptWorld, only?: string[] | null): { required: LoadNeed[]; optional: LoadNeed[] } {
  const W = weightsOf(w.settings)
  const required: LoadNeed[] = [], optional: LoadNeed[] = []
  // in the holidays a session that can only happen at school (the school gym) is off: not needed, not "not placed"
  const atSchoolOnly = (s: SessionType) => { const ps = placesFor(s, w.places); return ps.length > 0 && ps.every((p) => p.access === 'school') }
  const live = w.sessions.filter((s) => !s.archived && !s.flexible && (!only || only.includes(s.key)) && !(w.holiday && atSchoolOnly(s)))
  // a session done straight after another one ("stack core onto injury prevention") is one session
  const stacked = new Map<string, SessionType[]>()
  for (const s of live) if (s.stackWith && live.some((x) => x.key === s.stackWith)) stacked.set(s.stackWith, [...(stacked.get(s.stackWith) ?? []), s])
  for (const s of live) {
    if (s.stackWith && live.some((x) => x.key === s.stackWith)) continue
    const extra = stacked.get(s.key) ?? []
    const done = w.done.get(s.key) ?? 0
    const need = Math.max(0, s.perWeek - done)
    const more = Math.max(0, (s.maxPerWeek ?? s.perWeek) - Math.max(s.perWeek, done))
    const minutes = sessionMinutes(s).minutes + extra.reduce((a, x) => a + sessionMinutes(x).minutes, 0)
    const title = [s.name, ...extra.map((x) => x.name)].join(' + ')
    const base = { title, type: s.type, intensity: s.intensity, minutes, session: s.key, targetId: w.targetIds?.get(s.key) ?? null, ...(s.noLighter ? { noLighter: true } : {}) }
    const had = w.preferred?.get(s.key) ?? []
    for (let i = 1; i <= need; i++) required.push({ key: `${s.key}#${i}`, ...base, preferred: had[i - 1] ?? null })
    for (let i = need + 1; i <= need + more; i++) optional.push({ key: `${s.key}#${i}`, ...base, preferred: had[i - 1] ?? null, skipCost: W.tbc })
  }
  return { required, optional }
}

/** Owen's days: each of his sessions on that weekday this week (if it hasn't passed). */
export function owenPins(w: OptWorld, needs: LoadNeed[], days: DayMap | null): Map<string, Pin> {
  const pins = new Map<string, Pin>()
  if (!days) return pins
  for (const [session, dows] of Object.entries(days)) {
    const list = needs.filter((n) => n.session === session)
    const dates = dows.map((d) => { for (let x = w.from; x <= w.to; x = addDays(x, 1)) if (isoDow(x) === d) return x; return null }).filter((d): d is string => !!d && d >= w.today)
    list.forEach((n, i) => { if (dates[i]) pins.set(n.key, { date: dates[i], start: w.sessionTimes?.[session]?.[String(isoDow(dates[i]!))] ?? null }) })
  }
  return pins
}

/** The days he gave Owen, as a strong preference (another day costs OWEN_MOVE): never forced onto a day with no room.
 *  Queue item 6: Owen's days are fixed (Owen comes then; his sessions vary), so moving one of Owen's sessions costs
 *  OWEN_FIXED (more than going lighter: the session goes lighter on its day rather than moving), and leaving it out
 *  costs 3× a normal session. Nat's own fixed days ("upper Mon + Sat") cost OWEN_MOVE to move and 1.5× to leave out:
 *  less than Owen's, so in a busy week his own session gives way first. */
const OWEN_MOVE = 25
const OWEN_FIXED = 80
function withOwenDays(needs: LoadNeed[], pins: Map<string, Pin>, w: Pick<OptWorld, 'sessions' | 'settings'>, required: boolean): LoadNeed[] {
  const tbc = weightsOf(w.settings).tbc
  return needs.map((n) => {
    if (!pins.has(n.key)) return n
    const owen = !!w.sessions.find((s) => s.key === n.session)?.owen
    return { ...n, preferred: pins.get(n.key)!.date, preferStart: pins.get(n.key)!.start ?? null, preferCost: owen ? OWEN_FIXED : OWEN_MOVE,
      ...(required && n.skipCost == null ? { skipCost: (owen ? 3 : 1.5) * tbc } : {}) }
  })
}

/** Two worked upper sessions closer than his upper recovery time: one is left out (never placed < 48 h apart) — the one
 *  moved off its fixed day if there is one (his Saturday 09:30 stays), else the later one. */
function spaceUppers(plan: LoadPlan, w: OptWorld, pins: Map<string, Pin>, needs: LoadNeed[]): LoadPlan {
  const hours = w.settings.upperRecoveryH
  const at = (s: { date: string; start: string }) => Date.parse(`${s.date}T00:00:00Z`) / 3_600_000 + minutesOf(s.start) / 60
  const worked = [...w.fixed.filter((s) => s.cost.upper >= w.settings.areaHeavy), ...plan.placed.filter((s) => s.type === 'upper' && s.cost.upper >= w.settings.areaHeavy)]
    .sort((a, b) => at(a) - at(b))
  const drop = new Set<string>()
  const free = (x: (typeof worked)[number]) => !x.fixed && !pins.get(x.key)?.date
  const moved = (x: (typeof worked)[number]) => { const p = needs.find((n) => n.key === x.key)?.preferred; return !!p && p !== x.date }
  let prev: (typeof worked)[number] | null = null
  for (const s of worked) {
    if (prev && at(s) - at(prev) < hours && (free(s) || free(prev))) {
      if (free(prev) && (!free(s) || (moved(prev) && !moved(s)))) { drop.add(prev.key); prev = s } else drop.add(s.key)
      continue
    }
    prev = s
  }
  if (!drop.size) return plan
  return {
    ...plan,
    placed: plan.placed.filter((s) => !drop.has(s.key)),
    tbc: [...plan.tbc, ...plan.placed.filter((s) => drop.has(s.key)).map((s) => ({ key: s.key, title: s.title, reason: `upper body needs ${hours} h between sessions, and no other day fits this week` }))],
  }
}

// ---------------------------------------------------------------------------
// Where a session can happen on a day: places, travel, the after-school window, Friday evening
// ---------------------------------------------------------------------------

export function whereOptions(w: OptWorld, n: LoadNeed, date: string): Where[] {
  const s = w.sessions.find((x) => x.key === n.session)
  if (!s) return [{ place: null, label: null, from: null, before: 0, after: 0, minStart: 0, maxStart: null, maxEnd: DAY_MIN, extra: 0, why: '', guess: false }]
  const end = w.schoolEnd.get(date) ?? null
  const home = w.places.find((p) => p.key === 'home') ?? null
  const walkHome = end != null && home ? travelOf(home, 'school', w.places).there : 0
  const homeArrive = end != null ? end + walkHome : null
  const fri = isoDow(date) === 5 && w.fridayFreeFrom != null
  const out: Where[] = []
  for (const p of placesFor(s, w.places)) {
    if (p.access === 'school' && end == null) continue   // the school gym: school days only
    const froms: ('school' | 'home')[] = end == null ? ['home'] : p.access === 'school' ? ['school'] : ['school', 'home']
    for (const from of froms) {
      const t = travelOf(p, from, w.places)
      if (p.key !== 'home' && (t.there > w.maxTravel || t.back > w.maxTravel)) continue
      // travel it adds: going home after school happens anyway
      const travel = Math.max(0, t.there + t.back - (from === 'school' ? walkHome : 0))
      const missing = missingWants(s, p)
      // the place listed first is the one he prefers (upper: PureGym), straight after school is best for some
      const bonus = (from === 'school' && p.bestAfterSchool ? w.weights.afterSchool : 0) + (s.places[0] === p.key && s.places.length > 1 ? PREFER : 0)
      const extra = Math.max(0, (travel / 10) * w.weights.travel + missing.length * w.weights.poorFit - bonus)
      const minStart = from === 'school' ? end! + t.there : homeArrive != null ? homeArrive + (p.key === 'home' ? 0 : t.there) : 0
      const maxStart = from === 'school' ? minStart + (p.key === 'home' ? 30 : 20) : null   // straight after school means straight after
      const maxEnd = fri ? w.fridayFreeFrom! - t.back : DAY_MIN
      const trip = p.key === 'home' ? 'home'
        : p.access === 'school' ? `${p.name}, no travel after school`
        : `${p.name}${from === 'school' ? ' straight after school' : ''} (${t.there} min there, ${t.back} back)`
      const why = [trip, missing.length ? `fewer ${missing.map((e) => EQUIPMENT[e] ?? e).join(', ')}${s.type === 'upper' ? ': a chest/cables/free-weight day' : ''}` : '', t.guess && p.key !== 'home' ? 'travel is a guess' : ''].filter(Boolean).join('; ')
      out.push({ place: p.key, label: p.name, from, before: t.there, after: t.back, minStart, maxStart, maxEnd, extra: Math.round(extra * 10) / 10, why, guess: t.guess })
    }
  }
  return out.sort((a, b) => a.extra - b.extra)
}

// ---------------------------------------------------------------------------
// The optimiser
// ---------------------------------------------------------------------------

/** What a plan costs heavy lower and speed (their own problems, going lighter, being left out): kept from getting worse. */
function quality(p: LoadPlan, w: OptWorld, needs: LoadNeed[]): number {
  const W = weightsOf(w.settings)
  const keys = new Set(needs.filter((n) => ['lower', 'sprint', 'plyo'].includes(n.type)).map((n) => n.key))
  const placed = p.placed.filter((x) => keys.has(x.key))
  const { issues } = assess([...w.fixed, ...p.placed], w)
  const own = issues.filter((i) => i.keys.some((k) => keys.has(k))).reduce((a, i) => a + i.weight, 0)
  const lighter = placed.reduce((a, x) => a + (loadRank(loadOfIntensity(x.wanted)) - loadRank(loadOfIntensity(x.intensity))) * W.lighter * 3, 0)
  return own + lighter + p.tbc.filter((t) => keys.has(t.key)).length * W.tbc
}

/**
 * The best week. `only`: just these session types (the rest stay as they are). `pins`: sessions he placed himself.
 * `upperCount`: force 2 or 3 uppers (his choice) instead of deciding.
 */
export function optimise(w: OptWorld, opts: { only?: string[] | null; pins?: Map<string, Pin>; upperCount?: number | null; compare?: boolean; exclude?: string[] } = {}): OptPlan {
  const out = new Set(opts.exclude ?? [])   // sessions he left out this week (🔁 → Leave it out)
  const all = setupNeeds(w, opts.only)
  const owen = owenPins(w, [...all.required, ...all.optional], w.owenDays)
  const required = withOwenDays(all.required.filter((n) => !out.has(n.key)), owen, w, true), optional = withOwenDays(all.optional.filter((n) => !out.has(n.key)), owen, w, false)
  const pins = new Map(opts.pins ?? new Map())
  const world: LoadWorld = { ...w, pins, where: (n, d) => whereOptions(w, n, d) }
  const run = (needs: LoadNeed[], p = pins) => planLoad(needs, { ...world, pins: p })

  let chosen: LoadPlan, needs: LoadNeed[], upper: OptPlan['upper'] = null
  const extraUpper = optional.filter((n) => n.type === 'upper')
  // other optional extras are placed only when they cost less than they're worth
  const base = [...required, ...optional.filter((n) => n.type !== 'upper').map((n) => ({ ...n, skipCost: w.weights.upperThird }))]
  const doneU = w.done.get('upper') ?? 0
  const hasUpper = required.some((n) => n.type === 'upper') || extraUpper.length > 0
  const asRequired = (list: LoadNeed[]) => list.map(({ skipCost: _s, ...n }) => n)
  if (opts.upperCount != null) {
    const reqU = required.filter((n) => n.type === 'upper')
    const wanted = Math.max(0, opts.upperCount - reqU.length - doneU)
    // his choice ("upper 3× until 1 Nov") can be more than his set-up's usual number: more of the same session
    const template = extraUpper[0] ?? reqU[0]
    const more = template ? Array.from({ length: Math.max(0, wanted - extraUpper.length) }, (_, i) => ({ ...template, key: `${template.session}#x${i + 1}`, preferred: null })) : []
    needs = [...base, ...asRequired([...extraUpper, ...more].slice(0, wanted))]
    chosen = run(needs)
    const count = chosen.placed.filter((x) => x.type === 'upper').length + doneU
    if (hasUpper) upper = { count, reason: `${count}× (your choice)` }
  } else if (extraUpper.length) {
    const two = run(base)
    const threeNeeds = [...base, ...asRequired(extraUpper)]
    const three = run(threeNeeds)
    const placedThird = extraUpper.every((n) => three.placed.some((x) => x.key === n.key))
    const q2 = quality(two, w, base), q3 = quality(three, w, threeNeeds)
    const ok = placedThird && q3 <= q2 + 0.5 && three.cost - two.cost <= w.weights.upperThird
    const n2 = two.placed.filter((x) => x.type === 'upper').length + doneU, n3 = n2 + extraUpper.length
    const nth = n3 === 3 ? '3rd' : 'further'
    let reason: string
    if (ok) reason = `${n3}× this week: the ${nth} session fits without hurting heavy lower or speed`
    else if (!placedThird) reason = `${n2}× this week: no good slot for a ${nth} upper`
    else if (q3 > q2 + 0.5) {
      const keys = new Set(threeNeeds.filter((n) => ['lower', 'sprint', 'plyo'].includes(n.type)).map((n) => n.key))
      const had = new Set(assess([...w.fixed, ...two.placed], w).issues.map((i) => i.text))
      const hit = assess([...w.fixed, ...three.placed], w).issues.filter((i) => i.keys.some((k) => keys.has(k)) && !had.has(i.text)).sort((a, b) => b.weight - a.weight)[0]
      // a session the 3rd upper makes lighter than it is with two
      const lighter = three.placed.find((x) => keys.has(x.key) && x.intensity !== (two.placed.find((y) => y.key === x.key)?.intensity ?? x.wanted))
      reason = `${n2}× this week: a ${nth} upper would ${lighter ? `make ${lighter.title} ${lighter.intensity}` : `hurt heavy lower or speed: ${hit?.text ?? 'recovery'}`}`
    } else {
      const third = three.placed.find((x) => extraUpper.some((n) => n.key === x.key))
      const hit = third ? assess([...w.fixed, ...three.placed], w).issues.filter((i) => i.keys.includes(third.key)).sort((a, b) => b.weight - a.weight)[0] : null
      const trip = third && third.label && (third.before ?? 0) + (third.after ?? 0) > 0 ? `a ${(third.before ?? 0) + (third.after ?? 0)}-min round trip to ${third.label}` : null
      reason = `${n2}× this week: a ${nth} upper costs more than it’s worth${hit ? `: ${hit.text}` : trip ? `: ${trip}` : ''}`
    }
    chosen = ok ? three : two
    needs = ok ? threeNeeds : base
    upper = { count: ok ? n3 : n2, reason }
  } else {
    needs = base
    chosen = run(needs)
    const u = chosen.placed.filter((x) => x.type === 'upper').length + doneU
    if (hasUpper) upper = { count: u, reason: `${u}× (your set-up)` }
  }

  // Owen's current days as a starting point: the search can miss them. When they score better (and he hasn't pinned
  // anything himself), they're the plan.
  const alt = opts.compare !== false ? baselinePlan(w, needs, world) : null
  if (alt && !pins.size && alt.cost < chosen.cost - 1) chosen = alt
  chosen = spaceUppers(chosen, w, pins, needs)
  // his choice ("upper 3×"): an upper the spacing took out is tried again on each day (the others may move to keep
  // 48 h between them: the cheapest week that keeps it); football, Owen's days and his fixed sessions stay as they are
  if (opts.upperCount != null) {
    const isUpper = (x: { type: string }) => x.type === 'upper'
    for (let tries = 0; tries < 3 && chosen.placed.filter(isUpper).length + doneU < opts.upperCount; tries++) {
      const have = chosen.placed.filter(isUpper)
      const missing = needs.find((n) => isUpper(n) && !have.some((x) => x.key === n.key))
      if (!missing) break
      let best: LoadPlan | null = null
      for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
        if (d < w.today) continue
        const p = new Map(pins).set(missing.key, { date: d, start: null })
        const r = spaceUppers(run(needs, p), w, p, needs)
        if (r.placed.some((x) => x.key === missing.key) && r.placed.filter(isUpper).length > have.length && (!best || r.cost < best.cost)) best = r
      }
      if (!best) break
      chosen = best
    }
  }
  if (upper) {
    const count = chosen.placed.filter((x) => x.type === 'upper').length + (w.done.get('upper') ?? 0)
    // his choice that the week can't fit: say how many and why (never "3×" when 2 are planned)
    const short = opts.upperCount != null && count < opts.upperCount
    // a test in the week takes its day (and the heavy day before it): said, so the shortfall makes sense
    const tests = [...(w.testDays ?? [])].filter(([d]) => d >= w.today && d <= w.to).map(([d, what]) => `${day(d)} (${what})`)
    const why = `${tests.length ? `no training on ${tests.join(', ')} and only light the day before; ` : ''}upper body needs ${w.settings.upperRecoveryH} h between sessions, and no other day fits`
    upper = { ...upper, count, reason: short ? `${count}× this week (you asked for ${opts.upperCount}×): ${why}` : opts.upperCount != null ? `${count}× (your choice)` : upper.reason.replace(/^\d+× \(your set-up\)$/, `${count}× (your set-up)`) }
  }
  // stretching and other flexible units: where it's easy, after everything else
  const flexible = flexibleUnits(w, chosen, opts.only ?? null)
  const placed = [...chosen.placed, ...flexible].sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
  const plan: OptPlan = {
    ...chosen, placed, days: dayLoads([...w.fixed, ...placed], w),
    // only what he needs counts as left out (an optional extra that didn't fit isn't news)
    tbc: chosen.tbc.filter((t) => required.some((n) => n.key === t.key)),
    upper, compare: null,
    needs: [...needs, ...flexible.map((f) => ({ key: f.key, title: f.title, type: f.type, intensity: f.wanted, minutes: minutesOf(f.end) - minutesOf(f.start), session: f.key.split('#')[0] }))],
    sessionOf: Object.fromEntries([...needs.map((n) => [n.key, n.session ?? '']), ...flexible.map((f) => [f.key, f.key.split('#')[0]])]),
  }
  if (opts.compare !== false) plan.compare = compareBaseline(w, plan, needs, alt)
  return plan
}

/** What Owen does now: the days he and Nat agreed (saved), else his own suggestion. */
const currentOwen = (w: OptWorld): DayMap => w.owenDays ?? w.baseline

/** The week with Owen's current days as near-musts (a day with no room puts it elsewhere rather than on top of something). */
function baselinePlan(w: OptWorld, needs: LoadNeed[], world: LoadWorld): LoadPlan | null {
  if (!needs.some((n) => w.sessions.find((s) => s.key === n.session)?.owen)) return null
  const basePins = owenPins(w, needs, currentOwen(w))
  if (!basePins.size) return null
  return planLoad(needs.map((n) => (basePins.has(n.key) ? { ...n, preferred: basePins.get(n.key)!.date, preferCost: 200 } : n)), world)
}

/** Stretching (and any other flexible type): its weekly minimum on the easiest days, more where there's plenty of room. */
function flexibleUnits(w: OptWorld, plan: LoadPlan, only: string[] | null): LoadPlaced[] {
  const out: LoadPlaced[] = []
  const flex = w.sessions.filter((s) => !s.archived && s.flexible && (!only || only.includes(s.key)))
  const rooms = new Map(w.rooms.map((r) => [r.date, r]))
  const busy = (date: string) => [...plan.placed, ...out].filter((x) => x.date === date).map((x) => [minutesOf(x.start) - (x.before ?? 0), minutesOf(x.end) + (x.after ?? 0) + 10] as [number, number])
  const freeParts = (date: string) => {
    let parts = (rooms.get(date)?.slots ?? []).map((s) => [minutesOf(s.start), minutesOf(s.end)] as [number, number])
    for (const [a, b] of busy(date)) parts = parts.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y] as [number, number]] : [[x, Math.min(a, y)], [Math.max(b, x), y]] as [number, number][]).filter(([p, q]) => q - p >= 10))
    return parts
  }
  const loadOf = (date: string) => dayLoads([...w.fixed, ...plan.placed, ...out], w).find((d) => d.date === date)?.total ?? 0
  for (const s of flex) {
    const m = sessionMinutes(s).minutes
    const done = w.done.get(s.key) ?? 0
    const want = Math.max(0, s.perWeek - done), most = Math.max(want, (s.maxPerWeek ?? s.perWeek) - done)
    const prefer = new Set(w.baseline[s.key] ?? [])
    for (let i = 0; i < most; i++) {
      const days = w.rooms.map((r) => r.date).filter((d) => d >= w.today && !out.some((x) => x.date === d && x.key.startsWith(`${s.key}#`)))
      const scored = days.map((d) => {
        const parts = freeParts(d)
        // after an evening session at home, else the latest gap that fits (wind-down), else nothing
        const home = plan.placed.find((x) => x.date === d && x.place === 'home')
        let at: number | null = null, stacked = false
        if (home) { const after = minutesOf(home.end) + 10; if (parts.some(([a, b]) => a <= after && after + m <= b)) { at = after; stacked = true } }
        if (at == null) { const p = [...parts].reverse().find(([a, b]) => b - a >= m); if (p) at = Math.max(p[0], p[1] - m - 30 >= p[0] ? p[1] - m - 30 : p[0]) }
        const room = parts.reduce((a, [x, y]) => a + y - x, 0)
        return { d, at, score: loadOf(d) - (prefer.has(isoDow(d)) ? 3 : 0) - (stacked ? 4 : 0), room, home: stacked ? home : null }
      }).filter((x) => x.at != null).sort((a, b) => a.score - b.score || a.d.localeCompare(b.d))
      const pick = i < want ? scored[0] : scored.find((x) => x.room >= 120)   // the extras only where it's easy
      if (!pick) break
      const date = pick.d, start = pick.at!
      out.push({
        key: `${s.key}#${i + 1}`, title: s.name, type: s.type, intensity: s.intensity, date, start: hm(start), end: hm(start + m), fixed: false,
        cost: costOf({ title: s.name, type: s.type, intensity: s.intensity, date }, w.costs, w.types, w.settings), place: 'home', label: 'Home', from: 'home', before: 0, after: 0,
        whereWhy: pick.home ? `straight after ${pick.home.title}` : 'an easy gap at home', targetId: w.targetIds?.get(s.key) ?? null, wanted: s.intensity,
        why: `${i < want ? 'easiest day' : 'plenty of room that day'}: ${pick.home ? `after ${pick.home.title} at home` : 'an easy gap at home'}`,
      })
    }
  }
  return out
}

/** "vs Owen's current days: better because …" (his own suggestion, placed the same way, scored the same way). */
function compareBaseline(w: OptWorld, plan: OptPlan, needs: LoadNeed[], alt: LoadPlan | null): string | null {
  const base = currentOwen(w)
  const basePins = owenPins(w, needs, base)
  if (!alt || !basePins.size) return null
  // already on Owen's days?
  const same = [...basePins].every(([k, p]) => plan.placed.find((x) => x.key === k)?.date === p.date)
  const nameOf = (k: string) => w.sessions.find((s) => s.key === k)!.name.replace(/ \+.*$/, '').toLowerCase()
  const words = Object.entries(base).filter(([k]) => w.sessions.some((s) => s.key === k && s.owen)).sort((a, b) => (a[1][0] ?? 0) - (b[1][0] ?? 0)).map(([k, d]) => `${nameOf(k)} ${daysWords(d)}`).join(', ')
  if (same) return `Same days as Owen’s current days (${words}).`
  // which of his sessions land on other days
  const moved = [...basePins].map(([k, p]) => ({ k, p, now: plan.placed.find((x) => x.key === k) })).filter((x) => x.now && x.now.date !== x.p.date)
    .map((x) => `${nameOf(plan.sessionOf[x.k] || x.k.split('#')[0])} ${DAY3[isoDow(x.now!.date) - 1]} not ${DAY3[isoDow(x.p.date!) - 1]}`)
  const mine = assess([...w.fixed, ...plan.placed], w).issues
  const theirs = assess([...w.fixed, ...alt.placed], w).issues
  const diff = Math.round((alt.cost - (plan.cost)) * 10) / 10
  const only = theirs.filter((i) => !mine.some((m) => m.text === i.text)).sort((a, b) => b.weight - a.weight)[0]
  const lighter = alt.placed.filter((x) => x.intensity !== x.wanted).map((x) => `${x.title} ${x.intensity}`)
  if (diff < -1) return `Owen’s current days (${words}) would be a little easier this week; this plan keeps the changes you asked for.`
  if (diff <= 1) return `About as good as Owen’s current days (${words}).`
  const because = only?.text ?? (lighter.length ? `${lighter[0]} instead of heavy` : alt.tbc.length ? `${alt.tbc[0].title} wouldn’t fit` : 'more load and travel overall')
  return `Better than Owen’s current days (${words})${moved.length ? `: ${moved.join(', ')}` : ''}. His days would mean ${because}.`
}

// ---------------------------------------------------------------------------
// Why this day and not another ("why is lower on Thursday?")
// ---------------------------------------------------------------------------

/** For one placed session: what each other day would cost (the rest kept as they are), with the main reason. */
export function whyNot(w: OptWorld, plan: OptPlan, key: string): { date: string; delta: number; reason: string }[] {
  const s = plan.placed.find((x) => x.key === key)
  if (!s) return []
  const n = plan.needs.find((x) => x.key === key)
  const now = assess([...w.fixed, ...plan.placed], w).cost
  const out: { date: string; delta: number; reason: string }[] = []
  for (let d = w.from < w.today ? w.today : w.from; d <= w.to; d = addDays(d, 1)) {
    if (d === s.date) continue
    const room = w.rooms.find((r) => r.date === d)
    const wh = n ? whereOptions(w, n, d)[0] : null
    if (!room?.slots.length || (n && !wh)) { out.push({ date: d, delta: Infinity, reason: 'no free time' }); continue }
    const moved: LoadSession = { ...s, date: d, cost: costOf({ title: s.title, type: s.type, intensity: s.intensity, date: d }, w.costs, w.types, w.settings) }
    const after = assess([...w.fixed, ...plan.placed.map((x) => (x.key === key ? moved : x))], w)
    const top = after.issues.filter((i) => i.keys.includes(key)).sort((a, b) => b.weight - a.weight)[0]
    out.push({ date: d, delta: Math.round((after.cost - now + (wh?.extra ?? 0)) * 10) / 10, reason: top?.text ?? (wh?.why || 'about the same') })
  }
  return out.sort((a, b) => a.delta - b.delta)
}

/** Each session's day as words for Owen: "speed Tue, heavy lower Thu, …". */
export const owenWords = (plan: OptPlan, sessions: SessionType[]) => sessions.filter((s) => s.owen).map((s) => {
  const days = plan.placed.filter((x) => plan.sessionOf[x.key] === s.key).map((x) => DAY3[isoDow(x.date) - 1])
  return days.length ? `${s.name} ${days.join('/')}` : null
}).filter(Boolean) as string[]

export type { DayLoad }
