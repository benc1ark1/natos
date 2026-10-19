// Server-only: one tap on a Today item (web button or Telegram `tdy:` tap) marks it done AND moves forward what its
// "done" says (lib/plan-items.ts DoneHint): a task is completed (archived, never deleted), a topic's last_done = today
// (and its step), each mistake redo moves on a stage (lib/tracker/rules.ts afterRedo), a programme item is done,
// training counts toward its weekly target; a test attempt asks for the score in one line. The tap is his
// confirmation (no extra ✅). A second tap puts back exactly what the first changed, only if nothing changed it since.
// If he already reported it by message (the tracker/ACT bots), nothing is counted twice: the tap only ticks the item.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { completeTask, undoComplete } from '../data'
import type { DoneHint } from '../plan-items'
import { afterRedo } from '../tracker/rules'
import type { Task } from '../types'
import { dateISOOf } from '../time'
import { logTrainingTick } from '../telegram/ticks'
import { isMissingColumn } from './data'
import { release } from '../telegram/sent'

const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
import { markActPickDone } from '../act/data'

type TaskFx = { kind: 'task'; id: string; status: Task['status'] }
type TopicSet = { last_done: string; step: number | null; booklet?: string | null; pmt?: string | null }
type TopicFx = { kind: 'topic'; id: string; before: { last_done: string | null; step: number | null; booklet?: string | null; pmt?: string | null }; set: TopicSet }
type MistakeRow = { id: string; redo_stage: number; review_on: string; reviewed_at: string | null }
type MistakesFx = { kind: 'mistakes'; rows: { before: MistakeRow; set: Omit<MistakeRow, 'id'> }[] }
type ItemFx = { kind: 'programme_item'; id: string; before: { status: string; done_on: string | null }; set: { status: 'done'; done_on: string } }
export type Effect = TaskFx | TopicFx | MistakesFx | ItemFx

export type ToggleResult =
  | { ok: true; done: boolean; title: string; date: string; ask: string | null; changed: string | null; note?: string | null; same?: boolean }
  | { ok: false; error: string }

const BLOCK = 'id,on_date,title,kind,status,task_id,goal_id,target_id'

/** Move forward what "done" says. null = nothing to change (already done, e.g. reported by message). */
export async function applyHint(sb: SupabaseClient, hint: DoneHint, date: string, now: Date): Promise<{ effect: Effect | null; changed: string | null }> {
  if (hint.kind === 'task') {
    const { data: t } = await sb.from('tasks').select('*').eq('id', hint.taskId).maybeSingle()
    if (!t || t.status === 'completed' || t.archived_at) return { effect: null, changed: null }
    const { error } = await completeTask(sb, t as Task)
    if (error) throw new Error(error)
    return { effect: { kind: 'task', id: t.id, status: (t as Task).status }, changed: 'completed (in Archive)' }
  }
  if (hint.kind === 'topic') {
    const { data: tp, error } = await sb.from('topics').select('id,name,last_done,step,booklet,pmt').eq('id', hint.topicId).maybeSingle()
    if (error || !tp) return { effect: null, changed: null }   // before tracker.sql: nothing more to move
    const step = typeof tp.step === 'number' ? tp.step : null
    const target = hint.step != null && step != null ? Math.max(step, hint.step) : step
    // physics: its teacher booklet / PMT topic questions are done
    const part = hint.physics && tp[hint.physics] !== 'done' ? hint.physics : null
    if (tp.last_done === date && target === step && !part) return { effect: null, changed: null }
    const set: TopicSet = { last_done: date, step: target, ...(part ? { [part]: 'done' } : {}) }
    const { error: e2 } = await sb.from('topics').update(set).eq('id', tp.id)
    if (e2) throw new Error(e2.message)
    const before = { last_done: tp.last_done ?? null, step, ...(part ? { [part]: tp[part] ?? null } : {}) }
    const what = part ? `${tp.name}: ${part === 'pmt' ? 'PMT questions' : 'booklet'} done` : target !== step ? `${tp.name}: step ${step} → ${target}` : `${tp.name}: done today`
    return { effect: { kind: 'topic', id: tp.id, before, set }, changed: what }
  }
  if (hint.kind === 'mistakes') {
    if (!hint.mistakeIds.length) return { effect: null, changed: null }
    const { data, error } = await sb.from('mistakes').select('id,redo_stage,review_on,reviewed_at').in('id', hint.mistakeIds).is('archived_at', null)
    if (error) return { effect: null, changed: null }
    const rows: MistakesFx['rows'] = []
    for (const m of (data ?? []) as MistakeRow[]) {
      if (m.redo_stage >= 2 || m.review_on > date) continue   // already redone (reported by message) or not due
      const next = afterRedo(m.redo_stage, date)
      const set = { redo_stage: next.stage, review_on: next.reviewOn ?? m.review_on, reviewed_at: next.stage >= 2 ? now.toISOString() : m.reviewed_at }
      const { error: e2 } = await sb.from('mistakes').update(set).eq('id', m.id).eq('redo_stage', m.redo_stage)
      if (e2) throw new Error(e2.message)
      rows.push({ before: m, set })
    }
    return rows.length ? { effect: { kind: 'mistakes', rows }, changed: `${rows.length} mistake${rows.length > 1 ? 's' : ''} redone` } : { effect: null, changed: null }
  }
  if (hint.kind === 'programme_item') {
    if (hint.score) return { effect: null, changed: null }   // a chapter test: its score decides (asked in one line)
    const { data: it, error } = await sb.from('programme_items').select('id,title,status,done_on').eq('id', hint.itemId).maybeSingle()
    if (error || !it || it.status === 'done' || it.status === 'skipped') return { effect: null, changed: null }
    const set = { status: 'done' as const, done_on: date }
    const { error: e2 } = await sb.from('programme_items').update(set).eq('id', it.id).eq('status', it.status)
    if (e2) throw new Error(e2.message)
    return { effect: { kind: 'programme_item', id: it.id, before: { status: it.status, done_on: it.done_on ?? null }, set }, changed: `${it.title} done` }
  }
  return { effect: null, changed: null }   // attempt (asks for the score), act, block: the tick is the record
}

