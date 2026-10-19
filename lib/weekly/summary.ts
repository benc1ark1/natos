// The weekly check (queue item 7, plans/contracts.md §10): ONE message that says how the week (Mon–Sun) went —
// done vs planned per subject, tracker movement, the ACT trend, gym PRs, what's behind — and ONE suggestion, picked
// by the planner's own priority order (homework → tests → reviews/redos → programmes → the rest). Every part is left
// out when its data isn't there (a table not made yet, nothing logged): never an error, never a dashboard to keep.
// Pure: no database, no clock (lib/weekly/data.ts reads the rows).
import { addDays, daysBetween, dowShort, isoDow, shortDate, weekStartISO } from '../time'
import { DEFAULT_REVIEW_DAYS, nextReview } from '../tracker/rules'
import type { Colour, Programme } from '../tracker/types'
import { dayAllowed, doneThisWeek, isRunning, nextItem } from '../tracker/programmes'
import { DEFAULT_EXERCISES } from '../gym/catalogue'
import { prsIn, prShort } from '../gym/progress'
import { DEFAULT_PREFS, type Exercise, type GymPrefs, type Lift } from '../gym/types'

// ---------------------------------------------------------------------------
// What it reads (null = that table isn't there yet / couldn't be read: the part is left out)
// ---------------------------------------------------------------------------

export type WBlock = {
  id: string; date: string; title: string; kind: string; status: 'planned' | 'done'
  taskId: string | null; goalId: string | null; topicId: string | null; programmeItemId: string | null
  pickKey: string | null; rolledFrom: string | null
  start: string | null          // HH:MM (a block later today isn't missed yet)
}
export type WTask = { id: string; title: string; subjectId: string | null; due: string | null; open: boolean; homework: boolean }
export type WTopic = {
  id: string; subjectId: string | null; code: string | null; name: string; status: Colour
  lastDone: string | null; statusAt: string | null; order: number
}
export type WMistake = { id: string; stage: number; reviewOn: string; reviewedOn: string | null; updatedOn: string | null }
export type WTest = {
  id: string; title: string; date: string; subjectId: string | null; kind: string | null
  topicCodes: string[]; topicWords: string | null; attempts: string[] | null   // attempts' "what" (null = not known)
}
export type WActScore = { takenOn: string; english: number | null; maths: number | null; reading: number | null; science: number | null; composite: number | null }
/** A lift_sets row as the gym maths (lib/gym/progress.ts) takes it. */
export type WLift = Lift
/** The week's starting point (supabase/weekly.sql): each topic's [colour, last done] and each mistake's redo stage. */
export type WSnapshot = { weekStart: string; topics: Record<string, [Colour, string | null]>; mistakes: Record<string, number> }

export type WeeklyInput = {
  today: string
  now?: string                                           // HH:MM: today's blocks that start later aren't counted yet
  weekOf?: string                                        // a day in the week it looks back on (default: today's week)
  subjects: { id: string; name: string }[]
  blocks: WBlock[] | null
  tasks: WTask[]
  goals: { id: string; subjectId: string | null }[]      // goals the blocks point at (for their subject)
  topics: WTopic[] | null
  snapshot: WSnapshot | null
  mistakes: WMistake[] | null
  tests: WTest[] | null                                  // tests coming up (any within 2 weeks)
  programmes: Programme[] | null
  act: { scores: WActScore[]; goal: number } | null
  lifts: WLift[] | null                                  // the week's, and earlier ones of the same exercises
  exercises?: Exercise[]                                 // his exercise catalogue (lib/gym/catalogue.ts)
  gymPrefs?: GymPrefs                                    // his bodyweight etc. (lib/gym/settings.ts)
  upper: { done: number; target: number } | null
  reviewDays?: Record<Colour, number>
  snapshotTable?: boolean                                // false = supabase/weekly.sql not run yet
}

// ---------------------------------------------------------------------------
// What it says
// ---------------------------------------------------------------------------

