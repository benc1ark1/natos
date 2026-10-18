// Server-only: Whoop sign-in (OAuth) and the Whoop API v2, read-only. Whoop changes the refresh token every time it's
// used (the old one stops working), so the new one is saved straight away (lib/whoop/sync.ts).
// Addresses can be pointed at a fake server for tests (WHOOP_*_BASE); in production they're Whoop's.
import 'server-only'

export const WHOOP_SCOPES = ['offline', 'read:recovery', 'read:cycles', 'read:sleep', 'read:workout', 'read:profile']

const authUrlBase = () => process.env.WHOOP_AUTH_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/auth'
const tokenUrl = () => process.env.WHOOP_TOKEN_URL ?? 'https://api.prod.whoop.com/oauth/oauth2/token'
const apiBase = () => (process.env.WHOOP_API_BASE ?? 'https://api.prod.whoop.com/developer').replace(/\/+$/, '')

export const whoopConfigured = () => !!(process.env.WHOOP_CLIENT_ID && process.env.WHOOP_CLIENT_SECRET)

/** Whoop no longer accepts the sign-in: he must connect again. */
export class WhoopReconnectError extends Error {}

export function whoopAuthUrl(redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: process.env.WHOOP_CLIENT_ID ?? '', redirect_uri: redirectUri, response_type: 'code', scope: WHOOP_SCOPES.join(' '), state })
  return `${authUrlBase()}?${q}`
}

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string }
async function tokenCall(body: Record<string, string>) {
  const res = await fetch(tokenUrl(), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.WHOOP_CLIENT_ID ?? '', client_secret: process.env.WHOOP_CLIENT_SECRET ?? '', ...body }),
  })
  const json = (await res.json().catch(() => ({}))) as TokenReply
  if (json.error === 'invalid_grant' || (res.status === 400 && /grant/i.test(json.error ?? ''))) throw new WhoopReconnectError('Whoop says the sign-in has expired or was removed.')
  if (!res.ok || !json.access_token || !json.refresh_token) throw new Error(`Whoop sign-in failed (${res.status}${json.error ? `: ${json.error}` : ''}).`)
  return { access_token: json.access_token, refresh_token: json.refresh_token, expires_at: Date.now() + (json.expires_in ?? 3600) * 1000, scope: json.scope ?? '' }
}

export const exchangeWhoopCode = (code: string, redirectUri: string) => tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
export const refreshWhoop = (refreshToken: string) => tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: 'offline' })

export type WRecovery = { cycle_id: number; sleep_id: string; created_at: string; score_state: string; score?: { recovery_score?: number; resting_heart_rate?: number; hrv_rmssd_milli?: number; user_calibrating?: boolean } }
export type WSleep = { id: string; start: string; end: string; nap: boolean; score_state: string; score?: { sleep_performance_percentage?: number; stage_summary?: { total_in_bed_time_milli?: number; total_awake_time_milli?: number } } }
export type WCycle = { id: number; start: string; end: string | null; score_state: string; score?: { strain?: number } }
export type WWorkout = { id: string; start: string; end: string; sport_name?: string; score_state: string; score?: { strain?: number } }

/** The Whoop API as Nat (read-only). */
export class Whoop {
  private readonly token: string
  constructor(token: string) { this.token = token }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, { headers: { authorization: `Bearer ${this.token}` } })
    if (res.status === 401) throw new WhoopReconnectError('Whoop didn’t accept the sign-in.')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(`Whoop error ${res.status}`)
    return json as T
  }

  /** Every record of one kind between start and end (pages of 25). */
  async list<T>(kind: 'recovery' | 'activity/sleep' | 'cycle' | 'activity/workout', start: string, end?: string): Promise<T[]> {
    const out: T[] = []
    let next: string | undefined
    for (let n = 0; n < 20; n++) {
      const q = new URLSearchParams({ limit: '25', start, ...(end ? { end } : {}), ...(next ? { nextToken: next } : {}) })
      const r = await this.get<{ records?: T[]; next_token?: string | null }>(`/v2/${kind}?${q}`)
      out.push(...(r.records ?? []))
      next = r.next_token ?? undefined
      if (!next) break
    }
    return out
  }

  profile() { return this.get<{ email?: string; first_name?: string }>('/v2/user/profile/basic') }
  /** Disconnect: ask Whoop to forget the app's access. Never throws. */
  async revoke() { await fetch(`${apiBase()}/v2/user/access`, { method: 'DELETE', headers: { authorization: `Bearer ${this.token}` } }).catch(() => null) }
}
