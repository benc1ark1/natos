// ACT planner (plans/contracts.md §5): steady mode (no retake date) or countdown mode (a retake date), as ONE pick a
// day for Today (the 10-min grammar flashcards are its first step; on a day with no other ACT work they are a tiny
// pick of their own). It decides WHAT (which section, from the scores vs his goal) and WHICH resource (the next item of
// the right book; a timed section once the books are done). Pure: no database, no clock, no AI.
//
// Steady (no date):   holidays ~75 min a day rotating English / Reading / Maths (weighted to the weakest section vs
//                     the goal), one full timed test a week (actTestDay) + its review the next day;
//                     school weeks 30 min × 3 (actSchoolDays) + the flashcards; other days just the flashcards.
// Countdown (date):   holidays: his ACT time a day (actCountdownHolidayMin, 4 h) as two blocks: a full timed test on
//                     the test days (actMockDays: Tue + Thu) reviewed straight after, else every section timed + marked
//                     (English first, the weakest next) + his misses; the ACT tasks he put on a day are part of its time.
//                     School weeks: every day a timed English section + every miss reviewed against its rule; a timed
//                     Reading or Maths section alternating (weighted to the weaker); a full timed mock on the first
//                     test day and its review the next day. Always: the day before is light (rules + misses list +
//                     sleep), the retake day has nothing timed; tier 2 in the last 21 days, else tier 7.
import { TIER, type DayContext, type Pick, type Tier } from '../plan-items'
import { addDays, daysBetween, dowShort, shortDate } from '../time'
import { isRunning } from '../tracker/programmes'
import type { Programme, ProgrammeItem, TrackerMistake } from '../tracker/types'
import { CHAPTER_MIN, CP_TEST_MIN, PASSAGE_MIN, isPassage, itemShort, itemsOf, roleOf, shortName } from './books'
import { DEFAULT_ACT_SETTINGS } from './config'
import { CORE, SECTION_LABEL, SECTION_LETTER, SECTION_MIN, type ActScore, type ActSection, type ActSettings, type ActWorld, type BookRole } from './types'

/** The countdown is top priority (tier 2) in its last 3 weeks. */
export const COUNTDOWN_TOP_DAYS = 21
const REVIEW_MIN = 15          // mark a timed section + every miss against its rule
const MOCK_REVIEW_MIN = 45     // the day after a full mock (countdown)
const REDO_MIN = 10            // redo the misses that are due (no looking)
const LIGHT_MIN = 20           // the day before the retake
/** A step that redoes due misses (missStep): its pick's key ends ':redo'. */
export const REDO_STEP = /^redo \d+ due /

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

/** Enhanced ACT: the composite is the mean of English, Maths and Reading, rounded (Science is reported separately). */
export function composite(english: number | null, maths: number | null, reading: number | null): number | null {
  if (english == null || maths == null || reading == null) return null
  return Math.round((english + maths + reading) / 3)
}

/** The latest score in each section (any kind: real, practice or one timed section). */
export function latestScores(scores: ActScore[]): Record<ActSection, number | null> {
  const out: Record<ActSection, number | null> = { english: null, maths: null, reading: null, science: null }
  for (const s of scores) for (const k of Object.keys(out) as ActSection[]) if (s[k] != null) out[k] = s[k]
  return out
}

/** Each composite section's gap to the goal (null: no score yet). */
export function gapsOf(scores: ActScore[], goal: number): Record<'english' | 'maths' | 'reading', number | null> {
  const l = latestScores(scores)
  return { english: l.english == null ? null : goal - l.english, maths: l.maths == null ? null : goal - l.maths, reading: l.reading == null ? null : goal - l.reading }
}

/** The section furthest below the goal (ties: English, Reading, Maths). null: no scores yet. */
export function weakest(scores: ActScore[], goal: number): { section: ActSection; score: number; gap: number } | null {
  const l = latestScores(scores)
  let best: { section: ActSection; score: number; gap: number } | null = null
  for (const s of CORE) {
    const v = l[s]
    if (v == null) continue
    if (!best || goal - v > best.gap) best = { section: s, score: v, gap: goal - v }
  }
  return best
}

/** Sections weakest first (by gap to the goal; no score counts as no gap); ties keep `order`. */
export function byNeed(scores: ActScore[], goal: number, order: ActSection[] = CORE): ActSection[] {
  const g = gapsOf(scores, goal) as Record<string, number | null>
  return [...order].sort((a, b) => Math.max(0, g[b] ?? 0) - Math.max(0, g[a] ?? 0) || order.indexOf(a) - order.indexOf(b))
}