export type SubjectLine = { name: string; short: string; done: number; planned: number }
export type TrackerPart = {
  mode: 'compare' | 'worked'          // compare: against the week's starting point · worked: no starting point yet
  up: number; down: number; green: string[]; worked: number
  reviews: { done: number; due: number } | null   // done this week · still due now (only with a starting point)
  mistakes: { redone: number; due: number } | null
}
export type ActPart = { latest: number; previous: number | null; goal: number; weakest: { section: string; score: number } | null }
export type Pr = { key: string; name: string; text: string; date: string; gain: number }   // text: "e1RM 93.3 kg", "BW+10 kg for 5+ reps"…
export type GymPart = { prs: Pr[]; logged: number; upper: { done: number; target: number } | null }
export type Behind = {
  homework: { title: string; due: string }[]
  soon: { title: string; due: string; when: 'overdue' | 'today' | 'tomorrow' }[]   // other overdue, due today / tomorrow
  tests: { id: string; title: string; date: string; days: number; red: string[]; booklet: boolean | null }[]
  programmes: { name: string; done: number; perWeek: number; next: string | null }[]
}
export type WeeklySummary = {
  weekStart: string; weekEnd: string; today: string; soFar: boolean
  subjects: SubjectLine[]; other: { done: number; planned: number }
  tracker: TrackerPart | null
  act: ActPart | null
  gym: GymPart | null
  behind: Behind
  reviewsDue: number                  // topics whose review is due now
  reviewsDueFirst: string | null      // the most overdue review (its code or name), for the suggestion
  suggestion: string
}

// ---------------------------------------------------------------------------
// Small rules
// ---------------------------------------------------------------------------

/** The week a check on `today` looks back on: on a Monday, the week that just ended; any other day, this one. */
export const reviewedWeekOf = (today: string) => (isoDow(today) === 1 ? addDays(today, -1) : today)
/** Enhanced ACT: composite = round(mean of English, Maths, Reading); Science is separate. */
export const actComposite = (s: WActScore): number | null =>
  s.composite ?? (s.english != null && s.maths != null && s.reading != null ? Math.round((s.english + s.maths + s.reading) / 3) : null)

const SHORT: Record<string, string> = { 'further maths': 'FM', 'computer science': 'CS' }
export const shortName = (name: string) => SHORT[name.trim().toLowerCase()] ?? name.trim()
const ORDER = ['maths', 'further maths', 'physics', 'act']
const rankOf = (name: string) => { const i = ORDER.indexOf(name.toLowerCase()); return i < 0 ? ORDER.length : i }

/** ⚪ and 🔴 are both "not there yet", so ⚪ → 🔴 (a diagnostic) isn't counted as going up. */
const LEVEL: Record<Colour, number> = { not_started: 0, not_secure: 0, understand: 1, exam_ready: 2 }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const topicLabel = (t: Pick<WTopic, 'code' | 'name'>) => t.code || (t.name.length > 24 ? `${t.name.slice(0, 23)}…` : t.name)
const list = (xs: string[], max = 3) => (xs.length > max ? `${xs.slice(0, max).join(', ')} +${xs.length - max}` : xs.join(', '))
const inWeek = (d: string | null, from: string, to: string) => !!d && d >= from && d <= to

// ---------------------------------------------------------------------------
// Done vs planned per subject
// ---------------------------------------------------------------------------

type Ctx = { input: WeeklyInput; subjectName: Map<string, string>; topicSubject: Map<string, string | null>; itemSubject: Map<string, string | null> }

/** The subject a plan block belongs to: its pick key (act: / prog: / topic: / test: / task:), its links, then its title. */
export function blockSubject(b: WBlock, c: Ctx): string | null {
  const sub = (id: string | null | undefined) => (id ? c.subjectName.get(id) ?? null : null)
  const task = (id: string) => sub(c.input.tasks.find((t) => t.id === id)?.subjectId)
  const goal = (id: string) => sub(c.input.goals.find((g) => g.id === id)?.subjectId ?? c.input.tests?.find((t) => t.id === id)?.subjectId)
  const k = b.pickKey ?? ''
  let m: RegExpMatchArray | null
  if (/^act:/.test(k)) return 'ACT'
  if ((m = k.match(/^prog:([^:]+)/)) && c.itemSubject.get(m[1])) return c.itemSubject.get(m[1])!
  if ((m = k.match(/^topic:([^:]+)/)) && c.topicSubject.get(m[1])) return c.topicSubject.get(m[1])!
  if ((m = k.match(/^test:([^:]+)/)) && goal(m[1])) return goal(m[1])
  if ((m = k.match(/^task:([^:]+)/)) && task(m[1])) return task(m[1])
  if (b.topicId && c.topicSubject.get(b.topicId)) return c.topicSubject.get(b.topicId)!
  if (b.programmeItemId && c.itemSubject.get(b.programmeItemId)) return c.itemSubject.get(b.programmeItemId)!
  if (b.taskId && task(b.taskId)) return task(b.taskId)
  if (b.goalId && goal(b.goalId)) return goal(b.goalId)
  return subjectFromTitle(b.title, c.input.subjects.map((s) => s.name))
}

