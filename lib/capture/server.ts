// Server-only: builds the AI request for a capture and checks the AI's answer.
// Imported only by app/api/capture/route.ts (the API key never reaches the browser).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventException, EventRow, Origin } from '../types'
import { expandEvents } from '../events'
import { addDays, dowShort, hhmm, minutesOf, shortDate, timeOf, todayISO, weekStartISO } from '../time'
import { CAPTURE_KINDS, type CaptureKind, type Duplicate, type Proposal } from './types'
import { moreSettings } from '../settings'
import { activeSources } from '../lists'
import { matchName, stagesOf, topicState } from '../study'
import { loadStudy, type StudyData } from '../study-data'

export { SORT_MODEL as CAPTURE_MODEL } from '../ai/models'

// ---------------------------------------------------------------------------
// Context: what the AI may use besides the captured words.
// ---------------------------------------------------------------------------

type Named = { id: string; name: string }
export type CaptureContext = {
  today: string
  now: string                       // HH:MM London
  subjects: (Named & { category_id: string | null })[]
  projects: Named[]
  targets: (Named & { activity_type: string | null; counts_from: string })[]
  events: EventRow[]
  changes: EventException[]
  tests: { title: string; target_date: string | null }[]
  facts: string[]
  openTasks: { title: string; source_text: string | null }[]
  reminders: { body: string }[]
  resources: { title: string; url: string | null }[]
  loggedToday: { target_id: string; amount: number }[]
  planning: unknown                 // his settings: "about" and his task sources
  study: StudyData                  // pipelines: stages, topics, what's done
}