/** Reading has stalled: its last three scores are all below the goal and neither later one beats the first. */
export function readingStalled(scores: ActScore[], goal: number): { from: number; to: number } | null {
  const r = scores.map((s) => s.reading).filter((v): v is number => v != null)
  if (r.length < 3) return null
  const [a, b, c] = r.slice(-3)
  return a < goal && b < goal && c < goal && b <= a && c <= a ? { from: a, to: c } : null
}

// ---------------------------------------------------------------------------
// The weekly rhythm: how many days each section gets, and in what order
// ---------------------------------------------------------------------------

/**
 * `slots` days shared between `sections`: one each first (if there are enough days), the rest by need (1 + the gap
 * to the goal; largest remainder), then ordered weakest first, never the same section two days running if avoidable.
 */
export function rotation(sections: ActSection[], scores: ActScore[], goal: number, slots: number): ActSection[] {
  if (slots <= 0 || !sections.length) return []
  const order = byNeed(scores, goal, sections)
  const g = gapsOf(scores, goal) as Record<string, number | null>
  const count = new Map(order.map((s) => [s, 0]))
  let left = slots
  if (slots >= order.length) { for (const s of order) count.set(s, 1); left -= order.length }
  if (left > 0) {
    const w = order.map((s) => 1 + Math.max(0, g[s] ?? 0))
    const total = w.reduce((a, b) => a + b, 0)
    const quota = w.map((x) => (x / total) * left)
    const floor = quota.map(Math.floor)
    order.forEach((s, i) => count.set(s, count.get(s)! + floor[i]))
    let rest = left - floor.reduce((a, b) => a + b, 0)
    const byRem = order.map((s, i) => ({ s, r: quota[i] - floor[i], i })).sort((a, b) => b.r - a.r || a.i - b.i)
    for (const x of byRem) { if (rest <= 0) break; count.set(x.s, count.get(x.s)! + 1); rest-- }
  }
  const out: ActSection[] = []
  for (let i = 0; i < slots; i++) {
    const prev = out.at(-1)
    const cands = order.filter((s) => count.get(s)! > 0)
    const pickOne = cands.filter((s) => s !== prev).sort((a, b) => count.get(b)! - count.get(a)! || order.indexOf(a) - order.indexOf(b))[0]
      ?? cands.sort((a, b) => count.get(b)! - count.get(a)!)[0]
    out.push(pickOne)
    count.set(pickOne, count.get(pickOne)! - 1)
  }
  return out
}

const nextDow = (dow: number) => (dow % 7) + 1
const WEEK = [1, 2, 3, 4, 5, 6, 7]

/** Steady mode: this weekday's ACT, or null (school week, not a session day). */
export function steadyDay(world: ActWorld, day: Pick_<DayContext, 'dow' | 'mode'>): { kind: 'full' } | { kind: 'review' } | { kind: 'section'; section: ActSection } | null {
  const s = world.settings ?? DEFAULT_ACT_SETTINGS
  if (day.mode === 'half_term') {
    if (day.dow === s.fullTestDow) return { kind: 'full' }
    if (day.dow === nextDow(s.fullTestDow)) return { kind: 'review' }
    const days = WEEK.filter((d) => d !== s.fullTestDow && d !== nextDow(s.fullTestDow))
    return { kind: 'section', section: rotation(CORE, world.scores, world.goal, days.length)[days.indexOf(day.dow)] }
  }
  const days = s.schoolDays
  const i = days.indexOf(day.dow)
  return i < 0 ? null : { kind: 'section', section: rotation(CORE, world.scores, world.goal, days.length)[i] }
}

/** Countdown: this weekday's shape (the mock and its review, else English + the alternating section). */
export function countdownDay(world: ActWorld, dow: number): { kind: 'mock' } | { kind: 'mock_review' } | { kind: 'sections'; second: ActSection } {
  const s = world.settings ?? DEFAULT_ACT_SETTINGS
  const mock = s.mockDows[0] ?? 3
  if (dow === mock) return { kind: 'mock' }
  if (dow === nextDow(mock)) return { kind: 'mock_review' }
  const days = WEEK.filter((d) => d !== mock && d !== nextDow(mock))
  return { kind: 'sections', second: rotation(['reading', 'maths'], world.scores, world.goal, days.length)[days.indexOf(dow)] }
}
type Pick_<T, K extends keyof T> = { [P in K]: T[P] }

// ---------------------------------------------------------------------------
// The books
// ---------------------------------------------------------------------------

export const bookFor = (world: ActWorld, role: BookRole) => world.books.find((b) => roleOf(b) === role) ?? null
const running = (b: Programme | null, date: string) => !!b && isRunning(b, date)

/** The next item to work on: gaps_only books first finish a chapter whose test dropped marks ('doing'), then test the next. */
export function nextBookItem(b: Programme): ProgrammeItem | null {
  const items = itemsOf(b)
  if (b.mode === 'gaps_only') return items.find((i) => i.status === 'doing') ?? items.find((i) => i.status === 'todo') ?? null
  return items.find((i) => i.status === 'todo' || i.status === 'doing') ?? null
}

