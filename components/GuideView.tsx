'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { rows } from '@/lib/data'
import { guideArea, loadGuides, saveGuide, setGuideArchived } from '@/lib/guides'
import { loadLookupRows } from '@/lib/data'
import Select from './controls/Select'
import Toggle from './controls/Toggle'
import GuideLog from './GuideLog'
import type { Guide } from '@/lib/types'
import GuideBody from './GuideBody'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'

type UsedIn = { id: string; name: string; habit_id: string; habits: { name: string; is_active: boolean } | null }

/** One guide: read it, edit it, or archive it. Shows which routine blocks link here. */
export default function GuideView({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = getSupabase()
    const [guides, used, lk] = await Promise.all([
      loadGuides(sb),
      sb.from('habit_items').select('id,name,habit_id,habits(name,is_active)').eq('guide_id', id),
      loadLookupRows(sb),
    ])
    return { guides, used: rows<UsedIn>(used as never, 'routine links').filter((u) => u.habits?.is_active), categories: lk.categories }
  })
  const params = useSearchParams()
  const router = useRouter()
  const toast = useToast()
  const [editing, setEditing] = useState(params.get('edit') === '1')
  const [draft, setDraft] = useState<{ title: string; icon: string; body: string; category_id: string | null; has_log: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data && loading) return <div className="card"><Loading lines={8} /></div>
  if (!data) return null
  const guide = data.guides.find((g) => g.id === id)
  if (!guide) return <Empty>That guide doesn’t exist (or isn’t yours). <Link href="/guides">All guides</Link></Empty>

  const links = new Map(data.guides.filter((g) => !g.archived_at).map((g) => [g.title.toLowerCase(), g.id]))
  const form = draft ?? { title: guide.title, icon: guide.icon ?? '', body: guide.body, category_id: guide.category_id ?? null, has_log: !!guide.has_log }
  const area = guideArea(guide, data.categories)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const { error: err } = await saveGuide(getSupabase(), form, id)
    setSaving(false)
    if (err) return setFormError(err)
    setFormError(''); setDraft(null); setEditing(false)
    router.replace(`/guides/${id}`)
    await reload()
    toast.show({ kind: 'ok', text: 'Guide saved.' })
  }

  async function archive(g: Guide) {
    const sb = getSupabase()
    const err = await setGuideArchived(sb, g, true)
    if (err) return toast.show({ kind: 'error', text: err })
    await reload()
    toast.show({ kind: 'ok', text: `Archived “${g.title}”.`, action: { label: 'Undo', run: async () => { const e = await setGuideArchived(sb, g, false); if (e) toast.show({ kind: 'error', text: e }); reload() } } })
  }

  return (
    <div className="rwrap">
      <div className="pagehead">
        <div>
          <Link href="/guides" className="lbl" style={{ textDecoration: 'none' }}>← Guides</Link>
          <h1 className="pagetitle serif"><span className="gicon big" aria-hidden="true">{guide.icon}</span>{guide.title}</h1>
          <div className="lbl" style={{ marginTop: 8 }}>{area.name}{area.guessed ? ' (from the title)' : ''}{guide.archived_at ? ' · Archived' : ''}</div>
          {data.used.length > 0 && (
            <div className="lbl gused">Used in: {data.used.map((u, i) => (
              <span key={u.id}>{i > 0 && ' · '}<Link href={`/routines/${u.habit_id}`}>{u.habits?.name}: {u.name}</Link></span>
            ))}</div>
          )}
        </div>
        {!editing && (
          <div className="gactions">
            <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>
            {guide.archived_at
              ? <button className="btn sm" onClick={async () => { const e = await setGuideArchived(getSupabase(), guide, false); await reload(); if (e) toast.show({ kind: 'error', text: e }) }}>Restore</button>
              : <button className="btn sm danger" onClick={() => archive(guide)}>Archive</button>}
          </div>
        )}
      </div>

      {editing ? (
        <form className="card gedit" onSubmit={save}>
          <div className="gedit-row">
            <label className="field" style={{ width: 90 }}><span>Icon</span>
              <input className="input" value={form.icon} maxLength={8} onChange={(e) => setDraft({ ...form, icon: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 1 }}><span>Title</span>
              <input className="input" value={form.title} onChange={(e) => setDraft({ ...form, title: e.target.value })} />
            </label>
          </div>
          <div className="gedit-row">
            <div style={{ flex: 1 }}><Select label="Area" value={form.category_id ?? ''} onChange={(v) => setDraft({ ...form, category_id: v || null })}
              options={[{ value: '', label: `From the title (${guideArea({ title: form.title, category_id: null }, data.categories).name})` }, ...data.categories.map((c) => ({ value: c.id, label: c.name }))]} /></div>
            <div style={{ alignSelf: 'end' }}><Toggle checked={form.has_log} onChange={(v) => setDraft({ ...form, has_log: v })} label="Weekly log (for a guide that changes every week)" /></div>
          </div>
          <label className="field"><span>{form.has_log ? 'Fixed rules' : 'Text'}</span>
            <textarea className="textarea gtext" value={form.body} onChange={(e) => setDraft({ ...form, body: e.target.value })} />
          </label>
          <p className="lbl ghelp">## heading · - bullet · 1. step · | table | row | · **bold** · [[Guide title]] links to a guide</p>
          {formError && <p className="err" role="alert">{formError}</p>}
          <div className="gactions">
            <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="btn ghost" onClick={() => { setDraft(null); setFormError(''); setEditing(false); router.replace(`/guides/${id}`) }}>Cancel</button>
          </div>
        </form>
      ) : (
        <>
          <article className="card guide">
            {guide.has_log && <div className="lbl" style={{ marginBottom: 10 }}>Fixed rules</div>}
            {guide.body.trim() ? <GuideBody text={guide.body} links={links} /> : <Empty>Nothing written yet. Tap Edit.</Empty>}
          </article>
          {guide.has_log && <GuideLog guideId={id} toast={toast.show} />}
        </>
      )}
      {toast.node}
    </div>
  )
}
