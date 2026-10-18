// Study pipelines in the database, as Nat (row level security). Used by the dashboard, capture and the bot.
// Nothing is deleted: stages and topics are archived, a stage done by mistake is marked undone, mistakes are archived.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserId } from './data'
import { moreSettings } from './settings'
import { parseTopicLines, type Mistake, type Progress, type Stage, type Topic } from './study'
import { addDays, todayISO } from './time'

export const STAGE_COLS = 'id,subject_id,name,sort_order,archived_at'
export const TOPIC_COLS = 'id,subject_id,name,spec_ref,notes_url,sort_order,archived_at'
export const MISTAKE_COLS = 'id,subject_id,topic_id,body,logged_on,review_on,reviewed_at,archived_at'

export type StudyData = { stages: Stage[]; topics: Topic[]; progress: Progress[]; mistakes: Mistake[] }

/** Everything study (archived stages/topics included, so old progress still has its names). Empty before the SQL runs. */
export async function loadStudy(sb: SupabaseClient, subjectId?: string): Promise<StudyData> {
  // one subject (its page) or all of them; the filter is a column match, so the shape stays simple
  const only = subjectId ? { subject_id: subjectId } : {}
  // the topic's colour (supabase/maths.sql); before that SQL runs, every topic reads as ⚪
  const topics = () => sb.from('topics').select(`${TOPIC_COLS},status`).match(only).order('sort_order')
    .then((r) => (r.error && /status/.test(r.error.message) ? sb.from('topics').select(TOPIC_COLS).match(only).order('sort_order') : r))
  const [st, tp, pr, mi] = await Promise.all([
    sb.from('pipeline_stages').select(STAGE_COLS).match(only).order('sort_order'),
    topics(),
    sb.from('topic_progress').select('id,topic_id,stage_id,done_at,undone_at'),
    sb.from('mistakes').select(MISTAKE_COLS).match(only).is('archived_at', null).order('review_on'),
  ])
  if (st.error && /pipeline_stages/.test(st.error.message)) return { stages: [], topics: [], progress: [], mistakes: [] }
  for (const r of [st, tp, pr, mi]) if (r.error) throw new Error(`Couldn’t read your study plan: ${r.error.message}`)
  return { stages: (st.data ?? []) as Stage[], topics: (tp.data ?? []) as unknown as Topic[], progress: (pr.data ?? []) as Progress[], mistakes: (mi.data ?? []) as Mistake[] }
}

/** Mark one stage of a topic done. Returns the progress row's id (for Undo). */
export async function markStageDone(sb: SupabaseClient, topicId: string, stageId: string, sourceText?: string | null): Promise<{ id?: string; error?: string }> {
  const user_id = await getUserId(sb)
  const { data, error } = await sb.from('topic_progress')
    .upsert({ user_id, topic_id: topicId, stage_id: stageId, done_at: new Date().toISOString(), undone_at: null, source_text: sourceText?.slice(0, 1000) ?? null }, { onConflict: 'user_id,topic_id,stage_id' })
    .select('id').single()
  return error || !data ? { error: `Not saved: ${error?.message ?? 'unknown error'}` } : { id: data.id }
}

/** Undo a stage marked done (the row stays, marked undone). */
export async function undoStage(sb: SupabaseClient, progressId: string): Promise<string | null> {
  const { error } = await sb.from('topic_progress').update({ undone_at: new Date().toISOString() }).eq('id', progressId).select('id').single()
  return error ? `Couldn’t undo: ${error.message}` : null
}

/**
 * Set a subject's stages to this ordered list of names. A stage with the same name keeps its id (and so its
 * progress), even when it moves; new names are added; stages left out are archived (their progress stays).
 * Returns what was there before, so it can be put back.
 */
