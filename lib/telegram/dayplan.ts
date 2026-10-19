// Server-only: "plan my day" end to end. The brain spots the request; the planner (Opus) picks what, in order;
// lib/plan.ts places it into real free time; one card shows the timeline. ✅ Apply saves the blocks (an older plan
// for that day becomes 'replaced'), moves those tasks to Today (today's plan only) and saves how he feels that
// day. ↩️ Undo puts all of it back. Nothing is deleted.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Usage } from '../ai/models'
import { recordUsage } from '../ai/usage'
import type { PlannerContext } from '../ask/server'
import { moveTask, updateTask } from '../data'
import { expandEvents, isSchool } from '../events'
import { freeDays, slotsText, toHHMM } from '../freetime'
import { focusBudget, placeItems, planProblems, type Block, type Energy, type Unplaced } from '../plan'
import { addDays, dowShort, minutesOf, shortDate, timeOf, todayISO, weekStartISO } from '../time'
import { deadlineOf } from '../tasks'
import type { Task } from '../types'
import { esc, type Button } from './api'
import { makePlan, makeWeekPlan } from './planner'
import { applyRipple, loadWorld, rippleLines, undoRipple, weekRange, type RippleApplied } from './ripple'
import { placeTraining, ripple, studySlots, type Ripple, type WeekWorld } from '../week'
import { isLowRecovery, whoopDay } from '../whoop/sync'
import { plain, say } from './turns'
import type { ViewData } from './views'
import { noteWeek, trainText, type TrainingInfo } from './trainplan'
import { proposeYourWeek, yourWeekText, type YourWeek } from './yourweek'
import { schoolDays } from '../school'
import { looksLikeWeek } from './weekread'

export type PlanPayload = {
  date: string; energy: Energy; energyGiven: boolean; blocks: Block[]; unplaced: (Unplaced & { date?: string })[]; note: string; pushBack: string
  week?: { from: string; to: string }; tbc?: { title: string; reason: string }[]
  add?: boolean                 // add these blocks to the plan as it is (e.g. new homework), replacing nothing
  whoop?: number                // lighter because of low Whoop recovery (that %), not because he said so
  ripple?: Ripple; rippleApplied?: RippleApplied
  summary?: string; card_message_id?: number | null; replaces?: string; applied?: PlanApplied
  training?: TrainingInfo       // a training-only plan placed by load (lib/telegram/trainplan.ts)
  yourWeek?: YourWeek           // the whole week, planned together (lib/telegram/yourweek.ts)
}
type Moved = { id: string; title: string; before: Pick<Task, 'status' | 'postpone_count' | 'last_postponed_at'> }
export type PlanApplied = { created: string[]; replaced: string[]; moved: Moved[]; dayState: { energy: string | null; note: string | null } | null | 'none'; ripple?: RippleApplied
  targetWeek?: { targetId: string; weekStart: string; before: number | null } }   // this week's upper count (Your week)

export type PlanRequest = { date: string; from: string | null; minutes: number | null; until: string | null; energy: Energy | null; words: string; week?: boolean }

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const KIND_WORD: Record<string, string> = { focus: 'focus', light: 'light', training: 'training', rest: 'rest' }
export const planButtons = (id: string): Button[][] => [
  [{ text: '✅ Apply', callback_data: `a:${id}` }, { text: '✏️ Change', callback_data: `e:${id}` }, { text: '❌ Cancel', callback_data: `x:${id}` }],
]

/**
 * Work out a plan (no database): the free time in the window he asked about, the planner's picks, placed by code.
 * Returns the card's payload, or a message when there's nothing to plan. Used by the bot and by the AI checks.
 */
