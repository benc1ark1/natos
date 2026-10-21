// Server-only: Today for one day, as Nat (row level security). The same list for the web (Home), the 07:30 morning
// message, the pinned Today, /today and the evening message:
// - a list saved earlier today (plan blocks, source 'auto') is shown as saved;
// - his own applied plan for the day is kept (never replaced);
// - otherwise it's built: the study planner's picks (lib/tracker/engine.ts, with ACT's), his must-do tasks and the
//   day's training (his applied week, else where the week optimiser puts it) placed into real free time
//   (lib/today/build.ts), then saved when `save` is set (the morning message, the first look at Today that day).
// Holidays (lib/today/holidays.ts): half-term mode, no school, the holiday wake time.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadStudyWorld } from '../tracker/data'
import { HOMEWORK_DAYS, planStudyDay } from '../tracker/engine'
import type { StudyWorld } from '../tracker/types'
import { loadActWorld } from '../act/data'
import { actPicks } from '../act/engine'
import { actTaskMinutes, isActTask } from '../act/tasks'
import type { ActWorld } from '../act/types'
import type { DayContext, Pick } from '../plan-items'
import { TIER } from '../plan-items'
import { freeDays, type PlanningSettings } from '../freetime'
import { focusBudget, type Energy } from '../plan'
import { afterSchoolFirst, blockLeave, dayItems } from '../day'
import { expandEvents, isSchool } from '../events'
import { boundsOf, hm } from '../setup'
import { setting } from '../settings'
import { deadlineLabel, deadlineOf } from '../tasks'
import { addDays, dateISOOf, isoDow, minutesOf, timeOf, weekStartISO } from '../time'
import type { Task } from '../types'
import { planTraining } from '../week'
import { isLowRecovery, whoopDay } from '../whoop/sync'
import { loadViewData, type ViewData } from '../telegram/views'
import { loadWorld } from '../telegram/ripple'
import { blockOf } from '../telegram/trainplan'
import { claim, release } from '../telegram/sent'
import { ACT_FILL, ACT_FILL_WHY, actFillDay, blockedWhy, dayRules, testDays, type DayRules } from './focus'
import { schoolDays } from '../school'
import { buildToday, clampItems, heavyOf, todayFromSaved, type FixedIn, type Rolled, type SavedBlock, type TodayItem, type TodayPlan, type TrainingIn } from './build'
import { isAuto, loadBlocks, saveToday } from './data'
import { dayMode, holidayChanges, isHoliday } from './holidays'

export type TodayLoad = { plan: TodayPlan; data: ViewData; sqlMissing: boolean; world: StudyWorld; act: ActWorld }

const EMPTY_LINKS = { bicenPure: '', bicenStats: '', bicenMech: '', bicenCorePure: '', bicenMemorise: '', bicenSummaries: '', bicenHardest: '', integralFurther: '', integralAssessments: '', madas: '', step: '', pmtPhysics: '', isaac: '', amsp: '' }
const emptyWorld = (today: string): StudyWorld => ({ today, topics: [], tests: [], mistakes: [], programmes: [], rules: [], homework: [], links: EMPTY_LINKS, reviewDays: { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 }, doneToday: [] })
const emptyAct = (today: string): ActWorld => ({ today, retake: null, goal: 36, scores: [], books: [], misses: [], doneToday: [] })

/** A day with no study on top of what's booked has at most this many minutes for the planner (a free half-term day). */
const MAX_STUDY_MIN = 360

/** Where he'll be and when to leave, for a training block: "leave school 16:10 (25 min)". */
function trainingOpen(b: { start_time: string; title: string }, d: ViewData, schoolEnd: number | null): { open: string; leave: string | null } {
  const l = blockLeave({ start_time: b.start_time, title: b.title }, d.planning, schoolEnd, d.settings.bufferMin)
  if (!l) return { open: '', leave: null }
  const fromSchool = l.how.includes('from school')
  return { open: `leave ${fromSchool ? 'school ' : ''}${l.leave} (${l.how.replace(/ from school/, '')})`, leave: l.leave }
}

const openTask = (t: Task) => !(t.status === 'completed' || t.archived_at || t.status === 'someday' || t.is_system)