/** "📝 FM homework: …", "🚀 Maths: Vectors", "ACT English section" → the subject it names (longest name first). */
export function subjectFromTitle(title: string, names: string[]): string | null {
  if (/\bACT\b/.test(title)) return names.find((n) => n.toLowerCase() === 'act') ?? 'ACT'
  const t = ` ${norm(title)} `
  const fm = names.find((n) => n.toLowerCase() === 'further maths')
  if (fm && /\bFM\b/.test(title)) return fm
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    const w = norm(n)
    if (w === 'act') continue   // only "ACT" in capitals (above): "act on feedback" isn't ACT
    if (w && (t.includes(` ${w} `) || (w === 'maths' && t.includes(' math ')))) return n
  }
  return null
}

function subjectLines(input: WeeklyInput, c: Ctx, from: string, upTo: string): { subjects: SubjectLine[]; other: { done: number; planned: number } } {
  // today's blocks that haven't started yet aren't missed (the 18:00 check, a 19:00 block)
  const later = (b: WBlock) => b.date === input.today && b.status !== 'done' && !!input.now && !!b.start && b.start > input.now
  const blocks = (input.blocks ?? []).filter((b) => b.date >= from && b.date <= upTo && b.kind !== 'training' && b.kind !== 'rest' && !later(b))
  // a block that wasn't done and rolled forward to a later day counts once (on the day it ended up on)
  const rolled = new Set(blocks.filter((b) => b.rolledFrom && b.pickKey).map((b) => `${b.pickKey}|${b.rolledFrom}`))
  const by = new Map<string, { done: number; planned: number }>()
  const other = { done: 0, planned: 0 }
  for (const b of blocks) {
    if (b.status !== 'done' && b.pickKey && rolled.has(`${b.pickKey}|${b.date}`)) continue
    const s = blockSubject(b, c)
    const row = s ? (by.get(s) ?? by.set(s, { done: 0, planned: 0 }).get(s)!) : other
    row.planned++
    if (b.status === 'done') row.done++
  }
  const subjects = [...by.entries()].map(([name, v]) => ({ name, short: shortName(name), ...v }))
    .sort((a, b) => rankOf(a.name) - rankOf(b.name) || a.name.localeCompare(b.name))
  return { subjects, other }
}

// ---------------------------------------------------------------------------
// Tracker movement
// ---------------------------------------------------------------------------