export async function buildPlan(req: PlanRequest, ctx: PlannerContext, data: ViewData, dayEnergy: Energy | null,
  previous: string | null, onUsage?: (model: string, usage: Usage) => Promise<unknown>): Promise<{ payload: PlanPayload } | { message: string }> {
  const today = data.today
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.date) && req.date >= today && req.date <= addDays(today, 6) ? req.date : today
  const nowMin = minutesOf(timeOf(data.now))
  // school free periods count for study
  const [free] = freeDays(data.events, data.changes, date, date, data.settings, today, nowMin, data.travel ?? null, { freePeriods: true })
  // the part of the day he asked about; on a school day, from school's start (free periods, then after school)
  const sd = schoolDays(data.events, data.changes, date, date, data.settings.schoolFreePeriods).get(date)
  const asked = req.from && /^\d\d:\d\d$/.test(req.from) ? minutesOf(req.from) : null
  let from = Math.max(free.slots[0] ? minutesOf(free.slots[0].start) : 0, asked ?? (sd ? minutesOf(sd.start) : 0))
  if (date === today) from = Math.max(from, Math.ceil(nowMin / 5) * 5)
  let until = req.until && /^\d\d:\d\d$/.test(req.until) ? minutesOf(req.until) : minutesOf(data.settings.dayEnd)
  if (req.minutes && req.minutes > 0) until = Math.min(until, from + Math.min(req.minutes, 16 * 60))
  const slots = free.slots
    .map((s) => ({ ...s, start: toHHMM(Math.max(minutesOf(s.start), from)), end: toHHMM(Math.min(minutesOf(s.end), until)) }))
    .filter((s) => minutesOf(s.end) - minutesOf(s.start) >= 10)
    .map((s) => ({ ...s, minutes: minutesOf(s.end) - minutesOf(s.start), heavyMinutes: Math.max(0, Math.min(minutesOf(s.end), minutesOf(data.settings.heavyUntil)) - minutesOf(s.start)) }))

  const energy: Energy = req.energy ?? dayEnergy ?? 'normal'
  const budget = focusBudget(free.schoolNight, data.settings, energy)
  const window = `${day(date)}, ${toHHMM(from)}–${toHHMM(Math.min(until, 24 * 60 - 1))}`
  if (!slots.length) return { message: `No free time left ${date === today ? 'today' : `on ${day(date)}`} (${window}), so there’s nothing to plan.` }

  const res = await makePlan({
    date, dayLabel: date === today ? 'today' : day(date), window, budget, energy, words: req.words,
    freeTime: slotsText({ ...free, slots }, data.settings), previous,
  }, ctx, onUsage)
  if (!res.ok) return { message: `⚠️ ${res.error} Nothing planned.` }

  const placed = placeItems(res.items, slots, data.settings, { budget, energy, until: toHHMM(Math.min(until, 24 * 60 - 1)) })
  // a last guard: a block breaking a rule is left out, and a plan that still breaks one is never shown
  const blocks = placed.blocks.filter((b) => planProblems([b], slots, data.settings, null).length === 0)
  const problems = planProblems(blocks, slots, data.settings, budget)
  if (problems.length) return { message: `⚠️ The plan broke a rule (${problems[0]}), so I didn’t use it.` }
  if (!blocks.length) {
    return { message: `${res.note || 'Nothing fitted.'}${placed.unplaced.length ? `\nDidn’t fit: ${placed.unplaced.map((u) => `${u.title} (${u.reason})`).join('; ')}` : ''}` }
  }
  return { payload: { date, energy, energyGiven: !!req.energy, blocks, unplaced: placed.unplaced, note: res.note, pushBack: res.pushBack } }
}

/** Plan and send it as one card (replacing an older plan card being changed). */
export async function proposePlan(sb: SupabaseClient, chatId: number, req: PlanRequest, ctx: PlannerContext, data: ViewData,
  opts: { replaces?: { id: string; payload: { summary?: string; card_message_id?: number | null } } | null; onReplace?: () => Promise<void> } = {}): Promise<void> {
  // how he is that day: what he said now, else what he said earlier that day
  const { data: ds } = await sb.from('day_state').select('energy').eq('on_date', req.date).maybeSingle()
  // what he said about the day wins; otherwise low Whoop recovery (today's) makes it a lighter day
  const whoopTired = !ds?.energy && req.date === data.today && isLowRecovery(await whoopDay(sb, req.date), data.planning)
  const built = await buildPlan(req, ctx, data, (ds?.energy as Energy | null) ?? (whoopTired ? 'tired' : null), opts.replaces?.payload.summary ?? null, (model, usage) => recordUsage(sb, 'plan', model, usage))
  if ('message' in built) { await say(sb, chatId, esc(built.message), undefined, { intent: 'plan' }); return }
  const payload = built.payload
  if (whoopTired && !req.energy && payload.energy === 'tired') payload.whoop = (await whoopDay(sb, req.date))?.recovery ?? undefined
  // ill or wrecked: a gym session planned that day moves to a day that keeps the rules (or becomes TBC)
  if (req.energy) {
    const world = await loadWorld(sb, data)
    const after = { ...world, energy: new Map(world.energy).set(payload.date, req.energy) }
    const r = ripple(world, after)
    r.moves = r.moves.filter((m) => world.planned.find((b) => b.id === m.blockId)?.kind === 'training')
    if (r.moves.length) payload.ripple = r
  }
  const body = [planText(payload, payload.date === data.today, data), ...rippleLines(payload.ripple)].join('\n')
  payload.summary = plain(body)
  if (opts.replaces) payload.replaces = opts.replaces.id
  const { data: row, error } = await sb.from('telegram_pending').insert({ kind: 'plan', text: req.words.trim() || 'plan', payload }).select('id').single()
  if (error || !row) throw new Error(`Couldn’t hold the plan: ${error?.message ?? 'not saved'}`)
  await opts.onReplace?.()
  const msgId = await say(sb, chatId, `${opts.replaces ? '✏️ <b>Changed</b>\n' : ''}${body}\n\nNothing changes until you tap ✅ Apply.`, planButtons(row.id), { pending_id: row.id, intent: 'plan' })
  if (msgId) await sb.from('telegram_pending').update({ payload: { ...payload, card_message_id: msgId } }).eq('id', row.id)
}

