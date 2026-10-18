// Server-only: the 07:00 morning brief and the "You forgot this" nudges, built from Nat's data by rules
// (no AI, so they're instant and can't invent anything). Read-only.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { nextSessionsOnly, rows } from '../data'
import { expandEvents, timeRange } from '../events'
import { dayOf, loadReminders, reminderWhen, splitReminders } from '../reminders'
import { loadWeekCounts, targetProgress, type WeekCount } from '../targets'
import { deadlineOf, pickToday, sortByDate } from '../tasks'
import { addDays, dowShort, longDate, minutesOf, shortDate, weekStartISO } from '../time'
const PDOT = { rest: '⚪', low: '🟢', med: '🟡', high: '🔴' } as const
import type { EventException, EventRow, Task, TargetLog, WeeklyTarget } from '../types'
import { esc } from './api'
import { loadPlan, type PlanRow } from '../plan'
import { leaveBy, withTravel } from '../travel'
import { loadTravel } from '../travel-data'
import { moreSettings } from '../settings'
import { isLowRecovery, whoopDay, whoopWords } from '../whoop/sync'
import { dueMistakes, nextActions } from '../study'
import { loadStudy } from '../study-data'
import { planningEvents, shapesFor, type DayShape } from '../setup'
import { afterSchoolFirst, dayItems, dayLevel, itemLine, overload, type DayBlock } from '../day'
import { DOT } from '../mental'
import { planningSettings, freeDays } from '../freetime'
import { minus } from '../week'
import { boundsOf, hm, parseSessionTitle } from '../setup'
import type { Button } from './api'
import type { CostRow } from '../load'
import { loadCosts } from '../training-data'

export type DayData = {
  today: string
  tasks: Task[]
  events: EventRow[]
  changes: EventException[]
  targets: WeeklyTarget[]
  logs: TargetLog[]
  weekCounts: WeekCount[]
  plan: PlanRow[]          // today's planned blocks (from "plan my day")
  planning: unknown        // his settings (profiles.planning; lib/settings.ts)
  shapes: Map<string, DayShape>   // each day's wake, routines and bed (lib/setup.ts), from a week ago to 4 weeks ahead
  tests: { title: string; target_date: string }[]   // tests coming up (earlier nights, 🧠 load)
  blocks: DayBlock[]       // today's plan blocks, ticked ones included (the timeline)
  costs: CostRow[]         // his recovery costs (the day's 💪 load)
  goalsLite: { kind: string; title: string; target_date: string | null }[]
}



export async function loadDay(sb: SupabaseClient, today: string): Promise<DayData> {
  const weekStart = weekStartISO(today)
  const [tasks, events, changes, targets, logs, goals, weekCounts, plan, planning, blocks, costs] = await Promise.all([
    sb.from('tasks').select('*').is('archived_at', null).neq('status', 'completed'),
    sb.from('events').select('*').is('archived_at', null),
    sb.from('event_exceptions').select('id,event_id,on_date,cancelled,new_date,new_start,new_end,missed').gte('on_date', addDays(weekStart, -7)).lte('on_date', addDays(today, 14)),
    sb.from('weekly_targets').select('*').eq('is_active', true).order('sort_order'),
    sb.from('target_logs').select('id,target_id,done_on,amount,source,created_at').gte('done_on', weekStart).lte('done_on', addDays(weekStart, 6)),
    sb.from('goals').select('id,kind,title,target_date').is('archived_at', null).or(`target_date.is.null,target_date.gte.${today}`),
    loadWeekCounts(sb, weekStart),
    loadPlan(sb, today),
    sb.from('profiles').select('planning').maybeSingle().then((r) => (r.error ? null : r.data?.planning ?? null)),
    sb.from('plan_blocks').select('id,start_time,end_time,title,kind,task_id,target_id,goal_id,status').eq('on_date', today).in('status', ['planned', 'done']).order('start_time')
      .then((r) => (r.error ? [] : (r.data ?? []) as DayBlock[]).map((b) => ({ ...b, start_time: b.start_time.slice(0, 5), end_time: b.end_time.slice(0, 5) }))),
    loadCosts(sb),
  ])
  const goalRows = rows<{ id: string; kind: string; title: string; target_date: string | null }>(goals, 'goals')
  const live = new Set(goalRows.map((g) => g.id))
  // only the next prep session of each live test, like Home
  const open = nextSessionsOnly(rows<Task>(tasks, 'tasks').filter((t) => !t.is_system || (t.goal_id && live.has(t.goal_id))))
  const ch = rows<EventException>(changes, 'calendar changes')
  const evs = planningEvents(rows<EventRow>(events, 'events'), ch, planning, addDays(weekStart, -7), addDays(today, 28))
  const tests = goalRows.filter((g) => g.kind === 'test' && g.target_date).map((g) => ({ title: g.title, target_date: g.target_date! }))
  return {
    today, tasks: open, events: evs, changes: ch,
    targets: rows<WeeklyTarget>(targets, 'weekly targets'), logs: rows<TargetLog>(logs, 'target progress'), weekCounts, plan, planning,
    shapes: shapesFor(planning, evs, ch, goalRows.map((g) => ({ kind: g.kind as 'test' | 'goal', target_date: g.target_date })), addDays(today, -7), addDays(today, 28)), tests,
    blocks, costs, goalsLite: goalRows,
  }
}

