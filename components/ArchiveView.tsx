'use client'
import { useEffect, useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { loadLookupRows, restoreTask, rows } from '@/lib/data'
import { categoryOf, colorOf, makeLookup, subjectName, type Lookup } from '@/lib/lookup'
import { GOAL_COLS, setGoalArchived } from '@/lib/goals'
import { loadProjects } from '@/lib/projects'
import { addDays, dateISOOf, shortDate, todayISO, weekStartISO, zonedToUTC } from '@/lib/time'
import type { Goal, Task } from '@/lib/types'
import Select from './controls/Select'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'

// Archive groups come from the archive_counts() database function: counts first, items only when opened.
type Bucket = { bucket: 'this_week' | 'week' | 'month' | 'year'; starts: string; n: number }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const nextMonth = (iso: string) => { const [y, m] = iso.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01` }

/** The days a group covers, as [from, to) in London time. */
function rangeOf(b: Bucket, today: string): [string, string] {
  const week = weekStartISO(today), month = today.slice(0, 8) + '01'
  if (b.bucket === 'this_week') return [week, addDays(today, 1)]
  if (b.bucket === 'week') return [b.starts < month ? month : b.starts, addDays(b.starts, 7) > week ? week : addDays(b.starts, 7)]
  if (b.bucket === 'month') return [b.starts, nextMonth(b.starts)]
  return [b.starts, `${+b.starts.slice(0, 4) + 1}-01-01`]
}

function labelOf(b: Bucket): string {
  if (b.bucket === 'week') return `Week of ${shortDate(b.starts)}`
  if (b.bucket === 'month') return `${MONTHS[+b.starts.slice(5, 7) - 1]} ${b.starts.slice(0, 4)}`
  if (b.bucket === 'year') return b.starts.slice(0, 4)
  return 'This week'
}

/** Archived tasks between two London days. Prep sessions (system items) are left out; they show on their test. */
const archivedQuery = (from: string, to: string) =>
  getSupabase().from('tasks').select('*').eq('is_system', false)
    .gte('archived_at', zonedToUTC(from, '00:00')).lt('archived_at', zonedToUTC(to, '00:00'))
    .order('archived_at', { ascending: false })

async function loadArchive() {
  const sb = getSupabase()
  const today = todayISO()
  const [lk, counts, g, projects] = await Promise.all([
    loadLookupRows(sb),
    sb.rpc('archive_counts'),
    // goals you archived, or whose date has passed
    sb.from('goals').select(GOAL_COLS)
      .or(`archived_at.not.is.null,target_date.lt.${today}`).order('created_at', { ascending: false }).limit(100),
    loadProjects(sb),
  ])
  const buckets = rows<Bucket>(counts, 'archive groups')
  const week = await archivedQuery(weekStartISO(today), addDays(today, 1))
  return {
    today, buckets,
    lookup: makeLookup(lk.categories, lk.subjects),
    thisWeek: rows<Task>(week, 'this week'),
    goals: rows<Goal>(g, 'past goals'),
    projects,
  }
}

/** Done items, grouped so history never looks cluttered. Nothing is ever deleted; anything can be restored to the Inbox. */
export default function ArchiveView() {
  const { data, error, loading, reload } = useLoad(loadArchive)
  const toast = useToast()
  const [q, setQ] = useState('')
  const [area, setArea] = useState('')
  const [subject, setSubject] = useState('')
  const [project, setProject] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // opened groups: their items, or an error
  const [opened, setOpened] = useState<Record<string, { items?: Task[]; error?: string }>>({})
  const [results, setResults] = useState<{ items?: Task[]; error?: string } | null>(null)
  const filtering = !!(q.trim() || area || subject || project)

  // search and filters run on the server across all history (prep sessions left out)
  useEffect(() => {
    if (!filtering || !data) { setResults(null); return }
    let stale = false
    const t = setTimeout(async () => {
      setResults((r) => r ?? {})
      let query = getSupabase().from('tasks').select('*').eq('is_system', false).not('archived_at', 'is', null)
      const needle = q.trim().replace(/[%_,()]/g, ' ')
      if (needle) query = query.ilike('title', `%${needle}%`)
      if (subject) query = query.eq('subject_id', subject)
      if (project) query = query.eq('project_id', project)
      if (area) {
        const subs = data.lookup.subjects.filter((s) => s.category_id === area).map((s) => s.id)
        query = query.or(subs.length ? `category_id.eq.${area},subject_id.in.(${subs.join(',')})` : `category_id.eq.${area}`)
      }
      const res = await query.order('archived_at', { ascending: false }).limit(100)
      if (!stale) setResults(res.error ? { error: `Couldn't search: ${res.error.message}` } : { items: res.data as Task[] })
    }, 250)
    return () => { stale = true; clearTimeout(t) }
  }, [q, area, subject, project, filtering, data])

  // "This week: 14 done · Study 9 · Athletic 3 · Personal 2"
  const summary = useMemo(() => {
    if (!data) return ''
    const byArea = new Map<string, number>()
    const done = data.thisWeek.filter((t) => t.archive_reason !== 'dropped')   // dropped isn't done
    for (const t of done) {
      const c = categoryOf(data.lookup, t)?.name ?? 'Other'
      byArea.set(c, (byArea.get(c) ?? 0) + 1)
    }
    const parts = data.lookup.categories.map((c) => c.name).concat('Other')
      .filter((n) => byArea.get(n)).map((n) => `${n} ${byArea.get(n)}`)
    return [`This week: ${done.length} done`, ...parts].join(' · ')
  }, [data])

  async function toggleGroup(b: Bucket) {
    const key = b.bucket + b.starts
    if (opened[key]) { setOpened((o) => { const n = { ...o }; delete n[key]; return n }); return }
    setOpened((o) => ({ ...o, [key]: {} }))
    const [from, to] = rangeOf(b, data!.today)
    const res = await archivedQuery(from, to)
    setOpened((o) => ({ ...o, [key]: res.error ? { error: `Couldn't load: ${res.error.message}` } : { items: res.data as Task[] } }))
  }

  async function restore(t: Task) {
    setBusy(t.id)
    const sb = getSupabase()
    const err = await restoreTask(sb, t)
    setOpened({})
    await reload()
    setBusy(null)
    if (err) return toast.show({ kind: 'error', text: err })
    toast.show({
      kind: 'ok', text: `Restored “${t.title}” to Inbox.`,
      action: { label: 'Undo', run: async () => {
        const r = await sb.from('tasks').update({ status: t.status, completed_at: t.completed_at, archived_at: t.archived_at, archive_reason: t.archive_reason }).eq('id', t.id).select('id').single()
        if (r.error) toast.show({ kind: 'error', text: `Couldn't undo: ${r.error.message}` })
        reload()
      } },
    })
  }

  async function restoreGoal(g: Goal) {
    setBusy(g.id)
    const err = await setGoalArchived(getSupabase(), g, false)
    await reload()
    setBusy(null)
    toast.show(err ? { kind: 'error', text: err } : { kind: 'ok', text: `Restored “${g.title}”.` })
  }

  const list = (items: Task[]) => items.map((t) => <ArchivedRow key={t.id} t={t} lookup={data!.lookup} busy={busy === t.id} onRestore={restore} />)
  const older = (data?.buckets ?? []).filter((b) => b.bucket !== 'this_week')

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> Archive</div>
          <h1 className="pagetitle serif">Done</h1>
        </div>
      </div>
      {data && <div className="lbl archsum mono">{summary}</div>}
      <div className="toolbar">
        <label className="sr" htmlFor="aq">Search archive</label>
        <input id="aq" className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select ariaLabel="Filter by subject" value={subject} onChange={setSubject}
          options={[{ value: '', label: 'All subjects' }, ...(data?.lookup.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
        {!!data?.projects.length && (
          <Select ariaLabel="Filter by project" value={project} onChange={setProject}
            options={[{ value: '', label: 'All projects' }, ...data.projects.map((p) => ({ value: p.id, label: p.name }))]} />
        )}
      </div>
      {data && (
        <div className="chiprow" role="group" aria-label="Filter by area">
          {[{ id: '', name: 'All areas' }, ...data.lookup.categories].map((c) => (
            <button key={c.id} className={`fchip ${area === c.id ? 'on' : ''}`} aria-pressed={area === c.id} onClick={() => setArea(c.id)}>{c.name}</button>
          ))}
        </div>
      )}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <div className="card"><Loading lines={5} /></div>}

      {data && filtering && (
        <section className="card" aria-label="Search results">
          {results?.error && <div className="err" role="alert">{results.error}</div>}
          {!results?.items && !results?.error && <Loading lines={3} />}
          {results?.items && <div className="sub lbl">{results.items.length === 100 ? 'First 100 matches' : `${results.items.length} found`}</div>}
          {results?.items?.length === 0 && <Empty>Nothing matches.</Empty>}
          {results?.items && list(results.items)}
        </section>
      )}

      {data && !filtering && (
        <section className="card" aria-label="Archived tasks">
          <div className="sub lbl">This week · {data.thisWeek.length}</div>
          {data.thisWeek.length === 0 && older.length > 0 && <div className="state">Nothing done yet this week.</div>}
          {list(data.thisWeek)}
          {older.length === 0 && data.thisWeek.length === 0 && <Empty>Nothing completed yet. Ticked-off tasks land here.</Empty>}
          {older.map((b) => {
            const key = b.bucket + b.starts
            const o = opened[key]
            return (
              <div key={key}>
                <button className="archgroup" aria-expanded={!!o} onClick={() => toggleGroup(b)}>
                  <span>{labelOf(b)} · {b.n} done</span><span aria-hidden="true">{o ? '▴' : '▾'}</span>
                </button>
                {o?.error && <div className="err" role="alert">{o.error}</div>}
                {o && !o.items && !o.error && <Loading lines={2} />}
                {o?.items && list(o.items)}
              </div>
            )
          })}
        </section>
      )}

      {data && data.goals.length > 0 && (
        <section className="card" aria-labelledby="pastgoals-h" style={{ marginTop: 20 }}>
          <div className="ch" style={{ marginBottom: 4 }}><span className="lbl" id="pastgoals-h">Past goals and tests</span><span className="lbl">{data.goals.length}</span></div>
          {data.goals.map((g) => {
            const ended = !!g.target_date && g.target_date < data.today
            return (
              <div className={`trow ${busy === g.id ? 'pending' : ''}`} key={g.id} style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="ttitle" style={{ color: '#b9c3c0' }}>{g.kind === 'test' && <span className="flag test" style={{ marginRight: 8 }}>Test</span>}{g.title}</div>
                  <div className="tmeta">{ended ? `Ended ${shortDate(g.target_date!)}` : `Archived ${shortDate(dateISOOf(g.archived_at!))}`}</div>
                </div>
                {ended ? <span /> : <button className="btn sm" disabled={busy === g.id} onClick={() => restoreGoal(g)}>{busy === g.id ? 'Restoring…' : 'Restore'}</button>}
              </div>
            )
          })}
        </section>
      )}
      {toast.node}
    </>
  )
}

function ArchivedRow({ t, lookup, busy, onRestore }: { t: Task; lookup: Lookup; busy: boolean; onRestore: (t: Task) => void }) {
  const sub = subjectName(lookup, t.subject_id)
  const color = colorOf(lookup, t)
  const when = t.completed_at ?? t.archived_at
  return (
    <div className={`trow ${busy ? 'pending' : ''}`} style={{ gridTemplateColumns: 'minmax(0,1fr) auto auto' }}>
      <div style={{ minWidth: 0 }}>
        <div className="ttitle" style={{ color: '#b9c3c0' }}>{t.title}</div>
        <div className="tmeta">{t.archive_reason === 'dropped' ? 'Dropped' : 'Completed'} {when ? shortDate(dateISOOf(when)) : ''}</div>
      </div>
      <span>{sub && <span className="tag" style={{ color }}><span className="dot" style={{ background: color }} />{sub}</span>}</span>
      <button className="btn sm" disabled={busy} onClick={() => onRestore(t)}>{busy ? 'Restoring…' : 'Restore'}</button>
    </div>
  )
}
