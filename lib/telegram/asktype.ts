// Server-only: "What type of training is Owen training?" A session (calendar event) or weekly target whose name looks
// like training but has no type yet is asked about once: once per name, so a rename asks again. Sessions are asked
// about by name, not one by one: Google copies of a weekly session are separate rows with the same title, and his
// answer covers all of them (and later copies with that title inherit it on the next tick). The guess from the
// name is only the suggested answer; his tap is what's stored. ↩️ Undo puts back what was there.
// Asked straight after the bot adds a session, and otherwise by the 5-minute tick (one question at a time, daytime),
// which catches sessions and targets added or renamed on the dashboard.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { NOT_TRAINING, activeTypes, defaultLoad, guessType, isTrainingType, labelOf, trainingTypes, type TypeDef } from '../training'
import type { Applied } from './actions'
import { esc, type Button } from './api'
import { claim, release } from './sent'
import { liveEvents } from '../setup'
import { say } from './turns'

export type TypeQuestion = { table: 'events' | 'weekly_targets'; id: string; name: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** No type stored yet, and the name looks like training (by his training types' words). */
export const needsType = (name: string, stored: string | null | undefined, types?: TypeDef[]) => !stored && !!guessType(name, types)

const loadPlanning = (sb: SupabaseClient) => sb.from('profiles').select('planning').maybeSingle().then((r) => (r.error ? null : r.data?.planning ?? null))
const loadTypes = (sb: SupabaseClient) => loadPlanning(sb).then(trainingTypes)

/** Ask about the next session or target that needs a type (only these ids, if given). True if a question went out. */
export async function askNextType(sb: SupabaseClient, chatId: number, only?: string[]): Promise<boolean> {
  const [ev, tg, planning] = await Promise.all([
    sb.from('events').select('id,title,training_type,load,external_source').is('archived_at', null).order('created_at'),
    sb.from('weekly_targets').select('id,name,training_type').eq('is_active', true).order('sort_order'),
    loadPlanning(sb),
  ])
  if (ev.error || tg.error) return false   // before jarvis-d2.sql: nothing to ask
  const types = trainingTypes(planning)
  // read-only sessions he asked the app to ignore are never asked about
  const events = await inheritTypes(sb, liveEvents((ev.data ?? []) as (EventTypeRow & { external_source?: string })[], planning))
  const seen = new Set<string>()
  const list: TypeQuestion[] = [
    ...events.filter((e) => needsType(e.title, e.training_type, types)).filter((e) => !seen.has(norm(e.title)) && !!seen.add(norm(e.title)))
      .map((e) => ({ table: 'events' as const, id: e.id as string, name: e.title as string })),
    ...(tg.data ?? []).filter((t) => needsType(t.name, t.training_type, types)).map((t) => ({ table: 'weekly_targets' as const, id: t.id as string, name: t.name as string })),
  ].filter((r) => !only || only.includes(r.id))
  for (const r of list) {
    const n = norm(r.name)
    if (r.table === 'events') {
      // asked about under this name before (this key, or the older one-per-session key)
      const { data: had } = await sb.from('telegram_sent').select('key').like('key', `ttype:%:${n}`).limit(1)
      if (had?.length) continue
    }
    const key = r.table === 'events' ? `ttype:name:${n}` : `ttype:${r.id}:${n}`
    if (!(await claim(sb, key))) continue   // asked about under this name before
    try {
      await askType(sb, chatId, r, types)
      return true
    } catch (e) {
      await release(sb, key)
      throw e
    }
  }
  return false
}

type EventTypeRow = { id: string; title: string; training_type: string | null; load?: string | null }

/** Sessions with no type take the type he already gave another session with the same name. Returns the list as it is now. */
async function inheritTypes(sb: SupabaseClient, events: EventTypeRow[]): Promise<EventTypeRow[]> {
  const known = new Map<string, { training_type: string; load: string | null }>()
  for (const e of events) if (e.training_type && !known.has(norm(e.title))) known.set(norm(e.title), { training_type: e.training_type, load: e.load ?? null })
  const fill = events.filter((e) => !e.training_type && known.has(norm(e.title)))
  for (const e of fill) {
    const t = known.get(norm(e.title))!
    const { error } = await sb.from('events').update(t).eq('id', e.id).is('training_type', null)
    if (!error) Object.assign(e, t)
  }
  return events
}

async function askType(sb: SupabaseClient, chatId: number, r: TypeQuestion, types: TypeDef[]) {
  const guess = guessType(r.name, types)
  const { data, error } = await sb.from('telegram_pending').insert({ kind: 'type', text: r.name, payload: r }).select('id').single()
  if (error || !data) throw new Error(`Couldn’t ask about “${r.name}”: ${error?.message ?? 'not saved'}`)
  const b = (t: string, text: string): Button => ({ text, callback_data: `t:${data.id}:${t}` })
  const rows: Button[][] = guess ? [[b(guess.type, `✓ ${labelOf(guess.type, types)} (my guess)`)]] : []
  const rest = activeTypes(types).filter((t) => t.key !== guess?.type).map((t) => b(t.key, t.label))
  for (let i = 0; i < rest.length; i += 4) rows.push(rest.slice(i, i + 4))
  rows.push([b(NOT_TRAINING, 'Not training')])
  const what = r.table === 'events' ? 'the calendar session' : 'the weekly target'
  await say(sb, chatId, `🏃 What type of training is ${what} <b>${esc(r.name)}</b>? The training rules use it.${guess ? `\n<i>From the name I’d guess ${esc(labelOf(guess.type, types))}, but that’s only a guess.</i>` : ''}`,
    rows, { pending_id: data.id, refs: [{ kind: r.table === 'events' ? 'event' : 'target', id: r.id, title: r.name }] })
}

/** His tap: store the type (and its usual load). Returns what Undo needs, or an error. */
export async function setType(sb: SupabaseClient, r: TypeQuestion, type: string): Promise<{ applied?: Applied[]; words?: string; error?: string }> {
  const types = await loadTypes(sb)
  if (!isTrainingType(type, types) && type !== NOT_TRAINING) return { error: 'That isn’t one of your training types.' }
  const load = type === NOT_TRAINING ? null : defaultLoad(type, types)
  // a session: every session with this name that has no type yet (Google copies of one weekly session), plus this one
  let ids = [r.id]
  if (r.table === 'events') {
    const { data: same } = await sb.from('events').select('id,title').is('archived_at', null).is('training_type', null)
    ids = [...new Set([r.id, ...(same ?? []).filter((e) => norm(e.title as string) === norm(r.name)).map((e) => e.id as string)])]
  }
  const applied: Applied[] = []
  for (const id of ids) {
    const { data: row, error: e1 } = await sb.from(r.table).select('training_type,load').eq('id', id).maybeSingle()
    if (e1 || !row) { if (id === r.id) return { error: `Couldn’t find “${r.name}” any more.` }; continue }
    const { error } = await sb.from(r.table).update({ training_type: type, load }).eq('id', id).select('id').single()
    if (error) return { error: `Not saved: ${error.message}` }
    applied.push({ op: 'training_type', table: r.table, id, title: r.name, before: { training_type: row.training_type ?? null, load: row.load ?? null }, after: { training_type: type, load } })
  }
  const words = load ? `${labelOf(type, types)} (${load})` : 'not training (the rules leave it out)'
  return { words: ids.length > 1 ? `${words}, all ${ids.length} in your calendar` : words, applied }
}
