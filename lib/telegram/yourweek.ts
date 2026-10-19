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
import { courses as mathsCourses, weekBlocks } from '../maths'
import { mathsWorld } from './views-more'
import { weekRulesLine } from '../tracker/bot-data'
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
  const isAct = (it: PlanItem) => it.why === ACT_WHY || /\bACT\b/.test(it.title)
    || (it.ref?.kind === 'task' && isActTask(data.tasks.find((t) => t.id === it.ref!.id) ?? { title: '', subject_id: null }, act?.subjectId))
  const actItems = (date: string): PlanItem[] => {
    if (!act) return []
    const picks = actPicks(act, { date, dow: isoDow(date), mode: dayMode(data.planning, date), studyMinutes: 0, actTaskMin: actTaskMinutes(data.tasks, date, act.subjectId) })
    return [
      ...picks.map((p): PlanItem => ({ title: p.title, minutes: p.minutes, kind: p.heavy ? 'focus' : 'light', ref: null, why: ACT_WHY })),
      ...actTasksOn(data.tasks, date, act.subjectId).map((t): PlanItem => ({ title: t.title, minutes: t.duration_minutes ?? 30, kind: 'focus', ref: { kind: 'task', id: t.id }, why: ACT_WHY })),
    ]
  }
  if (!studyItems) {
    const res = await makeWeekPlan({ days, words: `${words}\nStudy preferences: best focus time ${more.focusBest}; study blocks at most ${more.maxBlockMin} minutes.\nMaths and Further Maths (their homework, tests and topics) are planned by the app itself: don't add any maths or further maths items.\nACT (its practice tests, sections, misses and his ACT tasks) is planned by the app itself: don't add any ACT items.`, previous: opts.previous ?? null }, ctx, opts.onUsage)
    if (!res.ok) return { message: `⚠️ ${res.error} Nothing planned.` }
    const gameDays = new Set(plan.days.filter((d) => d.sessions.some((x) => x.fixed && /game|match/i.test(x.title))).map((d) => d.date))
    const mb = weekBlocks(maths, days.map((d) => ({ date: d.date, skip: gameDays.has(d.date) })))
    studyItems = days.map((d) => ({ date: d.date, items: [
      ...(mb.get(d.date) ?? []).map((b): PlanItem => ({ title: b.title, minutes: b.minutes, kind: 'focus', ref: b.taskId ? { kind: 'task', id: b.taskId } : null, why: b.why })),
      ...actItems(d.date),
      ...(res.days.find((x) => x.date === d.date)?.items ?? []).filter((it) => !isMaths(it) && !isAct(it)),
    ] }))
    note = res.note; pushBack = res.pushBack
  }
  const blocks: Block[] = plan.placed.map(blockOf)
  const unplaced: PlanPayload['unplaced'] = []
  for (const d of days) {
    // (an ACT block keeps its length: a full timed test is one sitting; its minutes come on top of the day's focus limit)
    const all = (studyItems.find((x) => x.date === d.date)?.items ?? []).map((it) => ({ ...it, minutes: isAct(it) ? it.minutes : Math.min(it.minutes, more.maxBlockMin) }))
    const actMin = all.filter((it) => isAct(it) && it.kind === 'focus').reduce((n, it) => n + it.minutes, 0)
    // never plan a task on a day after its deadline
    const late = all.filter((it) => it.ref?.kind === 'task' && (() => { const r = [...ctx.refs.values()].find((x) => x.id === it.ref!.id); return !!r?.deadline && r.deadline < d.date })())
    unplaced.push(...late.map((it) => ({ title: it.title, minutes: it.minutes, reason: 'that’s after its deadline', date: d.date })))
    const placed = placeItems(all.filter((it) => !late.includes(it)), slots.get(d.date) ?? [], w.settings, { budget: d.budget == null ? null : d.budget + actMin, energy: d.energy })
    blocks.push(...placed.blocks.filter((b) => planProblems([b], slots.get(d.date) ?? [], w.settings, null).length === 0).map((b) => ({ ...b, date: d.date })))
    unplaced.push(...placed.unplaced.map((u) => ({ ...u, date: d.date })))
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
    rules: await weekRulesLine(sb, w.from, w.to).catch(() => null),
    upperTarget: upperTarget && t != null && t !== upperTarget.target_count ? { id: upperTarget.id, count: t } : null,
  }
  return { payload: { date: w.from, week: { from: w.from, to: w.to }, energy: 'normal', energyGiven: false, blocks, unplaced, tbc: plan.tbc, note, pushBack, yourWeek } as PlanPayload }
}

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
    sb.from('plan_blocks').select('on_date,title,kind,status').gte('on_date', start).lte('on_date', end).in('status', ['planned', 'done']).then((r) => (r.error ? [] : r.data ?? []) as { on_date: string; title: string; kind: string; status: string }[]),
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
  const missed = blocks.filter((b) => b.status === 'planned')
  const overdue = data.tasks.filter((t) => t.importance === 'must' && t.status !== 'someday' && t.due_at && t.due_at.slice(0, 10) < data.today)
  const slipped = [...missed.map((b) => `${parseSessionTitle(b.title).name} (${dowShort(b.on_date)})`), ...overdue.map((t) => t.title)]
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
  opts: { replaces?: Card | null; onReplace?: () => Promise<void>; head?: string; pins?: Map<string, Pin>; auto?: boolean; range?: { from: string; to: string } } = {}): Promise<string | null> {
  const { noteWeek } = await import('./trainplan')
  if (looksLikeWeek(words)) await noteWeek(sb, chatId, words, data, { quiet: true })   // his week typed out: read it first
  const was = opts.replaces?.payload.yourWeek ?? null
  const range = opts.range ?? (opts.replaces?.payload.week ?? weekRange(data.today))
  // a change that only moves training ("upper Sat at PureGym", "upper 3x") keeps the study the planner picked
  const prevBlocks = opts.replaces?.payload.blocks ?? []
  const said = was ? parsePins(words, prevBlocks.map((b, i) => ({ key: b.key ?? `b${i}`, title: b.title, date: b.date!, type: '' })).filter((b) => b.key.includes('#')), range.from, range.to, activePlaces(data.planning)) : new Map<string, Pin>()
  const upper = upperWords(words)
  const pins = opts.pins ?? new Map([...Object.entries(was?.training.pins ?? {}), ...said])
  const trainingOnly = !!was && (said.size > 0 || upper != null)
  const review = was?.review ?? await weekReview(sb, data, range.from)
  const recs = was?.recs ?? await recommendations(sb, data, range).then((r) => r.slice(0, 2).map((x) => x.short)).catch(() => [])
  const built = await buildYourWeek(sb, data, ctx, words, {
    range, pins, upperCount: upper ?? was?.training.upperCount ?? null, left: was?.training.left ?? [], studyItems: trainingOnly ? was!.studyItems : null,
    previous: opts.replaces?.payload.summary ?? null, review, recs, onUsage: (model, usage) => recordUsage(sb, 'plan', model, usage),
  })
  if ('message' in built) { await say(sb, chatId, esc(built.message), undefined, { intent: 'plan' }); return null }
  return sendYourWeek(sb, chatId, built.payload, words || 'your week', data.today, { replaces: opts.replaces ?? null, onReplace: opts.onReplace, head: opts.head })
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
