// Load-based training planning (Build 2 phase N). Every session has a recovery cost: legs, upper body and CNS, 0–10
// each, from its type and intensity (light / moderate / heavy), or his own number for that type or that session
// ("Wednesday training is high CNS", "games are max load": load_costs). The week's flexible sessions (gym targets) are
// placed to keep each day and any 7 days under his limits, avoid high-CNS days back to back, protect the days around
// games, give legs and upper body their recovery time, go easy on a low-Whoop day, and weigh his training rules as
// guidelines. Nothing is a hard block: every choice has a cost, the cheapest week wins, and each session says why.
// Pure: no database, no clock, no AI. Limits are settings (lib/settings.ts); costs are data.
import { addDays, dowShort, isoDow, minutesOf } from './time'
import { activeTypes, guessType, loadRank, ruleProblems, type DayRoom, type Load, type Rule, type Session, type TrainingType, type TypeDef } from './training'
import { daysOf, type MoreSettings } from './settings'

export type Intensity = 'light' | 'moderate' | 'heavy'
export const INTENSITIES: Intensity[] = ['light', 'moderate', 'heavy']
export const intensityOf = (load: string | null | undefined): Intensity => (load === 'light' ? 'light' : load === 'moderate' ? 'moderate' : 'heavy')
export const loadOfIntensity = (i: Intensity): Load => (i === 'heavy' ? 'hard' : i)

export type Cost = { legs: number; upper: number; cns: number }
export const total = (c: Cost) => c.legs + c.upper + c.cns

/** A type's cost at heavy, until he changes it (light and moderate are a % of it: settings lightPct / moderatePct). */
export const DEFAULT_COSTS: Record<string, Cost> = {
  match: { legs: 10, upper: 3, cns: 10 },   // game day is max load (his brief, 11 Oct)
  sprint: { legs: 7, upper: 1, cns: 9 },
  lower: { legs: 9, upper: 1, cns: 6 },
  plyo: { legs: 7, upper: 0, cns: 9 },
  upper: { legs: 1, upper: 9, cns: 5 },
  football: { legs: 7, upper: 1, cns: 7 },
  gym: { legs: 5, upper: 5, cns: 5 },
  injury: { legs: 6, upper: 0, cns: 3 },
  core: { legs: 0, upper: 3, cns: 2 },
  mobility: { legs: 1, upper: 1, cns: 0 },
  other: { legs: 2, upper: 2, cns: 1 },
}
const FALLBACK: Cost = { legs: 4, upper: 4, cns: 4 }

/** One of his costs (load_costs): a type's at heavy, or one session's (by name, and weekday if he said one). */
export type CostRow = { id?: string; scope: 'type' | 'session'; type_key: string | null; title: string | null; weekday: number | null; legs: number; upper: number; cns: number }

export type LoadSettings = Pick<MoreSettings, 'lightPct' | 'moderatePct' | 'dayMedLoad' | 'dayHighLoad' | 'dayMaxLoad' | 'weekMaxLoad' | 'cnsHigh'
  | 'cnsBaseline'
  | 'areaHeavy' | 'legsRecoveryH' | 'upperRecoveryH' | 'gameDaysBefore' | 'gameDaysAfter' | 'gameEveMax' | 'highStrain' | 'lowRecovery'>
  & Partial<Pick<MoreSettings, 'wLighter' | 'wGame' | 'wArea' | 'wCnsRow' | 'wTired' | 'wLeaveOut' | 'wAvoid' | 'wPrefer' | 'wSameDay' | 'wMental' | 'wFriday' | 'wWeekendUpper'>>

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const r1 = (n: number) => Math.round(n * 10) / 10

/** A type's cost at heavy: his, else the default. */
export function typeCost(type: string, costs: CostRow[]): Cost {
  const own = costs.find((c) => c.scope === 'type' && c.type_key === type)
  return own ? { legs: own.legs, upper: own.upper, cns: own.cns } : DEFAULT_COSTS[type] ?? FALLBACK
}

/** The types a name mentions ("Lower + plyo" = lower and plyo). */
function typesInName(title: string, types: TypeDef[]): string[] {
  const words = ` ${norm(title)} `
  return activeTypes(types).filter((t) => t.words.some((w) => words.includes(` ${norm(w)}`))).map((t) => t.key)
}

/** His own cost for this session (by name; a weekday one wins on that day). */
export function sessionOverride(title: string, date: string, costs: CostRow[]): CostRow | null {
  const n = norm(title), dow = isoDow(date)
  const mine = costs.filter((c) => c.scope === 'session' && c.title && norm(c.title) === n)
  return mine.find((c) => c.weekday === dow) ?? mine.find((c) => c.weekday == null) ?? null
}

