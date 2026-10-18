'use client'
import Link from 'next/link'
import Script from 'next/script'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'

// Opened from the Telegram bot's "Open dashboard" button (a Telegram Mini App). Telegram hands this page signed
// launch data; the server checks it is Nat's (app/api/telegram/miniapp) and returns a session, then the
// dashboard opens signed in. Anyone else, or a normal browser, is sent to the usual sign-in.

type TelegramWebApp = { initData: string; ready: () => void; expand: () => void }

export default function TelegramEntry() {
  const router = useRouter()
  const [state, setState] = useState<'loading' | 'no' | 'error'>('loading')

  async function start() {
    const sb = getSupabase()
    const { data } = await sb.auth.getSession()
    if (data.session) { router.replace('/'); return }   // already signed in on this device
    const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp
    tg?.ready()
    tg?.expand()
    if (!tg?.initData) { setState('no'); return }
    try {
      const res = await fetch('/api/telegram/miniapp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData: tg.initData }) })
      const json = (await res.json()) as { ok?: boolean; access_token?: string; refresh_token?: string }
      if (!res.ok || !json.access_token || !json.refresh_token) { setState('no'); return }
      const { error } = await sb.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token })
      if (error) { setState('error'); return }
      router.replace('/')
      router.refresh()
    } catch {
      setState('error')
    }
  }

  return (
    <div className="login">
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" onReady={() => { void start() }} onError={() => setState('no')} />
      <div className="brand mono" style={{ marginBottom: 28 }}><span className="live" />NAT OS</div>
      {state === 'loading' && <div className="state">Opening your dashboard…</div>}
      {state === 'no' && (
        <div className="card">
          <p>This page only signs you in when it’s opened from the Nat OS bot in Telegram.</p>
          <Link className="btn primary" href="/login">Sign in</Link>
        </div>
      )}
      {state === 'error' && (
        <div className="err" role="alert">Couldn’t sign you in. Close this and tap Open dashboard again, or <Link href="/login">sign in</Link>.</div>
      )}
    </div>
  )
}
