// The study planner (plans/contracts.md §3.4): decides WHAT to do today and WHICH resource, by the strict priority
// order (lib/plan-items.ts TIER) and the leftover split. Pure: no database, no clock, no AI — same input, same plan.
//   1 homework → 1.5 anything a live "top priority" rule boosts → 2 tests / consolidation within 21 days (≤ 2 picks a
//   test, nearest first, round-robin; the timed practice / light day first; redos of their mistakes; ACT countdown from
//   `extra`) → 3 the other mistake redos (one pick) + ≤ 2 due reviews → 4 one taught 🔴 → the fixed commitments (steady
//   ACT from `extra`, due programmes) → the leftover split (half-term 55 % ahead / 25 % fixing / 20 % old · school 40 %
//   current / 30 % old / 30 % ahead) → stretch (🟢 only).
// STRICT by minutes and by count: the day's slots (DayContext.maxPicks, default 5) fill in that order, so a lower pick
// never takes a slot while a higher one that fits is left out ("left for another day" note — never silent for tests).
// Temporary rules: pause removes picks, boost moves them right after homework, cap limits minutes (higher tiers first),
// all only while live. The day before a test: only its light pick in its subjects. ACT goals / programmes / misses are
// not this planner's: they come in through `extra` (lib/act).
import type { DayContext, Pick as PlanPick } from '../plan-items'
import { TIER } from '../plan-items'
import { addDays, dateISOOf, daysBetween, dowShort, shortDate } from '../time'
import { aheadSteps, escRe, examResource, fixingResource, fixSteps, freshText, isMaths, isPhysics, linkOf, nextResource, reviewText, scaleSteps, stretchResource, textbookRef, topicLabel } from './ladder'
import { AHEAD_MIN, MIN_SHARE, runShares, SHARE_MAX, type ShareKind } from './leftover'
import { isDueToday, leftThisWeek, nextStep, parseDays } from './programmes'
import { isDue, nextReview, taughtState } from './rules'
import { boostedBy, capRules, liveRules, pausedBy, programmeBoosted, ruleNote, targetLabel, targetMatches } from './rulesets'
import { lightSubjects, nearestTest, PER_TEST_PER_DAY, testCandidates, testPhase, testsInWindow, type Candidate, type TestWindow } from './testmode'
import { COLOUR_DOT, type Colour, type PlanRule, type Programme, type StudyWorld, type TrackerMistake, type TrackerTopic } from './types'

/** Something that didn't make today's list: no room (the day's slots were full) or no time (minutes / a cap). */
export type LeftOut = { key: string; title: string; kind: PlanPick['kind']; tier: number; minutes: number; topicId: string | null; reason: 'room' | 'time' }

export type StudyPlan = {
  picks: PlanPick[]             // in priority order, minutes chosen; ≤ day.maxPicks study picks (+ tier-8 training extras)
  mode: 'half_term' | 'school'
  testMode: { goalId: string; title: string; daysLeft: number } | null   // the nearest test within 3 weeks
  notes: string[]               // why things were left out ("paused: getting ahead until Sun 25 Oct")
  left: LeftOut[]               // what was left out and why (for "what else?" and the tests)
}

/** Study picks a day: default (Today shows ≤ 5) and the most DayContext.maxPicks may ask for. */
export const DEFAULT_PICKS = 5
export const MAX_PICKS = 6
export const HOMEWORK_DAYS = 7
export const HOMEWORK_MINUTES = 45
export const REVIEWS_PER_DAY = 2
export const FIX_PER_DAY = 1
export const MAX_REDOS = 6
export const HOMEWORK_OPEN = 'Do it in black · mark green/red/purple · log red/purple as mistakes'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const dot = (c: Colour) => COLOUR_DOT[c]
/** "today" · "yesterday" · "Thu" within the last week · else "3 Oct". */
export function whenText(iso: string, today: string): string {
  const n = daysBetween(iso, today)
  if (n === 0) return 'today'
  if (n === 1) return 'yesterday'
  if (n > 1 && n < 7) return dowShort(iso)
  return shortDate(iso)
}
const dueDate = (dueAt: string) => (dueAt.includes('T') ? dateISOOf(dueAt) : dueAt.slice(0, 10))
/** The school order: when it's taught, then its place in the subject. */
const schoolOrder = (a: TrackerTopic, b: TrackerTopic) => (a.taughtFrom ?? '9999-12-31').localeCompare(b.taughtFrom ?? '9999-12-31')
  || a.order - b.order || (a.code ?? '').localeCompare(b.code ?? '') || a.id.localeCompare(b.id)
