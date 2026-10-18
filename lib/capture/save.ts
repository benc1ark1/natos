import type { SupabaseClient } from '@supabase/supabase-js'
import { captureToInbox, getUserId } from '../data'
import { expandEvents, saveChange, setEventArchived } from '../events'
import { GOAL_COLS } from '../goals'
import { createSessions } from '../prep'
import { autoStatus } from '../tasks'
import { addDays, dueAtFromDate, isoDow, minutesOf, shortDate, todayISO, weekStartISO, zonedToUTC } from '../time'
import type { EventException, EventRow, Goal, Subject, Task } from '../types'
import type { Proposal } from './types'
import { logMistake, markStageDone, undoStage } from '../study-data'

// Saves a confirmed capture card. Runs in the browser as Nat (row level security applies).
// Every message is only shown after the database confirms.

/** What a saved card can undo from Telegram (after the request has finished): a log, a stage done, a mistake. */
export type UndoRef = { table: 'target_logs' | 'topic_progress' | 'mistakes'; id: string }
type Saved = { message?: string; error?: string; task?: Task; undo?: () => Promise<string | null>; logId?: string; undoRef?: UndoRef }
const where: Record<string, string> = { inbox: 'Inbox', today: 'Today', this_week: 'This week', this_month: 'Later', someday: 'Someday' }
const failed = (what: string, e: { message: string } | null) => ({ error: `${what} not saved: ${e?.message ?? 'unknown error'}. Your text is still in the box.` })

/** The AI couldn't sort it: keep the raw words in Inbox, labelled "not sorted yet". */
export async function saveUnsorted(sb: SupabaseClient, text: string): Promise<Saved> {
  const res = await captureToInbox(sb, text, { needs_sorting: true })
  return res.error ? { error: `${res.error} Your text is still in the box.` } : { task: res.task, message: 'Saved to Inbox as “not sorted yet”.' }
}

export async function saveProposal(sb: SupabaseClient, p: Proposal, text: string, subjects: Subject[]): Promise<Saved> {
  const today = todayISO()
  const source_text = text.trim()
  let category_id = subjects.find((s) => s.id === p.subject_id)?.category_id ?? null
  if (p.subject_id && !subjects.some((s) => s.id === p.subject_id)) {   // card's list not loaded yet
    const { data } = await sb.from('subjects').select('category_id').eq('id', p.subject_id).maybeSingle()
    category_id = data?.category_id ?? null
  }

  switch (p.kind) {
    case 'task':
    case 'idea': {
      const deadline = p.kind === 'task' ? p.due ?? p.window_end : null
      // Inbox is only for unsorted captures and dateless ideas (my-spec 38): a sorted task with no date goes to Later.
      const status = p.kind === 'idea' ? (p.someday ? 'someday' : 'inbox') : deadline ? autoStatus(deadline, today) : 'this_month'
      const res = await captureToInbox(sb, text, {
        title: p.title.trim().slice(0, 200), status, subject_id: p.subject_id, category_id,
        importance: p.kind === 'task' ? p.importance : 'nice',
        due_at: p.kind === 'task' && p.due ? dueAtFromDate(p.due) : null,
        window_label: p.kind === 'task' ? p.window_label : null,
        window_end: p.kind === 'task' && !p.due ? p.window_end : null,
        duration_minutes: p.duration_minutes, origin: p.origin, project_id: p.project_id, hand_in: p.hand_in,
      })
      if (res.error || !res.task) return { error: `${res.error} Your text is still in the box.` }
      return { task: res.task, message: `${p.kind === 'idea' ? 'Idea' : 'Task'} saved to ${where[res.task.status] ?? 'Tasks'}.` }
    }

    case 'test': {
      if (!p.test_date) return { error: 'A test needs a date. Pick one.' }
      if (p.test_date < today) return { error: 'That date has passed. Pick today or later.' }
      const { data, error } = await sb.from('goals').insert({
        title: p.title.trim().slice(0, 120), kind: 'test', target_date: p.test_date, subject_id: p.subject_id,
        priority: p.priority, topics: p.topics, project_id: p.project_id, source_text,
      }).select(GOAL_COLS).single()
      if (error || !data) return failed('Test', error)
      const e2 = await createSessions(sb, data as unknown as Goal, today)
      return e2
        ? { message: `Test saved, but its prep sessions weren’t planned (${e2}). Open the test and tap Re-plan.` }
        : { message: `Test saved for ${shortDate(p.test_date)}, with prep sessions planned.` }
    }

    case 'reminder': {
      const k = p.reminder_kind
      if (k !== 'person' && !p.remind_day) return { error: 'Pick a day for the reminder.' }
      if (k === 'time' && !p.remind_time) return { error: 'Pick a time, or make it a day reminder.' }
      if (k === 'person' && !p.person?.trim()) return { error: 'Who is the reminder about?' }
      const { data, error } = await sb.from('reminders').insert({
        body: p.title.trim().slice(0, 300), kind: k,
        remind_on: k === 'day' ? p.remind_day : null,
        remind_at: k === 'time' ? zonedToUTC(p.remind_day!, p.remind_time!) : null,
        person: k === 'person' ? p.person!.trim().slice(0, 80) : null,
        source_text,
      }).select('id').single()
      if (error || !data) return failed('Reminder', error)
      return { message: 'Reminder saved.' }
    }

    case 'goal_progress': {
      if (!p.target_id) return { error: 'Pick which weekly target this counts toward.' }
      const user_id = await getUserId(sb)
      const { data, error } = await sb.from('target_logs').insert({
        user_id, target_id: p.target_id, done_on: p.done_on || today, amount: Math.max(1, p.amount), source: 'capture', note: source_text,
      }).select('id').single()
      if (error || !data) return failed('Progress', error)
      return {
        message: `Logged +${Math.max(1, p.amount)} toward this week’s target.`,
        logId: data.id,   // so the Telegram bot can offer the same Undo after the request has finished
        undoRef: { table: 'target_logs', id: data.id },
        // Same as the Log button's Undo on Home: removes just this log.
        undo: async () => { const r = await sb.from('target_logs').delete().eq('id', data.id).select('id').single(); return r.error ? `Couldn't undo: ${r.error.message}` : null },
      }
    }

    case 'event_change':
      return saveEventChange(sb, p)

    case 'study': {
      if (!p.topic_id || !p.stage_id) return { error: 'Pick the topic and the stage you finished.' }
      const r = await markStageDone(sb, p.topic_id, p.stage_id, source_text)
      if (r.error || !r.id) return { error: `${r.error ?? 'Not saved.'} Your text is still in the box.` }
      const { data: names } = await sb.from('topics').select('name').eq('id', p.topic_id).maybeSingle()
      const { data: stage } = await sb.from('pipeline_stages').select('name').eq('id', p.stage_id).maybeSingle()
      return {
        message: `${names?.name ?? 'Topic'}: “${stage?.name ?? 'stage'}” done. It moves on to the next stage.`,
        undoRef: { table: 'topic_progress', id: r.id },
        undo: () => undoStage(sb, r.id!),
      }
    }

    case 'mistake': {
      const r = await logMistake(sb, { subject_id: p.subject_id, topic_id: p.topic_id, body: p.title, source_text })
      if (r.error || !r.id) return { error: `${r.error ?? 'Not saved.'} Your text is still in the box.` }
      return {
        message: `Mistake logged. It comes back for review on ${shortDate(r.review_on!)}.`,
        undoRef: { table: 'mistakes', id: r.id },
        undo: async () => { const x = await sb.from('mistakes').update({ archived_at: new Date().toISOString() }).eq('id', r.id!).select('id').single(); return x.error ? `Couldn't undo: ${x.error.message}` : null },
      }
    }

    case 'resource': {
      const { data, error } = await sb.from('resources').insert({
        title: p.title.trim().slice(0, 200), url: p.url, kind: p.resource_kind, subject_id: p.subject_id, category_id, source_text,
      }).select('id').single()
      if (error || !data) return failed('Resource', error)
      return { message: 'Resource saved (Inbox → Saved links).' }
    }

    case 'fact': {
      const fact = (p.fact ?? p.title).trim()
      if (!fact) return { error: 'The fact is empty.' }
      const { data, error } = await sb.from('context_facts').insert({ fact: fact.slice(0, 500), source_text }).select('id').single()
      if (error || !data) return failed('Fact', error)
      return { message: 'Fact saved. The AI will use it from now on.' }
    }
  }
}