/** Put back what a tap changed, only where nothing has changed it since. */
/** What putting back a tap's change did: 'undone', or 'skipped' (it was changed since, so it stays). Throws on a database error. */
export type UndoOutcome = { outcome: 'undone' | 'skipped'; what: string }
const must = <T extends { error: { message: string } | null }>(r: T): T => { if (r.error) throw new Error(r.error.message); return r }

export async function undoEffect(sb: SupabaseClient, fx: Effect): Promise<UndoOutcome> {
  if (fx.kind === 'task') {
    const { data: t } = must(await sb.from('tasks').select('*').eq('id', fx.id).maybeSingle())
    if (!t || t.status !== 'completed' || t.archive_reason !== 'done') return { outcome: 'skipped', what: (t?.title as string | undefined) ?? 'the task' }
    const err = await undoComplete(sb, { ...(t as Task), status: fx.status })
    if (err) throw new Error(err)
    return { outcome: 'undone', what: t.title as string }
  }
  if (fx.kind === 'topic') {
    const { data: tp } = must(await sb.from('topics').select('id,name,last_done,step,booklet,pmt').eq('id', fx.id).maybeSingle())
    const same = tp && tp.last_done === fx.set.last_done && (tp.step ?? null) === fx.set.step
      && (fx.set.booklet === undefined || tp.booklet === fx.set.booklet) && (fx.set.pmt === undefined || tp.pmt === fx.set.pmt)
    if (!same) return { outcome: 'skipped', what: (tp?.name as string | undefined) ?? 'the topic' }
    must(await sb.from('topics').update(fx.before).eq('id', fx.id))
    return { outcome: 'undone', what: tp.name as string }
  }
  if (fx.kind === 'mistakes') {
    let skipped = 0
    for (const r of fx.rows) {
      const { id, ...before } = r.before
      const { data } = must(await sb.from('mistakes').update(before).eq('id', id).eq('redo_stage', r.set.redo_stage).eq('review_on', r.set.review_on).select('id'))
      if (!data?.length) skipped++
    }
    return { outcome: skipped ? 'skipped' : 'undone', what: skipped === 1 ? 'a mistake redo' : `${skipped} mistake redos` }
  }
  const { data } = must(await sb.from('programme_items').update(fx.before).eq('id', fx.id).eq('status', 'done').eq('done_on', fx.set.done_on).select('id'))
  return { outcome: data?.length ? 'undone' : 'skipped', what: 'the programme item' }
}

/** The one line asking for a chapter test's score (a gaps_only programme: full marks = skip the chapter). */
async function askItemScore(sb: SupabaseClient, itemId: string): Promise<string> {
  const { data: it } = await sb.from('programme_items').select('title,programme_id').eq('id', itemId).maybeSingle()
  const { data: p } = it?.programme_id ? await sb.from('programmes').select('name').eq('id', it.programme_id).maybeSingle() : { data: null }
  const title = esc((it?.title as string | undefined) ?? 'the chapter test')
  const book = esc((p?.name as string | undefined) ?? '')
  return `📝 What did you score on ${book ? `${book}: ` : ''}${title}? Send it like “${book ? `${book.split(/\s+/).slice(0, 2).join(' ')} ` : ''}${title.replace(/^chapter\s*/i, 'ch ')} 12/15” (full marks = skip that chapter).`
}