/** The card: a timeline, what didn't fit, the planner's note, and what ✅ will also do. */
export function planText(p: PlanPayload, isToday: boolean, data: Pick<ViewData, 'tasks'> & { today?: string }): string {
  if (p.yourWeek) return yourWeekText(p, data.today ?? todayISO())
  if (p.training) return trainText(p, data.today ?? todayISO())
  if (p.week) return weekText(p, data)
  const why = p.whoop != null ? `Whoop recovery ${p.whoop}%` : p.energy
  const lines = [`🗓 <b>Plan · ${isToday ? 'today' : day(p.date)}</b>${p.energy !== 'normal' ? ` <i>(${why}: a lighter day)</i>` : ''}`]
  for (const b of p.blocks) lines.push(`${b.start}–${b.end} ${b.kind === 'focus' ? `<b>${esc(b.title)}</b>` : esc(b.title)} <i>· ${KIND_WORD[b.kind]}</i>`)
  if (p.unplaced.length) lines.push(`<i>Didn’t fit: ${esc(p.unplaced.map((u) => `${u.title} (${u.reason})`).join('; '))}</i>`)
  if (p.note) lines.push('', esc(p.note))
  if (p.pushBack) lines.push(`🤔 ${esc(p.pushBack)}`)
  const moves = isToday ? toMove(p, data.tasks).length : 0
  const also = [moves ? `moves ${moves} task${moves > 1 ? 's' : ''} to Today` : '', p.energyGiven ? `notes you’re ${p.energy} today` : ''].filter(Boolean)
  if (also.length) lines.push(`<i>✅ also ${also.join(' and ')}.</i>`)
  return lines.join('\n')
}

function weekText(p: PlanPayload, data: Pick<ViewData, 'tasks'> & { today?: string }): string {
  const lines = [`🗓 <b>Week plan</b> · ${day(p.week!.from)} – ${day(p.week!.to)}`]
  for (let d = p.week!.from; d <= p.week!.to; d = addDays(d, 1)) {
    const list = p.blocks.filter((b) => b.date === d)
    if (!list.length) continue
    lines.push(`<b>${d === data.today ? 'Today' : day(d)}</b>`)
    for (const b of list) lines.push(`${b.start}–${b.end} ${b.kind === 'focus' ? `<b>${esc(b.title)}</b>` : esc(b.title)} <i>· ${KIND_WORD[b.kind]}</i>`)
  }
  if (p.tbc?.length) lines.push(`🏃 <i>TBC this week: ${esc(p.tbc.map((t) => t.title).join(', '))} (no day without breaking a training rule)</i>`)
  if (p.unplaced.length) lines.push(`<i>Didn’t fit: ${esc(p.unplaced.map((u) => `${u.title}${u.date ? ` (${day(u.date)})` : ''}`).join('; '))}</i>`)
  if (p.note) lines.push('', esc(p.note))
  if (p.pushBack) lines.push(`🤔 ${esc(p.pushBack)}`)
  const moves = data.today ? toMove({ ...p, blocks: p.blocks.filter((b) => b.date === data.today) }, data.tasks).length : 0
  if (moves) lines.push(`<i>✅ also moves ${moves} task${moves > 1 ? 's' : ''} for today to Today.</i>`)
  return lines.join('\n')
}

