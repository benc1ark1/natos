'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!hasSupabaseConfig()) {
    return (
      <div className="login">
        <h1 className="greet serif">Almost there.</h1>
        <div className="err" role="alert" style={{ marginTop: 20 }}>
          <span>
            The Supabase keys are missing. Paste them into <code>.env.local</code>, then stop the app
            (Ctrl+C) and run <code>npm run dev</code> again.
          </span>
        </div>
      </div>
    )
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const { error: err } = await getSupabase().auth.signInWithPassword({ email: email.trim(), password })
    if (err) {
      setError(err.message === 'Invalid login credentials' ? 'Wrong email or password.' : err.message)
      setBusy(false)
      return
    }
    router.replace('/')
    router.refresh()
  }

  return (
    <div className="login">
      <div className="brand mono" style={{ marginBottom: 28 }}><span className="live" />NAT OS</div>
      <h1 className="greet serif">Sign in.</h1>
      <form onSubmit={signIn} className="card" style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field"><span>Password</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