/** "You forgot this": overdue, due today, due tomorrow (Someday never counts). */
export function forgotten(d: DayData) {
  const tomorrow = addDays(d.today, 1)
  const dated = sortByDate(d.tasks.filter((t) => t.status !== 'someday' && deadlineOf(t)))
  return {
    overdue: dated.filter((t) => deadlineOf(t)! < d.today),
    today: dated.filter((t) => deadlineOf(t) === d.today),
    tomorrow: dated.filter((t) => deadlineOf(t) === tomorrow),
  }
}

const item = (t: Task, extra = '') => { const bits = [t.duration_minutes ? `~${t.duration_minutes} min` : '', extra].filter(Boolean); return `• ${esc(t.title)}${bits.length ? ` <i>(${bits.join(' · ')})</i>` : ''}` }

function forgotLines(f: ReturnType<typeof forgotten>, today: string): string[] {
  const out: string[] = []
  if (f.overdue.length) out.push(`<b>Overdue</b>`, ...f.overdue.map((t) => `${item(t)} <i>(was ${dowShort(deadlineOf(t)!)} ${shortDate(deadlineOf(t)!)})</i>`))
  if (f.today.length) out.push(`<b>Due today</b>`, ...f.today.map((t) => item(t)))
  if (f.tomorrow.length) out.push(`<b>Due tomorrow</b> (${dowShort(addDays(today, 1))})`, ...f.tomorrow.map((t) => item(t)))
  return out
}

/** Tick buttons for today's plan blocks (☐ / ✅) and the must-dos due today, two to a row. */
export function tickButtons(blocks: DayBlock[], tasks: Task[], today: string): Button[][] {
  const per: Button[] = blocks.filter((b) => b.kind !== 'rest').map((b) => ({ text: `${b.status === 'done' ? '✅' : '☐'} ${b.start_time.slice(0, 5)} ${parseSessionTitle(b.title).name}`.slice(0, 32), callback_data: `k:${b.id}` }))
  const planned = new Set(blocks.map((b) => b.task_id).filter(Boolean))
  for (const t of tasks.filter((x) => x.importance === 'must' && !planned.has(x.id) && deadlineOf(x) != null && deadlineOf(x)! <= today && x.status !== 'someday').slice(0, 3)) {
    per.push({ text: `☐ ${t.title}`.slice(0, 32), callback_data: `j:${t.id}` })
  }
  const rows: Button[][] = []
  for (let i = 0; i < per.length; i += 2) rows.push(per.slice(i, i + 2))
  return rows
}

export type Brief = { html: string; buttons?: Button[][] }

