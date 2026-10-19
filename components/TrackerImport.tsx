'use client'
// Import tracker (.xlsx): pick the file → a preview of what would change (counts + clashes; nothing saved) → Confirm →
// what the database confirmed. If it stops part-way it says exactly what was saved; importing again is safe.
import { useRef, useState } from 'react'
import type { ImportPreview, ImportReply } from '@/app/api/tracker/import/run'
import { ErrorBox } from './ui'
import css from './Tracker.module.css'

const MAX = 4 * 1024 * 1024
type Phase =
  | { kind: 'pick' }
  | { kind: 'checking'; file: File }
  | { kind: 'preview'; file: File; preview: ImportPreview; note?: string }
  | { kind: 'saving'; file: File; preview: ImportPreview }
  | { kind: 'done'; lines: string[] }
  | { kind: 'failed'; file: File | null; error: string; lines?: string[]; preview?: ImportPreview }

async function send(file: File, mode: 'preview' | 'confirm', fp?: string): Promise<ImportReply> {
  const q = new URLSearchParams({ mode, ...(fp ? { fp } : {}) })
  let bytes: ArrayBuffer
  try { bytes = await file.arrayBuffer() } catch { return { ok: false, error: 'Couldn’t open that file on this device. Choose it again (download it again if it’s in the cloud).' } }
  try {
    const res = await fetch(`/api/tracker/import?${q}`, { method: 'POST', body: bytes, headers: { 'content-type': 'application/octet-stream' }, cache: 'no-store' })
    if (res.redirected && new URL(res.url).pathname.startsWith('/login')) return { ok: false, error: 'You’re signed out. Sign in again, then import. Nothing was saved.' }
    const body = (await res.json().catch(() => null)) as ImportReply | null
    return body ?? { ok: false, error: `The server replied ${res.status}. Nothing was saved.` }
  } catch {
    return { ok: false, error: mode === 'preview' ? 'Couldn’t reach the app (no connection?). Nothing was saved.'
      : 'The connection dropped while saving, so I can’t confirm what was saved. Check the tracker below; importing the same file again is safe (it skips what’s already there).' }
  }
}