/**
 * His must-do tasks that aren't the planner's: due by tomorrow (tier 1), or on his Today column / starred (after study).
 * His ACT tasks go on the day he gave them (with the ACT work, never the day before).
 */
export function taskPicks(tasks: Task[], date: string, actSubjectId?: string | null): Pick[] {
  const tomorrow = addDays(date, 1)
  const out: Pick[] = []
  for (const t of tasks) {
    if (!openTask(t)) continue
    const due = deadlineOf(t)
    const act = isActTask(t, actSubjectId) && !!due
    if (act && due! > date) continue
    const urgent = t.importance === 'must' && !!due && due <= tomorrow
    if (!act && !urgent && t.status !== 'today' && !t.is_key) continue
    const url = (t as Task & { hand_in_url?: string | null }).hand_in_url ?? null
    out.push({
      key: `task:${t.id}`, kind: 'task', tier: act && due === date ? TIER.test : urgent ? TIER.homework : TIER.leftover, subject: act ? 'ACT' : null, title: t.title,
      open: t.details?.split('\n')[0]?.slice(0, 200) ?? '', url, minutes: t.duration_minutes ?? 30,
      why: act && due === date ? 'your ACT task for today' : due ? deadlineLabel(t, date) : t.is_key ? 'starred' : 'on your Today list', done: { kind: 'task', taskId: t.id }, taskId: t.id,
    })
  }
  // earliest deadline first within each tier
  return out.sort((a, b) => a.tier - b.tier || (deadlineOf(tasks.find((t) => t.id === a.taskId)!) ?? '9').localeCompare(deadlineOf(tasks.find((t) => t.id === b.taskId)!) ?? '9'))
}

/** Yesterday's block that wasn't ticked, as a pick for today (what to open and what done moves forward come with it).
 *  `date`: today — a dated key ("mistakes:<yesterday>:tests") becomes today's, so the planner's fresh version replaces it
 *  instead of the same redo showing up once for every day it was left (QA week sim). */
export function rolledPick(b: SavedBlock, date?: string): Pick {
  const done: Pick['done'] = b.done_hint ?? (b.task_id ? { kind: 'task', taskId: b.task_id } : { kind: 'block' })
  const key = b.pick_key ?? (b.task_id ? `task:${b.task_id}` : `block:${b.id}`)
  return {
    key: date ? key.replace(/^mistakes:\d{4}-\d{2}-\d{2}/, `mistakes:${date}`) : key, kind: done.kind === 'task' ? 'task' : 'review', tier: TIER.boost, subject: null,
    title: b.title, open: b.open_text ?? '', url: b.open_url ?? null, minutes: Math.max(10, minutesOf(b.end_time.slice(0, 5)) - minutesOf(b.start_time.slice(0, 5))),
    why: (b.why ?? '').replace(/^from (yesterday|\w{3}) · /, ''), done, heavy: b.kind === 'focus',
    taskId: b.task_id ?? (done.kind === 'task' ? done.taskId : null), topicId: b.topic_id ?? (done.kind === 'topic' ? done.topicId : null),
    goalId: b.goal_id ?? (done.kind === 'attempt' ? done.goalId : null), programmeItemId: b.programme_item_id ?? (done.kind === 'programme_item' ? done.itemId : null),
  }
}

/** Has what ticking this moves forward already happened (he reported it by message)? Then it shows as done. */
export function effectDone(it: TodayItem, x: { date: string; tasks: Task[]; world: StudyWorld; act: ActWorld }): boolean {
  if (x.world.doneToday.includes(it.key) || x.act.doneToday.includes(it.key)) return true
  const h = it.done
  if (h.kind === 'task') return !x.tasks.some((t) => t.id === h.taskId)
  if (h.kind === 'topic') {
    const t = x.world.topics.find((y) => y.id === h.topicId)
    return !!t && (h.physics ? t[h.physics] === 'done' : t.lastDone === x.date)
  }
  if (h.kind === 'programme_item') {
    const item = x.world.programmes.flatMap((p) => p.items).find((i) => i.id === h.itemId)
    return !!item && (item.status === 'done' || item.status === 'skipped' || (!!h.score && item.doneOn === x.date))
  }
  if (h.kind === 'mistakes') {
    const found = h.mistakeIds.map((id) => x.world.mistakes.find((m) => m.id === id))
    return found.length > 0 && found.every((m) => m && m.reviewOn > x.date)
  }
  if (h.kind === 'attempt') return !!x.world.tests.find((t) => t.id === h.goalId)?.attempts.some((a) => a.doneOn === x.date && a.what === h.what)
  return false
}

