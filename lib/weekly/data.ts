// Server-only: the weekly check's rows, read as Nat (row level security), and the start-of-week snapshot
// (supabase/weekly.sql). Every table is optional: one that isn't there yet (its SQL file not run) or can't be read just
// leaves its part out of the message (lib/weekly/summary.ts), never an error.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, dateISOOf, timeOf, todayISO, weekStartISO } from '../time'
import { activeSessions } from '../setup'
import { moreSettings } from '../settings'
import { reviewDaysFrom } from '../tracker/settings'
import { exerciseCatalogue } from '../gym/catalogue'
import { gymPrefs } from '../gym/settings'
import type { Lift } from '../gym/types'
import { checkinRange } from '../ask/week'
import { targetProgress } from '../targets'
import type { EventException, EventRow, TargetLog, WeeklyTarget } from '../types'
import type { Colour, Programme, ProgrammeItem } from '../tracker/types'
import { loadActWorld } from '../act/data'
import { buildWeekly, planLabel, reviewedWeekOf, weeklyText, type WActScore, type WBlock, type WLift, type WMistake, type WSnapshot, type WTask, type WTest, type WTopic, type WeeklyInput, type WeeklySummary } from './summary'

type Row = Record<string, unknown>
type Res = { data: unknown; error: { message: string; code?: string } | null }

const COLOURS: Colour[] = ['not_started', 'not_secure', 'understand', 'exam_ready']
const colour = (v: unknown): Colour => (COLOURS.includes(v as Colour) ? (v as Colour) : 'not_started')
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const day = (v: unknown) => (typeof v === 'string' && v ? (v.length > 10 ? dateISOOf(v) : v) : null)

/** The first select that works (newer columns first, then the older ones); null if none does (no table yet). */
async function first(tries: (() => PromiseLike<Res>)[]): Promise<Row[] | null> {
  for (const t of tries) {
    try {
      const r = await t()
      if (!r.error) return (r.data ?? []) as Row[]
    } catch { /* try the next one */ }
  }
  return null
}

/** Everything the weekly check needs for the week (Mon–Sun) it looks back on: today's, or on a Monday the one that
 * just ended. `now` (HH:MM): today's blocks that start later aren't counted as missed. */
