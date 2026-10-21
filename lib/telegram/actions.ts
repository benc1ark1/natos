// Server-only: changes to records Nat already has ("move physics homework to tomorrow", "done with the SMC
// paper", "drop the guitar idea", "tick the Sam reminder", "coach set 3 lower this week").
// The AI only proposes; this file checks every change (the record is real and his, dates come from his words,
// values are sane), shows it as "before → after", applies it with the same functions the dashboard uses once
// he taps ✅, and can undo it (↩️). Nothing is ever deleted: drop = archive, undoing a new project = archive it.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlannerContext } from '../ask/server'
import { completeTask, moveTask, undoComplete, updateTask } from '../data'
import { saveProject, setProjectArchived } from '../projects'
import { setReminderDone } from '../reminders'
import { autoStatus, deadlineLabel } from '../tasks'
import { dowShort, dueAtFromDate, shortDate, timeOf, dateISOOf, todayISO, weekStartISO, zonedToUTC } from '../time'
import type { Project, Reminder, Task, TaskStatus, WeeklyTarget } from '../types'
import { C2_OPS, GUIDE_OPS, STUDY_OPS, applyC2, checkC2, loadC2Rows, undoC2, type C2Applied, type C2Op, type C2Rows } from './actions-c2'
import { PLUGIN_OPS, PLUGINS, pluginFor } from './plugins'
import type { PluginAction, PluginApplied } from './plugin-types'

export const BUILTIN_OPS = ['complete', 'move', 'due', 'drop', 'star', 'unstar', 'minutes', 'importance', 'project', 'rename',
  'reminder_done', 'reminder_when', 'project_new', 'project_archive', 'target_week', ...C2_OPS] as const
export type Op = (typeof BUILTIN_OPS)[number]
/** Every change the brain may send: the built-in ones, then the plug-ins' (lib/telegram/plugins). */
export const OPS: readonly string[] = (() => {
  const clash = PLUGIN_OPS.filter((op) => (BUILTIN_OPS as readonly string[]).includes(op))
  if (clash.length) throw new Error(`plug-in ops clash with built-in ones: ${clash.join(', ')}`)
  return [...BUILTIN_OPS, ...PLUGIN_OPS]
})()
const isC2 = (op: string): op is C2Op => (C2_OPS as readonly string[]).includes(op)

/** What the brain sends for each change ("" / 0 = not used). date_to / time_to: where an event moves to, or its end. */
export type RawAction = { op: string; ref: string; value: string; date: string; date_to: string; time: string; time_to: string; number: number; words: string }

export const ACTION_SCHEMA = {
  type: 'object',
  properties: {
    op: { type: 'string', enum: [...OPS] },
    ref: { type: 'string' },
    value: { type: 'string' },
    date: { type: 'string' },
    date_to: { type: 'string' },
    time: { type: 'string' },
    time_to: { type: 'string' },
    number: { type: 'integer' },
    words: { type: 'string' },
  },
  required: ['op', 'ref', 'value', 'date', 'date_to', 'time', 'time_to', 'number', 'words'],
  additionalProperties: false,
}

type Table = 'tasks' | 'reminders' | 'projects' | 'target_weeks' | 'events' | 'event_exceptions' | 'goals' | 'weekly_targets' | 'training_rules' | 'places' | 'travel_times' | 'profiles' | 'integrations' | 'pipeline_stages' | 'topics' | 'mistakes' | 'guides' | 'guide_logs' | 'mail_rules' | 'load_costs' | 'plan_blocks' | 'habit_items' | 'subjects'
const NOW = '__now__'   // filled in with the time the change is applied
/** Changes one card can hold (a long message about several sessions: each session, place and journey). */
export const MAX_ACTIONS = 16

/** One checked change, ready to show and apply. */
export type Action = {
  op: Op
  table: Table
  id: string | null       // the record (project_new: none yet; target_week: the weekly target)
  title: string           // the record's real name
  line: string            // "Physics homework: due Fri 16 Oct → due Sun 11 Oct"
  patch: Record<string, unknown>
  name?: string           // project_new: the new project's name; project: a project made in the same card
  usualDate?: string      // a one-week event change: the date the session normally happens
}

/** What was applied, so ↩️ Undo can put it back exactly (and only if nothing changed it since). */
export type Applied = { op: Op; table: Table; id: string; title: string; before: Record<string, unknown> | null; after: Record<string, unknown>; usualDate?: string }

