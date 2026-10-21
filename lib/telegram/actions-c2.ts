// Server-only: changes to calendar events, tests and goals (Jarvis phase C2), checked, applied and undone like the
// task changes in lib/telegram/actions.ts. Only the event itself changes here; re-planning around it is phase D2.
// Only Nat's own app events can change: anything from Google is read-only (my-spec: never edit calendars outside
// "Life OS"). Nothing is deleted: a cancelled week is a one-week change; a dropped or undone event is archived.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserId } from '../data'
import { expandEvents, isRepeating as repeats, isSchool, restoreChange, saveChange, setEventArchived, timeRange, type Occurrence } from '../events'
import { setGoalArchived } from '../goals'
import { replanTest } from '../prep'
import { addDays, dowShort, isoDow, minutesOf, shortDate, weekStartISO, todayISO, zonedToUTC } from '../time'
import type { EventException, EventRow, Goal, WeeklyTarget } from '../types'
import { NOT_TRAINING, activeTypes, defaultLoad, isTrainingType, labelOf, trainingTypes, type Rule, type TypeDef } from '../training'
import { findItem, newKey, taskSources, type Source } from '../lists'
import { matchName, stagesOf, type Stage } from '../study'
import { addTopics, loadStudy, restoreStages, restoreTopicStatus, setStages, setTopicStatus, type StudyData } from '../study-data'
import { DOT, STATUS_WORD, parseStatus, resolveTopics, statusOf, type MathsTopic, type MathsWorld } from '../maths'
import { parseTopicLines } from '../study'
import { loadRules, ruleToRow, saveDefaultRules, typeOf } from '../training-data'
import { DAY_NAMES, modeWords, type Place } from '../travel'
import { SETTINGS, currentSettings, parseSetting, showSetting, moreSettings } from '../settings'
import { cleanPattern, ruleWords, type MailRule } from '../mail/rules'
import { itemsWithout } from './weekread'
import { DEFAULT_COSTS, levelWord, sessionOverride, typeCost, type CostRow } from '../load'
import { gameChange, ignoreChange, owenChange, placeChange, sessionChange, upperWeekChange } from '../setup-edit'
import { loadCosts } from '../training-data'
import { focusChange } from '../today/focus'

export const C2_OPS = ['event_move', 'event_cancel', 'event_new', 'event_weekly', 'test_date', 'goal_topics', 'goal_archive', 'training_type', 'rule_set', 'rule_off', 'rule_on',
  'place_new', 'event_place', 'travel_set', 'setting', 'event_set', 'target_set', 'list_edit', 'calendar_set',
  'stage_set', 'topic_new', 'topic_set', 'mistake_done', 'guide_log', 'guide_note', 'mail_rule', 'load_set',
  // Build O: his set-up (places, sessions), Owen's days, this week's game, ignored read-only sessions, a school day's times
  'setup_set', 'owen_days', 'game_week', 'session_ignore', 'gap_done', 'school_day', 'upper_week',
  // fix round: a focus period ("until 25 Oct only ACT": lib/today/focus.ts)
  'focus_period',
  // things only the dashboard could do before (Build O audit): a plan block, a new subject or weekly target, restore, a guide
  'block_move', 'block_skip', 'subject_new', 'target_new', 'restore', 'guide_set',
  // maths system: a topic's colour ("trig yellow", "Book 1 chapters 1–13 green")
  'topic_status'] as const
/** Changes that are one key of profiles.planning (applied and undone like a setting). */
const PLANNING_OPS: readonly string[] = ['setting', 'list_edit', 'setup_set', 'owen_days', 'game_week', 'session_ignore', 'gap_done', 'upper_week', 'focus_period']
export const STUDY_OPS: readonly string[] = ['stage_set', 'topic_new', 'topic_set', 'mistake_done', 'topic_status']
export const GUIDE_OPS: readonly string[] = ['guide_log', 'guide_note']
export type C2Op = (typeof C2_OPS)[number]