function trackerPart(input: WeeklyInput, from: string, upTo: string): { part: TrackerPart | null; firstDue: string | null; dueNow: number } {
  const today = input.today
  const topics = input.topics
  if (!topics) return { part: null, firstDue: null, dueNow: 0 }
  const days = input.reviewDays ?? DEFAULT_REVIEW_DAYS
  const snap = input.snapshot
  let up = 0, down = 0, worked = 0
  const green: string[] = []
  const reviewed = new Set<string>(), stillDue: { t: WTopic; due: string }[] = []
  const sorted = [...topics].sort((a, b) => a.order - b.order)
  for (const t of sorted) {
    const due = nextReview(t, days)
    if (due && due <= today) stillDue.push({ t, due })
    if (snap) {
      const start = snap.topics[t.id]
      // a topic added during the week (a tracker import) has no starting colour: it didn't "go up"
      const [was, wasDone] = start ?? [t.status, null]
      if (LEVEL[t.status] > LEVEL[was]) up++
      if (LEVEL[t.status] < LEVEL[was]) down++
      if (start && t.status === 'exam_ready' && was !== 'exam_ready') green.push(topicLabel(t))
      // a review that was due (by the week's starting point) and got done since
      const wasDue = nextReview({ lastDone: wasDone, status: was }, days)
      if (wasDue && wasDue <= upTo && t.lastDone && wasDone && t.lastDone > wasDone && t.lastDone <= upTo) reviewed.add(t.id)
      if (t.lastDone && t.lastDone >= from && t.lastDone <= upTo && (!wasDone || t.lastDone > wasDone)) worked++
    } else if (t.lastDone && t.lastDone >= from && t.lastDone <= upTo) {
      // no starting point yet (the first week): only how many topics were worked on (which reviews were due, and
      // what colour each started at, aren't known)
      worked++
    }
  }
  // done = reviews done this week; due = still due now (a 🔴 reviewed Tue and due again Wed counts in both)
  const reviews = snap && (reviewed.size || stillDue.length) ? { done: reviewed.size, due: stillDue.length } : null
  const firstDue = [...stillDue].sort((a, b) => a.due.localeCompare(b.due) || LEVEL[a.t.status] - LEVEL[b.t.status])[0]?.t
  const mistakes = mistakePart(input, from, upTo)
  const part: TrackerPart = { mode: snap ? 'compare' : 'worked', up, down, green, worked, reviews, mistakes }
  const empty = !up && !down && !green.length && !worked && !reviews && !mistakes
  return { part: empty ? null : part, firstDue: firstDue ? topicLabel(firstDue) : null, dueNow: stillDue.length }
}

/** An open mistake: not archived (the loader leaves those out), redo stage < 2 (an old-style one reviewed once is done). */
export const openMistake = (m: WMistake) => m.stage < 2 && !(m.stage === 0 && m.reviewedOn)

function mistakePart(input: WeeklyInput, from: string, upTo: string): TrackerPart['mistakes'] {
  const ms = input.mistakes
  if (!ms) return null
  const snap = input.snapshot
  const due = ms.filter((m) => openMistake(m) && m.reviewOn <= input.today).length
  const redone = ms.filter((m) => {
    if (inWeek(m.reviewedOn, from, upTo)) return true
    if (snap && m.id in snap.mistakes) return m.stage > snap.mistakes[m.id]
    return m.stage >= 1 && inWeek(m.updatedOn, from, upTo)
  }).length
  return redone || due ? { redone, due } : null
}

// ---------------------------------------------------------------------------
// ACT, gym
// ---------------------------------------------------------------------------

function actPart(input: WeeklyInput): ActPart | null {
  if (!input.act) return null
  const scores = [...input.act.scores].sort((a, b) => a.takenOn.localeCompare(b.takenOn))
  const comps = scores.map(actComposite).filter((x): x is number => x != null)
  if (!comps.length) return null
  // the weakest of the composite's sections, each at its latest score
  const latestOf = (k: 'english' | 'maths' | 'reading') => [...scores].reverse().find((s) => s[k] != null)?.[k] ?? null
  const secs = ([['English', 'english'], ['Maths', 'maths'], ['Reading', 'reading']] as const)
    .map(([section, k]) => ({ section, score: latestOf(k) })).filter((x): x is { section: 'English' | 'Maths' | 'Reading'; score: number } => x.score != null)
  const weakest = secs.length ? secs.reduce((a, b) => (b.score < a.score ? b : a)) : null
  return { latest: comps.at(-1)!, previous: comps.length > 1 ? comps.at(-2)! : null, goal: input.act.goal, weakest }
}

/** The week's PRs exactly as item 6's 🏆 alerts work them out (lib/gym/progress.ts prsIn: his catalogue, bodyweight
 * moves, the 0.05 kg margin): each session that beat everything before it; one per exercise (its latest), biggest first. */
function gymPart(input: WeeklyInput, from: string, to: string): GymPart | null {
  const list = input.exercises ?? DEFAULT_EXERCISES
  const lifts = (input.lifts ?? []).filter((l) => l.done_on <= to)
  const week = lifts.filter((l) => l.done_on >= from)
  const by = new Map<string, Pr>()
  for (const x of prsIn(lifts, from, to, list, input.gymPrefs ?? DEFAULT_PREFS)) {
    const ex = list.find((e) => e.key === x.key) ?? { bodyweight: false }
    const gain = x.pr.kind === 'e1rm' ? x.pr.value - x.pr.was : 0
    by.set(x.key, { key: x.key, name: x.name, text: prShort(x.pr, ex).replace(/ \(was [^)]*\)$/, ''), date: x.date, gain })
  }
  const prs = [...by.values()].sort((a, b) => b.gain - a.gain || a.name.localeCompare(b.name))
  if (!week.length && !input.upper) return null
  return { prs, logged: week.length, upper: input.upper }
}

