// Server-only: the "Your week" card (Build O). ONE card for the whole week, built around his routines: last week in
// 2–3 lines, then each day in time order (school, his events, study blocks, homework and revision picked by the
// planner AI, every training session with its place and leave-by from the optimiser), with each day's 🧠 and 💪 load.
// One ✅ applies everything (plan blocks; the sessions go into Life OS); 🔁 moves a session and the optimiser re-fits
// the rest (the study the AI picked is placed again around it, without asking the AI again). It comes every Sunday at
// his week-reset time and whenever he asks "plan my week". The study picks come from lib/telegram/planner.ts; all
// times and training come from plain code (lib/optimiser.ts, lib/plan.ts).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Usage } from '../ai/models'
import { recordUsage } from '../ai/usage'
import type { PlannerContext } from '../ask/server'
import { expandEvents, isBackground, isSchool, timeRange } from '../events'
import { freeDays, slotsText } from '../freetime'
import { mentalDays, DOT } from '../mental'
import { focusBudget, placeItems, planProblems, type Block, type PlanItem } from '../plan'
import { moreSettings } from '../settings'
import { activePlaces, activeSessions, parseSessionTitle } from '../setup'
import { addDays, dowShort, isoDow, minutesOf, shortDate, weekStartISO } from '../time'
import { planTraining, studySlots, type WeekWorld } from '../week'
import { whoopWords } from '../whoop/sync'
import { esc, clearButtons, type Button } from './api'
import type { PlanPayload } from './dayplan'
import { makeWeekPlan } from './planner'
import { loadWorld, loadMentalOverrides, weekRange } from './ripple'
import { blockOf, parsePins, upperWords, type TrainingInfo } from './trainplan'
import { plain, say } from './turns'
import type { ViewData } from './views'
import { looksLikeWeek } from './weekread'
import type { Pin } from '../load'
import { recommendations } from './roi'
import { schoolDays, withSchool, type SchoolWindow } from '../school'
import { courses as mathsCourses, modeOf, weekBlocks } from '../maths'
import { deadlineOf } from '../tasks'
import { ACT_FILL_WHY, actFillDay, actFillers, blockedWhy, dayRules, focusLines, notYet, rulesForAI, testDays, type TrackerRule } from '../today/focus'
import { mathsWorld } from './views-more'
import { RULE_COLS, ruleOf, weekRulesLine } from '../tracker/bot-data'
import { loadActWorld } from '../act/data'
import { actPicks } from '../act/engine'
import { actTaskMinutes, actTasksOn, isActTask } from '../act/tasks'
import { dayMode } from '../today/holidays'

/** The "why" on the ACT blocks the app plans itself (so a re-fit knows them without asking the AI again). */
const ACT_WHY = 'ACT plan'

export type YourWeekDay = {
  date: string; mental: 'low' | 'med' | 'high'; mentalTotal: number; physical: 'rest' | 'low' | 'med' | 'high'; physicalTotal: number
  school: string | null; events: { start: string; title: string }[]
  schoolFrom?: string | null; windows?: SchoolWindow[]   // school as one line: its start, and free periods, break and lunch
  wake: string; bed: string; nightStart: string; why: string[]; wakeWhy?: string | null; bedWhy?: string | null
}
export type YourWeek = {
  review: string[]; recs: string[]
  days: YourWeekDay[]
  training: TrainingInfo                              // for 🔁 (moving one session re-fits the rest)
  studyItems: { date: string; items: PlanItem[] }[]   // what the planner picked, kept so a 🔁 doesn't ask the AI again
  guesses: string[]                                   // what's still a guess (answers to the gap questions replace them)
  rules?: string | null                               // item 1: "📌 Rules this week: …" (the study tracker's temporary rules)
  focus?: string[]                                    // "🎯 Focus: only ACT until Sun 25 Oct" · "⏳ From Mon 26 Oct: …" (lib/today/focus.ts)
  upperTarget?: { id: string; count: number } | null  // this week's upper count, if it differs from his target
}

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const PDOT = { rest: '⚪', low: '🟢', med: '🟡', high: '🔴' } as const

// ---------------------------------------------------------------------------
// Building it
// ---------------------------------------------------------------------------

export type BuildOpts = { pins?: Map<string, Pin>; upperCount?: number | null; left?: string[]; studyItems?: YourWeek['studyItems'] | null; previous?: string | null; review?: string[]; recs?: string[]
  onUsage?: (model: string, usage: Usage) => Promise<unknown>; range?: { from: string; to: string } }