type Raw = { op: string; value: string; date: string; date_to: string; time: string; time_to: string; number: number; words: string }
export type C2Action = {
  op: C2Op; table: 'events' | 'event_exceptions' | 'goals' | 'weekly_targets' | 'training_rules' | 'places' | 'travel_times' | 'profiles' | 'integrations' | 'pipeline_stages' | 'topics' | 'mistakes' | 'guides' | 'guide_logs' | 'mail_rules' | 'load_costs' | 'plan_blocks' | 'subjects' | 'tasks' | 'week_notes'; id: string | null; title: string; line: string
  patch: Record<string, unknown>
  usualDate?: string     // a one-week change: the date the session normally happens
}
export type GoogleCalRow = { id: string; name: string; read: boolean; school: boolean }
export type C2Rows = { events: Map<string, EventRow>; changes: EventException[]; goals: Map<string, Goal>; targets?: Map<string, WeeklyTarget>; rules?: Rule[]; places?: Place[]; planning?: unknown
  google?: { id: string; calendars: GoogleCalRow[] } | null
  study?: (StudyData & { subjects: { id: string; name: string }[] }) | null
  guides?: { id: string; title: string; body: string; has_log: boolean }[] | null
  mailRules?: MailRule[] | null
  costs?: CostRow[]; titles?: string[]    // his recovery costs, and the session names in his calendar (for load_set)
  blocks?: Map<string, { id: string; on_date: string; start_time: string; end_time: string; title: string; kind: string; status: string }>
  archived?: Map<string, { id: string; title: string; archived_at: string | null; status: string }>
  categories?: { id: string; name: string }[]; subjects?: { id: string; name: string; archived_at: string | null }[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
/** "wed", "Wednesday", "Wednesdays" -> 3 (ISO weekday), else null. */
export const weekdayOf = (v: string) => { const i = DAYS.indexOf(v.trim().toLowerCase().slice(0, 3)); return i < 0 ? null : i + 1 }
/** The weekdays his words name: "every Monday and Wednesday" -> [1, 3]; "weekdays" -> Mon–Fri; "every day" -> all. */
export function weekdaysIn(words: string): number[] {
  const w = (words ?? '').toLowerCase()
  if (/\b(every ?day|daily)\b/.test(w)) return [1, 2, 3, 4, 5, 6, 7]
  const days = new Set<number>()
  if (/\bweekdays?\b/.test(w)) [1, 2, 3, 4, 5].forEach((d) => days.add(d))
  if (/\bweekends?\b/.test(w)) [6, 7].forEach((d) => days.add(d))
  for (const m of w.matchAll(/\b(mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?s?\b/g)) days.add(weekdayOf(m[1])!)
  return [...days].sort()
}
/** "15-20", "15–20", "15 to 20" or "20" -> { lo, hi } within min..max, else null. */
export function rangeOf(v: string | undefined, min: number, max: number): { lo: number; hi: number } | null {
  const m = (v ?? '').trim().match(/^(\d{1,3})(?:\s*(?:-|–|—|to)\s*(\d{1,3}))?(?:\s*min\w*)?$/i)
  if (!m) return null
  const lo = Number(m[1]), hi = m[2] === undefined ? lo : Number(m[2])
  return lo >= min && hi <= max && lo <= hi ? { lo, hi } : null
}
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const isRepeating = (e: EventRow) => !!(e.repeat_days?.length && e.start_time)

/** One session of an event: on its usual date (or where it moved to), else the next one from today. */
export function findSession(ev: EventRow, changes: EventException[], date: string | null, today: string): Occurrence | null {
  const occ = expandEvents([ev], addDays(today, -1), addDays(today, 56), changes.filter((c) => c.event_id === ev.id))
  if (date) return occ.find((o) => o.usualDate === date) ?? occ.find((o) => o.date === date) ?? null
  return occ.find((o) => o.date >= today && !o.cancelled) ?? null
}

/** Check one proposed event/test/goal change. `grounded(words)`: are these his words? */
const kvOf = (v: string) => Object.fromEntries((v ?? '').split(';').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x.length === 2 && x[1]))

export function checkC2(op: C2Op, a: Raw, ref: { kind: string; id: string } | undefined, rows: C2Rows, grounded: (w: string) => boolean, today: string):
  { action?: C2Action; problem?: string } {
  if (op === 'event_new') {
    const title = (a.value ?? '').trim().slice(0, 120)
    if (!title) return { problem: 'a new event needs a name' }
    if (!isDate(a.date) || a.date < today || !grounded(a.words)) return { problem: `no clear day for “${title}” in your words` }
    if (!isTime(a.time)) return { problem: `no start time for “${title}”` }
    const end = isTime(a.time_to) && minutesOf(a.time_to) > minutesOf(a.time) ? a.time_to : hm(Math.min(minutesOf(a.time) + 60, 23 * 60 + 59))
    const travel = Number.isInteger(a.number) && a.number > 0 && a.number <= 180 ? a.number : 0
    return { action: {
      op, table: 'events', id: null, title,
      line: `📅 New: <b>${esc(title)}</b> ${day(a.date)} ${a.time}–${end}${travel ? ` (+${travel} min travel each way)` : ''}`,
      patch: { title, starts_at: zonedToUTC(a.date, a.time), ends_at: zonedToUTC(a.date, end), is_busy: true, travel_minutes: travel },
    } }
  }

  if (op === 'event_weekly') {
    // a repeating event ("football training every Monday and Wednesday 18:00–19:30"): the days come from his words.
    // value is its name, or "name=Club 360 Talent; place=Christchurch Finchley College; type=football; arrive=yes;
    // starts=20:15": arrive=yes = time is when he has to be there (the block starts then, so leave-by is right);
    // starts = when the session itself starts, if he said both (kept in the name, as there's no column for it)
    const kv = /(^|;)\s*name\s*=/.test(a.value ?? '') ? kvOf(a.value) : { name: a.value ?? '' }
    let title = (kv.name ?? '').trim().slice(0, 120)
    if (!title) return { problem: 'a new event needs a name' }
    const days = weekdaysIn(a.words)
    if (!days.length || !grounded(a.words)) return { problem: `no clear days for “${title}” in your words` }
    if (!isTime(a.time)) return { problem: `no start time for “${title}”` }
    const end = isTime(a.time_to) && minutesOf(a.time_to) > minutesOf(a.time) ? a.time_to : hm(Math.min(minutesOf(a.time) + 60, 23 * 60 + 59))
    const travel = Number.isInteger(a.number) && a.number > 0 && a.number <= 180 ? a.number : 0
    const from = isDate(a.date) && a.date > today ? a.date : today
    const names = days.map((d) => DAY_NAMES[d - 1].slice(0, 3)).join(' + ')
    const arrive = /^(yes|true|y)$/i.test(kv.arrive ?? '')
    const starts = isTime(kv.starts ?? '') && minutesOf(kv.starts) > minutesOf(a.time) && minutesOf(kv.starts) < minutesOf(end) ? kv.starts : null
    if (starts) title = `${title} (starts ${starts})`.slice(0, 120)
    const types = trainingTypes(rows.planning)
    const type = kv.type ? findItem(activeTypes(types), kv.type)?.key ?? null : null
    if (kv.type && !type) return { problem: `“${kv.type}” isn’t one of your training types (${activeTypes(types).map((x) => x.label.toLowerCase()).join(', ')})` }
    const placeName = (kv.place ?? '').slice(0, 80)
    const place = placeName ? (rows.places ?? []).find((p) => p.name.toLowerCase() === placeName.toLowerCase()) ?? null : null
    const when = arrive ? `be there ${a.time}, ends ${end}` : `${a.time}–${end}`
    // a place_new in the same card already says it's new
    const listed = ((a as Raw & { placeNews?: string[] }).placeNews ?? []).some((n) => n.toLowerCase() === placeName.toLowerCase())
    return { action: {
      op, table: 'events', id: null, title,
      line: `📅 New: <b>${esc(title)}</b> every ${names} ${when}${placeName ? ` at ${esc(place?.name ?? placeName)}${place || listed ? '' : ' (new place)'}` : ''}`
        + `${type ? ` · ${esc(labelOf(type, types))}` : ''}${from > today ? ` from ${day(from)}` : ''}${travel ? ` (+${travel} min travel each way)` : ''}`,
      patch: { title, repeat_days: days, start_time: a.time, end_time: end, repeat_from: from, is_busy: true, travel_minutes: travel,
        ...(type ? { training_type: type, load: defaultLoad(type, types) } : {}),
        ...(place ? { place_id: place.id } : placeName ? { new_place: placeName } : {}) },
    } }
  }

  if (op === 'setting') {
    // value "dayEnd=22:00" (lib/settings.ts has the list)
    const [key, raw] = (a.value ?? '').split('=').map((x) => x.trim())
    if (!SETTINGS[key ?? '']) return { problem: `“${key}” isn’t a setting I can change` }
    const value = parseSetting(key, raw ?? '', rows.planning)
    if (value === null) return { problem: `“${raw}” doesn’t work for “${SETTINGS[key].label}”` }
    const now = currentSettings(rows.planning)[key]
    if (now === value) return { problem: `“${SETTINGS[key].label}” is already ${showSetting(key, value)}` }
    return { action: { op, table: 'profiles', id: key, title: SETTINGS[key].label, line: `⚙️ ${esc(SETTINGS[key].label)}: ${esc(showSetting(key, now))} → <b>${esc(showSetting(key, value))}</b>`, patch: { [key]: value } } }
  }

  // his set-up (Build O): one key of profiles.planning each (lib/setup-edit.ts checks them)
  if (op === 'setup_set' || op === 'owen_days' || op === 'game_week' || op === 'session_ignore' || op === 'upper_week') {
    const v = a.value ?? ''
    if (op === 'game_week' && /date=/.test(v) && !grounded(a.words)) return { problem: 'the game’s day wasn’t in your words' }
    const r = op === 'setup_set' ? (/^\s*place\s*=/i.test(v) ? placeChange(v, rows.planning) : sessionChange(v, rows.planning))
      : op === 'owen_days' ? owenChange(v, rows.planning)
      : op === 'game_week' ? gameChange(v, rows.planning, today)
      : op === 'upper_week' ? upperWeekChange(v, rows.planning, today)
      : ignoreChange(v, rows.planning, rows.titles ?? [])
    if (r.problem || !r.change) return { problem: r.problem ?? 'nothing to change' }
    return { action: { op, table: 'profiles', id: r.change.key, title: r.change.title, line: r.change.line, patch: r.change.patch } }
  }
  if (op === 'focus_period') {
    if (!/clear\s*=/i.test(a.value ?? '') && !grounded(a.words)) return { problem: 'the focus’s end date wasn’t in your words' }
    const r = focusChange(a.value ?? '', rows.planning, today)
    if (r.problem || !r.change) return { problem: r.problem ?? 'nothing to change' }
    return { action: { op, table: 'profiles', id: r.change.key, title: r.change.title, line: r.change.line, patch: r.change.patch } }
  }
  if (op === 'gap_done') return { problem: 'not something to change by chat' }

  // a plan block: "move study to 5pm", "physics homework to Thursday", "skip gym today"
  if (op === 'block_move' || op === 'block_skip') {
    const b = ref?.kind === 'block' ? rows.blocks?.get(ref.id) : null
    if (!b || b.status !== 'planned') return { problem: 'couldn’t find that block in your plan' }
    if (op === 'block_skip') return { action: { op, table: 'plan_blocks', id: b.id, title: b.title, line: `🗓 <b>${esc(b.title)}</b> ${day(b.on_date)} ${b.start_time.slice(0, 5)}: → skipped <i>(the week re-fits around it)</i>`, patch: { status: 'cancelled' } } }
    const to = isDate(a.date_to) ? a.date_to : isDate(a.date) ? a.date : b.on_date
    const len = minutesOf(b.end_time.slice(0, 5)) - minutesOf(b.start_time.slice(0, 5))
    const start = isTime(a.time) ? a.time : b.start_time.slice(0, 5)
    const end = isTime(a.time_to) && minutesOf(a.time_to) > minutesOf(start) ? a.time_to : hm(Math.min(minutesOf(start) + len, 23 * 60 + 59))
    if (to < today) return { problem: 'that day has passed' }
    if ((to !== b.on_date || start !== b.start_time.slice(0, 5)) && !grounded(a.words)) return { problem: `the new time for “${b.title}” wasn’t in your words` }
    if (to === b.on_date && start === b.start_time.slice(0, 5)) return { problem: `“${b.title}” is already then` }
    return { action: { op, table: 'plan_blocks', id: b.id, title: b.title, line: `🗓 <b>${esc(b.title)}</b>: ${day(b.on_date)} ${b.start_time.slice(0, 5)} → <b>${day(to)} ${start}–${end}</b>`, patch: { on_date: to, start_time: start, end_time: end } } }
  }
  if (op === 'restore') {
    const t = ref?.kind === 'archived' ? rows.archived?.get(ref.id) : null
    if (!t || !t.archived_at) return { problem: 'couldn’t find that in your Archive' }
    return { action: { op, table: 'tasks', id: t.id, title: t.title, line: `♻️ <b>${esc(t.title)}</b>: Archive → Inbox`, patch: { status: 'inbox', completed_at: null, archived_at: null, archive_reason: null } } }
  }
  if (op === 'subject_new') {
    const kv = kvOf(a.value)
    const name = (kv.name ?? '').slice(0, 60)
    if (!name) return { problem: 'what’s the subject called?' }
    if ((rows.subjects ?? []).some((x) => !x.archived_at && x.name.toLowerCase() === name.toLowerCase())) return { problem: `you already have ${name}` }
    const cats = rows.categories ?? []
    const cat = cats.find((c) => c.name.toLowerCase() === (kv.area ?? '').toLowerCase()) ?? cats.find((c) => c.name === 'Study') ?? cats[0]
    if (!cat) return { problem: 'which area (Study, Athletic, Personal)?' }
    return { action: { op, table: 'subjects', id: null, title: name, line: `📚 New subject: <b>${esc(name)}</b> <i>(${esc(cat.name)})</i>`, patch: { name, category_id: cat.id, sort_order: (rows.subjects ?? []).length } } }
  }
  if (op === 'target_new') {
    const kv = kvOf(a.value)
    const name = (kv.name ?? '').slice(0, 80)
    const n = Number(kv.count ?? '1')
    if (!name) return { problem: 'what’s the weekly target called?' }
    if (!Number.isInteger(n) || n < 1 || n > 30) return { problem: 'how many a week (1–30)?' }
    const tt = (kv.type ?? '').toLowerCase()
    const type = tt ? (findItem(activeTypes(trainingTypes(rows.planning)), tt)?.key ?? (tt === 'none' ? NOT_TRAINING : null)) : null
    return { action: { op, table: 'weekly_targets', id: null, title: name, line: `🎯 New weekly target: <b>${esc(name)}</b> ${n}× a week${type && type !== NOT_TRAINING ? ` <i>(${esc(type)})</i>` : ''}`,
      patch: { name, target_count: n, counts_from: 'logs', is_active: true, sort_order: 99, ...(type ? { training_type: type } : {}) } } }
  }
  if (op === 'guide_set') {
    const kv = kvOf(a.value)
    const g = kv.guide ? matchName((rows.guides ?? []).map((x) => ({ ...x, name: x.title })), kv.guide) : null
    if (!g) return { problem: `which guide${kv.guide ? ` (no guide called “${kv.guide}”)` : ''}?` }
    if (!/^(yes|no|true|false)$/i.test(kv.archive ?? '')) return { problem: 'archive it, or bring it back?' }
    const yes = /^(yes|true)$/i.test(kv.archive)
    return { action: { op, table: 'guides', id: g.id, title: g.title, line: `📖 <b>${esc(g.title)}</b>: → ${yes ? 'archived <i>(can be restored)</i>' : 'back in your guides'}`, patch: { archived_at: yes ? '__now__' : null } } }
  }
  if (op === 'school_day') {
    // "school ends at 15:30 on Wednesdays": that weekday gets its own times (the weekly School event is split)
    const kv = kvOf(a.value)
    const dow = weekdayOf(kv.day ?? '')
    if (!dow) return { problem: 'which day of the week?' }
    const school = [...rows.events.values()].find((e) => !e.archived_at && e.external_source !== 'google' && isSchool(e) && isRepeating(e) && e.repeat_days!.includes(dow))
    if (!school) return { problem: `there’s no school event of yours on ${DAY_NAMES[dow - 1]} (school from Google changes in Google)` }
    const start = isTime(kv.start ?? '') ? kv.start : school.start_time!.slice(0, 5), end = isTime(kv.end ?? '') ? kv.end : school.end_time?.slice(0, 5) ?? null
    if (!end || minutesOf(end) <= minutesOf(start)) return { problem: 'what time does it end?' }
    if (start === school.start_time!.slice(0, 5) && end === school.end_time?.slice(0, 5)) return { problem: `school on ${DAY_NAMES[dow - 1]} is already ${start}–${end}` }
    return { action: { op, table: 'events', id: school.id, title: school.title, line: `🏫 <b>${esc(school.title)}</b> on ${DAY_NAMES[dow - 1]}: ${school.start_time!.slice(0, 5)}–${school.end_time?.slice(0, 5) ?? '?'} → <b>${start}–${end}</b>`, patch: { day: dow, start, end } } }
  }

  if (op === 'event_move' || op === 'event_cancel') {
    const ev = ref?.kind === 'event' ? rows.events.get(ref.id) : null
    if (!ev || ev.archived_at) return { problem: 'couldn’t find that event' }
    if ((ev as EventRow & { external_source?: string }).external_source === 'google') return { problem: `“${ev.title}” is on your Google calendar, so I can’t change it` }
    const every = (a.value ?? '').trim().toLowerCase() === 'every'
    const o = findSession(ev, rows.changes, isDate(a.date) ? a.date : null, today)
    const name = `<b>${esc(ev.title)}</b>`

    if (op === 'event_cancel') {
      if (every || !isRepeating(ev)) {
        return { action: { op, table: 'events', id: ev.id, title: ev.title, line: `${name}: → cancelled${isRepeating(ev) ? ' every week' : ''} <i>(archived, can be restored)</i>`, patch: { archived_at: '__now__' } } }
      }
      if (!o) return { problem: `couldn’t find that session of “${ev.title}”` }
      if (o.cancelled) return { problem: `“${ev.title}” on ${day(o.date)} is already cancelled` }
      return { action: { op, table: 'event_exceptions', id: ev.id, title: ev.title, usualDate: o.usualDate,
        line: `${name} ${day(o.date)} ${esc(timeRange(o))}: → cancelled <i>(just this week)</i>`,
        patch: { cancelled: true, new_date: o.change?.new_date ?? null, new_start: o.change?.new_start ?? null, new_end: o.change?.new_end ?? null } } }
    }

    // event_move
    if (!o) return { problem: `couldn’t find that session of “${ev.title}”` }
    const toDate = isDate(a.date_to) ? a.date_to : o.date
    const start = isTime(a.time) ? a.time : o.start
    if (!start) return { problem: `no new time for “${ev.title}”` }
    if ((toDate !== o.date || start !== o.start) && !grounded(a.words)) return { problem: `the new day/time for “${ev.title}” wasn’t in your words` }
    if (toDate < today) return { problem: `that day has passed` }
    const len = o.start && o.end ? minutesOf(o.end) - minutesOf(o.start) : 60
    const end = isTime(a.time_to) ? a.time_to : hm(Math.min(minutesOf(start) + Math.max(len, 15), 23 * 60 + 59))
    if (minutesOf(end) <= minutesOf(start)) return { problem: 'the end has to be after the start' }
    if (toDate === o.date && start === o.start && end === o.end) return { problem: `“${ev.title}” is already then` }
    const was = `${day(o.date)} ${timeRange(o)}`
    const now = `${day(toDate)} ${start}–${end}`

    if (!isRepeating(ev)) {
      return { action: { op, table: 'events', id: ev.id, title: ev.title, line: `${name}: ${esc(was)} → ${esc(now)}`,
        patch: { starts_at: zonedToUTC(toDate, start), ends_at: zonedToUTC(toDate, end) } } }
    }
    if (every) {
      const from = isoDow(o.usualDate), to = isoDow(toDate)
      const days = [...new Set(ev.repeat_days!.map((d) => (d === from ? to : d)))].sort()
      return { action: { op, table: 'events', id: ev.id, title: ev.title, line: `${name}: ${esc(was)} → ${esc(now)} <i>(every week)</i>`,
        patch: { start_time: start, end_time: end, repeat_days: days } } }
    }
    return { action: { op, table: 'event_exceptions', id: ev.id, title: ev.title, usualDate: o.usualDate, line: `${name}: ${esc(was)} → ${esc(now)} <i>(just this week)</i>`,
      patch: { cancelled: false, new_date: toDate !== o.usualDate ? toDate : null, new_start: start, new_end: end } } }
  }

  // places and travel: "football is at Hackney Marshes", "school to football is 25 min by bus"
  const placeNamed = (name: string) => (rows.places ?? []).find((p) => p.name.toLowerCase() === name.trim().toLowerCase()) ?? null
  if (op === 'place_new') {
    const kv = kvOf(a.value)
    const name = (kv.name ?? '').slice(0, 80)
    if (!name) return { problem: 'a place needs a name' }
    if (placeNamed(name)) return { problem: `you already have a place called “${name}”` }
    const home = /^(yes|true|y)$/i.test(kv.home ?? '')
    if (home && (rows.places ?? []).some((p) => p.is_home)) return { problem: `you already have a home place (${(rows.places ?? []).find((p) => p.is_home)!.name})` }
    return { action: { op, table: 'places', id: null, title: name, line: `📍 New place: <b>${esc(name)}</b>${kv.address ? ` (${esc(kv.address.slice(0, 120))})` : ''}${home ? ' · home' : ''}`,
      patch: { name, address: kv.address?.slice(0, 200) ?? null, is_home: home } } }
  }
  if (op === 'event_place') {
    const ev = ref?.kind === 'event' ? rows.events.get(ref.id) : null
    if (!ev) return { problem: 'couldn’t find that event' }
    const name = (a.value ?? '').trim().slice(0, 80)
    if (!name) return { problem: `which place is “${ev.title}” at?` }
    const p = placeNamed(name)
    const was = (rows.places ?? []).find((x) => x.id === (ev as EventRow & { place_id?: string | null }).place_id)?.name ?? 'no place'
    const madeHere = (a as Raw & { sameCardPlaces?: string[] }).sameCardPlaces?.some((n) => n.toLowerCase() === name.toLowerCase())
    return { action: { op, table: 'events', id: ev.id, title: ev.title, line: `📍 <b>${esc(ev.title)}</b>: ${esc(was)} → ${esc(p?.name ?? name)}${p || madeHere ? '' : ' (new place)'}`,
      patch: p ? { place_id: p.id } : { place_id: null, new_place: name } } }
  }
  if (op === 'travel_set') {
    const kv = kvOf(a.value)
    // a new place named like an event that has no place yet ("an Uber to the match") is that event's place
    const linkable = (name: string) => [...rows.events.values()].find((e) => !e.archived_at && !(e as EventRow & { place_id?: string | null }).place_id && e.title.toLowerCase() === name.toLowerCase())
    const from = (kv.from ?? '').slice(0, 80), to = (kv.to ?? '').slice(0, 80)
    const mode = ['walk', 'bus', 'tube', 'train', 'transit', 'car', 'uber', 'cycle'].includes((kv.mode ?? '').toLowerCase()) ? kv.mode.toLowerCase() : 'any'
    const car = mode === 'uber' || mode === 'car'
    if (!from || !to || from.toLowerCase() === to.toLowerCase()) return { problem: 'a journey needs two different places' }
    // "15-20" or "20"; the wait for the car "0-8" (Uber only); "day=wed" for one weekday only
    const mins = rangeOf(kv.minutes, 1, 300), wait = car && kv.wait ? rangeOf(kv.wait, 0, 60) : null
    if (!mins) return { problem: `no clear time for ${from} → ${to}` }
    if (car && kv.wait && !wait) return { problem: `no clear wait for the Uber (${kv.wait})` }
    const weekday = kv.day ? weekdayOf(kv.day) : null
    if (kv.day && !weekday) return { problem: `“${kv.day}” isn’t a day of the week` }
    // places made by another change in this card (a new session's place) aren't new here
    const madeHere = (a as Raw & { sameCardPlaces?: string[] }).sameCardPlaces ?? []
    const fresh = [from, to].filter((n) => !placeNamed(n) && !madeHere.some((m) => m.toLowerCase() === n.toLowerCase()))
    const links = fresh.map((n) => ({ name: n, ev: linkable(n) })).filter((x) => x.ev).map((x) => ({ place: x.name, event_id: x.ev!.id, title: x.ev!.title }))
    const time = `${mins.lo === mins.hi ? mins.hi : `${mins.lo}–${mins.hi}`} min${mode !== 'any' ? ` ${modeWords(mode)}` : ''}${wait ? ` + ${wait.lo === wait.hi ? wait.hi : `${wait.lo}–${wait.hi}`} min wait` : ''}`
    return { action: { op, table: 'travel_times', id: null, title: `${from} → ${to}`,
      line: `${car ? '🚕' : '🚌'} <b>${esc(placeNamed(from)?.name ?? from)} → ${esc(placeNamed(to)?.name ?? to)}</b>${weekday ? ` (${DAY_NAMES[weekday - 1]})` : ''}: ${time}${car ? ' <i>(leave-by uses the slow end)</i>' : ''}${fresh.length ? ` <i>(new place${fresh.length > 1 ? 's' : ''}: ${esc(fresh.join(', '))}${links.length ? `; ${esc(links.map((l) => l.title).join(', '))} ${links.length > 1 ? 'are' : 'is'} there` : ''})</i>` : ''}`,
      patch: { from, to, mode, links, weekday, minutes: mins.hi, minutes_low: mins.lo < mins.hi ? mins.lo : null, wait_low: wait?.lo ?? null, wait_high: wait?.hi ?? null } } }
  }

  const types = trainingTypes(rows.planning)
  if (op === 'training_type') {
    // value: "sprint", "sprint hard" or "upper light" (a type's key or its name)
    const words = (a.value ?? '').toLowerCase().trim()
    const l = /\b(hard|heavy|moderate|light)$/.exec(words)?.[1]
    const said = words.replace(/\s*\b(hard|heavy|moderate|light)$/, '').trim()
    const t = said === NOT_TRAINING || said === 'not training' ? NOT_TRAINING : findItem(activeTypes(types), said)?.key ?? said
    if (!isTrainingType(t, types) && t !== NOT_TRAINING) return { problem: `“${a.value}” isn’t one of your training types (${activeTypes(types).map((x) => x.label.toLowerCase()).join(', ')}, or none)` }
    const load = t === NOT_TRAINING ? null : l === 'light' ? 'light' : l === 'moderate' ? 'moderate' : l === 'hard' || l === 'heavy' ? 'hard' : defaultLoad(t, types)
    const rec = ref?.kind === 'event' ? rows.events.get(ref.id) : ref?.kind === 'target' ? rows.targets?.get(ref.id) : null
    if (!rec && !ref && a.words) {
      // a Google calendar session (no ref): by its name, every copy of it ("Games isn't a match")
      const want = a.words.toLowerCase().trim()
      const names = rows.titles ?? []
      const title = names.find((n) => n.toLowerCase() === want) ?? names.find((n) => n.toLowerCase().includes(want))
      if (!title) return { problem: `there’s no session called “${a.words}” in your calendar` }
      const guess = typeOf({ title }, types)
      return { action: { op, table: 'events', id: null, title,
        line: `🏃 <b>${esc(title)}</b> (every one in your calendar): ${guess ? `${esc(labelOf(guess.type, types))}` : 'not training'} → ${load ? `${esc(labelOf(t, types))} (${load === 'hard' ? 'heavy' : load})` : 'not training'}`, patch: { training_type: t, load, by_title: title } } }
    }
    if (!rec) return { problem: 'couldn’t find that session or target' }
    const name = 'title' in rec ? rec.title : (rec as WeeklyTarget).name
    const was = typeOf(rec as never, types)
    return { action: { op, table: ref!.kind === 'event' ? 'events' : 'weekly_targets', id: rec.id, title: name,
      line: `🏃 <b>${esc(name)}</b>: ${was ? `${esc(labelOf(was.type, types))} (${was.load})` : 'not training'} → ${load ? `${esc(labelOf(t, types))} (${load})` : 'not training'}`, patch: { training_type: t, load } } }
  }

  if (op === 'rule_set' || op === 'rule_off' || op === 'rule_on') {
    const rules = rows.rules ?? []
    const idx = ref?.kind === 'rule' ? rules.findIndex((r, i) => (r.id ?? `default:${i}`) === ref.id) : -1
    if (op !== 'rule_set' || ref?.kind === 'rule') { if (idx < 0) return { problem: 'couldn’t find that training rule' } }
    if (op === 'rule_off' || op === 'rule_on') {
      const r = rules[idx]
      if (r.enabled === (op === 'rule_on')) return { problem: `“${r.label}” is already ${op === 'rule_on' ? 'on' : 'off'}` }
      return { action: { op, table: 'training_rules', id: `${idx}`, title: r.label, line: `📏 ${esc(r.label)}: ${op === 'rule_on' ? 'off → on' : 'on → off'}`, patch: { enabled: op === 'rule_on' } } }
    }
    // rule_set, value "what=plyo; near=match; side=both; days=1; label=…"
    const kv = Object.fromEntries((a.value ?? '').split(';').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x.length === 2))
    const list = (v?: string) => (v ?? '').toLowerCase().split(/\s*(?:,|\bor\b|\band\b)\s*|\s+/).map((x) => findItem(types, x)?.key ?? x).filter((x) => isTrainingType(x, types))
    const what = list(kv.what), near = list(kv.near)
    const side = ['before', 'after', 'both'].includes(kv.side) ? kv.side as 'before' | 'after' | 'both' : 'before'
    const days = Math.min(Math.max(Number.parseInt(kv.days ?? '1', 10) || 1, 0), 3)
    if (!what.length || !near.length) return { problem: 'that rule needs which sessions and near which (e.g. no plyo near a match)' }
    // a guideline can apply only from an intensity up ("light lower is fine": load=moderate), be in hours, and be a preference
    const lv = (kv.load ?? '').toLowerCase()
    const minLoad = lv === 'light' ? 'light' : lv === 'moderate' || lv === 'medium' ? 'moderate' : lv === 'heavy' || lv === 'hard' ? 'hard' : undefined
    const hours = kv.hours ? Math.min(Math.max(Number.parseInt(kv.hours, 10) || 0, 1), 168) : undefined
    const strength = /^(prefer|soft|where possible)$/i.test(kv.strength ?? '') ? 'prefer' as const : undefined
    const when = hours ? `within ${hours} h` : `within ${days} day${days === 1 ? '' : 's'}`
    const label = (kv.label || `${strength ? 'Prefer no' : 'No'} ${minLoad ? `${minLoad === 'hard' ? 'heavy' : `${minLoad}+`} ` : ''}${what.join(' or ')} ${when} ${side === 'both' ? 'either side of' : side} ${near.join(' or ')}`).slice(0, 200)
    const rule: Rule = { kind: 'gap', what, near, side, days, label, enabled: true, ...(minLoad ? { minLoad } : {}), ...(hours ? { hours } : {}), ...(strength ? { strength } : {}) }
    return { action: { op, table: 'training_rules', id: idx >= 0 ? `${idx}` : null, title: label,
      line: idx >= 0 ? `📏 ${esc(rules[idx].label)} → <b>${esc(label)}</b>` : `📏 New rule: <b>${esc(label)}</b>`, patch: ruleToRow(rule, idx >= 0 ? idx : rules.length) } }
  }

  if (op === 'event_set') {
    // one field of an event, for good: "title=Computing tutor", "school=no"
    const ev = ref?.kind === 'event' ? rows.events.get(ref.id) : null
    if (!ev || ev.archived_at) return { problem: 'couldn’t find that event' }
    if ((ev as EventRow & { external_source?: string }).external_source === 'google') return { problem: `“${ev.title}” is on your Google calendar, so I can’t change it` }
    const kv = kvOf(a.value)
    if (kv.title !== undefined) {
      const title = kv.title.slice(0, 120)
      if (title === ev.title) return { problem: `it’s already called “${title}”` }
      return { action: { op, table: 'events', id: ev.id, title: ev.title, line: `📅 <b>${esc(ev.title)}</b> → <b>${esc(title)}</b> <i>(renamed)</i>`, patch: { title } } }
    }
    if (kv.school !== undefined) {
      const yes = /^(yes|true|y|on)$/i.test(kv.school), no = /^(no|false|n|off)$/i.test(kv.school)
      if (!yes && !no) return { problem: 'is it school or not?' }
      const was = isSchool(ev)
      if (was === yes && typeof ev.is_school === 'boolean') return { problem: `“${ev.title}” is already ${yes ? '' : 'not '}school` }
      return { action: { op, table: 'events', id: ev.id, title: ev.title,
        line: `🏫 <b>${esc(ev.title)}</b>: ${was ? 'school' : 'not school'}${typeof ev.is_school === 'boolean' ? '' : ' (guessed)'} → <b>${yes ? 'school' : 'not school'}</b> <i>(school nights and “after school” follow this)</i>`, patch: { is_school: yes } } }
    }
    if (kv.google !== undefined) {
      const yes = /^(yes|true|y|on)$/i.test(kv.google), no = /^(no|false|n|off)$/i.test(kv.google)
      if (!yes && !no) return { problem: 'should it be in Google Calendar or not?' }
      if ((ev.sync_google !== false) === yes) return { problem: `“${ev.title}” is already ${yes ? '' : 'not '}in your Life OS calendar` }
      return { action: { op, table: 'events', id: ev.id, title: ev.title, line: `📆 <b>${esc(ev.title)}</b>: ${yes ? 'not in Google → <b>in your Life OS Google calendar</b>' : 'in Google → <b>not in Google Calendar</b> <i>(taken out of Life OS)</i>'}`, patch: { sync_google: yes } } }
    }
    return { problem: `I can change an event’s name, whether it’s school or whether it’s in Google Calendar; “${a.value}” isn’t one of those` }
  }

  if (op === 'target_set') {
    // one field of a weekly target, for good: "name=Gym", "count=3", "bonus=4", "minutes=75"
    const t = ref?.kind === 'target' ? rows.targets?.get(ref.id) : null
    if (!t) return { problem: 'couldn’t find that weekly target' }
    const kv = kvOf(a.value)
    const name = `<b>${esc(t.name)}</b>`
    const n = (v: string, lo: number, hi: number) => { const x = Number(v); return Number.isInteger(x) && x >= lo && x <= hi ? x : null }
    if (kv.name !== undefined) {
      const next = kv.name.slice(0, 80)
      if (next === t.name) return { problem: `it’s already called “${next}”` }
      return { action: { op, table: 'weekly_targets', id: t.id, title: t.name, line: `🎯 ${name} → <b>${esc(next)}</b> <i>(renamed)</i>`, patch: { name: next } } }
    }
    if (kv.count !== undefined) {
      const c = n(kv.count, 1, 30)
      if (c === null) return { problem: `“${kv.count}” isn’t a weekly number I can use (1–30)` }
      if (c === t.target_count) return { problem: `“${t.name}” is already ${c} a week` }
      return { action: { op, table: 'weekly_targets', id: t.id, title: t.name, line: `🎯 ${name}: ${t.target_count} → <b>${c}</b> a week <i>(every week; “this week only” is a different change)</i>`, patch: { target_count: c } } }
    }
    if (kv.bonus !== undefined) {
      const c = /^(none|0|no)$/i.test(kv.bonus) ? null : n(kv.bonus, t.target_count + 1, 40)
      if (c === null && !/^(none|0|no)$/i.test(kv.bonus)) return { problem: `the bonus has to be more than the target (${t.target_count})` }
      return { action: { op, table: 'weekly_targets', id: t.id, title: t.name, line: `🎯 ${name} bonus: ${t.bonus_count ?? 'none'} → <b>${c ?? 'none'}</b>`, patch: { bonus_count: c } } }
    }
    if (kv.minutes !== undefined) {
      const m = n(kv.minutes, 10, 240)
      if (m === null) return { problem: `a session has to be 10–240 minutes` }
      const was = (t as WeeklyTarget & { session_minutes?: number | null }).session_minutes ?? 60
      return { action: { op, table: 'weekly_targets', id: t.id, title: t.name, line: `🎯 ${name} session: ${was} min → <b>${m} min</b>`, patch: { session_minutes: m } } }
    }
    if (kv.whoop !== undefined) {
      // which Whoop activities count toward it ("weightlifting, functional fitness"; "none")
      const list = /^(none|nothing|no)$/i.test(kv.whoop) ? [] : kv.whoop.split(/\s*,\s*/).map((x: string) => x.trim()).filter(Boolean).slice(0, 10).map((x: string) => x.slice(0, 40))
      const was = (t as WeeklyTarget & { whoop_sports?: string[] }).whoop_sports ?? []
      if (list.join(',').toLowerCase() === was.join(',').toLowerCase()) return { problem: `that’s already what counts for “${t.name}”` }
      return { action: { op, table: 'weekly_targets', id: t.id, title: t.name, line: `🎯 ${name} counts Whoop: ${esc(was.join(', ') || 'nothing')} → <b>${esc(list.join(', ') || 'nothing')}</b>`, patch: { whoop_sports: list } } }
    }
    return { problem: `I can change a target’s name, weekly number, bonus, session length or Whoop activities; “${a.value}” isn’t one of those` }
  }

  if (op === 'list_edit') return checkListEdit(a.value, rows.planning, types)

  if (op === 'stage_set' || op === 'topic_new' || op === 'topic_set' || op === 'mistake_done') return checkStudy(op, a, ref, rows)
  if (op === 'topic_status') return checkTopicStatus(a, rows)
  if (op === 'guide_log' || op === 'guide_note') {
    // "guide=Athletic & Lower; text=…": this week's log entry, or a line added to the guide
    const kv = Object.fromEntries((a.value ?? '').split(/;\s*(?=(?:guide|text)=)/).map((x) => { const j = x.indexOf('='); return [x.slice(0, j).trim(), x.slice(j + 1).trim()] }))
    const g = kv.guide ? matchName((rows.guides ?? []).map((x) => ({ ...x, name: x.title })), kv.guide) : null
    if (!g) return { problem: `which guide${kv.guide ? ` (no guide called “${kv.guide}”)` : ''}?` }
    const text = (kv.text ?? '').slice(0, 2000)
    if (!text) return { problem: `what should go in “${g.title}”?` }
    if (op === 'guide_log') {
      if (!g.has_log) return { problem: `“${g.title}” has no weekly log (turn it on in the guide: Edit → Weekly log)` }
      return { action: { op, table: 'guide_logs', id: g.id, title: g.title, line: `📒 <b>${esc(g.title)}</b> log, week of ${esc(day(weekStartISO(today)))}: + ${esc(text)}`, patch: { guide_id: g.id, week_start: weekStartISO(today), body: text } } }
    }
    return { action: { op, table: 'guides', id: g.id, title: g.title, line: `📖 <b>${esc(g.title)}</b>: + “${esc(text)}” <i>(added at the end)</i>`, patch: { body: `${g.body.trimEnd()}\n\n${text}` } } }
  }

  if (op === 'load_set') {
    // a recovery cost: "type=match; all=max", "session=EFA football; day=wed; cns=high", "type=upper; reset=yes"
    const kv = kvOf(a.value)
    const costs = rows.costs ?? []
    const typeKey = kv.type ? findItem(activeTypes(types), kv.type.toLowerCase())?.key ?? (isTrainingType(kv.type.toLowerCase(), types) ? kv.type.toLowerCase() : null) : null
    if (kv.type && !typeKey) return { problem: `“${kv.type}” isn’t one of your training types (${activeTypes(types).map((x) => x.label.toLowerCase()).join(', ')})` }
    let title: string | null = null
    if (!typeKey) {
      const want = (kv.session ?? '').toLowerCase().trim()
      if (!want) return { problem: 'which training type or session is the load for?' }
      const names = [...new Set(rows.titles ?? [])]
      title = names.find((n) => n.toLowerCase() === want) ?? names.find((n) => n.toLowerCase().includes(want) || want.includes(n.toLowerCase())) ?? null
      if (!title) return { problem: `there’s no session called “${kv.session}” in your calendar` }
    }
    const weekday = kv.day ? weekdayOf(kv.day) : null
    if (kv.day && !weekday) return { problem: `“${kv.day}” isn’t a day of the week` }
    const old = typeKey ? costs.find((c) => c.scope === 'type' && c.type_key === typeKey) ?? null
      : costs.find((c) => c.scope === 'session' && c.title?.toLowerCase() === title!.toLowerCase() && (c.weekday ?? null) === weekday) ?? null
    const name = typeKey ? `${labelOf(typeKey, types)} (heavy)` : `${title}${weekday ? ` on ${DAY_NAMES[weekday - 1]}` : ''}`
    const now = typeKey ? typeCost(typeKey, costs) : old ?? sessionOverride(title!, addDays(today, ((weekday ?? isoDow(today)) - isoDow(today) + 7) % 7), costs) ?? DEFAULT_COSTS[typeOf({ title: title! }, types)?.type ?? 'other'] ?? { legs: 4, upper: 4, cns: 4 }
    const words = (c: { legs: number; upper: number; cns: number }) => `legs ${c.legs} · upper ${c.upper} · CNS ${c.cns}`
    if (/^(yes|true|y)$/i.test(kv.reset ?? '')) {
      if (!old) return { problem: `${name} already uses the ${typeKey ? 'default' : 'type’s'} load` }
      const back = typeKey ? DEFAULT_COSTS[typeKey] ?? { legs: 4, upper: 4, cns: 4 } : null
      return { action: { op, table: 'load_costs', id: old.id!, title: name, line: `⚖️ ${esc(name)}: ${words(old)} → <b>${back ? words(back) : 'its type’s load'}</b> <i>(back to the default)</i>`, patch: { archived_at: '__now__' } } }
    }
    const level = (k: 'legs' | 'upper' | 'cns') => { const v = kv[k] ?? kv.all; return v === undefined ? now[k] : levelWord(v) }
    const next = { legs: level('legs'), upper: level('upper'), cns: level('cns') }
    if (next.legs === null || next.upper === null || next.cns === null) return { problem: 'loads are 0–10, or low / medium / high / max' }
    // his own 🧠 number for it ("the SMC mock is max mental": build-o.sql)
    const wasMental = (old as (CostRow & { mental?: number | null }) | null)?.mental ?? null
    const mental = kv.mental !== undefined ? levelWord(kv.mental) : wasMental
    if (kv.mental !== undefined && mental === null) return { problem: 'mental load is 0–10, or low / medium / high / max' }
    if (next.legs === now.legs && next.upper === now.upper && next.cns === now.cns && mental === wasMental) return { problem: `${name} is already ${words(now)}${mental != null ? ` · 🧠 ${mental}` : ''}` }
    return { action: { op, table: 'load_costs', id: old?.id ?? null, title: name,
      line: `⚖️ <b>${esc(name)}</b>: ${words(now)}${wasMental != null ? ` · 🧠 ${wasMental}` : ''} → <b>${words(next as { legs: number; upper: number; cns: number })}${mental != null ? ` · 🧠 ${mental}` : ''}</b>${typeKey ? ' <i>(light and moderate scale from this)</i>' : ''}`,
      patch: { scope: typeKey ? 'type' : 'session', type_key: typeKey, title, weekday, ...next, ...(mental != null ? { mental } : {}) } } }
  }

  if (op === 'mail_rule') {
    // the email watcher's rules: "from=@ucs.org.uk; do=flag; label=ucs.org.uk teachers", "do=ignore", "do=off"
    const kv = kvOf(a.value)
    const pattern = cleanPattern(kv.from ?? '')
    if (!pattern) return { problem: 'which sender, domain (@…) or words should the email rule be about?' }
    const act = (kv.do ?? '').toLowerCase()
    if (!['flag', 'ignore', 'off'].includes(act)) return { problem: `flag emails from “${pattern}”, ignore them, or remove the rule?` }
    const rules = rows.mailRules ?? []
    const old = rules.find((r) => r.pattern.toLowerCase() === pattern.toLowerCase())
    const label = (kv.label ?? '').slice(0, 120) || null
    if (act === 'off') {
      if (!old) return { problem: `you have no email rule for “${pattern}”${rules.length ? ` (yours: ${rules.map((r) => r.pattern).join(', ')})` : ''}` }
      return { action: { op, table: 'mail_rules', id: old.id, title: old.pattern, line: `📧 Email rule off: <s>${esc(ruleWords(old))}</s>`, patch: { archived_at: '__now__' } } }
    }
    const next = { pattern, action: act as MailRule['action'], label: label ?? old?.label ?? null }
    if (old && old.action === act) return { problem: `you already ${ruleWords(old)}` }
    if (old) return { action: { op, table: 'mail_rules', id: old.id, title: pattern, line: `📧 ${esc(ruleWords(old))} → <b>${esc(ruleWords(next))}</b>`, patch: { action: act, label: next.label } } }
    return { action: { op, table: 'mail_rules', id: null, title: pattern, line: `📧 New email rule: <b>${esc(ruleWords(next))}</b> <i>(from the next emails)</i>`, patch: next } }
  }

  if (op === 'calendar_set') {
    // which of his Google calendars the app reads, and which one is school: "calendar=School; read=no"
    if (!rows.google) return { problem: 'Google Calendar isn’t connected (Settings → Google Calendar → Connect)' }
    const kv = kvOf(a.value)
    const want = (kv.calendar ?? '').toLowerCase()
    const c = rows.google.calendars.find((x) => x.name.toLowerCase() === want) ?? rows.google.calendars.find((x) => want && x.name.toLowerCase().includes(want))
    if (!c) return { problem: `you have no Google calendar called “${kv.calendar ?? ''}” (yours: ${rows.google.calendars.map((x) => x.name).join(', ') || 'none yet'})` }
    const flag = (v?: string) => (v === undefined ? undefined : /^(yes|true|y|on)$/i.test(v) ? true : /^(no|false|n|off)$/i.test(v) ? false : null)
    const read = flag(kv.read), school = flag(kv.school)
    if (read === null || school === null || (read === undefined && school === undefined)) return { problem: 'read it or not, school or not?' }
    const next = { ...c, ...(read !== undefined ? { read } : {}), ...(school !== undefined ? { school } : {}) }
    if (next.read === c.read && next.school === c.school) return { problem: `“${c.name}” is already like that` }
    const words = (x: GoogleCalRow) => (x.read ? `read${x.school ? ', school' : ''}` : 'not read')
    return { action: { op, table: 'integrations', id: rows.google.id, title: c.name, line: `📆 Google calendar <b>${esc(c.name)}</b>: ${words(c)} → <b>${words(next)}</b> <i>(from the next sync)</i>`,
      patch: { calendars: rows.google.calendars.map((x) => (x.id === c.id ? next : x)) } } }
  }

  // tests and goals
  const g = ref?.kind === 'goal' ? rows.goals.get(ref.id) : null
  if (!g || g.archived_at) return { problem: 'couldn’t find that test or goal' }
  const name = `<b>${esc(g.title)}</b>`
  if (op === 'goal_archive') return { action: { op, table: 'goals', id: g.id, title: g.title, line: `${name}: → archived <i>(its tasks stay open; can be restored)</i>`, patch: { archived_at: '__now__' } } }
  if (op === 'goal_topics') {
    const topics = (a.value ?? '').trim().slice(0, 500)
    if (!topics || topics === g.topics) return { problem: `no new topics for “${g.title}”` }
    return { action: { op, table: 'goals', id: g.id, title: g.title, line: `${name} topics: ${esc(g.topics || 'none')} → ${esc(topics)}`, patch: { topics } } }
  }
  // test_date
  if (g.kind !== 'test') return { problem: `“${g.title}” isn’t a test` }
  if (!isDate(a.date) || a.date < today) return { problem: `no clear new date for “${g.title}”` }
  if (!grounded(a.words)) return { problem: `the date for “${g.title}” wasn’t in your words` }
  if (a.date === g.target_date) return { problem: `“${g.title}” is already on ${day(a.date)}` }
  return { action: { op, table: 'goals', id: g.id, title: g.title, line: `📝 ${name}: ${g.target_date ? day(g.target_date) : 'no date'} → ${day(a.date)} <i>(its prep sessions re-plan)</i>`, patch: { target_date: a.date } } }
}

/**
 * His own lists ("sources" = where tasks come from; "types" = training types). value like
 * "list=sources; item=Physics tutor (Vlad)" (adds it, or finds it), plus "label=new name" or "archive=yes";
 * for types also "words=swim, pool", "load=light", "placeable=yes". Nothing is removed: archived items stay so old
 * records keep their name. The whole new list is the patch (one key of profiles.planning, like a setting).
 */
export function checkListEdit(value: string, planning: unknown, types: TypeDef[]): { action?: C2Action; problem?: string } {
  const kv = Object.fromEntries((value ?? '').split(';').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x.length === 2 && x[1]))
  const which = (kv.list ?? '').toLowerCase()
  const item = (kv.item ?? '').slice(0, 60)
  if (!item) return { problem: 'which item of the list?' }
  const yes = (v?: string) => /^(yes|true|y|on)$/i.test(v ?? '')
  const no = (v?: string) => /^(no|false|n|off)$/i.test(v ?? '')
  if (which === 'sources' || which === 'source') {
    const list: Source[] = taskSources(planning).map((x) => ({ ...x }))
    const found = findItem(list, item)
    let line: string
    if (!found) {
      if (yes(kv.archive)) return { problem: `you have no task source called “${item}”` }
      const label = (kv.label || item).slice(0, 60)
      list.push({ key: newKey(label, list.map((x) => x.key)), label })
      line = `📥 New task source: <b>${esc(label)}</b>`
    } else if (yes(kv.archive)) {
      if (found.key === 'own') return { problem: '“Own” is always there' }
      if (found.archived) return { problem: `“${found.label}” is already archived` }
      found.archived = true
      line = `📥 Task source <b>${esc(found.label)}</b> → archived <i>(old tasks keep it)</i>`
    } else if (kv.label && kv.label !== found.label) {
      line = `📥 Task source <b>${esc(found.label)}</b> → <b>${esc(kv.label.slice(0, 60))}</b>`
      found.label = kv.label.slice(0, 60)
      delete found.archived
    } else if (found.archived) {
      delete found.archived
      line = `📥 Task source <b>${esc(found.label)}</b> → back in use`
    } else return { problem: `you already have “${found.label}”` }
    return { action: { op: 'list_edit', table: 'profiles', id: 'sources', title: 'Task sources', line, patch: { sources: list } } }
  }
  if (which === 'types' || which === 'type' || which === 'training') {
    const list: TypeDef[] = types.map((x) => ({ ...x, words: [...x.words] }))
    const found = findItem(list, item)
    const words = kv.words ? kv.words.toLowerCase().split(/\s*,\s*/).map((w: string) => w.trim()).filter((w: string) => w.length >= 2).slice(0, 12) : null
    const load = kv.load === 'light' || kv.load === 'hard' ? kv.load : null
    const placeable = yes(kv.placeable) ? true : no(kv.placeable) ? false : null
    let line: string
    if (!found) {
      if (yes(kv.archive)) return { problem: `you have no training type called “${item}”` }
      const label = (kv.label || item).slice(0, 30)
      const def: TypeDef = { key: newKey(label, list.map((x) => x.key)), label, words: words ?? [label.toLowerCase()], placeable: placeable ?? true, load: load ?? 'hard' }
      list.push(def)
      line = `🏃 New training type: <b>${esc(label)}</b> (${def.load}; ${def.placeable ? 'the planner can fit it into free time' : 'only at set times from your calendar'}; spotted from: ${esc(def.words.join(', '))})`
    } else if (yes(kv.archive)) {
      if (found.archived) return { problem: `“${found.label}” is already archived` }
      found.archived = true
      line = `🏃 Training type <b>${esc(found.label)}</b> → archived <i>(sessions already set to it keep it)</i>`
    } else {
      const bits: string[] = []
      if (kv.label && kv.label !== found.label) { bits.push(`name → <b>${esc(kv.label.slice(0, 30))}</b>`); found.label = kv.label.slice(0, 30) }
      if (words && words.join(',') !== found.words.join(',')) { bits.push(`spotted from: ${esc(found.words.join(', ') || 'nothing')} → <b>${esc(words.join(', '))}</b>`); found.words = words }
      if (load && load !== found.load) { bits.push(`${found.load} → <b>${load}</b>`); found.load = load }
      if (placeable !== null && placeable !== found.placeable) { bits.push(placeable ? '→ <b>the planner can fit it into free time</b>' : '→ <b>only at set times from your calendar</b>'); found.placeable = placeable }
      if (found.archived) { bits.push('back in use'); delete found.archived }
      if (!bits.length) return { problem: `nothing new for “${found.label}”` }
      line = `🏃 Training type <b>${esc(item)}</b>: ${bits.join('; ')}`
    }
    return { action: { op: 'list_edit', table: 'profiles', id: 'trainingTypes', title: 'Training types', line, patch: { trainingTypes: list } } }
  }
  return { problem: `I can edit your task sources or training types; “${kv.list ?? ''}” isn’t one of those lists` }
}

