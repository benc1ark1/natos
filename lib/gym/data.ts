// Gym progress (queue item 6): reading and writing lift_sets as Nat (row level security: only his rows). Used by the
// bot plug-in, the Training page and the Hevy import. Rows are never deleted: undo and "remove" archive them.
// Works before supabase/gym.sql runs: reads come back empty with `missing` set, writes say to run the file.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { LiftRow, NewLift } from './types'

export const COLS = 'id,done_on,exercise,exercise_key,weight_kg,reps,sets,rpe,source,source_ref,notes,archived_at,created_at,updated_at'
export const RUN_SQL = 'Lifts can’t be saved yet: run supabase/gym.sql in Supabase (SQL Editor → New query → paste → Run).'

type PgError = { message?: string; code?: string } | null
/** lift_sets isn't there yet (gym.sql not run). */
export const isMissing = (e: PgError) => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /lift_sets/.test(e.message ?? '') && /does not exist|could not find|schema cache/i.test(e.message ?? ''))

/** numeric columns come back as strings from PostgREST: make them numbers. */
export const asLift = (r: Record<string, unknown>): LiftRow => ({
  ...(r as unknown as LiftRow), weight_kg: Number(r.weight_kg), reps: Number(r.reps), sets: Number(r.sets), rpe: r.rpe == null ? null : Number(r.rpe),
  done_on: String(r.done_on).slice(0, 10),
})

/** His lifts (not archived), oldest first. `from`: on or after that day; `keys`: only those exercises. */
export async function loadLifts(sb: SupabaseClient, opts: { from?: string; keys?: string[]; max?: number } = {}): Promise<{ rows: LiftRow[]; missing: boolean }> {
  const out: LiftRow[] = []
  const max = opts.max ?? 5000
  for (let page = 0; out.length < max; page++) {
    let q = sb.from('lift_sets').select(COLS).is('archived_at', null)
    if (opts.from) q = q.gte('done_on', opts.from)
    if (opts.keys?.length) q = q.in('exercise_key', opts.keys.slice(0, 50))
    const { data, error } = await q.order('done_on', { ascending: true }).order('created_at', { ascending: true }).range(page * 1000, page * 1000 + 999)
    if (error) { if (isMissing(error)) return { rows: [], missing: true }; throw new Error(`Couldn’t read your lifts: ${error.message}`) }
    out.push(...((data ?? []) as Record<string, unknown>[]).map(asLift))
    if (!data || data.length < 1000) break
  }
  return { rows: out.slice(0, max), missing: false }
}

/** The newest lifts first (for refs); `logged`: the most recently logged first ("remove my last lift"), not the latest day. */
export async function recentLifts(sb: SupabaseClient, limit = 300, opts: { logged?: boolean } = {}): Promise<{ rows: LiftRow[]; missing: boolean }> {
  const base = sb.from('lift_sets').select(COLS).is('archived_at', null)
  const ordered = opts.logged ? base.order('created_at', { ascending: false }) : base.order('done_on', { ascending: false }).order('created_at', { ascending: false })
  const { data, error } = await ordered.limit(limit)
  if (error) { if (isMissing(error)) return { rows: [], missing: true }; throw new Error(`Couldn’t read your lifts: ${error.message}`) }
  return { rows: ((data ?? []) as Record<string, unknown>[]).map(asLift), missing: false }
}

/** Save new lifts; returns them as the database holds them (never claims a save it can't see). */
export async function insertLifts(sb: SupabaseClient, rows: NewLift[]): Promise<LiftRow[]> {
  if (!rows.length) return []
  const { data, error } = await sb.from('lift_sets').insert(rows).select(COLS)
  if (error) throw new Error(isMissing(error) ? RUN_SQL : `Not saved: ${error.message}`)
  if (!data || data.length !== rows.length) throw new Error('Not saved: the database didn’t confirm every lift.')
  return (data as Record<string, unknown>[]).map(asLift)
}

/** Archive lifts (never deleted). */
export async function archiveLifts(sb: SupabaseClient, ids: string[], at = new Date().toISOString()): Promise<void> {
  if (!ids.length) return
  const { data, error } = await sb.from('lift_sets').update({ archived_at: at }).in('id', ids).select('id')
  if (error) throw new Error(`Not saved: ${error.message}`)
  if ((data ?? []).length !== ids.length) throw new Error('Not saved: some of those lifts aren’t there any more.')
}

/**
 * Import rows from a Hevy export: each set once (by source_ref). Sets already there are skipped; sets he removed
 * earlier (archived) come back. Returns what the database confirmed.
 */
/** Every imported set he already has (by source_ref), archived or not. */
export async function knownRefs(sb: SupabaseClient): Promise<Map<string, { id: string; archived: boolean }>> {
  const refs = new Map<string, { id: string; archived: boolean }>()
  for (let page = 0; page < 50; page++) {
    const { data, error } = await sb.from('lift_sets').select('id,source_ref,archived_at').not('source_ref', 'is', null).order('id').range(page * 1000, page * 1000 + 999)
    if (error) throw new Error(isMissing(error) ? RUN_SQL : `Couldn’t read your lifts: ${error.message}`)
    for (const r of (data ?? []) as { id: string; source_ref: string; archived_at: string | null }[]) refs.set(r.source_ref, { id: r.id, archived: !!r.archived_at })
    if (!data || data.length < 1000) break
  }
  return refs
}

export async function importLifts(sb: SupabaseClient, rows: NewLift[]): Promise<{ added: number; restored: number; already: number }> {
  const refs = new Map<string, { id: string; archived: boolean }>()
  const readRefs = async () => { refs.clear(); for (const [k, v] of await knownRefs(sb)) refs.set(k, v) }
  await readRefs()
  const seen = new Set<string>()
  const unique = rows.filter((r) => r.source_ref && !seen.has(r.source_ref) && seen.add(r.source_ref))
  let added = 0, restored = 0, already = 0
  const insertNew = async (list: NewLift[]) => {
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500)
      const { data, error } = await sb.from('lift_sets').insert(chunk).select('id')
      if (error) return error
      added += (data ?? []).length
    }
    return null
  }
  // never "Not saved" when some of it was: say how much went in (importing the file again adds only the rest)
  const fail = (msg: string): never => {
    throw new Error(added + restored ? `Saved ${added + restored} of ${unique.length} sets, then stopped: ${msg}. Choose the file again to add the rest (nothing is added twice).` : `Not saved: ${msg}`)
  }
  const fresh = unique.filter((r) => !refs.has(r.source_ref!))
  const err = await insertNew(fresh)
  if (err) {
    // a second import at the same moment saved some of them first: read again and add only what's still missing
    if (err.code !== '23505') { if (isMissing(err)) throw new Error(RUN_SQL); fail(err.message) }
    await readRefs()
    const err2 = await insertNew(unique.filter((r) => !refs.has(r.source_ref!)))
    if (err2) fail(err2.message)
  }
  const back = unique.map((r) => refs.get(r.source_ref!)).filter((x): x is { id: string; archived: boolean } => !!x && x.archived).map((x) => x.id)
  for (let i = 0; i < back.length; i += 100) {
    const { data, error } = await sb.from('lift_sets').update({ archived_at: null }).in('id', back.slice(i, i + 100)).select('id')
    if (error) fail(error.message)
    restored += (data ?? []).length
  }
  already = unique.length - added - restored
  return { added, restored, already: Math.max(0, already) }
}