export async function loadWeeklyInput(sb: SupabaseClient, today: string, planning?: unknown, now?: string): Promise<WeeklyInput> {
  const weekOf = reviewedWeekOf(today)
  const from = weekStartISO(weekOf), to = addDays(from, 6)
  const [planRaw, subjects, blocksRaw, topicsRaw, mistakesRaw, testsRaw, progsRaw, itemsRaw, actRaw, liftsRaw, targetsRaw, logsRaw, weekCountsRaw, snapRaw] = await Promise.all([
    planning !== undefined ? Promise.resolve(planning) : sb.from('profiles').select('planning').maybeSingle().then((r) => (r.error ? null : r.data?.planning ?? null), () => null),
    first([() => sb.from('subjects').select('id,name').is('archived_at', null)]),
    first([
      () => sb.from('plan_blocks').select('id,on_date,start_time,title,kind,status,task_id,goal_id,topic_id,programme_item_id,pick_key,rolled_from').gte('on_date', from).lte('on_date', to).in('status', ['planned', 'done']),
      () => sb.from('plan_blocks').select('id,on_date,start_time,title,kind,status,task_id,goal_id').gte('on_date', from).lte('on_date', to).in('status', ['planned', 'done']),
    ]),
    first([
      () => sb.from('topics').select('id,subject_id,name,code,status,status_at,last_done,sort_order').is('archived_at', null),
      () => sb.from('topics').select('id,subject_id,name,status,status_at,sort_order').is('archived_at', null),
    ]),
    first([
      () => sb.from('mistakes').select('id,review_on,reviewed_at,updated_at,redo_stage').is('archived_at', null).order('updated_at', { ascending: false }).limit(1000),
      () => sb.from('mistakes').select('id,review_on,reviewed_at,updated_at').is('archived_at', null).order('updated_at', { ascending: false }).limit(1000),
    ]),
    first([
      () => sb.from('goals').select('id,title,subject_id,target_date,test_kind,topic_codes,topics').eq('kind', 'test').is('archived_at', null).gte('target_date', today).lte('target_date', addDays(today, 14)),
      () => sb.from('goals').select('id,title,subject_id,target_date,topics').eq('kind', 'test').is('archived_at', null).gte('target_date', today).lte('target_date', addDays(today, 14)),
    ]),
    first([() => sb.from('programmes').select('id,name,area,subject_id,per_week,minutes,days,starts_on,ends_on,status,paused_until,mode,notes').is('archived_at', null)]),
    first([() => sb.from('programme_items').select('id,programme_id,position,title,status,done_on').is('archived_at', null)]),
    first([() => sb.from('act_scores').select('taken_on,english,maths,reading,science,composite').is('archived_at', null).order('taken_on', { ascending: false }).limit(60)]),
    first([() => sb.from('lift_sets').select('id,done_on,exercise,exercise_key,weight_kg,reps,sets,created_at').is('archived_at', null).gte('done_on', from).lte('done_on', to)]),
    first([() => sb.from('weekly_targets').select('*').eq('is_active', true)]),
    first([() => sb.from('target_logs').select('target_id,done_on,amount').gte('done_on', from).lte('done_on', to)]),
    first([() => sb.from('target_weeks').select('target_id,week_start,target_count').eq('week_start', from)]),
    first([() => sb.from('weekly_snapshots').select('week_start,topics,mistakes').eq('week_start', from).limit(1)]),
  ])

  const blocks: WBlock[] | null = blocksRaw?.map((b) => ({
    id: String(b.id), date: String(b.on_date), title: String(b.title ?? ''), kind: String(b.kind ?? 'focus'), status: b.status === 'done' ? 'done' as const : 'planned' as const,
    taskId: str(b.task_id), goalId: str(b.goal_id), topicId: str(b.topic_id), programmeItemId: str(b.programme_item_id), pickKey: str(b.pick_key), rolledFrom: str(b.rolled_from),
    start: typeof b.start_time === 'string' ? b.start_time.slice(0, 5) : null,
  })) ?? null

  // tasks: open ones (for overdue homework) and the ones the blocks point at (for their subject)
  const blockTasks = [...new Set((blocks ?? []).flatMap((b) => [b.taskId, b.pickKey?.match(/^task:([0-9a-f-]{36})/)?.[1] ?? null]).filter((x): x is string => !!x))]
  const blockGoals = [...new Set((blocks ?? []).flatMap((b) => [b.goalId, b.pickKey?.match(/^test:([0-9a-f-]{36})/)?.[1] ?? null]).filter((x): x is string => !!x))]
  const [openTasks, linkedTasks, goals] = await Promise.all([
    first([
      () => sb.from('tasks').select('id,title,subject_id,due_at,window_end,status,source,is_system').is('archived_at', null).neq('status', 'completed').neq('status', 'someday'),
      () => sb.from('tasks').select('id,title,subject_id,due_at,window_end,status,source').is('archived_at', null).neq('status', 'completed').neq('status', 'someday'),
    ]),
    blockTasks.length ? first([() => sb.from('tasks').select('id,title,subject_id,due_at,window_end,status,source').in('id', blockTasks)]) : Promise.resolve([]),
    blockGoals.length ? first([() => sb.from('goals').select('id,subject_id').in('id', blockGoals)]) : Promise.resolve([]),
  ])
  const taskOf = (t: Row, open: boolean): WTask => ({
    id: String(t.id), title: String(t.title ?? ''), subjectId: str(t.subject_id), due: day(t.due_at) ?? str(t.window_end), open,
    homework: open && (!!str(t.subject_id) || t.source === 'import'),   // school work: a subject, or from Google Classroom
  })
  const tasks = new Map<string, WTask>()
  for (const t of linkedTasks ?? []) tasks.set(String(t.id), taskOf(t, false))
  // (a test's generated prep sessions aren't deadlines: the test itself is on the check)
  for (const t of openTasks ?? []) if (t.is_system !== true) tasks.set(String(t.id), taskOf(t, true))

  const topics: WTopic[] | null = topicsRaw?.map((t) => ({
    id: String(t.id), subjectId: str(t.subject_id), code: str(t.code), name: String(t.name ?? ''), status: colour(t.status),
    lastDone: str(t.last_done), statusAt: day(t.status_at), order: num(t.sort_order) ?? 0,
  })) ?? null

  const mistakes: WMistake[] | null = mistakesRaw?.map((m) => ({
    id: String(m.id), stage: num(m.redo_stage) ?? 0, reviewOn: String(m.review_on ?? ''), reviewedOn: day(m.reviewed_at), updatedOn: day(m.updated_at),
  })) ?? null

  // tests coming up, with what he has tried for each (a booklet attempt changes the suggestion)
  const testIds = (testsRaw ?? []).map((t) => String(t.id))
  const attempts = testIds.length ? await first([() => sb.from('test_attempts').select('goal_id,what').in('goal_id', testIds).is('archived_at', null)]) : []
  const tests: WTest[] | null = testsRaw?.filter((t) => str(t.target_date)).map((t) => ({
    id: String(t.id), title: String(t.title ?? ''), date: String(t.target_date), subjectId: str(t.subject_id), kind: str(t.test_kind),
    topicCodes: Array.isArray(t.topic_codes) ? (t.topic_codes as unknown[]).map(String) : [], topicWords: str(t.topics),
    attempts: attempts ? attempts.filter((a) => a.goal_id === t.id).map((a) => String(a.what)) : null,
  })) ?? null

  const programmes: Programme[] | null = progsRaw ? progsRaw.map((p) => ({
    id: String(p.id), name: String(p.name ?? ''), area: (str(p.area) ?? 'study') as Programme['area'], subjectId: str(p.subject_id),
    perWeek: num(p.per_week) ?? 1, minutes: num(p.minutes) ?? 60, days: str(p.days), startsOn: str(p.starts_on), endsOn: str(p.ends_on),
    status: (str(p.status) ?? 'active') as Programme['status'], pausedUntil: str(p.paused_until), mode: (str(p.mode) ?? 'in_order') as Programme['mode'], notes: str(p.notes),
    items: (itemsRaw ?? []).filter((i) => i.programme_id === p.id).map((i): ProgrammeItem => ({
      id: String(i.id), programmeId: String(i.programme_id), position: num(i.position) ?? 0, title: String(i.title ?? ''), details: null, url: null, minutes: null,
      status: (str(i.status) ?? 'todo') as ProgrammeItem['status'], doneOn: str(i.done_on), result: null, score: null, outOf: null,
    })),
  })) : null

  // the goal is ACT's own (36 unless it says otherwise); the scores are read here so this works on its own
  const act = actRaw ? {
    goal: await loadActWorld(sb, today).then((w) => (Number.isFinite(w.goal) && w.goal > 0 ? w.goal : 36), () => 36),
    scores: actRaw.map((s): WActScore => ({ takenOn: String(s.taken_on), english: num(s.english), maths: num(s.maths), reading: num(s.reading), science: num(s.science), composite: num(s.composite) })),
  } : null

  // lifts: this week's, and the earlier ones of the same exercises (for PRs)
  let lifts: WLift[] | null = null
  if (liftsRaw) {
    const keys = [...new Set(liftsRaw.map((l) => String(l.exercise_key)))]
    const before = keys.length ? await first([() => sb.from('lift_sets').select('id,done_on,exercise,exercise_key,weight_kg,reps,sets,created_at').is('archived_at', null).lt('done_on', from).in('exercise_key', keys).order('done_on', { ascending: false }).limit(1000)]) : []
    lifts = [...liftsRaw, ...(before ?? [])].map((l): Lift => ({
      id: str(l.id) ?? undefined, done_on: String(l.done_on), exercise: String(l.exercise ?? l.exercise_key), exercise_key: String(l.exercise_key),
      weight_kg: num(l.weight_kg) ?? 0, reps: num(l.reps) ?? 1, sets: num(l.sets) ?? 1, created_at: str(l.created_at) ?? undefined,
    }))
  }

  const upper = await upperProgress(sb, planRaw, (targetsRaw ?? []) as WeeklyTarget[], (logsRaw ?? []) as TargetLog[], (weekCountsRaw ?? []) as { target_id: string; week_start: string; target_count: number }[], from, today < to ? today : to)

  const s = snapRaw?.[0]
  const snapshot: WSnapshot | null = s ? {
    weekStart: String(s.week_start),
    topics: Object.fromEntries(Object.entries((s.topics ?? {}) as Record<string, unknown>).map(([id, v]) => [id, [colour(Array.isArray(v) ? v[0] : null), Array.isArray(v) ? str(v[1]) : null] as [Colour, string | null]])),
    mistakes: Object.fromEntries(Object.entries((s.mistakes ?? {}) as Record<string, unknown>).map(([id, v]) => [id, num(v) ?? 0])),
  } : null

  const values = moreSettings(planRaw)
  return {
    today, now, weekOf, reviewDays: reviewDaysFrom(values), exercises: exerciseCatalogue(planRaw), gymPrefs: gymPrefs(planRaw),
    subjects: (subjects ?? []).map((x) => ({ id: String(x.id), name: String(x.name) })),
    blocks, tasks: [...tasks.values()], goals: (goals ?? []).map((g) => ({ id: String(g.id), subjectId: str(g.subject_id) })),
    topics, snapshot, mistakes, tests, programmes, act, lifts, upper, snapshotTable: snapRaw !== null,
  }
}

