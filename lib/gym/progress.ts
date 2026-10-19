// The gym maths (queue item 6): estimated 1RM (Epley), PRs, weekly sets per muscle group with an upper-body balance
// check, and the next session's suggestion (double progression, a deload when stalled). Pure: no database, no clock.
import { addDays, dowShort, shortDate } from '../time'
import { DEFAULT_EXERCISES, exerciseOf, known } from './catalogue'
import { DEFAULT_PREFS, MUSCLES, type Exercise, type GymPrefs, type Lift, type Muscle } from './types'

export const r1 = (n: number) => Math.round(n * 10) / 10
/** "80 kg", "82.5 kg", "61.24 kg" → shown with at most one decimal unless it needs two. */
export const kgText = (n: number) => `${Number.isInteger(n) ? n : Math.round(n * 100) % 10 === 0 ? n.toFixed(1) : n.toFixed(2)} kg`
const one = (n: number) => r1(n).toFixed(1)

/** Epley: weight × (1 + reps / 30); a single rep is the weight itself. */
export function epley(weight: number, reps: number): number {
  if (!(weight > 0) || !(reps >= 1)) return 0
  return reps === 1 ? weight : weight * (1 + reps / 30)
}

/** What the bar (or his body plus the belt) weighed: bodyweight moves add his bodyweight when he has set it. */
export function loadKg(l: Pick<Lift, 'weight_kg'>, ex: Exercise, prefs: GymPrefs = DEFAULT_PREFS): number | null {
  if (ex.bodyweight) return prefs.bodyweightKg > 0 ? prefs.bodyweightKg + l.weight_kg : null
  return l.weight_kg > 0 ? l.weight_kg : null
}

/** A set's estimated 1RM (one decimal), or null when there's no load to go on (bodyweight with no bodyweight set). */
export function e1rmOf(l: Pick<Lift, 'weight_kg' | 'reps'>, ex: Exercise, prefs: GymPrefs = DEFAULT_PREFS): number | null {
  const w = loadKg(l, ex, prefs)
  return w == null ? null : r1(epley(w, l.reps))
}

/** A score that grows with weight and reps, for "did it go up?" even without an e1RM (bodyweight dips). */
const scoreOf = (l: Pick<Lift, 'weight_kg' | 'reps'>, ex: Exercise, prefs: GymPrefs) => e1rmOf(l, ex, prefs) ?? r1((l.weight_kg + 1) * (1 + l.reps / 30) * 10) / 10

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** [6, 6, 5] → [{ reps: 6, sets: 2 }, { reps: 5, sets: 1 }] (first appearance order). */
export function groupReps(list: number[]): { reps: number; sets: number }[] {
  const out: { reps: number; sets: number }[] = []
  for (const r of list) { const x = out.find((o) => o.reps === r); if (x) x.sets++; else out.push({ reps: r, sets: 1 }) }
  return out
}

/** The weight as he'd say it: "80 kg", or "BW" / "BW+10 kg" for bodyweight moves. */
export const weightWords = (w: number, ex: Pick<Exercise, 'bodyweight'>) => (ex.bodyweight ? (w > 0 ? `BW+${kgText(w)}` : 'BW') : kgText(w))

