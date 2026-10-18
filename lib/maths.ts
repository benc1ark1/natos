// Maths + Further Maths system: every topic has a colour (⚪ not started · 🔴 not secure · 🟡 understand but not secure
// · 🟢 exam ready; green can drop back). Maths study time has three modes, in order: 📝 HOMEWORK (maths/FM homework due)
// → 🔥 TEST (a maths/FM test within mathsTestDays: only its topics, 🔴 then 🟡 then quick checks on 🟢, a mixed set
// the day before) → 🚀 ACCELERATION (the whole spec in textbook order: old 🔴 first, then 🟡 close to green, then the
// next new topic; 🟡 is enough to move on the first time). Topics are rows in `topics` (their section and number in
// spec_ref, "Book 1 · 3"); the colour is topics.status (supabase/maths.sql). Pure: no database, no clock.
import type { Topic } from './study'
import type { Goal, Task } from './types'
import { addDays, daysBetween, dowShort } from './time'

export type Status = 'not_started' | 'not_secure' | 'understand' | 'exam_ready'
export const STATUSES: Status[] = ['not_started', 'not_secure', 'understand', 'exam_ready']
export const DOT: Record<Status, string> = { not_started: '⚪', not_secure: '🔴', understand: '🟡', exam_ready: '🟢' }
export const STATUS_WORD: Record<Status, string> = { not_started: 'not started', not_secure: 'not secure', understand: 'understand, not secure', exam_ready: 'exam ready' }

/** "yellow" / "🟡" / "green" / "red" / "white" / "not started" → a status. */
export function parseStatus(w: string): Status | null {
  const v = w.trim().toLowerCase()
  if (/^(⚪|white|grey|gray|none|not started|new|reset)$/.test(v)) return 'not_started'
  if (/^(🔴|red|not secure|weak)$/.test(v)) return 'not_secure'
  if (/^(🟡|yellow|amber|understand|ok|okay)$/.test(v)) return 'understand'
  if (/^(🟢|green|exam ready|secure|done|solid)$/.test(v)) return 'exam_ready'
  return STATUSES.includes(v as Status) ? (v as Status) : null
}

export type MathsTopic = Topic & { status?: Status | null }
export const statusOf = (t: MathsTopic): Status => (t.status && STATUSES.includes(t.status) ? t.status : 'not_started')

/** "Book 1 · 3" → { section: "Book 1", n: 3 }. */
export function sectionOf(t: Pick<Topic, 'spec_ref' | 'sort_order'>): { section: string; n: number } {
  const m = (t.spec_ref ?? '').match(/^(.*?)\s*·\s*(\d+)$/)
  return m ? { section: m[1], n: Number(m[2]) } : { section: t.spec_ref || 'Topics', n: t.sort_order + 1 }
}

/** The textbooks' topics, in order (his brief, 13 Oct 2026). Seeded once as ⚪; after that they're his data. */
export const SEED: { subject: string; section: string; topics: string[] }[] = [
  { subject: 'Maths', section: 'Book 1', topics: ['Proof & mathematical communication', 'Indices & surds', 'Quadratic functions', 'Polynomials', 'Using graphs', 'Coordinate geometry', 'Logarithms', 'Exponential models', 'Binomial expansion', 'Trigonometric functions & equations', 'Triangle geometry', 'Vectors', 'Differentiation', 'Applications of differentiation', 'Integration', 'Working with data', 'Probability', 'Statistical hypothesis testing', 'Introduction to kinematics', 'Motion with constant acceleration', 'Force and motion', 'Objects in contact'] },
  { subject: 'Maths', section: 'Book 2', topics: ['Proof', 'Functions', 'Further transformations of graphs', 'Sequences & series', 'Rational functions & partial fractions', 'General binomial expansion', 'Radian measure', 'Further trigonometry', 'Calculus of exponential & trig functions', 'Further differentiation', 'Further integration techniques', 'Further applications of calculus', 'Differential equations', 'Numerical solution of equations', 'Numerical integration', 'Conditional probability', 'Normal distribution', 'Further hypothesis testing', 'Applications of vectors', 'Projectiles', 'Forces in context', 'Moments'] },
  { subject: 'Further Maths', section: 'Pure Core 1', topics: ['Matrices', 'Further vectors', 'Applications of matrices', 'Complex numbers', 'Roots of polynomials', 'Mathematical induction'] },
  { subject: 'Further Maths', section: 'Pure Core 2', topics: ['Series & induction', 'Powers & roots of complex numbers', 'Complex numbers & trigonometry', 'Lines & planes in space', 'Simultaneous equations & planes', 'Hyperbolic functions', 'Further calculus techniques', 'Applications of calculus', 'Polar coordinates', 'Differential equations', 'Applications of differential equations'] },
  { subject: 'Further Maths', section: 'Statistics', topics: ['Counting principles & probability', 'Discrete random variables', 'Poisson distribution', 'Non-parametric hypothesis tests', 'Correlation & regression', 'Chi-squared tests', 'Continuous distributions', 'Combining random variables', 'Further hypothesis tests & confidence intervals'] },
  { subject: 'Further Maths', section: 'Mechanics', topics: ['Work energy & power 1', 'Dimensional analysis', 'Momentum & collisions 1', 'Circular motion 1', 'Centres of mass 1', 'Work energy & power 2', 'Linear motion under variable force', 'Momentum & collisions 2', 'Circular motion 2', 'Centres of mass 2'] },
]