export async function loadContext(sb: SupabaseClient): Promise<CaptureContext> {
  const today = todayISO()
  const [subjects, projects, targets, events, changes, goals, facts, tasks, reminders, resources, logs, planning, study] = await Promise.all([
    sb.from('subjects').select('id,name,category_id').order('name'),
    sb.from('projects').select('id,name').is('archived_at', null),
    sb.from('weekly_targets').select('id,name,activity_type,counts_from').eq('is_active', true),
    sb.from('events').select('*').is('archived_at', null),
    sb.from('event_exceptions').select('*').gte('on_date', addDays(today, -7)),
    sb.from('goals').select('title,target_date,kind').is('archived_at', null),
    sb.from('context_facts').select('fact').eq('is_active', true),
    sb.from('tasks').select('title,source_text').is('archived_at', null).neq('status', 'completed').eq('is_system', false),
    sb.from('reminders').select('body').is('done_at', null),
    sb.from('resources').select('title,url').is('archived_at', null),
    sb.from('target_logs').select('target_id,amount').eq('done_on', today),
    sb.from('profiles').select('planning').maybeSingle().then((r) => (r.error ? null : r.data?.planning ?? null)),
    loadStudy(sb),
  ])
  const all = { subjects, projects, targets, events, changes, goals, facts, tasks, reminders, resources, logs }
  for (const [what, res] of Object.entries(all)) if (res.error) throw new Error(`Couldn't read ${what}: ${res.error.message}`)
  return {
    today,
    now: timeOf(new Date()),
    subjects: subjects.data ?? [],
    projects: (projects.data ?? []).map((p) => ({ id: p.id, name: p.name })),
    targets: (targets.data ?? []).map((t) => ({ id: t.id, name: t.name, activity_type: t.activity_type, counts_from: t.counts_from })),
    events: (events.data ?? []) as EventRow[],
    changes: (changes.data ?? []) as EventException[],
    tests: (goals.data ?? []).filter((g) => g.kind === 'test' && (!g.target_date || g.target_date >= today)),
    facts: (facts.data ?? []).map((f) => f.fact),
    openTasks: tasks.data ?? [],
    reminders: reminders.data ?? [],
    resources: resources.data ?? [],
    loggedToday: logs.data ?? [],
    planning,
    study,
  }
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const SYSTEM_PROMPT = `You sort one captured note for Nat (who he is: "About Nat" below). His app is a personal operating system. You only propose; Nat confirms or edits before anything is saved.

Decide what the note is (exactly one kind):
- task: something to do. Fill subject, importance ("must" if it has a deadline, is homework, or he says it must happen; otherwise "nice"), due date OR a window, rough minutes if he says them, origin (the key of one of his task sources listed below; own if none fits), project, hand-in method if he says how/where.
- test: an upcoming test/exam/assessment with a date ("Physics test Friday"). The app plans prep sessions.
- reminder: "remind me…", "tell X…", "don't forget…" that is about remembering, not doing work. day (remind_date), time (remind_date + remind_time), or person ("next time I see Sam": person = Sam).
- goal_progress: he reports he already DID something that counts toward a weekly target ("did football today", "did upper", "did 30 mins of juggling"). Pick the matching target. amount = sessions (usually 1).
- event_change: a change to one of his calendar events ("CS tutor moved to Thursday 5pm", "no football Wednesday this week"). event_scope "every" only if he says every week / from now on / permanently; otherwise "week".
- idea: something vague or someday with no clear action yet ("look up that philosophy book", "maybe learn guitar"). Never give an idea a date. someday = true only if he says someday/one day/eventually.
- resource: a link, video, book, article or GoodNotes notebook to keep for later. Put any URL in url.
- study: he finished a stage of a study topic ("finished the Bicen video on matrices", "did the exam questions for complex numbers"). subject and topic copied from "Study topics" below; stage = the stage he names, copied from that subject's stages, or "" for the topic's next stage.
- mistake: a mistake in his work to come back to ("Q5 wrong on vectors: sign error", "messed up the moments question"). title = the mistake in his words; subject, and topic if it clearly matches one.
- fact: a fact about his life the planner should know ("the maths exam is 7 October", "my tutor is on Mondays and Thursdays").

Strict rules:
1. Use only the note, the calendar below and his context. Never invent dates, times, deadlines, people, subjects or durations. Unknown text or date = "" (empty string); unknown number = 0.
2. Every date you output (due_date, window_end, test_date, remind_date, new_date, done_on) must come from words in the note (or a fact). Put those exact words, copied from the note, in date_words. If there are no date words, all those dates must be "".
3. Convert relative dates only with the calendar provided. "Friday" = the next Friday from today (today counts if today is Friday). "tomorrow" = today + 1. "this weekend" = the coming Saturday–Sunday (window_label "this weekend", window_end = that Sunday). "before Wednesday" = window ending the day before (Tuesday). "next week" = window_label "next week", window_end = next week's Sunday. "by/due X" = due_date X.
4. Times only if the note gives a clock time ("5pm", "16:30", "noon"). Use 24h HH:MM.
5. subject, project, target, event, topic and stage must be copied exactly from the lists in the context, or "" if nothing clearly matches.
6. title: short and action-oriented, under 80 characters, in Nat's words (for a fact, the fact itself; for a reminder, what to remember). Leave date and time words out of the title ("tomorrow", "due Friday", "this weekend"): they go in the date fields.
7. reasoning: one short sentence.`

/** "Further Maths (stages: Bicen video → notes → …): Complex numbers (next: Bicen video); Matrices (next: notes)" */
function studyLines(ctx: CaptureContext): string {
  return ctx.subjects.map((sub) => {
    const stages = stagesOf(ctx.study.stages, sub.id)
    const topics = ctx.study.topics.filter((t) => t.subject_id === sub.id && !t.archived_at)
    if (!topics.length && !stages.length) return ''
    const list = topics.slice(0, 60).map((t) => { const s = topicState(t, ctx.study.stages, ctx.study.progress); return `${t.name}${s.next ? ` (next: ${s.next.name})` : s.finished ? ' (done)' : ''}` })
    return `- ${sub.name} (stages: ${stages.map((s) => s.name).join(' → ') || 'none yet'}): ${list.join('; ') || 'no topics yet'}`
  }).filter(Boolean).join('\n')
}

/** The per-request part: today's calendar and Nat's context. */
export function contextMessage(text: string, ctx: CaptureContext): string {
  const days = Array.from({ length: 21 }, (_, i) => {
    const d = addDays(ctx.today, i)
    return `${dowShort(d)} ${shortDate(d)} = ${d}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`
  })
  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const events = ctx.events.map((e) => e.repeat_days?.length
    ? `- ${e.title}: every ${e.repeat_days.map((d) => DOW[d - 1]).join(' + ')} ${hhmm(e.start_time)}–${hhmm(e.end_time)}`
    : `- ${e.title}: one-off ${e.starts_at ? `${e.starts_at.slice(0, 10)} ${timeOf(e.starts_at)}` : ''}`)
  const list = (xs: string[]) => (xs.length ? xs.join(', ') : '(none)')
  return [
    `About Nat: ${moreSettings(ctx.planning).about}`,
    `Today is ${dowShort(ctx.today)} ${ctx.today}, ${ctx.now} (Europe/London). Weeks run Monday–Sunday.`,
    `Calendar:\n${days.join('\n')}`,
    `Subjects: ${list(ctx.subjects.map((s) => s.name))}`,
    `Projects: ${list(ctx.projects.map((p) => p.name))}`,
    `Task sources (origin = the key): ${activeSources(ctx.planning).map((x) => `${x.key} = ${x.label}`).join('; ')}`,
    `Study topics:\n${studyLines(ctx) || '(no pipelines yet)'}`,
    `Weekly targets: ${list(ctx.targets.map((t) => (t.activity_type ? `${t.name} (${t.activity_type})` : t.name)))}`,
    `Events:\n${events.join('\n') || '(none)'}`,
    `Upcoming tests: ${list(ctx.tests.map((t) => `${t.title} ${t.target_date ?? ''}`.trim()))}`,
    `Facts about Nat:\n${ctx.facts.map((f) => `- ${f}`).join('\n') || '(none)'}`,
    `Captured note:\n<note>${text}</note>`,
  ].join('\n\n')
}

// ---------------------------------------------------------------------------
// Output schema (structured outputs): every field present, null when unknown.
// ---------------------------------------------------------------------------

// No nullable types: the API limits union-typed fields. "" (or 0) means unknown.
const str = { type: 'string' }
const int = { type: 'integer' }
const oneOf = (values: string[]) => ({ type: 'string', enum: values })
const PROPS: Record<string, unknown> = {
  kind: oneOf([...CAPTURE_KINDS]),
  title: { type: 'string' },
  subject: str, importance: oneOf(['must', 'nice']),
  due_date: str, window_label: str, window_end: str, duration_minutes: int,
  origin: str,   // one of his task sources' keys (checked below)
  project: str, hand_in: str, someday: { type: 'boolean' },
  test_date: str, topics: str, priority: oneOf(['high', 'normal', 'low']),
  reminder_kind: oneOf(['day', 'time', 'person']), remind_date: str, remind_time: str, person: str,
  target: str, amount: int, done_on: str,
  event: str, event_scope: oneOf(['week', 'every']), new_date: str, new_start: str, new_end: str, cancel: { type: 'boolean' },
  url: str, resource_kind: oneOf(['link', 'video', 'goodnotes', 'book', 'article', 'drill', 'other']),
  fact: str,
  topic: str, stage: str,
  date_words: str,
  reasoning: { type: 'string' },
}
export const OUTPUT_SCHEMA = { type: 'object', properties: PROPS, required: Object.keys(PROPS), additionalProperties: false }

export type RawOutput = {
  kind: string; title: string
  subject: string | null; importance: string; due_date: string | null; window_label: string | null; window_end: string | null
  duration_minutes: number | null; origin: string; project: string | null; hand_in: string | null; someday: boolean
  test_date: string | null; topics: string | null; priority: string
  reminder_kind: string; remind_date: string | null; remind_time: string | null; person: string | null
  target: string | null; amount: number | null; done_on: string | null
  event: string | null; event_scope: string; new_date: string | null; new_start: string | null; new_end: string | null; cancel: boolean
  url: string | null; resource_kind: string; fact: string | null; date_words: string | null; reasoning: string
  topic?: string | null; stage?: string | null
}

// ---------------------------------------------------------------------------
// Checks on the AI's answer
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const isDate = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
const isTime = (s: string | null): s is string => !!s && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
const pick = <T extends string>(v: string, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback)

/** Match a name the AI gave to one of Nat's records: exact, then a single clear partial match. */
function match<T extends { id: string; name: string }>(name: string | null, items: T[], extra?: (t: T) => string | null): T | null {
  if (!name) return null
  const n = norm(name)
  const keys = (t: T) => [t.name, extra?.(t) ?? ''].map(norm).filter(Boolean)
  const exact = items.filter((t) => keys(t).includes(n))
  if (exact.length === 1) return exact[0]
  const partial = items.filter((t) => keys(t).some((k) => k.includes(n) || n.includes(k)))
  return partial.length === 1 ? partial[0] : null
}

/** The model sends "" / 0 for unknown; turn those into null. */
export function nullify(o: Record<string, unknown>): RawOutput {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) out[k] = v === '' || (typeof v === 'string' && !v.trim()) || ((k === 'duration_minutes' || k === 'amount') && v === 0) ? null : v
  return out as RawOutput
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const WEEKDAYS = ['mon(?:day)?', 'tue(?:s|sday)?', 'wed(?:s|nesday)?', 'thu(?:r|rs|rsday)?', 'fri(?:day)?', 'sat(?:urday)?', 'sun(?:day)?']

/** Do his words name this date ("Wed 28 Oct", "28th October", "Oct 28", "28/10", "2026-10-28"; a weekday alone, "Wed",
 *  for the next 7 days)? So a date he gave is kept even when the AI words its date_words differently (fix round 13). */
export function dateInWords(iso: string, text: string, today: string): boolean {
  const t = text.toLowerCase()
  if (t.includes(iso)) return true
  const d = Number(iso.slice(8, 10)), m = Number(iso.slice(5, 7))
  const day = `0?${d}(?:st|nd|rd|th)?`, mon = `${MONTHS[m - 1]}[a-z]*\\.?`
  if (new RegExp(`\\b${day}\\s+(?:of\\s+)?${mon}(?![a-z])|\\b${mon}\\s+${day}\\b|\\b0?${d}/0?${m}\\b`).test(t)) return true
  if (iso < today || iso > addDays(today, 7)) return false
  const wd = WEEKDAYS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7]
  // a weekday alone, with no other date next to it ("Wed", "wednesday"; not "Wed 4 Nov")
  return new RegExp(`\\b${wd}\\b(?!\\s+(?:the\\s+)?\\d{1,2}(?:st|nd|rd|th)?(?:\\s+(?:of\\s+)?[a-z]{3}|\\/))`).test(t)
}

