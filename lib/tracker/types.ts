// The study tracker's shapes (plans/contracts.md §3): topics with their colour, step and review date; tests with their
// attempts; mistakes with two redos; programmes; temporary rules; homework. Rows come from supabase/tracker.sql through
// lib/tracker/data.ts; the rules (lib/tracker/rules.ts) and the planner (lib/tracker/engine.ts) are pure. Pure types.
import type { Status } from '../maths'

/** ⚪ 🔴 🟡 🟢 — stored as topics.status (lib/maths.ts): not_started · not_secure · understand · exam_ready. */
export type Colour = Status
export const COLOUR_DOT: Record<Colour, string> = { not_started: '⚪', not_secure: '🔴', understand: '🟡', exam_ready: '🟢' }

export type TaughtState = 'taught' | 'next_up' | 'later'
export type MistakeKind = 'knowledge' | 'method' | 'algebra' | 'misread' | 'calculator' | 'time' | 'careless'
export const MISTAKE_KINDS: MistakeKind[] = ['knowledge', 'method', 'algebra', 'misread', 'calculator', 'time', 'careless']
export type TestKind = 'test' | 'consolidation' | 'paper' | 'mock' | 'act'
export type AttemptWhat = 'diagnostic' | 'booklet' | 'timed' | 'paper' | 'real' | 'other'

/** Maths pipeline steps (Maths+FM tab "Pipeline step"). */
export const STEPS = ['Not started', 'Learnt', 'Textbook exercise', 'Mixed exercise', 'Bicen exam Qs', 'Integral ≥85%', 'Stretch'] as const

export type TrackerTopic = {
  id: string
  subjectId: string
  subject: string                 // 'Maths' | 'Further Maths' | 'Physics' (the subject's name)
  code: string | null             // 'Y1-01', 'PC1-03', 'P1.3'
  name: string
  strand: string | null           // 'Pure', 'Statistics', 'Mechanics', 'Further Pure', 'Further Stats', 'Further Mech'; physics: its topic
  teacher: string | null
  halfTerm: string | null         // 'HT1' …
  taughtFrom: string | null       // YYYY-MM-DD
  taught: 'yes' | 'in_class' | 'not_yet' | null   // physics (wins over taughtFrom)
  status: Colour
  step: number                    // 0–6 (STEPS)
  bicen: string | null
  integralUrl: string | null
  freshPct: number | null
  lastDone: string | null         // YYYY-MM-DD
  weakNotes: string | null
  concepts: string | null
  booklet: 'done' | 'doing' | 'todo' | null
  pmt: 'done' | 'doing' | 'todo' | null
  pmtRef: string | null
  bookRef: string | null          // 'Y1 red · 1'
  order: number                   // school order within the subject: getting ahead follows it
}

export type Attempt = { id: string; goalId: string; doneOn: string; what: AttemptWhat; label: string | null; score: number | null; outOf: number | null }

export type TrackerTest = {
  id: string                      // goals.id
  title: string
  date: string | null             // goals.target_date
  kind: TestKind
  subjectId: string | null
  subject: string | null
  info: string | null
  topicCodes: string[]
  minutesPerDay: number | null    // consolidation's daily slot (low end)
  minutesMax: number | null
  limits: string | null           // "no momentum"
  lengthMin: number | null
  marks: number | null
  attempts: Attempt[]
}

export type TrackerMistake = {
  id: string
  goalId: string | null
  topicId: string | null
  subjectId: string | null
  code: string | null
  question: string | null
  body: string                    // what went wrong
  kind: MistakeKind | null
  rule: string | null
  source: string | null
  loggedOn: string
  reviewOn: string                // the next redo date
  redoStage: number               // 0: first redo due · 1: second · 2: done
  reviewedAt: string | null
}

export type ProgrammeItem = {
  id: string; programmeId: string; position: number; title: string; details: string | null; url: string | null
  minutes: number | null; status: 'todo' | 'doing' | 'done' | 'skipped'; doneOn: string | null; result: string | null
  score: number | null; outOf: number | null
}
export type Programme = {
  id: string; name: string; area: 'study' | 'act' | 'training' | 'other'; subjectId: string | null
  perWeek: number; minutes: number; days: string | null; startsOn: string | null; endsOn: string | null
  status: 'active' | 'paused' | 'stopped' | 'done'; pausedUntil: string | null; mode: 'in_order' | 'gaps_only' | 'optional'
  notes: string | null; items: ProgrammeItem[]
}

/** A temporary rule (plans/contracts.md §3.6). target: 'act' · 'ahead' · 'stretch' · 'reviews' · 'physics' · 'programme:<name>' · 'subjects:Maths,Physics' · 'subject:<name>' */
export type PlanRule = { id: string; words: string; kind: 'boost' | 'pause' | 'cap' | 'note'; target: string; minutes: number | null; startsOn: string; endsOn: string }

export type HomeworkTask = { id: string; title: string; subjectId: string | null; subject: string | null; dueAt: string | null; minutes: number | null; details?: string | null }

/** Links from the "Start here" tab (yellow cells), editable in settings. Empty = not pasted yet. */
export type TrackerLinks = { bicenPure: string; bicenStats: string; bicenMech: string; bicenCorePure: string; bicenMemorise: string; bicenSummaries: string; bicenHardest: string; integralFurther: string; integralAssessments: string; madas: string; step: string; pmtPhysics: string; isaac: string; amsp: string }

export type StudyWorld = {
  today: string
  topics: TrackerTopic[]
  tests: TrackerTest[]            // live tests (not archived), any date
  mistakes: TrackerMistake[]      // open ones (redoStage < 2, not archived)
  programmes: Programme[]         // not archived (any status)
  rules: PlanRule[]               // not archived (expired ones included: the engine ignores them)
  homework: HomeworkTask[]        // open homework tasks (not done, not archived, not someday)
  links: TrackerLinks
  reviewDays: { not_secure: number; understand: number; exam_ready: number; not_started: number }   // 1 / 3 / 14 / 7
  doneToday: string[]             // pick keys already done today (so they aren't picked again)
}
