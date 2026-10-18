'use client'
import Link from 'next/link'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { completeTask, undoComplete, loadLookupRows, rows, safeUrl } from '@/lib/data'
import { areaColor, makeLookup } from '@/lib/lookup'
import { sortTasks } from '@/lib/tasks'
import { todayISO } from '@/lib/time'
import type { Resource, Task } from '@/lib/types'
import TaskForm from './TaskForm'
import TaskRow from './TaskRow'
import Select from './controls/Select'
import StudyPipeline from './StudyPipeline'
import { loadStudy } from '@/lib/study-data'
import { Empty, ErrorBox, Loading, useLoad, useToast, type ShowToast } from './ui'

const KINDS: Resource['kind'][] = ['link', 'video', 'goodnotes', 'book', 'article', 'drill', 'other']

/** One subject: its open tasks and its resources (kept separate from tasks). */
export default function SubjectDetail({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = getSupabase()
    const [lk, tasks, res, study] = await Promise.all([
      loadLookupRows(sb),
      sb.from('tasks').select('*').eq('subject_id', id).is('archived_at', null).neq('status', 'completed'),
      sb.from('resources').select('*').eq('subject_id', id).is('archived_at', null).order('created_at', { ascending: false }),
      loadStudy(sb, id),
    ])
    return {
      lookup: makeLookup(lk.categories, lk.subjects),
      tasks: sortTasks(rows<Task>(tasks, 'tasks')), resources: rows<Resource>(res, 'resources'), study,
    }
  })
  const toast = useToast()
  const [form, setForm] = useState<{ task: Task | null } | null>(null)
  const today = todayISO()

  const subject = data?.lookup.subjectById.get(id)
  const category = subject?.category_id ? data?.lookup.categoryById.get(subject.category_id) : undefined

  async function complete(t: Task) {
    if (!data) return
    const sb = getSupabase()
    const { error: err } = await completeTask(sb, t)
    await reload()
    if (err) return toast.show({ kind: 'error', text: err })
    toast.show({ kind: 'ok', text: `Archived “${t.title}”.`, action: { label: 'Undo', run: async () => { const e = await undoComplete(sb, t); if (e) toast.show({ kind: 'error', text: e }); reload() } } })
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data && loading) return <div className="card"><Loading lines={5} /></div>
  if (!data) return null
  if (!subject) return <Empty>That subject doesn’t exist (or isn’t yours). <Link href="/subjects">Back to Subjects</Link></Empty>

  return (
    <>
      <div className="pagehead">
        <div>
          <Link href="/subjects" className="lbl" style={{ textDecoration: 'none' }}>← Subjects</Link>
          <h1 className="pagetitle serif" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span className="dot" style={{ background: areaColor(category?.name), width: 10, height: 10 }} />{subject.name}
          </h1>
          {category && <div className="lbl" style={{ marginTop: 6 }}>{category.name}</div>}
        </div>
        <button className="btn primary" onClick={() => setForm({ task: null })}>+ Add task</button>
      </div>

      <div className="grid">
        <StudyPipeline subjectId={id} subject={subject.name} study={data.study} reload={reload} toast={toast.show} />
        <section className="card s7" aria-labelledby="st-h">
          <div className="ch"><span className="lbl" id="st-h">Open tasks</span><span className="lbl">{data.tasks.length}</span></div>
          {data.tasks.length === 0 && <Empty>No open tasks for {subject.name}.</Empty>}
          {data.tasks.map((t) => <TaskRow key={t.id} task={t} lookup={data.lookup} today={today} onComplete={complete} onEdit={(x) => setForm({ task: x })} />)}
        </section>
        <Resources subjectId={id} categoryId={subject.category_id} resources={data.resources} reload={reload} toast={toast.show} />
      </div>

      {form && (
        <TaskForm task={form.task} lookup={data.lookup}
          defaults={{ subject_id: id, category_id: subject.category_id }}
          onClose={() => setForm(null)}
          onSaved={() => { toast.show({ kind: 'ok', text: form.task ? 'Saved.' : 'Task added.' }); setForm(null); reload() }} />
      )}
      {toast.node}
    </>
  )
}

type Toast = ShowToast

function Resources({ subjectId, categoryId, resources, reload, toast }: {
  subjectId: string; categoryId: string | null; resources: Resource[]; reload: () => Promise<void>; toast: Toast
}) {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<Resource['kind']>('link')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return toast({ kind: 'error', text: 'Give the resource a title.' })
    if (url.trim() && !safeUrl(url.trim())) return toast({ kind: 'error', text: 'Links must start with https:// or http://' })
    setSaving(true)
    const { error } = await getSupabase().from('resources')
      .insert({ title: title.trim(), url: url.trim() || null, kind, subject_id: subjectId, category_id: categoryId }).select('id').single()
    setSaving(false)
    if (error) return toast({ kind: 'error', text: `Not saved: ${error.message}` })
    setTitle(''); setUrl('')
    toast({ kind: 'ok', text: 'Resource saved.' })
    reload()
  }

  async function setArchived(r: Resource, archivedAt: string | null) {
    return getSupabase().from('resources').update({ archived_at: archivedAt }).eq('id', r.id).select('id').single()
  }

  async function archive(r: Resource) {
    setBusy(r.id)
    const { error } = await setArchived(r, new Date().toISOString())
    await reload()
    setBusy(null)
    if (error) return toast({ kind: 'error', text: `Couldn't archive: ${error.message}` })
    toast({
      kind: 'ok', text: `Archived “${r.title}”.`,
      action: { label: 'Undo', run: async () => { const u = await setArchived(r, null); if (u.error) toast({ kind: 'error', text: `Couldn't undo: ${u.error.message}` }); reload() } },
    })
  }

  return (
    <section className="card s5" aria-labelledby="res-h">
      <div className="ch"><span className="lbl" id="res-h">Resources</span><span className="lbl">{resources.length}</span></div>
      {resources.length === 0 && <Empty>No resources yet: videos, GoodNotes links, guides.</Empty>}
      {resources.map((r) => {
        const href = safeUrl(r.url)
        return (
          <div className={`res ${busy === r.id ? 'pending' : ''}`} key={r.id}>
            <div style={{ minWidth: 0 }}>
              {href ? <a href={href} target="_blank" rel="noopener noreferrer">{r.title}</a> : <span>{r.title}</span>}
              <div className="kind">{r.kind}</div>
            </div>
            <button className="btn sm ghost" disabled={busy === r.id} onClick={() => archive(r)} aria-label={`Archive ${r.title}`}>Archive</button>
          </div>
        )
      })}
      <form onSubmit={add} className="formgrid" style={{ marginTop: 16 }}>
        <label className="field full"><span>Title</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Link</span><input className="input" type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <Select label="Type" value={kind} onChange={(v) => setKind(v as Resource['kind'])}
          options={KINDS.map((k) => ({ value: k, label: k === 'goodnotes' ? 'GoodNotes' : k[0].toUpperCase() + k.slice(1) }))} />
        <div className="full"><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save resource'}</button></div>
      </form>
    </section>
  )
}
