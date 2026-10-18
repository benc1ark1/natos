import type { SupabaseClient } from '@supabase/supabase-js'

// "Export my data": every table, as Nat (row level security means only his rows), in one JSON file.
// Records when and where it came from, and checks each table's row count against the database.

export const EXPORT_TABLES = [
  'profiles', 'categories', 'subjects', 'projects', 'tasks', 'goals', 'weekly_targets', 'target_logs',
  'events', 'event_exceptions', 'habits', 'habit_items', 'habit_logs', 'routine_steps', 'reminders',
  'resources', 'context_facts', 'guides', 'weekly_reviews', 'journal_entries', 'memory_items',
  'telegram_turns', 'ai_usage', 'target_weeks', 'plan_blocks', 'day_state', 'training_rules', 'places', 'travel_times', 'app_ideas',
  'integrations', 'google_links', 'whoop_days', 'whoop_workouts', 'pipeline_stages', 'topics', 'topic_progress', 'mistakes', 'guide_logs',
] as const

// Columns per table when not all of them: the connections' encrypted sign-in tokens never go into a backup
// (after a restore he just connects again).
const COLUMNS: Record<string, string> = { integrations: 'id,user_id,provider,status,account,scopes,settings,last_sync_at,last_error,connected_at,created_at,updated_at' }

const PAGE = 1000   // Supabase returns at most 1000 rows per request

export type ExportResult = {
  file: { exported_at: string; source: string; format: 1; counts: Record<string, number>; tables: Record<string, unknown[]> }
  total: number
  failed: { table: string; error: string }[]
}

async function readAll(sb: SupabaseClient, table: string): Promise<unknown[]> {
  const out: unknown[] = []
  for (let from = 0; ; from += PAGE) {
    // ordered by primary key so pages never overlap or skip
    const { data, error } = await sb.from(table).select(COLUMNS[table] ?? '*').order(table === 'profiles' ? 'user_id' : 'id').range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) return out
  }
}

export async function exportAll(sb: SupabaseClient): Promise<ExportResult> {
  const tables: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}
  const failed: ExportResult['failed'] = []
  await Promise.all(EXPORT_TABLES.map(async (t) => {
    try {
      const rowsRead = await readAll(sb, t)
      // count check: what the database says vs what was read
      const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true })
      if (error) throw new Error(error.message)
      if (count !== rowsRead.length) throw new Error(`read ${rowsRead.length} rows but the database has ${count}`)
      tables[t] = rowsRead
      counts[t] = rowsRead.length
    } catch (e) {
      failed.push({ table: t, error: e instanceof Error ? e.message : 'unknown error' })
    }
  }))
  // same table order in every file, so two backups are easy to compare
  const ordered = <T,>(o: Record<string, T>) => Object.fromEntries(EXPORT_TABLES.filter((t) => t in o).map((t) => [t, o[t]]))
  let source = 'unknown'
  try { source = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').host } catch {}
  return {
    file: { exported_at: new Date().toISOString(), source, format: 1, counts: ordered(counts), tables: ordered(tables) },
    total: Object.values(counts).reduce((a, n) => a + n, 0),
    failed,
  }
}

/** Save the export as a .json file in the browser's downloads. */
export function downloadJSON(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