/** The one line asking for a test score after an attempt is ticked (code: a booklet pick's topic code). */
async function askScore(sb: SupabaseClient, goalId: string, what: string, rawCode?: string): Promise<string> {
  const code = rawCode ? esc(rawCode) : undefined
  const { data: g } = await sb.from('goals').select('title').eq('id', goalId).maybeSingle()
  const name = esc((g?.title as string | undefined) ?? 'the test')
  const label = what === 'diagnostic' ? 'diagnostic' : what === 'timed' ? 'timed practice' : what === 'booklet' ? 'booklet' : what
  const short = `${name.replace(/ test$/i, '')} ${code ? `${code} ` : ''}${label === 'timed practice' ? 'practice' : label}`
  return `📝 How did the ${name} ${code ? `${code} ` : ''}${label} go? Send the score, e.g. “${short} 31/45”.`
}

/** What markActPickDone moved (the ACT misses due for a redo), as an effect a second tap can put back. */
async function actEffect(sb: SupabaseClient, key: string, date: string): Promise<Effect | null> {
  const read = async () => ((await sb.from('mistakes').select('id,redo_stage,review_on,reviewed_at').is('archived_at', null).lte('review_on', date)).data ?? []) as MistakeRow[]
  const before = await read()
  try { await markActPickDone(sb, key, date) } catch { return null }
  if (!before.length) return null
  const { data } = await sb.from('mistakes').select('id,redo_stage,review_on,reviewed_at').in('id', before.map((m) => m.id))
  const rows: MistakesFx['rows'] = []
  for (const a of (data ?? []) as MistakeRow[]) {
    const b = before.find((x) => x.id === a.id)!
    if (a.redo_stage !== b.redo_stage) rows.push({ before: b, set: { redo_stage: a.redo_stage, review_on: a.review_on, reviewed_at: a.reviewed_at } })
  }
  return rows.length ? { kind: 'mistakes', rows } : null
}

/** Tick (or untick) one Today item by one of its plan blocks: training ticks all of today's training blocks together. */
export async function toggleBlock(sb: SupabaseClient, blockId: string, now = new Date(), want?: boolean): Promise<ToggleResult> {
  let full = true
  let r = await sb.from('plan_blocks').select(`${BLOCK},pick_key,done_hint,done_effect`).eq('id', blockId).maybeSingle()
  if (r.error && isMissingColumn(r.error)) { full = false; r = await sb.from('plan_blocks').select(BLOCK).eq('id', blockId).maybeSingle() }
  type B = { id: string; on_date: string; title: string; kind: string; status: string; task_id: string | null; goal_id: string | null; target_id: string | null; pick_key?: string | null; done_hint?: DoneHint | null; done_effect?: { effects?: Effect[] } | null }
  const b = r.data as B | null
  if (r.error || !b || !['planned', 'done'].includes(b.status)) return { ok: false, error: 'That isn’t on your plan any more.' }

  if (b.kind === 'training') {
    const { data: all } = await sb.from('plan_blocks').select(BLOCK).eq('on_date', b.on_date).eq('kind', 'training').in('status', ['planned', 'done'])
    const list = ((all ?? []) as B[])
    const done = want ?? !list.every((x) => x.status === 'done')
    if (list.every((x) => (x.status === 'done') === done)) return { ok: true, done, title: list.map((x) => x.title).join(' + '), date: b.on_date, ask: null, changed: null, same: true }
    for (const x of list) {
      if ((x.status === 'done') === done) continue
      const { data: upd, error } = await sb.from('plan_blocks').update({ status: done ? 'done' : 'planned' }).eq('id', x.id).eq('status', x.status).select('id')
      if (error) return { ok: false, error: `Not saved: ${error.message}` }
      if (upd?.length) await logTrainingTick(sb, x, done)
    }
    return { ok: true, done, title: list.map((x) => x.title).join(' + '), date: b.on_date, ask: null, changed: null }
  }

  const done = want ?? b.status === 'planned'
  // a tap from an older message, or a double tap: it's already that way, so nothing changes
  if ((b.status === 'done') === done) return { ok: true, done, title: b.title, date: b.on_date, ask: null, changed: null, same: true }
  const hint: DoneHint = b.done_hint ?? (b.task_id ? { kind: 'task', taskId: b.task_id } : { kind: 'block' })
  if (!done) return untick(sb, b, full)
  // the tick is marked as still being saved, so a quick second tap can't untick it half-way
  const { data: upd, error } = await sb.from('plan_blocks').update(full ? { status: 'done', done_effect: { pending: true } } : { status: 'done' }).eq('id', b.id).eq('status', b.status).select('id')
  if (error) return { ok: false, error: `Not saved: ${error.message}` }
  if (!upd?.length) return { ok: false, error: 'That changed in the meantime: try again.' }
  let res: Awaited<ReturnType<typeof applyHint>>
  try { res = await applyHint(sb, hint, b.on_date, now) } catch (e) {
    await sb.from('plan_blocks').update(full ? { status: 'planned', done_effect: null } : { status: 'planned' }).eq('id', b.id)   // nothing half-done
    return { ok: false, error: `Not saved: ${e instanceof Error ? e.message : 'unknown error'}` }
  }
  const effects = res.effect ? [res.effect] : []
  // an ACT pick: its misses due for a redo move on a stage too (lib/act/data.ts), kept so a second tap puts them back
  if (b.pick_key?.startsWith('act:')) { const fx = await actEffect(sb, b.pick_key, b.on_date); if (fx) effects.push(fx) }
  if (full) await sb.from('plan_blocks').update({ done_effect: effects.length ? { effects } : null }).eq('id', b.id)
  const ask = hint.kind === 'attempt' ? await askScore(sb, hint.goalId, hint.what, hint.label)
    : hint.kind === 'programme_item' && hint.score ? await askItemScore(sb, hint.itemId) : null
  return { ok: true, done, title: b.title, date: b.on_date, ask, changed: res.changed }
}

