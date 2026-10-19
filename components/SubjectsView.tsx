'use client'
import Link from 'next/link'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { loadLookupRows, loadOpenTasks, rows } from '@/lib/data'
import { areaColor, makeLookup } from '@/lib/lookup'
import { columnOf } from '@/lib/tasks'
import type { Resource } from '@/lib/types'
import Select from './controls/Select'
import TrackerExport from './TrackerExport'
import TrackerImport from './TrackerImport'
import TrackerView from './TrackerView'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'

async function loadSubjects() {
  const sb = getSupabase()
  const [lk, tasks, res] = await Promise.all([
    loadLookupRows(sb), loadOpenTasks(sb),
    sb.from('resources').select('id,subject_id').is('archived_at', null),
  ])
  return { lookup: makeLookup(lk.categories, lk.subjects), tasks, resources: rows<Pick<Resource, 'id' | 'subject_id'>>(res, 'resources') }
}

/** The study tracker (Maths / Further Maths / Physics), then Study / Athletic / Personal with their subjects as cards. */
export default function SubjectsView() {
  const { data, error, loading, reload } = useLoad(loadSubjects)
  const toast = useToast()
  const [sheet, setSheet] = useState<'import' | 'export' | null>(null)
  const [trackerKey, setTrackerKey] = useState(0)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [cat, setCat] = useState('')
  const [saving, setSaving] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !cat) { toast.show({ kind: 'error', text: 'Pick an area and give the subject a name.' }); return }
    setSaving(true)
    const { error: err } = await getSupabase().from('subjects')
      .insert({ name: name.trim(), category_id: cat, sort_order: data?.lookup.subjects.length ?? 0 }).select('id').single()
    setSaving(false)
    if (err) return toast.show({ kind: 'error', text: `Not saved: ${err.message}` })
    toast.show({ kind: 'ok', text: `Added ${name.trim()}.` })
    setName(''); setAdding(false); reload()
  }

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> Subjects</div>
          <h1 className="pagetitle serif">Subjects</h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => setSheet(sheet === 'export' ? null : 'export')} aria-expanded={sheet === 'export'}>Export my tracker</button>
          <button className="btn sm" onClick={() => setSheet(sheet === 'import' ? null : 'import')} aria-expanded={sheet === 'import'}>Import tracker (.xlsx)</button>
        </div>
      </div>

      {sheet === 'import' && <TrackerImport onClose={() => setSheet(null)} onSaved={() => { setTrackerKey((k) => k + 1); reload() }} />}
      {sheet === 'export' && <TrackerExport onClose={() => setSheet(null)} />}
      <TrackerView key={trackerKey} toast={toast.show} />

      <div className="ch" style={{ marginTop: 8 }}>
        <span className="lbl">All subjects</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn sm ghost" href="/maths">📐 Maths view</Link>
          <button className="btn sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>{adding ? 'Close' : '+ Subject'}</button>
        </div>
      </div>

      {adding && data && (
        <form className="card formgrid" style={{ marginBottom: 20 }} onSubmit={add}>
          <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <Select label="Area" value={cat} onChange={setCat} placeholder="Choose…"
            options={data.lookup.categories.map((c) => ({ value: c.id, label: c.name }))} />
          <div className="full"><button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Add subject'}</button></div>
        </form>
      )}

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <div className="card"><Loading lines={4} /></div>}
      {data && data.lookup.categories.length === 0 && <Empty>No areas yet. Run the sample data script, or add Study, Athletic and Personal in Supabase.</Empty>}
      {data && data.lookup.categories.map((c) => {
        const subs = data.lookup.subjects.filter((s) => s.category_id === c.id)
        const color = areaColor(c.name)
        return (
          <section key={c.id} style={{ marginBottom: 28 }} aria-labelledby={`cat-${c.id}`}>
            <div className="sub lbl" id={`cat-${c.id}`} style={{ marginBottom: 12 }}><span className="dot" style={{ background: color }} />{c.name}</div>
            {subs.length === 0 && <Empty>No subjects in {c.name} yet.</Empty>}
            <div className="sgrid">
              {subs.map((s) => {
                const open = data.tasks.filter((t) => t.subject_id === s.id)
                const todayN = open.filter((t) => columnOf(t) === 'today').length
                const resN = data.resources.filter((r) => r.subject_id === s.id).length
                return (
                  <Link key={s.id} href={`/subjects/${s.id}`} className="scard">
                    <div className="nm"><span className="dot" style={{ background: color }} />{s.name}</div>
                    <div className="ct">{open.length} open · {todayN} today · {resN} resources</div>
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}
      {toast.node}
    </>
  )
}