export default function TrackerImport({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'pick' })
  const input = useRef<HTMLInputElement>(null)

  async function check(file: File) {
    if (!/\.xlsx$/i.test(file.name)) { setPhase({ kind: 'failed', file: null, error: 'That isn’t an .xlsx file. In Google Sheets: File → Download → Microsoft Excel (.xlsx).' }); return }
    if (file.size > MAX) { setPhase({ kind: 'failed', file: null, error: 'That file is too big (4 MB at most). Is it the tracker?' }); return }
    setPhase({ kind: 'checking', file })
    const r = await send(file, 'preview')
    if (!r.ok) setPhase({ kind: 'failed', file, error: r.error })
    else if (r.mode === 'preview') setPhase({ kind: 'preview', file, preview: r })
  }

  async function confirm(file: File, preview: ImportPreview) {
    setPhase({ kind: 'saving', file, preview })
    const r = await send(file, 'confirm', preview.fingerprint)
    if (r.ok && r.mode === 'confirm') { setPhase({ kind: 'done', lines: r.lines }); onSaved(); return }
    if (!r.ok && r.preview && !r.saved) { setPhase({ kind: 'preview', file, preview: r.preview, note: r.error }); return }   // changed since: show the new preview
    // anything else may have saved part of it (or the connection dropped mid-save): refresh the tracker either way
    if (!r.ok) { setPhase({ kind: 'failed', file, error: r.error, lines: r.lines }); onSaved() }
  }

  const reset = () => { setPhase({ kind: 'pick' }); if (input.current) input.current.value = '' }

  return (
    <section className={`card ${css.sheet}`} aria-labelledby="imp-h">
      <div className="ch"><span className="lbl" id="imp-h">Import tracker (.xlsx)</span>
        <button type="button" className="btn sm ghost" onClick={onClose}>Close</button></div>

      {phase.kind === 'pick' && (
        <>
          <ol className={css.steps}>
            <li>In Google Sheets: <b>File → Download → Microsoft Excel (.xlsx)</b>.</li>
            <li>Choose that file below. You’ll see what would change first — nothing is saved until you confirm.</li>
          </ol>
          <label className={css.file}>
            <span className="lbl">Your tracker file</span>
            <input ref={input} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) check(f) }} />
          </label>
        </>
      )}

      {phase.kind === 'checking' && <p className="usub" role="status">Reading {phase.file.name}…</p>}

      {(phase.kind === 'preview' || phase.kind === 'saving') && <Preview preview={phase.preview} note={phase.kind === 'preview' ? phase.note : undefined} />}
      {phase.kind === 'preview' && (
        <div className={css.actions}>
          {phase.preview.empty
            ? <button type="button" className="btn primary" onClick={onClose}>Nothing to change · Close</button>
            : <button type="button" className="btn primary" disabled={!phase.preview.ready} onClick={() => confirm(phase.file, phase.preview)}>Confirm import</button>}
          <button type="button" className="btn ghost" onClick={reset}>Choose another file</button>
        </div>
      )}
      {phase.kind === 'saving' && <p className="usub" role="status" style={{ marginTop: 14 }}>Saving… don’t close this page.</p>}

      {phase.kind === 'done' && (
        <>
          <div className={css.ok} role="status">{phase.lines.length ? 'Imported. Saved (confirmed by the database):' : 'Nothing needed changing: your tracker already matches the file.'}</div>
          {phase.lines.length > 0 && <ul className={css.lines}>{phase.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
          <div className={css.actions}><button type="button" className="btn primary" onClick={onClose}>Done</button></div>
        </>
      )}

      {phase.kind === 'failed' && (
        <>
          <ErrorBox message={phase.error} />
          {phase.lines && (
            <>
              <p className="usub" style={{ marginTop: 12 }}>{phase.lines.length ? 'Saved before it stopped (confirmed by the database):' : 'Nothing was saved.'}</p>
              {phase.lines.length > 0 && <ul className={css.lines}>{phase.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
              <p className="usub">Importing the same file again is safe: it skips everything already saved.</p>
            </>
          )}
          <div className={css.actions}>
            {phase.file && <button type="button" className="btn primary" onClick={() => check(phase.file!)}>Try again</button>}
            <button type="button" className="btn ghost" onClick={reset}>Choose another file</button>
          </div>
        </>
      )}
    </section>
  )
}

const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`

function Preview({ preview, note }: { preview: ImportPreview; note?: string }) {
  const f = preview.found
  return (
    <div role="region" aria-label="Import preview">
      {note && <div className="err" role="alert" style={{ marginBottom: 12 }}>{note}</div>}
      {!preview.ready && <div className="err" role="alert" style={{ marginBottom: 12 }}>Run supabase/tracker.sql in Supabase first (SQL Editor → New query → paste → Run), then choose the file again.</div>}
      <p className="usub" style={{ margin: 0 }}>Found {n(f.topics, 'topic')}, {n(f.tests, 'test')}, {n(f.mistakes, 'mistake')}{f.items ? `, ${n(f.items, 'STEP item')}` : ''} ({f.tabs.join(' · ')}).</p>
      {preview.empty
        ? <p className={css.ok}>Nothing would change: the app already has all of it.</p>
        : <>
            <div className="lbl" style={{ marginTop: 14 }}>If you confirm</div>
            <ul className={css.lines}>{preview.summary.map((l) => <li key={l}>{l}</li>)}</ul>
          </>}
      {preview.clashes.length > 0 && (
        <details className={css.clashes} open={preview.clashes.length <= 5}>
          <summary>⚠️ {preview.clashes.length} clash{preview.clashes.length === 1 ? '' : 'es'}: the app and the sheet differ (the app’s value is kept)</summary>
          <ul>{preview.clashes.map((c) => <li key={c}>{c}</li>)}</ul>
        </details>
      )}
      {preview.warnings.length > 0 && (
        <details className={css.clashes}>
          <summary>{preview.warnings.length} row{preview.warnings.length === 1 ? '' : 's'} skipped</summary>
          <ul>{preview.warnings.map((c) => <li key={c}>{c}</li>)}</ul>
        </details>
      )}
    </div>
  )
}
