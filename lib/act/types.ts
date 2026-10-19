// ACT shapes (plans/contracts.md §5): scores, the retake date, the books (programmes with area 'act'), the misses
// (mistakes on the ACT subject, with the grammar rule) and his ACT settings. Pure types and small constants.
import type { Programme, TrackerMistake } from '../tracker/types'

/** The four sections of the (enhanced) ACT. The composite is the mean of English, Maths and Reading; Science is separate. */
export type ActSection = 'english' | 'maths' | 'reading' | 'science'
export const SECTIONS: ActSection[] = ['english', 'maths', 'reading', 'science']
/** The composite's sections, in the order the rotation goes when nothing is weaker. */
export const CORE: ActSection[] = ['english', 'reading', 'maths']
export const SECTION_LABEL: Record<ActSection, string> = { english: 'English', maths: 'Maths', reading: 'Reading', science: 'Science' }
export const SECTION_LETTER: Record<ActSection, string> = { english: 'E', maths: 'M', reading: 'R', science: 'S' }

/** Enhanced ACT timings (minutes): English 50 Qs in 35 · Maths 45 Qs in 50 · Reading 36 Qs in 40 · Science 40 Qs in 40. */
export const SECTION_MIN: Record<ActSection, number> = { english: 35, maths: 50, reading: 40, science: 40 }

export type ActScore = { id: string; takenOn: string; kind: 'real' | 'practice' | 'section'; english: number | null; maths: number | null; reading: number | null; science: number | null; composite: number | null }

/** What a book is for in the plan. Read from the programme's notes ("role=english"), else from its name and mode. */
export type BookRole = 'english' | 'reading' | 'maths_gaps' | 'maths_hard' | 'reading_extra' | 'flashcards' | 'other'

/** His ACT settings (lib/act/settings.ts), already checked. */
export type ActSettings = {
  halfTermMin: number          // steady mode in the holidays: ACT a day, the flashcards included (~75)
  schoolMin: number            // steady mode in school weeks: one session (the flashcards come on top) (30)
  schoolDays: number[]         // ISO weekdays of the school-week sessions (3 a week)
  flashMin: number             // the daily grammar flashcards (Anki) (10; 0 = off)
  fullTestDow: number          // steady holidays: the weekly full timed test (the review is the next day)
  mockDows: number[]           // countdown: the full timed tests (holidays: each reviewed straight after; school weeks: the first, reviewed the next day)
  countdownHolidayMin: number  // countdown: ACT a day in the holidays (240)
  science: boolean             // the full test includes Science
}

export type ActWorld = {
  today: string
  retake: { goalId: string; date: string } | null   // a test goal with test_kind 'act' and a date → countdown mode
  goal: number                                       // target composite (36)
  scores: ActScore[]                                 // oldest first
  books: Programme[]                                 // programmes with area 'act' (the daily flashcards are one too)
  misses: TrackerMistake[]                           // open ACT mistakes (rule = the grammar rule)
  doneToday: string[]                                // pick keys done today; 'act:day' = ACT work already done today
  settings?: ActSettings                             // missing = the defaults
  subjectId?: string | null                          // the ACT subject (null: not set up yet)
}
