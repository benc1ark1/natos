// His own ACT tasks ("ACT reading passage set 3", on a day he gave): they go on that day, with the ACT work, and their
// minutes are part of that day's ACT time. Pure: no database.
import { deadlineOf } from '../tasks'
import type { Task } from '../types'

const open = (t: Task) => !(t.status === 'completed' || t.archived_at || t.status === 'someday' || t.is_system)

/** An ACT task he added himself (the ACT subject, or "ACT" in its title). */
export const isActTask = (t: { title: string; subject_id: string | null }, actSubjectId: string | null | undefined) =>
  (!!actSubjectId && t.subject_id === actSubjectId) || /\bACT\b/.test(t.title)

/** His open ACT tasks for this day (by the date he gave). */
export const actTasksOn = (tasks: Task[], date: string, actSubjectId: string | null | undefined) =>
  tasks.filter((t) => open(t) && isActTask(t, actSubjectId) && deadlineOf(t) === date)

/** Their minutes (30 when he gave none). */
export const actTaskMinutes = (tasks: Task[], date: string, actSubjectId: string | null | undefined) =>
  actTasksOn(tasks, date, actSubjectId).reduce((n, t) => n + (t.duration_minutes ?? 30), 0)