/** The 07:00 morning brief: the day in time order (routine, school, study, training with place + leave-by, routine), ticks. */
export async function buildBrief(sb: SupabaseClient, d: DayData, now: Date, appUrl: string | null, opts: { note?: string | null } = {}): Promise<Brief> {
  const lines: string[] = [`☀️ <b>${esc(longDate(d.today))}</b>`]
  // Whoop (if connected): this morning's recovery and last night's sleep; low recovery = a lighter day
  const w = await whoopDay(sb, d.today)
  if (w && (w.recovery != null || w.sleep_minutes != null)) {
    const low = isLowRecovery(w, d.planning)
    lines.push('', `${w.recovery == null ? '😴' : low ? '🔴' : w.recovery >= 67 ? '💚' : '🟡'} ${esc(whoopWords({ ...w, strain: null }))}${low ? '\n<i>Low recovery: lighter training today, and protect your sleep tonight.</i>' : ''}`)
  }
  if (opts.note) lines.push('', opts.note)

  const travel = await loadTravel(sb, d.events, d.planning)
  const more = moreSettings(d.planning)
  const free = planningSettings(d.planning)
  const items = dayItems({ date: d.today, events: d.events, changes: d.changes, travel, shape: d.shapes.get(d.today) ?? null, blocks: d.blocks, planning: d.planning, bufferMin: free.bufferMin })
  const level = dayLevel({ date: d.today, planning: d.planning, events: d.events, changes: d.changes, goals: d.goalsLite as never, tasks: d.tasks, blocks: d.blocks, costs: d.costs })
  lines.push('', `📋 <b>Your day</b> · 🧠${DOT[level.mental]} 💪${PDOT[level.physical]}`)
  const over = overload(level, d.blocks, d.tasks, d.planning, d.today)
  let move: Button[] | null = null
  if (over) {
    lines.push(`<i>${esc(over.line)}</i>`)
    if (over.move) move = await moveOffer(sb, d, over.move, travel).catch(() => null)
  }
  lines.push(...items.map((it) => itemLine(it, esc)))
  if (!d.blocks.length) lines.push('<i>No plan for today yet: say “plan my day”.</i>')

  const f = forgotten(d)
  const forgot = forgotLines(f, d.today)
  if (forgot.length) lines.push('', '⚠️ <b>Don’t forget</b>', ...forgot)

  const listed = new Set([...f.overdue, ...f.today, ...f.tomorrow].map((t) => t.id))
  const todo = pickToday(d.tasks, d.today, more.todayMax).filter((t) => !listed.has(t.id))
  if (todo.length) lines.push('', '✅ <b>Also on Today</b>', ...todo.map((t) => item(t, t.importance === 'nice' ? 'nice' : '')))

  // One push-back line (my-spec 44): the task put off most, if it's been put off often enough (setting pushBackAfter).
  const nag = d.tasks.filter((t) => t.status !== 'someday' && t.postpone_count >= more.pushBackAfter)
    .sort((a, b) => b.postpone_count - a.postpone_count || (deadlineOf(a) ?? '9').localeCompare(deadlineOf(b) ?? '9'))[0]
  if (nag) lines.push('', `🤔 “${esc(nag.title)}” has been put off ${nag.postpone_count} times: do it today, or drop it?`)

  // study (step 12): the next step per subject, and mistakes due for review today
  const [study, subs] = await Promise.all([
    loadStudy(sb).catch(() => null),
    sb.from('subjects').select('id,name').is('archived_at', null).order('sort_order').then((r) => (r.data ?? []) as { id: string; name: string }[]),
  ])
  if (study) {
    const next = nextActions(subs, study.stages, study.topics, study.progress, 1)
    const due = dueMistakes(study.mistakes, d.today)
    if (next.length || due.length) {
      lines.push('', '📚 <b>Study next</b>', ...next.map((a) => `• ${esc(a.subject)}: ${esc(a.topic.name)} — ${esc(a.stage.name)}`))
      if (due.length) lines.push(`🧠 Review: ${esc(due.slice(0, 3).map((m) => m.body).join(' · '))}${due.length > 3 ? ` (+${due.length - 3})` : ''}`)
    }
  }

  const week = { events: d.events, changes: d.changes, logs: d.logs, weekStart: weekStartISO(d.today), today: d.today, weekCounts: d.weekCounts }
  const left = d.targets.map((t) => ({ t, ...targetProgress(t, week) })).filter((p) => p.done < p.target)
  if (left.length) lines.push('', `🏃 <b>Targets left this week</b>`, esc(left.map((p) => `${p.t.name} ${p.done}/${p.target}`).join(' · ')))

  const rem = splitReminders(await loadReminders(sb), d.today, now)
  const todays = [...rem.now, ...rem.later.filter((r) => dayOf(r) === d.today)]   // plus time reminders later today
  if (todays.length) lines.push('', '🔔 <b>Remember</b>', ...todays.map((r) => `• ${esc(r.body)}${reminderWhen(r, d.today) ? ` <i>(${esc(reminderWhen(r, d.today))})</i>` : ''}`))

  if (appUrl) lines.push('', `<a href="${esc(appUrl)}">Open Nat OS</a>`)
  const buttons = [...(move ? [move] : []), ...tickButtons(d.blocks, d.tasks, d.today)]
  return { html: lines.join('\n'), buttons: buttons.length ? buttons : undefined }
}

