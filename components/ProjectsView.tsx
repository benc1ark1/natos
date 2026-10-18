'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { completeTask, loadLookupRows, loadOpenTasks, undoComplete } from '@/lib/data'
import { loadActiveGoals, goalWhen } from '@/lib/goals'
import { areaColor, makeLookup } from '@/lib/lookup'
import { loadProjects, saveProject, setProjectArchived } from '@/lib/projects'
import { sortTasks } from '@/lib/tasks'
import { todayISO } from '@/lib/time'
import type { Project, Task } from '@/lib/types'
import Select from './controls/Select'
import TaskForm from './TaskForm'
import TaskRow from './TaskRow'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'

async function loadAll() {
  const sb = getSupabase()
  const today = todayISO()
  const [lk, projects, tasks, goals] = await Promise.all([loadLookupRows(sb), loadProjects(sb), loadOpenTasks(sb), loadActiveGoals(sb, today)])
  return { today, lookup: makeLookup(lk.categories, lk.subjects), projects, tasks, goals }
}

/** Background projects: each shows its next action; tap to see its tasks and goals. */
export default function ProjectsView() {
  const { data, error, loading, reload } = useLoad(loadAll)
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [sheet, setSheet] = useState<{ project: Project | null } | null>(null)
  const [taskForm, setTaskForm] = useState<{ task: Task | null; project: Project } | null>(null)

  const tasksOf = (p: Project) => sortTasks((data?.tasks ?? []).filter((t) => t.project_id === p.id))

  async function complete(t: Task) {
    const sb = getSupabase()
    const { error: err } = await completeTask(sb, t)
    await reload()
    if (err) return toast.show({ kind: 'error', text: err })
    toast.show({ kind: 'ok', text: `Archived “${t.title}”.`, action: { label: 'Undo', run: async () => { const e = await undoComplete(sb, t); if (e) toast.show({ kind: 'error', text: e }); reload() } } })
  }

  async function archive(p: Project) {
    const sb = getSupabase()
    const err = await setProjectArchived(sb, p, true)
    await reload()
    if (err) return toast.show({ kind: 'error', text: err })
    setOpen(null)
    toast.show({ kind: 'ok', text: `Archived project “${p.name}”. Its tasks stay open.`, action: { label: 'Undo', run: async () => { const e = await setProjectArchived(sb, p, false); if (e) toast.show({ kind: 'error', text: e }); reload() } } })
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> Projects</div>
          <h1 className="pagetitle serif">In the background</h1>
        </div>
        <button className="btn primary" onClick={() => setSheet({ project: null })} disabled={!data}>+ Project</button>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <div className="card"><Loading lines={4} /></div>}
      {data && (
        <section className="card" aria-label="Projects">
          {data.projects.length === 0 && <Empty>No projects yet. Add one, e.g. SMC 2026 preparation or Football comeback.</Empty>}
          {data.projects.map((p) => {
            const list = tasksOf(p)
            const goals = data.goals.filter((g) => g.project_id === p.id)
            const color = areaColor(p.category_id ? data.lookup.categoryById.get(p.category_id)?.name : null)
            const isOpen = open === p.id
            return (
              <div key={p.id}>
                <button className="projrow" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : p.id)}>
                  <span className="dot" style={{ background: color }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="pn">{p.name}</span>
                    <span className="pnext" style={{ display: 'block' }}>{list.length ? `Next: ${list[0].title}` : 'No next action yet'}</span>
                  </span>
                  <span className="lbl">{list.length} open</span>
                </button>
                {isOpen && (
                  <div style={{ padding: '4px 0 16px' }}>
                    {p.notes && <p className="usub" style={{ margin: '0 0 8px' }}>{p.notes}</p>}
                    {list.length === 0 && <div className="state">No open tasks.</div>}
                    {list.map((t) => <TaskRow key={t.id} task={t} lookup={data.lookup} today={data.today} onComplete={complete} onEdit={(x) => setTaskForm({ task: x, project: p })} />)}
                    {goals.length > 0 && <div className="sub lbl">Goals</div>}
                    {goals.map((g) => <div key={g.id} className="usub" style={{ padding: '4px 0' }}>{g.title} · {goalWhen(g, data.today)}</div>)}
                    <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                      <button className="btn sm" onClick={() => setTaskForm({ task: null, project: p })}>+ Add task</button>
                      <button className="btn sm ghost" onClick={() => setSheet({ project: p })}>Edit</button>
                      <button className="btn sm ghost" onClick={() => archive(p)}>Archive</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      )}
      {sheet && data && (
        <ProjectSheet project={sheet.project} categories={data.lookup.categories} onClose={() => setSheet(null)}
          onSaved={async (msg) => { setSheet(null); await reload(); toast.show({ kind: 'ok', text: msg }) }} />
      )}
      {taskForm && data && (
        <TaskForm task={taskForm.task} lookup={data.lookup}
          defaults={{ project_id: taskForm.project.id, category_id: taskForm.project.category_id }}
          onClose={() => setTaskForm(null)}
          onSaved={async () => { const msg = taskForm.task ? 'Saved.' : 'Task added.'; setTaskForm(null); await reload(); toast.show({ kind: 'ok', text: msg }) }} />
      )}
      {toast.node}
    </>
  )
}

function ProjectSheet({ project, categories, onClose, onSaved }: {
  project: Project | null; categories: { id: string; name: string }[]; onClose: () => void; onSaved: (msg: string) => void
}) {
  const [name, setName] = useState(project?.name ?? '')
  const [area, setArea] = useState(project?.category_id ?? '')
  const [notes, setNotes] = useState(project?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError('Give the project a name.')
    setSaving(true)
    setError('')
    const res = await saveProject(getSupabase(), { name: name.trim().slice(0, 80), category_id: area || null, notes: notes.trim() || null }, project?.id)
    setSaving(false)
    if (res.error) return setError(`${res.error} Your changes are still here.`)
    onSaved(project ? 'Project saved.' : `Added project “${res.project!.name}”.`)
  }

  return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="proj-title">
        <h2 id="proj-title">{project ? 'Edit project' : 'New project'}</h2>
        <form onSubmit={save}>
          <div className="formgrid">
            <label className="field full"><span>Name</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} placeholder="SMC 2026 preparation" />
            </label>
            <Select label="Area" value={area} onChange={setArea} options={[{ value: '', label: 'None' }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
            <label className="field full"><span>Notes (optional)</span>
              <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
          </div>
          {error && <div style={{ marginTop: 16 }}><div className="err" role="alert">{error}</div></div>}
          <div className="modalfoot">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : project ? 'Save' : 'Add project'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
