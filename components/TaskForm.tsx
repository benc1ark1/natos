'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { loadActiveGoals } from '@/lib/goals'
import type { Goal, Project, Task } from '@/lib/types'
import { cleanUrl, loadProjects } from '@/lib/projects'
import type { Lookup } from '@/lib/lookup'
import { COLUMNS, autoStatus } from '@/lib/tasks'
import { activeSources } from '@/lib/lists'
import { usePlanning } from '@/lib/usePlanning'
import { dateISOOf, dueAtFromDate, todayISO } from '@/lib/time'
import DatePicker from './controls/DatePicker'
import Select, { type Option } from './controls/Select'
import Toggle from './controls/Toggle'

type Props = {
  task?: Task | null                 // edit this task, or create a new one
  defaults?: Partial<Task>           // starting values for a new task
  lookup: Lookup
  onSaved: (t: Task) => void
  onClose: () => void
}

type FormState = {
  title: string; details: string; subject_id: string; category_id: string
  status: string; due: string; window_label: string; window_end: string
  duration: string; origin: Task['origin']; goal_id: string; is_key: boolean
  project_id: string; hand_in: string; hand_in_url: string
}

function initialState(t?: Task | null, d?: Partial<Task>): FormState {
  const src = { ...d, ...t }
  return {
    title: src.title ?? '',
    details: src.details ?? '',
    subject_id: src.subject_id ?? '',
    category_id: src.category_id ?? '',
    // '' = new task: column picked from the due date when saved
    status: t && t.status !== 'completed' ? t.status : d?.status ?? '',
    due: src.due_at ? dateISOOf(src.due_at) : '',
    window_label: src.window_label ?? '',
    window_end: src.window_end ?? '',
    duration: src.duration_minutes ? String(src.duration_minutes) : '',
    origin: src.origin ?? 'own',
    goal_id: src.goal_id ?? '',
    is_key: src.is_key ?? false,
    project_id: src.project_id ?? '',
    hand_in: src.hand_in ?? '',
    hand_in_url: src.hand_in_url ?? '',
  }
}

