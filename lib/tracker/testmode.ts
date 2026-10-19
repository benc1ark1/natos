// Test mode (plans/contracts.md §3.4 step 3, "Start here" SCHOOL TEST playbook): a test ≤ 3 weeks away takes over.
//   1) diagnostic first (1–2 fresh Qs per topic, no notes → colour each)  2) teacher booklets first, 🔴 topics first
//   3) gaps → that topic's exam questions (final 2 weeks ≈ 70 % exam Qs · 20 % targeted relearning · 10 % stretch)
//   4) 3–4 days before: one timed practice at real length  5) redo every wrong question 3 days later (mistake redos)
//   6) day before: light – that test's mistakes + formula booklet, sleep (nothing heavy in its subject)  7) after it:
//   score + mistakes. A consolidation with "X min/day" is one daily slot (half-term: the most, school: the least).
// Limits ("no momentum") are shown on every pick. ACT comes from lib/act (in `extra`). Pure: no database, no clock.
import type { Pick as PlanPick } from '../plan-items'
import { TIER } from '../plan-items'
import { addDays, daysBetween, dowShort, shortDate } from '../time'
import { escRe, examResource, fixSteps, isPhysics, linkOf, physicsResource, scaleSteps, shortName, stretchResource, textbookRef, topicLabel, type Step } from './ladder'
import { taughtState } from './rules'
import type { PickMeta } from './rulesets'
import { COLOUR_DOT, type Colour, type TestKind, type TrackerLinks, type TrackerMistake, type TrackerTest, type TrackerTopic } from './types'

/** A pick the planner may place: `min` = the fewest minutes it still works with; `shrink` makes a shorter version. */
export type Candidate = { pick: PlanPick; min: number; meta?: PickMeta; shrink?: (minutes: number) => PlanPick }

export const TEST_WINDOW_DAYS = 21
export const FINAL_DAYS = 14
export const TEST_KINDS: TestKind[] = ['test', 'consolidation', 'paper', 'mock']
export const PER_TEST_PER_DAY = 2

export type TestWindow = { test: TrackerTest; daysLeft: number; topics: TrackerTopic[]; subjects: string[] }
export type Phase = 'test_day' | 'light' | 'consolidation' | 'timed' | 'diagnostic' | 'booklet' | 'topics'

const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase()