const toMove = (p: PlanPayload, tasks: Task[]) => {
  const ids = new Set(p.blocks.filter((b) => b.ref?.kind === 'task').map((b) => b.ref!.id))
  return tasks.filter((t) => ids.has(t.id) && t.status !== 'today' && t.status !== 'completed' && !t.archived_at)
}

// ---------------------------------------------------------------------------
// Apply / Undo
// ---------------------------------------------------------------------------

export async function applyPlan(sb: SupabaseClient, planId: string, p: PlanPayload): Promise<{ applied?: PlanApplied; error?: string }> {
  const applied: PlanApplied = { created: [], replaced: [], moved: [], dayState: 'none' }
  try {
    applied.ripple = await applyRipple(sb, p.ripple)
    const today = todayISO()
    const old = p.add ? { data: [], error: null } : p.training
      // a training plan replaces only the week's planned training (the study plan stays)
      ? await sb.from('plan_blocks').update({ status: 'replaced' }).gte('on_date', p.week!.from < today ? today : p.week!.from).lte('on_date', p.week!.to).eq('status', 'planned').eq('kind', 'training').select('id')
      : p.week
      ? await sb.from('plan_blocks').update({ status: 'replaced' }).gte('on_date', p.week.from < today ? today : p.week.from).lte('on_date', p.week.to).eq('status', 'planned').select('id')
      : await sb.from('plan_blocks').update({ status: 'replaced' }).eq('on_date', p.date).eq('status', 'planned').select('id')
    const e1 = old.error
    if (e1) throw new Error(e1.message)
    applied.replaced = (old.data ?? []).map((r) => r.id as string)
    const rows = p.blocks.map((b) => ({
      // a session placed by load keeps its intensity in the name ("Upper · moderate"): shown in Life OS and on Home
      plan_id: planId, on_date: b.date ?? p.date, start_time: b.start, end_time: b.end, title: (b.intensity && b.intensity !== 'heavy' ? `${b.title} · ${b.intensity}` : b.title).slice(0, 200), kind: b.kind,
      task_id: b.ref?.kind === 'task' ? b.ref.id : null, target_id: b.ref?.kind === 'target' ? b.ref.id : null, goal_id: b.ref?.kind === 'goal' ? b.ref.id : null,
    }))
    const { data: made, error: e2 } = rows.length ? await sb.from('plan_blocks').insert(rows).select('id') : { data: [], error: null }
    if (e2 || !made || made.length !== rows.length) throw new Error(`Plan not saved: ${e2?.message ?? 'not all blocks saved'}`)
    applied.created = made.map((r) => r.id as string)

    const todays = p.blocks.filter((b) => (b.date ?? p.date) === today)
    if (todays.length) {
      const ids = [...new Set(todays.filter((b) => b.ref?.kind === 'task').map((b) => b.ref!.id))]
      const { data: tasks } = ids.length ? await sb.from('tasks').select('*').in('id', ids) : { data: [] }
      for (const t of (tasks ?? []) as Task[]) {
        if (t.status === 'today' || t.status === 'completed' || t.archived_at) continue
        const err = await moveTask(sb, t, 'today')
        if (err) throw new Error(err)
        applied.moved.push({ id: t.id, title: t.title, before: { status: t.status, postpone_count: t.postpone_count, last_postponed_at: t.last_postponed_at } })
      }
    }
    // Your week: this week's upper count, when the optimiser chose a different number than his target
    const ut = p.yourWeek?.upperTarget
    if (ut) {
      const weekStart = weekStartISO(p.week!.from)
      const { data: had } = await sb.from('target_weeks').select('target_count').eq('target_id', ut.id).eq('week_start', weekStart).maybeSingle()
      const { error: e4 } = await sb.from('target_weeks').upsert({ target_id: ut.id, week_start: weekStart, target_count: ut.count }, { onConflict: 'user_id,target_id,week_start' }).select('id').single()
      if (e4) throw new Error(`Couldn’t set this week’s upper count: ${e4.message}`)
      applied.targetWeek = { targetId: ut.id, weekStart, before: (had?.target_count as number | undefined) ?? null }
    }
    if (p.energyGiven) {
      const { data: was } = await sb.from('day_state').select('energy,note').eq('on_date', p.date).maybeSingle()
      applied.dayState = was ? { energy: was.energy, note: was.note } : null
      const { error: e3 } = await sb.from('day_state').upsert({ on_date: p.date, energy: p.energy }, { onConflict: 'user_id,on_date' }).select('id').single()
      if (e3) throw new Error(`Couldn’t note how you feel: ${e3.message}`)
    }
    return { applied }
  } catch (e) {
    const back = await undoPlan(sb, p.date, applied)
    const left = [...back.failed, ...back.skipped]
    return { error: `${e instanceof Error ? e.message : 'Not saved.'}${left.length ? ` (couldn’t put back: ${left.join(', ')})` : ''}` }
  }
}

