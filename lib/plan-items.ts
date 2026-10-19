// What the planner hands to Today, the morning message, the evening wrap-up and the weekly check (plans/contracts.md §3.1):
// one thing to do, the exact resource to open, how long, why, and what "done" moves forward. The study tracker
// (lib/tracker/engine.ts), ACT (lib/act/engine.ts) and the gym plan all produce these; lib/today/ places them in the
// day (≤ 5 a day). Pure types: no database, no clock.

/** The strict priority order (my-spec + overnight queue): lower = first. */
export const TIER = {
  homework: 1,      // homework due (school, tutors)
  boost: 1.5,       // a temporary "X top priority" rule: right after homework
  test: 2,          // tests / consolidation / papers within 3 weeks (incl. the ACT countdown)
  review: 3,        // due reviews and mistake redos
  fix: 4,           // 🔴 taught topics
  ahead: 5,         // getting ahead (maths, school order)
  stretch: 6,       // stretch (🟢 only): Bicen hardest → MadAs → STEP
  leftover: 7,      // the leftover-time share (current / old / fixing), steady ACT, programmes
  training: 8,      // a training session (placed by the week optimiser; listed for Today only)
} as const
export type Tier = (typeof TIER)[keyof typeof TIER]

export type PickKind =
  | 'homework' | 'test_diagnostic' | 'test_booklet' | 'test_topic' | 'test_timed' | 'test_light' | 'consolidation'
  | 'review' | 'mistake_redo' | 'fix' | 'ahead' | 'current' | 'old' | 'stretch' | 'physics'
  | 'programme' | 'act' | 'flashcards' | 'training' | 'task'

/** What "done" moves forward when he ticks it or reports it. */
export type DoneHint =
  | { kind: 'task'; taskId: string }                                   // completes (archives) the task
  | { kind: 'topic'; topicId: string; step?: number; physics?: 'booklet' | 'pmt' }   // the topic's last_done = today (and its step, if given; physics: its booklet / PMT questions = done)
  | { kind: 'mistakes'; mistakeIds: string[] }                          // each redo moves on a stage
  | { kind: 'attempt'; goalId: string; what: 'diagnostic' | 'booklet' | 'timed' | 'paper' | 'real' | 'other'; label?: string }   // asks for the score (label: saved on the attempt — a booklet pick's topic code, so only that topic's booklet ends)
  | { kind: 'programme_item'; itemId: string; score?: boolean }        // the item is done; the programme moves to the next (score: a gaps_only chapter test — ask the score; full marks = skip the chapter, else it stays to do)
  | { kind: 'act'; section: 'english' | 'maths' | 'reading' | 'science' | 'full' | 'flashcards' | 'review' }
  | { kind: 'block' }                                                   // nothing else: the plan block is just ticked

export type Pick = {
  key: string                   // stable within a day: 'task:<id>', 'topic:<id>:ahead', 'test:<goalId>:timed', 'prog:<itemId>', 'act:english:timed'
  kind: PickKind
  tier: Tier
  subject: string | null        // 'Maths' | 'Further Maths' | 'Physics' | 'ACT' | …
  title: string                 // short: "PC1-01 Matrices: exam questions"
  open: string                  // the exact thing to open: "Bicen Core Pure → CP1: Matrices (one 30–45 min set, mark straight after)"
  url?: string | null
  minutes: number
  steps?: { minutes: number; what: string }[]   // e.g. the 90-min ahead session
  why: string                   // one short reason: "test in 9 days · 🔴"
  done: DoneHint
  topicId?: string | null
  goalId?: string | null
  taskId?: string | null
  programmeItemId?: string | null
  heavy?: boolean               // hard thinking (placed while fresh)
}

/** The day the planner is picking for. lib/today/ fills this in from his calendar and settings. */
export type DayContext = {
  date: string                  // YYYY-MM-DD
  dow: number                   // ISO weekday, 1 = Mon … 7 = Sun
  mode: 'half_term' | 'school'  // a holiday (half-term, Christmas…) or a normal school week (weekends count as school weeks)
  studyMinutes: number          // minutes he has for study today (free time after events, training and routines)
  maxPicks?: number             // the most study picks to return (default 5, clamped 1–6; Today passes 5 − training − tasks).
                                // Tier-8 training picks passed in `extra` go through OUTSIDE this cap.
  actTaskMin?: number           // minutes of the ACT tasks he put on this day himself (part of the day's ACT time)
}
