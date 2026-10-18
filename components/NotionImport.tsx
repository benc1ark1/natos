'use client'
import Link from 'next/link'
import { useState } from 'react'
import { ErrorBox, Loading, useLoad } from './ui'

type Preview = {
  guides: { key: string; title: string; icon: string; done: boolean }[]
  routines: { key: string; name: string; blocks: number; done: boolean; replaces: boolean }[]
  skipped: string[]
  note: string
}
type Result = { guides: number; routines: number; hidden: number }

async function call<T>(method: 'GET' | 'POST'): Promise<T> {
  const res = await fetch('/api/import/notion', { method, cache: 'no-store' })
  const body = await res.json().catch(() => ({ error: `Server replied ${res.status}` }))
  if (!res.ok) throw new Error(body.error ?? `Server replied ${res.status}`)
  return body as T
}

/** Preview what the Notion import adds, then Confirm. Nothing is saved before Confirm. */
export default function NotionImport() {
  const { data, error, loading, reload } = useLoad(() => call<Preview>('GET'))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [saveError, setSaveError] = useState('')

  async function confirm() {
    setBusy(true); setSaveError('')
    try { setResult(await call<Result>('POST')); await reload() } catch (e) { setSaveError(e instanceof Error ? e.message : 'Import failed.') }
    setBusy(false)
  }

  if (error) return <ErrorBox message={`Couldn’t load the preview: ${error}`} onRetry={reload} />
  if (!data && loading) return <div className="card"><Loading lines={8} /></div>
  if (!data) return null
  const newGuides = data.guides.filter((g) => !g.done)
  const newRoutines = data.routines.filter((r) => !r.done)
  const nothingNew = newGuides.length === 0 && newRoutines.length === 0

  return (
    <div className="rwrap">
      <div className="pagehead">
        <div>
          <Link href="/guides" className="lbl" style={{ textDecoration: 'none' }}>← Guides</Link>
          <h1 className="pagetitle serif">Import from Notion</h1>
          <div className="lbl" style={{ marginTop: 8 }}>Life Mastery Dashboard · read only, Notion is not changed</div>
        </div>
      </div>

      <section className="card">
        <h2 className="lbl">Routines ({data.routines.length})</h2>
        <ul className="ilist">
          {data.routines.map((r) => (
            <li key={r.key}>
              <span>{r.name} · {r.blocks} blocks, in order, no clock times</span>
              <span className={`itag ${r.done ? 'done' : ''}`}>{r.done ? 'Already imported' : r.replaces ? `New · hides the old ${r.name}` : 'New'}</span>
            </li>
          ))}
        </ul>
        <h2 className="lbl" style={{ marginTop: 20 }}>Guides ({data.guides.length})</h2>
        <ul className="ilist">
          {data.guides.map((g) => (
            <li key={g.key}>
              <span>{g.icon} {g.title}</span>
              <span className={`itag ${g.done ? 'done' : ''}`}>{g.done ? 'Already imported' : 'New'}</span>
            </li>
          ))}
        </ul>
        <h2 className="lbl" style={{ marginTop: 20 }}>Not imported</h2>
        <ul className="ilist">
          {data.skipped.map((s) => <li key={s}><span>{s}</span><span className="itag done">Skipped</span></li>)}
        </ul>
        <p className="inote">{data.note}</p>
      </section>

      {result && (
        <div className="card gok" style={{ marginTop: 16 }} role="status">
          Imported {result.guides} guide{result.guides === 1 ? '' : 's'} and {result.routines} routine{result.routines === 1 ? '' : 's'}
          {result.hidden > 0 && ` (hid ${result.hidden} older routine${result.hidden === 1 ? '' : 's'} with the same name; nothing deleted)`}.
          {' '}<Link href="/guides">Open Guides</Link> · <Link href="/">Home</Link>
        </div>
      )}

      {saveError && <ErrorBox message={`Nothing was imported: ${saveError}`} />}
      <div className="gactions" style={{ marginTop: 16 }}>
        <button className="btn primary" onClick={confirm} disabled={busy || nothingNew}>
          {busy ? 'Importing…' : nothingNew ? 'Everything is imported' : `Confirm import (${newGuides.length} guides, ${newRoutines.length} routines)`}
        </button>
      </div>
    </div>
  )
}