// ---------------------------------------------------------------------------
// What's behind
// ---------------------------------------------------------------------------

function behindPart(input: WeeklyInput, upTo: string, weekEnd: string): Behind {
  const today = input.today
  const homework = input.tasks.filter((t) => t.open && t.homework && t.due && t.due < today)
    .sort((a, b) => a.due!.localeCompare(b.due!)).map((t) => ({ title: t.title, due: t.due! }))
  // what the daily "Before tomorrow, don't forget" reminder would say (it's skipped on the check-in day): other
  // overdue things, and what's due today or tomorrow
  const tomorrow = addDays(today, 1)
  const soon = input.tasks.filter((t) => t.open && t.due && ((t.due < today && !t.homework) || t.due === today || t.due === tomorrow))
    .sort((a, b) => a.due!.localeCompare(b.due!) || a.title.localeCompare(b.title))
    .map((t) => ({ title: t.title, due: t.due!, when: t.due! < today ? 'overdue' as const : t.due === today ? 'today' as const : 'tomorrow' as const }))
  const topics = input.topics ?? []
  const last = addDays(today, 14)
  const tests = (input.tests ?? []).filter((t) => t.date >= today && t.date <= last && t.kind !== 'act')
    .map((t) => {
      const codes = new Set(t.topicCodes.map((c) => c.trim().toUpperCase()).filter(Boolean))
      const words = (t.topicWords ?? '').split(/\s*(?:,|;|\band\b)\s*/i).map(norm).filter(Boolean)
      const mine = topics.filter((x) => (x.code && codes.has(x.code.toUpperCase()))
        || (!codes.size && words.length && (!t.subjectId || x.subjectId === t.subjectId) && words.includes(norm(x.name))))
      const red = mine.filter((x) => x.status === 'not_secure').sort((a, b) => a.order - b.order).map(topicLabel)
      return { id: t.id, title: t.title, date: t.date, days: daysBetween(today, t.date), red, booklet: t.attempts ? t.attempts.includes('booklet') : null }
    })
    .filter((t) => t.red.length).sort((a, b) => a.date.localeCompare(b.date))
  // programmes in the week it looks back on (on a Monday: last week, with no days left)
  const programmes = (input.programmes ?? []).filter((p) => isRunning(p, upTo) && p.mode !== 'optional')
    .map((p) => {
      const done = doneThisWeek(p, upTo)
      // the days still left that week on which it can happen (after today)
      let left = 0
      for (let d = addDays(upTo, 1); d <= weekEnd; d = addDays(d, 1)) if (dayAllowed(p.days, isoDow(d))) left++
      return { p, done, behind: done < p.perWeek && p.perWeek - done > left }
    })
    .filter((x) => x.behind && nextItem(x.p))
    .map(({ p, done }) => ({ name: p.name, done, perWeek: p.perWeek, next: nextItem(p)?.title ?? null }))
  return { homework, soon, tests, programmes }
}

// ---------------------------------------------------------------------------
// The one suggestion (the planner's priority order: homework → tests → reviews/redos → programmes → the rest)
// ---------------------------------------------------------------------------