export async function undoPlan(sb: SupabaseClient, date: string, a: PlanApplied): Promise<{ failed: string[]; skipped: string[] }> {
  const failed: string[] = [], skipped: string[] = []
  if (a.created.length) {
    const { error } = await sb.from('plan_blocks').update({ status: 'cancelled' }).in('id', a.created).eq('status', 'planned')
    if (error) failed.push('the new plan')
  }
  if (a.replaced.length) {
    const { error } = await sb.from('plan_blocks').update({ status: 'planned' }).in('id', a.replaced).eq('status', 'replaced')
    if (error) failed.push('the old plan')
  }
  for (const m of [...a.moved].reverse()) {
    const { data: now } = await sb.from('tasks').select('status').eq('id', m.id).maybeSingle()
    if (now?.status !== 'today') { skipped.push(m.title); continue }   // moved again since: leave it
    const r1 = await updateTask(sb, m.id, { status: m.before.status })
    const r2 = r1.error ? r1 : await updateTask(sb, m.id, { postpone_count: m.before.postpone_count, last_postponed_at: m.before.last_postponed_at })
    if (r2.error) failed.push(m.title)
  }
  if (a.dayState !== 'none') {
    const { error } = await sb.from('day_state').update(a.dayState ?? { energy: null, note: null }).eq('on_date', date)
    if (error) failed.push('how you feel')
  }
  const left = await undoRipple(sb, a.ripple)
  if (left.length) skipped.push(`${left.length} moved plan block${left.length > 1 ? 's' : ''}`)
  if (a.targetWeek) {
    // back to what this week had (or, if it had no number of its own, the weekly target's usual number)
    const tw = a.targetWeek
    const usual = tw.before ?? (await sb.from('weekly_targets').select('target_count').eq('id', tw.targetId).maybeSingle()).data?.target_count ?? 0
    const { error } = await sb.from('target_weeks').update({ target_count: usual }).eq('target_id', tw.targetId).eq('week_start', tw.weekStart)
    if (error) failed.push('this week’s upper count')
  }
  return { failed, skipped }
}

// ---------------------------------------------------------------------------
// Plan my week: gym sessions placed by the training rules (code), study picked by the planner, placed by code
// ---------------------------------------------------------------------------

export async function buildWeekPlan(world: WeekWorld, ctx: PlannerContext, words: string, previous: string | null,
  onUsage?: (model: string, usage: Usage) => Promise<unknown>): Promise<{ payload: PlanPayload } | { message: string }> {
  // keep the days gym sessions already had where the rules still allow; the old study plan is being replaced
  const fresh = { ...world, planned: world.planned.filter((b) => b.kind === 'training') }
  const training = placeTraining(fresh)
  const slots = studySlots(world, training.placed)
  // school days: study in free periods and after school (not before school)
  const schoolOn = schoolDays(world.events, world.changes, world.from, world.to, world.settings.schoolFreePeriods)
  for (const [date, list] of slots) {
    const sd = schoolOn.get(date)
    if (sd) slots.set(date, list.filter((s) => s.start >= sd.start))
  }
  const free = freeDays(world.events, world.changes, world.from, world.to, world.settings, world.today, world.nowMin, world.travel ?? null)
  const days = free.filter((d) => d.date >= world.today).map((d) => {
    const energy = world.energy.get(d.date) ?? 'normal'
    return {
      date: d.date, label: day(d.date), energy, budget: focusBudget(d.schoolNight, world.settings, energy),
      freeTime: slotsText({ ...d, slots: slots.get(d.date) ?? [] }, world.settings),
      training: training.placed.filter((t) => t.date === d.date).map((t) => `${t.title} ${t.start}–${t.end}`).join(', '),
    }
  })
  if (!days.length) return { message: 'No days left to plan this week.' }
  const res = await makeWeekPlan({ days, words, previous }, ctx, onUsage)
  if (!res.ok) return { message: `⚠️ ${res.error} Nothing planned.` }

  const blocks: Block[] = training.placed.map((t) => ({ date: t.date, start: t.start, end: t.end, title: t.title, kind: 'training' as const, ref: { kind: 'target', id: t.key.split('#')[0] } }))
  const unplaced: PlanPayload['unplaced'] = []
  for (const d of days) {
    const all = res.days.find((x) => x.date === d.date)?.items ?? []
    // never plan a task on a day after its deadline
    const late = all.filter((it) => it.ref?.kind === 'task' && (() => { const r = [...ctx.refs.values()].find((x) => x.id === it.ref!.id); return !!r?.deadline && r.deadline < d.date })())
    unplaced.push(...late.map((it) => ({ title: it.title, minutes: it.minutes, reason: 'that’s after its deadline', date: d.date })))
    const items = all.filter((it) => !late.includes(it))
    const placed = placeItems(items, slots.get(d.date) ?? [], world.settings, { budget: d.budget, energy: d.energy })
    const ok = placed.blocks.filter((b) => planProblems([b], slots.get(d.date) ?? [], world.settings, null).length === 0)
    blocks.push(...ok.map((b) => ({ ...b, date: d.date })))
    unplaced.push(...placed.unplaced.map((u) => ({ ...u, date: d.date })))
  }
  blocks.sort((a, b) => (a.date! + a.start).localeCompare(b.date! + b.start))
  return { payload: { date: world.from, week: { from: world.from, to: world.to }, energy: 'normal', energyGiven: false, blocks, unplaced, tbc: training.tbc, note: res.note, pushBack: res.pushBack } }
}