/** What a session costs: his number for it, else its type (and any other type its name mentions) scaled by intensity. */
export function costOf(s: { title: string; type: TrainingType; intensity: Intensity; date: string }, costs: CostRow[], types: TypeDef[], ls: Pick<LoadSettings, 'lightPct' | 'moderatePct'>): Cost {
  const own = sessionOverride(s.title, s.date, costs)
  if (own) return { legs: own.legs, upper: own.upper, cns: own.cns }
  const keys = [...new Set([s.type, ...typesInName(s.title, types)])].filter((k) => k !== 'other' || k === s.type)
  const base = keys.map((k) => typeCost(k, costs)).reduce((a, b) => ({ legs: Math.max(a.legs, b.legs), upper: Math.max(a.upper, b.upper), cns: Math.max(a.cns, b.cns) }))
  const f = s.intensity === 'heavy' ? 1 : (s.intensity === 'moderate' ? ls.moderatePct : ls.lightPct) / 100
  return { legs: r1(base.legs * f), upper: r1(base.upper * f), cns: r1(base.cns * f) }
}

/** "high CNS" / "max" / "low legs" → a number (0–10). */
export function levelWord(w: string): number | null {
  const v = w.trim().toLowerCase()
  if (/^\d+(\.\d+)?$/.test(v)) { const n = Number(v); return n >= 0 && n <= 10 ? Math.round(n) : null }
  if (/^(max|maximum|very high)$/.test(v)) return 10
  if (/^(high|hard|heavy)$/.test(v)) return 8
  if (/^(med|medium|moderate|mid)$/.test(v)) return 5
  if (/^(low|light|easy)$/.test(v)) return 2
  if (/^(none|zero|no)$/.test(v)) return 0
  return null
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

/**
 * Where a session can happen on a day (Build O): the place, coming from school or home, the travel there and back
 * (minutes), the earliest / latest start and the latest end, and what the choice costs (travel, a worse fit) with
 * the reason in words. No `where` = no travel (the planner before places).
 */
export type Where = { place: string | null; label: string | null; from: 'home' | 'school' | null; before: number; after: number
  minStart: number; maxStart: number | null; maxEnd: number; extra: number; why: string; guess: boolean }
/** A session in the week with its cost: fixed (calendar, his sent week) or placed by the planner (with where it is). */
export type LoadSession = { key: string; title: string; type: TrainingType; intensity: Intensity; date: string; start: string; end: string; fixed: boolean; cost: Cost
  place?: string | null; label?: string | null; from?: 'home' | 'school' | null; before?: number; after?: number; whereWhy?: string; guess?: boolean }
/**
 * A flexible session to place: its usual intensity, how long, and the day it already had (if any). skipCost: what
 * leaving it out costs (a 3rd upper or extra stretching less than a must). session: the session type's key.
 */
export type LoadNeed = { key: string; title: string; type: TrainingType; intensity: Intensity; minutes: number; preferred?: string | null; targetId?: string | null
  session?: string; skipCost?: number; preferCost?: number      // preferCost: what another day than `preferred` costs (Owen's days: a lot)
  preferStart?: string | null; noLighter?: boolean }            // preferStart: the time on its fixed day; noLighter: never lighter
/** He chose this himself (✏️ / 🔁 on the card): that day (and time / intensity / place, if given) is used as it is. */
export type Pin = { date: string | null; start?: string | null; intensity?: Intensity | null; place?: string | null }

export type LoadWorld = {
  from: string; to: string; today: string
  rooms: DayRoom[]                      // free time for training per day
  fixed: LoadSession[]                  // a few days either side of the range too, so limits see them
  rules: Rule[]
  settings: LoadSettings
  costs: CostRow[]; types: TypeDef[]
  heavyUntil: string; trainingFrom: string
  tired?: Map<string, string>           // a day he's tired (or low Whoop recovery): only light work
  whoop?: { recovery: number | null; strain: number | null } | null   // today's recovery, yesterday's strain
  pins?: Map<string, Pin>
  // Build O (lib/optimiser.ts): places and travel, the 🧠 load of each day, the Friday rule, one weekend upper
  where?: (n: LoadNeed, date: string) => Where[]
  mental?: Map<string, { total: number; high: boolean; testEve: boolean; what: string }>
  fridayLight?: boolean
  weekendUpper?: boolean
}

export type Issue = { text: string; keys: string[]; weight: number }
export type DayLoad = { date: string; total: number; cns: number; level: 'rest' | 'low' | 'med' | 'high'; sessions: { title: string; intensity: Intensity; fixed: boolean }[] }
export type LoadPlaced = LoadSession & { targetId?: string | null; why: string; wanted: Intensity }
export type LoadPlan = { placed: LoadPlaced[]; tbc: { key: string; title: string; reason: string }[]; days: DayLoad[]; notes: string[]; cost: number }

/** Sessions whose quality comes first: going lighter costs three times as much. */
export const KEY_TYPES = new Set(['lower', 'sprint', 'plyo'])

/** What each problem costs when a week is scored (his optimiser weights; Settings → Optimiser weights). */
export const weightsOf = (ls: Partial<LoadSettings>) => ({
  tbc: ls.wLeaveOut ?? 40, avoid: ls.wAvoid ?? 15, prefer: ls.wPrefer ?? 4, lighter: ls.wLighter ?? 5, moved: 2, early: 1, sameDay: ls.wSameDay ?? 3,
  game: ls.wGame ?? 15, area: ls.wArea ?? 10, cnsRow: ls.wCnsRow ?? 12, tired: ls.wTired ?? 20, mental: ls.wMental ?? 12, friday: ls.wFriday ?? 15, weekendUpper: ls.wWeekendUpper ?? 3,
})
const day = (iso: string) => dowShort(iso)
const hoursBetween = (a: { date: string; start: string }, b: { date: string; start: string }) =>
  ((Date.parse(`${b.date}T00:00:00Z`) - Date.parse(`${a.date}T00:00:00Z`)) / 60_000 + minutesOf(b.start) - minutesOf(a.start)) / 60
const isGame = (s: LoadSession) => s.type === 'match'

/** One of the days he said are high-CNS every week (no warning about them). */
const baseline = (ls: Partial<Pick<LoadSettings, 'cnsBaseline'>>, date: string) => daysOf(ls.cnsBaseline).includes(isoDow(date))

/** Today's daily limit: lower after a big Whoop strain yesterday or on low recovery. */
function dayCap(w: LoadWorld, date: string): number {
  const ls = w.settings
  if (date !== w.today || !w.whoop) return ls.dayMaxLoad
  const low = w.whoop.recovery != null && w.whoop.recovery < ls.lowRecovery
  const strained = w.whoop.strain != null && w.whoop.strain > ls.highStrain
  return low ? Math.round(ls.dayMaxLoad * 0.5) : strained ? Math.round(ls.dayMaxLoad * 0.75) : ls.dayMaxLoad
}

/** Everything the week costs (lower is better), with each problem in words. */
export function assess(sessions: LoadSession[], w: LoadWorld): { cost: number; issues: Issue[] } {
  const ls = w.settings
  const W = weightsOf(ls)
  const issues: Issue[] = []
  const add = (weight: number, text: string, keys: string[]) => { if (weight > 0) issues.push({ text, keys, weight }) }
  const byDay = new Map<string, LoadSession[]>()
  for (const s of sessions) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s])
  const sum = (list: LoadSession[], f: (c: Cost) => number) => list.reduce((a, s) => a + f(s.cost), 0)

  for (const [date, list] of byDay) {
    // a day over its limit
    const t = sum(list, total), cap = dayCap(w, date)
    if (date >= w.from && date <= w.to && t > cap) add(2 * (t - cap), `${day(date)} is over its load limit (${Math.round(t)}/${cap})`, list.filter((s) => !s.fixed).map((s) => s.key))
    // two worked sessions on one day (separate days where possible)
    const flex = list.filter((s) => !s.fixed && s.intensity !== 'light')
    if (flex.length > 1 || (flex.length === 1 && list.some((s) => s.fixed && s.intensity !== 'light'))) add(W.sameDay, `two non-light sessions on ${day(date)}`, flex.map((s) => s.key))
    // a tired / low-recovery day: only light work
    const why = w.tired?.get(date)
    if (why) for (const s of list.filter((x) => !x.fixed && x.intensity !== 'light')) add(W.tired, `${why} on ${day(date)}: keep it light`, [s.key])
    // a high-🧠 day or the eve of a test: no hard training (moderate counts half)
    const m = w.mental?.get(date)
    if (m && (m.high || m.testEve)) for (const s of list.filter((x) => !x.fixed && x.intensity !== 'light')) {
      add(s.intensity === 'heavy' ? W.mental : W.mental / 2, `${m.testEve ? `the eve of ${m.what}` : `a high-🧠 day (${m.what})`} on ${day(date)}`, [s.key])
    }
    // Friday: only light training (the evening stays free)
    if (w.fridayLight && isoDow(date) === 5) for (const s of list.filter((x) => !x.fixed && x.intensity !== 'light')) add(W.friday, `Friday: keep training light`, [s.key])
  }
  // any 7 days over the limit: the worst stretch counts once (overlapping windows would count the same load again)
  const dates = [...byDay.keys()].sort()
  if (dates.length) {
    let worst: { over: number; t: number; end: string; keys: string[] } | null = null
    for (let start = addDays(w.from, -6); start <= w.to; start = addDays(start, 1)) {
      const end = addDays(start, 6)
      const list = sessions.filter((s) => s.date >= start && s.date <= end)
      const t = sum(list, total)
      if (t > ls.weekMaxLoad && list.some((s) => !s.fixed) && (!worst || t - ls.weekMaxLoad > worst.over)) worst = { over: t - ls.weekMaxLoad, t, end, keys: list.filter((s) => !s.fixed).map((s) => s.key) }
    }
    if (worst) add(worst.over, `the 7 days to ${day(worst.end)} are over the load limit (${Math.round(worst.t)}/${ls.weekMaxLoad})`, worst.keys)
  }
  // high-CNS days back to back
  for (const d of dates) {
    const next = addDays(d, 1)
    const a = byDay.get(d)!, b = byDay.get(next)
    if (!b || sum(a, (c) => c.cns) < ls.cnsHigh || sum(b, (c) => c.cns) < ls.cnsHigh) continue
    if (baseline(ls, d) && baseline(ls, next)) continue   // his fixed high-CNS days (e.g. Tue + Wed): his baseline
    const flex = [...a, ...b].filter((s) => !s.fixed).map((s) => s.key)
    if (flex.length) add(W.cnsRow, `high-CNS days back to back (${day(d)} and ${day(next)})`, flex)
  }
  // the days around a game
  for (const g of sessions.filter(isGame)) {
    for (const s of sessions.filter((x) => !x.fixed && !isGame(x))) {
      const diff = (Date.parse(`${g.date}T00:00:00Z`) - Date.parse(`${s.date}T00:00:00Z`)) / 86_400_000
      const near = (diff > 0 && diff <= ls.gameDaysBefore) || (diff < 0 && -diff <= ls.gameDaysAfter) || diff === 0
      // game day itself is max load: no other training that day (only mobility); around it, light is fine
      const excess = diff === 0 && s.type !== 'mobility' ? Math.max(1, s.cost.legs + s.cost.cns) : s.cost.legs + s.cost.cns - ls.gameEveMax
      if (near && excess > 0) add(W.game + excess, `${diff === 0 ? 'the same day as' : diff > 0 ? `${diff === 1 ? 'the day' : `${diff} days`} before` : `${-diff === 1 ? 'the day' : `${-diff} days`} after`} ${g.title} (${day(g.date)})`, [s.key])
    }
  }
  // each body area's recovery time (his brief): heavy lower sessions ≥ legsRecoveryH apart, heavy lower and speed not
  // back to back (or on the same day), and worked upper-body sessions ≥ upperRecoveryH apart. Team football and games
  // count through the day/7-day load, the high-CNS spacing and the game protection, not as a lower session.
  const timeOrder = (a: LoadSession, b: LoadSession) => (a.date + a.start).localeCompare(b.date + b.start)
  const lowerHeavy = sessions.filter((s) => (s.type === 'lower' || s.type === 'plyo') && s.cost.legs >= ls.areaHeavy).sort(timeOrder)
  for (let i = 0; i < lowerHeavy.length; i++) for (let j = i + 1; j < lowerHeavy.length; j++) {
    const a = lowerHeavy[i], b = lowerHeavy[j]
    if (a.fixed && b.fixed) continue
    const h = hoursBetween(a, b), gap = Math.max(0, Math.round(h))
    if (h < ls.legsRecoveryH) add(W.area, `legs only ${gap} h after ${a.title} (${day(a.date)}); ${ls.legsRecoveryH} h wanted`, [a, b].filter((s) => !s.fixed).map((s) => s.key))
  }
  const speed = sessions.filter((s) => s.type === 'sprint' && s.cost.legs >= ls.areaHeavy)
  for (const l of lowerHeavy) for (const sp of speed) {
    if (l.fixed && sp.fixed) continue
    const diff = Math.abs((Date.parse(`${l.date}T00:00:00Z`) - Date.parse(`${sp.date}T00:00:00Z`)) / 86_400_000)
    if (diff <= 1) add(W.area, diff === 0 ? `heavy lower and speed on the same day (${day(l.date)})` : `heavy lower and speed back to back (${day(l.date < sp.date ? l.date : sp.date)}–${day(l.date < sp.date ? sp.date : l.date)})`, [l, sp].filter((s) => !s.fixed).map((s) => s.key))
  }
  const upperWorked = sessions.filter((s) => s.cost.upper >= ls.areaHeavy).sort(timeOrder)
  for (let i = 0; i < upperWorked.length; i++) for (let j = i + 1; j < upperWorked.length; j++) {
    const a = upperWorked[i], b = upperWorked[j]
    if (a.fixed && b.fixed) continue
    const h = hoursBetween(a, b), gap = Math.max(0, Math.round(h))
    if (h < ls.upperRecoveryH) add(W.area, b.fixed
      ? `upper body: ${b.title} (${day(b.date)}) is only ${gap} h later; ${ls.upperRecoveryH} h wanted`
      : `upper body only ${gap} h after ${a.title} (${day(a.date)}); ${ls.upperRecoveryH} h wanted`, [a, b].filter((s) => !s.fixed).map((s) => s.key))
  }
  // his rules, weighed
  const asRule: Session[] = sessions.map((s) => ({ date: s.date, start: s.start, type: s.type, load: loadOfIntensity(s.intensity), title: s.title, fixed: s.fixed, key: s.key }))
  const flexKeys = new Set(sessions.filter((s) => !s.fixed).map((s) => s.key))
  for (const p of ruleProblems(asRule, w.rules)) {
    const mine = p.keys.filter((k) => flexKeys.has(k))
    if (mine.length) add(p.strength === 'prefer' ? W.prefer : W.avoid, `${p.rule.charAt(0).toLowerCase()}${p.rule.slice(1)}`, mine)
  }
  return { cost: issues.reduce((a, x) => a + x.weight, 0), issues }
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * The first time that fits on a day (his usual training time first), around what's already placed. With a `where`,
 * the travel there and back has to fit too, and the place's own window (straight after school, the heavy cut-off,
 * Friday evening) is kept.
 */