/** This week's upper sessions vs his target (the session type "upper" names its target, like the Your week card). */
async function upperProgress(sb: SupabaseClient, planning: unknown, targets: WeeklyTarget[], logs: TargetLog[], weekCounts: { target_id: string; week_start: string; target_count: number }[], weekStart: string, today: string) {
  const name = activeSessions(planning).find((x) => x.key === 'upper')?.target?.toLowerCase()
  const t = targets.find((x) => name && x.name.toLowerCase() === name) ?? targets.find((x) => x.training_type === 'upper' || /\bupper\b/i.test(x.name))
  if (!t) return null
  let events: EventRow[] = [], changes: EventException[] = []
  if (t.counts_from === 'events') {
    const [e, c] = await Promise.all([
      first([() => sb.from('events').select('*').is('archived_at', null).eq('target_id', t.id)]),
      first([() => sb.from('event_exceptions').select('id,event_id,on_date,cancelled,new_date,new_start,new_end,missed').gte('on_date', weekStart).lte('on_date', addDays(weekStart, 6))]),
    ])
    events = (e ?? []) as EventRow[]; changes = (c ?? []) as EventException[]
  }
  return targetProgress(t, { events, changes, logs: logs.filter((l) => l.target_id === t.id), weekStart, today, weekCounts })
}

