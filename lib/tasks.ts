import type { Task, TaskStatus } from './types'
import { addDays, dateISOOf, daysBetween, dowShort, shortDate, weekStartISO } from './time'

export const isOpen = (t: Task) => t.status !== 'completed' && !t.archived_at

/** The day a task must be done by: its due date, or the end of its window. */
export function deadlineOf(t: Task): string | null {
  if (t.due_at) return dateISOOf(t.due_at)
  return t.window_end
}

/** "Due" = has a due date or a window. Everything else is "Nice". */
export const isDue = (t: Task) => deadlineOf(t) !== null

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function deadlineLabel(t: Task, today: string): string {
  if (t.due_at) {
    const d = dateISOOf(t.due_at)
    const diff = daysBetween(today, d)
    if (diff < 0) return `Overdue · was due ${dowShort(d)} ${shortDate(d)}`
    if (diff === 0) return 'Due today'
    if (diff === 1) return 'Due tomorrow'
    if (diff < 7) return `Due ${dowShort(d)}`
    return `Due ${shortDate(d)}`
  }
  if (t.window_end && daysBetween(today, t.window_end) < 0) return `Overdue · window ended ${shortDate(t.window_end)}`
  if (t.window_label) return cap(t.window_label)
  if (t.window_end) {
    const diff = daysBetween(today, t.window_end)
    return `By ${diff < 7 ? dowShort(t.window_end) : shortDate(t.window_end)}`
  }
  return ''
}

export function metaLine(t: Task, today: string): string {
  const parts = [deadlineLabel(t, today)]
  if (t.details) parts.push(t.details.split('\n')[0])
  return parts.filter(Boolean).join(' · ')
}

function compareTasks(a: Task, b: Task): number {
  if (isDue(a) !== isDue(b)) return isDue(a) ? -1 : 1
  if (a.is_key !== b.is_key) return a.is_key ? -1 : 1
  const da = deadlineOf(a), db = deadlineOf(b)
  if (da !== db) {
    if (!da) return 1
    if (!db) return -1
    return da < db ? -1 : 1
  }
  return a.created_at < b.created_at ? -1 : 1
}

export const sortTasks = (tasks: Task[]) => [...tasks].sort(compareTasks)

/**
 * Home's TODAY list: things in the Today column, starred tasks, and anything
 * due by tomorrow. Due first. At most 6. Someday never feeds Today.
 */
export function pickToday(tasks: Task[], today: string, max = 6): Task[] {
  return sortTasks(
    tasks.filter((t) => {
      if (!isOpen(t) || t.status === 'someday') return false
      if (t.status === 'today' || t.is_key) return true
      const d = deadlineOf(t)
      return d !== null && daysBetween(today, d) <= 1
    }),
  ).slice(0, max)
}

// Kanban columns. "Later" holds this_month and waiting; "Someday" is the backlog.
export type Column = 'inbox' | 'today' | 'this_week' | 'later' | 'someday'
export const COLUMNS: { key: Column; label: string; status: TaskStatus }[] = [
  { key: 'inbox', label: 'Inbox', status: 'inbox' },
  { key: 'today', label: 'Today', status: 'today' },
  { key: 'this_week', label: 'This week', status: 'this_week' },
  { key: 'later', label: 'Later', status: 'this_month' },
  { key: 'someday', label: 'Someday', status: 'someday' },
]

export function columnOf(t: Task): Column {
  if (t.status === 'inbox' || t.status === 'today' || t.status === 'this_week' || t.status === 'someday') return t.status
  return 'later'
}

// "By date" view groups, in display order. Weeks run Monday to Sunday.
export type DateGroup = 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'next_week' | 'later' | 'none'
export const DATE_GROUPS: { key: DateGroup; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'tomorrow', label: 'Tomorrow' },
  { key: 'this_week', label: 'This week' },
  { key: 'next_week', label: 'Next week' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No date' },
]

/** Which "By date" group a task falls in, from its due date or the end of its window. */
export function dateGroupOf(t: Task, today: string): DateGroup {
  const d = deadlineOf(t)
  if (!d) return 'none'
  const diff = daysBetween(today, d)
  if (diff < 0) return 'overdue'
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  const thisSunday = addDays(weekStartISO(today), 6)
  if (d <= thisSunday) return 'this_week'
  if (d <= addDays(thisSunday, 7)) return 'next_week'
  return 'later'
}

/** Earliest deadline first; same day falls back to the normal order (must-do first). */
export const sortByDate = (tasks: Task[]) =>
  [...tasks].sort((a, b) => {
    const da = deadlineOf(a) ?? '9999', db = deadlineOf(b) ?? '9999'
    return da !== db ? (da < db ? -1 : 1) : compareTasks(a, b)
  })

/** Column for a new task from its deadline: today (or past) → Today, next 7 days → This week, later → Later, none → Inbox. */
export function autoStatus(deadline: string | null, today: string): TaskStatus {
  if (!deadline) return 'inbox'
  if (deadline <= today) return 'today'
  return daysBetween(today, deadline) <= 6 ? 'this_week' : 'this_month'
}