export default function TaskForm({ task, defaults, lookup, onSaved, onClose }: Props) {
  const planning = usePlanning()
  const [f, setF] = useState<FormState>(() => initialState(task, defaults))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // the extra fields stay hidden unless asked for, or the task already uses them
  const [more, setMore] = useState(() => {
    const s = initialState(task, defaults)
    return !!task && !!(s.details || s.subject_id || s.category_id || s.window_label || s.window_end || s.duration ||
      s.origin !== 'own' || s.goal_id || s.is_key || s.project_id || s.hand_in || s.hand_in_url)
  })
  const [goals, setGoals] = useState<Goal[] | null>(null)
  const [goalsError, setGoalsError] = useState('')
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [projectsError, setProjectsError] = useState('')
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }))

  useEffect(() => {
    loadActiveGoals(getSupabase(), todayISO()).then(setGoals, (e) => setGoalsError(e instanceof Error ? e.message : 'Couldn’t load goals.'))
    loadProjects(getSupabase()).then(setProjects, (e) => setProjectsError(e instanceof Error ? e.message : 'Couldn’t load projects.'))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function pickSubject(id: string) {
    const sub = lookup.subjectById.get(id)
    setF((s) => ({ ...s, subject_id: id, category_id: sub?.category_id ?? s.category_id }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!f.title.trim()) { setError('Give it a title.'); return }
    const mins = f.duration ? Number(f.duration) : null
    if (mins !== null && (!Number.isInteger(mins) || mins <= 0)) { setError('Duration must be a whole number of minutes.'); return }
    const link = cleanUrl(f.hand_in_url)
    if (link === null) { setError('The hand-in link must be a web address, e.g. classroom.google.com/…'); return }
    setSaving(true)
    setError('')
    const values = {
      title: f.title.trim().slice(0, 200),
      details: f.details.trim() || null,
      subject_id: f.subject_id || null,
      category_id: f.category_id || null,
      status: f.status || autoStatus(f.due || f.window_end || null, todayISO()),
      due_at: f.due ? dueAtFromDate(f.due) : null,
      window_label: f.window_label.trim() || null,
      window_end: f.window_end || null,
      duration_minutes: mins,
      origin: f.origin,
      goal_id: f.goal_id || null,
      is_key: f.is_key,
      project_id: f.project_id || null,
      hand_in: f.hand_in.trim() || null,
      hand_in_url: link || null,
      needs_sorting: false,          // edited by hand = sorted
    }
    const sb = getSupabase()
    const q = task
      ? sb.from('tasks').update(values).eq('id', task.id).select('*').single()
      : sb.from('tasks').insert({ ...values, source: 'dashboard' }).select('*').single()
    const { data, error: err } = await q
    setSaving(false)
    if (err || !data) { setError(`Not saved: ${err?.message ?? 'unknown error'}. Your changes are still here.`); return }
    onSaved(data as Task)
  }

  // subjects grouped under their area, then any without an area
  const subjectOptions: Option[] = [
    { value: '', label: 'None' },
    ...lookup.categories.flatMap((c) => lookup.subjects.filter((s) => s.category_id === c.id).map((s) => ({ value: s.id, label: s.name, group: c.name }))),
    ...lookup.subjects.filter((s) => !s.category_id).map((s) => ({ value: s.id, label: s.name, group: 'Other' })),
  ]

  return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="taskform-title">
        <h2 id="taskform-title">{task ? 'Edit task' : 'New task'}</h2>
        <form onSubmit={save}>
          <div className="formgrid">
            <label className="field full"><span>Title</span>
              <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} autoFocus maxLength={200} />
            </label>
            <DatePicker label="Due date (optional)" value={f.due} onChange={(v) => set('due', v)} />
            <div className="field moretoggle">
              <button type="button" className="btn ghost" aria-expanded={more} aria-controls="taskform-more" onClick={() => setMore((m) => !m)}>
                {more ? 'Fewer options' : 'More options'}
              </button>
            </div>
          </div>
          <div id="taskform-more" className="formgrid" hidden={!more} style={{ marginTop: 14 }}>
            <Select label="Subject" value={f.subject_id} onChange={pickSubject} options={subjectOptions} />
            <Select label="Area" value={f.category_id} onChange={(v) => set('category_id', v)}
              options={[{ value: '', label: 'None' }, ...lookup.categories.map((c) => ({ value: c.id, label: c.name }))]} />
            <Select label="Column" value={f.status} onChange={(v) => set('status', v)}
              options={[...(task ? [] : [{ value: '', label: 'Auto (from due date)' }]), ...COLUMNS.map((c) => ({ value: c.status as string, label: c.label })), ...(f.status === 'waiting' ? [{ value: 'waiting', label: 'Waiting' }] : [])]} />
            <label className="field"><span>Or a window (e.g. this weekend)</span>
              <input className="input" value={f.window_label} onChange={(e) => set('window_label', e.target.value)} placeholder="before Wed" />
            </label>
            <DatePicker label="Window ends (last OK day)" value={f.window_end} onChange={(v) => set('window_end', v)} />
            <label className="field"><span>Rough minutes</span>
              <input className="input" type="number" inputMode="numeric" min={1} value={f.duration} onChange={(e) => set('duration', e.target.value)} />
            </label>
            <Select label="Where it came from" value={f.origin} onChange={(v) => set('origin', v as Task['origin'])}
              options={activeSources(planning, f.origin).map((x) => ({ value: x.key, label: x.label }))} />
            <div className="full">
              <Select label="Goal" value={f.goal_id} onChange={(v) => set('goal_id', v)} disabled={!goals}
                placeholder={goalsError ? 'Couldn’t load goals' : 'Loading…'}
                options={goals ? [{ value: '', label: 'None' }, ...goals.map((g) => ({ value: g.id, label: g.title })),
                  ...(f.goal_id && !goals.some((g) => g.id === f.goal_id) ? [{ value: f.goal_id, label: 'Past goal' }] : [])] : []} />
              {goalsError && <div className="state" role="alert">{goalsError}</div>}
            </div>
            <div className="full">
              <Select label="Project" value={f.project_id} onChange={(v) => set('project_id', v)} disabled={!projects}
                placeholder={projectsError ? 'Couldn’t load projects' : 'Loading…'}
                options={projects ? [{ value: '', label: 'None' }, ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ...(f.project_id && !projects.some((p) => p.id === f.project_id) ? [{ value: f.project_id, label: 'Archived project' }] : [])] : []} />
              {projectsError && <div className="state" role="alert">{projectsError}</div>}
            </div>
            <label className="field"><span>Hand in how/where</span>
              <input className="input" value={f.hand_in} onChange={(e) => set('hand_in', e.target.value)} maxLength={120} placeholder="Google Classroom" />
            </label>
            <label className="field"><span>Hand-in link (optional)</span>
              <input className="input" inputMode="url" value={f.hand_in_url} onChange={(e) => set('hand_in_url', e.target.value)} placeholder="https://…" />
            </label>
            <label className="field full"><span>Notes</span>
              <textarea className="textarea" value={f.details} onChange={(e) => set('details', e.target.value)} />
            </label>
            <div className="full"><Toggle checked={f.is_key} onChange={(v) => set('is_key', v)} label="Star it (always show on Home)" /></div>
            {task?.source_text && task.source_text !== task.title && (
              <div className="field full"><span>Originally captured as</span><div className="usub">{task.source_text}</div></div>
            )}
          </div>
          {error && <div style={{ marginTop: 16 }}><div className="err" role="alert">{error}</div></div>}
          <div className="modalfoot">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
