import type { SupabaseClient } from '@supabase/supabase-js'
import type { Goal } from './types'
import { rows } from './data'
import { daysBetween, dowShort, shortDate } from './time'

export const GOAL_COLS = 'id,title,target_date,archived_at,created_at,kind,subject_id,topics,priority,project_id'

/** Goals still in play: not archived, and ongoing or not yet past their date. */
export async function loadActiveGoals(sb: SupabaseClient, today: string): Promise<Goal[]> {
  const res = await sb.from('goals').select(GOAL_COLS)
    .is('archived_at', null).or(`target_date.is.null,target_date.gte.${today}`)
    .order('target_date', { ascending: true, nullsFirst: false }).order('created_at')
  return rows<Goal>(res, 'goals')
}

/** "Today", "Tomorrow", "Wed · 3 days", "Fri 30 Oct · 26 days", or "Ongoing". */
export function goalWhen(g: Goal, today: string): string {
  if (!g.target_date) return 'Ongoing'
  const n = daysBetween(today, g.target_date)
  if (n <= 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  return `${n < 7 ? dowShort(g.target_date) : `${dowShort(g.target_date)} ${shortDate(g.target_date)}`} · ${n} days`
}

export async function setGoalArchived(sb: SupabaseClient, g: Goal, archived: boolean): Promise<string | null> {
  const { data, error } = await sb.from('goals')
    .update({ archived_at: archived ? new Date().toISOString() : null, status: archived ? 'archived' : 'active' })
    .eq('id', g.id).select('id').single()
  return error || !data ? `Couldn't ${archived ? 'archive' : 'restore'} “${g.title}”: ${error?.message ?? 'not saved'}` : null
}