/** The study world for a day with a focus period or a test: only that work (and never homework he can't start yet). */
export function narrowWorld(w: StudyWorld, rules: DayRules, ok: (x: { title: string; subject?: string | null; heavy: boolean; taskId?: string | null; goalId?: string | null }) => boolean): StudyWorld {
  const homework = w.homework.filter((h) => ok({ title: h.title, subject: h.subject, heavy: false, taskId: h.id }))
  if (!rules.focus && !rules.test) return { ...w, homework }
  const topics = w.topics.filter((t) => ok({ title: t.name, subject: t.subject, heavy: false }))
  const ids = new Set(topics.map((t) => t.id))
  return { ...w, homework, topics, tests: w.tests.filter((t) => ok({ title: t.title, subject: t.subject, heavy: false, goalId: t.id })),
    mistakes: w.mistakes.filter((m) => !!m.topicId && ids.has(m.topicId)), programmes: w.programmes.filter((p) => ok({ title: p.name, heavy: false })) }
}

/** One saved block per task a day (the one he ticked, else the first): a task never shows twice on Today. */
export function onePerTask<B extends { task_id: string | null; status: string; kind: string }>(rows: B[]): B[] {
  const keep = new Map<string, B>()
  for (const b of rows) if (b.task_id && b.kind !== 'training' && (!keep.has(b.task_id) || (b.status === 'done' && keep.get(b.task_id)!.status !== 'done'))) keep.set(b.task_id, b)
  return rows.filter((b) => !b.task_id || b.kind === 'training' || keep.get(b.task_id) === b)
}