const byLastDone = (a: TrackerTopic, b: TrackerTopic) => (a.lastDone ?? '').localeCompare(b.lastDone ?? '')
const scalePick = (p: PlanPick, minutes: number): PlanPick => ({ ...p, minutes, steps: p.steps ? scaleSteps(p.steps, minutes) : p.steps })
const cand = (pick: PlanPick, min: number, code?: string | null): Candidate => ({ pick, min: Math.min(min, pick.minutes), meta: { code: code ?? null }, shrink: (m) => scalePick(pick, m) })
/** ACT misses are the ACT planner's (subject ACT, or a source like "ACT practice 3"). */
const isActMiss = (m: TrackerMistake, subject: string | null) => (subject ?? '').trim().toLowerCase() === 'act' || /^ACT\b/.test(m.source ?? '')

/** The leftover-share picks (the rest of tiers ≥ 5 are fixed commitments: steady ACT, programmes). */
const SHARE_KINDS = new Set<PlanPick['kind']>(['ahead', 'stretch', 'fix', 'current', 'old'])
/** The order the day's slots are filled in: the tier, except that the fixed commitments (steady ACT, due programmes)
 *  come right after tier 4, before the leftover shares (4.5). */
export const slotRank = (p: { tier: number; kind: PlanPick['kind'] }) => (p.tier <= TIER.fix ? p.tier : SHARE_KINDS.has(p.kind) ? p.tier : 4.5)

// ---------------------------------------------------------------------------
// The day being filled: budget, caps, pauses, the light-day rule, the slots
// ---------------------------------------------------------------------------

const LIGHT_OK = new Set(['homework', 'test_light', 'mistake_redo', 'training'])
type Placed = 'placed' | 'full' | 'time' | 'unusable'
type Pool = { cands: Candidate[]; quota: number; placed: number }
const pool = (cands: Candidate[], quota = Infinity): Pool => ({ cands, quota, placed: 0 })