export const COLUMN_NAMES: Record<string, string> = { inbox: 'Inbox', today: 'Today', this_week: 'This week', this_month: 'Later', someday: 'Someday', waiting: 'Waiting', completed: 'Done' }
const COLUMN_WORDS: Record<string, TaskStatus> = { today: 'today', this_week: 'this_week', 'this week': 'this_week', later: 'this_month', this_month: 'this_month', someday: 'someday', inbox: 'inbox', waiting: 'waiting' }
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Checking what the brain proposed
// ---------------------------------------------------------------------------

export type Rows = { tasks: Map<string, Task>; reminders: Map<string, Reminder>; projects: Map<string, Project>; targets: Map<string, WeeklyTarget> } & Partial<C2Rows>
  & { plugins?: Record<string, unknown> }   // what each plug-in read for its changes (by plug-in name)

/** Load the records the proposed changes point at (as Nat: row level security means only his). */
export async function loadRows(sb: SupabaseClient, raw: RawAction[], ctx: PlannerContext): Promise<Rows> {
  const ids = (kind: string) => [...new Set(raw.map((a) => ctx.refs.get(a.ref.trim().toUpperCase())).filter((r) => r?.kind === kind).map((r) => r!.id))]
  const get = async <T,>(table: string, list: string[]) => {
    if (!list.length) return new Map<string, T>()
    const { data, error } = await sb.from(table).select('*').in('id', list)
    if (error) throw new Error(`Couldn’t read ${table}: ${error.message}`)
    return new Map(((data ?? []) as (T & { id: string })[]).map((r) => [r.id, r as T]))
  }
  // each plug-in reads what its own changes need
  const pluginRows = Promise.all(PLUGINS.filter((p) => p.loadRows && raw.some((a) => p.ops?.includes(a.op)))
    .map(async (p) => [p.name, await p.loadRows!(sb, raw.filter((a) => p.ops!.includes(a.op)), todayISO())] as const))
  const [tasks, reminders, projects, targets, c2] = await Promise.all([
    get<Task>('tasks', ids('task')), get<Reminder>('reminders', ids('reminder')),
    sb.from('projects').select('*').is('archived_at', null).then((r) => new Map(((r.data ?? []) as Project[]).map((p) => [p.id, p]))),
    get<WeeklyTarget>('weekly_targets', ids('target')),
    // a journey may name a place after an event ("an Uber to the match"), so it needs all events
    loadC2Rows(sb, raw.some((a) => a.op === 'travel_set' || a.op === 'school_day') ? 'all' : ids('event'), ids('goal'), todayISO(), ids('target'), raw.some((a) => STUDY_OPS.includes(a.op)), raw.some((a) => GUIDE_OPS.includes(a.op) || a.op === 'guide_set'),
      { blockIds: ids('block'), archivedIds: ids('archived') }),
  ])
  return { tasks, reminders, projects, targets, ...c2, plugins: Object.fromEntries(await pluginRows) }
}

/** Are these date words really his? (in his message or something he said in the last 30 minutes) */
const grounded = (words: string, said: string) => { const w = norm(words); return w.length >= 3 && norm(said).includes(w) }
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))

