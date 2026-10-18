'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { guideArea, loadGuides, saveGuide, setGuideArchived } from '@/lib/guides'
import { loadLookupRows } from '@/lib/data'
import type { Guide } from '@/lib/types'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'

/** The guides library: reference pages, separate from tasks. Tap one to read it. */
export default function GuidesView() {
  const { data: loaded, error, loading, reload } = useLoad(async () => {
    const sb = getSupabase()
    const [guides, lk] = await Promise.all([loadGuides(sb), loadLookupRows(sb)])
    return { guides, categories: lk.categories }
  })
  const data = loaded?.guides ?? null
  const toast = useToast()
  const router = useRouter()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { guide, error: err } = await saveGuide(getSupabase(), { title, icon: null, body: '' })
    setSaving(false)
    if (err || !guide) return toast.show({ kind: 'error', text: err ?? 'Not saved.' })
    router.push(`/guides/${guide.id}?edit=1`)
  }

  async function restore(g: Guide) {
    const err = await setGuideArchived(getSupabase(), g, false)
    await reload()
    toast.show(err ? { kind: 'error', text: err } : { kind: 'ok', text: `Restored “${g.title}”.` })
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />
  const all = data ?? []
  const open = all.filter((g) => !g.archived_at)
  const archived = all.filter((g) => g.archived_at)
  const needle = q.trim().toLowerCase()
  const shown = needle ? open.filter((g) => g.title.toLowerCase().includes(needle) || g.body.toLowerCase().includes(needle)) : open

  return (
    <div className="rwrap">
      <div className="pagehead">
        <div>
          <span className="lbl">Reference · nothing to tick</span>
          <h1 className="pagetitle serif">Guides</h1>
        </div>
        <button className="btn primary" onClick={() => setAdding((a) => !a)}>+ Guide</button>
      </div>

      {adding && (
        <form className="card gadd" onSubmit={add}>
          <label className="field"><span>Title</span>
            <input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Football warm-up" />
          </label>
          <button className="btn primary" disabled={saving || !title.trim()}>{saving ? 'Adding…' : 'Add'}</button>
        </form>
      )}

      {!data && loading && <div className="card"><Loading lines={6} /></div>}
      {data && open.length === 0 && (
        <Empty>No guides yet. <Link href="/guides/import">Import from Notion</Link> or add one.</Empty>
      )}
      {open.length > 0 && (
        <>
          <input className="input gsearch" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search guides" aria-label="Search guides" />
          {shown.length === 0 && <Empty>No guide matches “{q}”.</Empty>}
          {/* grouped Study / Athletic / Personal (BUILD-GUIDE step 10); a guide with no area is placed by its title */}
          {groups(shown, loaded!.categories).map(([area, list]) => (
            <div key={area}>
              <div className="lbl garea">{area}</div>
              <ul className="glist">
                {list.map((g) => (
                  <li key={g.id}>
                    <Link href={`/guides/${g.id}`}>
                      <span className="gicon" aria-hidden="true">{g.icon ?? '📄'}</span>
                      <span className="gtitle">{g.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      <div className="gfoot">
        {archived.length > 0 && (
          <button className="btn sm ghost" onClick={() => setShowArchived((s) => !s)}>{showArchived ? 'Hide' : 'Show'} {archived.length} archived</button>
        )}
        <Link className="btn sm ghost" href="/guides/import">Import from Notion</Link>
      </div>
      {showArchived && (
        <ul className="glist off">
          {archived.map((g) => (
            <li key={g.id}>
              <span className="grow"><span className="gicon" aria-hidden="true">{g.icon ?? '📄'}</span><span className="gtitle">{g.title}</span></span>
              <button className="btn sm" onClick={() => restore(g)}>Restore</button>
            </li>
          ))}
        </ul>
      )}
      {toast.node}
    </div>
  )
}

const AREA_ORDER = ['study', 'athletic', 'personal']
/** Guides by area, in the order Study, Athletic, Personal, then any other. */
function groups(list: Guide[], categories: { id: string; name: string }[]): [string, Guide[]][] {
  const by = new Map<string, Guide[]>()
  for (const g of list) { const a = guideArea(g, categories).name; by.set(a, [...(by.get(a) ?? []), g]) }
  const rank = (a: string) => { const i = AREA_ORDER.indexOf(a.toLowerCase()); return i < 0 ? 9 : i }
  return [...by.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))
}