/** College Panda's gaps are closed when every chapter is tested and every dropped-marks chapter is done (or there is no such book). */
export function gapsClosed(world: ActWorld): boolean {
  const cp = bookFor(world, 'maths_gaps')
  return !cp || !itemsOf(cp).some((i) => i.status === 'todo' || i.status === 'doing')
}

/** The Reading guide's method chapters are all done or skipped (or there's no guide). */
export function methodDone(world: ActWorld): boolean {
  const g = bookFor(world, 'reading')
  return !g || !itemsOf(g).some((i) => !isPassage(i) && (i.status === 'todo' || i.status === 'doing'))
}

/** The Critical Reader is in play: he switched it on (mode no longer 'optional'), or reading stalled after the method chapters. */
export function criticalReaderOn(world: ActWorld): boolean {
  const cr = bookFor(world, 'reading_extra')
  return !!cr && (cr.mode !== 'optional' || (!!readingStalled(world.scores, world.goal) && methodDone(world)))
}

const doneCount = (b: Programme) => itemsOf(b).filter((i) => i.status === 'done' || i.status === 'skipped').length

/** One line per book for /act and the brain: what's next and how far he is. */
export function bookLine(world: ActWorld, b: Programme): string {
  const role = roleOf(b)
  const name = shortName(b)
  if (b.status !== 'active') return `${name}: ${b.status}`
  if (b.pausedUntil && world.today <= b.pausedUntil) return `${name}: paused until ${dowShort(b.pausedUntil)} ${shortDate(b.pausedUntil)}`
  if (role === 'flashcards') return `${name}: ${(world.settings ?? DEFAULT_ACT_SETTINGS).flashMin} min a day`
  const items = itemsOf(b)
  const next = nextBookItem(b)
  if (role === 'maths_gaps') {
    const tested = items.filter((i) => i.status !== 'todo').length
    const toDo = items.filter((i) => i.status === 'doing').length
    if (!next) return `${name}: all gaps closed ✓ (${items.length} chapters)`
    const what = next.status === 'doing' ? `${itemShort(next)}: do the chapter${next.result ? ` (${next.result.replace(/\s*·.*$/, '')})` : ''}` : `${itemShort(next)} chapter test`
    return `${name}: ${what} · ${tested}/${items.length} tested${toDo ? `, ${toDo} to do` : ''}`
  }
  if (role === 'maths_hard' && !gapsClosed(world)) return `${name}: after the College Panda gaps (${items.length} chapters)`
  if (role === 'reading_extra' && !criticalReaderOn(world)) return `${name}: only if your reading stalls`
  if (!next) return `${name}: finished ✓`
  const stall = role === 'reading_extra' && b.mode === 'optional' ? readingStalled(world.scores, world.goal) : null   // (in play only with method chapters done)
  return `${name}: ${itemShort(next)} (${doneCount(b)}/${items.length} done${stall ? `; reading stalled ${stall.from} → ${stall.to}` : ''})`
}

// ---------------------------------------------------------------------------
// Misses
// ---------------------------------------------------------------------------

/** "ACT English · practice test 3" → english. */
export function missSection(m: Pick_<TrackerMistake, 'source'>): ActSection | null {
  const v = (m.source ?? '').toLowerCase()
  return /\benglish\b/.test(v) ? 'english' : /\bmaths?\b/.test(v) ? 'maths' : /\breading\b/.test(v) ? 'reading' : /\bscience\b/.test(v) ? 'science' : null
}
export const dueMisses = (world: ActWorld, date: string, section?: ActSection) =>
  world.misses.filter((m) => m.redoStage < 2 && m.reviewOn <= date && (!section || missSection(m) === section))
/** The distinct rules on his open misses, most recent first. */
export const rulesOf = (misses: TrackerMistake[]) => [...new Set([...misses].reverse().map((m) => (m.rule ?? '').trim()).filter(Boolean))]
const ruleList = (rules: string[], n = 3) => rules.slice(0, n).join(', ') + (rules.length > n ? ` (+${rules.length - n} more)` : '')

// ---------------------------------------------------------------------------
// Today's pick
// ---------------------------------------------------------------------------

type Step = { minutes: number; what: string }
type Work = { title: string; open: string; steps: Step[]; why?: string; done: Pick['done']; itemId?: string | null; key: string; heavy?: boolean }