function slotFor(room: DayRoom | undefined, minutes: number, heavy: boolean, used: [number, number][], w: LoadWorld, start?: string | null, where?: Where | null): { start: string; end: string } | null {
  if (!room) return null
  const from = minutesOf(w.trainingFrom)
  const before = where?.before ?? 0, after = where?.after ?? 0
  const slots = room.slots.flatMap((s) => {
    let parts: [number, number][] = [[minutesOf(s.start), minutesOf(s.end)]]
    for (const [a, b] of used) parts = parts.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y] as [number, number]] : [[x, Math.min(a, y)], [Math.max(b, x), y]] as [number, number][]).filter(([p, q]) => q > p))
    return parts
  }).sort((a, b) => Number(a[0] < from && a[1] - minutes < from) - Number(b[0] < from && b[1] - minutes < from) || a[0] - b[0])
  for (const [a, b] of slots) {
    const endCap = Math.min(b - after, heavy ? minutesOf(w.heavyUntil) : 24 * 60, where?.maxEnd ?? 24 * 60)
    const lo = Math.max(a + before, where?.minStart ?? 0)
    let at = start ? minutesOf(start) : (lo < from && endCap - minutes >= from ? from : lo)
    if (!start && where?.maxStart != null && at > where.maxStart) at = lo
    if (where?.maxStart != null && at > where.maxStart) continue
    if (at >= lo && at + minutes <= endCap) return { start: hm(at), end: hm(at + minutes) }
  }
  return null
}

