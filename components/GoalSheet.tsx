'use client'
import { useCallback, useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { GOAL_COLS } from '@/lib/goals'
import type { Lookup } from '@/lib/lookup'
import { createSessions, loadSessions, replanTest, skipSession, unskipSession } from '@/lib/prep'
import { sortTasks } from '@/lib/tasks'
import { dateISOOf, dowShort, shortDate, todayISO } from '@/lib/time'
import type { Goal, Project, Task } from '@/lib/types'
import { loadProjects } from '@/lib/projects'
import DatePicker from './controls/DatePicker'
import Select from './controls/Select'
import Toggle from './controls/Toggle'
import TaskForm from './TaskForm'
import TaskRow from './TaskRow'
import { Empty, type ShowToast } from './ui'

type Props = {
  goal: Goal | null              // null = new
  kind: Goal['kind']             // what a new one is: a goal, or a test
  tasks: Task[]                  // open tasks (all; filtered to this goal here)
  doneCount: number
  lookup: Lookup
  toast: ShowToast
  onComplete: (t: Task) => Promise<void>
  onArchive: (g: Goal) => void
  onSaved: (msg: string) => void
  onTasksChanged: (msg: string) => void
  onClose: () => void
}

const PRIORITIES = [{ value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]

/**
 * One goal (a name, an optional date, linked tasks) or one test
 * (subject, date, topics, priority, and its prep sessions).
 */
export default function GoalSheet({ goal, kind: newKind, tasks, doneCount, lookup, toast, onComplete, onArchive, onSaved, onTasksChanged, onClose }: Props) {
  const kind = goal?.kind ?? newKind
  const isTest = kind === 'test'
  const [title, setTitle] = useState(goal?.title ?? '')
  const [date, setDate] = useState(goal?.target_date ?? '')
  const [ongoing, setOngoing] = useState(!!goal && !goal.target_date)
  const [subject, setSubject] = useState(goal?.subject_id ?? '')
  const [priority, setPriority] = useState<Goal['priority']>(goal?.priority ?? 'normal')
  const [topics, setTopics] = useState(goal?.topics ?? '')
  const [project, setProject] = useState(goal?.project_id ?? '')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [taskForm, setTaskForm] = useState<{ task: Task | null } | null>(null)
  const [sessions, setSessions] = useState<Task[] | null>(null)
  const [sessError, setSessError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const today = todayISO()
  const linked = goal ? sortTasks(tasks.filter((t) => t.goal_id === goal.id && !t.is_system)) : []

  const refreshSessions = useCallback(async () => {
    if (!goal || goal.kind !== 'test') return
    try { setSessions(await loadSessions(getSupabase(), goal.id)); setSessError('') } catch (e) { setSessError(e instanceof Error ? e.message : 'Couldn’t load sessions.') }
  }, [goal])
  useEffect(() => { loadProjects(getSupabase()).then(setProjects, () => setProjects([])) }, [])
  // reload whenever Home reloads (e.g. after Done or Undo from a toast)
  useEffect(() => { refreshSessions() }, [refreshSessions, tasks])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !taskForm) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, taskForm])

  /** Re-spread the open sessions over the days left. */
  const replan = (test: Goal) => replanTest(getSupabase(), test, todayISO())

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError(isTest ? 'Name the test, e.g. Physics test.' : 'Give the goal a name.')
    if ((isTest || !ongoing) && !date) return setError(isTest ? 'Pick the test date.' : 'Pick a date, or turn on "Ongoing".')
    if ((isTest || !ongoing) && date < today && date !== goal?.target_date) return setError('That date has passed. Pick today or later.')
    setSaving(true)
    setError('')
    const values: Partial<Goal> = isTest
      ? { title: title.trim().slice(0, 120), target_date: date, kind, subject_id: subject || null, priority, topics: topics.trim() || null, project_id: project || null }
      : { title: title.trim().slice(0, 120), target_date: ongoing ? null : date, project_id: project || null }
    const sb = getSupabase()
    const { data, error: err } = goal
      ? await sb.from('goals').update(values).eq('id', goal.id).select(GOAL_COLS).single()
      : await sb.from('goals').insert(values).select(GOAL_COLS).single()
    if (err || !data) { setSaving(false); return setError(`Not saved: ${err?.message ?? 'unknown error'}. Your changes are still here.`) }
    const saved = data as unknown as Goal
    let msg = goal ? (isTest ? 'Test saved.' : 'Goal saved.') : `Added ${isTest ? 'test' : 'goal'} “${saved.title}”.`
    if (isTest && !goal) {
      const e2 = await createSessions(sb, saved, today)
      if (e2) { setSaving(false); onSaved(msg); return toast({ kind: 'error', text: `${e2} Open the test and tap Re-plan.` }) }
      msg = `Added test “${saved.title}” and planned its prep sessions.`
    } else if (isTest && goal && (goal.target_date !== saved.target_date || goal.title !== saved.title || goal.subject_id !== saved.subject_id)) {
      const e2 = await replan(saved)
      if (e2) { setSaving(false); onSaved(msg); return toast({ kind: 'error', text: e2 }) }
      msg = 'Test saved; sessions re-planned.'
    }
    setSaving(false)
    onSaved(msg)
  }

  async function skip(s: Task) {
    if (!goal) return
    setBusy(s.id)
    const sb = getSupabase()
    const err = await skipSession(sb, s) ?? await replan(goal)
    setBusy(null)
    if (err) { toast({ kind: 'error', text: err }); return onTasksChanged('') }
    onTasksChanged('')
    toast({
      kind: 'ok', text: 'Skipped; the rest are re-spread.',
      action: { label: 'Undo', run: async () => {
        const e = await unskipSession(sb, s) ?? await replan(goal)
        if (e) toast({ kind: 'error', text: e })
        onTasksChanged(e ? '' : 'Put back.')
      } },
    })
  }

  async function replanClick() {
    if (!goal) return
    setBusy('replan')
    const err = await replan(goal)
    setBusy(null)
    if (err) return toast({ kind: 'error', text: err })
    onTasksChanged('Sessions re-planned around your calendar.')
  }

  const subjectOptions = [{ value: '', label: 'None' }, ...lookup.subjects.map((s) => ({ value: s.id, label: s.name }))]
  const counted = (sessions ?? []).filter((s) => s.archive_reason !== 'expired')
  const sessDone = counted.filter((s) => s.archive_reason === 'done').length

  return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="goal-title">
        <h2 id="goal-title">{goal ? goal.title : isTest ? 'New test' : 'New goal'}</h2>
        <form onSubmit={save}>
          <div className="formgrid">
            <label className="field full"><span>Name</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus={!goal} maxLength={120} placeholder={isTest ? 'Physics test' : 'SMC'} />
            </label>
            {(isTest || !ongoing) && <DatePicker label={isTest ? 'Test date' : 'Date'} value={date} onChange={setDate} placeholder="Pick a date" />}
            <Select label="Project" value={project} onChange={setProject} disabled={!projects} placeholder="Loading…"
              options={projects ? [{ value: '', label: 'None' }, ...projects.map((p) => ({ value: p.id, label: p.name })),
                ...(project && !projects.some((p) => p.id === project) ? [{ value: project, label: 'Archived project' }] : [])] : []} />
            {isTest ? (
              <>
                <Select label="Subject" value={subject} onChange={setSubject} options={subjectOptions} />
                <Select label="Priority" value={priority} onChange={(v) => setPriority(v as Goal['priority'])} options={PRIORITIES} />
                <label className="field full"><span>Topics (optional)</span>
                  <textarea className="textarea" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="Mechanics: moments, projectiles" />
                </label>
              </>
            ) : (
              <div className="field moretoggle">
                <Toggle checked={ongoing} onChange={setOngoing} label="Ongoing (no date)" />
              </div>
            )}
          </div>
          {error && <div style={{ marginTop: 16 }}><div className="err" role="alert">{error}</div></div>}
          <div className="modalfoot">
            {goal && <button type="button" className="btn ghost" style={{ marginRight: 'auto' }} onClick={() => onArchive(goal)}>Archive {isTest ? 'test' : 'goal'}</button>}
            <button type="button" className="btn ghost" onClick={onClose}>{goal ? 'Close' : 'Cancel'}</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : goal ? 'Save' : isTest ? 'Add test' : 'Add goal'}</button>
          </div>
        </form>

        {goal && isTest && (
          <section aria-labelledby="goal-sess-h" style={{ marginTop: 24 }}>
            <div className="ch" style={{ marginBottom: 4 }}>
              <span className="lbl" id="goal-sess-h">Prep sessions · {sessDone}/{counted.length} done</span>
              <button className="btn sm" onClick={replanClick} disabled={busy === 'replan'}>{busy === 'replan' ? 'Re-planning…' : 'Re-plan'}</button>
            </div>
            {sessError && <div className="err" role="alert">{sessError}</div>}
            {!sessions && !sessError && <div className="state">Loading sessions…</div>}
            {sessions && counted.length === 0 && <Empty>No sessions. Tap Re-plan to spread some before the test.</Empty>}
            {sessions && counted.map((s) => s.archived_at ? (
              <div className="trow nice" key={s.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <div className="ttitle" style={{ color: '#7f8a87' }}>{s.title}</div>
                <span className="tmeta">{s.archive_reason === 'done' ? 'Done' : 'Skipped'}</span>
              </div>
            ) : (
              <TaskRow key={s.id} task={s} lookup={lookup} today={today} onComplete={onComplete} pending={busy === s.id}
                meta={s.due_at ? `Planned ${dowShort(dateISOOf(s.due_at))} ${shortDate(dateISOOf(s.due_at))}` : ''}
                onEdit={(x) => setTaskForm({ task: x })}
                actions={<button className="btn sm ghost" disabled={busy === s.id} onClick={() => skip(s)}>Skip</button>} />
            ))}
            <div className="state" style={{ fontSize: 13 }}>Tap a session to move it to another day.</div>
          </section>
        )}

        {goal && (
          <section aria-labelledby="goal-tasks-h" style={{ marginTop: 24 }}>
            <div className="ch" style={{ marginBottom: 4 }}>
              <span className="lbl" id="goal-tasks-h">{isTest ? 'Other tasks' : 'Tasks'} · {doneCount} done · {linked.length} left</span>
              <button className="btn sm" onClick={() => setTaskForm({ task: null })}>+ Add task</button>
            </div>
            {linked.length === 0 && <Empty>No open tasks{isTest ? ' besides the sessions' : ' for this goal'}.</Empty>}
            {linked.map((t) => (
              <TaskRow key={t.id} task={t} lookup={lookup} today={today} onComplete={onComplete} onEdit={(x) => setTaskForm({ task: x })} />
            ))}
          </section>
        )}
      </div>
      {taskForm && goal && (
        <TaskForm task={taskForm.task} lookup={lookup} defaults={{ goal_id: goal.id, subject_id: goal.subject_id }} onClose={() => setTaskForm(null)}
          onSaved={() => { const msg = taskForm.task ? 'Saved.' : 'Task added.'; setTaskForm(null); onTasksChanged(msg) }} />
      )}
    </div>
  )
}