const scoreWhy = (world: ActWorld, section: ActSection) => {
  const w = weakest(world.scores, world.goal)
  const l = latestScores(world.scores)[section]
  if (w && w.section === section && w.gap > 0) return `weakest: ${SECTION_LABEL[section]} ${w.score} vs ${world.goal}`
  if (l != null) return `${SECTION_LABEL[section]} ${l} vs ${world.goal} · rotation`
  return `rotation (no ${SECTION_LABEL[section]} score yet)`
}

/** The section's work: the next item of the right book, or (books done) a timed section from an official practice test. */
function sectionWork(world: ActWorld, section: ActSection, workMin: number, date: string): Work {
  const label = SECTION_LABEL[section]
  const book = (role: BookRole) => { const b = bookFor(world, role); return b && running(b, date) ? b : null }
  const fromBook = (b: Programme, item: ProgrammeItem, why?: string): Work => {
    const name = shortName(b)
    const role = roleOf(b)
    const itemMin = item.minutes ?? CHAPTER_MIN
    const later = workMin < itemMin ? ' (finish it next session)' : ''
    const steps: Step[] = []
    let title: string, open: string
    if (role === 'maths_gaps' && item.status === 'todo') {
      title = `ACT Maths · ${name} ${itemShort(item)} test`
      open = `${b.name} → ${item.title}: chapter test first (timed, ~${CP_TEST_MIN} min). Full marks = skip the chapter; dropped marks = the chapter + its workbook questions`
      steps.push({ minutes: CP_TEST_MIN, what: `${itemShort(item)} chapter test (timed), mark it` })
      const left = Math.max(10, Math.min(itemMin, workMin - CP_TEST_MIN))
      steps.push({ minutes: left, what: `dropped marks → the chapter + workbook questions${workMin - CP_TEST_MIN < itemMin ? ' (finish next session)' : ''}; full marks → the next chapter’s test` })
    } else if (role === 'maths_gaps') {
      title = `ACT Maths · ${name} ${itemShort(item)}`
      const test = item.result ? ` (${item.result.replace(/\s*·.*$/, '')})` : ''
      open = `${b.name} → ${item.title}: the chapter + its workbook questions${test}`
      steps.push({ minutes: Math.min(itemMin, workMin), what: `${itemShort(item)}: the chapter + workbook questions${later}` })
      const nextTest = itemsOf(b).find((i) => i.status === 'todo')
      if (nextTest && workMin - itemMin >= CP_TEST_MIN) steps.push({ minutes: CP_TEST_MIN, what: `then the ${itemShort(nextTest)} chapter test (timed)` })
    } else {
      title = `ACT ${label} · ${name} ${itemShort(item)}`
      const passage = isPassage(item)
      open = `${b.name} → ${item.title}${passage ? `: 3 passages, ~${PASSAGE_MIN} min each, timed; then every wrong answer back to the text` : section === 'english' ? ' + its exercises: mark straight after, log each miss with its grammar rule' : ' + its questions: check every wrong answer against the text'}`
      steps.push({ minutes: Math.min(itemMin, workMin), what: `${itemShort(item)}${passage ? ': timed passages + review' : section === 'english' ? ' + exercises (log each miss with its rule)' : ' + its questions'}${later}` })
    }
    // what one tap on Today means: a chapter test asks for its score (full marks = skip the chapter); a session shorter
    // than the chapter only ticks the block (the chapter is done when he says so); else the chapter is done
    if (role === 'maths_gaps' && item.status === 'todo') {
      return { title, open, steps, why, done: { kind: 'programme_item', itemId: item.id, score: true }, itemId: item.id, key: `act:${section}:test` }
    }
    if (workMin < itemMin) {
      return { title, open: `${open}. Not finished? Carry on next session; done → “finished ${name} ${itemShort(item)}”`, steps, why, done: { kind: 'block' }, itemId: null, key: `act:${section}:part` }
    }
    return { title, open, steps, why, done: { kind: 'programme_item', itemId: item.id }, itemId: item.id, key: `act:${section}:book` }
  }
  const timed = (): Work => ({
    title: `ACT ${label} · timed section`,
    open: `Your next official ACT practice test: the ${label} section, timed (${SECTION_MIN[section]} min); mark it, then every miss against its rule`,
    steps: [{ minutes: SECTION_MIN[section], what: `timed ${label} section (${SECTION_MIN[section]} min)` }],
    done: { kind: 'act', section }, key: `act:${section}:timed`, heavy: true,
  })

  if (section === 'english') {
    const b = book('english'), item = b && nextBookItem(b)
    return b && item ? fromBook(b, item) : timed()
  }
  if (section === 'reading') {
    // the Reading guide stays the main book: with the Critical Reader in play, one CR chapter for every two guide items
    // (stalled: two passage sets; switched on by him: any two guide items); the CR alone once the guide is finished
    const cr = book('reading_extra'), crItem = cr && nextBookItem(cr)
    const b = book('reading'), item = b && nextBookItem(b)
    if (cr && crItem && criticalReaderOn(world)) {
      const stalled = cr.mode === 'optional' ? readingStalled(world.scores, world.goal) : null
      const guideDone = b ? itemsOf(b).filter((i) => (i.status === 'done' || i.status === 'skipped') && (!stalled || isPassage(i))).length : 0
      const crDone = itemsOf(cr).filter((i) => i.status === 'done' || i.status === 'skipped').length
      if (!item || crDone * 2 <= guideDone) return fromBook(cr, crItem, stalled ? `reading stalled (${stalled.from} → ${stalled.to}): a Critical Reader chapter` : 'Critical Reader: switched on')
    }
    return b && item ? fromBook(b, item) : timed()
  }
  if (section === 'maths') {
    const cp = book('maths_gaps'), cpItem = cp && nextBookItem(cp)
    if (cp && cpItem) return fromBook(cp, cpItem)
    const adv = book('maths_hard'), advItem = adv && nextBookItem(adv)
    if (adv && advItem && gapsClosed(world)) return fromBook(adv, advItem, 'College Panda gaps closed: the hard questions now')
    return timed()
  }
  return timed()
}