/** `said`: his message and what he said in the last 30 minutes; `message`: his message alone (when it isn't `said`). */
export function checkActions(raw: RawAction[], ctx: PlannerContext, rows: Rows, said: string, today: string, message: string = said): { actions: Action[]; problems: string[] } {
  const actions: Action[] = []
  const problems: string[] = []
  const finished = new Set<string>()        // tasks completed or dropped in this card: nothing else to do to them
  const seen = new Set<string>()
  // projects made in this card, so a task can be added to one whatever order the changes came in
  const newProjects = new Set(raw.filter((a) => a.op === 'project_new' && (a.value ?? '').trim()).map((a) => norm(a.value.trim().slice(0, 80))))

  for (const a of raw.slice(0, MAX_ACTIONS)) {
    const op = OPS.includes(a.op) ? (a.op as Op) : null
    if (!op) { problems.push(`unknown change “${a.op}”`); continue }
    const key = JSON.stringify([op, a.ref, a.value, a.date, a.time, a.number])
    if (seen.has(key)) continue
    seen.add(key)
    const ref = ctx.refs.get((a.ref ?? '').trim().toUpperCase())
    const value = (a.value ?? '').trim()

    const plugin = pluginFor(op)
    if (plugin) {
      const r = plugin.check?.(op, { ...a, date_to: a.date_to ?? '', time_to: a.time_to ?? '', number: a.number ?? 0, words: a.words ?? '' }, rows.plugins?.[plugin.name],
        { today, said, grounded: (w) => grounded(w, said), ref, others: raw }) ?? { problem: `“${op}” can’t be checked yet` }
      if (r.problem) problems.push(r.problem)
      if (r.action) actions.push(r.action as unknown as Action)
      continue
    }

    if (isC2(op)) {
      const c2 = { events: rows.events ?? new Map(), changes: rows.changes ?? [], goals: rows.goals ?? new Map(), targets: rows.targets, rules: rows.rules, places: rows.places, planning: rows.planning, google: rows.google, study: rows.study, guides: rows.guides, mailRules: rows.mailRules, costs: rows.costs, titles: rows.titles,
        blocks: rows.blocks, archived: rows.archived, subjects: rows.subjects, categories: rows.categories }
      const sameCardPlaces = raw.filter((x) => x.op === 'place_new' || x.op === 'event_weekly' || x.op === 'event_new')
        .map((x) => Object.fromEntries((x.value ?? '').split(';').map((y) => y.split('=').map((z) => z.trim())))[x.op === 'place_new' ? 'name' : 'place']).filter(Boolean)
      const placeNews = raw.filter((x) => x.op === 'place_new').map((x) => Object.fromEntries((x.value ?? '').split(';').map((y) => y.split('=').map((z) => z.trim()))).name).filter(Boolean)
      const r = checkC2(op, { ...a, date_to: a.date_to ?? '', time_to: a.time_to ?? '', sameCardPlaces, placeNews, said, message } as typeof a & { date_to: string; time_to: string }, ref, c2, (w) => grounded(w, said), today)
      if (r.problem) problems.push(r.problem)
      if (r.action) actions.push(r.action)
      continue
    }

    if (op === 'project_new') {
      const name = value.slice(0, 80)
      if (!name) { problems.push('a new project needs a name'); continue }
      if ([...rows.projects.values()].some((p) => norm(p.name) === norm(name))) { problems.push(`you already have a project called “${name}”`); newProjects.delete(norm(name)); continue }
      actions.push({ op, table: 'projects', id: null, title: name, name, line: `New project: <b>${esc(name)}</b>`, patch: {} })
      continue
    }

    if (op === 'reminder_done' || op === 'reminder_when') {
      const r = ref?.kind === 'reminder' ? rows.reminders.get(ref.id) : null
      if (!r || r.done_at) { problems.push('couldn’t find that reminder'); continue }
      if (op === 'reminder_done') {
        actions.push({ op, table: 'reminders', id: r.id, title: r.body, line: `🔔 ${esc(r.body)}: → ticked off`, patch: { done_at: NOW } })
        continue
      }
      const was = reminderWhen(r)
      if (a.date) {
        if (!isDate(a.date) || a.date < today || !grounded(a.words, said)) { problems.push(`no clear new day for “${r.body}”`); continue }
        const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(a.time ?? '') ? a.time : null
        const patch = time
          ? { kind: 'time', remind_on: null, remind_at: zonedToUTC(a.date, time), person: null }
          : { kind: 'day', remind_on: a.date, remind_at: null, person: null }
        actions.push({ op, table: 'reminders', id: r.id, title: r.body, line: `🔔 ${esc(r.body)}: ${esc(was)} → ${esc(day(a.date))}${time ? ` ${time}` : ''}`, patch })
      } else if (value) {
        const person = value.slice(0, 80)
        actions.push({ op, table: 'reminders', id: r.id, title: r.body, line: `🔔 ${esc(r.body)}: ${esc(was)} → next time you see ${esc(person)}`, patch: { kind: 'person', remind_on: null, remind_at: null, person } })
      } else problems.push(`no new day for “${r.body}”`)
      continue
    }

    if (op === 'project_archive') {
      const p = ref?.kind === 'project' ? rows.projects.get(ref.id) : null
      if (!p) { problems.push('couldn’t find that project'); continue }
      actions.push({ op, table: 'projects', id: p.id, title: p.name, line: `Project <b>${esc(p.name)}</b>: → archived (its tasks stay open)`, patch: { archived_at: NOW } })
      continue
    }

    if (op === 'target_week') {
      const t = ref?.kind === 'target' ? rows.targets.get(ref.id) : null
      if (!t) { problems.push('couldn’t find that weekly target'); continue }
      if (t.counts_from === 'events') { problems.push(`“${t.name}” counts calendar sessions, so its number comes from the calendar`); continue }
      const n = a.number
      if (!Number.isInteger(n) || n < 0 || n > 50) { problems.push(`no clear number for “${t.name}”`); continue }
      actions.push({ op, table: 'target_weeks', id: t.id, title: t.name, line: `🏃 ${esc(t.name)} this week: ${t.target_count} → <b>${n}</b> <i>(just this week)</i>`, patch: { target_count: n, week_start: weekStartISO(today) } })
      continue
    }

    // everything else is about a task
    const t = ref?.kind === 'task' ? rows.tasks.get(ref.id) : null
    if (!t || t.archived_at || t.status === 'completed') { problems.push(ref ? `“${ref.title}” isn’t open any more` : 'couldn’t find that task'); continue }
    if (finished.has(t.id)) continue
    const name = `<b>${esc(t.title)}</b>`
    const add = (line: string, patch: Record<string, unknown>) => actions.push({ op, table: 'tasks', id: t.id, title: t.title, line: `${name}: ${line}`, patch })

    switch (op) {
      case 'complete':
        finished.add(t.id)
        add(`${COLUMN_NAMES[t.status] ?? t.status} → done ✓`, { status: 'completed', completed_at: NOW, archived_at: NOW, archive_reason: 'done' })
        break
      case 'drop':
        if (t.is_system) { problems.push(`“${t.title}” is a test prep session: skip it on the test instead`); break }
        finished.add(t.id)
        add('→ dropped <i>(kept in Archive, can be restored)</i>', { archived_at: NOW, archive_reason: 'dropped' })
        break
      case 'move': {
        const to = COLUMN_WORDS[norm(value).replace(/ /g, '_')] ?? COLUMN_WORDS[norm(value)]
        if (!to) { problems.push(`no column called “${value}”`); break }
        if (to === t.status) { problems.push(`“${t.title}” is already in ${COLUMN_NAMES[to]}`); break }
        add(`${COLUMN_NAMES[t.status]} → ${COLUMN_NAMES[to]}`, { status: to, needs_sorting: false })
        break
      }
      case 'due': {
        if (!isDate(a.date) || a.date < today) { problems.push(`no clear new date for “${t.title}”`); break }
        if (!grounded(a.words, said)) { problems.push(`the date for “${t.title}” wasn’t in your words`); break }
        const was = deadlineLabel(t, today) || 'no date'
        // the column follows the date (my-spec 42), except Waiting and Someday, which are his choice
        const status = ['inbox', 'today', 'this_week', 'this_month'].includes(t.status) ? autoStatus(a.date, today) : t.status
        add(`${esc(was)} → due ${day(a.date)}`, { due_at: dueAtFromDate(a.date), window_start: null, window_end: null, window_label: null, status, needs_sorting: false })
        break
      }
      case 'star':
      case 'unstar':
        if (t.is_key === (op === 'star')) { problems.push(`“${t.title}” is already ${op === 'star' ? 'starred' : 'not starred'}`); break }
        add(op === 'star' ? '☆ → ⭐ starred' : '⭐ → not starred', { is_key: op === 'star' })
        break
      case 'minutes': {
        const n = a.number
        if (!Number.isInteger(n) || n < 1 || n > 600) { problems.push(`no clear time for “${t.title}”`); break }
        add(`${t.duration_minutes ? `~${t.duration_minutes} min` : 'no time'} → ~${n} min`, { duration_minutes: n })
        break
      }
      case 'importance':
        if (!['must', 'nice'].includes(value)) { problems.push(`“${value}” isn’t must or nice`); break }
        if (value === t.importance) { problems.push(`“${t.title}” is already ${value}`); break }
        add(`${t.importance} → ${value}`, { importance: value })
        break
      case 'project': {
        const was = t.project_id ? rows.projects.get(t.project_id)?.name ?? 'a project' : 'no project'
        if (norm(value) === 'none') { if (t.project_id) add(`${esc(was)} → no project`, { project_id: null }); break }
        const p = ctx.refs.get(value.toUpperCase())
        const existing = p?.kind === 'project' ? rows.projects.get(p.id) : [...rows.projects.values()].find((x) => norm(x.name) === norm(value))
        if (existing) {
          if (existing.id === t.project_id) { problems.push(`“${t.title}” is already in ${existing.name}`); break }
          add(`${esc(was)} → project ${esc(existing.name)}`, { project_id: existing.id })
        } else if (newProjects.has(norm(value))) {
          actions.push({ op, table: 'tasks', id: t.id, title: t.title, name: value, line: `${name}: ${esc(was)} → project ${esc(value)} (new)`, patch: {} })
        } else problems.push(`no project called “${value}”`)
        break
      }
      case 'rename': {
        const title = value.slice(0, 200)
        if (!title || title === t.title) { problems.push(`no new name for “${t.title}”`); break }
        actions.push({ op, table: 'tasks', id: t.id, title: t.title, line: `“${esc(t.title)}” → “${esc(title)}”`, patch: { title } })
        break
      }
    }
  }
  // new projects and places first, so tasks and events can use them in the same card
  const first = (a: Action) => Number(a.op === 'project_new' || a.op === 'place_new')
  actions.sort((x, y) => first(y) - first(x))
  return { actions, problems }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const reminderWhen = (r: Reminder) =>
  r.kind === 'person' ? `next time you see ${r.person}` : r.kind === 'day' ? day(r.remind_on!) : `${day(dateISOOf(r.remind_at!))} ${timeOf(r.remind_at!)}`

// ---------------------------------------------------------------------------
// Applying (after ✅) and undoing (after ↩️)
// ---------------------------------------------------------------------------

const fill = (patch: Record<string, unknown>, now: string) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === NOW ? now : v]))
const pick = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))
const POSTPONE = ['postpone_count', 'last_postponed_at']