/** Place the week's flexible sessions: the cheapest week by assess(), trying each day, place and a lighter intensity. */
export function planLoad(needs: LoadNeed[], w: LoadWorld): LoadPlan {
  const W = weightsOf(w.settings)
  const rooms = new Map(w.rooms.map((r) => [r.date, r]))
  // pinned first, then the sessions that shape the week most (legs and CNS), light ones last; stable otherwise
  const weight = (n: LoadNeed) => (n.intensity === 'light' ? 0 : n.intensity === 'moderate' ? 1 : 2) * 10 + (n.type === 'lower' || n.type === 'sprint' || n.type === 'plyo' ? 5 : n.type === 'upper' ? 3 : 0)
  const order = needs.map((n, i) => ({ n, i })).sort((a, b) => Number(!!w.pins?.get(b.n.key)) - Number(!!w.pins?.get(a.n.key)) || weight(b.n) - weight(a.n) || a.i - b.i).map((x) => x.n)
  type Choice = { s: LoadSession; extra: number } | null
  const chosen: Choice[] = order.map(() => null)
  let best: { chosen: Choice[]; cost: number } = { chosen: order.map(() => null), cost: Infinity }
  let steps = 0
  // what a placed session takes up that day: the travel there, the session, the travel back and a short break
  const usedOn = (date: string, upto: number) => chosen.slice(0, upto).filter((c): c is NonNullable<Choice> => !!c && c.s.date === date)
    .map((c) => [minutesOf(c.s.start) - (c.s.before ?? 0), minutesOf(c.s.end) + (c.s.after ?? 0) + 15] as [number, number])
  const uppers = order.map((n, i) => (n.type === 'upper' ? i : -1)).filter((i) => i >= 0)
  const lastUpper = uppers.length ? Math.max(...uppers) : -1

  const options = (i: number): NonNullable<Choice>[] => {
    const n = order[i]
    const pin = w.pins?.get(n.key)
    const out: NonNullable<Choice>[] = []
    const levels = pin?.intensity ? [pin.intensity] : n.noLighter ? [n.intensity] : INTENSITIES.filter((x) => loadRank(loadOfIntensity(x)) <= loadRank(loadOfIntensity(n.intensity))).reverse()
    const dates = pin?.date ? [pin.date] : w.rooms.map((r) => r.date)
    // two sessions of the same thing are interchangeable: only try them in day order
    const twin = order.slice(0, i).map((x, j) => (x.title === n.title && x.type === n.type && !w.pins?.get(x.key) ? j : -1)).filter((j) => j >= 0).pop()
    for (const date of dates) {
      if (!pin && twin !== undefined && chosen[twin] && date <= chosen[twin]!.s.date) continue
      const wheres: (Where | null)[] = w.where ? w.where(n, date).filter((x) => !pin?.place || x.place === pin.place || x.label === pin.place) : [null]
      for (const lv of levels) {
        // the cheapest place that fits that day (travel and fit), around what's already placed
        let pick: { at: { start: string; end: string }; wh: Where | null } | null = null
        // his time: a pin's, else the time on the session's fixed day ("upper Sat 09:30")
        const start = pin?.start ?? (n.preferStart && date === n.preferred ? n.preferStart : null)
        for (const wh of wheres) {
          const at = slotFor(rooms.get(date), n.minutes, lv === 'heavy', usedOn(date, i), w, start, wh)
          if (at && (!pick || (wh?.extra ?? 0) < (pick.wh?.extra ?? 0))) pick = { at, wh }
        }
        if (!pick && start) {   // his time didn't fit: the first time that does on the day he chose (never on top of something)
          for (const wh of wheres) {
            const at = slotFor(rooms.get(date), n.minutes, lv === 'heavy', usedOn(date, i), w, null, wh)
            if (at && (!pick || (wh?.extra ?? 0) < (pick.wh?.extra ?? 0))) pick = { at, wh }
          }
        }
        if (!pick) continue
        const { at, wh } = pick
        const cost = costOf({ title: n.title, type: n.type, intensity: lv, date }, w.costs, w.types, w.settings)
        // going lighter costs more for the sessions the week is built on (heavy lower, speed, plyo: their quality first)
        const extra = (loadRank(loadOfIntensity(n.intensity)) - loadRank(loadOfIntensity(lv))) * W.lighter * (KEY_TYPES.has(n.type) ? 3 : 1)
          + (n.preferred && n.preferred !== date ? n.preferCost ?? W.moved : 0) + (minutesOf(at.start) < minutesOf(w.trainingFrom) && !wh ? W.early : 0) + (wh?.extra ?? 0)
        out.push({ s: { key: n.key, title: n.title, type: n.type, intensity: lv, date, start: at.start, end: at.end, fixed: false, cost,
          ...(wh ? { place: wh.place, label: wh.label, from: wh.from, before: wh.before, after: wh.after, whereWhy: wh.why, guess: wh.guess } : {}) }, extra })
      }
    }
    return out
  }
  const costNow = (upto: number) => {
    const list = chosen.slice(0, upto).filter((c): c is NonNullable<Choice> => !!c)
    let c = assess([...w.fixed, ...list.map((x) => x.s)], w).cost + list.reduce((a, x) => a + x.extra, 0)
    // leaving out a session the week is built on (heavy lower, speed) costs twice as much
    c += order.slice(0, upto).reduce((a, n, i) => a + (chosen[i] ? 0 : n.skipCost ?? (KEY_TYPES.has(n.type) ? 2 * W.tbc : W.tbc)), 0)
    // one upper at the weekend if it scores well: counted once every upper session has been decided
    if (w.weekendUpper && lastUpper >= 0 && upto > lastUpper && !list.some((x) => x.s.type === 'upper' && isoDow(x.s.date) >= 6)) c += W.weekendUpper
    return c
  }
  const base = assess(w.fixed, w).cost   // what the fixed sessions cost on their own (the same in every plan)
  // a lower bound for what's still to place: each need's cheapest choice on its own (place, travel, intensity), or
  // leaving it out if that's cheaper. Interactions only add cost, so this never cuts off a better week.
  const floor = order.map((n, i) => {
    const alone = options(i).map((o) => o.extra + assess([...w.fixed, o.s], w).cost - base)
    return Math.max(0, Math.min(n.skipCost ?? (KEY_TYPES.has(n.type) ? 2 * W.tbc : W.tbc), ...alone))
  })
  const rest = order.map((_, i) => floor.slice(i).reduce((a, x) => a + x, 0))
  let evals = 0
  const BUDGET = 40_000   // week evaluations per search (deterministic: same input, same week)
  const search = (i: number) => {
    if (++steps > 20_000 || evals > BUDGET) return
    const c = costNow(i) - base
    if (c + (rest[i] ?? 0) >= best.cost) return
    if (i === order.length) { best = { chosen: [...chosen], cost: c }; return }
    const pinned = !!w.pins?.get(order[i].key)?.date
    // cheapest first, so good weeks are found early and the rest is cut short
    const opts = options(i).map((o) => { chosen[i] = o; evals++; const v = costNow(i + 1); chosen[i] = null; return { o, v } }).sort((a, b) => a.v - b.v)
    for (const { o, v } of opts) {
      if (v - base + (rest[i + 1] ?? 0) >= best.cost) break   // sorted: every later option is worse
      chosen[i] = o; search(i + 1); chosen[i] = null
    }
    if (!pinned || !opts.length) { chosen[i] = null; search(i + 1) }   // or leave it TBC
  }
  search(0)

  const placedS = best.chosen.filter((c): c is NonNullable<Choice> => !!c).map((c) => c.s)
  const all = [...w.fixed, ...placedS]
  const { issues } = assess(all, w)
  const placed: LoadPlaced[] = placedS.map((s) => {
    const n = order.find((x) => x.key === s.key)!
    return { ...s, targetId: n.targetId ?? null, wanted: n.intensity, why: whyLine(s, n, all, issues, w) }
  }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
  const tbc = order.filter((n, i) => !best.chosen[i]).map((n) => ({ key: n.key, title: n.title, reason: options(order.indexOf(n)).length ? (n.skipCost != null && n.skipCost < W.tbc ? 'it would cost more than it’s worth this week' : 'every day left this week would overload you') : 'no free time left this week' }))
  return { placed, tbc, days: dayLoads(all, w), notes: fixedNotes(w), cost: best.cost }
}

/** One line: why this day and this intensity. */
function whyLine(s: LoadSession, n: LoadNeed, all: LoadSession[], issues: Issue[], w: LoadWorld): string {
  const mine = issues.filter((x) => x.keys.includes(s.key)).sort((a, b) => b.weight - a.weight)
  if (s.intensity !== n.intensity) {
    // what the usual intensity would have run into on this day
    const asWanted = { ...s, intensity: n.intensity, cost: costOf({ ...s, intensity: n.intensity }, w.costs, w.types, w.settings) }
    const would = assess(all.map((x) => (x.key === s.key ? asWanted : x)), w).issues.filter((x) => x.keys.includes(s.key)).sort((a, b) => b.weight - a.weight)[0]
    return `${s.intensity}, not ${n.intensity}: ${would?.text ?? 'keeps the week’s load down'}${s.whereWhy ? ` · ${s.whereWhy}` : ''}`
  }
  if (mine.length && mine[0].weight >= 8) return `⚠️ best day left, but ${mine[0].text}${s.whereWhy ? ` · ${s.whereWhy}` : ''}`
  const ls = w.settings
  const bits: string[] = []
  const days = (a: { date: string }, b: { date: string }) => Math.round(Math.abs(Date.parse(`${a.date}T00:00:00Z`) - Date.parse(`${b.date}T00:00:00Z`)) / 86_400_000)
  const lowerish = (x: LoadSession) => (x.type === 'lower' || x.type === 'plyo') && x.cost.legs >= ls.areaHeavy
  const inWeek = (x: LoadSession) => x.date >= addDays(w.from, -3) && x.date <= addDays(w.to, 3)
  if (s.type === 'lower' || s.type === 'plyo' || s.type === 'sprint') {
    // heavy lower and speed: as far apart as the week allows
    const near = all.filter((x) => x.key !== s.key && inWeek(x) && (s.type === 'sprint' ? lowerish(x) : x.type === 'sprint')).sort((a, b) => days(a, s) - days(b, s))[0]
    bits.push(near ? `${days(near, s)} days from ${near.title} (${day(near.date)})` : 'legs fresh')
    const game = all.filter(isGame).map((g) => ({ g, d: (Date.parse(`${g.date}T00:00:00Z`) - Date.parse(`${s.date}T00:00:00Z`)) / 86_400_000 })).filter((x) => x.d > 0).sort((a, b) => a.d - b.d)[0]
    if (game && game.d <= 3) bits.push(`${game.d} day${game.d > 1 ? 's' : ''} before ${game.g.title}`)
  } else if (s.cost.upper >= ls.areaHeavy) {
    const prev = all.filter((x) => x.key !== s.key && x.cost.upper >= ls.areaHeavy && (x.date + x.start) < (s.date + s.start)).sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start))[0]
    bits.push(prev ? `upper body rested ${Math.round(hoursBetween(prev, s))} h since ${prev.title} (${day(prev.date)})` : 'upper body fresh')
  }
  const d = dayLoads(all, w).find((x) => x.date === s.date)
  if (d) bits.push(`${d.level} day`)
  if (mine.length) bits.push(mine[0].text)   // something small it accepts (e.g. two sessions that day)
  if (s.whereWhy) bits.push(s.whereWhy)
  return bits.join(' · ')
}