/** Seed rows for one subject: name, "Section · n", sort order across the subject. */
export function seedRows(subject: string): { name: string; spec_ref: string; sort_order: number }[] {
  let i = 0
  return SEED.filter((s) => s.subject === subject).flatMap((s) => s.topics.map((name, k) => ({ name, spec_ref: `${s.section} · ${k + 1}`, sort_order: i++ })))
}

// ---------------------------------------------------------------------------
// The mode and the next topics
// ---------------------------------------------------------------------------

export type MathsSettings = { mathsSubjects: string; mathsTestDays: number; mathsBlocksPerWeek: number; mathsBlockMin: number; mathsResources: string }
export type MathsWorld = {
  today: string
  subjects: { id: string; name: string }[]
  topics: MathsTopic[]
  tasks: Pick<Task, 'id' | 'title' | 'subject_id' | 'status' | 'due_at' | 'archived_at' | 'duration_minutes'>[]
  goals: Pick<Goal, 'id' | 'title' | 'kind' | 'subject_id' | 'target_date' | 'topics' | 'archived_at'>[]
  settings: MathsSettings
}
export type Course = { id: string; name: string; short: string }
export type Mode =
  | { kind: 'homework'; tasks: MathsWorld['tasks'] }
  | { kind: 'test'; test: MathsWorld['goals'][number]; course: Course | null; topics: MathsTopic[]; date: string }
  | { kind: 'acceleration' }

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()

/** His maths subjects (setting mathsSubjects), in that order: "Maths" → Maths, "Further Maths" → FM. */
export function courses(w: Pick<MathsWorld, 'subjects' | 'settings'>): Course[] {
  return w.settings.mathsSubjects.split(',').map((x) => x.trim()).filter(Boolean)
    .map((n) => w.subjects.find((s) => norm(s.name) === norm(n)))
    .filter((s): s is { id: string; name: string } => !!s)
    .map((s) => ({ id: s.id, name: s.name, short: /further/i.test(s.name) ? 'FM' : s.name }))
}

/** A course's live topics in textbook order. */
export const topicsOf = (w: Pick<MathsWorld, 'topics'>, courseId: string) =>
  w.topics.filter((t) => t.subject_id === courseId && !t.archived_at).sort((a, b) => a.sort_order - b.sort_order)

const live = (t: MathsWorld['tasks'][number]) => !t.archived_at && t.status !== 'completed' && t.status !== 'someday'

/** Homework first, then a test within the window, else acceleration. */
export function modeOf(w: MathsWorld): Mode {
  const ids = new Set(courses(w).map((c) => c.id))
  const hw = w.tasks.filter((t) => live(t) && t.subject_id && ids.has(t.subject_id) && t.due_at)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))
  if (hw.length) return { kind: 'homework', tasks: hw }
  const last = addDays(w.today, w.settings.mathsTestDays)
  const test = w.goals.filter((g) => !g.archived_at && g.kind === 'test' && g.target_date && g.target_date >= w.today && g.target_date <= last && (!g.subject_id || ids.has(g.subject_id))
    && (g.subject_id || /math|fm\b/i.test(g.title)))
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!))[0]
  if (test) {
    const course = courses(w).find((c) => c.id === test.subject_id) ?? null
    return { kind: 'test', test, course, topics: testTopics(w, test, course), date: test.target_date! }
  }
  return { kind: 'acceleration' }
}

