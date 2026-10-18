'use client'
// Settings → Whoop: connect, sync now, disconnect. The page never sees the sign-in tokens (public columns only).
// Which Whoop workouts count toward a target is set on the target itself (Home → This week → a target).
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { WHOOP_MESSAGES } from '@/lib/whoop/messages'
import { ErrorBox, Loading, useLoad, type ShowToast } from './ui'

type Conn = { id: string; status: string; account: string | null; last_sync_at: string | null; last_error: string | null }

async function load(): Promise<{ conn: Conn | null; sports: string[] }> {
  const sb = getSupabase()
  const [c, w] = await Promise.all([
    sb.from('integrations').select('id,status,account,last_sync_at,last_error').eq('provider', 'whoop').maybeSingle(),
    sb.from('whoop_workouts').select('sport').order('starts_at', { ascending: false }).limit(200),
  ])
  if (c.error && !/integrations/.test(c.error.message)) throw new Error(`Couldn’t read the Whoop connection: ${c.error.message}`)
  return { conn: (c.data as Conn | null) ?? null, sports: [...new Set(((w.data ?? []) as { sport: string | null }[]).map((x) => x.sport).filter((x): x is string => !!x))] }
}

const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

export default function WhoopSettings({ toast }: { toast: ShowToast }) {
  const { data, error, loading, reload } = useLoad(load)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('whoop')
    if (code && WHOOP_MESSAGES[code]) setNote(WHOOP_MESSAGES[code])
    if (code === 'connected') { const t = setTimeout(reload, 8000); return () => clearTimeout(t) }
  }, [reload])

  async function call(path: string, done: string) {
    setBusy(true)
    const r = await fetch(path, { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Couldn’t reach the app.' }))
    setBusy(false)
    await reload()
    toast(r.ok ? { kind: 'ok', text: done } : { kind: 'error', text: r.error ?? 'It didn’t work.' })
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (loading && !data) return <Loading lines={2} />
  const conn = data?.conn ?? null
  const connected = conn?.status === 'connected'
  return (
    <div className="setlist">
      {note && <p className="usub" role="status" style={{ margin: '0 0 10px' }}>{note}</p>}
      <p className="usub" style={{ margin: '0 0 10px' }}>
        Read-only: recovery, sleep, strain and workouts. Low recovery makes the day lighter (Training → the % setting),
        and the Recovery card shows on Home. To count Whoop workouts toward a target, open the target on Home and pick its Whoop activities.
      </p>
      {!conn || conn.status === 'disconnected'
        ? <a className="btn primary" href="/api/whoop/connect">Connect Whoop</a>
        : <>
            <p style={{ margin: '0 0 8px' }}>{connected ? '✓ Connected' : '⚠️ Needs connecting again'}{conn.account ? ` as ${conn.account}` : ''} · last sync {ago(conn.last_sync_at)}</p>
            {conn.last_error && <p className="usub" role="alert" style={{ margin: '0 0 8px' }}>Last problem: {conn.last_error}</p>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {connected
                ? <button type="button" className="btn" disabled={busy} onClick={() => call('/api/whoop/sync', 'Synced with Whoop.')}>{busy ? 'Syncing…' : 'Sync now'}</button>
                : <a className="btn primary" href="/api/whoop/connect">Connect again</a>}
              <button type="button" className="btn ghost" disabled={busy} onClick={() => call('/api/whoop/disconnect', 'Disconnected from Whoop. Your Whoop history stays.')}>Disconnect</button>
            </div>
            {data!.sports.length > 0 && <p className="usub" style={{ marginTop: 10 }}>Activities Whoop has recorded: {data!.sports.join(', ')}</p>}
          </>}
    </div>
  )
}