/** The week, planned together: training by the optimiser, study by the planner (or the picks it made before), placed by code. */
export async function buildYourWeek(sb: SupabaseClient, data: ViewData, ctx: PlannerContext, words: string, opts: BuildOpts = {}): Promise<{ payload: PlanPayload } | { message: string }> {
  const world = await loadWorld(sb, data, opts.range ?? weekRange(data.today))
  const w: WeekWorld = { ...world, pins: opts.pins }
  const more = moreSettings(data.planning)
  // training first: the optimiser over his set-up (the old study plan is being replaced, so only training is kept)
  const fresh = { ...w, planned: w.planned.filter((b) => b.kind === 'training') }
  const plan = planTraining(fresh, { pins: opts.pins, upperCount: opts.upperCount ?? null, exclude: opts.left })
  const slots = studySlots(w, plan.placed)
  // school days: study in free periods and after school (not before school)
  const schoolOn = schoolDays(w.events, w.changes, w.from, w.to, w.settings.schoolFreePeriods)
  for (const [date, list] of slots) {
    const sd = schoolOn.get(date)
    if (!sd) continue
    const during = list.filter((s) => s.start >= sd.start && s.end <= sd.end), later = list.filter((s) => s.end > sd.end)
    slots.set(date, [...during, ...(more.focusBest === 'evening' ? [...later].sort((a, b) => minutesOf(b.start) - minutesOf(a.start)) : later)])
  }
  const free = freeDays(w.events, w.changes, w.from, w.to, w.settings, w.today, w.nowMin, w.travel ?? null)
  const days = free.filter((d) => d.date >= w.today).map((d) => {
    const energy = w.energy.get(d.date) ?? 'normal'
    return {
      date: d.date, label: day(d.date), energy, budget: focusBudget(d.schoolNight, w.settings, energy),
      freeTime: slotsText({ ...d, slots: slots.get(d.date) ?? [] }, w.settings),
      training: plan.placed.filter((t) => t.date === d.date).map((t) => `${t.title}${t.label ? ` @ ${t.label}` : ''} ${t.start}–${t.end}`).join(', '),
    }
  })
  if (!days.length) return { message: 'No days left to plan this week.' }

  // study: what the planner picks (or what it picked before, when only training moved)
  let studyItems = opts.studyItems ?? null
  let note = '', pushBack = ''
  // maths + further maths: planned by code (lib/maths.ts: homework → test → acceleration, the exact topic)
  const maths = await mathsWorld(sb, data)
  const mathsIds = new Set(mathsCourses(maths).map((c) => c.id))
  const isMaths = (it: PlanItem) => (it.ref?.kind === 'task' && mathsIds.has(data.tasks.find((t) => t.id === it.ref!.id)?.subject_id ?? '')) || /^(📝|🔥|🚀) /.test(it.title)
  // ACT: planned by code, the same as Today (lib/act/engine.ts: the retake countdown, holidays, test days), with his own
  // ACT tasks on the days he gave them (their minutes are part of that day's ACT time)
  const act = await loadActWorld(sb, data.today).catch(() => null)
  const isAct = (it: PlanItem) => it.why === ACT_WHY || it.why === ACT_FILL_WHY || /\bACT\b/.test(it.title)
    || (it.ref?.kind === 'task' && isActTask(data.tasks.find((t) => t.id === it.ref!.id) ?? { title: '', subject_id: null }, act?.subjectId))
  const actItems = (date: string): PlanItem[] => {
    if (!act) return []
    const picks = actPicks(act, { date, dow: isoDow(date), mode: dayMode(data.planning, date), studyMinutes: 0, actTaskMin: actTaskMinutes(data.tasks, date, act.subjectId) })
    return [
      ...picks.map((p): PlanItem => ({ title: p.title, minutes: p.minutes, kind: p.heavy ? 'focus' : 'light', ref: null, why: ACT_WHY, subject: 'ACT',
        ...(p.after ? { after: picks.find((x) => x.key === p.after)?.title } : {}) })),
      ...actTasksOn(data.tasks, date, act.subjectId).map((t): PlanItem => ({ title: t.title, minutes: t.duration_minutes ?? 30, kind: 'focus', ref: { kind: 'task', id: t.id }, why: ACT_WHY, subject: 'ACT' })),
    ]
  }
  // what may go on each day (lib/today/focus.ts): not before a task's start date, Later only if due this week, a focus
  // period's own work only, nothing but the test on a test day (light the day before), never an App idea; the study
  // tracker's "pause physics until …" / "focus on ACT until …" rules count the same
  const { ideas, tracker } = await planLimits(sb, w.from, w.to)
  // (a test the day after the week counts too: its eve is in the week)
  const schoolTo = schoolDays(w.events, w.changes, w.from, addDays(w.to, 1), w.settings.schoolFreePeriods)
  const tests = testDays(data.goals, (date) => schoolTo.has(date))
  const rulesOf = (date: string) => dayRules(data.planning, tests, date, tracker)
  const taskOf = (it: PlanItem) => (it.ref?.kind === 'task' ? data.tasks.find((t) => t.id === it.ref!.id) ?? null : null)
  const subjectOf = (it: PlanItem) => it.subject ?? (isAct(it) ? 'ACT' : maths.subjects.find((s) => s.id === taskOf(it)?.subject_id)?.name ?? null)
  const ofTest = (it: PlanItem, date: string) => {
    const title = tests.get(date) ?? tests.get(addDays(date, 1))
    const g = title ? data.goals.find((x) => x.kind === 'test' && x.title === title) : null
    return !!g && ((/\bACT\b/.test(g.title) && isAct(it)) || (!!g.subject_id && taskOf(it)?.subject_id === g.subject_id) || it.title.toLowerCase().includes(g.title.toLowerCase()))
  }
  const blockedOn = (it: PlanItem, date: string) => {
    const t = taskOf(it)
    return blockedWhy({ title: it.title, subject: subjectOf(it), heavy: it.kind === 'focus' || it.kind === 'training', task: t, deadline: t ? deadlineOf(t) : null, ofTest: ofTest(it, date) }, date, rulesOf(date), { until: w.to, ideas })
  }
  // the spec's order for what's left (my-spec 40): deadlines → tests and prep → training → this week's priorities → the rest
  const rankOf = (it: PlanItem) => {
    const t = taskOf(it), due = t ? deadlineOf(t) : null
    if (it.kind === 'rest') return 9
    if ((due && due <= w.to) || /^📝 /.test(it.title)) return 1
    if (it.ref?.kind === 'goal' || t?.goal_id || /^🔥 /.test(it.title) || (it.why === ACT_WHY && !!act?.retake)) return 2
    if (it.kind === 'training') return 3
    if ((t && (t.status === 'today' || t.status === 'this_week' || t.is_key)) || ['topic', 'mistake', 'target'].includes(it.ref?.kind ?? '')) return 4
    return 5
  }
  if (!studyItems) {
    // the planner only sees the days it can add to (a day that's only ACT or only the test has nothing to pick)
    const open = days.filter((d) => { const r = rulesOf(d.date); return !r.test && !(r.focus && /^act$/i.test(r.focus.only)) })
    const res = open.length
      ? await makeWeekPlan({ days: open, words: `${words}\nStudy preferences: best focus time ${more.focusBest}; study blocks at most ${more.maxBlockMin} minutes.\nMaths and Further Maths (their homework, tests and topics) are planned by the app itself: don't add any maths or further maths items.\nACT (its practice tests, sections, misses and his ACT tasks) is planned by the app itself: don't add any ACT items.${rulesForAI(open.map((d) => d.date), rulesOf, data.tasks, w.to)}`, previous: opts.previous ?? null }, ctx, opts.onUsage)
      : { ok: true as const, days: [], note: '', pushBack: '', dropped: 0 }
    if (!res.ok) return { message: `⚠️ ${res.error} Nothing planned.` }
    const gameDays = new Set(plan.days.filter((d) => d.sessions.some((x) => x.fixed && /game|match/i.test(x.title))).map((d) => d.date))
    // maths goes on the days it may (not a focus period on something else, a test day or its eve, nor before its homework can start)
    const startOf = (id: string) => data.tasks.find((t) => t.id === id) ?? {}
    const mathsFree = { ...maths, tasks: maths.tasks.filter((t) => !notYet(startOf(t.id), w.to)) }
    const mode = modeOf(mathsFree)
    const mathsOff = (date: string) => { const r = rulesOf(date); return !!r.test || !!r.eve || (!!r.focus && !/math|^fm$/i.test(r.focus.only)) || !!r.paused?.some((p) => p.names.some((n) => /math|^fm$/i.test(n))) || (mode.kind === 'homework' && notYet(startOf(mode.tasks[0].id), date)) }
    const mb = weekBlocks(mathsFree, days.map((d) => ({ date: d.date, skip: gameDays.has(d.date) || mathsOff(d.date) })))
    studyItems = days.map((d) => ({ date: d.date, items: [
      ...(mb.get(d.date) ?? []).map((b): PlanItem => ({ title: b.title, minutes: b.minutes, kind: 'focus', ref: b.taskId ? { kind: 'task', id: b.taskId } : null, why: b.why, subject: b.course?.name ?? null })),
      ...actItems(d.date),
      ...(res.days.find((x) => x.date === d.date)?.items ?? []).filter((it) => !isMaths(it) && !isAct(it)),
    ] }))
    note = res.note; pushBack = res.pushBack
  }
  const blocks: Block[] = plan.placed.map(blockOf)
  const unplaced: PlanPayload['unplaced'] = []
  for (const d of days) {
    const r = rulesOf(d.date)
    // one block per task a day (or per title), in the spec's order; what can't go on this day is left out
    const seen = new Set<string>()
    const kept = [...(studyItems.find((x) => x.date === d.date)?.items ?? [])].map((it, i) => ({ it, i })).sort((a, b) => rankOf(a.it) - rankOf(b.it) || a.i - b.i).map((x) => x.it)
      .filter((it) => { const k = it.ref?.kind === 'task' ? `task:${it.ref.id}` : normTitle(it.title); if (seen.has(k)) return false; seen.add(k); return !blockedOn(it, d.date) })
    // a focus period on ACT: the free time left goes to ACT (reading, grammar, ACT maths), after everything else
    const fill = actFillDay(r) ? actFillers(more.maxBlockMin).filter((f) => !kept.some((it) => normTitle(it.title) === normTitle(f.title))) : []
    // (an ACT block keeps its length: a full timed test is one sitting; its minutes come on top of the day's focus limit)
    const all = [...kept, ...fill].map((it) => ({ ...it, minutes: isAct(it) ? it.minutes : Math.min(it.minutes, more.maxBlockMin) }))
    const actMin = all.filter((it) => isAct(it) && it.kind === 'focus' && it.why !== ACT_FILL_WHY).reduce((n, it) => n + it.minutes, 0)
    // never plan a task on a day after its deadline
    const late = all.filter((it) => it.ref?.kind === 'task' && (() => { const r = [...ctx.refs.values()].find((x) => x.id === it.ref!.id); return !!r?.deadline && r.deadline < d.date })())
    unplaced.push(...late.map((it) => ({ title: it.title, minutes: it.minutes, reason: 'that’s after its deadline', date: d.date })))
    const placed = placeItems(all.filter((it) => !late.includes(it)), slots.get(d.date) ?? [], w.settings, { budget: d.budget == null ? null : d.budget + actMin, energy: d.energy })
    blocks.push(...placed.blocks.filter((b) => planProblems([b], slots.get(d.date) ?? [], w.settings, null).length === 0).map((b) => ({ ...b, date: d.date })))
    // (ACT free-time blocks are only there if there's room: never "didn't fit")
    unplaced.push(...placed.unplaced.filter((u) => !fill.some((f) => f.title === u.title)).map((u) => ({ ...u, date: d.date })))
  }
  blocks.sort((a, b) => (a.date! + a.start).localeCompare(b.date! + b.start))

  // each day: 🧠 with the planned study, 💪 from the optimiser, school, events, routines
  const mental = mentalDays({ from: w.from, to: w.to, planning: data.planning, events: w.events, changes: w.changes, goals: data.goals, tasks: data.tasks,
    blocks: blocks.map((b) => ({ on_date: b.date!, start_time: b.start, end_time: b.end, kind: b.kind, title: b.title })), overrides: await loadMentalOverrides(sb) })
  const ydays: YourWeekDay[] = []
  const schoolOf = schoolDays(w.events, w.changes, w.from, w.to, w.settings.schoolFreePeriods)
  for (let d = w.from; d <= w.to; d = addDays(d, 1)) {
    if (d < w.today) continue
    const sd = schoolOf.get(d)
    const all = expandEvents(w.events, d, d, w.changes).filter((o) => o.date === d && !o.cancelled && o.start && !(o.event.external_source === 'google' && isBackground(o.event)))
    const occ = all.filter((o) => !sd?.hidden.has(o.key))
    const school = all.filter((o) => isSchool(o.event) && o.event.is_busy && o.end)
    const shape = data.shapes.get(d)
    const m = mental.find((x) => x.date === d), p = plan.days.find((x) => x.date === d)
    ydays.push({
      date: d, mental: m?.level ?? 'low', mentalTotal: m?.total ?? 0, physical: p?.level ?? 'rest', physicalTotal: p?.total ?? 0,
      school: sd ? sd.end : school.length ? school.map((o) => o.end!).sort().at(-1)! : null, schoolFrom: sd?.start ?? null, windows: sd?.windows ?? [],
      events: occ.filter((o) => !isSchool(o.event)).map((o) => ({ start: o.start!, title: `${o.event.title}${o.end ? ` (to ${o.end})` : ''}` })),
      wake: shape?.wake ?? more.wakeAt, bed: shape?.bed ?? more.bedAt, nightStart: shape?.nightStart ?? more.bedAt, why: shape?.why ?? [], wakeWhy: shape?.wakeWhy ?? null, bedWhy: shape?.bedWhy ?? null,
    })
  }
  const guesses = guessList(data.planning, plan.placed.some((x) => x.guess))
  const t = plan.upper?.count
  const upperT = activeSessions(data.planning).find((s) => s.key === 'upper')?.target
  const upperTarget = t != null && upperT ? w.targets.find((x) => x.name.toLowerCase() === upperT.toLowerCase()) : null
  const info: TrainingInfo = {
    named: [], only: null, upperCount: opts.upperCount ?? null, needs: plan.needs.map((n) => ({ key: n.key, title: n.title, type: n.type, load: n.intensity === 'heavy' ? 'hard' : n.intensity, minutes: n.minutes })),
    days: plan.days, notes: plan.notes, sent: [], games: [], tbc: plan.tbc, pins: opts.pins ? Object.fromEntries(opts.pins) : undefined, upper: plan.upper, compare: plan.compare,
    left: opts.left ?? [],
  }
  const yourWeek: YourWeek = {
    review: opts.review ?? [], recs: opts.recs ?? [], days: ydays, training: info, studyItems, guesses,
    rules: await weekRulesLine(sb, w.from, w.to).catch(() => null), focus: focusLines(data.planning, data.tasks, w.from, w.to),
    upperTarget: upperTarget && t != null && t !== upperTarget.target_count ? { id: upperTarget.id, count: t } : null,
  }
  return { payload: { date: w.from, week: { from: w.from, to: w.to }, energy: 'normal', energyGiven: false, blocks, unplaced, tbc: plan.tbc, note, pushBack, yourWeek } as PlanPayload }
}

