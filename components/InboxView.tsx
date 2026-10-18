'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { completeTask, undoComplete, loadLookupRows, loadOpenTasks, moveTask, rows, undoMove } from '@/lib/data'
import { makeLookup } from '@/lib/lookup'
import { todayISO } from '@/lib/time'
import type { ContextFact, Resource, Task, TaskStatus } from '@/lib/types'
import InboxSaved from './InboxSaved'
import CaptureBox from './CaptureBox'
import TaskForm from './TaskForm'
import TaskRow from './TaskRow'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'

async function loadInbox() {
  const sb = getSupabase()
  const [lk, tasks, facts, resources] = await Promise.all([
    loadLookupRows(sb), loadOpenTasks(sb),
    sb.from('context_facts').select('*').eq('is_active', true).order('created_at', { ascending: false }),
    sb.from('resources').select('*').is('archived_at', null).order('created_at', { ascending: false }),
  ])
  return {
    lookup: makeLookup(lk.categories, lk.subjects),
    facts: rows<ContextFact>(facts, 'facts'),
    resources: rows<Resource>(resources, 'saved links'),
    tasks: tasks.filter((t) => t.status === 'inbox').sort((a, b) => b.created_at.localeCompare(a.created_at)),
  }
}

/** Inbox: captured things and no-date ideas. Nothing here needs a deadline. */
export default function InboxView() {
  const { data, error, loading, reload } = useLoad(loadInbox)
  const toast = useToast()
  const [editing, setEditing] = useState<Task | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())
  const today = todayISO()

  async function complete(t: Task) {
    if (!data) return
    const sb = getSupabase()
    const { error: err } = await completeTask(sb, t)
    await reload()
    if (err) return toast.show({ kind: 'error', text: err })
    toast.show({ kind: 'ok', text: `Archived “${t.title}”.`, action: { label: 'Undo', run: async () => { const e = await undoComplete(sb, t); if (e) toast.show({ kind: 'error', text: e }); reload() } } })
  }

  async function move(t: Task, status: TaskStatus, label: string) {
    const sb = getSupabase()
    setPending((p) => new Set(p).add(t.id))
    const err = await moveTask(sb, t, status)
    await reload()
    setPending((p) => { const n = new Set(p); n.delete(t.id); return n })
    if (err) return toast.show({ kind: 'error', text: `${err} It's still in the Inbox.` })
    toast.show({
      kind: 'ok', text: `Moved to ${label}.`,
      action: { label: 'Undo', run: async () => { const e = await undoMove(sb, t); if (e) toast.show({ kind: 'error', text: e }); reload() } },
    })
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> Inbox</div>
          <h1 className="pagetitle serif">Ideas &amp; captures</h1>
        </div>
      </div>
      <section className="card" style={{ marginBottom: 20 }}>
        <CaptureBox label="//" onSaved={() => reload()} />
      </section>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <div className="card"><Loading lines={4} /></div>}
      {data && (
        <section className="card" aria-label="Inbox items">
          {data.tasks.length === 0 && <Empty>Inbox is empty. Anything you capture lands here until you sort it.</Empty>}
          {data.tasks.map((t) => (
            <TaskRow key={t.id} task={t} lookup={data.lookup} today={today} onComplete={complete} onEdit={setEditing} pending={pending.has(t.id)}
              actions={<>
                <button className="btn sm" disabled={pending.has(t.id)} onClick={() => move(t, 'today', 'Today')}>Today</button>
                <button className="btn sm" disabled={pending.has(t.id)} onClick={() => move(t, 'this_week', 'This week')}>Week</button>
                <button className="btn sm" disabled={pending.has(t.id)} onClick={() => move(t, 'this_month', 'Later')}>Later</button>
                <button className="btn sm ghost" disabled={pending.has(t.id)} onClick={() => move(t, 'someday', 'Someday')}>Someday</button>
              </>} />
          ))}
        </section>
      )}

      {data && <InboxSaved facts={data.facts} resources={data.resources} reload={reload} toast={toast.show} />}

      {editing && data && (
        <TaskForm task={editing} lookup={data.lookup} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast.show({ kind: 'ok', text: 'Saved.' }); reload() }} />
      )}
      {toast.node}
    </>
  )
}