/** One exercise's rows as a line: "80 kg × 5 × 3", "50 kg × 6, 6, 5", "80 kg × 8", "80 kg × 5 × 3 + 70 kg × 8". */
export function setsText(rows: Pick<Lift, 'weight_kg' | 'reps' | 'sets'>[], ex: Pick<Exercise, 'bodyweight'>): string {
  const byWeight: { w: number; rows: { reps: number; sets: number }[] }[] = []
  for (const r of rows) {
    const g = byWeight.find((x) => x.w === r.weight_kg)
    if (g) g.rows.push({ reps: r.reps, sets: r.sets }); else byWeight.push({ w: r.weight_kg, rows: [{ reps: r.reps, sets: r.sets }] })
  }
  return byWeight.map((g) => {
    const reps = g.rows.length === 1 ? (g.rows[0].sets > 1 ? `${g.rows[0].reps} × ${g.rows[0].sets}` : `${g.rows[0].reps}`)
      : g.rows.flatMap((x) => Array.from({ length: x.sets }, () => x.reps)).join(', ')
    return `${weightWords(g.w, ex)} × ${reps}`
  }).join(' + ')
}

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`

// ---------------------------------------------------------------------------
// Sessions, bests, PRs
// ---------------------------------------------------------------------------

export type Session = { date: string; rows: Lift[]; e1rm: number | null; score: number; sets: number; top: Lift }

/** One exercise's sessions (one per day), oldest first, each with its best e1RM and its top set. */
export function sessionsOf(lifts: Lift[], key: string, ex: Exercise, prefs: GymPrefs = DEFAULT_PREFS): Session[] {
  const byDay = new Map<string, Lift[]>()
  for (const l of lifts) if (l.exercise_key === key) byDay.set(l.done_on, [...(byDay.get(l.done_on) ?? []), l])
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, rows]) => {
    const top = [...rows].sort((a, b) => scoreOf(b, ex, prefs) - scoreOf(a, ex, prefs))[0]
    const es = rows.map((r) => e1rmOf(r, ex, prefs)).filter((x): x is number => x != null)
    return { date, rows, e1rm: es.length ? Math.max(...es) : null, score: Math.max(...rows.map((r) => scoreOf(r, ex, prefs))), sets: rows.reduce((a, r) => a + r.sets, 0), top }
  })
}

export type Pr =
  | { kind: 'e1rm'; value: number; was: number }
  | { kind: 'weight'; reps: number; value: number; was: number }
  | { kind: 'reps'; weight: number; value: number; was: number }
  | { kind: 'first' }

/**
 * Is what he just did a PR, against everything before it? Best e1RM first; then the best weight for at least that
 * many reps; then (bodyweight moves without a bodyweight) the most reps at that weight. The first log of an
 * exercise is 'first' (not called a PR). null = no PR.
 */
export function prOf(now: Pick<Lift, 'weight_kg' | 'reps'>[], before: Pick<Lift, 'weight_kg' | 'reps'>[], ex: Exercise, prefs: GymPrefs = DEFAULT_PREFS): Pr | null {
  if (!now.length) return null
  if (!before.length) return { kind: 'first' }
  const es = (list: Pick<Lift, 'weight_kg' | 'reps'>[]) => list.map((l) => e1rmOf(l, ex, prefs)).filter((x): x is number => x != null)
  const nowE = es(now), wasE = es(before)
  if (nowE.length && wasE.length && Math.max(...nowE) > Math.max(...wasE) + 0.05) return { kind: 'e1rm', value: Math.max(...nowE), was: Math.max(...wasE) }
  // the best weight for at least this many reps
  let best: Pr | null = null
  for (const l of now) {
    const prior = before.filter((b) => b.reps >= l.reps).map((b) => b.weight_kg)
    if (prior.length && l.weight_kg > Math.max(...prior) && (!best || (best.kind === 'weight' && l.weight_kg - Math.max(...prior) > best.value - best.was))) best = { kind: 'weight', reps: l.reps, value: l.weight_kg, was: Math.max(...prior) }
  }
  if (best) return best
  // the most reps at this weight (or heavier)
  for (const l of now) {
    const prior = before.filter((b) => b.weight_kg >= l.weight_kg).map((b) => b.reps)
    if (prior.length && l.reps > Math.max(...prior)) return { kind: 'reps', weight: l.weight_kg, value: l.reps, was: Math.max(...prior) }
  }
  return null
}

/** "🏆 new PR (was 90.0)", "🏆 best for 5+ reps (was 77.5 kg)", "🏆 most reps at BW (was 10)", "first one logged". */
export function prWords(pr: Pr | null, ex: Pick<Exercise, 'bodyweight'>): string {
  if (!pr) return ''
  if (pr.kind === 'first') return 'first one logged'
  if (pr.kind === 'e1rm') return `🏆 new PR (was ${one(pr.was)})`
  if (pr.kind === 'weight') return `🏆 best for ${pr.reps}+ reps (was ${weightWords(pr.was, ex)})`
  return `🏆 most reps at ${weightWords(pr.weight, ex)} (was ${pr.was})`
}

/** A PR in a few words, for "🏆 New PR: Bench press …": "e1RM 93.3 kg (was 90.0)", "82.5 kg for 5+ reps (was 80 kg)". */
export function prShort(pr: Pr, ex: Pick<Exercise, 'bodyweight'>): string {
  if (pr.kind === 'first') return 'first one logged'
  if (pr.kind === 'e1rm') return `e1RM ${kgText(r1(pr.value))} (was ${one(pr.was)})`
  if (pr.kind === 'weight') return `${weightWords(pr.value, ex)} for ${pr.reps}+ reps (was ${weightWords(pr.was, ex)})`
  return `${pr.value} reps at ${weightWords(pr.weight, ex)} (was ${pr.was})`
}

/** The card line for a lift he's logging: "Bench press 80 kg × 5 × 3 · e1RM 93.3 kg · 🏆 new PR (was 90.0)". */
export function logLine(rows: Pick<Lift, 'weight_kg' | 'reps' | 'sets'>[], ex: Exercise, before: Pick<Lift, 'weight_kg' | 'reps'>[], prefs: GymPrefs = DEFAULT_PREFS): { text: string; pr: Pr | null; e1rm: number | null } {
  const es = rows.map((r) => e1rmOf(r, ex, prefs)).filter((x): x is number => x != null)
  const e1rm = es.length ? Math.max(...es) : null
  const pr = prOf(rows, before, ex, prefs)
  const bits = [`${ex.name} ${setsText(rows, ex)}`, e1rm != null ? `e1RM ${kgText(r1(e1rm))}` : '', prWords(pr, ex)].filter(Boolean)
  return { text: bits.join(' · '), pr, e1rm }
}

export type Best = { key: string; name: string; e1rm: number | null; date: string; top: Lift; last: string; sessions: number; trend: number | null }

/** Each exercise's best (e1RM, else best score), its last session and how it moved over ~4 weeks; most recent first. */
export function bestsOf(lifts: Lift[], list: Exercise[] = DEFAULT_EXERCISES, prefs: GymPrefs = DEFAULT_PREFS): Best[] {
  const keys = [...new Set(lifts.map((l) => l.exercise_key))]
  return keys.map((key) => {
    const ex = exerciseOf(key, list, lifts.find((l) => l.exercise_key === key)?.exercise)
    const ss = sessionsOf(lifts, key, ex, prefs)
    const best = [...ss].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))[0]
    return { key, name: ex.name, e1rm: best.e1rm, date: best.date, top: best.top, last: ss[ss.length - 1].date, sessions: ss.length, trend: trendOf(ss) }
  }).sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name))
}

/** % change in best e1RM from the session nearest 4 weeks before the last one (null with too little history). */
export function trendOf(ss: Session[]): number | null {
  if (ss.length < 2) return null
  const last = ss[ss.length - 1]
  const back = addDays(last.date, -28)
  const then = [...ss.slice(0, -1)].reverse().find((s) => s.date <= back) ?? ss[0]
  if (last.e1rm == null || then.e1rm == null || then.e1rm <= 0) return null
  return Math.round(((last.e1rm - then.e1rm) / then.e1rm) * 1000) / 10
}

/** Every PR set in a date range (a session that beat everything before it), oldest first. */
export function prsIn(lifts: Lift[], from: string, to: string, list: Exercise[] = DEFAULT_EXERCISES, prefs: GymPrefs = DEFAULT_PREFS): { date: string; key: string; name: string; pr: Pr; line: string; short: string }[] {
  const out: { date: string; key: string; name: string; pr: Pr; line: string; short: string }[] = []
  for (const key of new Set(lifts.map((l) => l.exercise_key))) {
    const ex = exerciseOf(key, list, lifts.find((l) => l.exercise_key === key)?.exercise)
    const ss = sessionsOf(lifts, key, ex, prefs)
    ss.forEach((s, i) => {
      if (s.date < from || s.date > to || i === 0) return
      const pr = prOf(s.rows, ss.slice(0, i).flatMap((x) => x.rows), ex, prefs)
      if (pr && pr.kind !== 'first') out.push({ date: s.date, key, name: ex.name, pr, line: `${ex.name} ${setsText(s.rows, ex)}${s.e1rm != null ? ` · e1RM ${kgText(s.e1rm)}` : ''} · ${prWords(pr, ex)}`, short: `${ex.name} ${prShort(pr, ex)}` })
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** e1RM over time for the chart: one point per session (the session's best set). */
export const seriesOf = (lifts: Lift[], key: string, ex: Exercise, prefs: GymPrefs = DEFAULT_PREFS) =>
  sessionsOf(lifts, key, ex, prefs).filter((s) => s.e1rm != null).map((s) => ({ date: s.date, e1rm: s.e1rm! }))

// ---------------------------------------------------------------------------
// Weekly volume and the upper-body balance
// ---------------------------------------------------------------------------

export type Volume = { muscles: Record<Muscle, number>; push: number; pull: number; legs: number; core: number; unknown: number; sets: number }

/** Sets per muscle group from `from` to `to` (a primary muscle counts each set, a secondary one half), and per pattern. */
export function volumeOf(lifts: Lift[], from: string, to: string, list: Exercise[] = DEFAULT_EXERCISES): Volume {
  const muscles = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>
  const v: Volume = { muscles, push: 0, pull: 0, legs: 0, core: 0, unknown: 0, sets: 0 }
  for (const l of lifts) {
    if (l.done_on < from || l.done_on > to) continue
    v.sets += l.sets
    if (!known(l.exercise_key, list)) { v.unknown += l.sets; continue }
    const ex = exerciseOf(l.exercise_key, list)
    for (const m of ex.primary) muscles[m] += l.sets
    for (const m of ex.secondary) muscles[m] += l.sets / 2
    v[ex.pattern] += l.sets
  }
  for (const m of MUSCLES) muscles[m] = r1(muscles[m])
  return v
}

/**
 * One short suggestion that keeps the upper body balanced (for physique): push vs pull, chest vs back, shoulders.
 * The biggest gap wins; null when too little upper work is logged to say (under 6 sets).
 */
export function balanceOf(v: Volume): { ok: boolean; line: string } | null {
  const upper = v.push + v.pull
  if (upper < 6) return null
  const m = v.muscles
  const sets = (n: number) => `${r1(n)} set${n === 1 ? '' : 's'}`
  const add = (gap: number) => Math.max(2, Math.min(6, Math.round(gap)))
  const issues: { score: number; line: string }[] = []
  if (v.pull < v.push * 0.8) issues.push({ score: (v.push - v.pull) / v.push, line: `Pull is behind push (${sets(v.pull)} vs ${sets(v.push)}): add ${add(v.push - v.pull)} sets of rows or pull-ups next upper session.` })
  if (v.push < v.pull * 0.8) issues.push({ score: (v.pull - v.push) / v.pull, line: `Push is behind pull (${sets(v.push)} vs ${sets(v.pull)}): add ${add(v.pull - v.push)} sets of bench or dips next upper session.` })
  if (m.chest > 0 && m.back < m.chest * 0.75) issues.push({ score: (m.chest - m.back) / m.chest - 0.01, line: `Back is behind chest (${sets(m.back)} vs ${sets(m.chest)}): add ${add(m.chest - m.back)} sets of rows or pulldowns.` })
  if (m.back > 0 && m.chest < m.back * 0.6) issues.push({ score: (m.back - m.chest) / m.back - 0.02, line: `Chest is behind back (${sets(m.chest)} vs ${sets(m.back)}): add ${add(m.back - m.chest)} sets of bench or incline press.` })
  const big = Math.max(m.chest, m.back)
  if (big >= 4 && m.shoulders < big * 0.6) issues.push({ score: (big * 0.6 - m.shoulders) / big, line: `Shoulders are light (${sets(m.shoulders)}): add 3 sets of lateral raises.` })
  if (!issues.length) return { ok: true, line: `Upper body balanced: push ${sets(v.push)}, pull ${sets(v.pull)} ✓` }
  return { ok: false, line: issues.sort((a, b) => b.score - a.score)[0].line }
}

// ---------------------------------------------------------------------------
// The next session (double progression)
// ---------------------------------------------------------------------------

export type Next = { key: string; name: string; weight: number; reps: number; sets: number; kind: 'reps' | 'weight' | 'deload' | 'start'; why: string; text: string }

const roundTo = (n: number, step: number) => Math.round(n / step) * step

/**
 * What to do next time, from the last session: every working set at the top of the rep range → add weight (+2.5 kg
 * upper, +5 kg lower) and go back to the bottom of the range; otherwise +1 rep. No progress for `stall` sessions → a
 * deload (−10 %, then build back up).
 */
export function nextFor(lifts: Lift[], key: string, ex: Exercise, prefs: GymPrefs = DEFAULT_PREFS): Next | null {
  const ss = sessionsOf(lifts, key, ex, prefs)
  if (!ss.length) return null
  const last = ss[ss.length - 1]
  const w = Math.max(...last.rows.map((r) => r.weight_kg))
  const working = last.rows.filter((r) => r.weight_kg === w)
  const sets = working.reduce((a, r) => a + r.sets, 0)
  const minReps = Math.min(...working.map((r) => r.reps))
  const [lo, hi] = ex.compound ? prefs.compound : prefs.accessory
  const inc = ex.lower ? 5 : 2.5
  const shown = (weight: number, reps: number, n: number) => `${ex.name}: ${weightWords(weight, ex)} × ${reps}${n > 1 ? ` × ${n}` : ''}`
  // after a deload (a session lighter than one he recently did for as many reps, or fewer sets): build back up,
  // never deload again. A heavy single (90 × 1) before 80 × 5 isn't a deload.
  const n = prefs.stall
  const topW = (s: Session) => Math.max(...s.rows.map((r) => r.weight_kg))
  const setsAt = (s: Session, kg: number) => s.rows.filter((r) => r.weight_kg === kg).reduce((a, r) => a + r.sets, 0)
  const heavierBefore = (i: number): number | null => {
    const t = topW(ss[i]), reps = Math.min(...ss[i].rows.filter((r) => r.weight_kg === t).map((r) => r.reps))
    const rows = ss.slice(Math.max(0, i - n - 3), i).flatMap((x) => x.rows).filter((x) => x.weight_kg > t && x.reps >= reps)
    return rows.length ? Math.max(...rows.map((x) => x.weight_kg)) : null
  }
  const earlier = ss.slice(0, -1)
  const bestW = earlier.length ? Math.max(...earlier.map(topW)) : w
  const target = heavierBefore(ss.length - 1)
  if (target != null) {
    const back = Math.min(w + inc, target)
    const why = `building back up after the deload: +${back - w} kg`
    return { key, name: ex.name, weight: back, reps: minReps, sets, kind: 'weight', why, text: `${shown(back, minReps, sets)} (${why})` }
  }
  const mostSets = earlier.filter((s) => topW(s) === w).reduce((a, s) => Math.max(a, setsAt(s, w)), 0)
  if (w === bestW && w === 0 && mostSets > sets) {
    const why = 'building back up after the deload: +1 set'
    return { key, name: ex.name, weight: w, reps: minReps, sets: sets + 1, kind: 'reps', why, text: `${shown(w, minReps, sets + 1)} (${why})` }
  }
  // stalled: the last `stall` sessions didn't beat the best before them (a deload in that window doesn't count as a stall)
  const before = ss.slice(0, -n)
  const deloaded = before.length > 0 && ss.slice(-n).some((s, k) => {
    const i = ss.length - n + k
    if (heavierBefore(i) != null) return true
    const was = topW(s), prior = ss.slice(Math.max(0, i - n - 3), i).filter((b) => topW(b) === was)
    return prior.length > 0 && setsAt(s, was) < Math.max(...prior.map((b) => setsAt(b, was)))
  })
  if (ss.length > n && !deloaded) {
    const recent = Math.max(...ss.slice(-n).map((s) => s.score))
    const before = Math.max(...ss.slice(0, -n).map((s) => s.score))
    if (recent <= before + 0.01) {
      if (w > 0) {
        const lighter = Math.max(0, roundTo(w * (1 - prefs.deloadPct / 100), 2.5))
        const why = `no progress in ${n} sessions: −${prefs.deloadPct}%, then build back up`
        return { key, name: ex.name, weight: lighter, reps: minReps, sets, kind: 'deload', why, text: `${shown(lighter, minReps, sets)} (deload: ${why})` }
      }
      const fewer = Math.max(1, sets - 1)
      const why = `no progress in ${n} sessions: an easier week`
      return { key, name: ex.name, weight: w, reps: minReps, sets: fewer, kind: 'deload', why, text: `${shown(w, minReps, fewer)} (deload: ${why})` }
    }
  }
  if (minReps >= hi) {
    const heavier = w + inc
    const why = `every set hit ${hi}+ reps: +${inc} kg`
    return { key, name: ex.name, weight: heavier, reps: lo, sets, kind: 'weight', why, text: `${shown(heavier, lo, sets)} (${why})` }
  }
  const reps = minReps + 1
  const why = working.length > 1 ? '+1 rep: every set' : '+1 rep'
  return { key, name: ex.name, weight: w, reps, sets, kind: 'reps', why, text: `${shown(w, reps, sets)} (${why})` }
}

/** The next suggestion for each exercise done in the last `days` days (most recent first), at most `max`. */
export function nextAll(lifts: Lift[], today: string, list: Exercise[] = DEFAULT_EXERCISES, prefs: GymPrefs = DEFAULT_PREFS, days = 21, max = 6): Next[] {
  const recent = bestsOf(lifts.filter((l) => l.done_on <= today), list, prefs).filter((b) => b.last >= addDays(today, -days)).slice(0, max)
  return recent.map((b) => nextFor(lifts, b.key, exerciseOf(b.key, list, b.name), prefs)).filter((x): x is Next => !!x)
}

/** "Mon 19 Oct" (for lines). */
export const dayText = day
