import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventException, EventRow, TargetLog, WeeklyTarget } from './types'
import { addDays, timeOf } from './time'
import { expandEvents, type Occurrence } from './events'

/** A target's number for one week only ("coach set 3 lower this week"); the usual number stays as it is. */
export type WeekCount = { target_id: string; week_start: string; target_count: number }

type WeekData = { events: EventRow[]; changes: EventException[]; logs: TargetLog[]; weekStart: string; today: string; weekCounts?: WeekCount[] }

/** This week's one-week numbers. Empty (never an error) if there are none, or before jarvis-c1.sql has run. */
export async function loadWeekCounts(sb: SupabaseClient, weekStart: string): Promise<WeekCount[]> {
  const { data, error } = await sb.from('target_weeks').select('target_id,week_start,target_count').eq('week_start', weekStart)
  return error ? [] : ((data ?? []) as WeekCount[])
}

/** Has this session finished? (its end, or its start if it has no end, is in the past) */
export function hasEnded(o: Occurrence, today: string, now = new Date()): boolean {
  if (o.date !== today) return o.date < today
  return (o.end ?? o.start ?? '00:00') <= timeOf(now)
}

/**
 * This week's progress for a target.
 * - Log taps: done = sessions logged, target = its per-week number.
 * - Calendar sessions (e.g. Team): target = linked sessions this week (not cancelled);
 *   done = those that have finished, minus any marked missed.
 */
export function targetProgress(t: WeeklyTarget, d: WeekData): { done: number; target: number } {
  if (t.counts_from === 'events') {
    const linked = expandEvents(d.events.filter((e) => e.target_id === t.id), d.weekStart, addDays(d.weekStart, 6), d.changes)
      .filter((o) => !o.cancelled)
    return { target: linked.length, done: linked.filter((o) => !o.missed && hasEnded(o, d.today)).length }
  }
  const week = d.weekCounts?.find((w) => w.target_id === t.id && w.week_start === d.weekStart)
  return { target: week ? week.target_count : t.target_count, done: d.logs.filter((l) => l.target_id === t.id).reduce((a, l) => a + l.amount, 0) }
}