export function suggestion(s: Omit<WeeklySummary, 'suggestion'>): string {
  const day = isoDow(s.today) === 7 ? 'Monday' : isoDow(s.today) === 1 ? 'today' : 'tomorrow'
  const past = s.today > s.weekEnd   // a Monday looking back on last week
  const wk = past ? 'last week' : 'this week', coming = past ? 'this week' : 'next week'
  const b = s.behind
  if (b.homework.length) {
    const h = b.homework[0]
    return `Start ${day} with ${h.title}: it was due ${dowShort(h.due)} ${shortDate(h.due)}${b.homework.length > 1 ? ` (+${b.homework.length - 1} more overdue)` : ''}.`
  }
  if (b.tests.length) {
    const t = b.tests[0]
    const what = t.booklet === true ? 'fresh exam questions on it' : 'its booklet'
    return `${t.title} is in ${plural(t.days, 'day')} and ${t.red[0]} is still 🔴 — start ${day} with ${what}.`
  }
  const tr = s.tracker
  if (tr?.mistakes?.due) return `${plural(tr.mistakes.due, 'mistake redo', 'mistake redos')} due — redo ${tr.mistakes.due === 1 ? 'it' : 'them'} without looking first thing ${day} (≤ 30 min).`
  if (s.reviewsDue && s.reviewsDueFirst) return `${plural(s.reviewsDue, 'review')} due — start ${day} with ${s.reviewsDueFirst} (3–4 exam questions + its mistakes).`
  if (b.programmes.length) {
    const p = b.programmes[0]
    return `${p.name} ${past ? 'was' : 'is'} ${p.done}/${p.perWeek} ${wk} — do ${p.next ? `“${p.next}”` : 'the next one'} ${day}.`
  }
  const slipping = s.subjects.filter((x) => x.planned >= 2 && x.done / x.planned < 0.5).sort((a, b) => a.done / a.planned - b.done / b.planned)[0]
  if (slipping) return `${slipping.short} was ${slipping.done}/${slipping.planned} ${wk} — put it first ${day}.`
  const up = s.gym?.upper
  if (up && up.target > 0 && up.done < up.target && !s.soFar) return `Upper was ${up.done}/${up.target} — keep both upper sessions in ${coming}’s plan.`
  if (s.act && s.act.latest < s.act.goal && s.act.weakest) return `ACT: ${s.act.weakest.section} is your weakest (${s.act.weakest.score}) — ${coming}’s ACT time goes there first.`
  const anything = s.subjects.length || s.other.planned || s.tracker || s.gym?.logged
  return anything ? 'Good week — same rhythm next week.' : 'Tick things off on Today as you go and this check fills itself in.'
}

// ---------------------------------------------------------------------------
// Putting it together
// ---------------------------------------------------------------------------

export function buildWeekly(input: WeeklyInput): WeeklySummary {
  const today = input.today
  const weekStart = weekStartISO(input.weekOf ?? today), weekEnd = addDays(weekStart, 6)
  const upTo = today < weekEnd ? today : weekEnd
  const subjectName = new Map(input.subjects.map((s) => [s.id, s.name]))
  const topicSubject = new Map((input.topics ?? []).map((t) => [t.id, t.subjectId ? subjectName.get(t.subjectId) ?? null : null]))
  const itemSubject = new Map<string, string | null>()
  for (const p of input.programmes ?? []) for (const it of p.items) itemSubject.set(it.id, p.area === 'act' ? 'ACT' : p.subjectId ? subjectName.get(p.subjectId) ?? null : null)
  const ctx: Ctx = { input, subjectName, topicSubject, itemSubject }
  const { subjects, other } = subjectLines(input, ctx, weekStart, upTo)
  const { part: tracker, firstDue, dueNow } = trackerPart(input, weekStart, upTo)
  const base = {
    weekStart, weekEnd, today, soFar: upTo < weekEnd, subjects, other, tracker,
    act: actPart(input), gym: gymPart(input, weekStart, weekEnd), behind: behindPart(input, upTo, weekEnd), reviewsDue: dueNow, reviewsDueFirst: firstDue,
  }
  return { ...base, suggestion: suggestion(base) }
}

