'use client'
// Export my tracker: one CSV per tab of his Google Sheet backup (Maths+FM, Physics, Tests & papers, Mistakes, STEP,
// Programmes), built from what the database has now. Each downloads on its own tap; "Download all" gets every one.
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { todayISO } from '@/lib/time'
import { loadTrackerData } from '@/lib/tracker/data'
import { trackerCsvFiles, type CsvFile } from '@/lib/tracker/csv'
import { ErrorBox, Loading, useLoad } from './ui'
import css from './Tracker.module.css'

function download(f: CsvFile) {
  const url = URL.createObjectURL(new Blob([f.csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = f.name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export default function TrackerExport({ onClose }: { onClose: () => void }) {
  const { data, error, loading, reload } = useLoad(async () => trackerCsvFiles(await loadTrackerData(getSupabase(), todayISO())))
  const [got, setGot] = useState<string[]>([])
  const take = (f: CsvFile) => { download(f); setGot((g) => (g.includes(f.name) ? g : [...g, f.name])) }
  const all = async () => { for (const f of data ?? []) { take(f); await new Promise((r) => setTimeout(r, 400)) } }

  return (
    <section className={`card ${css.sheet}`} aria-labelledby="exp-h">
      <div className="ch"><span className="lbl" id="exp-h">Export my tracker</span>
        <button type="button" className="btn sm ghost" onClick={onClose}>Close</button></div>
      <ol className={css.steps}>
        <li>Download a tab’s CSV below.</li>
        <li>In your Google Sheet, open the same tab and click cell <b>A4</b> (where its table starts).</li>
        <li><b>File → Import → Upload</b> the CSV → <b>Replace data at selected cell</b>.</li>
      </ol>
      {error && <ErrorBox message={`Couldn’t build the export: ${error}`} onRetry={reload} />}
      {!data && loading && <Loading lines={4} />}
      {data && (
        <>
          <ul className={css.files}>
            {data.map((f) => (
              <li key={f.name}>
                <div className={css.what}><b>{f.tab}</b><span>{f.rows} row{f.rows === 1 ? '' : 's'} · {f.name}</span></div>
                <button type="button" className={`btn sm ${got.includes(f.name) ? 'ghost' : ''}`} onClick={() => take(f)}>{got.includes(f.name) ? 'Downloaded ✓' : 'Download'}</button>
              </li>
            ))}
          </ul>
          <div className={css.actions}><button type="button" className="btn primary" onClick={all}>Download all ({data.length})</button></div>
        </>
      )}
    </section>
  )
}