/** The tracker's topics a test names ("proof, vectors"): in that course, else in any maths course. */
export function testTopics(w: MathsWorld, test: Pick<Goal, 'topics'>, course: Course | null): MathsTopic[] {
  const pool = course ? topicsOf(w, course.id) : courses(w).flatMap((c) => topicsOf(w, c.id))
  const out: MathsTopic[] = []
  for (const said of (test.topics ?? '').split(/\s*[,;\n]\s*|\s+and\s+/).filter(Boolean)) {
    const t = findTopics(pool, said)[0]
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/** Topics his words point at ("trig", "matrices", "proof"): names starting with his words first, then names with a
 *  word starting with them (from 4 letters), then names containing them; within each, the pool's order (courses in
 *  order, then the books: he's in Year 12, so "proof" is Book 1's chapter before Book 2's). */
export function findTopics(pool: MathsTopic[], said: string): MathsTopic[] {
  const n = norm(said).replace(/^(the|my) /, '')
  if (!n) return []
  const starts = pool.filter((t) => norm(t.name).startsWith(n))
  if (starts.length) return starts
  const word = pool.filter((t) => n.length >= 4 && norm(t.name).split(' ').some((x) => x.startsWith(n)))
  if (word.length) return word
  return pool.filter((t) => norm(t.name).includes(n))
}

export type MathsBlock = { title: string; minutes: number; topic: MathsTopic | null; course: Course | null; taskId?: string; why: string }

const WORK: Record<Status, string> = { not_started: 'textbook + questions', not_secure: 'back to it: textbook + questions', understand: 'exam questions to push it to green', exam_ready: 'quick check' }
const ICON = { homework: '📝', test: '🔥', acceleration: '🚀' } as const

/** Acceleration: old 🔴 first, then 🟡 (close to green), then each course's next new topic, the courses taking turns. */
export function accelerationQueue(w: MathsWorld): { topic: MathsTopic; course: Course }[] {
  const cs = courses(w)
  const all = cs.flatMap((c) => topicsOf(w, c.id).map((t) => ({ topic: t, course: c })))
  const red = all.filter((x) => statusOf(x.topic) === 'not_secure')
  const yellow = all.filter((x) => statusOf(x.topic) === 'understand')
  const fresh = cs.map((c) => all.filter((x) => x.course.id === c.id && statusOf(x.topic) === 'not_started'))
  const turns: { topic: MathsTopic; course: Course }[] = []
  for (let i = 0; fresh.some((f) => i < f.length); i++) for (const f of fresh) if (f[i]) turns.push(f[i])
  return [...red, ...yellow, ...turns]
}

/** The next n maths blocks (what to do next, in order), for the planner and "what maths should I do?". */
export function nextBlocks(w: MathsWorld, n: number): MathsBlock[] {
  const m = modeOf(w)
  const len = w.settings.mathsBlockMin
  if (m.kind === 'homework') {
    return m.tasks.slice(0, n).map((t) => {
      const c = courses(w).find((x) => x.id === t.subject_id) ?? null
      return { title: `${ICON.homework} ${c?.short ?? 'Maths'} homework: ${t.title}`, minutes: t.duration_minutes ?? len, topic: null, course: c, taskId: t.id, why: `due ${dowShort(t.due_at!.slice(0, 10))}` }
    })
  }
  if (m.kind === 'test') {
    const short = m.course?.short ?? 'Maths'
    const order: Status[] = ['not_secure', 'understand', 'not_started', 'exam_ready']
    const list = [...m.topics].sort((a, b) => order.indexOf(statusOf(a)) - order.indexOf(statusOf(b)) || a.sort_order - b.sort_order)
    const blocks: MathsBlock[] = list.map((t) => ({ title: `${ICON.test} ${short}: ${t.name} — ${WORK[statusOf(t)]}`, minutes: statusOf(t) === 'exam_ready' ? Math.min(30, len) : len, topic: t, course: m.course, why: `${m.test.title} ${dowShort(m.date)}` }))
    return blocks.slice(0, n)
  }
  return accelerationQueue(w).slice(0, n).map(({ topic, course }) => ({
    title: `${ICON.acceleration} ${course.short}: ${topic.name} — ${WORK[statusOf(topic)]}`, minutes: len, topic, course, why: `${DOT[statusOf(topic)]} ${sectionOf(topic).section}`,
  }))
}

/** The week's maths blocks, day by day: the next blocks spread over the days (not on game day). In test mode the day
 *  before the test is a mixed set over all its topics. */
export function weekBlocks(w: MathsWorld, days: { date: string; skip?: boolean }[]): Map<string, MathsBlock[]> {
  const out = new Map<string, MathsBlock[]>()
  const m = modeOf(w)
  let open = days.filter((d) => !d.skip)
  if (m.kind === 'homework') open = open.filter((d) => d.date <= m.tasks[0].due_at!.slice(0, 10))
  if (m.kind === 'test') open = open.filter((d) => d.date < m.date)
  const blocks = nextBlocks(w, Math.min(w.settings.mathsBlocksPerWeek, open.length))
  if (m.kind === 'test') {
    const eve = addDays(m.date, -1)
    if (open.some((d) => d.date === eve) && m.topics.length) {
      const before = open.filter((d) => d.date < eve)
      before.forEach((d, i) => { if (blocks[i]) out.set(d.date, [blocks[i]]) })
      out.set(eve, [{ title: `${ICON.test} ${m.course?.short ?? 'Maths'}: mixed set for ${m.test.title} (${m.topics.map((t) => t.name).join(', ')})`, minutes: w.settings.mathsBlockMin, topic: null, course: m.course, why: 'the day before the test' }])
      return out
    }
  }
  // spread evenly over the open days
  const step = open.length / Math.max(1, blocks.length)
  blocks.forEach((b, i) => { const d = open[Math.floor(i * step)]; if (d) out.set(d.date, [...(out.get(d.date) ?? []), b]) })
  return out
}

// ---------------------------------------------------------------------------
// Words (bot and AI)
// ---------------------------------------------------------------------------

export const modeLine = (m: Mode) => m.kind === 'homework' ? `📝 Homework mode: ${m.tasks.map((t) => t.title).join(', ')}`
  : m.kind === 'test' ? `🔥 Test mode: ${m.test.title} ${dowShort(m.date)} (${m.topics.map((t) => `${DOT[statusOf(t)]} ${t.name}`).join(', ') || 'no topics named yet'})`
  : '🚀 Acceleration mode: through the spec in textbook order'

/** "what maths should I do?" */
export function nextText(w: MathsWorld, esc: (s: string) => string): string {
  const m = modeOf(w)
  const blocks = nextBlocks(w, 3)
  if (!courses(w).length) return 'I can’t find your maths subjects (setting “Maths subjects”).'
  if (!blocks.length) return `${esc(modeLine(m))}\nNothing left to do: every topic is 🟢.`
  const first = blocks[0]
  const lines = [`<b>${esc(modeLine(m))}</b>`, '', `Next: <b>${esc(first.title)}</b>, ${first.minutes}m`]
  if (first.topic) lines.push(`<i>Textbook → questions → set its colour → next.</i>`, `<i>${esc(w.settings.mathsResources)}</i>`)
  if (blocks.length > 1) lines.push('', 'Then:', ...blocks.slice(1).map((b) => `• ${esc(b.title)}`))
  if (first.topic) lines.push('', `<i>Done? Say “${esc(first.topic.name.split(' ')[0].toLowerCase())} yellow” (or green / red).</i>`)
  return lines.join('\n')
}

/** "show my maths tracker": each course, its sections as dots, progress, the mode and the next topic. */
export function trackerText(w: MathsWorld, esc: (s: string) => string): string {
  const cs = courses(w)
  if (!cs.length) return 'I can’t find your maths subjects (setting “Maths subjects”).'
  const lines = ['📐 <b>Maths tracker</b>']
  for (const c of cs) {
    const list = topicsOf(w, c.id)
    const green = list.filter((t) => statusOf(t) === 'exam_ready').length
    lines.push('', `<b>${esc(c.name)}</b> ${green}/${list.length} 🟢 ${bar(list)}`)
    const sections = [...new Set(list.map((t) => sectionOf(t).section))]
    for (const s of sections) lines.push(`${esc(s)}: ${list.filter((t) => sectionOf(t).section === s).map((t) => DOT[statusOf(t)]).join('')}`)
  }
  const m = modeOf(w)
  const next = nextBlocks(w, 1)[0]
  lines.push('', esc(modeLine(m)))
  if (next) lines.push(`Next: ${esc(next.title)}`)
  const test = w.goals.filter((g) => !g.archived_at && g.kind === 'test' && g.target_date && g.target_date >= w.today && cs.some((c) => c.id === g.subject_id)).sort((a, b) => a.target_date!.localeCompare(b.target_date!))[0]
  if (test) lines.push(`📝 ${esc(test.title)} in ${daysBetween(w.today, test.target_date!)} days${test.topics ? ` (${esc(test.topics)})` : ''}`)
  return lines.join('\n')
}

/** ▓▓▓░░░ for a course: green and yellow share. */
export function bar(list: MathsTopic[], width = 10): string {
  if (!list.length) return ''
  const g = list.filter((t) => statusOf(t) === 'exam_ready').length / list.length
  const y = list.filter((t) => statusOf(t) === 'understand').length / list.length
  const gn = Math.round(g * width), yn = Math.min(width - gn, Math.round(y * width))
  return '🟩'.repeat(gn) + '🟨'.repeat(yn) + '⬜'.repeat(width - gn - yn)
}

/** For the AI: the mode, the next blocks and every topic with its colour and number (so "trig" or "chapters 1–13"
 *  can be named exactly). */
export function mathsForAI(w: MathsWorld): string[] {
  const cs = courses(w)
  if (!cs.length) return []
  const out = [modeLine(modeOf(w)), `Next maths blocks (the app plans these itself): ${nextBlocks(w, 3).map((b) => b.title).join(' | ') || 'none'}`]
  for (const c of cs) {
    const list = topicsOf(w, c.id)
    for (const s of [...new Set(list.map((t) => sectionOf(t).section))]) {
      out.push(`${c.name} — ${s}: ${list.filter((t) => sectionOf(t).section === s).map((t) => `${sectionOf(t).n} ${DOT[statusOf(t)]} ${t.name}`).join('; ')}`)
    }
  }
  return out
}

/** "Book 1 chapters 1–13", "trig", "matrices, vectors" → the topics (with the course if he named one). */
export function resolveTopics(w: MathsWorld, value: { subject?: string; section?: string; chapters?: string; topics?: string }): { topics: MathsTopic[]; problem?: string } {
  const cs = courses(w)
  const course = value.subject ? cs.find((c) => norm(c.name) === norm(value.subject!) || norm(c.short) === norm(value.subject!)) ?? null : null
  if (value.subject && !course) return { topics: [], problem: `no maths course called “${value.subject}”` }
  let pool = (course ? [course] : cs).flatMap((c) => topicsOf(w, c.id))
  if (value.section) {
    const sec = pool.filter((t) => norm(sectionOf(t).section) === norm(value.section!))
    if (!sec.length) return { topics: [], problem: `no section called “${value.section}”` }
    pool = sec
  }
  if (value.chapters) {
    const m = value.chapters.match(/^(\d+)\s*(?:-|–|to)\s*(\d+)$/) ?? value.chapters.match(/^(\d+)()$/)
    if (!m) return { topics: [], problem: `“${value.chapters}” isn’t a chapter range` }
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a
    if (!value.section) return { topics: [], problem: 'which book or section are the chapters in?' }
    const hit = pool.filter((t) => sectionOf(t).n >= a && sectionOf(t).n <= b)
    return hit.length ? { topics: hit } : { topics: [], problem: `no chapters ${value.chapters} in ${value.section}` }
  }
  if (!value.topics) return value.section ? { topics: pool } : { topics: [], problem: 'which topics?' }
  const out: MathsTopic[] = []
  for (const said of value.topics.split(/\s*[,;]\s*|\s+and\s+/).filter(Boolean)) {
    const hits = findTopics(pool, said)
    if (!hits.length) return { topics: [], problem: `no topic called “${said}”` }
    if (!out.includes(hits[0])) out.push(hits[0])
  }
  return { topics: out }
}