/** Today for `date` (default: today in London). `save`: keep a newly built list (morning message, first look that day). */
export async function loadToday(sb: SupabaseClient, opts: { date?: string; now?: Date; data?: ViewData; save?: boolean } = {}): Promise<TodayLoad> {
  const now = opts.now ?? new Date()
  const today = dateISOOf(now.toISOString())
  const date = opts.date ?? today
  // these don't need the day's data: read alongside it (fewer round trips before /today replies)
  const reads = Promise.all([
    loadBlocks(sb, date),
    loadBlocks(sb, addDays(date, -1)).catch(() => ({ rows: [], sqlMissing: false })),
    loadStudyWorld(sb, date).catch(() => emptyWorld(date)),
    loadActWorld(sb, date).catch(() => emptyAct(date)),
    sb.from('day_state').select('energy').eq('on_date', date).maybeSingle().then((r) => (r.error ? null : r.data as { energy: Energy | null } | null)),
    whoopDay(sb, date).catch(() => null),
    // his open App ideas: requests for Claude Code, never work for Today (none before speed.sql / on an error)
    sb.from('app_ideas').select('request,source_text').eq('status', 'open').then((r) => (r.error ? [] : (r.data ?? []) as { request: string; source_text: string | null }[]), () => []),
  ])
  reads.catch(() => null)   // (awaited below; this only stops an "unhandled rejection" if the day's data fails first)
  const data = opts.data ?? await loadViewData(sb, date, now)
  const planning = data.planning
  const mode = dayMode(planning, date)
  const changes = holidayChanges(data.events, data.changes, planning, addDays(date, -1), addDays(date, 1))
  const [blocks, before, world1, act, state, whoop, ideas] = await reads
  // low Whoop recovery makes it a lighter day (unless he said how he feels), and the list says why in one line
  const lowWhoop = !state?.energy && isLowRecovery(whoop, planning)
  const whoopNote = lowWhoop ? `🔴 Whoop recovery ${whoop!.recovery}%: a lighter day; protect your sleep tonight.` : null
  const withNote = (p: TodayPlan): TodayPlan => (whoopNote ? { ...p, note: [whoopNote, p.note].filter(Boolean).join(' ') } : p)
  // what may go on today (lib/today/focus.ts): not before a task's start date, a focus period's own work only ("until
  // 25 Oct only ACT": an overdue or Later task doesn't jump the queue), nothing but the test on a test day (light the
  // day before), never an App idea
  const schoolOn = schoolDays(data.events, changes, date, addDays(date, 1), data.settings.schoolFreePeriods)
  const tests = testDays(data.goals, (d) => schoolOn.has(d))
  const rules = dayRules(planning, tests, date, world1.rules ?? [])
  const testGoal = (() => { const t = tests.get(date) ?? tests.get(addDays(date, 1)); return t ? data.goals.find((g) => g.kind === 'test' && g.title === t) ?? null : null })()
  const okFor = (x: { title: string; subject?: string | null; heavy: boolean; taskId?: string | null; goalId?: string | null }) => {
    const task = x.taskId ? data.tasks.find((t) => t.id === x.taskId) ?? null : null
    const ofTest = !!testGoal && (x.goalId === testGoal.id || (/\bACT\b/.test(testGoal.title) && (x.subject === 'ACT' || /\bACT\b/.test(x.title)))
      || (!!testGoal.subject_id && task?.subject_id === testGoal.subject_id))
    return !blockedWhy({ title: x.title, subject: x.subject ?? null, heavy: x.heavy, task, deadline: task ? deadlineOf(task) : null, ofTest }, date, rules, { until: date, ideas, later: false })
  }
  const pickOk = (p: Pick) => okFor({ title: p.title, subject: p.subject, heavy: heavyOf(p), taskId: p.taskId ?? (p.done.kind === 'task' ? p.done.taskId : null), goalId: p.goalId })
  const world0 = narrowWorld(world1, rules, okFor)

  // done on Today counts as done for the planners too
  const doneKeys = blocks.rows.filter((b) => b.status === 'done' && b.pick_key).map((b) => b.pick_key!)
  const world: StudyWorld = { ...world0, doneToday: [...new Set([...(world0.doneToday ?? []), ...doneKeys])] }
  const max = setting<number>(planning, 'todayItems')

  // school today (none on a holiday): when he's free after it, and the fixed line
  const schoolEnds = expandEvents(data.events, date, date, changes).filter((o) => o.date === date && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.end).map((o) => o.end!).sort()
  const schoolEnd = schoolEnds.length ? minutesOf(schoolEnds.at(-1)!) + data.settings.bufferMin : null
  const fixed: FixedIn[] = dayItems({ date, events: data.events, changes, travel: data.travel ?? null, shape: null, blocks: [], planning, bufferMin: data.settings.bufferMin })
    .filter((it) => it.kind === 'school' || it.kind === 'event')
    .map((it) => ({ at: it.at || null, end: it.end, title: it.title, icon: it.icon, school: it.kind === 'school' }))

  // maxPicks (contracts §3.1): how many study picks Today has room for, so the planner chooses which win
  const planner = (studyMinutes: number, maxPicks?: number) => {
    const day = { date, dow: isoDow(date), mode, studyMinutes, actTaskMin: actTaskMinutes(data.tasks, date, act.subjectId), ...(maxPicks ? { maxPicks } : {}) } as DayContext & { maxPicks?: number }
    let extra: Pick[] = []
    try { extra = actPicks(act, day) } catch { extra = [] }
    // (training comes from his week's blocks or the week optimiser below, never from the study planner)
    try { return planStudyDay(world, day, extra).picks.filter((p) => p.kind !== 'training' && pickOk(p)) } catch { return [...extra].filter((p) => p.kind !== 'training' && pickOk(p)).sort((a, b) => a.tier - b.tier) }
  }
  const doneOf = (it: TodayItem) => effectDone(it, { date, tasks: data.tasks, world, act })
  const trainOpen = (b: SavedBlock) => trainingOpen(b, data, schoolEnd).open

  const nowHM = date === today ? timeOf(now) : null
  // a list saved earlier today, or his own plan: shown as it is. A plan he applied after the list was saved replaces
  // the list's open items (applyPlan replaces planned blocks), so then it's his plan plus what he already ticked.
  // (a saved block that can't be today any more is left off, and one block per task: the first, or the one ticked)
  const live = onePerTask(blocks.rows.filter((b) => b.kind === 'training' || okFor({ title: b.title, heavy: b.kind === 'focus', taskId: b.task_id, goalId: b.goal_id })))
  const auto = live.filter((b) => isAuto(b, date))
  const his = live.filter((b) => !isAuto(b, date) && b.kind !== 'training')
  const training = blocks.rows.filter((b) => b.kind === 'training' && !isAuto(b, date))
  if (auto.length || his.length) {
    const autoLive = auto.length > 0 && (auto.some((b) => b.status === 'planned') || !his.length)
    const picks = [...planner(MAX_STUDY_MIN), ...taskPicks(data.tasks, date, act.subjectId).filter(pickOk)]
    const list = autoLive ? [...auto, ...training] : [...his, ...auto.filter((b) => b.status === 'done'), ...training]
    const plan = todayFromSaved({ date, mode, blocks: list, picks, fixed, max, source: autoLive ? 'auto' : 'his', trainingOpen: trainOpen, effectDone: doneOf, now: nowHM })
    return { plan: withNote(plan), data, sqlMissing: blocks.sqlMissing, world, act }
  }

  // free time for study (school free periods count), after school first; a holiday starts after his holiday wake
  const shapes = data.shapes
  const base = boundsOf(shapes)
  const holidayStart = hm(minutesOf(setting<string>(planning, 'holidayWakeAt')) + setting<number>(planning, 'morningMin'))
  const settings: PlanningSettings = {
    ...data.settings,
    dayBounds: (d: string) => {
      const b = base(d)
      if (!b || !isHoliday(planning, d)) return b
      return { start: minutesOf(holidayStart) > minutesOf(b.start) ? holidayStart : b.start, end: b.end }
    },
  }
  const nowMin = date === today ? minutesOf(timeOf(now)) : 0
  const [free] = freeDays(data.events, changes, date, date, settings, today, nowMin, data.travel ?? null, { freePeriods: true })
  const slots = afterSchoolFirst(free.slots, data.events, changes, date)
  const energy: Energy = state?.energy ?? (lowWhoop ? 'tired' : 'normal')
  const budget = focusBudget(free.schoolNight, settings, energy)

  // training: his applied week's blocks, else where the week optimiser puts today's sessions
  let trainingIn: TrainingIn[] = training.map((b) => {
    const t = trainingOpen(b, data, schoolEnd)
    return { title: b.title, start: b.start_time, end: b.end_time, blockIds: [b.id], targetId: b.target_id, open: t.open, done: b.status === 'done', cutFrom: t.leave ?? undefined, cutTo: t.leave ? hm(minutesOf(b.end_time) + minutesOf(b.start_time) - minutesOf(t.leave)) : undefined }
  })
  let newTraining: TrainingIn[] = []
  // (only when the list is being saved: the morning message, the first look at Today; a preview doesn't run it)
  if (!trainingIn.length && energy !== 'ill' && opts.save) {
    try {
      // the whole week is placed (so today gets what's best for the week), then today's sessions are taken
      // (this calendar week: at the weekend the bot's "week" runs on to next Sunday, which moved Saturday's fixed upper
      // to next Monday because this week's done sessions were counted against next week's days — QA week sim)
      const w = await loadWorld(sb, data, { from: date, to: addDays(weekStartISO(date), 6) })
      const placed = planTraining({ ...w, changes: holidayChanges(w.events, w.changes, planning, w.from, w.to) }).placed.filter((p) => p.date === date && (date !== today || minutesOf(p.start) >= nowMin))
      newTraining = placed.map((p) => {
        const b = blockOf(p)
        const leave = b.leave ? `leave ${b.from === 'school' ? 'school ' : ''}${b.leave}` : ''
        return { title: b.title, start: b.start, end: b.end, blockIds: [], targetId: p.targetId ?? null, open: [leave, p.intensity !== 'heavy' ? p.intensity : ''].filter(Boolean).join(' · '), done: false,
          cutFrom: hm(minutesOf(b.start) - (p.before ?? 0)), cutTo: hm(minutesOf(b.end) + (p.after ?? 0)) }
      })
      trainingIn = newTraining
    } catch { /* no training suggestion today: the rest of Today still works */ }
  }

  const studyFree = slots.reduce((a, s) => a + s.minutes, 0) - trainingIn.reduce((a, t) => a + minutesOf(t.end) - minutesOf(t.start), 0)
  const studyMinutes = Math.max(0, Math.min(studyFree, budget ?? MAX_STUDY_MIN))
  // an ACT focus period: the free time left goes to ACT (reading, grammar, ACT maths), after everything else
  const fill = actFillDay(rules) ? ACT_FILL.map((f): Pick => ({ key: `act:focus:${f.key}`, kind: 'act', tier: TIER.leftover, subject: 'ACT', title: f.title, open: f.open, minutes: f.minutes, why: ACT_FILL_WHY, done: { kind: 'block' }, heavy: true })) : []
  const tasks = [...taskPicks(data.tasks, date, act.subjectId).filter(pickOk), ...fill]
  // not done yesterday: it comes back today, straight after homework (his own plan's blocks too: a task block as that
  // task), unless it got done another way since (reported by message, task completed)
  const yesterday = addDays(date, -1)
  const rolledPicks = before.rows.filter((b) => b.status === 'planned' && b.kind !== 'training' && b.kind !== 'rest')
    .map((b) => rolledPick(b, date)).filter((p) => !(p.done.kind === 'task' && !data.tasks.some((t) => t.id === (p.done as { taskId: string }).taskId)))
    .filter((p) => !effectDone({ key: p.key, done: p.done } as TodayItem, { date, tasks: data.tasks, world, act }) && pickOk(p))
  const rolled: Rolled[] = rolledPicks.map((p) => ({ key: p.key, title: p.title, from: yesterday }))
  const homeworkIds = new Set(world.homework.map((h) => h.id))
  const mustDo = tasks.filter((p) => p.tier <= TIER.homework && !homeworkIds.has(p.taskId ?? '')).length
  // (rolled homework is the planner's own homework pick again, so it isn't extra; and every homework due gets a pick:
  // homework is never dropped for room — QA week sim: homework newly due was lost when yesterday's items rolled on)
  const rolledExtra = rolledPicks.filter((r) => !tasks.some((t) => t.key === r.key && t.tier <= TIER.homework) && !(r.done.kind === 'task' && homeworkIds.has(r.done.taskId))).length
  const dueOf = (at: string) => (at.includes('T') ? dateISOOf(at) : at.slice(0, 10))
  const homeworkDue = world.homework.filter((h) => h.dueAt && dueOf(h.dueAt) <= addDays(date, HOMEWORK_DAYS)).length
  const picks = planner(studyMinutes, Math.max(1, homeworkDue, clampItems(max) - (trainingIn.length ? 1 : 0) - mustDo - rolledExtra))
  const plan = buildToday({ date, mode, slots, settings, budget, energy, picks, tasks, training: trainingIn, fixed, max, rolled, rolledPicks })
  let sqlMissing = blocks.sqlMissing
  if (opts.save && (plan.items.length || plan.more)) {
    const r = await saveToday(sb, plan, newTraining, (k) => claim(sb, k), async (k) => { await release(sb, k) })
    sqlMissing ||= r.sqlMissing
    if (!r.saved) {
      // another run saved today's list first: show that one (it may still be writing it: one more look a moment later)
      let again = await loadBlocks(sb, date)
      if (!again.rows.some((b) => isAuto(b, date))) { await new Promise((ok) => setTimeout(ok, 400)); again = await loadBlocks(sb, date) }
      const auto2 = again.rows.filter((b) => isAuto(b, date))
      if (auto2.length) {
        const plan2 = todayFromSaved({ date, mode, blocks: [...auto2, ...again.rows.filter((b) => b.kind === 'training' && !isAuto(b, date))], picks: [...picks, ...tasks], fixed, max, source: 'auto', trainingOpen: trainOpen, effectDone: doneOf, now: nowHM })
        return { plan: withNote(plan2), data, sqlMissing, world, act }
      }
    } else plan.source = 'auto'
  }
  return { plan: withNote(plan), data, sqlMissing, world, act }
}