/** Study pipelines by chat: the stages of a subject, new topics, a topic's notes link/name/archive, a mistake reviewed. */
function checkStudy(op: 'stage_set' | 'topic_new' | 'topic_set' | 'mistake_done', a: Raw, ref: { kind: string; id: string } | undefined, rows: C2Rows): { action?: C2Action; problem?: string } {
  const st = rows.study
  if (!st) return { problem: 'couldn’t read your study plan' }
  const kv = Object.fromEntries((a.value ?? '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? [x.trim(), ''] : [x.slice(0, i).trim(), x.slice(i + 1).trim()] }).filter((x) => x[0] && x[1]))
  const subject = kv.subject ? matchName(st.subjects, kv.subject) : null
  if (op === 'stage_set' || op === 'topic_new') {
    if (!subject) return { problem: `which subject${kv.subject ? ` (no subject called “${kv.subject}”)` : ''}?` }
    if (op === 'stage_set') {
      const stages = (kv.stages ?? '').split(/\s*(?:,|→|->)\s*/).map((x: string) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 15)
      if (!stages.length) return { problem: `what are the stages for ${subject.name}?` }
      const was = stagesOf(st.stages, subject.id).map((x) => x.name)
      if (was.join('|').toLowerCase() === stages.join('|').toLowerCase()) return { problem: `${subject.name}’s pipeline is already that` }
      return { action: { op, table: 'pipeline_stages', id: subject.id, title: subject.name,
        line: `📚 <b>${esc(subject.name)}</b> pipeline: ${esc(was.join(' → ') || 'none')} → <b>${esc(stages.join(' → '))}</b> <i>(progress kept for stages with the same name)</i>`, patch: { stages } } }
    }
    const topics = parseTopicLines((kv.topics ?? '').replace(/\s*,\s*/g, '\n')).map((t) => t.name)
    const have = new Set(st.topics.filter((t) => t.subject_id === subject.id).map((t) => t.name.toLowerCase()))
    const fresh = topics.filter((t) => !have.has(t.toLowerCase()))
    if (!fresh.length) return { problem: topics.length ? `${subject.name} already has those topics` : 'which topics?' }
    return { action: { op, table: 'topics', id: subject.id, title: subject.name, line: `📚 <b>${esc(subject.name)}</b>: + ${fresh.length} topic${fresh.length === 1 ? '' : 's'} (${esc(fresh.slice(0, 8).join(', '))}${fresh.length > 8 ? '…' : ''})`, patch: { topics: fresh } } }
  }
  if (op === 'mistake_done') {
    const m = ref?.kind === 'mistake' ? st.mistakes.find((x) => x.id === ref.id) : null
    if (!m || m.reviewed_at) return { problem: 'couldn’t find that mistake' }
    return { action: { op, table: 'mistakes', id: m.id, title: m.body, line: `🧠 ${esc(m.body)}: → reviewed`, patch: { reviewed_at: '__now__' } } }
  }
  // topic_set: by ref, or by name ("topic=Vectors; subject=Physics")
  const pool = st.topics.filter((t) => !t.archived_at && (!subject || t.subject_id === subject.id))
  const t = ref?.kind === 'topic' ? st.topics.find((x) => x.id === ref.id) : kv.topic ? matchName(pool, kv.topic) : null
  if (!t) return { problem: `which topic${kv.topic ? ` (no topic called “${kv.topic}”)` : ''}?` }
  if (kv.notes) {
    if (!/^https?:\/\/\S+$/i.test(kv.notes)) return { problem: 'the notes link has to be a web address (the GoodNotes PDF’s Google Drive link)' }
    return { action: { op, table: 'topics', id: t.id, title: t.name, line: `📓 <b>${esc(t.name)}</b> notes: ${t.notes_url ? 'a link' : 'none'} → <b>${esc(kv.notes.slice(0, 60))}${kv.notes.length > 60 ? '…' : ''}</b>`, patch: { notes_url: kv.notes.slice(0, 500) } } }
  }
  if (kv.name) return { action: { op, table: 'topics', id: t.id, title: t.name, line: `📚 <b>${esc(t.name)}</b> → <b>${esc(kv.name.slice(0, 120))}</b>`, patch: { name: kv.name.slice(0, 120) } } }
  if (/^(yes|true)$/i.test(kv.archive ?? '')) return { action: { op, table: 'topics', id: t.id, title: t.name, line: `📚 <b>${esc(t.name)}</b> → archived <i>(its progress stays)</i>`, patch: { archived_at: '__now__' } } }
  return { problem: 'I can set a topic’s notes link, rename it or archive it' }
}

/** A maths topic's colour: value "topics=trig; status=yellow", "subject=Maths; section=Book 1; chapters=1-13; status=green". */
function checkTopicStatus(a: Raw, rows: C2Rows): { action?: C2Action; problem?: string } {
  const st = rows.study
  if (!st) return { problem: 'couldn’t read your maths topics' }
  const kv = Object.fromEntries((a.value ?? '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? [x.trim(), ''] : [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()] }).filter((x) => x[0] && x[1]))
  const status = parseStatus(kv.status ?? '')
  if (!status) return { problem: `which colour (red, yellow, green, or not started)?` }
  const w: MathsWorld = { today: todayISO(), subjects: st.subjects, topics: st.topics as MathsTopic[], tasks: [], goals: [], settings: moreSettings(rows.planning) }
  const r = resolveTopics(w, { subject: kv.subject, section: kv.section, chapters: kv.chapters, topics: kv.topics })
  if (r.problem || !r.topics.length) return { problem: r.problem ?? 'which topics?' }
  const change = r.topics.filter((t) => statusOf(t) !== status)
  if (!change.length) return { problem: `${r.topics.length === 1 ? `“${r.topics[0].name}” is` : 'those are'} already ${DOT[status]}` }
  const names = change.map((t) => `${DOT[statusOf(t)]} ${t.name}`)
  return { action: { op: 'topic_status', table: 'topics', id: change[0].id, title: change.length === 1 ? change[0].name : `${change.length} topics`,
    line: `📐 ${esc(names.slice(0, 6).join(', '))}${names.length > 6 ? ` +${names.length - 6} more` : ''} → <b>${DOT[status]} ${STATUS_WORD[status]}</b>`, patch: { ids: change.map((t) => t.id), status } } }
}

// ---------------------------------------------------------------------------
// Apply and undo
// ---------------------------------------------------------------------------

export type C2Applied = { op: C2Op; table: C2Action['table']; id: string; title: string; before: Record<string, unknown> | null; after: Record<string, unknown>; usualDate?: string }

const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))
const CHANGE_KEYS = ['cancelled', 'new_date', 'new_start', 'new_end', 'missed']
const JOURNEY_KEYS = ['minutes', 'minutes_low', 'wait_low', 'wait_high']

async function readRow(sb: SupabaseClient, table: string, id: string) {
  const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle()
  if (error || !data) throw new Error(`Couldn’t find it any more (${error?.message ?? 'not found'})`)
  return data as Record<string, unknown>
}

async function session(sb: SupabaseClient, eventId: string, usualDate: string): Promise<{ ev: EventRow; o: Occurrence; row: Record<string, unknown> | null }> {
  const ev = (await readRow(sb, 'events', eventId)) as unknown as EventRow
  const { data, error } = await sb.from('event_exceptions').select('*').eq('event_id', eventId).eq('on_date', usualDate)
  if (error) throw new Error(error.message)
  // a wide window: a session moved this week can land on any day, and must still be found by its usual date
  const o = expandEvents([ev], addDays(usualDate, -60), addDays(usualDate, 60), (data ?? []) as EventException[]).find((x) => x.usualDate === usualDate)
  if (!o) throw new Error(`Couldn’t find that session of “${ev.title}”`)
  return { ev, o, row: (data?.[0] as Record<string, unknown>) ?? null }
}

/** The saved rule row for a rule's position (the defaults are written down the first time one changes). */
async function ruleRowId(sb: SupabaseClient, idx: number): Promise<string> {
  const { rules, saved } = await loadRules(sb)
  const list = saved ? rules : await saveDefaultRules(sb)
  const id = list[idx]?.id
  if (!id) throw new Error('Couldn’t find that training rule')
  return id
}

export async function applyC2(sb: SupabaseClient, a: C2Action, now: string, today: string): Promise<C2Applied> {
  const fill = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === '__now__' ? now : v]))
  if (a.op === 'training_type' && a.patch.by_title) {
    // every session with that name (Google copies of one weekly session); each one's old type kept for Undo
    const { data: same, error: e1 } = await sb.from('events').select('id,title,training_type,load').is('archived_at', null).ilike('title', String(a.patch.by_title).replace(/[%_]/g, '\\$&'))
    if (e1 || !same?.length) throw new Error(`Couldn’t find “${a.title}”: ${e1?.message ?? 'no sessions'}`)
    const { error } = await sb.from('events').update({ training_type: a.patch.training_type, load: a.patch.load }).in('id', same.map((r) => r.id as string))
    if (error) throw new Error(`Not saved: ${error.message}`)
    return { op: a.op, table: 'events', id: same[0].id as string, title: a.title, before: { rows: same.map((r) => ({ id: r.id, training_type: r.training_type ?? null, load: r.load ?? null })) }, after: { training_type: a.patch.training_type, load: a.patch.load, by_title: a.patch.by_title } }
  }
  if (a.op === 'place_new') {
    const { data, error } = await sb.from('places').insert(a.patch).select('id').single()
    if (error || !data) throw new Error(`Place not saved: ${error?.message ?? 'unknown error'}`)
    return { op: a.op, table: 'places', id: data.id, title: a.title, before: null, after: { archived_at: null } }
  }
  if (a.op === 'event_place' || a.op === 'travel_set') {
    // make (or find) the places it names; new ones are remembered so Undo can archive them
    const made: string[] = []
    const placeId = async (name: string) => {
      const { data: found } = await sb.from('places').select('id').ilike('name', name.replace(/[%_]/g, '\\$&')).is('archived_at', null).maybeSingle()
      if (found) return found.id as string
      // a new place called "Home" is his home (if he hasn't one yet), so journeys from home count
      const home = /^home$/i.test(name.trim()) && !(await sb.from('places').select('id').eq('is_home', true).is('archived_at', null).maybeSingle()).data
      const { data, error } = await sb.from('places').insert({ name, ...(home ? { is_home: true } : {}) }).select('id').single()
      if (error || !data) throw new Error(`Place not saved: ${error?.message ?? 'unknown error'}`)
      made.push(data.id)
      return data.id as string
    }
    if (a.op === 'event_place') {
      const pid = (a.patch.place_id as string | null) ?? await placeId(String(a.patch.new_place))
      const before = pick(await readRow(sb, 'events', a.id!), ['place_id'])
      const { error } = await sb.from('events').update({ place_id: pid }).eq('id', a.id!).select('id').single()
      if (error) throw new Error(`Not saved: ${error.message}`)
      return { op: a.op, table: 'events', id: a.id!, title: a.title, before: { ...before, made }, after: { place_id: pid } }
    }
    const from = await placeId(String(a.patch.from)), to = await placeId(String(a.patch.to))
    // events linked to a place it made (see checkC2): remembered so Undo can unlink them
    const linked: string[] = []
    for (const l of (a.patch.links ?? []) as { place: string; event_id: string }[]) {
      const pid = l.place.toLowerCase() === String(a.patch.from).toLowerCase() ? from : to
      const { data } = await sb.from('events').update({ place_id: pid }).eq('id', l.event_id).is('place_id', null).select('id').maybeSingle()
      if (data) linked.push(l.event_id)
    }
    const key = { from_place_id: from, to_place_id: to, mode: String(a.patch.mode), source: 'manual' }
    const weekday = (a.patch.weekday as number | null) ?? null
    const times = pick(a.patch, JOURNEY_KEYS)
    let find = sb.from('travel_times').select('id,archived_at,minutes,minutes_low,wait_low,wait_high').match(key).is('depart_hour', null)
    find = weekday === null ? find.is('weekday', null) : find.eq('weekday', weekday)
    const { data: old } = await find.maybeSingle()
    const { data, error } = old
      ? await sb.from('travel_times').update({ ...times, archived_at: null }).eq('id', old.id).select('id').single()
      : await sb.from('travel_times').insert({ ...key, weekday, ...times }).select('id').single()
    if (error || !data) throw new Error(`Journey not saved: ${error?.message ?? 'unknown error'}`)
    return { op: a.op, table: 'travel_times', id: data.id, title: a.title, before: old ? { ...pick(old, JOURNEY_KEYS), archived_at: old.archived_at, made, linked } : { made, linked }, after: times }
  }
  if (a.table === 'training_rules') {
    if (a.op === 'rule_set' && a.id === null) {
      await ruleRowId(sb, 0)   // make sure the defaults are saved first, so the list stays in order
      const { data, error } = await sb.from('training_rules').insert(a.patch).select('id').single()
      if (error || !data) throw new Error(`Rule not saved: ${error?.message ?? 'unknown error'}`)
      return { op: a.op, table: a.table, id: data.id, title: a.title, before: null, after: { enabled: true } }
    }
    const id = await ruleRowId(sb, Number(a.id))
    const keys = Object.keys(a.patch)
    const before = pick(await readRow(sb, 'training_rules', id), keys)
    const { error } = await sb.from('training_rules').update(a.patch).eq('id', id).select('id').single()
    if (error) throw new Error(`Rule not saved: ${error.message}`)
    return { op: a.op, table: a.table, id, title: a.title, before, after: pick(await readRow(sb, 'training_rules', id), keys) }
  }
  if (a.op === 'school_day') {
    const ev = (await readRow(sb, 'events', a.id!)) as unknown as EventRow
    const p = a.patch as { day: number; start: string; end: string }
    const days = ev.repeat_days ?? []
    if (days.length <= 1) {
      const before = { start_time: ev.start_time, end_time: ev.end_time }
      const { error } = await sb.from('events').update({ start_time: p.start, end_time: p.end }).eq('id', ev.id).select('id').single()
      if (error) throw new Error(`Not saved: ${error.message}`)
      return { op: a.op, table: 'events', id: ev.id, title: a.title, before, after: { start_time: p.start, end_time: p.end } }
    }
    const { data: made, error: e1 } = await sb.from('events').insert({ title: ev.title, repeat_days: [p.day], start_time: p.start, end_time: p.end, repeat_from: today, is_busy: true, is_school: true, travel_minutes: ev.travel_minutes ?? 0, category_id: ev.category_id, sync_google: ev.sync_google ?? true }).select('id').single()
    if (e1 || !made) throw new Error(`Not saved: ${e1?.message ?? 'unknown error'}`)
    const { error: e2 } = await sb.from('events').update({ repeat_days: days.filter((d) => d !== p.day) }).eq('id', ev.id).select('id').single()
    if (e2) { await setEventArchived(sb, { id: made.id, title: ev.title } as EventRow, true); throw new Error(`Not saved: ${e2.message}`) }
    return { op: a.op, table: 'events', id: ev.id, title: a.title, before: { repeat_days: days, made: made.id }, after: { repeat_days: days.filter((d) => d !== p.day) } }
  }
  if (PLANNING_OPS.includes(a.op)) {
    // one key of profiles.planning; Undo puts back the old value (or the default, if he had none)
    const key = a.id!
    const { data: prof, error: e1 } = await sb.from('profiles').select('user_id,planning').maybeSingle()
    if (e1) throw new Error(`Couldn’t read your settings: ${e1.message}`)
    const planning = (prof?.planning ?? {}) as Record<string, unknown>
    // a change can carry a second key that goes with it (fixed days + their times); Undo puts both back
    const next = { ...planning, ...a.patch }
    const { error } = prof
      ? await sb.from('profiles').update({ planning: next }).eq('user_id', prof.user_id).select('user_id').single()
      : await sb.from('profiles').insert({ planning: next }).select('user_id').single()
    if (error) throw new Error(`Setting not saved: ${error.message}`)
    const extra = Object.fromEntries(Object.keys(a.patch).filter((k) => k !== key).map((k) => [k, { had: k in planning, value: k in planning ? planning[k] : null }]))
    return { op: a.op, table: 'profiles', id: key, title: a.title, before: { [key]: key in planning ? planning[key] : null, had: key in planning, ...(Object.keys(extra).length ? { extra } : {}) }, after: { ...a.patch } }
  }
  if (a.op === 'guide_log') {
    const { data, error } = await sb.from('guide_logs').insert(a.patch).select('id').single()
    if (error || !data) throw new Error(`Log not saved: ${error?.message ?? 'unknown error'}`)
    return { op: a.op, table: 'guide_logs', id: data.id, title: a.title, before: null, after: { archived_at: null } }
  }
  if (a.op === 'stage_set') {
    const r = await setStages(sb, a.id!, a.patch.stages as string[])
    if (r.error) throw new Error(r.error)
    return { op: a.op, table: 'pipeline_stages', id: a.id!, title: a.title, before: { stages: r.before ?? [] }, after: { stages: a.patch.stages } }
  }
  if (a.op === 'topic_status') {
    const r = await setTopicStatus(sb, a.patch.ids as string[], String(a.patch.status))
    if (r.error) throw new Error(r.error)
    return { op: a.op, table: 'topics', id: a.id!, title: a.title, before: { topics: r.before ?? [] }, after: { status: a.patch.status } }
  }
  if (a.op === 'topic_new') {
    const r = await addTopics(sb, a.id!, (a.patch.topics as string[]).join('\n'))
    if (r.error) throw new Error(r.error)
    return { op: a.op, table: 'topics', id: a.id!, title: a.title, before: null, after: { added: r.added ?? [] } }
  }
  if (a.op === 'load_set') {
    // a change archives the old row and adds the new one (never deleted), so Undo can bring the old one back
    const now = new Date().toISOString()
    if (a.id) { const { error } = await sb.from('load_costs').update({ archived_at: now }).eq('id', a.id).is('archived_at', null).select('id').single(); if (error) throw new Error(`Not saved: ${error.message}`) }
    if (a.patch.archived_at === '__now__') return { op: a.op, table: 'load_costs', id: a.id!, title: a.title, before: { old: a.id }, after: { added: null } }
    const { data, error } = await sb.from('load_costs').insert(a.patch).select('id').single()
    if (error || !data) {
      if (a.id) await sb.from('load_costs').update({ archived_at: null }).eq('id', a.id)
      throw new Error(/mental/.test(error?.message ?? '') ? 'Not saved: run supabase/build-o.sql first (it adds your own 🧠 numbers)' : error?.code === '42P01' || /load_costs/.test(error?.message ?? '') ? 'Not saved: run supabase/build-n.sql first' : `Not saved: ${error?.message ?? 'unknown error'}`)
    }
    return { op: a.op, table: 'load_costs', id: data.id, title: a.title, before: { old: a.id }, after: { added: data.id } }
  }
  if (a.op === 'mail_rule') {
    if (a.id === null) {
      const { data, error } = await sb.from('mail_rules').insert(a.patch).select('id').single()
      if (error || !data) throw new Error(`Rule not saved: ${error?.message ?? 'unknown error'}`)
      return { op: a.op, table: 'mail_rules', id: data.id, title: a.title, before: null, after: { archived_at: null } }
    }
    const keys = Object.keys(a.patch)
    const before = pick(await readRow(sb, 'mail_rules', a.id), keys)
    const patch = a.patch.archived_at === '__now__' ? { archived_at: new Date().toISOString() } : a.patch
    const { error } = await sb.from('mail_rules').update(patch).eq('id', a.id).select('id').single()
    if (error) throw new Error(`Rule not saved: ${error.message}`)
    return { op: a.op, table: 'mail_rules', id: a.id, title: a.title, before, after: pick(await readRow(sb, 'mail_rules', a.id), keys) }
  }
  if (a.op === 'calendar_set') {
    const { data: row, error: e1 } = await sb.from('integrations').select('id,settings').eq('id', a.id!).single()
    if (e1 || !row) throw new Error(`Couldn’t read the Google connection: ${e1?.message ?? 'not found'}`)
    const before = { calendars: (row.settings as { calendars?: unknown }).calendars ?? [] }
    const { error } = await sb.from('integrations').update({ settings: { ...(row.settings as object), calendars: a.patch.calendars } }).eq('id', a.id!).select('id').single()
    if (error) throw new Error(`Not saved: ${error.message}`)
    return { op: a.op, table: 'integrations', id: a.id!, title: a.title, before, after: { calendars: a.patch.calendars } }
  }
  if (a.op === 'subject_new' || a.op === 'target_new') {
    const table = a.op === 'subject_new' ? 'subjects' : 'weekly_targets'
    const { data, error } = await sb.from(table).insert(a.patch).select('id').single()
    if (error || !data) throw new Error(`Not saved: ${error?.message ?? 'unknown error'}`)
    return { op: a.op, table: a.table, id: data.id, title: a.title, before: null, after: {} }
  }
  if (a.op === 'event_new' || a.op === 'event_weekly') {
    // a session at a place he named that isn't saved yet: the place is made (or found, if another change in this card made it)
    const { new_place: newPlace, ...row } = a.patch as Record<string, unknown> & { new_place?: string }
    const made: string[] = []
    if (newPlace) {
      const { data: found } = await sb.from('places').select('id').ilike('name', newPlace.replace(/[%_]/g, '\\$&')).is('archived_at', null).maybeSingle()
      if (found) row.place_id = found.id
      else {
        const { data: p, error: e1 } = await sb.from('places').insert({ name: newPlace }).select('id').single()
        if (e1 || !p) throw new Error(`Place not saved: ${e1?.message ?? 'unknown error'}`)
        row.place_id = p.id
        made.push(p.id)
      }
    }
    const { data, error } = await sb.from('events').insert(row).select('id').single()
    if (error || !data) {
      if (made.length) await sb.from('places').update({ archived_at: new Date().toISOString() }).in('id', made)
      throw new Error(`Event not saved: ${error?.message ?? 'unknown error'}`)
    }
    return { op: a.op, table: 'events', id: data.id, title: a.title, before: made.length ? { made } : null, after: { archived_at: null } }
  }
  if (a.table === 'event_exceptions') {
    const { o } = await session(sb, a.id!, a.usualDate!)
    const before = o.change ? pick(o.change as unknown as Record<string, unknown>, CHANGE_KEYS) : null
    const err = await saveChange(sb, await getUserId(sb), o, a.patch as Parameters<typeof saveChange>[3])
    if (err) throw new Error(err)
    const { row } = await session(sb, a.id!, a.usualDate!)
    return { op: a.op, table: a.table, id: a.id!, title: a.title, before, after: pick(row ?? {}, CHANGE_KEYS), usualDate: a.usualDate }
  }
  // an item of his typed week left out (1️⃣ on a clash): taken out of the note as it is now, never a stale copy of it
  const row = await readRow(sb, a.table, a.id!)
  const patch = a.table === 'week_notes' && 'drop_item' in a.patch ? { items: itemsWithout(row.items, a.patch.drop_item) } : fill(a.patch)
  const keys = Object.keys(patch)
  const before = pick(row, keys)
  let err: string | null = null
  if (a.op === 'goal_archive') err = await setGoalArchived(sb, row as unknown as Goal, true)
  else if (a.op === 'event_cancel' && a.table === 'events') err = await setEventArchived(sb, row as unknown as EventRow, true)
  else {
    const { error } = await sb.from(a.table).update(patch).eq('id', a.id!).select('id').single()
    err = error ? `Not saved: ${error.message}` : null
  }
  if (err) throw new Error(err)
  if (a.op === 'test_date') {
    const e2 = await replanTest(sb, { ...(row as unknown as Goal), target_date: String(patch.target_date) }, today)
    if (e2) throw new Error(`The test moved, but its prep sessions didn’t re-plan (${e2})`)
  }
  return { op: a.op, table: a.table, id: a.id!, title: a.title, before, after: pick(await readRow(sb, a.table, a.id!), keys) }
}

