// Server-only: what a change card knocks on (Jarvis D2). The card's changes are applied to a copy of the week in
// memory, the week is worked out again (lib/week.ts), and the differences become part of the same card:
// "Lower: Wed 16:10 → Tue 16:10 (no Lower the day before a sprint)". A clash (a session moved on top of another)
// gives two options instead of one. Nothing is saved until Nat taps.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkinRange } from '../ask/week'
import { DEFAULT_PLANNING } from '../freetime'
import type { Energy } from '../plan'
import type { Rule } from '../training'
import { loadCosts, loadRules, ruleFromRow } from '../training-data'
import { trainingTypes } from '../training'
import { moreSettings } from '../settings'
import { parseSessionTitle } from '../setup'
import { addDays } from '../time'
import { isWeekRow, sameThing, savedWeek, weekEvents, weekNoteWithout } from './weekread'
import { isLowRecovery, whoopDay, type WhoopDay } from '../whoop/sync'
import { dateISOOf, minutesOf, timeOf, weekStartISO, zonedToUTC } from '../time'
import { mentalDays, type MentalOverride } from '../mental'
import { holidayChanges, isHoliday } from '../today/holidays'
import { setting } from '../settings'
import type { PlanningSettings } from '../freetime'
import type { EventException, EventRow, WeeklyTarget } from '../types'
import { nearestFree, overlapOf, ripple, type Planned, type Ripple, type WeekWorld } from '../week'
import type { Action } from './actions'
import type { ViewData } from './views'

/** The current week as plain data: the rest of this week (or, at the weekend, the coming one). */
export async function loadWorld(sb: SupabaseClient, data: ViewData, range?: { from: string; to: string }): Promise<WeekWorld> {
  // today to the end of the week "plan my week" covers (at the weekend that's next Sunday)
  const { from, to } = range ?? { from: data.today, to: checkinRange(data.today).to }
  const [rules, planned, states, costs, whoopToday, whoopYesterday, done, overrides] = await Promise.all([
    loadRules(sb),
    sb.from('plan_blocks').select('id,on_date,start_time,end_time,title,kind,target_id,task_id').eq('status', 'planned').gte('on_date', from).lte('on_date', to),
    sb.from('day_state').select('on_date,energy').gte('on_date', from).lte('on_date', to),
    loadCosts(sb), whoopDay(sb, data.today), whoopDay(sb, addDays(data.today, -1)),
    // training he ticked this week (it counts as done), and his own 🧠 numbers for sessions (build-o.sql)
    sb.from('plan_blocks').select('on_date,title').eq('status', 'done').eq('kind', 'training').gte('on_date', weekStartISO(from)).lte('on_date', to).then((r) => (r.error ? [] : (r.data ?? []) as { on_date: string; title: string }[])),
    loadMentalOverrides(sb),
  ])
  const types = trainingTypes(data.planning)
  // the week he sent (if any): its sessions and busy times, alongside his calendars
  const sent = await savedWeek(sb, { from, to }, types)
  const events = sent.length ? [...data.events, ...weekEvents(sent, data.events, data.changes)] : data.events
  // his holidays (half-term): no school on those days, the same as Today (lib/today/holidays.ts)
  const changes = holidayChanges(events, data.changes, data.planning, addDays(from, -1), addDays(to, 1))
  const energy = new Map(((states.data ?? []) as { on_date: string; energy: Energy | null }[]).filter((x) => x.energy).map((x) => [x.on_date, x.energy!]))
  const said = energy.has(data.today)
  const hh = (t: string) => t.slice(0, 5)
  const plannedRows = ((planned.error ? [] : planned.data ?? []) as Planned[]).map((b) => ({ ...b, start_time: hh(b.start_time), end_time: hh(b.end_time) }))
  const mental = mentalDays({ from: addDays(from, -1), to, planning: data.planning, events, changes, goals: data.goals, tasks: data.tasks, blocks: plannedRows, overrides })
  return {
    today: data.today, nowMin: minutesOf(timeOf(data.now)), from, to, settings: holidayBounds(data.settings ?? DEFAULT_PLANNING, data.planning),
    events, changes, targets: data.targets, logs: data.logs, weekCounts: data.weekCounts ?? [],
    rules: rules.rules,
    energy: withWhoop(energy, data, whoopToday),
    planned: plannedRows,
    planning: data.planning, mental, done,
    travel: data.travel ?? null,
    types, sent, trainingFrom: moreSettings(data.planning).trainingFrom,
    costs, load: moreSettings(data.planning),
    whoop: whoopToday || whoopYesterday ? { recovery: whoopToday?.recovery ?? null, strain: whoopYesterday?.strain ?? null } : null,
    tiredWhy: !said && energy.get(data.today) === 'tired' && whoopToday?.recovery != null ? new Map([[data.today, `Whoop recovery ${whoopToday.recovery}%`]]) : undefined,
  }
}