/** The message: one phone screen, each part one line (left out when there's nothing to say). */
export function weeklyText(s: WeeklySummary): string {
  const sameMonth = s.weekStart.slice(5, 7) === s.weekEnd.slice(5, 7)
  const from = sameMonth ? String(+s.weekStart.slice(8, 10)) : shortDate(s.weekStart)
  const lines = [`📊 <b>Weekly check</b> · ${dowShort(s.weekStart)} ${from} – ${dowShort(s.weekEnd)} ${shortDate(s.weekEnd)}${s.soFar ? ' (so far)' : ''}`]
  // done vs planned per subject
  const subj = s.subjects.map((x) => `${esc(x.short)} ${x.done}/${x.planned}`)
  if (s.other.planned) subj.push(`${s.subjects.length ? 'other' : 'Study'} ${s.other.done}/${s.other.planned}`)
  lines.push(subj.length ? `📚 ${subj.join(' · ')}` : '📚 No study planned this week.')
  // the tracker
  const t = s.tracker
  if (t) {
    const bits: string[] = []
    const greens = t.green.length ? ` (🟢 ${esc(list(t.green))})` : ''
    if (t.mode === 'compare') {
      if (t.up) bits.push(`⬆️ ${plural(t.up, 'topic')} up a colour${greens}`)
      else if (t.green.length) bits.push(`🟢 ${esc(list(t.green))}`)
      if (t.down) bits.push(`⬇️ ${t.down} down`)
      if (!t.up && !t.down && t.worked) bits.push(`${plural(t.worked, 'topic')} worked on`)
    } else if (t.worked) {
      bits.push(`${plural(t.worked, 'topic')} worked on`)
    }
    if (t.reviews) bits.push(t.reviews.done && t.reviews.due ? `reviews ${t.reviews.done} done · ${t.reviews.due} due` : t.reviews.done ? `${plural(t.reviews.done, 'review')} done` : `${plural(t.reviews.due, 'review')} due`)
    if (t.mistakes) bits.push(t.mistakes.redone ? `${plural(t.mistakes.redone, 'mistake')} redone${t.mistakes.due ? ` (${t.mistakes.due} due)` : ''}` : `${plural(t.mistakes.due, 'mistake redo', 'mistake redos')} due`)
    if (bits.length) lines.push(`🎯 ${bits.join(' · ')}`)
  }
  // ACT
  const a = s.act
  if (a) {
    const arrow = a.previous == null ? '' : a.latest > a.previous ? ` ⬆️ from ${a.previous}` : a.latest < a.previous ? ` ⬇️ from ${a.previous}` : ' ➡️ same as last time'
    const goal = a.latest >= a.goal ? `🎯 goal ${a.goal} reached` : `goal ${a.goal}`
    lines.push(`📈 ACT ${a.latest}${arrow} · ${goal}${a.weakest ? ` · weakest ${a.weakest.section} ${a.weakest.score}` : ''}`)
  }
  // gym
  const g = s.gym
  if (g) {
    const bits: string[] = []
    if (g.prs.length) bits.push(`🏆 ${g.prs.slice(0, 3).map((p) => `${esc(p.name)} ${esc(p.text)}`).join(', ')}${g.prs.length > 3 ? ` +${g.prs.length - 3}` : ''}`)
    else if (g.logged) bits.push(`no new PRs (${plural(g.logged, 'lift')} logged)`)
    if (g.upper) bits.push(`Upper ${g.upper.done}/${g.upper.target}`)
    if (bits.length) lines.push(`🏋️ ${bits.join(' · ')}`)
  }
  // what's behind
  const b = s.behind
  const behind = [
    ...b.homework.map((h) => `${esc(h.title)} (due ${dowShort(h.due)})`),
    ...b.programmes.map((p) => `${esc(p.name)} ${p.done}/${p.perWeek}`),
  ]
  if (behind.length) lines.push(`⚠️ Behind: ${list(behind)}`)
  const when = (x: Behind['soon'][number]) => (x.when === 'overdue' ? `was ${dowShort(x.due)}` : x.when === 'today' ? 'today' : dowShort(x.due))
  if (b.soon.length) lines.push(`⏰ Before tomorrow: ${list(b.soon.map((x) => `${esc(x.title)} (${when(x)})`))}`)
  for (const x of b.tests.slice(0, 2)) lines.push(`📝 ${esc(x.title)} ${dowShort(x.date)} ${shortDate(x.date)} (${x.days === 0 ? 'today' : plural(x.days, 'day')}): 🔴 ${esc(list(x.red))}`)
  lines.push(`💡 ${esc(s.suggestion)}`)
  return lines.join('\n')
}

/** "Plan next week? ✅" at the weekend; on a weekday it plans the rest of this week. */
export const planLabel = (today: string) => (isoDow(today) >= 6 ? 'Plan next week? ✅' : 'Plan the rest of the week? ✅')
