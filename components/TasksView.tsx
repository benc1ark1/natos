'use client'
import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { completeTask, undoComplete, loadLookupRows, loadOpenTasks, moveTask, undoMove, updateTask } from '@/lib/data'
import { colorOf, makeLookup, subjectName } from '@/lib/lookup'
import { sourceLabel } from '@/lib/lists'
import { usePlanning } from '@/lib/usePlanning'
import { COLUMNS, DATE_GROUPS, columnOf, dateGroupOf, deadlineLabel, isDue, metaLine, sortByDate, sortTasks, type Column } from '@/lib/tasks'
import { todayISO } from '@/lib/time'
import type { Task, TaskStatus } from '@/lib/types'
import Select from './controls/Select'
import TaskForm from './TaskForm'
import TaskRow, { HandIn } from './TaskRow'
import { CheckIcon, Empty, ErrorBox, Loading, StarIcon, useLoad, useToast } from './ui'

async function loadTasks() {
  const sb = getSupabase()
  const [lk, tasks] = await Promise.all([loadLookupRows(sb), loadOpenTasks(sb)])
  return { lookup: makeLookup(lk.categories, lk.subjects), tasks }
}

const VIEW_KEY = 'tasks-view'
type View = 'list' | 'board' | 'date'

export default function TasksView() {
  const planning = usePlanning()
  const { data, error, loading, reload } = useLoad(loadTasks)
  const toast = useToast()
  const [view, setView] = useState<View>('list')
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState('')
  const [form, setForm] = useState<{ task: Task | null } | null>(null)
  const [dragOver, setDragOver] = useState<Column | null>(null)
  // moves shown straight away while the database confirms them
  const [pending, setPending] = useState<Record<string, TaskStatus>>({})
  const today = todayISO()

  useEffect(() => {
    try { const v = localStorage.getItem(VIEW_KEY); if (v === 'board' || v === 'list' || v === 'date') setView(v) } catch { /* storage blocked */ }
  }, [])
  const pickView = (v: View) => { setView(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* ignore */ } }

  const visible = useMemo(() => {
    if (!data) return []
    const needle = q.trim().toLowerCase()
    return sortTasks(data.tasks.map((t) => (pending[t.id] ? { ...t, status: pending[t.id] } : t))).filter((t) =>
      (!subject || t.subject_id === subject) &&
      (!needle || t.title.toLowerCase().includes(needle) || (t.details ?? '').toLowerCase().includes(needle)))
  }, [data, q, subject, pending])

  async function complete(t: Task) {
    if (!data) return
    const sb = getSupabase()
    const { error: err } = await completeTask(sb, t)
    await reload()
    if (err) return toast.show({ kind: 'error', text: err })
    toast.show({
      kind: 'ok', text: `Archived “${t.title}”.`,
      action: { label: 'Undo', run: async () => { const e = await undoComplete(sb, t); if (e) toast.show({ kind: 'error', text: e }); reload() } },
    })
  }

  async function patch(t: Task, p: Partial<Task>, msg: string) {
    const res = await updateTask(getSupabase(), t.id, p)
    await reload()
    toast.show(res.error ? { kind: 'error', text: res.error } : { kind: 'ok', text: msg })
  }

  async function move(t: Task, status: TaskStatus) {
    const before = data?.tasks.find((x) => x.id === t.id) ?? t
    if (before.status === status) return
    const label = COLUMNS.find((c) => c.status === status)?.label ?? status
    const sb = getSupabase()
    setPending((p) => ({ ...p, [t.id]: status }))
    const err = await moveTask(sb, before, status)
    await reload()
    setPending((p) => { const n = { ...p }; delete n[t.id]; return n })
    if (err) return toast.show({ kind: 'error', text: `${err} It's back where it was.` })
    toast.show({
      kind: 'ok', text: `Moved to ${label}.`,
      action: { label: 'Undo', run: async () => { const e = await undoMove(sb, before); if (e) toast.show({ kind: 'error', text: e }); reload() } },
    })
  }
  const star = (t: Task) => patch(t, { is_key: !t.is_key }, t.is_key ? 'Unstarred.' : 'Starred: it will show on Home.')

  const moveSelect = (t: Task) => (
    <Select size="sm" ariaLabel={`Move ${t.title}`} value={COLUMNS.find((c) => c.key === columnOf(t))!.status}
      onChange={(v) => move(t, v as TaskStatus)} options={COLUMNS.map((c) => ({ value: c.status, label: c.label }))} />
  )
  const starBtn = (t: Task) => (
    <button className={`star ${t.is_key ? 'on' : ''}`} onClick={() => star(t)} aria-pressed={t.is_key} aria-label={t.is_key ? `Unstar ${t.title}` : `Star ${t.title}`}><StarIcon on={t.is_key} /></button>
  )

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> Tasks</div>
          <h1 className="pagetitle serif">Everything open</h1>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div className="seg2" role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === 'list'} className={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>List</button>
            <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : ''} onClick={() => pickView('board')}>Board</button>
            <button role="tab" aria-selected={view === 'date'} className={view === 'date' ? 'on' : ''} onClick={() => pickView('date')}>By date</button>
          </div>
          <button className="btn primary" onClick={() => setForm({ task: null })} disabled={!data}>+ Add task</button>
        </div>
      </div>

      <div className="toolbar">
        <label className="sr" htmlFor="tq">Search tasks</label>
        <input id="tq" className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select ariaLabel="Filter by subject" value={subject} onChange={setSubject}
          options={[{ value: '', label: 'All subjects' }, ...(data?.lookup.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <div className="card"><Loading lines={6} /></div>}

      {data && view === 'list' && (
        <section className="card" aria-label="Task list">
          {visible.length === 0 && <Empty>{data.tasks.length === 0 ? 'No open tasks. Capture something on Home or add one here.' : 'No tasks match.'}</Empty>}
          {COLUMNS.map((c) => {
            const list = visible.filter((t) => columnOf(t) === c.key)
            if (!list.length) return null
            return (
              <div key={c.key}>
                <div className="sub lbl">{c.label} · {list.length}</div>
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} lookup={data.lookup} today={today} onComplete={complete} pending={!!pending[t.id]}
                    onEdit={(x) => setForm({ task: x })} actions={<>{starBtn(t)}{moveSelect(t)}</>} />
                ))}
              </div>
            )
          })}
        </section>
      )}

      {data && view === 'date' && (
        <section className="card" aria-label="Tasks by date">
          {visible.length === 0 && <Empty>{data.tasks.length === 0 ? 'No open tasks. Capture something on Home or add one here.' : 'No tasks match.'}</Empty>}
          {DATE_GROUPS.map((g) => {
            const list = sortByDate(visible.filter((t) => dateGroupOf(t, today) === g.key))
            if (!list.length) return null
            return (
              <div key={g.key}>
                <div className="sub lbl">{g.label} · {list.length}</div>
                {list.map((t) => (
                  <TaskRow key={t.id} task={t} lookup={data.lookup} today={today} onComplete={complete} pending={!!pending[t.id]}
                    meta={[deadlineLabel(t, today), t.origin && t.origin !== 'own' ? sourceLabel(planning, t.origin) : 'Own'].filter(Boolean).join(' · ')}
                    onEdit={(x) => setForm({ task: x })} actions={<>{starBtn(t)}{moveSelect(t)}</>} />
                ))}
              </div>
            )
          })}
        </section>
      )}

      {data && view === 'board' && (
        <div className="board" aria-label="Task board">
          {COLUMNS.map((c) => {
            const list = visible.filter((t) => columnOf(t) === c.key)
            return (
              <section key={c.key} className={`bcol ${dragOver === c.key ? 'over' : ''}`} aria-label={c.label}
                onDragOver={(e) => { e.preventDefault(); setDragOver(c.key) }}
                onDragLeave={() => setDragOver((d) => (d === c.key ? null : d))}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(null)
                  const t = data.tasks.find((x) => x.id === e.dataTransfer.getData('text/plain'))
                  if (t && columnOf(t) !== c.key) move(t, c.status)
                }}>
                <div className="ch" style={{ marginBottom: 4 }}><span className="lbl">{c.label}</span><span className="lbl">{list.length}</span></div>
                {list.length === 0 && <div className="state" style={{ fontSize: 13 }}>Empty</div>}
                {list.map((t) => <BoardCard key={t.id} t={t} data={data} today={today} pending={!!pending[t.id]} onComplete={complete} onEdit={() => setForm({ task: t })} star={starBtn(t)} move={moveSelect(t)} />)}
              </section>
            )
          })}
        </div>
      )}

      {form && data && (
        <TaskForm task={form.task} lookup={data.lookup}
          defaults={subject ? { subject_id: subject, category_id: data.lookup.subjectById.get(subject)?.category_id ?? null } : undefined}
          onClose={() => setForm(null)}
          onSaved={() => { toast.show({ kind: 'ok', text: form.task ? 'Saved.' : 'Task added.' }); setForm(null); reload() }} />
      )}
      {toast.node}
    </>
  )
}

