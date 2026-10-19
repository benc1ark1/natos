// ACT shapes (plans/contracts.md §5). CONTRACT STUB (pr/0-setup): queue item 2 fills these in; the names stay.
import type { Programme, TrackerMistake } from '../tracker/types'

export type ActScore = { id: string; takenOn: string; kind: 'real' | 'practice' | 'section'; english: number | null; maths: number | null; reading: number | null; science: number | null; composite: number | null }

export type ActWorld = {
  today: string
  retake: { goalId: string; date: string } | null   // a test goal with test_kind 'act' and a date → countdown mode
  goal: number                                       // target composite (36)
  scores: ActScore[]                                 // oldest first
  books: Programme[]                                 // programmes with area 'act'
  misses: TrackerMistake[]                           // open ACT mistakes (rule = the grammar rule)
  doneToday: string[]
}