async function saveEventChange(sb: SupabaseClient, p: Proposal): Promise<Saved> {
  if (!p.event_id) return { error: 'Pick which event this changes.' }
  const { data: ev, error } = await sb.from('events').select('*').eq('id', p.event_id).single()
  if (error || !ev) return failed('Change', error)
  const event = ev as EventRow

  if (p.event_scope === 'every') {
    if (p.cancel) {
      const e = await setEventArchived(sb, event, true)
      return e ? { error: e } : { message: `Deleted “${event.title}” (every week). Restore it from the calendar if needed.` }
    }
    const patch: Partial<EventRow> = {}
    if (p.new_start) {
      patch.start_time = p.new_start
      patch.end_time = p.new_end ?? event.end_time
    }
    if (p.new_date && event.repeat_days?.length && p.event_on_date) {
      const from = isoDow(p.event_on_date), to = isoDow(p.new_date)
      patch.repeat_days = [...new Set(event.repeat_days.map((d) => (d === from ? to : d)))].sort()
    }
    if (patch.start_time && patch.end_time && minutesOf(patch.end_time) <= minutesOf(patch.start_time)) return { error: 'The end time must be after the start.' }
    if (Object.keys(patch).length === 0) return { error: 'Nothing to change. Pick a new day or time.' }
    const r = await sb.from('events').update(patch).eq('id', event.id).select('id').single()
    if (r.error || !r.data) return failed('Change', r.error)
    return { message: `“${event.title}” changed for every week.` }
  }

  if (!p.event_on_date) return { error: 'Couldn’t find the next session of that event.' }
  const { data: ch, error: e2 } = await sb.from('event_exceptions').select('*').eq('event_id', event.id).eq('on_date', p.event_on_date)
  if (e2) return failed('Change', e2)
  const wk = weekStartISO(p.event_on_date)
  const occ = expandEvents([event], wk, addDays(wk, 6), (ch ?? []) as EventException[])
    .find((o) => o.usualDate === p.event_on_date)
  if (!occ) return { error: 'Couldn’t find that session in your calendar.' }
  const userId = await getUserId(sb)
  if (p.cancel) {
    const e = await saveChange(sb, userId, occ, { cancelled: true })
    return e ? { error: e } : { message: `Cancelled “${event.title}” on ${shortDate(p.event_on_date)} (just this week).` }
  }
  if (!p.new_date && !p.new_start) return { error: 'Pick a new day or time.' }
  const e = await saveChange(sb, userId, occ, {
    cancelled: false,
    new_date: p.new_date && p.new_date !== p.event_on_date ? p.new_date : null,
    new_start: p.new_start ?? null, new_end: p.new_start ? p.new_end ?? null : null,
  })
  return e ? { error: e } : { message: `Moved “${event.title}” just this week.` }
}