export function checkProposal(raw: RawOutput, text: string, ctx: CaptureContext): Proposal {
  const notes: string[] = []
  const kind = pick<CaptureKind>(raw.kind, CAPTURE_KINDS, 'idea')
  const input = norm(text)

  // Dates must come from Nat's words (or a fact), never be invented.
  const words = raw.date_words ? norm(raw.date_words) : ''
  const grounded = words.length >= 3 && (input.includes(words) || ctx.facts.some((f) => norm(f).includes(words)))
  let dropped = false
  const date = (v: string | null, allowPast = false): string | null => {
    if (!v) return null
    // (his own words naming that date count too: "Wed 28 Oct" when the AI's date_words say "Wednesday 28 October")
    if (!isDate(v) || !(grounded || dateInWords(v, text, ctx.today))) { dropped = true; return null }
    if (!allowPast && v < ctx.today) { dropped = true; return null }
    return v
  }
  let due = date(raw.due_date)
  let windowEnd = date(raw.window_end)
  let windowLabel = raw.window_label?.trim() || null
  // "before Wednesday" means the last OK day is Tuesday (a window), not due Wednesday.
  if (due && !windowEnd && /\bbefore\b/.test(input)) {
    const last = addDays(due, -1)
    windowLabel = windowLabel ?? `before ${dowShort(due)}`
    if (last >= ctx.today) windowEnd = last
    due = null
  }
  const testDate = date(raw.test_date)
  const remindDay = date(raw.remind_date)
  const newDate = date(raw.new_date)
  const doneOn = raw.done_on && raw.done_on !== ctx.today ? date(raw.done_on, true) : ctx.today
  if (dropped) notes.push('Removed a date that wasn’t in your words. Add one if you want it.')

  // Times only when Nat gave a clock time.
  const hasClock = /\d|noon|midday|midnight/.test(input)
  const time = (v: string | null) => (hasClock && isTime(v) ? v : null)
  let remindTime = time(raw.remind_time)
  let reminderKind = pick(raw.reminder_kind, ['day', 'time', 'person'] as const, 'day')
  if (reminderKind === 'time' && (!remindTime || !remindDay)) { reminderKind = 'day'; remindTime = null }
  if (reminderKind === 'person' && !raw.person) reminderKind = 'day'

  const subject = match(raw.subject, ctx.subjects)
  const project = match(raw.project, ctx.projects)
  const target = match(raw.target, ctx.targets, (t) => t.activity_type)
  const event = match(raw.event, ctx.events.map((e) => ({ ...e, name: e.title })))
  if (raw.subject && !subject) notes.push(`No subject called “${raw.subject}”, so none is set.`)
  if (kind === 'goal_progress' && !target) notes.push('Couldn’t tell which weekly target this counts toward. Pick one.')
  if (kind === 'event_change' && !event) notes.push('Couldn’t tell which event this changes. Pick one.')

  // Study: the topic (in the subject if one was given) and the stage (the topic's next one if he didn't say)
  const topics = ctx.study.topics.filter((t) => !t.archived_at && (!subject || t.subject_id === subject.id))
  const topic = (kind === 'study' || kind === 'mistake') && raw.topic ? matchName(topics, raw.topic) : null
  const studySubject = subject ?? (topic ? ctx.subjects.find((s) => s.id === topic.subject_id) ?? null : null)
  let stage: { id: string } | null = null
  if (kind === 'study' && topic) {
    stage = raw.stage ? matchName(stagesOf(ctx.study.stages, topic.subject_id), raw.stage) : topicState(topic, ctx.study.stages, ctx.study.progress).next
    if (!stage) notes.push(raw.stage ? `No stage called “${raw.stage}” in that pipeline. Pick one.` : 'That topic has no stage left (or no pipeline yet). Pick one.')
  }
  if (kind === 'study' && !topic) notes.push(`Couldn’t tell which topic${raw.topic ? ` (“${raw.topic}”)` : ''}. Pick one, or add it on the subject’s page.`)

  // Event change: find the session being changed (the next one from today) and keep its length.
  let onDate: string | null = null
  let newStart = time(raw.new_start)
  let newEnd = time(raw.new_end)
  if (event) {
    // the session in the week of the day he gave ("Owen … Wed 28 Oct" changes that week's session), else the next one
    const occ = expandEvents([event], ctx.today, addDays(ctx.today, 13), ctx.changes).filter((o) => !o.cancelled)
    const next = (newDate ? occ.find((o) => weekStartISO(o.usualDate) === weekStartISO(newDate)) : null) ?? occ[0]
    onDate = next?.usualDate ?? null
    if (newStart && !newEnd && event.start_time && event.end_time) {
      const len = minutesOf(event.end_time) - minutesOf(event.start_time)
      const end = minutesOf(newStart) + len
      if (end < 24 * 60) newEnd = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`
    }
    if (newDate && onDate && weekStartISO(newDate) !== weekStartISO(onDate) && raw.event_scope !== 'every') {
      notes.push('A “just this week” move must stay in the same Mon–Sun week.')
    }
  }
  if (newStart && newEnd && newEnd <= newStart) newEnd = null

  const minutes = raw.duration_minutes && raw.duration_minutes > 0 && raw.duration_minutes < 24 * 60 && /\d|hour|hr|min/.test(input) ? raw.duration_minutes : null
  const url = raw.url && /^https?:\/\//i.test(raw.url) && text.includes(raw.url.replace(/\/$/, '')) ? raw.url : (text.match(/https?:\/\/\S+/)?.[0] ?? null)

  return {
    kind,
    title: (raw.title || text).trim().slice(0, 120),
    subject_id: (kind === 'study' || kind === 'mistake' ? studySubject : subject)?.id ?? null,
    importance: kind === 'task' && (due || raw.importance === 'must') ? 'must' : 'nice',
    due: kind === 'idea' ? null : due,
    window_label: kind === 'idea' ? null : windowLabel,
    window_end: kind === 'idea' ? null : windowEnd,
    duration_minutes: minutes,
    origin: pick<Origin>(raw.origin, activeSources(ctx.planning).map((x) => x.key), 'own'),
    project_id: project?.id ?? null,
    hand_in: raw.hand_in?.trim() || null,
    someday: kind === 'idea' && /someday|one day|eventually|at some point/.test(input),   // Inbox unless Nat says so
    test_date: testDate,
    topics: raw.topics?.trim() || null,
    priority: pick(raw.priority, ['high', 'normal', 'low'] as const, 'normal'),
    reminder_kind: reminderKind,
    remind_day: reminderKind === 'person' ? null : remindDay,
    remind_time: reminderKind === 'time' ? remindTime : null,
    person: reminderKind === 'person' ? raw.person : null,
    target_id: target?.id ?? null,
    amount: raw.amount && raw.amount > 0 && raw.amount < 10 ? raw.amount : 1,
    done_on: doneOn ?? ctx.today,
    event_id: event?.id ?? null,
    // "Every week" only when Nat says so; otherwise a change is just this week.
    event_scope: raw.event_scope === 'every' && /every|from now on|permanent|always|each week|for good/.test(input) ? 'every' : 'week',
    event_on_date: onDate,
    new_date: newDate,
    new_start: newStart,
    new_end: newEnd,
    cancel: !!raw.cancel,
    url,
    resource_kind: pick(raw.resource_kind, ['link', 'video', 'goodnotes', 'book', 'article', 'drill', 'other'] as const, 'link'),
    fact: kind === 'fact' ? (raw.fact || raw.title || text).trim() : null,
    topic_id: topic?.id ?? null,
    stage_id: stage?.id ?? null,
    reasoning: raw.reasoning?.trim() ?? '',
    notes,
  }
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

function similar(a: string, b: string): boolean {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  if (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x))) return true
  const A = new Set(x.split(' ').filter((w) => w.length > 2)), B = new Set(y.split(' ').filter((w) => w.length > 2))
  if (A.size < 2 || B.size < 2) return false
  const shared = [...A].filter((w) => B.has(w)).length
  return shared / new Set([...A, ...B]).size >= 0.6
}

export function findDuplicates(p: Proposal, text: string, ctx: CaptureContext): Duplicate[] {
  const out: Duplicate[] = []
  const add = (what: string, title: string) => { if (out.length < 3 && !out.some((d) => d.title === title)) out.push({ what, title }) }
  const probes = [text, p.title]
  if (p.kind === 'goal_progress' && p.target_id) {
    const n = ctx.loggedToday.filter((l) => l.target_id === p.target_id).reduce((a, l) => a + l.amount, 0)
    const t = ctx.targets.find((x) => x.id === p.target_id)
    if (n > 0 && p.done_on === ctx.today) add('Already logged today', `${t?.name ?? 'This target'}: ${n} logged`)
    return out
  }
  for (const t of ctx.openTasks) if (probes.some((q) => similar(q, t.title) || (t.source_text && similar(q, t.source_text)))) add('Open task', t.title)
  for (const r of ctx.reminders) if (probes.some((q) => similar(q, r.body))) add('Reminder', r.body)
  for (const r of ctx.resources) if ((p.url && r.url && norm(p.url) === norm(r.url)) || probes.some((q) => similar(q, r.title))) add('Saved resource', r.title)
  for (const f of ctx.facts) if (probes.some((q) => similar(q, f))) add('Fact', f)
  for (const t of ctx.tests) if (p.kind === 'test' && (similar(p.title, t.title) || (p.test_date && p.test_date === t.target_date && similar(p.title.split(' ')[0], t.title.split(' ')[0])))) add('Test', `${t.title} ${t.target_date ?? ''}`.trim())
  return out
}