/** The flashcards are on: the programme is there and running, and the setting isn't 0. */
function flashcards(world: ActWorld, date: string): Step | null {
  const s = world.settings ?? DEFAULT_ACT_SETTINGS
  const b = bookFor(world, 'flashcards')
  return b && running(b, date) && s.flashMin > 0 ? { minutes: s.flashMin, what: 'grammar flashcards (Anki): today’s due cards' } : null
}

const sum = (steps: Step[]) => steps.reduce((n, x) => n + x.minutes, 0)

/** The misses step: redo the ones due (no looking), else re-read the rules (only if there are misses). */
function missStep(world: ActWorld, date: string, section: ActSection | null, minutes: number): Step | null {
  const pool = section ? world.misses.filter((m) => missSection(m) === section) : world.misses
  if (!pool.length || minutes < 5) return null
  const due = dueMisses(world, date, section ?? undefined)
  const rules = rulesOf(due.length ? due : pool)
  const which = section ? `${SECTION_LABEL[section]} ` : ''
  return due.length
    ? { minutes, what: `redo ${due.length} due ${which}miss${due.length > 1 ? 'es' : ''} without looking (${ruleList(rules)})` }
    : { minutes, what: `re-read your ${which}rules list (${ruleList(rules)})` }
}

export function fullTestMin(world: Pick_<ActWorld, 'settings'>) {
  const s = world.settings ?? DEFAULT_ACT_SETTINGS
  return SECTION_MIN.english + SECTION_MIN.maths + SECTION_MIN.reading + (s.science ? SECTION_MIN.science : 0)
}
const fullTestOpen = (world: ActWorld) => {
  const s = world.settings ?? DEFAULT_ACT_SETTINGS
  return `Your next official ACT practice test, timed in one sitting: English 35 · Maths 50 · Reading 40${s.science ? ' · Science 40' : ''} min. Then send “ACT practice: E.. M.. R..${s.science ? ' S..' : ''}”`
}

/** Never more than the time he has today (when it's known): optional groups go, last first; the main work stays. */
function fit(steps: Step[], optional: Step[][], budget: number): Step[] {
  let out = [...steps]
  for (const group of [...optional].reverse()) if (sum(out) > budget) out = out.filter((x) => !group.includes(x))
  return out
}