/** "Move it to tomorrow": a one-tap card that moves the easiest block to tomorrow's first free time that fits (✅ = the tap). */
async function moveOffer(sb: SupabaseClient, d: DayData, b: DayBlock, travel: Awaited<ReturnType<typeof loadTravel>>): Promise<Button[] | null> {
  const tomorrow = addDays(d.today, 1)
  const len = minutesOf(b.end_time) - minutesOf(b.start_time)
  const { data: there } = await sb.from('plan_blocks').select('start_time,end_time').eq('on_date', tomorrow).eq('status', 'planned')
  const s = { ...planningSettings(d.planning), dayBounds: boundsOf(d.shapes) }
  const [f] = freeDays(d.events, d.changes, tomorrow, tomorrow, s, d.today, 0, travel)
  const cuts = ((there ?? []) as { start_time: string; end_time: string }[]).map((x) => [minutesOf(x.start_time.slice(0, 5)), minutesOf(x.end_time.slice(0, 5)) + s.bufferMin] as [number, number])
  const slot = afterSchoolFirst(minus(f.slots, cuts), d.events, d.changes, tomorrow).find((x) => minutesOf(x.end) - minutesOf(x.start) >= len && (b.kind !== 'focus' && b.kind !== 'training' || minutesOf(x.start) + len <= minutesOf(s.heavyUntil)))
  if (!slot) return null
  const start = slot.start, end = hm(minutesOf(slot.start) + len)
  const name = parseSessionTitle(b.title).name
  const payload = { date: tomorrow, energy: 'normal', energyGiven: false, add: true, blocks: [], unplaced: [], note: '', pushBack: '', summary: `Move ${name} to tomorrow ${start}`,
    ripple: { moves: [{ blockId: b.id, title: b.title, from: `${dowShort(d.today)} ${b.start_time.slice(0, 5)}`, to: { date: tomorrow, start, end, title: b.title, kind: b.kind }, reason: 'today is overloaded' }], warnings: [], tbc: [] } }
  const { data: row } = await sb.from('telegram_pending').insert({ kind: 'plan', text: `move ${name} to tomorrow`, payload }).select('id').single()
  return row ? [{ text: `↪️ Move ${name} to ${dowShort(tomorrow)} ${start}`.slice(0, 40), callback_data: `a:${row.id}` }] : null
}

/** The 18:00 nudge: only when something overdue, due today or due tomorrow is still open. */
export function buildNudge(d: DayData): string | null {
  const forgot = forgotLines(forgotten(d), d.today)
  return forgot.length ? ['⏰ <b>Before tomorrow, don’t forget</b>', ...forgot].join('\n') : null
}
