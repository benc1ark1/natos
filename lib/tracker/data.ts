// Server-only: the study tracker's records, as Nat (row level security) (plans/contracts.md §3.3).
// CONTRACT STUB (pr/0-setup): queue item 1 replaces the body; the signatures stay. Before supabase/tracker.sql has run,
// loadStudyWorld still works (topics without the new columns, no programmes / rules / attempts).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StudyWorld } from './types'

export const EMPTY_LINKS: StudyWorld['links'] = { bicenPure: '', bicenStats: '', bicenMech: '', bicenCorePure: '', bicenMemorise: '', bicenSummaries: '', bicenHardest: '', integralFurther: '', integralAssessments: '', madas: '', step: '', pmtPhysics: '', isaac: '', amsp: '' }

/** Everything the study planner needs for `today`. */
export async function loadStudyWorld(_sb: SupabaseClient, today: string): Promise<StudyWorld> {
  return { today, topics: [], tests: [], mistakes: [], programmes: [], rules: [], homework: [], links: EMPTY_LINKS, reviewDays: { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 }, doneToday: [] }
}
