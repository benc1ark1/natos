'use client'
// Insights on Home (Build O part 6): this week's time-saving suggestions (each with the time it saves and the
// trade-off; Apply / Not now, with Undo) and where the week's time goes (school, study, training, travel, routines,
// free). Worked out on the server by the same optimiser the bot uses (app/api/insights).
import { useCallback, useEffect, useState } from 'react'
import { ErrorBox, Loading, type ShowToast } from '../ui'

type Split = { school: number; study: number; training: number; travel: number; routines: number; free: number }
type Data = { suggestions: { key: string; title: string; savesMin: number; tradeoff: string }[]; split: Split; upper: string | null; compare: string | null }

const PARTS: { key: keyof Split; label: string; color: string }[] = [
  { key: 'school', label: 'School', color: '#7aa7ff' }, { key: 'study', label: 'Study', color: '#c9a2ff' },
  { key: 'training', label: 'Training', color: '#6fd3b2' }, { key: 'travel', label: 'Travel', color: '#f2c76e' },
  { key: 'routines', label: 'Routines', color: '#8e9bb0' }, { key: 'free', label: 'Free', color: 'rgba(255,255,255,0.18)' },
]
const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)

export default function InsightsCard({ toast, reloadHome }: { toast: ShowToast; reloadHome: () => Promise<void> }) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/insights', { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'Couldn’t load your insights.')
      setData(j)
    } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t load your insights.') }
  }, [])
  useEffect(() => { load() }, [load])

  async function act(action: 'apply' | 'dismiss', key: string) {
    setBusy(key)
    try {
      const r = await fetch('/api/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, key }) })
      const j = await r.json()
      if (!j.ok) { toast({ kind: 'error', text: j.error ?? 'Not saved.' }); return }
      await load()
      if (action === 'dismiss') { toast({ kind: 'ok', text: 'Not now: hidden for this week.' }); return }
      await reloadHome()
      toast({ kind: 'ok', text: `Applied: ${j.line ?? 'done'}.`, action: { label: 'Undo', run: async () => {
        const u = await fetch('/api/insights', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'undo', applied: j.applied }) }).then((x) => x.json()).catch(() => ({ ok: false }))
        if (!u.ok) toast({ kind: 'error', text: u.error ?? 'Couldn’t undo.' })
        await load(); await reloadHome()
      } } })
    } finally { setBusy(null) }
  }

  const total = data ? Object.values(data.split).reduce((a, b) => a + b, 0) : 0
  const saves = data ? data.suggestions.reduce((a, s) => a + s.savesMin, 0) : 0
  return (
    <section className="card" aria-labelledby="ins-h">
      <div className="ch"><span className="lbl" id="ins-h"><span className="n">I //</span> Insights</span><span className="lbl">this week</span></div>
      {error && <ErrorBox message={error} onRetry={load} />}
      {!data && !error && <Loading lines={4} />}
      {data && (
        <>
          <div className="usub" style={{ marginBottom: 8 }}>Where your week goes</div>
          <div className="splitbar" role="img" aria-label={PARTS.map((p) => `${p.label} ${hours(data.split[p.key])}`).join(', ')}>
            {PARTS.filter((p) => data.split[p.key] > 0).map((p) => <i key={p.key} style={{ width: `${(100 * data.split[p.key]) / Math.max(1, total)}%`, background: p.color }} />)}
          </div>
          <div className="splitlegend">
            {PARTS.map((p) => <span key={p.key}><b style={{ background: p.color }} />{p.label} {hours(data.split[p.key])}</span>)}
          </div>
          <div className="usub" style={{ margin: '16px 0 6px' }}>{data.suggestions.length ? `Where you could save time${saves ? ` (up to ${hours(saves)} a week)` : ''}` : 'Nothing worth changing this week: your plan is already lean.'}</div>
          {data.suggestions.slice(0, 4).map((s) => (
            <div key={s.key} className={`insrow ${busy === s.key ? 'pending' : ''}`}>
              <div style={{ minWidth: 0 }}>
                <div>{s.title}</div>
                <div className="usub">Saves {s.savesMin} min/week · trade-off: {s.tradeoff}</div>
              </div>
              <span className="studybtns">
                <button type="button" className="btn sm primary" disabled={busy === s.key} onClick={() => act('apply', s.key)}>Apply</button>
                <button type="button" className="btn sm ghost" disabled={busy === s.key} onClick={() => act('dismiss', s.key)}>Not now</button>
              </span>
            </div>
          ))}
          {data.upper && <p className="usub" style={{ margin: '12px 0 0' }}>💪 Upper {data.upper}</p>}
          {data.compare && <p className="usub" style={{ margin: '6px 0 0' }}>{data.compare}</p>}
        </>
      )}
    </section>
  )
}