class Day {
  picks: PlanPick[] = []
  left: LeftOut[] = []
  budget: number
  limit: number
  private keys = new Set<string>()
  private topics = new Set<string>()
  private capLeft = new Map<PlanRule, number>()
  private rules: PlanRule[]
  private done: Set<string>
  private light: Map<string, TestWindow>
  constructor(budget: number, limit: number, rules: PlanRule[], done: Set<string>, light: Map<string, TestWindow>) {
    this.budget = budget
    this.limit = limit
    this.rules = rules
    this.done = done
    this.light = light
    for (const r of capRules(rules)) this.capLeft.set(r, r.minutes ?? 0)
  }
  get full() { return this.picks.length >= this.limit }
  has(p: PlanPick) { return this.keys.has(p.key) || (!!p.topicId && this.topics.has(p.topicId)) }
  lightBlocked(p: PlanPick) { return !LIGHT_OK.has(p.kind) && !!p.subject && this.light.has(p.subject.toLowerCase()) }
  /** Could it go on today's list at all (not done, not already there, not paused, not heavy on a light day)? */
  usable(c: Candidate) {
    const p = c.pick
    if (this.done.has(p.key) || this.has(p)) return false
    if (pausedBy(this.rules, p, c.meta)) return false
    return !this.lightBlocked(p)
  }
  /** Homework: never shortened, never paused or capped; it still needs a slot (the earliest due get them first). */
  force(p: PlanPick) {
    if (this.done.has(p.key) || this.keys.has(p.key)) return
    if (this.full) { this.leave(p, 'room'); return }
    this.budget -= p.minutes
    this.push(p)
  }
  /** Fits by minutes (the budget and any live cap on it; shortened if it allows that) → the pick to place, or null. */
  private fit(c: Candidate): { pick: PlanPick; caps: PlanRule[] } | null {
    const p = c.pick
    const caps = [...this.capLeft.keys()].filter((r) => targetMatches(r.target, p, c.meta))
    let allow = Math.max(0, this.budget)
    for (const r of caps) allow = Math.min(allow, this.capLeft.get(r)!)
    const m = Math.min(p.minutes, allow)
    const pick = m >= p.minutes ? p : m >= c.min && m > 0 && c.shrink ? c.shrink(m) : null
    return pick ? { pick, caps } : null
  }
  private spend(pick: PlanPick, caps: PlanRule[]) {
    this.budget -= pick.minutes
    for (const r of caps) this.capLeft.set(r, this.capLeft.get(r)! - pick.minutes)
  }
  /** Places it now: minutes first (a pick that doesn't fit is 'time'), then a slot ('full' = it fits but no room). */
  place(c: Candidate, tier?: number): Placed {
    if (!this.usable(c)) return 'unusable'
    const f = this.fit(c)
    if (!f) return 'time'
    if (this.full) return 'full'
    this.spend(f.pick, f.caps)
    this.push(tier === undefined ? f.pick : { ...f.pick, tier: tier as PlanPick['tier'] })
    return 'placed'
  }
  /** Leftover shares: take the minutes now, decide the slots afterwards in tier order (see commitDeferred). */
  deferred: PlanPick[] = []
  defer(c: Candidate): number {
    if (!this.usable(c)) return 0
    const f = this.fit(c)
    if (!f) return 0
    this.spend(f.pick, f.caps)
    this.mark(f.pick)
    this.deferred.push(f.pick)
    return f.pick.minutes
  }
  commitDeferred() {
    const list = this.deferred.map((p, i) => ({ p, i })).sort((a, b) => a.p.tier - b.p.tier || a.i - b.i).map((x) => x.p)
    for (const p of list) {
      if (this.full) { this.leave(p, 'room'); this.budget += p.minutes; continue }
      this.picks.push(p)
    }
    this.deferred = []
  }
  leave(p: PlanPick, reason: 'room' | 'time') {
    if (!this.left.some((x) => x.key === p.key)) this.left.push({ key: p.key, title: p.title, kind: p.kind, tier: p.tier, minutes: p.minutes, topicId: p.topicId ?? null, reason })
  }
  private mark(p: PlanPick) {
    this.keys.add(p.key)
    if (p.topicId) this.topics.add(p.topicId)
  }
  private push(p: PlanPick) {
    this.picks.push(p)
    this.mark(p)
  }
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

/** Today's study, in order. `extra` = picks from other planners (ACT: lib/act/engine.ts), merged by tier; tier-8
 *  training picks pass through outside the day's slots. */
export function planStudyDay(world: StudyWorld, day: DayContext, extra: PlanPick[] = []): StudyPlan {
  const date = day.date
  const links = world.links
  const rules = liveRules(world.rules, date)
  const done = new Set(world.doneToday)
  const tests = world.tests.filter((t) => t.kind !== 'act')
  const windows = testsInWindow({ ...world, tests }, date)
  const light = lightSubjects(windows, date)
  const notes: string[] = []
  const minutes = Number.isFinite(day.studyMinutes) ? Math.max(0, Math.floor(day.studyMinutes)) : 0
  if (!Number.isFinite(day.studyMinutes)) notes.push('no study time known for today – homework only')
  const limit = Math.max(1, Math.min(MAX_PICKS, Math.floor(Number.isFinite(day.maxPicks) ? day.maxPicks! : DEFAULT_PICKS)))
  const d = new Day(minutes, limit, rules, done, light)
  const reviewDays = world.reviewDays as Record<Colour, number>
  const doneLike = (re: RegExp) => [...done].filter((k) => re.test(k)).length
  const boosted = (c: Candidate) => c.pick.tier === TIER.boost || !!boostedBy(rules, c.pick, c.meta)
  const normal = (c: Candidate) => !boosted(c)
  const live = world.topics
  const mistakesOf = (t: TrackerTopic) => world.mistakes.filter((m) => m.topicId === t.id || (!!m.code && !!t.code && m.code.toUpperCase() === t.code.toUpperCase())).length
  const state = (t: TrackerTopic) => taughtState(t, date)
  const passthrough = extra.filter((p) => p.tier >= TIER.training)
  const others = extra.filter((p) => p.tier < TIER.training)
  const extraCand = (p: PlanPick): Candidate => ({ pick: p, min: p.minutes })

  // 1. homework (and anything else at the homework tier): due within 7 days or overdue, earliest first
  const homework = world.homework
    .filter((h) => h.dueAt && dueDate(h.dueAt) <= addDays(date, HOMEWORK_DAYS))
    .sort((a, b) => dueDate(a.dueAt!).localeCompare(dueDate(b.dueAt!)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  for (const h of homework) d.force(homeworkPick(h))
  for (const p of others.filter((p) => p.tier <= TIER.homework)) d.force(p)

  // mistake redos due (not ACT's): a test's own mistakes (its goal, or a code on it) are its prep (tier 2); the rest tier 3
  const dueRedos = world.mistakes.filter((m) => m.redoStage < 2 && m.reviewOn <= date && !isActMiss(m, subjectOfMistake(m)))
  const forTest = (m: TrackerMistake) => windows.filter((w) => w.daysLeft > 0).find((w) => m.goalId === w.test.id || (!!m.code && w.test.topicCodes.some((c) => c.toUpperCase() === m.code!.toUpperCase())))
  const testRedos = dueRedos.filter((m) => forTest(m))
  const testRedo = pool(testRedos.length ? [redoCand(testRedos, true)!].filter(Boolean) : [], 1)

  // every pool, built before any time is given out (so a boost can lift any of them); quotas are per day
  const testGroups = windows.map((w) => pool(testCandidates(w, date, links, day.mode, world.mistakes), PER_TEST_PER_DAY - doneLike(new RegExp(`^test:${escRe(w.test.id)}:`))))
  const actTests = others.filter((p) => p.tier > TIER.homework && p.tier <= TIER.test)
  if (actTests.length) testGroups.push(pool(actTests.map(extraCand)))
  const reviews = pool(live.filter((t) => isDue(t, date, reviewDays))
    .sort((a, b) => (a.status === 'not_secure' ? 0 : 1) - (b.status === 'not_secure' ? 0 : 1) || (nextReview(a, reviewDays) ?? '').localeCompare(nextReview(b, reviewDays) ?? '') || schoolOrder(a, b))
    .map(reviewCand), REVIEWS_PER_DAY - doneLike(/^topic:.+:review$/))
  const otherRedos = dueRedos.filter((m) => !forTest(m))
  const redo = pool(otherRedos.length ? [redoCand(otherRedos, false)!].filter(Boolean) : [], 1)
  const extraReview = pool(others.filter((p) => p.tier === TIER.review).map(extraCand))
  const fixes = pool(live.filter((t) => state(t) === 'taught' && t.status === 'not_secure')
    .sort((a, b) => byLastDone(a, b) || schoolOrder(a, b)).map((t) => fixCand(t, 45, TIER.fix)), FIX_PER_DAY - doneLike(/^topic:.+:fix$/))
  const extraFix = pool(others.filter((p) => p.tier === TIER.fix).map(extraCand))
  const study = world.programmes.filter((p) => p.area === 'study' || p.area === 'other')
  for (const p of study) if (p.days && !parseDays(p.days).understood) notes.push(`${p.name}: days "${p.days}" not understood – any day`)
  const programmes = study.filter((p) => isDueToday(p, date, day.dow, programmeBoosted(rules, p.name)))
    .map(programmeCand).filter((c): c is Candidate => !!c)
  const commitments = pool([...others.filter((p) => p.tier > TIER.fix).map(extraCand), ...programmes])

  // getting ahead (maths only, ⏭ Next up in school order, ⚪/🔴 — move on at 🟡) and stretch (🟢 only)
  const aheadDone = doneLike(/^topic:.+:ahead$/) > 0
  const aheadList = aheadDone ? [] : live.filter((t) => isMaths(t.subject) && state(t) === 'next_up' && (t.status === 'not_started' || t.status === 'not_secure')).sort(schoolOrder)
  const stretchList = live.filter((t) => isMaths(t.subject) && t.status === 'exam_ready').sort((a, b) => a.step - b.step || byLastDone(a, b) || schoolOrder(a, b))
  const aheadBoost = pool(aheadList.map((t) => aheadCand(t, 90)), 1)
  const stretchBoost = pool(stretchList.map((t) => stretchCand(t, 60)), 1)

  // 1.5 boost: whatever a live "top priority" rule names, right after homework (the same daily limits) — incl. one
  // leftover pick (current / fixing / old …) for a rule whose target is one of those
  runTests(boosted, TIER.boost)
  for (const p of [testRedo, redo, reviews, extraReview, fixes, extraFix, commitments, aheadBoost]) runPool(p, boosted, TIER.boost)
  // stretch is the very last thing: only a rule that names it ("stretch top priority") lifts it, not "maths"
  runPool(stretchBoost, (c) => rules.some((r) => r.kind === 'boost' && /^stretch$/i.test(r.target.trim())) && boosted(c), TIER.boost)
  const boosts = rules.filter((r) => r.kind === 'boost')
  const produced = (r: PlanRule) => d.picks.some((p) => p.tier === TIER.boost && targetMatches(r.target, p, metaOf(p)))
  for (const r of boosts) {
    if (produced(r)) continue
    for (const kind of ['current', 'fixing', 'old'] as const) {
      const c = shareCands(kind, SHARE_MAX[kind]).find((x) => targetMatches(r.target, x.pick, x.meta) && d.usable(x))
      if (c && d.place(c, TIER.boost) === 'placed') break
    }
  }
  // 2. tests: the date-bound picks, the redos of their mistakes, then round-robin · 3. the other redos + reviews · 4. one 🔴
  runTests(normal)
  for (const p of [redo, reviews, extraReview, fixes, extraFix]) runPool(p, normal)
  // the fixed commitments (steady ACT, due programmes): the first free slots after tiers 1–4, with the minutes left
  runPool(commitments, normal)
  // 6. the leftover split, then stretch: minutes now, slots in tier order (ahead → stretch → the tier-7 shares)
  const skip = { ahead: aheadBoost.placed > 0, stretch: stretchBoost.placed > 0 }
  if (!d.full) {
    runShares(d.budget, day.mode, (kind, m) => {
      if (d.budget < MIN_SHARE) return 0
      if ((kind === 'ahead' && (skip.ahead || m < AHEAD_MIN)) || (kind === 'stretch' && skip.stretch)) return 0
      for (const c of shareCands(kind, m)) {
        const used = d.defer(c)
        if (used) return used
      }
      return 0
    })
    d.commitDeferred()
  }

  // the notes: live rules, test days, light days, what's left for another day
  for (const r of rules) notes.push(r.kind === 'boost' && !produced(r) ? `nothing of ${targetLabel(r.target)} to put first today (rule until ${dowShort(r.endsOn)} ${shortDate(r.endsOn)})` : ruleNote(r))
  for (const w of windows) {
    const phase = testPhase(w, date)
    if (phase === 'test_day') notes.push(`${w.test.title} is today – afterwards log the score + every mistake`)
    if (phase === 'light') notes.push(`day before ${w.test.title}: light only for ${w.subjects.join(' + ')}`)
  }
  if (d.budget < 0) notes.push(`homework fills today's study time (${-d.budget} min over)`)
  // (leftover-share fillers aren't listed; a topic that got on the list another way isn't either)
  const seen = new Set<string>()
  const isTestItem = (x: LeftOut) => x.tier <= TIER.test
  const placed = (x: LeftOut) => d.picks.some((p) => p.key === x.key || (!isTestItem(x) && !!x.topicId && p.topicId === x.topicId))
  const later = d.left.filter((x) => !placed(x) && (!SHARE_KINDS.has(x.kind) || x.tier <= TIER.fix))
    .sort((a, b) => slotRank(a) - slotRank(b))
    .filter((x) => { const k = isTestItem(x) ? x.key : x.topicId ?? x.key; if (seen.has(k)) return false; seen.add(k); return true })
  // tests (and homework) are always listed; the rest up to 3 names
  const must = later.filter((x) => x.tier <= TIER.test)
  const rest = later.filter((x) => x.tier > TIER.test)
  const shown = [...must, ...rest.slice(0, Math.max(0, 3 - must.length))]
  if (shown.length) notes.push(`left for another day: ${shown.map((x) => x.title).join(', ')}${later.length > shown.length ? ` (+${later.length - shown.length} more)` : ''}`)

  const picks = [...d.picks.map((p, i) => ({ p, i })).sort((a, b) => a.p.tier - b.p.tier || a.i - b.i).map((x) => x.p), ...passthrough]
  return { picks, mode: day.mode, testMode: nearestTest(windows), notes, left: d.left.filter((x) => !d.picks.some((p) => p.key === x.key)) }

  // ---- placing --------------------------------------------------------------

  /** Round-robin over the tests (nearest first): one pick each, then a second each (≤ 2 a test). The date-bound ones
   *  (the timed practice 3–4 days before, the light day before) go first: they can't move; then the redos of the
   *  tests' mistakes (playbook step 5). */
  function runTests(filter: (c: Candidate) => boolean, tier?: number) {
    const at = testGroups.map(() => 0)
    const noted = testGroups.map(() => false)
    const miss = (gi: number, c: Candidate, r: Placed) => { if (!noted[gi]) { d.leave(c.pick, r === 'full' ? 'room' : 'time'); noted[gi] = true } }
    testGroups.forEach((g, gi) => {
      for (const c of g.cands) {
        if ((c.pick.kind !== 'test_timed' && c.pick.kind !== 'test_light') || !filter(c) || g.placed >= g.quota) continue
        const r = d.place(c, tier)
        if (r === 'placed') g.placed++
        else if (r !== 'unusable') miss(gi, c, r)
      }
    })
    runPool(testRedo, filter, tier)
    for (let more = true; more;) {
      more = false
      testGroups.forEach((g, gi) => {
        while (g.placed < g.quota && at[gi] < g.cands.length) {
          const c = g.cands[at[gi]++]
          if (!filter(c)) continue
          const r = d.place(c, tier)
          if (r === 'placed') { g.placed++; more = true; return }
          if (r === 'unusable') continue
          miss(gi, c, r)
          if (r === 'full') { at[gi] = g.cands.length; return }
        }
      })
    }
  }

  /** In order, up to the pool's daily quota; a pick that doesn't fit is noted once, the next one may still fit. */
  function runPool(p: Pool, filter: (c: Candidate) => boolean, tier?: number) {
    let noted = false
    for (const c of p.cands) {
      if (p.placed >= p.quota) return
      if (!filter(c)) continue
      const r = d.place(c, tier)
      if (r === 'placed') { p.placed++; continue }
      if (r === 'unusable') continue
      if (!noted) { d.leave(c.pick, r === 'full' ? 'room' : 'time'); noted = true }
      if (r === 'full') return
    }
  }

  // ---- the picks ------------------------------------------------------------

  function homeworkPick(h: StudyWorld['homework'][number]): PlanPick {
    const due = dueDate(h.dueAt!)
    const left = daysBetween(date, due)
    const why = left < 0 ? `overdue (was due ${whenText(due, date)})` : left === 0 ? 'due today' : left === 1 ? 'due tomorrow' : `due ${dowShort(due)} ${shortDate(due)}`
    // the subject once ("Physics homework: …" stays as it is); what to open is the task's own details when it has them
    // (his short name counts: "FM homework: …" already names Further Maths; "Physics: forces sheet" isn't "Physics homework: Physics: …")
    const lead = h.subject === 'Further Maths' ? /^(further maths|fm)\b[\s:–-]*/i : h.subject ? new RegExp(`^${h.subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s:–-]*`, 'i') : null
    const named = !!lead && lead.test(h.title)
    const title = /homework/i.test(h.title) ? `${h.subject && !named ? `${h.subject}: ` : ''}${h.title}`
      : `${h.subject ? `${h.subject} homework` : 'Homework'}: ${(named && h.title.replace(lead!, '')) || h.title}`
    const open = h.details?.split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 200) || HOMEWORK_OPEN
    return { key: `task:${h.id}`, kind: 'homework', tier: TIER.homework, subject: h.subject, title, open,
      minutes: h.minutes && h.minutes > 0 ? h.minutes : HOMEWORK_MINUTES, why, done: { kind: 'task', taskId: h.id }, taskId: h.id, heavy: true }
  }

  function reviewCand(t: TrackerTopic): Candidate {
    const n = mistakesOf(t)
    const minutes = n || (t.status === 'not_secure' && !isPhysics(t.subject)) ? 30 : 20
    return cand({ key: `topic:${t.id}:review`, kind: 'review', tier: TIER.review, subject: t.subject, title: `${topicLabel(t)}: review`,
      open: reviewText(t, links, n), url: isPhysics(t.subject) ? linkOf(links.pmtPhysics) : examResource(t, links).url, minutes,
      why: `review due (${dot(t.status)}, last done ${whenText(t.lastDone!, date)})`, done: { kind: 'topic', topicId: t.id }, topicId: t.id }, 20, t.code)
  }

  /** One pick for many redos: a test's (tier 2, key mistakes:<date>:tests) or the rest (tier 3, key mistakes:<date>). */
  function redoCand(due: TrackerMistake[], ofTests: boolean): Candidate | null {
    const key = ofTests ? `mistakes:${date}:tests` : `mistakes:${date}`
    if (!due.length || done.has(key)) return null
    const list = [...due].sort((a, b) => a.reviewOn.localeCompare(b.reviewOn) || a.loggedOn.localeCompare(b.loggedOn) || a.id.localeCompare(b.id)).slice(0, MAX_REDOS)
    const titles = [...new Set(list.map((m) => forTest(m)?.test.title).filter(Boolean))]
    const build = (ms: TrackerMistake[]): PlanPick => {
      const subjects = [...new Set(ms.map(subjectOfMistake))]
      const shown = ms.slice(0, 4).map((m) => [m.code, m.question].filter(Boolean).join(' ') + (m.source ? ` (${m.source})` : '') || m.body).join(' · ')
      const n = ms.length
      return { key, kind: 'mistake_redo', tier: ofTests ? TIER.test : TIER.review, subject: subjects.length === 1 ? subjects[0] : null,
        title: `Redo ${n} ${ofTests ? 'test ' : ''}mistake${n > 1 ? 's' : ''}`, minutes: Math.max(10, Math.min(30, 5 * n)),
        open: `Redo without looking (close it, from scratch): ${shown}${n > 4 ? ` +${n - 4} more` : ''}`,
        why: ofTests ? `${titles.join(' + ')} · redo every wrong question` : `${n} redo${n > 1 ? 's' : ''} due`,
        done: { kind: 'mistakes', mistakeIds: ms.map((m) => m.id) }, heavy: false }
    }
    return { pick: build(list), min: 10, shrink: (m) => build(list.slice(0, Math.max(2, Math.floor(m / 5)))) }
  }

  function fixCand(t: TrackerTopic, minutes: number, tier: PlanPick['tier']): Candidate {
    const m = isPhysics(t.subject) ? Math.min(40, minutes) : minutes
    const ex = examResource(t, links)
    const open = isPhysics(t.subject)
      ? `Fix 🔴: ${t.concepts?.trim() ? `"${t.concepts.trim()}" – ` : ''}PMT notes / one video → explain it out loud in 3 sentences → Isaac Physics`
      : `Fix 🔴: re-learn (notes / Bicen chapter summary) → 5 questions from ${textbookRef(t)} → ${ex.name} → ≥ 80 % = 🟡`
    return cand({ key: `topic:${t.id}:${tier === TIER.fix ? 'fix' : 'fixing'}`, kind: 'fix', tier, subject: t.subject, title: `${topicLabel(t)}: fix 🔴`, open,
      url: isPhysics(t.subject) ? linkOf(links.isaac) : linkOf(links.bicenSummaries) ?? ex.url, minutes: m, steps: fixSteps(t, links, m),
      why: `🔴 taught${t.lastDone ? `, last done ${whenText(t.lastDone, date)}` : ''}`, done: { kind: 'topic', topicId: t.id }, topicId: t.id, heavy: true },
    tier === TIER.fix ? 30 : MIN_SHARE, t.code)
  }

  function aheadCand(t: TrackerTopic, minutes: number): Candidate {
    const prereq = live.filter((x) => x.id !== t.id && x.subject === t.subject && x.strand === t.strand && schoolOrder(x, t) < 0).sort(schoolOrder).pop() ?? null
    const ex = examResource(t, links)
    const build = (m: number): PlanPick => ({ key: `topic:${t.id}:ahead`, kind: 'ahead', tier: TIER.ahead, subject: t.subject, title: `${topicLabel(t)}: ahead session`,
      open: `${textbookRef(t)}: learn it + the worked examples → the exercise (every 2nd question) → fresh questions from ${ex.name} → set its colour (🟡? move on)`,
      url: ex.url, minutes: m, steps: aheadSteps(t, prereq, links, m),
      why: `⏭ next up in school order (taught from ${t.taughtFrom ? `${dowShort(t.taughtFrom)} ${shortDate(t.taughtFrom)}` : 'soon'})${t.status === 'not_secure' ? ' · 🔴' : ''}`,
      done: { kind: 'topic', topicId: t.id, step: 2 }, topicId: t.id, heavy: true })
    return { pick: build(minutes), min: AHEAD_MIN, meta: { code: t.code }, shrink: build }
  }

  function stretchCand(t: TrackerTopic, minutes: number): Candidate {
    const r = stretchResource(t, links)
    return cand({ key: `topic:${t.id}:stretch`, kind: 'stretch', tier: TIER.stretch, subject: t.subject, title: `${topicLabel(t)}: ${r.label}`,
      open: r.open, url: r.url, minutes, why: `🟢 – stretch${t.lastDone ? ` (last done ${whenText(t.lastDone, date)})` : ''}`,
      done: { kind: 'topic', topicId: t.id, step: 6 }, topicId: t.id, heavy: true }, MIN_SHARE, t.code)
  }

  /** The candidates for one share of the leftover, best first. */
  function shareCands(kind: ShareKind | 'stretch', m: number): Candidate[] {
    const taught = live.filter((t) => state(t) === 'taught')
    if (kind === 'ahead') return aheadList.map((t) => aheadCand(t, m))
    if (kind === 'stretch') return stretchList.map((t) => stretchCand(t, m))
    if (kind === 'fixing') {
      const yellow = taught.filter((t) => t.status === 'understand').sort((a, b) => mistakesOf(b) - mistakesOf(a) || byLastDone(a, b) || schoolOrder(a, b))
      const red = taught.filter((t) => t.status === 'not_secure').sort((a, b) => byLastDone(a, b) || schoolOrder(a, b))
      const white = taught.filter((t) => t.status === 'not_started').sort((a, b) => byLastDone(a, b) || schoolOrder(a, b))
      return [...yellow.map((t) => fixingCand(t, m)), ...red.map((t) => fixCand(t, m, TIER.leftover)), ...white.map((t) => rateCand(t, m))]
    }
    if (kind === 'current') {
      const recent = taught.filter((t) => t.status !== 'exam_ready' && (t.taught === 'in_class' || (!!t.taughtFrom && t.taughtFrom <= date && t.taughtFrom >= addDays(date, -14))))
        .sort((a, b) => byLastDone(a, b) || (b.taughtFrom ?? '').localeCompare(a.taughtFrom ?? '') || schoolOrder(a, b))
      return recent.map((t) => currentCand(t, m))
    }
    const old = taught.filter((t) => (t.status === 'understand' || t.status === 'exam_ready') && !isDue(t, date, reviewDays) && t.lastDone !== date)
      .sort((a, b) => byLastDone(a, b) || schoolOrder(a, b))
    return old.map((t) => oldCand(t, m))
  }

  function topicDone(t: TrackerTopic, r: { physics?: 'booklet' | 'pmt'; reaches?: number }): PlanPick['done'] {
    if (r.physics) return { kind: 'topic', topicId: t.id, physics: r.physics }
    if (r.reaches) return { kind: 'topic', topicId: t.id, step: r.reaches }
    return { kind: 'topic', topicId: t.id }
  }

  function fixingCand(t: TrackerTopic, m: number): Candidate {
    const r = fixingResource(t, links)
    const n = mistakesOf(t)
    return cand({ key: `topic:${t.id}:fixing`, kind: 'fix', tier: TIER.leftover, subject: t.subject, title: `${topicLabel(t)}: ${r.label}`, open: r.open, url: r.url, minutes: m,
      why: `🟡 → 🟢${n ? ` · ${n} mistake${n > 1 ? 's' : ''} to fix` : ''}`, topicId: t.id, heavy: true, done: topicDone(t, r) }, MIN_SHARE, t.code)
  }

  function rateCand(t: TrackerTopic, m: number): Candidate {
    if (isPhysics(t.subject)) return currentCand(t, m, 'keepup')
    const ex = examResource(t, links)
    return cand({ key: `topic:${t.id}:rate`, kind: 'fix', tier: TIER.leftover, subject: t.subject, title: `${topicLabel(t)}: rate it`,
      open: `Rate it: 2 fresh questions from ${ex.name}, no notes → set its colour, then carry on with the set`, url: ex.url, minutes: m,
      why: '⚪ taught, not rated yet', done: { kind: 'topic', topicId: t.id }, topicId: t.id, heavy: true }, MIN_SHARE, t.code)
  }

  function currentCand(t: TrackerTopic, m: number, as: 'current' | 'keepup' = 'current'): Candidate {
    const r = nextResource(t, links)
    const why = t.taught === 'in_class' ? 'being taught now – keep up' : `current topic (taught from ${t.taughtFrom ? whenText(t.taughtFrom, date) : 'recently'})`
    return cand({ key: `topic:${t.id}:${as}`, kind: as === 'current' ? 'current' : 'fix', tier: TIER.leftover, subject: t.subject, title: `${topicLabel(t)}: ${r.label}`, open: r.open, url: r.url, minutes: m,
      why: as === 'keepup' ? `⚪ taught, not rated yet · ${why}` : `${why} · ${dot(t.status)}`, topicId: t.id, heavy: true, done: topicDone(t, r) }, MIN_SHARE, t.code)
  }

  function oldCand(t: TrackerTopic, m: number): Candidate {
    return cand({ key: `topic:${t.id}:old`, kind: 'old', tier: TIER.leftover, subject: t.subject, title: `${topicLabel(t)}: keep it fresh`, open: freshText(t, links),
      url: isPhysics(t.subject) ? linkOf(links.pmtPhysics) : examResource(t, links).url, minutes: m,
      why: `keep fresh (${dot(t.status)}${t.lastDone ? `, last done ${whenText(t.lastDone, date)}` : ''})`, done: { kind: 'topic', topicId: t.id }, topicId: t.id }, MIN_SHARE, t.code)
  }

  /** A programme item: its full minutes (STEP 60–90) or not today — never shortened. */
  function programmeCand(p: Programme): Candidate | null {
    const step = nextStep(p)
    if (!step) return null
    const { item, action } = step
    const mins = item.minutes ?? p.minutes
    const title = item.title.toLowerCase().includes(p.name.toLowerCase()) ? item.title : `${p.name}: ${item.title}`
    const open = action === 'test'
      ? `${title}: the chapter TEST first, mark it – only do the chapter if you drop marks`
      : `${title}${item.details ? ` – ${item.details}` : ''}${p.notes ? ` · ${p.notes}` : ''}`
    const left = leftThisWeek(p, date)
    const pick: PlanPick = { key: `prog:${item.id}`, kind: 'programme', tier: TIER.leftover, subject: subjectName(p.subjectId), title: action === 'test' ? `${title}: chapter test` : title,
      open, url: item.url, minutes: mins, why: `${p.name}: ${p.perWeek} a week${p.days ? ` (${p.days})` : ''}${left < p.perWeek ? ` · ${left} left this week` : ''}`,
      done: action === 'test' ? { kind: 'programme_item', itemId: item.id, score: true } : { kind: 'programme_item', itemId: item.id }, programmeItemId: item.id, heavy: true }
    return { pick, min: mins, meta: { programme: p.name } }
  }

  function metaOf(p: PlanPick) {
    const code = p.topicId ? live.find((t) => t.id === p.topicId)?.code ?? null : null
    const programme = p.programmeItemId ? world.programmes.find((x) => x.items.some((i) => i.id === p.programmeItemId))?.name ?? null : null
    return { code, programme }
  }
  function subjectName(id: string | null): string | null {
    if (!id) return null
    return live.find((t) => t.subjectId === id)?.subject ?? world.homework.find((h) => h.subjectId === id)?.subject ?? null
  }
  function subjectOfMistake(m: TrackerMistake): string | null {
    const t = m.topicId ? live.find((x) => x.id === m.topicId) : m.code ? live.find((x) => x.code?.toUpperCase() === m.code!.toUpperCase()) : null
    return t?.subject ?? subjectName(m.subjectId)
  }
}