function BoardCard({ t, data, today, pending, onComplete, onEdit, star, move }: {
  t: Task; data: { lookup: ReturnType<typeof makeLookup> }; today: string; pending: boolean
  onComplete: (t: Task) => Promise<void>; onEdit: () => void; star: React.ReactNode; move: React.ReactNode
}) {
  const [busy, setBusy] = useState(false)
  const color = colorOf(data.lookup, t)
  const sub = subjectName(data.lookup, t.subject_id)
  const meta = metaLine(t, today)
  return (
    <article className={`bcard ${busy ? 'completing' : pending ? 'pending' : ''}`} aria-busy={busy || pending || undefined} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}>
      <div className="top">
        <button className="chkbtn" style={{ marginLeft: -9, marginTop: -8 }} disabled={busy} aria-label={`Complete and archive: ${t.title}`}
          onClick={async () => { setBusy(true); try { await onComplete(t) } finally { setBusy(false) } }}>
          <span className={`chk ${busy ? 'on' : !isDue(t) ? 'dash' : ''}`}>{busy && <CheckIcon />}</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button className="ttitle" style={{ fontSize: 14.5 }} onClick={onEdit}>{t.title}</button>
          {meta && <div className={`tmeta ${meta.startsWith('Overdue') ? 'warn' : ''}`}>{meta}</div>}
          <HandIn task={t} />
        </div>
        {star}
      </div>
      <div className="foot">
        <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {isDue(t) && <span className="must">Due</span>}
          {sub && <span className="tag" style={{ color }}><span className="dot" style={{ background: color }} />{sub}</span>}
          {t.duration_minutes ? <span className="tmins mono">{t.duration_minutes}<span className="u">min</span></span> : null}
        </span>
        {move}
      </div>
    </article>
  )
}