/** Put one change back. 'skipped' if it was changed again since (then it's left alone). */
export async function undoC2(sb: SupabaseClient, a: C2Applied, today: string): Promise<'undone' | 'skipped'> {
  const same = (now: Record<string, unknown>) => Object.keys(a.after).every((k) => JSON.stringify(now[k] ?? null) === JSON.stringify(a.after[k] ?? null))
  if (a.op === 'school_day') {
    const b = (a.before ?? {}) as { repeat_days?: number[]; made?: string; start_time?: string; end_time?: string }
    if (b.made) {
      await setEventArchived(sb, { id: b.made, title: a.title } as EventRow, true)   // archived, never deleted
      const { error } = await sb.from('events').update({ repeat_days: b.repeat_days }).eq('id', a.id).select('id').single()
      if (error) throw new Error(error.message)
    } else {
      const { error } = await sb.from('events').update({ start_time: b.start_time, end_time: b.end_time }).eq('id', a.id).select('id').single()
      if (error) throw new Error(error.message)
    }
    return 'undone'
  }
  if (PLANNING_OPS.includes(a.op)) {
    const { data: prof, error: e1 } = await sb.from('profiles').select('user_id,planning').maybeSingle()
    if (e1 || !prof) throw new Error(e1?.message ?? 'no settings')
    const planning = { ...((prof.planning ?? {}) as Record<string, unknown>) }
    if (!same(planning)) return 'skipped'
    if ((a.before as { had?: boolean })?.had) planning[a.id] = a.before![a.id]
    else delete planning[a.id]   // back to the default
    for (const [k, v] of Object.entries((a.before as { extra?: Record<string, { had: boolean; value: unknown }> })?.extra ?? {})) {
      if (v.had) planning[k] = v.value; else delete planning[k]
    }
    const { error } = await sb.from('profiles').update({ planning }).eq('user_id', prof.user_id).select('user_id').single()
    if (error) throw new Error(error.message)
    return 'undone'
  }
  if (a.op === 'guide_log') {
    const { error } = await sb.from('guide_logs').update({ archived_at: new Date().toISOString() }).eq('id', a.id).select('id').single()   // archived, never deleted
    if (error) throw new Error(error.message)
    return 'undone'
  }
  if (a.op === 'stage_set') {
    const err = await restoreStages(sb, a.id, ((a.before ?? {}) as { stages?: Stage[] }).stages ?? [])
    if (err) throw new Error(err)
    return 'undone'
  }
  if (a.op === 'topic_status') {
    const err = await restoreTopicStatus(sb, ((a.before ?? {}) as { topics?: { id: string; status: string }[] }).topics ?? [])
    if (err) throw new Error(err)
    return 'undone'
  }
  if (a.op === 'topic_new') {
    const added = ((a.after ?? {}) as { added?: string[] }).added ?? []
    if (added.length) { const { error } = await sb.from('topics').update({ archived_at: new Date().toISOString() }).in('id', added); if (error) throw new Error(error.message) }   // archived, never deleted
    return 'undone'
  }
  if (a.op === 'training_type' && (a.after as { by_title?: string }).by_title) {
    for (const r of ((a.before ?? {}) as { rows?: { id: string; training_type: string | null; load: string | null }[] }).rows ?? []) {
      const { error } = await sb.from('events').update({ training_type: r.training_type, load: r.load }).eq('id', r.id).eq('training_type', String(a.after.training_type))
      if (error) throw new Error(error.message)
    }
    return 'undone'
  }
  if (a.op === 'load_set') {
    const added = (a.after as { added?: string | null }).added, old = (a.before as { old?: string | null }).old
    if (added) { const { error } = await sb.from('load_costs').update({ archived_at: new Date().toISOString() }).eq('id', added); if (error) throw new Error(error.message) }
    if (old) { const { error } = await sb.from('load_costs').update({ archived_at: null }).eq('id', old); if (error) throw new Error(error.message) }
    return 'undone'
  }
  if (a.op === 'mail_rule') {
    if (a.before === null) {   // a new rule: archived, never deleted
      const { error } = await sb.from('mail_rules').update({ archived_at: new Date().toISOString() }).eq('id', a.id).select('id').single()
      if (error) throw new Error(error.message)
      return 'undone'
    }
    if (!same(await readRow(sb, 'mail_rules', a.id))) return 'skipped'
    const { error } = await sb.from('mail_rules').update(a.before).eq('id', a.id).select('id').single()
    if (error) throw new Error(error.message)
    return 'undone'
  }
  if (a.op === 'calendar_set') {
    const { data: row, error: e1 } = await sb.from('integrations').select('id,settings').eq('id', a.id).single()
    if (e1 || !row) throw new Error(e1?.message ?? 'not found')
    const settings = row.settings as Record<string, unknown>
    if (!same({ calendars: settings.calendars })) return 'skipped'
    const { error } = await sb.from('integrations').update({ settings: { ...settings, calendars: a.before?.calendars ?? [] } }).eq('id', a.id).select('id').single()
    if (error) throw new Error(error.message)
    return 'undone'
  }
  if (a.op === 'subject_new' || a.op === 'target_new') {
    // archived / switched off, never deleted
    const { error } = a.op === 'subject_new'
      ? await sb.from('subjects').update({ archived_at: new Date().toISOString() }).eq('id', a.id).select('id').single()
      : await sb.from('weekly_targets').update({ is_active: false }).eq('id', a.id).select('id').single()
    if (error) throw new Error(error.message)
    return 'undone'
  }
  if (a.op === 'event_new' || a.op === 'event_weekly') {
    const err = await setEventArchived(sb, { id: a.id, title: a.title } as EventRow, true)   // archived, never deleted
    if (err) throw new Error(err)
    const made = ((a.before ?? {}) as { made?: string[] }).made ?? []
    if (made.length) await sb.from('places').update({ archived_at: new Date().toISOString() }).in('id', made)   // the place it made: archived
    return 'undone'
  }
  if (a.op === 'place_new') {
    const { error } = await sb.from('places').update({ archived_at: new Date().toISOString() }).eq('id', a.id).select('id').single()   // archived, never deleted
    if (error) throw new Error(error.message)
    return 'undone'
  }
  if (a.op === 'event_place' || a.op === 'travel_set') {
    const now = await readRow(sb, a.table, a.id)
    if (!same(now)) return 'skipped'
    const made = ((a.before ?? {}) as { made?: string[] }).made ?? []
    if (a.op === 'event_place') {
      const { error } = await sb.from('events').update({ place_id: (a.before as { place_id?: string | null })?.place_id ?? null }).eq('id', a.id).select('id').single()
      if (error) throw new Error(error.message)
    } else {
      const b = a.before as { minutes?: number; archived_at?: string | null }
      const back = b.minutes !== undefined ? { ...pick(b, JOURNEY_KEYS), archived_at: b.archived_at ?? null } : { archived_at: new Date().toISOString() }
      const { error } = await sb.from('travel_times').update(back).eq('id', a.id).select('id').single()
      if (error) throw new Error(error.message)
    }
    const linked = ((a.before ?? {}) as { linked?: string[] }).linked ?? []
    if (linked.length) await sb.from('events').update({ place_id: null }).in('id', linked)
    if (made.length) await sb.from('places').update({ archived_at: new Date().toISOString() }).in('id', made)   // the places it made: archived
    return 'undone'
  }
  if (a.table === 'training_rules' && a.before === null) {
    const { error } = await sb.from('training_rules').update({ enabled: false }).eq('id', a.id).select('id').single()   // switched off, never deleted
    if (error) throw new Error(error.message)
    return 'undone'
  }
  if (a.table === 'event_exceptions') {
    const { o, row } = await session(sb, a.id, a.usualDate!)
    if (!same(row ?? {})) return 'skipped'
    // write the week's old change back (or a blank one: same as no change); the row itself stays
    const err = await restoreChange(sb, await getUserId(sb), { ...o, change: (a.before ? { ...o.change!, ...a.before } : null) as EventException | null })
    if (err) throw new Error(err)
    return 'undone'
  }
  const now = await readRow(sb, a.table, a.id)
  if (!same(now)) return 'skipped'
  let err: string | null = null
  if (a.op === 'goal_archive') err = await setGoalArchived(sb, now as unknown as Goal, false)
  else if (a.op === 'event_cancel' && a.table === 'events') err = await setEventArchived(sb, now as unknown as EventRow, false)
  else {
    const { error } = await sb.from(a.table).update(a.before ?? {}).eq('id', a.id).select('id').single()
    err = error ? error.message : null
  }
  if (err) throw new Error(err)
  if (a.op === 'test_date') {
    const e2 = await replanTest(sb, { ...(now as unknown as Goal), target_date: String(a.before?.target_date) }, today)
    if (e2) throw new Error(e2)
  }
  return 'undone'
}