async function readRow(sb: SupabaseClient, table: string, id: string): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle()
  if (error || !data) throw new Error(`Couldn’t find it any more (${error?.message ?? 'not found'})`)
  return data as Record<string, unknown>
}

/** Apply every change, in order. If one fails, the ones already applied are undone, so it's all or nothing. */
export async function applyActions(sb: SupabaseClient, actions: Action[], today = todayISO()): Promise<{ applied: Applied[]; error: string | null; notPutBack?: string[] }> {
  const applied: Applied[] = []
  const made = new Map<string, string>()   // new project name -> its id
  const now = new Date().toISOString()
  try {
    for (const a of actions) {
      const plugin = pluginFor(a.op)
      if (plugin) {
        if (!plugin.apply) throw new Error(`“${a.op}” can’t be saved yet.`)
        applied.push(await plugin.apply(sb, a as unknown as PluginAction, now, today) as unknown as Applied)
        continue
      }
      if (isC2(a.op)) {
        applied.push(await applyC2(sb, a as Parameters<typeof applyC2>[1], now, today) as Applied)
        continue
      }
      if (a.op === 'project_new') {
        const res = await saveProject(sb, { name: a.name!, category_id: null, notes: null })
        if (res.error || !res.project) throw new Error(res.error ?? 'Project not saved.')
        made.set(norm(a.name!), res.project.id)
        applied.push({ op: a.op, table: 'projects', id: res.project.id, title: a.name!, before: null, after: { archived_at: null } })
        continue
      }
      if (a.table === 'target_weeks') {
        const week = String(a.patch.week_start)
        const { data: old } = await sb.from('target_weeks').select('target_count').eq('target_id', a.id!).eq('week_start', week).maybeSingle()
        const { data: target } = await sb.from('weekly_targets').select('target_count').eq('id', a.id!).maybeSingle()
        const { error } = await sb.from('target_weeks').upsert({ target_id: a.id, week_start: week, target_count: a.patch.target_count }, { onConflict: 'user_id,target_id,week_start' }).select('id').single()
        if (error) throw new Error(`Not saved: ${error.message}`)
        applied.push({ op: a.op, table: 'target_weeks', id: a.id!, title: a.title, before: { target_count: old?.target_count ?? target?.target_count ?? null, week_start: week }, after: { target_count: a.patch.target_count, week_start: week } })
        continue
      }
      const patch = a.op === 'project' && a.name ? { project_id: made.get(norm(a.name)) } : fill(a.patch, now)
      const keys = Object.keys(patch)
      const row = await readRow(sb, a.table, a.id!)
      const before = pick(row, a.table === 'tasks' ? [...keys, ...POSTPONE] : keys)
      let err: string | null = null
      if (a.table === 'tasks') {
        if (a.op === 'complete') err = (await completeTask(sb, row as unknown as Task)).error
        else if (a.op === 'move') err = await moveTask(sb, row as unknown as Task, patch.status as TaskStatus)
        else err = (await updateTask(sb, a.id!, patch as Partial<Task>)).error ?? null
      } else if (a.op === 'reminder_done') err = await setReminderDone(sb, row as unknown as Reminder, true)
      else if (a.op === 'project_archive') err = await setProjectArchived(sb, row as unknown as Project, true)
      else {
        const { error } = await sb.from(a.table).update(patch).eq('id', a.id!).select('id').single()
        err = error ? `Not saved: ${error.message}` : null
      }
      if (err) throw new Error(err)
      // what the database now holds, so Undo can tell if anything changed it since
      applied.push({ op: a.op, table: a.table, id: a.id!, title: a.title, before, after: pick(await readRow(sb, a.table, a.id!), keys) })
    }
    return { applied, error: null }
  } catch (e) {
    const back = await undoActions(sb, applied)
    // never claim nothing changed if something couldn't be put back
    return { applied: [], error: e instanceof Error ? e.message : 'Not saved.', notPutBack: [...back.failed, ...back.skipped] }
  }
}

