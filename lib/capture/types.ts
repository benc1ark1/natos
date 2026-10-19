// Shared between the capture route (server) and the capture card (browser).
// The AI proposes; nothing is saved until Nat confirms the card.

import type { Goal, Origin, ReminderKind, Resource } from '../types'

export const CAPTURE_KINDS = ['task', 'test', 'reminder', 'goal_progress', 'event_change', 'idea', 'resource', 'fact', 'study', 'mistake'] as const
export type CaptureKind = (typeof CAPTURE_KINDS)[number]

export const KIND_LABELS: Record<CaptureKind, string> = {
  task: 'Task', test: 'Test', reminder: 'Reminder', goal_progress: 'Progress',
  event_change: 'Event change', idea: 'Idea', resource: 'Resource', fact: 'Fact about me',
  study: 'Study progress', mistake: 'Mistake',
}

/** One proposed item. Names are already matched to Nat's own records (ids), or left empty. */
export type Proposal = {
  kind: CaptureKind
  title: string
  // task / idea
  subject_id: string | null
  importance: 'must' | 'nice'
  due: string | null                // YYYY-MM-DD
  due_time?: string | null          // HH:MM London, when the words give a clock time (homework emails)
  details?: string | null           // the task's notes (homework emails: what to do)
  window_label: string | null       // as said: "this weekend"
  window_end: string | null         // last OK day
  duration_minutes: number | null
  origin: Origin
  project_id: string | null
  hand_in: string | null
  someday: boolean                  // idea: Someday instead of Inbox
  // test
  test_date: string | null
  topics: string | null
  priority: Goal['priority']
  // reminder
  reminder_kind: ReminderKind
  remind_day: string | null
  remind_time: string | null        // HH:MM
  person: string | null
  // goal progress
  target_id: string | null
  amount: number
  done_on: string
  // event change
  event_id: string | null
  event_scope: 'week' | 'every'
  event_on_date: string | null      // the usual date of the session being changed
  new_date: string | null
  new_start: string | null
  new_end: string | null
  cancel: boolean
  // resource
  url: string | null
  resource_kind: Resource['kind']
  // fact
  fact: string | null
  // study progress (a stage of a topic done) / mistake (to review later); subject_id is shared
  topic_id: string | null
  stage_id: string | null
  // explanation
  reasoning: string
  notes: string[]                   // checks the server made, e.g. "Removed a date that wasn't in your words"
}

export type Duplicate = { what: string; title: string }

export type CaptureResult =
  | { ok: true; proposal: Proposal; duplicates: Duplicate[] }
  | { ok: false; error: string }
