'use client'
// Settings → Google Calendar: connect, sync now, disconnect, and which of his calendars to read (and which is school).
// The page never sees the sign-in tokens: it reads only the connection's public columns.
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { CONNECT_MESSAGES } from '@/lib/google/messages'
import Toggle from './controls/Toggle'
import { ErrorBox, Loading, useLoad, type ShowToast } from './ui'

type Cal = { id: string; name: string; read: boolean; school: boolean }
type Conn = { id: string; status: string; account: string | null; settings: { calendars?: Cal[]; life_os_id?: string }; last_sync_at: string | null; last_error: string | null }
const COLS = 'id,status,account,settings,last_sync_at,last_error'

async function load(): Promise<Conn | null> {
  const { data, error } = await getSupabase().from('integrations').select(COLS).eq('provider', 'google').maybeSingle()
  if (error) {
    if (/integrations/.test(error.message)) return null   // before the Google SQL runs
    throw new Error(`Couldn’t read the Google connection: ${error.message}`)
  }
  return data as Conn | null
}

const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}

export default function GoogleSettings({ toast }: { toast: ShowToast }) {
  const { data: conn, error, loading, reload } = useLoad(load)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // the result of connecting comes back as ?google=<code> (words looked up here, never taken from the address)
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('google')
    if (code && CONNECT_MESSAGES[code]) setNote(CONNECT_MESSAGES[code])
    if (code === 'connected') { const t = setTimeout(reload, 8000); return () => clearTimeout(t) }
  }, [reload])

  async function call(path: string, done: string) {
    setBusy(true)
    const r = await fetch(path, { method: 'POST' }).then((x) => x.json()).catch(() => ({ ok: false, error: 'Couldn’t reach the app.' }))
    setBusy(false)
    await reload()
    if (!r.ok) return toast({ kind: 'error', text: r.error ?? 'It didn’t work.' })
    toast({ kind: 'ok', text: done })
  }

  async function setCal(id: string, change: Partial<Cal>) {
    if (!conn) return
    const calendars = (conn.settings.calendars ?? []).map((c) => (c.id === id ? { ...c, ...change } : c))
    const { error: e } = await getSupabase().from('integrations').update({ settings: { ...conn.settings, calendars } }).eq('id', conn.id).select('id').single()
    if (e) return toast({ kind: 'error', text: `Not saved: ${e.message}` })
    await reload()
    toast({ kind: 'ok', text: 'Saved. It takes effect at the next sync (within 15 minutes, or tap Sync now).' })
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (loading && conn === null) return <Loading lines={2} />
  const connected = conn?.status === 'connected'
  const cals = conn?.settings.calendars ?? []
  return (
    <div className="setlist">
      {note && <p className="usub" role="status" style={{ margin: '0 0 10px' }}>{note}</p>}
      <p className="usub" style={{ margin: '0 0 10px' }}>
        Your sessions and day plans go into a <b>Life OS</b> calendar in your Google account (with reminders and leave-by
        times); moving or deleting one there changes it here. Your other calendars are only read: they count as busy time,
        and “Assignment: …” events from Google Classroom become homework. Nothing else in your Google Calendar is ever changed.
      </p>
      {!conn || conn.status === 'disconnected'
        ? <a className="btn primary" href="/api/google/connect">Connect Google Calendar</a>
        : <>
            <p style={{ margin: '0 0 8px' }}>
              {connected ? '✓ Connected' : '⚠️ Needs connecting again'}{conn.account ? ` as ${conn.account}` : ''} · last sync {ago(conn.last_sync_at)}
            </p>
            {conn.last_error && <p className="usub" role="alert" style={{ margin: '0 0 8px' }}>Last problem: {conn.last_error}</p>}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              {connected
                ? <button type="button" className="btn" disabled={busy} onClick={() => call('/api/google/sync', 'Synced with Google Calendar.')}>{busy ? 'Syncing…' : 'Sync now'}</button>
                : <a className="btn primary" href="/api/google/connect">Connect again</a>}
              <button type="button" className="btn ghost" disabled={busy} onClick={() => call('/api/google/disconnect', 'Disconnected. Your Life OS calendar stays in Google; delete it there if you like.')}>Disconnect</button>
            </div>
            {cals.length > 0 && <>
              <div className="ch" style={{ marginTop: 8 }}><span className="lbl">Your calendars (read only)</span></div>
              {cals.map((c) => (
                <div key={c.id} className="setrow">
                  <b>{c.name}</b>
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                    <Toggle checked={c.read} onChange={(v) => setCal(c.id, { read: v })} label="Read it" />
                    {c.read && <Toggle checked={c.school} onChange={(v) => setCal(c.id, { school: v })} label="It’s school (school nights, “after school”)" />}
                  </div>
                </div>
              ))}
            </>}
          </>}
    </div>
  )
}