/** Put everything back, newest first. A record changed since (e.g. on the dashboard) is left alone. */
export async function undoActions(sb: SupabaseClient, applied: Applied[], today = todayISO()): Promise<{ undone: string[]; skipped: string[]; failed: string[] }> {
  const undone: string[] = [], skipped: string[] = [], failed: string[] = []
  for (const a of [...applied].reverse()) {
    try {
      const plugin = pluginFor(a.op)
      if (plugin) {
        const r = plugin.undo ? await plugin.undo(sb, a as unknown as PluginApplied, today) : 'skipped'
        ;(r === 'undone' ? undone : skipped).push(a.title)
        continue
      }
      if (isC2(a.op)) {
        const r = await undoC2(sb, a as C2Applied, today)
        ;(r === 'undone' ? undone : skipped).push(a.title)
        continue
      }
      if (a.op === 'project_new') {
        const err = await setProjectArchived(sb, { id: a.id, name: a.title } as Project, true)   // archived, never deleted
        if (err) throw new Error(err)
        undone.push(`${a.title} (project archived)`)
        continue
      }
      if (a.table === 'target_weeks') {
        const { error } = await sb.from('target_weeks').update({ target_count: a.before?.target_count ?? 0 })
          .eq('target_id', a.id).eq('week_start', String(a.after.week_start)).select('id').single()
        if (error) throw new Error(error.message)
        undone.push(a.title)
        continue
      }
      const now = await readRow(sb, a.table, a.id)
      const keys = Object.keys(a.after)
      if (keys.some((k) => JSON.stringify(now[k] ?? null) !== JSON.stringify(a.after[k] ?? null))) { skipped.push(a.title); continue }
      const before = a.before ?? {}
      let err: string | null = null
      if (a.op === 'complete') err = await undoComplete(sb, { ...(now as unknown as Task), status: before.status as TaskStatus })
      else if (a.op === 'reminder_done') err = await setReminderDone(sb, now as unknown as Reminder, false)
      else if (a.op === 'project_archive') err = await setProjectArchived(sb, now as unknown as Project, false)
      else if (a.table === 'tasks') err = (await updateTask(sb, a.id, pick(before, keys) as Partial<Task>)).error ?? null
      else {
        const { error } = await sb.from(a.table).update(pick(before, keys)).eq('id', a.id).select('id').single()
        err = error ? error.message : null
      }
      if (err) throw new Error(err)
      // moving it back must not count as a postponement (same as the dashboard's Undo)
      if (a.table === 'tasks' && POSTPONE.every((k) => k in before)) {
        const fix = await updateTask(sb, a.id, pick(before, POSTPONE) as Partial<Task>)
        if (fix.error) throw new Error(fix.error)
      }
      undone.push(a.title)
    } catch {
      failed.push(a.title)
    }
  }
  return { undone, skipped, failed }
}