/**
 * What limits planning besides his settings: his open App ideas (requests for Claude Code, never planned as work) and
 * the study tracker's live rules for these days (plan_rules); his subjects' names (a rule or focus names a subject).
 * None before speed.sql / on an error. (Your week, plan my day)
 */
export async function planLimits(sb: SupabaseClient, from: string, to: string): Promise<{ ideas: { request: string; source_text: string | null }[]; tracker: TrackerRule[]; subjects: { id: string; name: string }[] }> {
  const [ideas, rules, subjects] = await Promise.all([
    sb.from('app_ideas').select('request,source_text').eq('status', 'open').then((r) => (r.error ? [] : (r.data ?? []) as { request: string; source_text: string | null }[]), () => []),
    sb.from('plan_rules').select(RULE_COLS).is('archived_at', null).lte('starts_on', to).gte('ends_on', from)
      .then((r) => (r.error ? [] : ((r.data ?? []) as Record<string, unknown>[]).map(ruleOf)), () => []),
    sb.from('subjects').select('id,name').then((r) => (r.error ? [] : (r.data ?? []) as { id: string; name: string }[]), () => []),
  ])
  return { ideas, tracker: rules, subjects }
}

const normTitle = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** What the plan still guesses (wake/bed/routines, session lengths, travel): said once at the bottom. */
function guessList(planning: unknown, travelGuess: boolean): string[] {
  const o = (planning && typeof planning === 'object' ? planning : {}) as Record<string, unknown>
  const out: string[] = []
  if (!('wakeAt' in o) || !('bedAt' in o)) out.push('wake-up and bedtime')
  if (!('morningMin' in o) || !('nightMin' in o)) out.push('routine lengths')
  if (activeSessions(planning).some((s) => s.minutes == null)) out.push('session lengths')
  if (travelGuess || activePlaces(planning).some((p) => p.key !== 'home' && p.access !== 'school' && (p.fromHome == null || p.toHome == null))) out.push('some travel times')
  return out
}

