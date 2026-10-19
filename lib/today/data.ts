// Server-only: Today's list saved as plan blocks (as Nat, row level security). The morning message (or the first look
// at Today that day) saves the list: one block per item, source 'auto', with the planner's key, what to open and what
// "done" moves forward (supabase/today.sql). Before today.sql has run they're plain plan blocks (title, time, task,
// test), marked as Today's by their plan_id. His own applied plan for a day is never replaced. Nothing is deleted.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SavedBlock, TodayItem, TodayPlan, TrainingIn } from './build'

/** Today's blocks share one plan_id per day, so they're found even before today.sql has run. */
export const autoPlanId = (date: string) => `a070da70-0000-4000-8000-0000${date.replace(/-/g, '')}`

const BASE = 'id,plan_id,on_date,start_time,end_time,title,kind,task_id,goal_id,target_id,status'
const FULL = `${BASE},source,pick_key,open_text,open_url,topic_id,programme_item_id,rolled_from,why,done_hint,done_effect`

/** "column … does not exist" (today.sql not run yet), from Postgres or PostgREST. */
export const isMissingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(e.message ?? ''))

export type Blocks = { rows: (SavedBlock & { on_date: string; done_effect?: unknown })[]; sqlMissing: boolean }

/** A day's live blocks (planned or done), oldest first. */
export async function loadBlocks(sb: SupabaseClient, date: string): Promise<Blocks> {
  const q = (cols: string) => sb.from('plan_blocks').select(cols).eq('on_date', date).in('status', ['planned', 'done']).order('start_time')
  let r = await q(FULL)
  let sqlMissing = false
  if (r.error && isMissingColumn(r.error)) { sqlMissing = true; r = await q(BASE) }
  if (r.error) throw new Error(`Couldn’t read your plan: ${r.error.message}`)
  const rows = ((r.data ?? []) as unknown as Blocks['rows']).map((b) => ({ ...b, start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5) }))
  return { rows, sqlMissing }
}

/** Today's own blocks (the saved list), as opposed to his applied plan or the week's training. */
export const isAuto = (b: Pick<SavedBlock, 'source' | 'plan_id'>, date: string) => b.source === 'auto' || b.plan_id === autoPlanId(date)

const httpUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) && u.length <= 2000 ? u : null)

/**
 * Save a new list as plan blocks (items with a time; the week's training already is one). Fills in each item's block
 * ids. Returns false if it couldn't (another run saved it first, or the database said no): the list still shows.
 */
export async function saveToday(sb: SupabaseClient, plan: TodayPlan, newTraining: TrainingIn[], claim: (key: string) => Promise<boolean>, release: (key: string) => Promise<unknown>): Promise<{ saved: boolean; sqlMissing: boolean }> {
  const key = `today:${plan.date}`
  if (!(await claim(key))) return { saved: false, sqlMissing: false }
  const planId = autoPlanId(plan.date)
  type Row = Record<string, unknown>
  const made: { item: TodayItem; base: Row; extra: Row; training?: TrainingIn }[] = []
  for (const it of plan.items) {
    if (it.kind === 'training') {
      for (const t of newTraining) {
        made.push({ item: it, training: t, base: { plan_id: planId, on_date: plan.date, start_time: t.start, end_time: t.end, title: t.title.slice(0, 200), kind: 'training', task_id: null, goal_id: null, target_id: t.targetId },
          extra: { source: 'auto', pick_key: `training:${plan.date}`, open_text: t.open ? t.open.slice(0, 400) : null, why: null, done_hint: { kind: 'block' } } })
      }
      continue
    }
    if (!it.at || !it.end) continue
    made.push({ item: it, base: { plan_id: planId, on_date: plan.date, start_time: it.at, end_time: it.end, title: it.title.slice(0, 200), kind: it.heavy ? 'focus' : 'light', task_id: it.taskId, goal_id: it.goalId, target_id: null },
      extra: { source: 'auto', pick_key: it.key.slice(0, 200), open_text: it.open ? it.open.slice(0, 400) : null, open_url: httpUrl(it.url), topic_id: it.topicId, programme_item_id: it.programmeItemId,
        rolled_from: it.rolledFrom, why: it.why ? it.why.slice(0, 300) : null, done_hint: it.done } })
  }
  if (!made.length) return { saved: true, sqlMissing: false }   // nothing to save (the claim stays: the day's list is what it is)
  let sqlMissing = false
  let res = await sb.from('plan_blocks').insert(made.map((m) => ({ ...m.base, ...m.extra }))).select('id')
  if (res.error && isMissingColumn(res.error)) { sqlMissing = true; res = await sb.from('plan_blocks').insert(made.map((m) => m.base)).select('id') }
  if (res.error || !res.data || res.data.length !== made.length) {
    await release(key)
    return { saved: false, sqlMissing }
  }
  res.data.forEach((r, i) => { made[i].item.blockIds.push(r.id as string) })
  return { saved: true, sqlMissing }
}

/** Pick keys done today (ticked on Today): for the planners' doneToday, so a done thing isn't picked again. */
export async function doneKeysToday(sb: SupabaseClient, date: string): Promise<string[]> {
  const { data, error } = await sb.from('plan_blocks').select('pick_key').eq('on_date', date).eq('status', 'done').not('pick_key', 'is', null)
  return error ? [] : [...new Set(((data ?? []) as { pick_key: string }[]).map((r) => r.pick_key))]
}

/**
 * He reported something done by message ("did Bicen matrices 8/10"): the Today item with that key is ticked too, so
 * it isn't counted twice (the report already moved his records forward; nothing else changes). For the tracker/ACT bots.
 */
export async function markPickDone(sb: SupabaseClient, date: string, pickKey: string): Promise<boolean> {
  const { data, error } = await sb.from('plan_blocks').update({ status: 'done' }).eq('on_date', date).eq('pick_key', pickKey).eq('status', 'planned').select('id')
  return !error && !!data?.length
}