/** Today's ACT work: at most one line (the flashcards folded in as its first step), or nothing. */
export function actPicks(world: ActWorld, day: DayContext): Pick[] {
  const s = world.settings ?? DEFAULT_ACT_SETTINGS
  const date = day.date
  const retake = world.retake && world.retake.date >= date ? world.retake : null
  if (!retake && !world.books.length) return []          // nothing set up yet: no ACT
  const done = date === world.today ? world.doneToday : []   // what's done counts for today only (a plan for another day ignores it)
  // ACT work already done today (on a holiday test day the test's score comes before its review: see holidayCountdown)
  if (done.includes('act:day') && !(retake && day.mode === 'half_term')) return []

  const flash = flashcards(world, date)
  const budget = day.studyMinutes > 0 ? day.studyMinutes - (flash?.minutes ?? 0) : Infinity
  const base = { kind: 'act' as const, subject: 'ACT', goalId: retake?.goalId ?? null, taskId: null, topicId: null }
  const make = (w: Work, tier: Tier, opts: { optional?: Step[][]; noFlash?: boolean } = {}): Pick[] => {
    const steps = [...(flash && !opts.noFlash ? [flash] : []), ...fit(w.steps, opts.optional ?? [], budget)]
    // a pick that redoes due misses says so in its key (':redo'), so ticking it moves exactly those misses on (markActPickDone)
    const key = steps.some((x) => REDO_STEP.test(x.what)) ? `${w.key}:redo` : w.key
    if (done.includes(key) || done.includes(w.key)) return []
    return [{ ...base, key, tier, title: w.title, open: w.open, minutes: sum(steps), steps, why: w.why ?? '', done: w.done, programmeItemId: w.itemId ?? null, heavy: !!w.heavy }]
  }

  // ---- countdown (a retake date)
  if (retake) {
    const left = daysBetween(date, retake.date)
    const tier: Tier = left <= COUNTDOWN_TOP_DAYS ? TIER.test : TIER.leftover
    const when = left === 1 ? 'retake tomorrow' : `retake in ${left} days`
    const w = weakest(world.scores, world.goal)
    const why = `${when}${w && w.gap > 0 ? ` · weakest: ${SECTION_LABEL[w.section]} ${w.score} vs ${world.goal}` : ''}`
    if (left === 0) {
      return make({ key: 'act:test:day', title: 'ACT retake today 🍀', open: 'Nothing new: a few easy flashcards to warm up, then go. Afterwards send “real ACT: E.. M.. R.. S..”',
        // (15 min: long enough to have its own place in the day, so the retake is never left off Today or the week)
        steps: [{ minutes: 15, what: 'warm-up: a few easy flashcards, nothing new' }], why: 'today’s the retake', done: { kind: 'act', section: 'full' } }, TIER.test, { noFlash: true })
    }
    if (left === 1) {
      const rules = rulesOf(world.misses)
      return make({
        key: 'act:light:eve', title: 'ACT eve: rules + misses, early night',
        open: `Light: read your rules list${rules.length ? ` (${ruleList(rules, 4)})` : ''} and your misses list (${world.misses.length} open). Nothing timed. Pack for tomorrow, early night`,
        steps: [{ minutes: LIGHT_MIN, what: 'rules list + misses list, nothing timed' }], why: 'the day before: light, then sleep', done: { kind: 'act', section: 'review' },
      }, TIER.test)
    }
    if (day.mode === 'half_term') return holidayCountdown(world, day, { flash, tier, when, why, make })
    const shape = countdownDay(world, day.dow)
    if (shape.kind === 'mock') {
      return make({ key: 'act:full:mock', title: 'ACT mock: full timed test', open: fullTestOpen(world), steps: [{ minutes: fullTestMin(world), what: 'full timed mock, one sitting' }],
        why: `${when} · the weekly mock (review tomorrow)`, done: { kind: 'act', section: 'full' }, heavy: true }, tier)
    }
    const english: Step[] = [
      { minutes: SECTION_MIN.english, what: `timed English section (${SECTION_MIN.english} min)` },
      { minutes: REVIEW_MIN, what: 'mark it: every miss against its rule (log each: “ACT miss: english Q12 comma splice — …”)' },
    ]
    const redo = dueMisses(world, date).length ? missStep(world, date, null, REDO_MIN) : null
    const redoSteps = redo ? [redo] : []
    if (shape.kind === 'mock_review') {
      const review: Step = { minutes: MOCK_REVIEW_MIN, what: 'review yesterday’s mock: every miss → its rule or reason, logged' }
      return make({ key: 'act:english:timed', title: 'ACT countdown: timed English + mock review',
        open: `Your next official practice test: the English section (timed, ${SECTION_MIN.english} min) → mark it, every miss against its rule. Then yesterday’s mock: every miss logged with its rule`,
        steps: [...english, review, ...redoSteps], why, done: { kind: 'act', section: 'english' }, heavy: true }, tier, { optional: [redoSteps] })
    }
    const second = shape.second, label = SECTION_LABEL[second]
    const timedSecond: Step = { minutes: SECTION_MIN[second], what: `timed ${label} section (${SECTION_MIN[second]} min)` }
    const review2 = (m: number): Step => ({ minutes: m, what: `mark it: every ${label} miss → why, logged` })
    const englishShort: Step[] = [english[0], { ...english[1], minutes: 10 }]
    // a short day: shorten the reviews before the alternating section goes (so the weaker of Reading / Maths is never
    // the one squeezed out all week); only if even that doesn't fit is it English (+ redos) alone
    const variants: Step[][] = [
      [...english, timedSecond, review2(REVIEW_MIN), ...redoSteps],
      [...english, timedSecond, review2(REVIEW_MIN)],
      [...english, timedSecond, review2(5)],
      [...englishShort, timedSecond, review2(5)],
      [...english, ...redoSteps],
      english,
    ]
    const steps = variants.find((v) => sum(v) <= budget) ?? english
    const fits = steps.includes(timedSecond)
    return make({ key: 'act:english:timed', title: fits ? `ACT countdown: timed English + ${label}` : 'ACT countdown: timed English',
      open: `Your next official practice test: English section (timed, ${SECTION_MIN.english} min) → mark, every miss against its rule${fits ? ` → ${label} section (timed, ${SECTION_MIN[second]} min) → mark + review` : ''}`,
      steps, why: fits ? why : `${why} · no time for ${label} today`, done: { kind: 'act', section: 'english' }, heavy: true }, tier)
  }

  // ---- steady (no retake date)
  const shape = steadyDay(world, day)
  if (!shape) {
    if (!flash || done.includes('act:flashcards:daily')) return []
    return [{ ...base, kind: 'flashcards', key: 'act:flashcards:daily', tier: TIER.leftover, title: 'ACT grammar flashcards', open: 'Anki: your ACT grammar deck (the cards due today)',
      minutes: flash.minutes, steps: [flash], why: `daily ${flash.minutes} min (no ACT session today)`, done: { kind: 'act', section: 'flashcards' }, programmeItemId: null, heavy: false }]
  }
  if (shape.kind === 'full') {
    return make({ key: 'act:full:test', title: 'ACT full practice test (timed)', open: fullTestOpen(world), steps: [{ minutes: fullTestMin(world), what: 'full timed test, one sitting' }],
      why: 'the weekly full test (review tomorrow)', done: { kind: 'act', section: 'full' }, heavy: true }, TIER.leftover)
  }
  if (shape.kind === 'review') {
    const minutes = Math.max(30, s.halfTermMin - (flash?.minutes ?? 0))
    return make({ key: 'act:review:full', title: 'ACT: review the practice test',
      open: 'Yesterday’s full test: every miss → its rule or reason, logged (“ACT miss: english Q12 comma splice — …”); redo the ones you can’t explain',
      steps: [{ minutes, what: 'every miss of yesterday’s test, logged with its rule' }], why: 'the day after the full test', done: { kind: 'act', section: 'review' } }, TIER.leftover)
  }
  const section = shape.section
  const workMin = day.mode === 'half_term' ? Math.max(20, s.halfTermMin - (flash?.minutes ?? 0)) : s.schoolMin
  const w = sectionWork(world, section, workMin, date)
  let steps = w.steps
  if (w.heavy) steps = [...steps, { minutes: Math.max(10, Math.min(30, workMin - sum(steps))), what: 'mark it: every miss against its rule, logged' }]
  const rest = workMin - sum(steps)
  const extra = rest >= 10 ? missStep(world, date, section, rest) : null
  if (extra) steps = [...steps, extra]
  else if (rest > 0) steps = [...steps.slice(0, -1), { ...steps.at(-1)!, minutes: steps.at(-1)!.minutes + rest }]   // the spare minutes go to the main work
  return make({ ...w, steps, why: w.why ?? scoreWhy(world, section) }, TIER.leftover, { optional: extra ? [[extra]] : [] })
}