type Ticked = { id: string; on_date: string; title: string; status: string; task_id: string | null; done_effect?: { effects?: Effect[]; pending?: boolean } | null }

/** Untick: put back what the tick changed first (before today.sql: a task goes back on his Today list), then the block. */
async function untick(sb: SupabaseClient, b: Ticked, full: boolean): Promise<ToggleResult> {
  if (b.done_effect?.pending) return { ok: false, error: 'Still saving that tick: try again in a moment.' }
  const effects = b.done_effect?.effects ?? (!full && b.task_id ? [{ kind: 'task', id: b.task_id, status: 'today' } as Effect] : [])
  const kept: string[] = []
  for (const fx of effects) {
    try {
      const r = await undoEffect(sb, fx)
      if (r.outcome === 'skipped') kept.push(r.what)
    } catch (e) {
      return { ok: false, error: `Not unticked: ${e instanceof Error ? e.message : 'the database said no'}` }
    }
  }
  const { data: upd, error } = await sb.from('plan_blocks').update(full ? { status: 'planned', done_effect: null } : { status: 'planned' }).eq('id', b.id).eq('status', 'done').select('id')
  if (error) return { ok: false, error: `Not saved: ${error.message}` }
  if (!upd?.length) return { ok: false, error: 'That changed in the meantime: try again.' }
  const many = kept.length > 1
  const note = kept.length ? `Unticked; ${kept.join(', ')} ${many ? 'were' : 'was'} changed since, so ${many ? 'they stay as they are' : 'it stays as it is'}.` : null
  return { ok: true, done: false, title: b.title, date: b.on_date, ask: null, changed: null, note }
}

/** A Today task that isn't saved as a block (no time for it today): completed, or put back on his Today list. */
export async function toggleTask(sb: SupabaseClient, taskId: string, now = new Date(), want?: boolean): Promise<ToggleResult> {
  const { data: t } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (!t) return { ok: false, error: 'That task isn’t there any more.' }
  const task = t as Task
  const date = dateISOOf(now.toISOString())
  const done = want ?? task.status !== 'completed'
  if ((task.status === 'completed') === done) return { ok: true, done, title: task.title, date, ask: null, changed: null, same: true }
  // where it was before the tick, so a second tap puts it back there (kept as a "sent" key: no new column needed)
  const mark = `tdy-task:${task.id}:`
  if (done) {
    const { error } = await completeTask(sb, task)
    if (error) return { ok: false, error }
    await sb.from('telegram_sent').insert({ key: `${mark}${task.status}` }).then(() => null, () => null)
    return { ok: true, done: true, title: task.title, date, ask: null, changed: 'completed (in Archive)' }
  }
  const { data: marks } = await sb.from('telegram_sent').select('key').like('key', `${mark}%`).order('created_at', { ascending: false }).limit(1)
  const before = (marks?.[0]?.key as string | undefined)?.slice(mark.length) as Task['status'] | undefined
  const status: Task['status'] = before && before !== 'completed' ? before : 'today'
  const err = await undoComplete(sb, { ...task, status })
  if (err) return { ok: false, error: err }
  if (marks?.length) await release(sb, marks[0].key as string)
  return { ok: true, done: false, title: task.title, date, ask: null, changed: null }
}