// ---------------------------------------------------------------------------
// Last week in 2–3 lines
// ---------------------------------------------------------------------------

/** What went well and what slipped in the week before `from` (sessions done, load, sleep, unticked blocks, overdue). */
export async function weekReview(sb: SupabaseClient, data: ViewData, from: string): Promise<string[]> {
  const start = isoDow(from) === 1 ? addDays(from, -7) : weekStartISO(addDays(from, -7))
  const end = addDays(start, 6) < data.today ? addDays(start, 6) : addDays(data.today, -1)
  const [blocks, logs, whoop] = await Promise.all([
    sb.from('plan_blocks').select('on_date,title,kind,status,task_id').gte('on_date', start).lte('on_date', end).in('status', ['planned', 'done']).then((r) => (r.error ? [] : r.data ?? []) as { on_date: string; title: string; kind: string; status: string; task_id?: string | null }[]),
    sb.from('target_logs').select('done_on,amount').gte('done_on', start).lte('done_on', end).then((r) => (r.error ? [] : r.data ?? []) as { done_on: string; amount: number }[]),
    sb.from('whoop_days').select('sleep_minutes,recovery').gte('on_date', start).lte('on_date', end).then((r) => (r.error ? [] : r.data ?? []) as { sleep_minutes: number | null; recovery: number | null }[]),
  ])
  const training = blocks.filter((b) => b.kind === 'training')
  const done = training.filter((b) => b.status === 'done').length
  const logged = logs.reduce((a, l) => a + l.amount, 0)
  const sleep = whoop.filter((x) => x.sleep_minutes != null)
  const good: string[] = []
  if (training.length) good.push(`${done}/${training.length} sessions done`)
  else if (logged) good.push(`${logged} session${logged === 1 ? '' : 's'} logged`)
  if (sleep.length) { const avg = Math.round(sleep.reduce((a, x) => a + x.sleep_minutes!, 0) / sleep.length); good.push(`sleep ${Math.floor(avg / 60)}h ${String(avg % 60).padStart(2, '0')}m a night`) }
  const rec = whoop.filter((x) => x.recovery != null)
  if (rec.length) good.push(`recovery ${Math.round(rec.reduce((a, x) => a + x.recovery!, 0) / rec.length)}% avg`)
  // (a block for a task he has since done or archived didn't slip: data.tasks holds only the open ones)
  const open = new Set(data.tasks.filter((t) => !t.archived_at && t.status !== 'completed').map((t) => t.id))
  const missed = blocks.filter((b) => b.status === 'planned' && (!b.task_id || open.has(b.task_id)))
  const overdue = data.tasks.filter((t) => !t.archived_at && t.status !== 'completed' && t.importance === 'must' && t.status !== 'someday' && t.due_at && t.due_at.slice(0, 10) < data.today)
  // (an overdue task with a missed block is said once)
  const slipped = [...missed.map((b) => `${parseSessionTitle(b.title).name} (${dowShort(b.on_date)})`), ...overdue.filter((t) => !missed.some((b) => b.task_id === t.id)).map((t) => t.title)]
  const lines: string[] = []
  lines.push(good.length ? `✅ <b>Last week</b>: ${esc(good.join(' · '))}` : '✅ <b>Last week</b>: nothing tracked yet (tick sessions on the pinned Today and this fills in)')
  if (slipped.length) lines.push(`⚠️ <b>Slipped</b>: ${esc(slipped.slice(0, 3).join(', '))}${slipped.length > 3 ? ` (+${slipped.length - 3} more)` : ''}`)
  void whoopWords
  return lines
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export function yourWeekText(p: PlanPayload, today: string): string {
  const y = p.yourWeek!
  const t = y.training
  const lines = [`🗓 <b>Your week</b> · ${day(p.week!.from)} – ${day(p.week!.to)}`]
  lines.push(...y.review)
  if (y.rules) lines.push(y.rules)
  for (const f of y.focus ?? []) lines.push(esc(f))
  for (const r of y.recs.slice(0, 2)) lines.push(`💡 ${esc(r)}`)
  const first = y.days[0]
  if (first) lines.push(`<i>☀️ Wake ${first.wake} + morning routine · 🌙 night routine from ${first.nightStart}, bed ${first.bed}${y.guesses.includes('wake-up and bedtime') ? ' (guess)' : ''}; earlier before tests and games.</i>`)
  for (const d of y.days) {
    const head = `<b>${d.date === today ? 'Today' : dowShort(d.date)}</b> 🧠${DOT[d.mental]} 💪${PDOT[d.physical]}${d.school && !d.schoolFrom ? ` · 🏫 to ${d.school}` : ''}${d.wakeWhy ? ` · ☀️ ${d.wake} (${esc(d.wakeWhy)})` : ''}${d.bedWhy ? ` · 🌙 ${d.nightStart} (${esc(d.bedWhy)})` : ''}`
    const items: { at: string; line: string }[] = []
    for (const e of d.events) items.push({ at: e.start, line: `${e.start} ${esc(e.title)}` })
    for (const b of p.blocks.filter((x) => x.date === d.date)) {
      // one short reason per session (not for the stretching units)
      const why = b.why && !/^Stretching\b/.test(b.title) ? `\n     <i>↳ ${esc(shortWhy(b.why))}</i>` : ''
      if (b.kind === 'training') items.push({ at: b.start, line: `${b.start} 🏋️ ${esc(b.title)}${b.intensity && b.intensity !== 'heavy' ? ` · ${b.intensity}` : ''}${b.leave ? ` <i>(leave ${b.from === 'school' ? 'school ' : ''}${b.leave})</i>` : ''}${why}` })
      else items.push({ at: b.start, line: `${b.start} ${b.kind === 'focus' ? '📚' : '•'} ${esc(b.title)} <i>${minutesOf(b.end) - minutesOf(b.start)}m</i>` })
    }
    // school as one line, with its free periods, break and lunch (and anything planned in them) under it
    const body = withSchool(d.schoolFrom && d.school ? { start: d.schoolFrom, end: d.school, windows: d.windows ?? [] } : undefined, items)
    lines.push(head, ...(body.length ? body.map((x) => `  ${x}`) : ['  <i>free</i>']))
  }
  if (t.tbc.length) lines.push(`<i>Not placed: ${esc(t.tbc.map((x) => `${x.title} (${x.reason})`).join('; '))}</i>`)
  if (p.unplaced.length) lines.push(`<i>Didn’t fit: ${esc(p.unplaced.map((u) => `${u.title}${u.date ? ` (${dowShort(u.date)})` : ''}`).slice(0, 4).join('; '))}</i>`)
  if (t.upper) lines.push(`💪 <i>Upper ${esc(t.upper.reason)}</i>`)
  if (t.compare) lines.push(`<i>${esc(t.compare)}</i>`)
  if (p.note) lines.push(esc(p.note))
  if (p.pushBack) lines.push(`🤔 ${esc(p.pushBack)}`)
  for (const n of t.notes) lines.push(`⚠️ ${esc(n)}`)
  if (y.guesses.length) lines.push(`<i>Still guessing: ${esc(y.guesses.join(', '))}. Answer my questions and the plan updates.</i>`)
  lines.push('<i>🧠 mental · 💪 physical load. ✅ adds it all to your plan and Life OS; 🔁 moves a session (the rest re-fits), or say “upper Sat at PureGym”.</i>')
  return lines.join('\n')
}

/** A session's reason, short enough for a phone line: the first two parts, without the place (it's in the title). */
const shortWhy = (why: string) => {
  const parts = why.split(' · ').filter((x) => !/^(School gym|PureGym|Owen|home)\b/i.test(x) && !/^(low|med|high) day$/.test(x))
  // the good reasons first; a load warning is marked as one
  const warn = (x: string) => /over (its|the) load limit/.test(x)
  const ordered = [...parts.filter((x) => !warn(x)), ...parts.filter(warn).map((x) => `⚠️ ${x}`)]
  const out = ordered.slice(0, 2).join(' · ')
  return out.length > 90 ? `${out.slice(0, 88)}…` : out || why.slice(0, 60)
}

export const yourWeekButtons = (id: string, p: PlanPayload): Button[][] => {
  const rows: Button[][] = [[{ text: '✅ Apply', callback_data: `a:${id}` }, { text: '❌ Cancel', callback_data: `x:${id}` }]]
  const per = p.blocks.map((b, i) => ({ b, i })).filter(({ b }) => b.kind === 'training' && !/^Stretching\b/.test(b.title))
    .map(({ b, i }): Button => ({ text: `🔁 ${dowShort(b.date!)} ${parseSessionTitle(b.title).name}`.slice(0, 40), callback_data: `o:${id}:s${i}` }))
  for (let i = 0; i < per.length; i += 2) rows.push(per.slice(i, i + 2))
  return rows
}

// ---------------------------------------------------------------------------
// Sending it (and changing it)
// ---------------------------------------------------------------------------

type Card = { id: string; payload: PlanPayload & { card_message_id?: number | null } }

/** Plan the week and send the card. `replaces`: a Your week card being changed (his words, or a 🔁). */
export async function proposeYourWeek(sb: SupabaseClient, chatId: number, words: string, ctx: PlannerContext, data: ViewData,
  opts: { replaces?: Card | null; onReplace?: () => Promise<void>; head?: string; pins?: Map<string, Pin>; auto?: boolean; range?: { from: string; to: string }
    asked?: boolean } = {}): Promise<string | null> {
  const { noteWeek } = await import('./trainplan')
  if (looksLikeWeek(words)) await noteWeek(sb, chatId, words, data, { quiet: true })   // his week typed out: read it first
  // "plan next week" works any day (on a Wednesday too): next Mon–Sun, else the card's week, else the rest of this one
  // (`asked`: the bot read his message as "plan the week", so "next week" anywhere in it is enough)
  const range = opts.range ?? weekAsked(words, data.today, opts.asked) ?? (opts.replaces?.payload.week ?? weekRange(data.today))
  // the card being changed, if it's for the same week (a different week is a fresh plan)
  const was = opts.replaces?.payload.week?.from === range.from ? opts.replaces?.payload.yourWeek ?? null : null
  const prevBlocks = was ? opts.replaces?.payload.blocks ?? [] : []
  const said = was ? parsePins(words, prevBlocks.map((b, i) => ({ key: b.key ?? `b${i}`, title: b.title, date: b.date!, type: '' })).filter((b) => b.key.includes('#')), range.from, range.to, activePlaces(data.planning)) : new Map<string, Pin>()
  const upper = upperWords(words)
  const pins = opts.pins ?? new Map([...Object.entries(was?.training.pins ?? {}), ...said])
  // a change to the card re-fits it in code: the study the planner picked is kept (moved or left out as he says);
  // the planner AI only runs for a fresh plan ("re-plan the week", a new week, no card)
  const refit = !!was && !FRESH.test(words)
  // (a study change the code can't read for sure goes to the planner AI with the card as before, never guessed)
  const read = refit ? editStudy(was!.studyItems, words, range) : null
  const edit = read?.unclear ? null : read
  const review = was?.review ?? await weekReview(sb, data, range.from)
  const recs = was?.recs ?? await recommendations(sb, data, range).then((r) => r.slice(0, 2).map((x) => x.short)).catch(() => [])
  const built = await buildYourWeek(sb, data, ctx, words, {
    range, pins, upperCount: upper ?? was?.training.upperCount ?? null, left: was?.training.left ?? [], studyItems: edit ? edit.items : null,
    previous: was ? opts.replaces?.payload.summary ?? null : null, review, recs, onUsage: (model, usage) => recordUsage(sb, 'plan', model, usage),
  })
  if ('message' in built) { await say(sb, chatId, esc(built.message), undefined, { intent: 'plan' }); return null }
  if (edit && !edit.said.length && !said.size && upper == null) built.payload.note = [built.payload.note, 'Re-fitted with the same study picks (say “re-plan the week” for new ones).'].filter(Boolean).join(' ')
  const head = opts.head ?? (edit?.said.length ? `✏️ <b>Changed</b>: ${esc(edit.said.join('; '))}\n` : undefined)
  return sendYourWeek(sb, chatId, built.payload, words || 'your week', data.today, { replaces: opts.replaces ?? null, onReplace: opts.onReplace, head })
}

/** Words that ask for a fresh plan (the planner AI picks again) rather than a change to the card. */
const FRESH = /\b(?:re-?plan|plan (?:my|the|this|next) week|plan (?:it |everything )?(?:again|from scratch)|start (?:over|again)|from scratch|(?:new|fresh|different) (?:plan|picks)|pick again)\b/i

/**
 * "plan next week" / "next week's plan" (any day of the week): next Mon–Sun. null: not asked. `planWeek`: the message
 * is already a request to plan a week ("for next week can you sort my plan", "next week: plan it with Vlad on Monday"),
 * so "next week" anywhere is enough (not with "this week" too).
 */
export function weekAsked(words: string, today: string, planWeek = false): { from: string; to: string } | null {
  const loose = planWeek && /\bnext week\b/i.test(words) && !/\bthis week\b/i.test(words)
  if (!loose && !/\b(?:plan|re-?plan|planning|sort|organi[sz]e)\b(?:(?!\bweek\b)[^.?!\n]){0,25}\bnext week\b|\bnext week['’]?s plan\b/i.test(words)) return null
  const mon = addDays(weekStartISO(today), 7)
  return { from: mon, to: addDays(mon, 6) }
}

const DOWS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const DAY_RE = /\b(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b/gi
const STOP = new Set(['the', 'my', 'on', 'to', 'move', 'put', 'nothing', 'skip', 'drop', 'free', 'off', 'not', 'study', 'plan', 'please', 'day', 'keep', 'instead',
  'from', 'and', 'for', 'any', 'all', 'it', 'this', 'that', 'week', 'with', 'at', 'of', 'do', 'dont', 'can', 'you', 'there', 'want', 'have', 'only', 'leave', 'make', 'into'])

/** His short names for subjects (kept although they're short): what each one also matches in an item's subject. */
const ALIAS: Record<string, string[]> = { fm: ['further maths'], cs: ['computer science'], act: ['act'], smc: ['smc'], phys: ['physics'], ht2: [] }
/** Training words: the optimiser's (parsePins / upperWords), never a study change. */
const TRAIN = /\b(?:upper|lower|gym|training|train|speed|owen|plyo|core|sessions?|football|game|match|lift|lifting|workout)\b/i
const DAY_W = '(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?'
const MOVE = new RegExp(`\\b(?:move|put|shift|swap|instead)\\b|\\b(?:to|onto)\\s+${DAY_W}\\b`, 'i')
const NEG = /\b(?:no|nothing|skip|drop|free|off|not|don['’]?t|cancel|remove)\b/i
const ON_DAY = new RegExp(`\\bon\\s+${DAY_W}\\b`, 'i')
/** "don't put FM on Friday" is a no, not a move */
const DONT_MOVE = /\b(?:don['’]?t|do not|never)\s+(?:move|put)\b/i

/**
 * Small study changes by code, on the planner's picks (no AI): "nothing on Friday" / "keep Fri free" (that day's study
 * goes), "no FM on Thu" (just that), "physics homework to Sat" / "move physics from Mon to Thu" / "physics to Thu, not
 * Mon" (moved there, from the day he named, else the nearest day it's on). `said`: what changed, in words.
 * `unclear`: a change named a day but the code couldn't tell what it's about (the caller asks the planner AI instead).
 */
export function editStudy(items: YourWeek['studyItems'], words: string, range: { from: string; to: string }): { items: YourWeek['studyItems']; said: string[]; unclear: boolean } {
  const out = items.map((d) => ({ date: d.date, items: [...d.items] }))
  const said: string[] = []
  let unclear = false
  const dateOf = (w: string) => { const i = DOWS.indexOf(w.slice(0, 3).toLowerCase()); for (let d = range.from; d <= range.to; d = addDays(d, 1)) if (isoDow(d) === i + 1) return d; return null }
  const dayOf = (date: string) => { let d = out.find((x) => x.date === date); if (!d && date >= range.from && date <= range.to) { d = { date, items: [] }; out.push(d); out.sort((a, b) => a.date.localeCompare(b.date)) } return d ?? null }
  const keyOf = (it: PlanItem) => (it.ref?.kind === 'task' ? `task:${it.ref.id}` : normTitle(it.title))
  // what a change is about: his words for the work (short subject names like FM, ACT, CS kept)
  const aboutOf = (part: string) => part.replace(DAY_RE, ' ').split(/[^A-Za-z0-9’']+/).filter(Boolean)
    .map((raw) => ({ raw, w: normTitle(raw).replace(/ /g, '') }))
    .filter(({ raw, w }) => !!w && !STOP.has(w) && (w.length >= 3 || w in ALIAS || /^[A-Z0-9]{2,}$/.test(raw))).map((x) => x.w)
  const hitsOf = (about: string[]) => (it: PlanItem) => it.kind !== 'rest' && it.kind !== 'training' && (!about.length || about.some((a) => {
    const subject = normTitle(it.subject ?? '')
    return normTitle(it.title).split(' ').includes(a) || subject === a || subject.split(' ').includes(a) || (ALIAS[a] ?? []).includes(subject)
  }))
  const daysIn = (part: string) => [...part.matchAll(DAY_RE)].map((m) => ({ date: dateOf(m[1]), at: m.index! })).filter((x): x is { date: string; at: number } => !!x.date)
  // (a part without a day goes with the next one: "move physics and FM to Sat")
  const parts: string[] = []
  let carry = ''
  for (const p of words.split(/[.;,\n]|\band\b|\bbut\b/i)) {
    if (!p.trim()) continue
    if (!daysIn(p).length) { carry += ` ${p}`; continue }
    parts.push(`${carry} ${p}`.trim()); carry = ''
  }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (TRAIN.test(part)) continue
    const days = daysIn(part)
    const about = aboutOf(part)
    const hits = hitsOf(about)
    // a move ("FM to Sat", "physics on Thu"), unless he says not to ("don't put FM on Friday" is a no)
    const dontMove = DONT_MOVE.test(part)
    const isMove = !dontMove && (MOVE.test(part) || (!NEG.test(part) && about.length > 0 && ON_DAY.test(part)))
    if (isMove) {
      if (!about.length) { unclear = true; continue }
      // from: a day after "from" / "instead of" / "not" (here or in a bare "not Mon" right after); to: the day after
      // "to" / "on", else the first other day named
      const fromRe = new RegExp(`\\b(?:from|instead of|not|rather than|off)\\s+(?:on\\s+)?${DAY_W}\\b`, 'gi')
      const from = new Set([...part.matchAll(fromRe)].map((m) => dateOf(m[1])).filter((d): d is string => !!d))
      const next = parts[i + 1]
      if (next && !aboutOf(next).length && /^\s*(?:not|instead of|rather than)\b/i.test(next)) { for (const d of daysIn(next)) from.add(d.date); i++ }
      const m = part.match(new RegExp(`\\b(?:to|onto|on)\\s+${DAY_W}\\b`, 'i'))
      const to = (m ? dateOf(m[1]) : null) ?? days.find((d) => !from.has(d.date))?.date ?? null
      const target = to ? dayOf(to) : null
      if (!to || !target) { unclear = true; continue }
      // (no day named to move it from: the nearest day it's on, never every day)
      const sources = from.size ? [...from].filter((d) => d !== to)
        : out.filter((d) => d.date !== to && d.items.some(hits)).map((d) => d.date)
          .sort((a, b) => Math.abs(Date.parse(a) - Date.parse(to)) - Math.abs(Date.parse(b) - Date.parse(to)) || a.localeCompare(b)).slice(0, 1)
      const moved: string[] = []
      for (const date of sources) {
        const d = out.find((x) => x.date === date)
        const moving = d?.items.filter(hits) ?? []
        if (!d || !moving.length) continue
        d.items = d.items.filter((it) => !moving.includes(it))
        // (one block per task a day: already there = just taken off the other day)
        for (const it of moving) { if (!target.items.some((x) => keyOf(x) === keyOf(it))) target.items.push(it); if (!moved.includes(it.title)) moved.push(it.title) }
      }
      if (!moved.length) { unclear = true; continue }
      said.push(`${moved.join(', ')} → ${dowShort(to)}`)
    } else if (NEG.test(part) || dontMove) {
      let any = false
      for (const { date } of days) {
        const d = out.find((x) => x.date === date)
        const gone = d?.items.filter(hits) ?? []
        if (!d || !gone.length) continue
        any = true
        d.items = d.items.filter((it) => !gone.includes(it))
        said.push(`${about.length ? gone.map((it) => it.title).join(', ') : 'study'} off ${dowShort(date)}`)
      }
      // (work the code doesn't know at all: not a guess at something else; known work that isn't on that day: nothing to do)
      if (!any && about.length && !out.some((d) => d.items.some(hits))) unclear = true
    } else if (about.length) unclear = true
  }
  return { items: out, said, unclear }
}

async function sendYourWeek(sb: SupabaseClient, chatId: number, payload: PlanPayload, words: string, today: string, opts: { replaces?: Card | null; onReplace?: () => Promise<void>; head?: string } = {}): Promise<string> {
  const body = yourWeekText(payload, today)
  payload.summary = plain(body).slice(0, 3000)
  if (opts.replaces) payload.replaces = opts.replaces.id
  const { data: row, error } = await sb.from('telegram_pending').insert({ kind: 'plan', text: words.trim().slice(0, 500) || 'your week', payload }).select('id').single()
  if (error || !row) throw new Error(`Couldn’t hold the plan: ${error?.message ?? 'not saved'}`)
  await opts.onReplace?.()
  if (opts.replaces) {
    await sb.from('telegram_pending').update({ status: 'replaced' }).eq('id', opts.replaces.id).in('status', ['open', 'editing'])
    if (opts.replaces.payload.card_message_id) await clearButtons(chatId, opts.replaces.payload.card_message_id).catch(() => null)
  }
  const msgId = await say(sb, chatId, `${opts.head ?? (opts.replaces ? '✏️ <b>Changed</b>\n' : '')}${body}\n\nNothing changes until you tap ✅ Apply.`, yourWeekButtons(row.id, payload), { pending_id: row.id, intent: 'plan' })
  if (msgId) await sb.from('telegram_pending').update({ payload: { ...payload, card_message_id: msgId } }).eq('id', row.id)
  return row.id as string
}

/** 🔁 picked a new day for one session: the week again with it there; study placed again around it (no AI call). */
export async function pickYourWeekSlot(sb: SupabaseClient, chatId: number, card: Card, pins: Map<string, Pin>, head: string, data: ViewData, ctx: PlannerContext, left: string[] = card.payload.yourWeek?.training.left ?? []) {
  const p = card.payload
  const built = await buildYourWeek(sb, data, ctx, '', { range: p.week!, pins, upperCount: p.yourWeek!.training.upperCount ?? null, left, studyItems: p.yourWeek!.studyItems, review: p.yourWeek!.review, recs: p.yourWeek!.recs })
  if ('message' in built) { await say(sb, chatId, esc(built.message)); return }
  await sendYourWeek(sb, chatId, built.payload, `move ${head}`, data.today, { replaces: card, head: `✏️ ${head}\n` })
}

/** 🔁 → a new day picked (p:<card>:s<i>_<yyyymmdd>_<l|m|h>, or _tbc / _keep): the week again with that session there. */
export async function pickWeekSlot(sb: SupabaseClient, chatId: number, card: Card, arg: string, data: ViewData) {
  const p = card.payload
  const m = arg.match(/^s(\d+)_(?:(\d{8})_([lmh])|(tbc)|(keep))$/)
  const b = m ? p.blocks[Number(m[1])] : null
  if (!m || !b) { await say(sb, chatId, 'That session isn’t on the card any more.'); return }
  if (m[5]) {   // keep: the same card again, with its buttons
    if (p.card_message_id) await clearButtons(chatId, p.card_message_id).catch(() => null)
    const msgId = await say(sb, chatId, `${yourWeekText(p, data.today)}\n\nNothing changes until you tap ✅ Apply.`, yourWeekButtons(card.id, p), { pending_id: card.id, intent: 'plan' })
    if (msgId) await sb.from('telegram_pending').update({ payload: { ...p, card_message_id: msgId } }).eq('id', card.id)
    return
  }
  const pins = new Map(Object.entries(p.yourWeek!.training.pins ?? {}))
  const intensity = ({ l: 'light', m: 'moderate', h: 'heavy' } as const)[m[3] as 'l' | 'm' | 'h']
  if (m[4]) pins.delete(b.key!)
  else pins.set(b.key!, { date: `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}`, intensity })
  const { loadPlannerContext } = await import('../ask/server')
  const ctx = await loadPlannerContext(sb)
  const name = parseSessionTitle(b.title).name
  const left = [...(p.yourWeek!.training.left ?? []), ...(m[4] ? [b.key!] : [])]
  await pickYourWeekSlot(sb, chatId, card, pins, m[4] ? `<b>${esc(name)}</b> → left out this week` : `<b>${esc(name)}</b> → ${day(pins.get(b.key!)!.date!)} (${intensity}); the rest re-fitted`, data, ctx, left)
}