/**
 * A holiday in the countdown: his ACT time for the day (4 h), minus the ACT tasks he put on this day, as two blocks (one
 * block can't be longer than 4 h, and a break between them helps): a test day is the full timed test, then its review
 * straight after; any other day is every section timed and marked (English first, then the weakest), then his misses.
 */
function holidayCountdown(world: ActWorld, day: DayContext, x: { flash: Step | null; tier: Tier; when: string; why: string; make: (w: Work, tier: Tier, opts?: { optional?: Step[][]; noFlash?: boolean }) => Pick[] }): Pick[] {
  const s = world.settings ?? DEFAULT_ACT_SETTINGS
  const date = day.date
  const total = Math.min(s.countdownHolidayMin, day.studyMinutes > 0 ? day.studyMinutes : Infinity) - (day.actTaskMin ?? 0)
  const room = total - (x.flash?.minutes ?? 0)
  if (room < 30) {
    // his own ACT tasks fill today's ACT time: just the flashcards with them
    return x.flash ? x.make({ key: 'act:flashcards:daily', title: 'ACT grammar flashcards', open: 'Anki: your ACT grammar deck (the cards due today)', steps: [], why: `${x.when} · your ACT tasks fill the rest of today’s ACT time`, done: { kind: 'act', section: 'flashcards' } }, x.tier) : []
  }
  const due = dueMisses(world, date)
  const full = fullTestMin(world)
  const dayDone = date === world.today && world.doneToday.includes('act:day')   // a score logged (the test) or a chapter done today
  if (s.mockDows.includes(day.dow) && room >= full + 30) {
    const test = dayDone ? [] : x.make({ key: 'act:full:mock', title: 'ACT full timed test', open: fullTestOpen(world), steps: [{ minutes: full, what: 'full timed test, one sitting' }],
      why: `${x.when} · a test day: review it straight after`, done: { kind: 'act', section: 'full' }, heavy: true }, x.tier, { noFlash: true })
    const left = room - full
    const redo = due.length && left >= MOCK_REVIEW_MIN + REDO_MIN ? missStep(world, date, null, REDO_MIN) : null
    const review: Step = { minutes: left - (redo?.minutes ?? 0), what: 'review the test straight after: every miss → its rule or reason, logged (“ACT miss: english Q12 comma splice — …”)' }
    const after = test[0]?.key
    return [...test, ...x.make({ key: 'act:review:mock', title: 'ACT: review today’s test',
      open: 'Straight after the test: mark it, then every miss → its rule or reason, logged; redo the ones you can’t explain. Then send “ACT practice: E.. M.. R..”',
      steps: [review, ...(redo ? [redo] : [])], why: `${x.when} · the review straight after the test`, done: { kind: 'act', section: 'review' } }, x.tier)
      .map((p) => (after ? { ...p, after } : p))]   // placed after the test, never before it
  }
  if (dayDone) return []
  // every section, timed and marked: English first, then the weakest of the others
  const order: ActSection[] = ['english', ...byNeed(world.scores, world.goal, ['reading', 'maths']), ...(s.science ? ['science' as ActSection] : [])]
  const pair = (sec: ActSection): Step[] => [
    { minutes: SECTION_MIN[sec], what: `timed ${SECTION_LABEL[sec]} section (${SECTION_MIN[sec]} min)` },
    { minutes: REVIEW_MIN, what: `mark it: every ${SECTION_LABEL[sec]} miss against its rule, logged` },
  ]
  let a = [...pair(order[0]), ...pair(order[1])]
  let rest = order.slice(2)
  // misses that are due are always redone (their 10 min come before Science)
  const redoMin = due.length ? REDO_MIN : 0
  const sizeOf = (r: ActSection[]) => r.reduce((n, sec) => n + SECTION_MIN[sec] + REVIEW_MIN, 0)
  while (rest.length && sum(a) + sizeOf(rest) + redoMin > room) rest = rest.slice(0, -1)   // a short day: Science goes first
  if (sum(a) > room) a = pair('english')
  let b: Step[] = rest.flatMap(pair)
  const spare = room - sum(a) - sum(b)
  const misses = spare >= 10 ? missStep(world, date, null, Math.min(spare, 45)) : null
  if (misses) b = [...b, misses]
  const label = (r: ActSection[]) => r.map((sec) => SECTION_LABEL[sec]).join(' + ')
  const shownA = a.length > 2 ? [order[0], order[1]] : [order[0]]
  const first = x.make({ key: 'act:english:timed', title: `ACT: timed ${label(shownA)}`,
    open: `Your next official practice test, section by section: ${shownA.map((sec) => `${SECTION_LABEL[sec]} (timed, ${SECTION_MIN[sec]} min)`).join(' → ')}, each marked against its rules`,
    steps: a, why: x.why, done: { kind: 'act', section: 'english' }, heavy: true }, x.tier)
  if (!b.length) return first
  return [...first, ...x.make({ key: `act:sections:${rest[0] ?? 'misses'}`, title: rest.length ? `ACT: timed ${label(rest)}${misses ? ' + misses' : ''}` : 'ACT: your misses',
    open: rest.length ? `${rest.map((sec) => `${SECTION_LABEL[sec]} (timed, ${SECTION_MIN[sec]} min)`).join(' → ')}, each marked; then your misses` : 'Your ACT misses: redo the due ones without looking, re-read the rules',
    steps: b, why: x.why, done: { kind: 'act', section: rest[0] ?? 'review' }, heavy: rest.length > 0 }, x.tier, { noFlash: true })]
}

// ---------------------------------------------------------------------------
// For /act and the brain
// ---------------------------------------------------------------------------

export type ActMode = { mode: 'steady' } | { mode: 'countdown'; date: string; daysLeft: number; topFrom: string }
export function actMode(world: Pick_<ActWorld, 'retake' | 'today'>): ActMode {
  if (!world.retake || world.retake.date < world.today) return { mode: 'steady' }
  const daysLeft = daysBetween(world.today, world.retake.date)
  return { mode: 'countdown', date: world.retake.date, daysLeft, topFrom: addDays(world.retake.date, -COUNTDOWN_TOP_DAYS) }
}

/** "E33 M35 R34 S32" */
export const scoreText = (s: Pick_<ActScore, 'english' | 'maths' | 'reading' | 'science'>) =>
  (['english', 'maths', 'reading', 'science'] as ActSection[]).filter((k) => s[k] != null).map((k) => `${SECTION_LETTER[k]}${s[k]}`).join(' ')