export async function setStages(sb: SupabaseClient, subjectId: string, names: string[]): Promise<{ before?: Stage[]; error?: string }> {
  const clean = [...new Map(names.map((n) => n.trim().slice(0, 80)).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()]
  if (!clean.length) return { error: 'A pipeline needs at least one stage.' }
  const { data, error } = await sb.from('pipeline_stages').select(STAGE_COLS).eq('subject_id', subjectId)
  if (error) return { error: `Couldn’t read the pipeline: ${error.message}` }
  const before = (data ?? []) as Stage[]
  const user_id = await getUserId(sb)
  const used = new Set<string>()
  // a name at the same place as a stage whose name is gone is that stage renamed (it keeps its progress)
  const live = before.filter((s) => !s.archived_at).sort((a, b) => a.sort_order - b.sort_order)
  const lower = new Set(clean.map((n) => n.toLowerCase()))
  const renamed = new Map<number, Stage>()
  clean.forEach((name, i) => {
    const there = live[i]
    if (there && !lower.has(there.name.toLowerCase()) && !before.some((s) => s.name.toLowerCase() === name.toLowerCase())) renamed.set(i, there)
  })
  for (const [i, name] of clean.entries()) {
    const old = renamed.get(i) ?? before.find((s) => s.name.toLowerCase() === name.toLowerCase() && !used.has(s.id))
    const r = old
      ? await sb.from('pipeline_stages').update({ name, sort_order: i, archived_at: null }).eq('id', old.id).select('id').single()
      : await sb.from('pipeline_stages').insert({ user_id, subject_id: subjectId, name, sort_order: i }).select('id').single()
    if (r.error || !r.data) return { error: `Pipeline not saved: ${r.error?.message ?? 'unknown error'}` }
    used.add(r.data.id)
  }
  const gone = before.filter((s) => !used.has(s.id) && !s.archived_at).map((s) => s.id)
  if (gone.length) {
    const r = await sb.from('pipeline_stages').update({ archived_at: new Date().toISOString() }).in('id', gone)
    if (r.error) return { error: `Pipeline partly saved: ${r.error.message}` }
  }
  return { before }
}

/** Put a pipeline back exactly as it was (names, order, archived). */
export async function restoreStages(sb: SupabaseClient, subjectId: string, before: Stage[]): Promise<string | null> {
  const { data } = await sb.from('pipeline_stages').select('id').eq('subject_id', subjectId)
  const keep = new Set(before.map((s) => s.id))
  for (const s of before) {
    const r = await sb.from('pipeline_stages').update({ name: s.name, sort_order: s.sort_order, archived_at: s.archived_at }).eq('id', s.id)
    if (r.error) return r.error.message
  }
  const added = (data ?? []).map((s) => s.id as string).filter((id) => !keep.has(id))
  if (added.length) await sb.from('pipeline_stages').update({ archived_at: new Date().toISOString() }).in('id', added)
  return null
}

/** Add topics from pasted lines, skipping ones he already has. Returns the ids added. */
export async function addTopics(sb: SupabaseClient, subjectId: string, text: string): Promise<{ added?: string[]; skipped?: number; error?: string }> {
  const lines = parseTopicLines(text)
  if (!lines.length) return { error: 'Paste at least one topic (one per line).' }
  const { data, error } = await sb.from('topics').select('name,sort_order').eq('subject_id', subjectId)
  if (error) return { error: `Couldn’t read the topics: ${error.message}` }
  const have = new Set((data ?? []).map((t) => (t.name as string).toLowerCase()))
  let order = Math.max(-1, ...(data ?? []).map((t) => t.sort_order as number)) + 1
  const user_id = await getUserId(sb)
  const fresh = lines.filter((l) => !have.has(l.name.toLowerCase())).map((l) => ({ user_id, subject_id: subjectId, name: l.name, spec_ref: l.spec_ref, sort_order: order++ }))
  if (!fresh.length) return { added: [], skipped: lines.length }
  const r = await sb.from('topics').insert(fresh).select('id')
  if (r.error || !r.data) return { error: `Topics not saved: ${r.error?.message ?? 'unknown error'}` }
  return { added: r.data.map((x) => x.id as string), skipped: lines.length - fresh.length }
}

/** Log a mistake; it comes back for review after his "mistakes come back after" days (3 unless he changes it). */
export async function logMistake(sb: SupabaseClient, m: { subject_id: string | null; topic_id: string | null; body: string; source_text?: string | null }, planning?: unknown): Promise<{ id?: string; review_on?: string; error?: string }> {
  const body = m.body.trim().slice(0, 500)
  if (!body) return { error: 'What was the mistake?' }
  const days = moreSettings(planning ?? await sb.from('profiles').select('planning').maybeSingle().then((r) => r.data?.planning ?? null)).mistakeReviewDays
  const review_on = addDays(todayISO(), days)
  const { data, error } = await sb.from('mistakes').insert({ subject_id: m.subject_id, topic_id: m.topic_id, body, source_text: m.source_text?.slice(0, 1000) ?? null, review_on }).select('id').single()
  return error || !data ? { error: `Mistake not saved: ${error?.message ?? 'unknown error'}` } : { id: data.id, review_on }
}

/** Reviewed (or not, for Undo). */
export async function setReviewed(sb: SupabaseClient, id: string, reviewed: boolean): Promise<string | null> {
  const { error } = await sb.from('mistakes').update({ reviewed_at: reviewed ? new Date().toISOString() : null }).eq('id', id).select('id').single()
  return error ? `Not saved: ${error.message}` : null
}

/** Set topics' colour (lib/maths.ts). Returns each topic's colour before, for Undo. */
export async function setTopicStatus(sb: SupabaseClient, ids: string[], status: string): Promise<{ before?: { id: string; status: string }[]; error?: string }> {
  const { data, error } = await sb.from('topics').select('id,status').in('id', ids)
  if (error) return { error: /status/.test(error.message) ? 'Not saved: run supabase/maths.sql first (it adds the topic colours)' : `Not saved: ${error.message}` }
  const { error: e2 } = await sb.from('topics').update({ status, status_at: new Date().toISOString() }).in('id', ids).select('id')
  if (e2) return { error: `Not saved: ${e2.message}` }
  return { before: (data ?? []) as { id: string; status: string }[] }
}

/** Put topics' colours back (Undo). */
export async function restoreTopicStatus(sb: SupabaseClient, before: { id: string; status: string }[]): Promise<string | null> {
  for (const b of before) {
    const { error } = await sb.from('topics').update({ status: b.status }).eq('id', b.id).select('id').single()
    if (error) return `Couldn’t undo: ${error.message}`
  }
  return null
}
