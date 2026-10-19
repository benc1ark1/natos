'use client'
// Settings: a warning when Vercel is missing one of the app's secret settings (names only, from /api/health), so a
// calendar sync or email watcher that stopped says why instead of just "last sync 2 h ago".
import { useEffect, useState } from 'react'

type Missing = { name: string; for: string; invalid?: boolean }

export default function HealthBanner() {
  const [missing, setMissing] = useState<Missing[] | null>(null)
  useEffect(() => {
    let live = true
    fetch('/api/health').then((r) => r.json()).then((j) => { if (live && j?.ok) setMissing(j.missing ?? []) }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!missing?.length) return null
  return (
    <div className="card" role="alert" style={{ borderColor: 'var(--warn, #c77)', marginBottom: 16 }}>
      <p style={{ margin: '0 0 6px' }}><strong>⚠️ Vercel is missing {missing.length === 1 ? 'a setting' : `${missing.length} settings`}</strong>, so parts of the app have stopped:</p>
      <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>
        {missing.map((m) => <li key={m.name}><code>{m.name}</code>{m.invalid ? ' (set, but not valid)' : ''}: {m.for}</li>)}
      </ul>
      <p className="usub" style={{ margin: 0 }}>Vercel → your project → Settings → Environment Variables: add {missing.length === 1 ? 'it' : 'them'} (the values are in your old Vercel project or .env.local), then Deployments → Redeploy.</p>
    </div>
  )
}
