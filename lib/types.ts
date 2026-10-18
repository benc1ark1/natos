// Row shapes for the Supabase tables this app uses.

export type TaskStatus = 'inbox' | 'today' | 'this_week' | 'this_month' | 'waiting' | 'someday' | 'completed'
export type Importance = 'must' | 'nice'
/** Where a task came from: the key of one of his task sources (lib/lists.ts; "own" = himself). */
export type Origin = string

export type Task = {
  id: string
  user_id: string
  category_id: string | null
  subject_id: string | null
  title: string
  details: string | null
  priority: 'low' | 'medium' | 'high' | 'critical'
  status: TaskStatus
  due_at: string | null
  is_key: boolean
  source: string
  source_text: string | null
  completed_at: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
  importance: Importance
  window_start: string | null
  window_end: string | null
  window_label: string | null
  origin: Origin
  duration_minutes: number | null
  postpone_count: number
  last_postponed_at: string | null
  target_id: string | null
  goal_id: string | null
  is_system: boolean               // generated prep session (hidden from Archive)
  session_no: number | null
  archive_reason: 'done' | 'expired' | 'skipped' | 'dropped' | null
  project_id: string | null
  hand_in: string | null           // how/where to hand it in
  hand_in_url: string | null
  needs_sorting: boolean           // AI capture failed: raw text saved to Inbox, "not sorted yet"
}

export type Category = { id: string; name: string; description: string | null }

export type Subject = {
  id: string
  category_id: string | null
  name: string
  sort_order: number
  archived_at: string | null
}

export type WeeklyTarget = {
  id: string
  name: string
  activity_type: string | null
  subject_id: string | null
  target_count: number
  bonus_count: number | null
  sync_source: 'manual' | 'hevy' | 'trainheroic' | 'whoop'
  counts_from: 'logs' | 'events'   // Log taps, or its linked calendar sessions (e.g. Team)
  training_type?: string | null    // upper, lower, … or 'none' (jarvis-d2.sql / jarvis-g.sql); empty = the bot asks
  load?: string | null             // hard or light
  session_minutes?: number | null  // how long one session is (the week planner uses it; empty = 60)
  whoop_sports?: string[]          // Whoop activities that count toward it ("Weightlifting"); empty = none
  is_active: boolean
  sort_order: number
}

export type TargetLog = {
  id: string
  target_id: string
  done_on: string
  amount: number
  source: string
  created_at: string
}

export type Habit = {
  id: string
  name: string
  is_active: boolean
  sort_order: number
  days_of_week: number[]
}

export type HabitItem = {
  id: string
  habit_id: string
  name: string
  is_required: boolean
  sort_order: number
  guide_url: string | null
  guide_id: string | null
  condition_label: string | null
  days_of_week: number[] | null
}

export type HabitLog = {
  id: string
  habit_item_id: string
  log_date: string
  completed: boolean
  completed_at: string | null
  skipped: boolean
}

export type EventRow = {
  id: string
  title: string
  category_id: string | null
  subject_id: string | null
  location: string | null
  starts_at: string | null
  ends_at: string | null
  repeat_days: number[] | null
  start_time: string | null
  end_time: string | null
  repeat_from: string | null
  repeat_until: string | null
  is_busy: boolean
  travel_minutes: number       // each way; busy time = event + travel before and after
  target_id: string | null     // counts toward this weekly target (step 5)
  training_type?: string | null  // upper, lower, … or 'none' (jarvis-d2.sql / jarvis-g.sql); empty = the bot asks
  load?: string | null           // hard or light
  is_school?: boolean | null     // school (school nights, "after school"); empty = guessed (repeats 5+ days)
  external_source?: string       // 'manual' (his own) or 'google' (a read-only copy from one of his Google calendars)
  calendar_id?: string | null    // the Google calendar a copy came from
  all_day?: boolean              // a whole-day event (from Google): shown, never busy time
  sync_google?: boolean          // his own events: also shown in his "Life OS" Google calendar
  archived_at: string | null
}

/** A one-week change to an event, keyed by the date it would normally happen. */
export type EventException = {
  id: string
  event_id: string
  on_date: string
  cancelled: boolean
  new_date: string | null
  new_start: string | null
  new_end: string | null
  missed: boolean
}

export type Resource = {
  id: string
  title: string
  url: string | null
  kind: 'link' | 'video' | 'goodnotes' | 'book' | 'article' | 'drill' | 'other'
  subject_id: string | null
  category_id: string | null
  notes: string | null
  archived_at: string | null
  created_at: string
}

export type Profile = { user_id: string; display_name: string; timezone: string }

export type ReminderKind = 'day' | 'time' | 'person'

export type Reminder = {
  id: string
  body: string
  kind: ReminderKind
  remind_on: string | null
  remind_at: string | null
  person: string | null
  done_at: string | null
  created_at: string
}

export type Goal = {
  id: string
  title: string
  target_date: string | null   // none = ongoing (a test always has one)
  archived_at: string | null
  created_at: string
  kind: 'goal' | 'test'
  subject_id: string | null
  topics: string | null
  priority: 'high' | 'normal' | 'low'
  project_id: string | null
}

export type Project = {
  id: string
  name: string
  category_id: string | null
  notes: string | null
  sort_order: number
  archived_at: string | null
  created_at: string
}

export type Guide = {
  id: string
  title: string
  icon: string | null
  body: string
  sort_order: number
  import_key: string | null
  archived_at: string | null
  updated_at: string
  category_id?: string | null      // Study / Athletic / Personal; empty = guessed from the title
  has_log?: boolean                // fixed rules + a dated weekly log (Athletic & Lower)
}

export type ContextFact = {
  id: string
  fact: string
  topic: string | null
  is_active: boolean
  source_text: string | null
  created_at: string
}