// ---------------------------------------------------------------------------
// The message
// ---------------------------------------------------------------------------

export type WeeklyMessage = { html: string; buttons: { text: string; callback_data: string }[][]; summary: WeeklySummary; needsSql: boolean }

/** The Monday of the week its button plans: next week at the weekend, else this week (lib/ask/week.ts checkinRange). */
export const plannedWeekOf = (today: string) => weekStartISO(checkinRange(today).from)

/** The weekly check `today` (on a Monday: the week that just ended), with its "Plan next week? ✅" button
 * (wk:plan:<the Monday of the week it plans>). needsSql: supabase/weekly.sql hasn't run yet (the check works without
 * it; it just can't say which topics went up a colour). */
export async function weeklyCheck(sb: SupabaseClient, today = todayISO(), planning?: unknown, now = timeOf(new Date())): Promise<WeeklyMessage> {
  const input = await loadWeeklyInput(sb, today, planning, now)
  const summary = buildWeekly(input)
  return { html: weeklyText(summary), buttons: [[{ text: planLabel(today), callback_data: `wk:plan:${plannedWeekOf(today)}` }]], summary, needsSql: input.snapshotTable === false }
}

// ---------------------------------------------------------------------------
// The start-of-week snapshot (so Sunday can say what moved)
// ---------------------------------------------------------------------------

const isMissing = (e: { message: string; code?: string } | null) =>
  !!e && (['42P01', '42703', 'PGRST204', 'PGRST205'].includes(e.code ?? '') || /does not exist|schema cache/i.test(e.message))

/** Each topic's colour and last-done date, and each open mistake's redo stage, as the week begins.
 * 'saved' · 'exists' (already taken) · 'missing' (supabase/weekly.sql not run yet). Throws on anything else (tried again later). */
export async function takeSnapshot(sb: SupabaseClient, weekStart: string): Promise<'saved' | 'exists' | 'missing'> {
  const [topics, mistakes] = await Promise.all([
    first([
      () => sb.from('topics').select('id,status,last_done').is('archived_at', null),
      () => sb.from('topics').select('id,status').is('archived_at', null),
    ]),
    first([
      () => sb.from('mistakes').select('id,redo_stage').is('archived_at', null).lt('redo_stage', 2).limit(1000),
      () => sb.from('mistakes').select('id').is('archived_at', null).is('reviewed_at', null).limit(1000),
    ]),
  ])
  // topics unreadable right now: try again on a later tick (an empty starting point would make every colour look new)
  if (!topics) throw new Error('Couldn’t read the topics for the week’s starting point')
  const row = {
    week_start: weekStart,
    topics: Object.fromEntries((topics ?? []).map((t) => [String(t.id), [colour(t.status), str(t.last_done)]])),
    mistakes: Object.fromEntries((mistakes ?? []).map((m) => [String(m.id), num(m.redo_stage) ?? 0])),
  }
  const { error } = await sb.from('weekly_snapshots').insert(row)
  if (!error) return 'saved'
  if (error.code === '23505') return 'exists'
  if (isMissing(error)) return 'missing'
  throw new Error(`Couldn’t save the week’s starting point: ${error.message}`)
}
