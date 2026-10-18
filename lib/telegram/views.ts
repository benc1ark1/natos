// Server-only: the bot's instant answers. Plain code over Nat's own data (no AI, so free, exact and instant):
// inbox · week · coming up · free time · postponing · a project's next step · today.
// matchView() spots these questions word for word; the brain can also ask for one ("show").
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { rows } from '../data'
import { expandEvents, isBackground, isEveryday, timeRange } from '../events'
import { freeDays, planningSettings, slotsText, type PlanningSettings } from '../freetime'
import { modeWords, withTravel, type TravelWorld } from '../travel'
import { loadTravel } from '../travel-data'
import { moreSettings } from '../settings'
import { dayOf, loadReminders, reminderWhen, splitReminders } from '../reminders'
import { targetProgress } from '../targets'
import { deadlineLabel, deadlineOf, pickToday, sortByDate, sortTasks } from '../tasks'
import { addDays, daysBetween, dowShort, isoDow, minutesOf, shortDate, timeOf, weekStartISO } from '../time'
import type { Goal, Project, Reminder, Task } from '../types'
import { esc } from './api'
import { loadDay, type DayData } from './brief'
import { boundsOf } from '../setup'
import { schoolDays, withSchool } from '../school'
import type { Ref } from './turns'

export const VIEWS = ['inbox', 'week', 'coming', 'free', 'postponed', 'project', 'today', 'load', 'gaps', 'savings', 'maths', 'mathsnext'] as const
/** Views worked out with more of his data (lib/telegram/views-more.ts), not by render(). */
export const ASYNC_VIEWS: readonly View[] = ['load', 'gaps', 'savings', 'maths', 'mathsnext']
export type View = (typeof VIEWS)[number]
export type ViewRequest = { view: View; arg: string | null }

// ---------------------------------------------------------------------------
// Spotting the question (whole message only, so anything subtler goes to the brain)
// ---------------------------------------------------------------------------

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const DAY_WORD = '(today|tonight|tomorrow|tmrw|(?:on |this |next )?(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*)'

/** "tomorrow", "Thursday", "next Monday" -> a date (today counts for a weekday name). null if not a day. */
export function dayFromWords(words: string | null | undefined, today: string): string | null {
  const w = (words ?? '').toLowerCase().trim()
  if (!w || w === 'today' || w === 'tonight') return today
  if (w === 'tomorrow' || w === 'tmrw') return addDays(today, 1)
  const m = w.match(/^(on |this |next )?([a-z]{3,})$/)
  if (!m) return null
  const key = m[2] === 'weds' ? 'wed' : m[2]
  const i = DAYS.findIndex((d) => d.startsWith(key))
  if (i < 0) return null
  let d = today
  while (isoDow(d) !== i + 1) d = addDays(d, 1)
  if (m[1] === 'next ' && daysBetween(today, d) < 7 && weekStartISO(d) === weekStartISO(today)) d = addDays(d, 7)
  return d
}

