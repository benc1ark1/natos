// Server-only: applying the study tracker's checked changes after ✅, and ↩️ Undo (plans/contracts.md §2). Every op is
// a list of row steps (lib/tracker/bot-ops.ts): an update remembers the row's values before and after, so Undo puts
// them back only if nothing changed them since; a new row is archived on Undo, never deleted. As Nat (RLS).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PluginAction, PluginApplied } from '../telegram/plugin-types'
import { NOW, type NextHint, type Step, type TrkPatch } from './bot-ops'

type Done = { kind: 'update'; table: string; id: string; before: Record<string, unknown>; after: Record<string, unknown> } | { kind: 'insert'; table: string; id: string }
export type TrkApplied = { steps: Done[]; next?: NextHint }

const fill = (o: Record<string, unknown>, now: string, ids: string[]) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === NOW ? now : typeof v === 'string' && /^\$\d+$/.test(v) ? ids[Number(v.slice(1))] ?? null : v]))
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Apply one change's steps, in order. If a step fails, the ones already done are put back and the error is thrown. */
export async function applyTrk(sb: SupabaseClient, a: PluginAction, now: string): Promise<PluginApplied> {
  const { steps, next } = a.patch as TrkPatch
  const done: Done[] = []
  const ids: string[] = []
  try {
    for (const s of steps as Step[]) {
      if (s.kind === 'insert') {
        const { data, error } = await sb.from(s.table).insert(fill(s.row, now, ids)).select('id').single()
        if (error || !data) throw new Error(`Not saved: ${error?.message ?? 'no row'}`)
        ids.push(String(data.id))
        done.push({ kind: 'insert', table: s.table, id: String(data.id) })
        continue
      }
      const set = fill(s.set, now, ids)
      const keys = Object.keys(set)
      const { data: old, error: readErr } = await sb.from(s.table).select(keys.join(',')).eq('id', s.id).maybeSingle()
      if (readErr || !old) throw new Error(`Couldn’t find it any more (${readErr?.message ?? 'not found'})`)
      const { data: row, error } = await sb.from(s.table).update(set).eq('id', s.id).select(keys.join(',')).single()
      if (error || !row) throw new Error(`Not saved: ${error?.message ?? 'no row'}`)
      ids.push(s.id)
      done.push({ kind: 'update', table: s.table, id: s.id, before: old as unknown as Record<string, unknown>, after: row as unknown as Record<string, unknown> })
    }
  } catch (e) {
    await putBack(sb, done, now).catch(() => null)
    throw e
  }
  // a new mistake / test / rule: the hint can point at the row it made
  const hint: NextHint | undefined = next ? { ...next, ...(a.op === 'trk_mistake' && ids[0] ? { mistakeId: ids[0] } : {}) } : undefined
  return { op: a.op, table: a.table, id: a.id ?? ids[0] ?? '', title: a.title, before: null, after: { steps: done, ...(hint ? { next: hint } : {}) } satisfies TrkApplied }
}

async function putBack(sb: SupabaseClient, done: Done[], now: string) {
  for (const s of [...done].reverse()) {
    if (s.kind === 'insert') await sb.from(s.table).update({ archived_at: now }).eq('id', s.id).is('archived_at', null)
    else await sb.from(s.table).update(s.before).eq('id', s.id)
  }
}

/** ↩️ Undo: everything back, only if none of the rows it changed were changed again since (then nothing is touched). */
export async function undoTrk(sb: SupabaseClient, a: PluginApplied): Promise<'undone' | 'skipped'> {
  const steps = ((a.after ?? {}) as TrkApplied).steps ?? []
  for (const s of steps) {
    if (s.kind !== 'update') continue
    const keys = Object.keys(s.after)
    const { data, error } = await sb.from(s.table).select(keys.join(',')).eq('id', s.id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data || keys.some((k) => !same((data as unknown as Record<string, unknown>)[k], s.after[k]))) return 'skipped'
  }
  const now = new Date().toISOString()
  for (const s of [...steps].reverse()) {
    const res = s.kind === 'insert'
      ? await sb.from(s.table).update({ archived_at: now }).eq('id', s.id).select('id')   // archived, never deleted
      : await sb.from(s.table).update(s.before).eq('id', s.id).select('id')
    if (res.error) throw new Error(res.error.message)
  }
  return 'undone'
}
