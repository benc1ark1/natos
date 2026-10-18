import type { SupabaseClient } from '@supabase/supabase-js'
import type { Category, Subject, Task, TaskStatus } from './types'

type Res<T> = { data: T | null; error: { message: string } | null }

/** Unwrap a query result or throw a readable error. */
export function rows<T>(res: Res<T[]>, what: string): T[] {
  if (res.error) throw new Error(`Couldn't load ${what}: ${res.error.message}`)
  return res.data ?? []
}

export async function getUserId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.auth.getUser()
  if (error || !data.user) throw new Error('You are signed out. Please sign in again.')
  return data.user.id
}

export async function loadLookupRows(sb: SupabaseClient): Promise<{ categories: Category[]; subjects: Subject[] }> {
  const [c, s] = await Promise.all([
    sb.from('categories').select('id,name,description').order('created_at'),
    sb.from('subjects').select('id,category_id,name,sort_order,archived_at').is('archived_at', null).order('sort_order'),
  ])
  return { categories: rows<Category>(c, 'areas'), subjects: rows<Subject>(s, 'subjects') }
}

/**
 * Open tasks. First archives prep sessions of tests that have passed (so no background job is needed),
 * then hides all but the next prep session of each test (the rest show on the test itself).
 */
export async function loadOpenTasks(sb: SupabaseClient): Promise<Task[]> {
  const exp = await sb.rpc('archive_expired')
  if (exp.error) throw new Error(`Couldn't tidy up past tests: ${exp.error.message}`)
  const res = await sb.from('tasks').select('*').is('archived_at', null).neq('status', 'completed').order('created_at')
  return nextSessionsOnly(rows<Task>(res, 'tasks'))
}

/** Keep ordinary tasks, plus only the earliest open prep session per test. */
export function nextSessionsOnly(tasks: Task[]): Task[] {
  const next = new Map<string, Task>()
  const key = (t: Task) => `${t.due_at ?? '9999'}${String(t.session_no ?? 0).padStart(3, '0')}`
  for (const t of tasks) {
    if (!t.is_system || !t.goal_id) continue
    const cur = next.get(t.goal_id)
    if (!cur || key(t) < key(cur)) next.set(t.goal_id, t)
  }
  return tasks.filter((t) => !t.is_system || !t.goal_id || next.get(t.goal_id) === t)
}

/** Completing archives the task (never deletes). Tasks never count toward weekly targets. */
export async function completeTask(sb: SupabaseClient, task: Task): Promise<{ error: string | null }> {
  const now = new Date().toISOString()
  const { data, error } = await sb.from('tasks')
    .update({ status: 'completed', completed_at: now, archived_at: now, archive_reason: 'done' })
    .eq('id', task.id).select('id').single()
  if (error || !data) return { error: `Couldn't complete "${task.title}": ${error?.message ?? 'not saved'}` }
  return { error: null }
}

/** Undo a completion: back to its old column. */
export async function undoComplete(sb: SupabaseClient, before: Task): Promise<string | null> {
  const { data, error } = await sb.from('tasks')
    .update({ status: before.status, completed_at: null, archived_at: null, archive_reason: null })
    .eq('id', before.id).select('id').single()
  return error || !data ? `Couldn't undo: ${error?.message ?? 'not saved'}` : null
}

export async function restoreTask(sb: SupabaseClient, task: Task): Promise<string | null> {
  const { data, error } = await sb.from('tasks')
    .update({ status: 'inbox', completed_at: null, archived_at: null, archive_reason: null })
    .eq('id', task.id).select('id').single()
  return error || !data ? `Couldn't restore "${task.title}": ${error?.message ?? 'not saved'}` : null
}

export async function updateTask(sb: SupabaseClient, id: string, patch: Partial<Task>): Promise<{ task?: Task; error?: string }> {
  const { data, error } = await sb.from('tasks').update(patch).eq('id', id).select('*').single()
  if (error || !data) return { error: `Couldn't save: ${error?.message ?? 'not saved'}` }
  return { task: data as Task }
}

/** Move a task to another column. Returns an error message, or null when the database confirmed it. */
export async function moveTask(sb: SupabaseClient, task: Task, status: TaskStatus): Promise<string | null> {
  const res = await updateTask(sb, task.id, { status, needs_sorting: false })   // moved by hand = sorted
  return res.error ?? null
}

/**
 * Undo a move: put the task back in its old column and restore its postpone
 * counter (moving it back can't be allowed to count as a postponement).
 */
export async function undoMove(sb: SupabaseClient, before: Task): Promise<string | null> {
  const back = await updateTask(sb, before.id, { status: before.status })
  if (back.error) return back.error
  const fix = await updateTask(sb, before.id, { postpone_count: before.postpone_count, last_postponed_at: before.last_postponed_at })
  return fix.error ?? null
}

/** Save a capture: to the Inbox, or wherever its optional details put it. */
export async function captureToInbox(sb: SupabaseClient, text: string, details: Partial<Task> = {}): Promise<{ task?: Task; error?: string }> {
  const clean = text.trim()
  const { data, error } = await sb.from('tasks')
    .insert({ title: clean.slice(0, 200), status: 'inbox', source: 'dashboard', source_text: clean, ...details })
    .select('*').single()
  if (error || !data) return { error: `Not saved: ${error?.message ?? 'unknown error'}` }
  return { task: data as Task }
}

/** Only allow normal web links to be opened from saved resources. */
export function safeUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}
