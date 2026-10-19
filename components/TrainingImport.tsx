'use client'
// Hevy CSV import on the Training page (queue item 6): choose the file Hevy exports → a preview (workouts, sets, what's
// skipped, what's already here, new PRs) → Import → the result the database confirmed. Nothing is saved before Import;
// importing the same file again adds nothing twice (each set has its own source_ref).
import { useRef, useState } from 'react'
import { shortDate } from '@/lib/time'
import type { ImportSummary } from '@/lib/gym/hevy'
import { ErrorBox, type ShowToast } from './ui'
import s from '@/app/training/training.module.css'

const MAX = 2_000_000

export default function TrainingImport({ toast, onDone }: { toast: ShowToast; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [csv, setCsv] = useState<string | null>(null)
  const [file, setFile] = useState('')
  const [preview, setPreview] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState<'read' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reset = () => { setCsv(null); setPreview(null); setFile(''); setError(null); if (input.current) input.current.value = '' }

  async function post(body: { csv: string; confirm?: boolean }) {
    const r = await fetch('/api/gym/import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({ ok: false, error: `The server answered ${r.status}.` }))
    if (!j.ok) throw new Error(j.error ?? 'Couldn’t read that file.')
    return j
  }

  async function choose(f: File | undefined) {
    setError(null); setPreview(null)
    if (!f) return
    if (f.size > MAX) { setError('That file is too big (over 2 MB). Export a shorter date range from Hevy.'); return }
    setFile(f.name); setBusy('read')
    try {
      const text = await f.text()
      const j = await post({ csv: text })
      setCsv(text); setPreview(j.preview)
    } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t read that file.') } finally { setBusy(null) }
  }

  async function confirm() {
    if (!csv) return
    setBusy('save'); setError(null)
    try {
      const j = await post({ csv, confirm: true })
      const r = j.imported as { added: number; restored: number; already: number }
      toast({ kind: 'ok', text: `Imported ${r.added + r.restored} set${r.added + r.restored === 1 ? '' : 's'} from Hevy${r.restored ? ` (${r.restored} brought back)` : ''}${r.already ? ` · ${r.already} were already here` : ''}.` })
      reset(); onDone()
    } catch (e) { setError(e instanceof Error ? e.message : 'Not saved.') } finally { setBusy(null) }
  }

  const p = preview
  const toAdd = p ? p.fresh + p.restore : 0
  return (
    <section className="card" aria-labelledby="imp-h">
      <div className="ch"><span className="lbl" id="imp-h"><span className="n">H //</span> Import from Hevy</span></div>
      {!p && (
        <>
          <p className={s.line} style={{ margin: '0 0 12px' }}>In Hevy: Profile → ⚙️ Settings → Export &amp; Import Data → <b>Export workouts</b>. Then choose the CSV here: you see what it adds before anything is saved.</p>
          <div className={s.file}>
            <input ref={input} id="hevy-file" type="file" accept=".csv,text/csv" onChange={(e) => choose(e.target.files?.[0])} disabled={!!busy} />
            <label htmlFor="hevy-file" className="btn primary" role="button" tabIndex={0} aria-disabled={!!busy}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}>{busy === 'read' ? 'Reading…' : 'Choose Hevy CSV'}</label>
            {file && !busy && <span className={s.meta}>{file}</span>}
          </div>
        </>
      )}
      {error && <div style={{ marginTop: 12 }}><ErrorBox message={error} onRetry={csv ? undefined : () => input.current?.click()} /></div>}
      {p && (
        <>
          <div className={s.meta}>{file}{p.from && p.to ? ` · ${shortDate(p.from)}${p.from !== p.to ? ` – ${shortDate(p.to)}` : ''}` : ''}</div>
          <div className={s.stats}>
            <div className={s.stat}><div className={s.statv}>{p.workouts}</div><div className={s.statl}>workout{p.workouts === 1 ? '' : 's'}</div></div>
            <div className={s.stat}><div className={s.statv}>{toAdd}</div><div className={s.statl}>new set{toAdd === 1 ? '' : 's'}</div></div>
            <div className={s.stat}><div className={s.statv}>{p.exercises}</div><div className={s.statl}>exercise{p.exercises === 1 ? '' : 's'}</div></div>
          </div>
          {p.prs.length > 0 && <ul className={s.list} aria-label="New PRs">{p.prs.map((x) => <li key={x}><span className={s.line}>🏆 {x}</span></li>)}</ul>}
          <p className={s.note}>
            {[p.already ? `${p.already} set${p.already === 1 ? ' is' : 's are'} already here (skipped)` : '', p.skipped.warmup ? `${p.skipped.warmup} warm-up set${p.skipped.warmup === 1 ? '' : 's'} skipped` : '',
              p.skipped.notLifts ? `${p.skipped.notLifts} cardio or timed row${p.skipped.notLifts === 1 ? '' : 's'} skipped` : '', p.skipped.bad ? `${p.skipped.bad} row${p.skipped.bad === 1 ? '' : 's'} couldn’t be read` : '',
              p.restore ? `${p.restore} you removed before come back` : ''].filter(Boolean).join(' · ') || 'Every set in the file is new.'}
            {p.unknown.length > 0 && <><br />Not in my exercise list (no muscle group yet): {p.unknown.join(', ')}.</>}
          </p>
          <div className={s.actions}>
            <button className={`btn primary ${s.primaryBtn}`} onClick={confirm} disabled={!!busy || !toAdd}>{busy === 'save' ? 'Importing…' : toAdd ? `Import ${toAdd} set${toAdd === 1 ? '' : 's'}` : 'Nothing new to import'}</button>
            <button className="btn ghost" onClick={reset} disabled={busy === 'save'}>Cancel</button>
          </div>
        </>
      )}
    </section>
  )
}