/** Events and their changes, and goals, for the refs the brain used (as Nat, under row level security). */
export async function loadC2Rows(sb: SupabaseClient, eventIds: string[] | 'all', goalIds: string[], today: string, targetIds: string[] = [], withStudy = false, withGuides = false,
  more: { blockIds?: string[]; archivedIds?: string[] } = {}): Promise<C2Rows> {
  const [blocks, archived, subjects, categories] = await Promise.all([
    more.blockIds?.length ? sb.from('plan_blocks').select('id,on_date,start_time,end_time,title,kind,status').in('id', more.blockIds).then((r) => (r.data ?? []) as NonNullable<C2Rows['blocks']> extends Map<string, infer V> ? V[] : never) : Promise.resolve([]),
    more.archivedIds?.length ? sb.from('tasks').select('id,title,archived_at,status').in('id', more.archivedIds).then((r) => (r.data ?? []) as { id: string; title: string; archived_at: string | null; status: string }[]) : Promise.resolve([]),
    sb.from('subjects').select('id,name,archived_at').then((r) => (r.data ?? []) as { id: string; name: string; archived_at: string | null }[]),
    sb.from('categories').select('id,name').then((r) => (r.data ?? []) as { id: string; name: string }[]),
  ])
  const extra = { blocks: new Map(blocks.map((b) => [b.id, b])), archived: new Map(archived.map((t) => [t.id, t])), subjects, categories }
  const [ev, ch, gl, tg, rules, places, planning, google, study, guides, mailRules, costs, titles] = await Promise.all([
    eventIds === 'all' ? sb.from('events').select('*').is('archived_at', null) : eventIds.length ? sb.from('events').select('*').in('id', eventIds) : Promise.resolve({ data: [], error: null }),
    eventIds === 'all' ? sb.from('event_exceptions').select('*').gte('on_date', addDays(today, -7)).lte('on_date', addDays(today, 63)) : eventIds.length ? sb.from('event_exceptions').select('*').in('event_id', eventIds).gte('on_date', addDays(today, -7)).lte('on_date', addDays(today, 63)) : Promise.resolve({ data: [], error: null }),
    goalIds.length ? sb.from('goals').select('*').in('id', goalIds) : Promise.resolve({ data: [], error: null }),
    targetIds.length ? sb.from('weekly_targets').select('*').in('id', targetIds) : Promise.resolve({ data: [], error: null }),
    loadRules(sb),
    sb.from('places').select('id,name,address,lat,lng,is_home,archived_at').is('archived_at', null).then((r) => (r.error ? [] : (r.data ?? []) as Place[])),
    sb.from('profiles').select('planning').maybeSingle().then((r) => r.data?.planning ?? {}),
    sb.from('integrations').select('id,status,settings').eq('provider', 'google').maybeSingle()
      .then((r) => (r.error || !r.data || r.data.status === 'disconnected' ? null : { id: r.data.id as string, calendars: ((r.data.settings as { calendars?: GoogleCalRow[] })?.calendars ?? []) })),
    withStudy
      ? Promise.all([loadStudy(sb), sb.from('subjects').select('id,name').is('archived_at', null)]).then(([s, sub]) => ({ ...s, subjects: (sub.data ?? []) as { id: string; name: string }[] }))
      : Promise.resolve(null),
    withGuides
      ? sb.from('guides').select('id,title,body,has_log').is('archived_at', null).then((r) => (r.error ? null : (r.data ?? []) as { id: string; title: string; body: string; has_log: boolean }[]))
      : Promise.resolve(null),
    sb.from('mail_rules').select('id,pattern,action,label,archived_at').is('archived_at', null).then((r) => (r.error ? null : (r.data ?? []) as MailRule[])),
    loadCosts(sb),
    sb.from('events').select('title').is('archived_at', null).then((r) => [...new Set(((r.data ?? []) as { title: string }[]).map((x) => x.title))]),
  ])
  for (const r of [ev, ch, gl, tg]) if (r.error) throw new Error(`Couldn’t read your calendar: ${r.error.message}`)
  return {
    events: new Map(((ev.data ?? []) as EventRow[]).map((e) => [e.id, e])),
    changes: (ch.data ?? []) as EventException[],
    goals: new Map(((gl.data ?? []) as Goal[]).map((g) => [g.id, g])),
    targets: new Map(((tg.data ?? []) as WeeklyTarget[]).map((t) => [t.id, t])),
    rules: rules.rules,
    places,
    planning,
    google,
    study,
    guides,
    mailRules,
    costs, titles, ...extra,
  }
}