export function matchView(message: string, today: string): ViewRequest | null {
  const t = message.toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  if (/^\/maths$|^(?:show |open )?(?:me )?(?:my )?maths tracker$|^how'?s my maths( going)?$/.test(t)) return { view: 'maths', arg: null }
  if (/^what maths (?:should|do) i do(?: now| next| today| tonight)?$|^what maths next$|^next maths$/.test(t)) return { view: 'mathsnext', arg: null }
  const cmd = t.match(/^\/(inbox|week|coming|free|postponed|next|today)\b\s*(.*)$/)
  if (cmd) {
    const [, c, rest] = cmd
    if (c === 'free') return { view: 'free', arg: dayFromWords(rest || 'today', today) ?? today }
    if (c === 'next') return { view: 'project', arg: rest || null }
    return { view: c as View, arg: null }
  }
  const pre = "(?:(?:can you |could you |pls |please )?(?:show me |show |tell me |give me )?)"
  if (new RegExp(`^${pre}(?:what'?s |what is )?(?:in )?my inbox$|^inbox$`).test(t)) return { view: 'inbox', arg: null }
  if (new RegExp(`^${pre}(?:my week|the week|my week ahead|what'?s my week( like)?|what does my week look like)$`).test(t)) return { view: 'week', arg: null }
  if (new RegExp(`^${pre}(?:what'?s |what is |anything )?coming up( soon)?$`).test(t)) return { view: 'coming', arg: null }
  const free = t.match(new RegExp(`^(?:when am i free|when'?m i free|free time|when do i have free time|my free time)(?: ${DAY_WORD})?$`))
  if (free) { const d = dayFromWords(free[1] ?? 'today', today); return d ? { view: 'free', arg: d } : null }
  if (/^what (have i been|am i|have i) (postponing|putting off)$/.test(t)) return { view: 'postponed', arg: null }
  const next = t.match(/^(?:what'?s |what is )?next (?:on|for) (.{2,60})$/)
  if (next) return { view: 'project', arg: next[1].replace(/^(the|my) /, '') }
  if (/^(?:what'?s |what is )?(?:on )?(?:for )?today$|^today$|^what'?s on$|^what'?s next$|^what is next$|^what now$/.test(t)) return { view: 'today', arg: null }
  if (/^(?:how'?s|how is|what'?s|what is|show me|show) (?:my )?(?:training )?load(?: this week| like)?$|^my load$|^load$/.test(t)) return { view: 'load', arg: null }
  if (/^(?:what do you (?:still )?need to know|what else do you need(?: to know)?|what are you (?:still )?guessing|what (?:questions|gaps) (?:are )?left|any (?:more )?questions for me)$/.test(t)) return { view: 'gaps', arg: null }
  if (/^(?:where|how) can i save (?:some )?time$|^save (?:me )?time$|^where am i wasting time$/.test(t)) return { view: 'savings', arg: null }
  return null
}

// ---------------------------------------------------------------------------
// The data (one read for every view)
// ---------------------------------------------------------------------------

export type ViewData = DayData & { reminders: Reminder[]; goals: Goal[]; projects: Project[]; settings: PlanningSettings; now: Date; travel?: TravelWorld | null }

/** The planning settings (and the raw value, which also holds the travel settings). */
export async function loadPlanningRaw(sb: SupabaseClient): Promise<unknown> {
  const { data, error } = await sb.from('profiles').select('planning').maybeSingle()
  return error ? null : data?.planning
}
export const loadPlanning = async (sb: SupabaseClient): Promise<PlanningSettings> => planningSettings(await loadPlanningRaw(sb))   // before jarvis-b.sql runs: the defaults

export async function loadViewData(sb: SupabaseClient, today: string, now = new Date()): Promise<ViewData> {
  const [day, reminders, goals, projects, raw] = await Promise.all([
    loadDay(sb, today),
    loadReminders(sb),
    sb.from('goals').select('*').is('archived_at', null).or(`target_date.is.null,target_date.gte.${today}`).order('target_date'),
    sb.from('projects').select('*').is('archived_at', null).order('sort_order'),
    loadPlanningRaw(sb),
  ])
  const travel = await loadTravel(sb, day.events, raw)
  return { ...day, planning: raw, reminders, goals: rows<Goal>(goals, 'goals'), projects: rows<Project>(projects, 'projects'), settings: withBounds(planningSettings(raw), day.shapes), now, travel }
}

/** Planning settings that keep each day's routines and sleep free (wake + morning routine … night routine before bed). */
export function withBounds(s: PlanningSettings, shapes: DayData['shapes']): PlanningSettings {
  return { ...s, dayBounds: boundsOf(shapes) }
}

// ---------------------------------------------------------------------------
// The answers (pure: data in, Telegram HTML out)
// ---------------------------------------------------------------------------

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const when = (iso: string, today: string) => (iso === today ? 'today' : iso === addDays(today, 1) ? 'tomorrow' : day(iso))
const taskLine = (t: Task, today: string) => {
  const bits = [deadlineLabel(t, today), t.duration_minutes ? `~${t.duration_minutes} min` : '', t.postpone_count >= 2 ? `postponed ${t.postpone_count}×` : ''].filter(Boolean)
  return `• ${t.is_key ? '⭐ ' : ''}${t.importance === 'must' && deadlineOf(t) ? `<b>${esc(t.title)}</b>` : esc(t.title)}${bits.length ? ` <i>(${esc(bits.join(' · '))})</i>` : ''}`
}
const refsOf = (ts: Task[]): Ref[] => ts.map((t) => ({ kind: 'task', id: t.id, title: t.title }))
const live = (d: ViewData) => d.tasks.filter((t) => t.status !== 'completed' && !t.archived_at)

export type Rendered = { html: string; refs: Ref[] }

export function renderInbox(d: ViewData): Rendered {
  const inbox = sortTasks(live(d).filter((t) => t.status === 'inbox'))
  const someday = live(d).filter((t) => t.status === 'someday').length
  if (!inbox.length) return { html: `📥 Inbox is empty.${someday ? ` (${someday} in Someday.)` : ''}`, refs: [] }
  const shown = inbox.slice(0, 15)
  const lines = [`📥 <b>Inbox</b> (${inbox.length})`, ...shown.map((t) => `• ${esc(t.title)}${t.needs_sorting ? ' <i>(not sorted yet)</i>' : ''} <i>(added ${shortDate(t.created_at.slice(0, 10))})</i>`)]
  if (inbox.length > shown.length) lines.push(`<i>…and ${inbox.length - shown.length} more on the dashboard.</i>`)
  if (someday) lines.push(`<i>${someday} in Someday.</i>`)
  return { html: lines.join('\n'), refs: refsOf(shown) }
}

export function renderWeek(d: ViewData): Rendered {
  const end = addDays(d.today, 6)
  const occ = expandEvents(d.events, d.today, end, d.changes).filter((o) => !o.cancelled)
  // school is one line a day (lessons hidden; free periods, break and lunch under it)
  const school = schoolDays(d.events, d.changes, d.today, end, d.settings.schoolFreePeriods)
  const hidden = new Set([...school.values()].flatMap((x) => [...x.hidden]))
  const everyday = [...new Set(occ.filter((o) => isBackground(o.event) && !hidden.has(o.key)).map((o) => (isEveryday(o.event) ? o.event.title : 'School lessons')))]
  const dated = sortByDate(live(d).filter((t) => t.status !== 'someday' && deadlineOf(t) && deadlineOf(t)! <= end))
  const tests = d.goals.filter((g) => g.kind === 'test' && g.target_date && g.target_date >= d.today && g.target_date <= end)
  const lines = [`🗓 <b>Your week</b> (${day(d.today)} – ${day(end)})`]
  const refs: Ref[] = []
  for (let x = d.today; x <= end; x = addDays(x, 1)) {
    const evs = withSchool(school.get(x), occ.filter((o) => o.date === x && !isBackground(o.event) && !hidden.has(o.key))
      .map((o) => ({ at: o.start ?? '', line: `${timeRange(o) || 'all day'} ${esc(o.event.title)}${o.moved ? ' <i>(moved)</i>' : ''}` })))
    const due = dated.filter((t) => deadlineOf(t) === x)
    const overdue = x === d.today ? dated.filter((t) => deadlineOf(t)! < d.today) : []
    const tst = tests.filter((g) => g.target_date === x)
    refs.push(...refsOf([...overdue, ...due]))
    const bits = [
      ...evs,
      ...tst.map((g) => `📝 <b>${esc(g.title)}</b>`),
      ...overdue.map((t) => `⚠️ overdue: ${esc(t.title)}`),
      ...due.map((t) => `📌 due: ${t.importance === 'must' ? `<b>${esc(t.title)}</b>` : esc(t.title)}`),
    ]
    // one thing per line, so a time range never wraps in the middle on a phone
    lines.push(bits.length ? [`<b>${x === d.today ? 'Today' : day(x)}</b>`, ...bits.map((b) => `  ${b}`)].join('\n') : `<b>${x === d.today ? 'Today' : day(x)}</b>: nothing booked`)
  }
  if (everyday.length) lines.push(`<i>Plus ${esc(everyday.join(', '))} on the usual days.</i>`)
  const week = { events: d.events, changes: d.changes, logs: d.logs, weekStart: weekStartISO(d.today), today: d.today, weekCounts: d.weekCounts }
  const t = d.targets.map((x) => ({ x, ...targetProgress(x, week) }))
  if (t.length) lines.push(`🏃 ${esc(t.map((p) => `${p.x.name} ${p.done}/${p.target}`).join(' · '))} <i>(this week)</i>`)
  return { html: lines.join('\n'), refs }
}

export function renderComing(d: ViewData): Rendered {
  const end = addDays(d.today, 13)
  const dated = sortByDate(live(d).filter((t) => t.status !== 'someday' && deadlineOf(t) && deadlineOf(t)! <= end))
  const tests = d.goals.filter((g) => g.kind === 'test' && g.target_date && g.target_date >= d.today && g.target_date <= end)
  const occ = expandEvents(d.events, d.today, end, d.changes).filter((o) => !o.cancelled && !isBackground(o.event))
  // repeating events: only the next one (my-spec 41)
  const seen = new Set<string>()
  const events = occ.filter((o) => (o.date > d.today || (o.start ?? '24') > timeOf(d.now)) && !seen.has(o.event.id) && seen.add(o.event.id))
  const rem = d.reminders.filter((r) => r.kind !== 'person' && dayOf(r) && dayOf(r)! >= d.today && dayOf(r)! <= end)
  const lines = ['⏭ <b>Coming up</b> (next 2 weeks)']
  const overdue = dated.filter((t) => deadlineOf(t)! < d.today)
  if (overdue.length) lines.push('', '⚠️ <b>Overdue</b>', ...overdue.map((t) => taskLine(t, d.today)))
  const soon = dated.filter((t) => deadlineOf(t)! >= d.today)
  if (soon.length) lines.push('', '📌 <b>Deadlines</b>', ...soon.map((t) => taskLine(t, d.today)))
  if (tests.length) lines.push('', '📝 <b>Tests</b>', ...tests.map((g) => `• <b>${esc(g.title)}</b> <i>(${when(g.target_date!, d.today)}, in ${daysBetween(d.today, g.target_date!)} days)</i>`))
  if (events.length) lines.push('', '📅 <b>Events</b>', ...events.slice(0, 10).map((o) => `• ${when(o.date, d.today).replace(/^./, (c) => c.toUpperCase())} ${esc(timeRange(o))} ${esc(o.event.title)}${o.moved ? ' <i>(moved)</i>' : ''}`))
  if (rem.length) lines.push('', '🔔 <b>Reminders</b>', ...rem.map((r) => `• ${esc(r.body)} <i>(${esc(reminderWhen(r, d.today) || 'today')})</i>`))
  if (lines.length === 1) lines.push('Nothing in the next two weeks.')
  return { html: lines.join('\n'), refs: refsOf(dated) }
}

export function renderFree(d: ViewData, date: string): Rendered {
  const nowMin = minutesOf(timeOf(d.now))
  if (date < d.today) date = d.today
  const [f] = freeDays(d.events, d.changes, date, date, d.settings, d.today, nowMin, d.travel)
  const occ = withTravel(expandEvents(d.events, date, date, d.changes), d.travel ?? null).filter((o) => o.date === date && !o.cancelled && o.event.is_busy)
  const lines = [`🕒 <b>Free ${date === d.today ? 'today' : date === addDays(d.today, 1) ? 'tomorrow' : `on ${day(date)}`}</b>${date === d.today ? ` (from ${timeOf(d.now)})` : ''}`]
  if (!f.slots.length) lines.push('No free time left.')
  for (const s of f.slots) {
    const late = s.heavyMinutes < s.minutes ? (s.heavyMinutes > 0 ? ` <i>(nothing heavy after ${d.settings.heavyUntil})</i>` : ' <i>(light things only)</i>') : ''
    lines.push(`• ${s.start}–${s.end}: ${s.minutes >= 60 ? `${Math.floor(s.minutes / 60)} h${s.minutes % 60 ? ` ${s.minutes % 60} min` : ''}` : `${s.minutes} min`}${late}`)
  }
  if (f.slots.length > 1) lines.push(`Total: ${Math.floor(f.total / 60)} h ${f.total % 60} min`)
  if (f.schoolNight) lines.push(`<i>School night: about ${Math.round(d.settings.schoolNightFocusMin / 15) * 15} min of focused work max.</i>`)
  const tr = (o: (typeof occ)[number]) => {
    const go = o.travelBefore ?? o.event.travel_minutes, back = o.travelAfter ?? o.event.travel_minutes
    return !go && !back ? '' : go === back && o.travelBefore === undefined ? ` +${go} min travel each way` : ` +${go} min there${o.leg ? ` ${modeWords(o.leg.mode)}` : ''}, ${back} back`
  }
  if (occ.length) lines.push(`<i>Busy: ${esc(occ.map((o) => `${o.event.title} ${timeRange(o) || 'all day'}${tr(o)}`).join(' · '))}. Gaps allow ${d.settings.bufferMin} min either side.</i>`)
  return { html: lines.join('\n'), refs: [] }
}

/** Tasks put off at least once, most-postponed first; put off often enough (setting pushBackAfter) gets a push-back. */
export function renderPostponed(d: ViewData): Rendered {
  const list = live(d).filter((t) => t.postpone_count > 0 && t.status !== 'someday').sort((a, b) => b.postpone_count - a.postpone_count || (deadlineOf(a) ?? '9').localeCompare(deadlineOf(b) ?? '9')).slice(0, 10)
  if (!list.length) return { html: 'Nothing postponed. 👍', refs: [] }
  const lines = ['🔁 <b>Postponed</b>', ...list.map((t) => `• ${esc(t.title)} <i>(${t.postpone_count}×${deadlineOf(t) ? ` · ${esc(deadlineLabel(t, d.today))}` : ''})</i>`)]
  const worst = list[0]
  if (worst.postpone_count >= moreSettings(d.planning).pushBackAfter) lines.push('', `“${esc(worst.title)}” has been put off ${worst.postpone_count} times: do it tonight, or drop it?`)
  return { html: lines.join('\n'), refs: refsOf(list) }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function renderProject(d: ViewData, name: string | null): Rendered {
  const n = norm(name ?? '')
  const exact = d.projects.filter((p) => norm(p.name) === n)
  const partial = d.projects.filter((p) => n && (norm(p.name).includes(n) || n.includes(norm(p.name))))
  const p = exact[0] ?? (partial.length === 1 ? partial[0] : null)
  if (!p) {
    if (!d.projects.length) return { html: 'You have no projects yet.', refs: [] }
    return { html: `${n ? `No project called “${esc(name!)}”.` : 'Which project?'} Your projects: ${esc(d.projects.map((x) => x.name).join(' · '))}`, refs: [] }
  }
  const open = sortTasks(live(d).filter((t) => t.project_id === p.id && t.status !== 'someday'))
  if (!open.length) return { html: `<b>${esc(p.name)}</b>: no open tasks. Send me the next step and I’ll add it.`, refs: [] }
  const [first, ...rest] = open
  const lines = [`<b>${esc(p.name)}</b>: next step`, taskLine(first, d.today)]
  if (rest.length) lines.push('<i>Then:</i>', ...rest.slice(0, 3).map((t) => taskLine(t, d.today)))
  return { html: lines.join('\n'), refs: refsOf(open.slice(0, 4)) }
}

export function renderToday(d: ViewData): Rendered {
  const now = timeOf(d.now)
  const occ = expandEvents(d.events, d.today, d.today, d.changes).filter((o) => !o.cancelled && o.date === d.today)
  const sd = schoolDays(d.events, d.changes, d.today, d.today, d.settings.schoolFreePeriods).get(d.today)
  const left = occ.filter((o) => (!o.end || o.end > now) && !sd?.hidden.has(o.key))
  const inSchool = sd && sd.end > now ? sd : undefined
  const todo = pickToday(live(d), d.today, moreSettings(d.planning).todayMax)
  const rem = splitReminders(d.reminders, d.today, d.now)
  const reminders = [...rem.now, ...rem.later.filter((r) => dayOf(r) === d.today)]
  const [f] = freeDays(d.events, d.changes, d.today, d.today, d.settings, d.today, minutesOf(now), d.travel)
  const lines = [`📍 <b>Today</b> (${now})`]
  const plan = (d.plan ?? []).filter((b) => b.end_time > now)
  // school as one line, with what's left of its free periods, break and lunch (and anything planned in them)
  const booked = withSchool(inSchool, [
    ...left.map((o) => ({ at: o.start ?? '', line: `${esc(timeRange(o) || 'all day')} ${esc(o.event.title)}` })),
    ...(inSchool ? plan.filter((b) => b.start_time < inSchool.end).map((b) => ({ at: b.start_time, line: `${b.start_time}–${b.end_time} ${esc(b.title)}` })) : []),
  ], '  ', inSchool?.windows.filter((w) => w.end > now)).map((l) => (l.startsWith(' ') ? l : `• ${l}`))
  const later = inSchool ? plan.filter((b) => b.start_time >= inSchool.end) : plan
  lines.push(booked.length ? booked.join('\n') : occ.length ? '• Nothing else booked' : '• Nothing booked')
  if (later.length) lines.push('', '🗓 <b>Plan</b>', ...later.map((b) => `• ${b.start_time}–${b.end_time} ${esc(b.title)}`))
  if (todo.length) lines.push('', '✅ <b>To do</b>', ...todo.map((t) => taskLine(t, d.today)))
  const [free, night] = slotsText(f, d.settings).split(' · school night: ')
  lines.push('', `🕒 <b>Free</b>: ${esc(free)}`)
  if (night) lines.push(`<i>School night: ${esc(night)}</i>`)
  if (reminders.length) lines.push('', '🔔 ' + reminders.map((r) => esc(r.body)).join(' · '))
  return { html: lines.join('\n'), refs: refsOf(todo) }
}

export function render(d: ViewData, req: ViewRequest): Rendered {
  switch (req.view) {
    case 'inbox': return renderInbox(d)
    case 'week': return renderWeek(d)
    case 'coming': return renderComing(d)
    case 'free': return renderFree(d, req.arg && /^\d{4}-\d{2}-\d{2}$/.test(req.arg) ? req.arg : d.today)
    case 'postponed': return renderPostponed(d)
    case 'project': return renderProject(d, req.arg)
    case 'today': return renderToday(d)
    default: return { html: '', refs: [] }   // load, gaps, savings: lib/telegram/views-more.ts
  }
}

/** Free time for the next 7 days, for the brain (so it never works out time itself). */
export function freeTimeForAI(d: ViewData): string {
  const nowMin = minutesOf(timeOf(d.now))
  const days = freeDays(d.events, d.changes, d.today, addDays(d.today, 6), d.settings, d.today, nowMin, d.travel)
  return [
    `Free time, worked out by the app (busy events + travel both ways + ${d.settings.bufferMin}-min buffers already taken off; use these, never work free time out yourself):`,
    ...days.map((x) => `- ${x.date === d.today ? `Today from ${timeOf(d.now)}` : x.date === addDays(d.today, 1) ? `Tomorrow ${day(x.date)}` : day(x.date)}: ${slotsText(x, d.settings)}`),
    `His settings: nothing planned before ${d.settings.dayStart} or after ${d.settings.dayEnd}; nothing heavy after ${d.settings.heavyUntil}.`,
  ].join('\n')
}