export const weekRange = (today: string) => checkinRange(today)

/** On his holidays the day starts after his holiday wake time and morning routine (the same as Today). */
function holidayBounds(s: PlanningSettings, planning: unknown): PlanningSettings {
  const start = minutesOf(setting<string>(planning, 'holidayWakeAt')) + setting<number>(planning, 'morningMin')
  const hhmm = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`
  return {
    ...s,
    dayBounds: (d: string) => {
      const b = s.dayBounds?.(d) ?? null
      if (!isHoliday(planning, d)) return b
      const end = b?.end ?? s.dayEnd
      return { start: b && minutesOf(b.start) > start ? b.start : hhmm, end }
    },
  }
}

/** His own 🧠 numbers for sessions ("the SMC mock is max mental"): load_costs.mental, after build-o.sql (none before). */
export async function loadMentalOverrides(sb: SupabaseClient): Promise<MentalOverride[]> {
  const { data, error } = await sb.from('load_costs').select('title,mental').eq('scope', 'session').not('mental', 'is', null).is('archived_at', null)
  return error ? [] : ((data ?? []) as { title: string; mental: number }[]).filter((r) => r.title).map((r) => ({ title: r.title, mental: r.mental }))
}

/** Low Whoop recovery today counts as a tired day (no gym placed today), unless he said how he feels. */
function withWhoop(energy: Map<string, Energy>, data: ViewData, w: WhoopDay | null): Map<string, Energy> {
  if (!energy.has(data.today) && isLowRecovery(w, data.planning)) energy.set(data.today, 'tired')
  return energy
}

/** The week as it would be after these changes (in memory only). */
export function simulate(w: WeekWorld, actions: Action[]): WeekWorld {
  let events = w.events.map((e) => ({ ...e }))
  let changes = w.changes.map((c) => ({ ...c }))
  const targets = w.targets.map((t) => ({ ...t }))
  let rules: Rule[] = w.rules.map((r) => ({ ...r }) as Rule)
  const weekCounts = [...w.weekCounts]
  for (const a of actions) {
    const p = a.patch as Record<string, unknown>
    if (a.op === 'event_new') events.push({ id: 'new', title: a.title, category_id: null, subject_id: null, location: null, starts_at: String(p.starts_at), ends_at: String(p.ends_at), repeat_days: null, start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: Number(p.travel_minutes ?? 0), target_id: null, archived_at: null })
    else if (a.op === 'event_weekly') events.push({ id: 'new', title: a.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: p.repeat_days as number[], start_time: String(p.start_time), end_time: String(p.end_time), repeat_from: String(p.repeat_from), repeat_until: null, is_busy: true, travel_minutes: Number(p.travel_minutes ?? 0), target_id: null, archived_at: null, training_type: (p.training_type as string | undefined) ?? null, load: (p.load as string | undefined) ?? null })
    else if (a.table === 'event_exceptions') {
      changes = changes.filter((c) => !(c.event_id === a.id && c.on_date === a.usualDate))
      changes.push({ id: 'sim', event_id: a.id!, on_date: a.usualDate!, cancelled: !!p.cancelled, new_date: (p.new_date as string) ?? null, new_start: (p.new_start as string) ?? null, new_end: (p.new_end as string) ?? null, missed: false })
    } else if (a.table === 'events' && a.op === 'event_cancel') events = events.filter((e) => e.id !== a.id)
    else if (a.table === 'events') events = events.map((e) => (e.id === a.id ? { ...e, ...p } as EventRow : e))
    else if (a.table === 'weekly_targets') { const t = targets.find((x) => x.id === a.id); if (t) Object.assign(t, p) }
    else if (a.op === 'target_week') { const i = weekCounts.findIndex((x) => x.target_id === a.id); const row = { target_id: a.id!, week_start: String(p.week_start), target_count: Number(p.target_count) }; if (i >= 0) weekCounts[i] = row; else weekCounts.push(row) }
    else if (a.table === 'training_rules') {
      if (a.op === 'rule_off' || a.op === 'rule_on') rules = rules.map((r, i) => (String(i) === a.id ? { ...r, enabled: a.op === 'rule_on' } as Rule : r))
      else { const r = ruleFromRow({ id: 'sim', kind: 'gap', params: p.params as Record<string, unknown>, label: String(p.label), enabled: true, sort_order: 0 }); if (r) rules = a.id === null ? [...rules, r] : rules.map((x, i) => (String(i) === a.id ? r : x)) }
    }
  }
  return { ...w, events, changes: changes as EventException[], targets: targets as WeeklyTarget[], rules, weekCounts }
}

/** What these changes knock on in the plan (empty if there's no plan this week to knock on). */
export function knockOn(w: WeekWorld, actions: Action[]): Ripple {
  const affects = actions.some((a) => ['events', 'event_exceptions', 'weekly_targets', 'training_rules', 'target_weeks'].includes(a.table))
  if (!affects || !w.planned.some((b) => b.on_date >= w.today)) return { moves: [], warnings: [], tbc: [] }
  return ripple(w, simulate(w, actions))
}

export type Option = { label: string; actions: Action[] }

/**
 * A session moved (or added) on top of another one: two ways out. 1) do it, and cancel the other one that day;
 * 2) the nearest free time that day instead (or leave it where it was, if there's none).
 */
export function clashOptions(w: WeekWorld, actions: Action[]): { clash: string; options: [Option, Option] } | null {
  const after = simulate(w, actions)
  for (const a of actions) {
    if (a.op !== 'event_move' && a.op !== 'event_new') continue
    const p = a.patch as Record<string, unknown>
    const date = (p.new_date as string) ?? a.usualDate ?? (p.starts_at ? dateISOOf(String(p.starts_at)) : null)
    const start = (p.new_start as string) ?? (p.starts_at ? timeOf(String(p.starts_at)) : null) ?? (p.start_time as string)
    const end = (p.new_end as string) ?? (p.ends_at ? timeOf(String(p.ends_at)) : null) ?? (p.end_time as string)
    if (!date || !start || !end) continue
    // the same session in the week he typed ("Owen" Wed 11:00) isn't a clash: they're one session
    const moved = after.events.find((e) => e.id === (a.id ?? 'new'))
    const events = after.events.filter((e) => !isWeekRow(e.id) || !sameThing(e.title, a.title, e.training_type ?? null, moved?.training_type ?? ''))
    const other = overlapOf(events, after.changes, a.id ?? 'new', date, start, end)
    if (!other) continue
    const len = minutesOf(end) - minutesOf(start)
    const free = nearestFree(after.events, after.changes, a.id ?? 'new', date, start, len, w.settings)
    // an item of the week he typed is left out of that week note (never sent to the database as an event id)
    const note = isWeekRow(other.event.id) ? weekNoteWithout(other.event.id, w.sent ?? []) : null
    const cancelOther: Action | null = note
      ? { op: 'event_cancel', table: 'week_notes', id: note.id, title: other.event.title, line: `<b>${esc(other.event.title)}</b> that day: → left out of the week you sent`, patch: { items: note.items } }
      : other.event.id.includes(':') ? null   // another in-memory row (his usual game): nothing to cancel in the database
      : other.event.repeat_days?.length
      ? { op: 'event_cancel', table: 'event_exceptions', id: other.event.id, title: other.event.title, usualDate: other.usualDate, line: `<b>${esc(other.event.title)}</b> that day: → cancelled <i>(just this week)</i>`, patch: { cancelled: true, new_date: other.change?.new_date ?? null, new_start: other.change?.new_start ?? null, new_end: other.change?.new_end ?? null } }
      : { op: 'event_cancel', table: 'events', id: other.event.id, title: other.event.title, line: `<b>${esc(other.event.title)}</b>: → cancelled <i>(archived, can be restored)</i>`, patch: { archived_at: '__now__' } }
    const shifted: Action[] | null = free ? actions.map((x) => {
      if (x !== a) return x
      const end2 = `${String(Math.floor((minutesOf(free) + len) / 60)).padStart(2, '0')}:${String((minutesOf(free) + len) % 60).padStart(2, '0')}`
      const patch = a.op === 'event_new' ? { ...p, starts_at: zonedToUTC(date, free), ends_at: zonedToUTC(date, end2) } : p.new_start ? { ...p, new_start: free, new_end: end2 } : p.start_time ? { ...p, start_time: free, end_time: end2 } : { ...p, starts_at: zonedToUTC(date, free), ends_at: zonedToUTC(date, end2) }
      return { ...x, patch, line: x.line.replace(`${start}–${end}`, `${free}–${end2}`) }
    }) : null
    return {
      clash: `⚠️ <b>Clash</b>: ${start}–${end} is on top of ${esc(other.event.title)} (${other.start}${other.end ? `–${other.end}` : ''}).`,
      options: [
        cancelOther ? { label: `${a.title} at ${start}, and cancel ${other.event.title} that day`, actions: [...actions, cancelOther] } : { label: `${a.title} at ${start} anyway`, actions },
        shifted ? { label: `${a.title} at ${free} instead`, actions: shifted } : { label: `Leave ${a.title} where it was`, actions: actions.filter((x) => x !== a) },
      ],
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Applying the knock-on (after the card's own changes) and undoing it
// ---------------------------------------------------------------------------

export type RippleApplied = { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[]

/** Move (or drop) the plan blocks the change knocked on. Blocks are updated in place, never deleted. */
export async function applyRipple(sb: SupabaseClient, r: Ripple | undefined): Promise<RippleApplied> {
  const done: RippleApplied = []
  for (const m of r?.moves ?? []) {
    const { data: was } = await sb.from('plan_blocks').select('on_date,start_time,end_time,status,title').eq('id', m.blockId).eq('status', 'planned').maybeSingle()
    if (!was) continue   // gone or changed since: leave it
    const patch = m.to ? { on_date: m.to.date, start_time: m.to.start, end_time: m.to.end, ...(m.to.title && m.to.title !== was.title ? { title: m.to.title.slice(0, 200) } : {}) } : { status: 'cancelled' }
    const { data: now, error } = await sb.from('plan_blocks').update(patch).eq('id', m.blockId).select('on_date,start_time,end_time,status,title').single()
    if (error || !now) throw new Error(`Couldn’t move “${m.title}” in your plan: ${error?.message ?? 'not saved'}`)
    done.push({ id: m.blockId, before: was, after: now })
  }
  return done
}

export async function undoRipple(sb: SupabaseClient, done: RippleApplied | undefined): Promise<string[]> {
  const skipped: string[] = []
  for (const d of [...(done ?? [])].reverse()) {
    const { data: now } = await sb.from('plan_blocks').select('on_date,start_time,end_time,status,title').eq('id', d.id).maybeSingle()
    // field by field: the stored copy comes back from the database with its fields in another order
    if (!now || Object.keys(d.after).some((k) => String((now as Record<string, unknown>)[k]) !== String(d.after[k]))) { skipped.push(d.id); continue }
    await sb.from('plan_blocks').update(d.before).eq('id', d.id)
  }
  return skipped
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(',', '')

/** The knock-on as card lines. */
export function rippleLines(r: Ripple | undefined): string[] {
  if (!r || (!r.moves.length && !r.warnings.length && !r.tbc.length)) return []
  const lines = ['', '↪️ <b>Knock-on in your plan</b>']
  // a new place or intensity is shown as the session's new name
  const changed = (a: string, b: string) => { const x = parseSessionTitle(a), y = parseSessionTitle(b); return x.place !== y.place || (!!y.intensity && x.intensity !== y.intensity) }
  for (const m of r.moves) lines.push(`• ${esc(m.title)}: ${esc(m.from)} → ${m.to ? `${shortDay(m.to.date)} ${m.to.start}${m.to.title && changed(m.title, m.to.title) ? `, as ${esc(m.to.title)}` : ''}` : 'dropped'} <i>(${esc(m.reason)})</i>`)
  for (const t of r.tbc) lines.push(`• ${esc(t)}: TBC this week <i>(no day without breaking a rule)</i>`)
  for (const w of r.warnings) lines.push(`⚠️ ${esc(w)}`)
  return lines
}