/** The tracker topics a test names (its codes, in its order); a consolidation also gets the topics of its mistakes. */
export function testTopicsOf(test: TrackerTest, topics: TrackerTopic[], mistakes: TrackerMistake[] = []): TrackerTopic[] {
  const codes = [...test.topicCodes]
  if (test.kind === 'consolidation') for (const m of mistakes) if (m.goalId === test.id && m.code) codes.push(m.code)
  const out: TrackerTopic[] = []
  for (const c of codes) {
    const t = topics.find((x) => x.code && up(x.code) === up(c))
    if (t && !out.includes(t)) out.push(t)
  }
  for (const m of mistakes) {
    if (test.kind !== 'consolidation' || m.goalId !== test.id || !m.topicId) continue
    const t = topics.find((x) => x.id === m.topicId)
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Live tests from today to 3 weeks ahead (not ACT), nearest first. */
export function testsInWindow(world: { tests: TrackerTest[]; topics: TrackerTopic[]; mistakes: TrackerMistake[] }, date: string, days = TEST_WINDOW_DAYS): TestWindow[] {
  return world.tests
    .filter((t) => TEST_KINDS.includes(t.kind) && t.date && t.date >= date && daysBetween(date, t.date) <= days)
    .map((test) => {
      const topics = testTopicsOf(test, world.topics, world.mistakes)
      const subjects = [...new Set([test.subject, ...topics.map((t) => t.subject)].filter((s): s is string => !!s))]
      return { test, daysLeft: daysBetween(date, test.date!), topics, subjects }
    })
    .sort((a, b) => a.daysLeft - b.daysLeft || a.test.title.localeCompare(b.test.title) || a.test.id.localeCompare(b.test.id))
}

/** The nearest test within 3 weeks, for the "🔥 Test mode" lines (a real test / paper / mock before a consolidation). */
export function nearestTest(windows: TestWindow[]): { goalId: string; title: string; daysLeft: number } | null {
  const w = windows.find((x) => x.test.kind !== 'consolidation') ?? windows[0]
  return w ? { goalId: w.test.id, title: w.test.title, daysLeft: w.daysLeft } : null
}

const hasAttempt = (t: TrackerTest, what: string[]) => t.attempts.some((a) => what.includes(a.what))
/** A timed practice (or past paper) in the last 3 days. */
export const timedRecently = (t: TrackerTest, date: string) =>
  t.attempts.some((a) => (a.what === 'timed' || a.what === 'paper') && a.doneOn <= date && a.doneOn >= addDays(date, -3))
/** Diagnosed: a diagnostic, timed practice, paper or the real test already tells the colours. */
export const diagnosed = (t: TrackerTest) => hasAttempt(t, ['diagnostic', 'timed', 'paper', 'real'])
const hasSlot = (t: TrackerTest) => t.kind === 'consolidation' && !!(t.minutesPerDay || t.minutesMax)

/** Is this topic's teacher booklet done? Physics: its booklet column; any test: a booklet attempt whose label names its
 *  code (a booklet pick's tick saves the topic code as the label), or a booklet attempt naming none of the test's
 *  codes (he logged "HT2 booklets done") = all its booklets. */
export function bookletDone(test: TrackerTest, topic: TrackerTopic | null): boolean {
  if (topic && isPhysics(topic.subject) && topic.booklet === 'done') return true
  const tries = test.attempts.filter((a) => a.what === 'booklet')
  if (!tries.length) return false
  const known = [...new Set([...test.topicCodes, topic?.code ?? ''].map(up).filter(Boolean))]
  const named = (label: string | null) => known.filter((c) => new RegExp(`(^|[^A-Z0-9])${escRe(c)}([^A-Z0-9]|$)`).test(up(label)))
  if (tries.some((a) => !named(a.label).length)) return true
  return !!topic?.code && tries.some((a) => named(a.label).includes(up(topic.code)))
}

/** Where today's test work is. */
export function testPhase(w: TestWindow, date: string): Phase {
  const { test, daysLeft } = w
  if (daysLeft <= 0) return 'test_day'
  if (hasSlot(test)) return 'consolidation'
  if (daysLeft === 1) return 'light'
  if (daysLeft >= 3 && daysLeft <= 4 && !timedRecently(test, date)) return 'timed'
  if (daysLeft >= 5 && !diagnosed(test)) return 'diagnostic'
  if (bookletTopics(w).length || (!w.topics.length && !bookletDone(test, null))) return 'booklet'
  return 'topics'
}

/** Subjects that are light today: the day before a test, nothing heavy in its subjects (test.subject + its topics'). */
export function lightSubjects(windows: TestWindow[], date: string): Map<string, TestWindow> {
  const out = new Map<string, TestWindow>()
  for (const w of windows) if (testPhase(w, date) === 'light') for (const s of w.subjects) if (!out.has(s.toLowerCase())) out.set(s.toLowerCase(), w)
  return out
}

const RANK: Record<Colour, number> = { not_secure: 0, understand: 1, not_started: 2, exam_ready: 3 }
/** Test topics in the order the playbook wants: 🔴 → 🟡 → ⚪ → 🟢; taught first; least recently done first; the test's order. */
export function orderedTestTopics(w: TestWindow, date: string): TrackerTopic[] {
  const pos = new Map(w.topics.map((t, i) => [t.id, i]))
  const taught = (t: TrackerTopic) => (taughtState(t, date) === 'taught' ? 0 : 1)
  return [...w.topics].sort((a, b) => RANK[a.status] - RANK[b.status] || taught(a) - taught(b)
    || (a.lastDone ?? '').localeCompare(b.lastDone ?? '') || pos.get(a.id)! - pos.get(b.id)!)
}

/** The topics whose booklet is still to do (🔴 first; 🟢 last — the teacher booklet comes first for every test topic). */
export const bookletTopics = (w: TestWindow, date?: string) =>
  (date ? orderedTestTopics(w, date) : w.topics).filter((t) => !bookletDone(w.test, t))

/** Topic work for a test: the rulebook spends test time on 🔴/🟡 only — 🔴 → 🟡 → ⚪ (not rated yet); a 🟢 topic gets
 *  no topic work of its own (only the 10 % stretch inside the final-two-weeks picks). Teacher booklet first: only
 *  topics whose booklet is done. */
export const workTopics = (w: TestWindow, date: string) =>
  orderedTestTopics(w, date).filter((t) => t.status !== 'exam_ready' && bookletDone(w.test, t))

/** "Booklet: Matrices and Matrix Transformations" for a topic, from the test's info ("PC1-01: Booklet: …" lines), else
 *  the info's booklet sentence ("Booklets on Classroom ('HT2 Test Information')"), else "the teacher booklet". */
export function bookletFor(test: TrackerTest, topic: TrackerTopic | null): string {
  const info = test.info ?? ''
  if (topic?.code) {
    const re = new RegExp(`(^|[\\s(])${escRe(topic.code)}\\b\\s*[:–\\-]\\s*(.+)$`, 'im')
    const m = info.match(re)
    if (m && /\S/.test(m[2])) return m[2].trim().replace(/[.;]\s*$/, '')
  }
  const sentence = infoSentences(test).find((s) => /booklet/i.test(s) && !/^[A-Z]{1,3}\d?[-.]?\d+[A-Z]?\b/.test(s))
  if (sentence) {
    const named = sentence.match(/\bthe\s+([a-z0-9][\w -]{0,30}?\s?booklets?)\b/i)
    return named ? cap(named[1]) : sentence.replace(/[.;]\s*$/, '')
  }
  return `the teacher booklet for ${test.title}`
}

const infoSentences = (t: TrackerTest) => (t.info ?? '').split(/\n|(?<=\.)\s+/).map((s) => s.trim()).filter(Boolean)
/** The teacher's practice paper, if the test's info names one. */
export function practicePaper(test: TrackerTest): string | null {
  const s = infoSentences(test).find((x) => /\b(practice (paper|test)|past paper|mock paper|specimen paper)\b/i.test(x))
  return s ? s.replace(/[.;]\s*$/, '').slice(0, 100) : null
}
/** "30–60 min/day over half-term" is the slot's size, not the thing to open. */
const stripPerDay = (s: string) => s.replace(/\s*[,;·–-]?\s*\d+\s*(?:[–-]\s*\d+\s*)?min(?:utes)?\s*(?:\/|a |per )\s*day\b[^.;]*/i, '').trim()

const dot = (t: TrackerTopic) => COLOUR_DOT[t.status]
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const limitsBit = (t: TrackerTest) => (t.limits?.trim() ? ` · ${t.limits.trim()}` : '')
const daysText = (n: number) => (n === 1 ? 'tomorrow' : n === 0 ? 'today' : `in ${n} days`)
/** A test with no topic codes asks for them on every pick. */
const askTopics = (w: TestWindow) => (w.topics.length ? '' : `tell me its topics ("${w.test.title} topics: …")`)
export const testWhy = (w: TestWindow, extra?: string) =>
  `${w.test.title} ${daysText(w.daysLeft)}${[extra, askTopics(w)].filter(Boolean).map((x) => ` · ${x}`).join('')}${limitsBit(w.test)}`
const dateText = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const scalePick = (p: PlanPick, minutes: number): PlanPick => ({ ...p, minutes, steps: p.steps ? scaleSteps(p.steps, minutes) : p.steps })
const shrinkable = (pick: PlanPick, min: number, meta?: PickMeta): Candidate => ({ pick, min, meta, shrink: (m) => scalePick(pick, m) })

/** The final two weeks: ≈ 70 % exam questions · 20 % targeted relearning · 10 % stretch, inside one topic pick. */
function finalSteps(t: TrackerTopic, links: TrackerLinks, minutes: number): Step[] {
  if (isPhysics(t.subject)) {
    return scaleSteps([
      { minutes: 20, what: `targeted relearning: PMT notes${t.concepts?.trim() ? ` on ${t.concepts.trim()}` : ''} + your mistakes on ${t.name}` },
      { minutes: 70, what: `PMT CAIE topic questions: ${t.pmtRef ? `${t.pmtRef} → ` : ''}${t.name} (mark straight after)` },
      { minutes: 10, what: 'stretch: one Isaac Physics question' },
    ], minutes)
  }
  const ex = examResource(t, links)
  return scaleSteps([
    { minutes: 20, what: `targeted relearning: ${t.weakNotes?.trim() ? t.weakNotes.trim() : `your mistakes + the Bicen chapter summary for ${shortName(t)}`}` },
    { minutes: 70, what: `exam questions: ${ex.name} (mark straight after)` },
    { minutes: 10, what: `stretch: one harder question (${stretchResource(t, links).open})` },
  ], minutes)
}

/** One topic's test work (after its booklet): by colour; the final 2 weeks use the 70/20/10 mix. 🔴/🟡/⚪ only. */
export function testTopicPick(w: TestWindow, t: TrackerTopic, links: TrackerLinks): Candidate {
  const minutes = 45
  const base = { key: `test:${w.test.id}:topic:${t.id}`, kind: 'test_topic' as const, tier: TIER.test, subject: t.subject, minutes,
    why: testWhy(w, dot(t)), topicId: t.id, goalId: w.test.id, heavy: true }
  const lim = limitsBit(w.test)
  if (w.daysLeft <= FINAL_DAYS) {
    const steps = finalSteps(t, links, minutes)
    const main = isPhysics(t.subject) ? `PMT CAIE topic questions: ${t.pmtRef ? `${t.pmtRef} → ` : ''}${t.name}` : examResource(t, links).name
    return shrinkable({ ...base, title: `${topicLabel(t)}: exam questions`, open: `${main} – relearn the gaps → exam questions → one harder one${lim}`,
      url: isPhysics(t.subject) ? linkOf(links.pmtPhysics) : examResource(t, links).url, steps,
      done: isPhysics(t.subject) ? { kind: 'topic', topicId: t.id, physics: 'pmt' } : { kind: 'topic', topicId: t.id, step: 4 } }, 25, { code: t.code })
  }
  if (t.status === 'not_secure') {
    const ex = examResource(t, links)
    return shrinkable({ ...base, title: `${topicLabel(t)}: fix 🔴`, open: isPhysics(t.subject)
      ? `Fix 🔴: PMT notes / one video → explain it out loud in 3 sentences → Isaac Physics / PMT questions on ${t.name}${lim}`
      : `Fix 🔴: re-learn (notes / Bicen chapter summary) → 5 questions from ${textbookRef(t)} → ${ex.name} → ≥ 80 % = 🟡${lim}`,
      url: isPhysics(t.subject) ? null : ex.url, steps: fixSteps(t, links, minutes), done: { kind: 'topic', topicId: t.id } }, 25, { code: t.code })
  }
  if (isPhysics(t.subject)) {
    const r = physicsResource(t, links)
    return shrinkable({ ...base, title: `${topicLabel(t)}: ${r.label}`, open: `${r.open}${lim}`, url: r.url,
      done: r.physics ? { kind: 'topic', topicId: t.id, physics: r.physics } : { kind: 'topic', topicId: t.id } }, 25, { code: t.code })
  }
  const ex = examResource(t, links)
  return shrinkable({ ...base, title: `${topicLabel(t)}: exam questions`, open: `${ex.name}: one 30–45 min set, mark straight after + redo its mistakes${lim}`,
    url: ex.url, done: { kind: 'topic', topicId: t.id, step: 4 } }, 25, { code: t.code })
}

/** A teacher-booklet pick (🔴 topics first). No topics named → one booklet pick for the whole test. Its tick saves the
 *  topic code as the attempt's label, so only that topic's booklet ends. */
export function bookletPick(w: TestWindow, t: TrackerTopic | null): Candidate {
  const book = bookletFor(w.test, t)
  const lim = limitsBit(w.test)
  const physics = t ? isPhysics(t.subject) : isPhysics(w.test.subject)
  const open = !t ? `${book}: every question, mark it (green ticks, red corrections, purple = needed help)${lim}`
    : physics ? `${cap(book)}: the ${t.name} section – every exam question, mark it${lim}`
    : `${book} → ${topicLabel(t)}: every question, mark it (green / red / purple)${lim}`
  const pick: PlanPick = {
    key: t ? `test:${w.test.id}:booklet:${t.id}` : `test:${w.test.id}:booklet`, kind: 'test_booklet', tier: TIER.test,
    subject: t?.subject ?? w.test.subject, title: t ? `${w.test.title} booklet: ${topicLabel(t)}` : `${w.test.title}: teacher booklet`,
    open, minutes: 45, why: testWhy(w, t ? `booklets first · ${dot(t)}` : 'booklets first'), topicId: t?.id ?? null, goalId: w.test.id, heavy: true,
    done: t && physics ? { kind: 'topic', topicId: t.id, physics: 'booklet' }
      : t?.code ? { kind: 'attempt', goalId: w.test.id, what: 'booklet', label: t.code } : { kind: 'attempt', goalId: w.test.id, what: 'booklet' },
  }
  return shrinkable(pick, 25, { code: t?.code ?? null })
}

/** Where fresh questions come from: Bicen for maths (Integral Further for Further Stats / Mech), PMT for physics. */
function bankFor(w: TestWindow): string {
  const physics = w.topics.some((t) => isPhysics(t.subject)) || (!w.topics.length && isPhysics(w.test.subject))
  const maths = w.topics.some((t) => !isPhysics(t.subject)) || (!w.topics.length && !isPhysics(w.test.subject))
  return [maths ? 'Bicen exam questions' : null, physics ? 'PMT CAIE topic questions' : null].filter(Boolean).join(' / ')
}

/** Every pick this test could have today, best first (the planner places at most 2 a day). */
export function testCandidates(w: TestWindow, date: string, links: TrackerLinks, mode: 'half_term' | 'school', mistakes: TrackerMistake[] = []): Candidate[] {
  const { test } = w
  const phase = testPhase(w, date)
  const lim = limitsBit(test)
  const codes = w.topics.map((t) => t.code ?? shortName(t))
  const first = infoSentences(test)[0]
  const topicsList = codes.length ? codes.join(', ') : first ? `what its info says ("${first.replace(/[.;]\s*$/, '').slice(0, 60)}")` : 'its topics'
  const base = { tier: TIER.test, subject: test.subject ?? w.topics[0]?.subject ?? null, goalId: test.id }
  const topics = () => workTopics(w, date).map((t) => testTopicPick(w, t, links))
  const booklets = () => (w.topics.length ? bookletTopics(w, date).map((t) => bookletPick(w, t)) : bookletDone(test, null) ? [] : [bookletPick(w, null)])

  switch (phase) {
    case 'test_day': return []
    case 'light': {
      const own = mistakes.filter((m) => m.goalId === test.id || (m.code && w.topics.some((t) => up(t.code) === up(m.code))))
      const physics = w.topics.length ? w.topics.every((t) => isPhysics(t.subject)) : isPhysics(test.subject)
      const pick: PlanPick = { ...base, key: `test:${test.id}:light`, kind: 'test_light', title: `${test.title} tomorrow: light`, minutes: 20,
        open: `Light: read ${test.title}'s mistakes${own.length ? ` (${own.length})` : ''} + ${physics ? 'the equations you must know' : 'the formula booklet'}, then sleep early${lim}`,
        why: testWhy(w, 'day before: light only'), done: { kind: 'block' }, heavy: false }
      return [{ pick, min: 20 }]
    }
    case 'consolidation': {
      const lo = test.minutesPerDay ?? test.minutesMax!, hi = Math.max(lo, test.minutesMax ?? lo)
      const minutes = mode === 'half_term' ? hi : lo
      const focus = orderedTestTopics(w, date)[0] ?? null
      const book = stripPerDay(bookletFor(test, null)) || `the ${test.title} booklets`
      const today = focus ? ` · today: ${topicLabel(focus)} (${dot(focus)})` : ''
      const open = (book.length + today.length <= 120 ? `${book}${today}` : book).slice(0, 120)
      const pick: PlanPick = { ...base, key: `test:${test.id}:consolidation`, kind: 'consolidation', title: `${test.title}: daily slot`, minutes, open,
        why: `due ${dateText(test.date!)} · ${lo === hi ? `${lo}` : `${lo}–${hi}`} min/day${w.topics.length ? '' : ' · log the test\'s mistakes'}${lim}`, topicId: focus?.id ?? null, heavy: true,
        done: focus ? { kind: 'topic', topicId: focus.id } : { kind: 'block' } }
      return [shrinkable(pick, Math.min(lo, minutes), { code: focus?.code ?? null })]
    }
    case 'timed': {
      const len = test.lengthMin ?? 45
      const paper = practicePaper(test)
      const pick: PlanPick = { ...base, key: `test:${test.id}:timed`, kind: 'test_timed', title: `${test.title}: timed practice`, minutes: len + 15,
        open: `Timed practice, closed book: ${paper ?? `a mixed set of exam questions on ${topicsList}, timed at ${len} min`} → mark it → log the score + every mistake${lim}`,
        why: testWhy(w, '3–4 days before: timed practice'), done: { kind: 'attempt', goalId: test.id, what: 'timed' }, heavy: true,
        steps: [{ minutes: len, what: `timed, closed book, ${len} min${test.marks ? ` (~${test.marks} marks)` : ''}` }, { minutes: 15, what: 'mark it, log the score + every mistake' }] }
      // booklets still due come right after the timed practice (teacher booklet first), then topic work
      return [{ pick, min: pick.minutes }, ...booklets(), ...topics()]
    }
    case 'diagnostic': {
      const minutes = Math.max(15, Math.min(60, 5 * Math.max(1, w.topics.length)))
      const pick: PlanPick = { ...base, key: `test:${test.id}:diagnostic`, kind: 'test_diagnostic', title: `${test.title}: diagnostic`, minutes,
        open: `Diagnostic: 1–2 fresh questions per topic (${bankFor(w)}), no notes → colour each: ${topicsList}${lim}`,
        why: testWhy(w, 'diagnostic first'), done: { kind: 'attempt', goalId: test.id, what: 'diagnostic' }, heavy: true }
      return [shrinkable(pick, 15), ...booklets(), ...topics()]
    }
    case 'booklet': return [...booklets(), ...topics()]
    case 'topics': return topics()
  }
}