/** Plan the week and send it as one card: the "Your week" card (replacing one being changed). */
export async function proposeWeekPlan(sb: SupabaseClient, chatId: number, words: string, ctx: PlannerContext, data: ViewData,
  opts: { replaces?: { id: string; payload: { summary?: string; card_message_id?: number | null } } | null; onReplace?: () => Promise<void> } = {}): Promise<void> {
  await proposeYourWeek(sb, chatId, words, ctx, data, { replaces: (opts.replaces as never) ?? null, onReplace: opts.onReplace })
}

// ---------------------------------------------------------------------------
// New homework with a deadline this week: offer a slot for it in the plan (a small add-only plan card)
// ---------------------------------------------------------------------------

/** After a new task is saved: if there's a week plan and the task is due within it, offer the first free slot before the deadline. */
export async function offerSlot(sb: SupabaseClient, chatId: number, task: Task, data: ViewData): Promise<boolean> {
  const deadline = deadlineOf(task)
  if (!deadline || deadline < data.today) return false
  const world = await loadWorld(sb, data)
  if (deadline > world.to || !world.planned.some((b) => b.on_date >= world.today)) return false   // no week plan to fit it into
  const minutes = task.duration_minutes ?? 45
  const busy = world.planned.map((b) => ({ date: b.on_date, start: b.start_time, end: b.end_time }))
  const slots = studySlots(world, busy)
  for (let d = world.today; d <= deadline && d <= world.to; d = addDays(d, 1)) {
    const placed = placeItems([{ title: task.title, minutes, kind: 'focus', ref: { kind: 'task', id: task.id } }], slots.get(d) ?? [], world.settings, { budget: null, energy: world.energy.get(d) ?? 'normal' })
    const b = placed.blocks[0]
    if (!b) continue
    const payload: PlanPayload = { date: d, energy: 'normal', energyGiven: false, add: true, blocks: [{ ...b, date: d }], unplaced: [], note: '', pushBack: '' }
    const body = `➕ Fit <b>${esc(task.title)}</b> into your plan: <b>${d === data.today ? 'today' : day(d)} ${b.start}–${b.end}</b>? <i>(due ${day(deadline)})</i>`
    payload.summary = plain(body)
    const { data: row } = await sb.from('telegram_pending').insert({ kind: 'plan', text: `fit ${task.title}`, payload }).select('id').single()
    if (!row) return false
    await say(sb, chatId, body, [[{ text: '✅ Add', callback_data: `a:${row.id}` }, { text: '❌ No', callback_data: `x:${row.id}` }]], { pending_id: row.id, intent: 'plan' })
    return true
  }
  await say(sb, chatId, `<i>Heads-up: no free slot for “${esc(task.title)}” before it’s due (${day(deadline)}) in this week’s plan.</i>`)
  return true
}