/** Each day's load: total, CNS, and low / med / high. */
export function dayLoads(all: LoadSession[], w: Pick<LoadWorld, 'from' | 'to' | 'settings'>): DayLoad[] {
  const out: DayLoad[] = []
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
    const list = all.filter((s) => s.date === d).sort((a, b) => a.start.localeCompare(b.start))
    const t = r1(list.reduce((a, s) => a + total(s.cost), 0)), cns = r1(list.reduce((a, s) => a + s.cost.cns, 0))
    out.push({ date: d, total: t, cns, level: !list.length ? 'rest' : t >= w.settings.dayHighLoad ? 'high' : t >= w.settings.dayMedLoad ? 'med' : 'low', sessions: list.map((s) => ({ title: s.title, intensity: s.intensity, fixed: s.fixed })) })
  }
  return out
}

/** What the calendar itself does to the week (the planner can't move those): said once, plainly. */
function fixedNotes(w: LoadWorld): string[] {
  const notes: string[] = []
  const inRange = w.fixed.filter((s) => s.date >= w.from && s.date <= w.to)
  const todays = inRange.filter((s) => s.date === w.today && s.intensity !== 'light')
  const low = w.whoop?.recovery != null && w.whoop.recovery < w.settings.lowRecovery
  if (low && todays.length) notes.push(`Whoop recovery ${w.whoop!.recovery}% today: ${todays.map((s) => s.title).join(', ')} — go light or move it if you can.`)
  else if (low) notes.push(`Whoop recovery ${w.whoop!.recovery}% today: nothing heavy today.`)
  else if (w.whoop?.strain != null && w.whoop.strain > w.settings.highStrain) notes.push(`Strain ${w.whoop.strain} yesterday: today’s limit is lower.`)
  const byDay = new Map<string, number>()
  for (const s of w.fixed) byDay.set(s.date, (byDay.get(s.date) ?? 0) + s.cost.cns)
  for (let d = w.from; d < w.to; d = addDays(d, 1)) {
    if (baseline(w.settings, d) && baseline(w.settings, addDays(d, 1))) continue
    if ((byDay.get(d) ?? 0) >= w.settings.cnsHigh && (byDay.get(addDays(d, 1)) ?? 0) >= w.settings.cnsHigh) notes.push(`${day(d)} and ${day(addDays(d, 1))} are both high-CNS in your calendar: keep one of them light if you can.`)
  }
  return notes
}

