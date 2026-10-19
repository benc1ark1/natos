// ACT planner (plans/contracts.md §5): steady mode (no date) or countdown mode (a retake date), as picks for today.
// Pure: no database, no clock, no AI. CONTRACT STUB (pr/0-setup): queue item 2 replaces the body; the signature stays.
import type { DayContext, Pick } from '../plan-items'
import type { ActWorld } from './types'

/** Today's ACT work (tier 'test' in the countdown's last 3 weeks, else 'leftover'). */
export function actPicks(_world: ActWorld, _day: DayContext): Pick[] {
  return []
}
