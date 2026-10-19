// Server-only: ACT records as Nat (row level security) (plans/contracts.md §5).
// CONTRACT STUB (pr/0-setup): queue item 2 replaces the body; the signature stays.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActWorld } from './types'

export async function loadActWorld(_sb: SupabaseClient, today: string): Promise<ActWorld> {
  return { today, retake: null, goal: 36, scores: [], books: [], misses: [], doneToday: [] }
}