/** The card's load view: one line a day. */
export function loadView(days: DayLoad[], today: string): string[] {
  const dot = { rest: '⚪', low: '🟢', med: '🟡', high: '🔴' }
  return days.map((d) => `${dot[d.level]} ${d.date === today ? 'Today' : day(d.date)} <b>${d.level}</b>${d.total ? ` ${d.total}` : ''}${d.sessions.length ? ` · ${d.sessions.map((s) => `${s.title}${s.intensity !== 'heavy' ? ` (${s.intensity})` : ''}`).join(', ')}` : ''}`)
}

/** His words for a session he's naming ("upper body", "Owen lower/plyo") → the gym target it means (most shared words). */
export function matchTarget<T extends { id: string; name: string }>(said: string, targets: T[]): T | null {
  const stop = new Set(['the', 'a', 'my', 'and', 'or', 'session', 'sessions', 'body', 'day', 'days', 'workout', 'gym', 'owen', 'owens', 's'])
  const words = (x: string) => norm(x).split(' ').filter((w) => w && !stop.has(w))
  const mine = words(said)
  let best: T | null = null, score = 0
  for (const t of targets) {
    const n = words(t.name).filter((w) => mine.some((m) => m === w || m.startsWith(w) || w.startsWith(m))).length
    if (n > score) { best = t; score = n }
  }
  return best
}

/** A guess at the type of something he named, preferring the types the planner may place ("Owen lower/plyo" → lower). */
export function guessPlaceable(name: string, types: TypeDef[]): TrainingType | null {
  const placeable = types.filter((t) => t.placeable && !t.archived)
  return guessType(name, placeable)?.type ?? guessType(name, types)?.type ?? null
}
