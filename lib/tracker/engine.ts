// The study planner (plans/contracts.md §3.4): decides WHAT to do today and WHICH resource, by the strict priority
// order (lib/plan-items.ts TIER) and the leftover split. Pure: no database, no clock, no AI.
// CONTRACT STUB (pr/0-setup): queue item 1 replaces the body; the signature stays.
import type { DayContext, Pick } from '../plan-items'
import type { StudyWorld } from './types'

export type StudyPlan = {
  picks: Pick[]                 // in priority order, minutes chosen; the caller shows ≤ 5 a day (lib/today)
  mode: 'half_term' | 'school'
  testMode: { goalId: string; title: string; daysLeft: number } | null   // the nearest test within 3 weeks
  notes: string[]               // why things were left out ("paused: getting ahead until Sun 25 Oct")
}

/** Today's study, in order. `extra` = picks from other planners (ACT: lib/act/engine.ts), merged by tier. */
export function planStudyDay(world: StudyWorld, day: DayContext, extra: Pick[] = []): StudyPlan {
  return { picks: [...extra].sort((a, b) => a.tier - b.tier), mode: day.mode, testMode: null, notes: [] }
}
