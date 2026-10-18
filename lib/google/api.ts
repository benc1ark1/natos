// Server-only: Google sign-in (OAuth) and the Calendar API, over plain fetch.
// Writes are only possible to the "Life OS" calendar this app created: the permissions asked for can't edit any
// other calendar (calendar.app.created), and the only write methods below are on GoogleCal, which always uses its
// Life OS id. Every other calendar is read-only (my-spec: never edit calendars outside "Life OS").
// Addresses can be pointed at a fake server for tests (GOOGLE_*_BASE); in production they're Google's.
import 'server-only'

export const SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',          // make "Life OS" and change events in it (only it)
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly', // see which calendars he has
  'https://www.googleapis.com/auth/calendar.events.readonly',       // read events on his other calendars
  'openid', 'email',                                                // which account is connected (shown in Settings)
]
export const LIFE_OS_NAME = 'Life OS'

const authBase = () => process.env.GOOGLE_AUTH_URL ?? 'https://accounts.google.com/o/oauth2/v2/auth'
const oauthBase = () => (process.env.GOOGLE_OAUTH_BASE ?? 'https://oauth2.googleapis.com').replace(/\/+$/, '')
const apiBase = () => (process.env.GOOGLE_API_BASE ?? 'https://www.googleapis.com/calendar/v3').replace(/\/+$/, '')

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)

/** Google said the sign-in is no longer valid (revoked, expired, password changed): he must connect again. */
export class ReconnectError extends Error {}
/** A sync token Google no longer accepts: start a full read again. */
export class GoneError extends Error {}

export function authUrl(redirectUri: string, state: string, challenge: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? '', redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  })
  return `${authBase()}?${q}`
}

type TokenReply = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string; error?: string }

async function tokenCall(body: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(`${oauthBase()}/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', ...body }),
  })
  const json = (await res.json().catch(() => ({}))) as TokenReply
  if (json.error === 'invalid_grant') throw new ReconnectError('Google says the sign-in has expired or was removed.')
  if (!res.ok || !json.access_token) throw new Error(`Google sign-in failed (${res.status}${json.error ? `: ${json.error}` : ''}).`)
  return json
}

/** The code from Google's consent page -> tokens (and the account's email, from the id token Google signed). */
export async function exchangeCode(code: string, verifier: string, redirectUri: string) {
  const t = await tokenCall({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
  // the id token comes straight from Google over TLS in this reply, so its payload can be read without re-checking it
  let email: string | null = null
  try { email = JSON.parse(Buffer.from((t.id_token ?? '').split('.')[1] ?? '', 'base64url').toString('utf8')).email ?? null } catch {}
  return { access_token: t.access_token!, refresh_token: t.refresh_token ?? null, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, scope: t.scope ?? '', email }
}

export async function refreshAccess(refreshToken: string) {
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken })
  return { access_token: t.access_token!, expires_at: Date.now() + (t.expires_in ?? 3600) * 1000, refresh_token: t.refresh_token ?? null }
}

/** Ask Google to forget the sign-in (Disconnect). Never throws. */
export async function revoke(token: string) {
  await fetch(`${oauthBase()}/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => null)
}

/** Did he tick every box on Google's consent page? */
export const missingScopes = (granted: string) => SCOPES.filter((s) => s.startsWith('https://') && !granted.split(/\s+/).includes(s))

export type GCalendar = { id: string; summary: string; primary?: boolean; accessRole: string; selected?: boolean; backgroundColor?: string }
export type GTime = { dateTime?: string; date?: string; timeZone?: string }
export type GEvent = {
  id: string; status?: string; summary?: string; description?: string; location?: string; start?: GTime; end?: GTime
  transparency?: string; updated?: string; recurringEventId?: string
  extendedProperties?: { private?: Record<string, string> }
  attendees?: { self?: boolean; responseStatus?: string }[]
}
export type EventBody = {
  summary: string; description?: string; location?: string | null; start: GTime; end: GTime
  reminders: { useDefault: boolean; overrides: { method: 'popup'; minutes: number }[] }
  extendedProperties?: { private: Record<string, string> }
}

/** The Calendar API as Nat. Reads any of his calendars; writes only to Life OS. */
export class GoogleCal {
  private readonly token: string
  readonly lifeOsId: string | null
  constructor(token: string, lifeOsId: string | null) {
    this.token = token
    this.lifeOsId = lifeOsId
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${apiBase()}${path}`, { ...init, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', ...(init.headers ?? {}) } })
    if (res.status === 401) throw new ReconnectError('Google didn’t accept the sign-in.')
    if (res.status === 410) throw new GoneError('gone')
    if (res.status === 204) return undefined as T
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(`Google Calendar error ${res.status}${json?.error?.message ? `: ${json.error.message}` : ''}`), { status: res.status })
    return json as T
  }

  async calendars(): Promise<GCalendar[]> {
    const out: GCalendar[] = []
    let page: string | undefined
    do {
      const r = await this.call<{ items?: GCalendar[]; nextPageToken?: string }>(`/users/me/calendarList?maxResults=250${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`)
      out.push(...(r.items ?? []))
      page = r.nextPageToken
    } while (page)
    return out
  }

  /** Events of one calendar: by time window (one copy per session of repeating events), or what changed since a sync token. */
  async events(calendarId: string, q: { timeMin?: string; timeMax?: string; syncToken?: string; showDeleted?: boolean; singleEvents?: boolean }): Promise<{ items: GEvent[]; nextSyncToken?: string }> {
    const items: GEvent[] = []
    let page: string | undefined, sync: string | undefined
    for (let n = 0; n < 20; n++) {
      const p = new URLSearchParams({ maxResults: '250' })
      if (q.syncToken) p.set('syncToken', q.syncToken)
      else {
        if (q.timeMin) p.set('timeMin', q.timeMin)
        if (q.timeMax) p.set('timeMax', q.timeMax)
        if (q.singleEvents) { p.set('singleEvents', 'true'); p.set('orderBy', 'startTime') }
      }
      if (q.showDeleted) p.set('showDeleted', 'true')
      if (page) p.set('pageToken', page)
      const r = await this.call<{ items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?${p}`)
      items.push(...(r.items ?? []))
      page = r.nextPageToken
      sync = r.nextSyncToken ?? sync
      if (!page) break
    }
    return { items, nextSyncToken: sync }
  }

  // ---- writes: Life OS only ----
  private life(): string {
    if (!this.lifeOsId) throw new Error('No Life OS calendar yet.')
    return encodeURIComponent(this.lifeOsId)
  }
  /** Make the Life OS calendar (the only calendar this app may change). */
  static async createLifeOs(token: string): Promise<string> {
    const r = await new GoogleCal(token, null).call<{ id: string }>('/calendars', { method: 'POST', body: JSON.stringify({ summary: LIFE_OS_NAME, timeZone: 'Europe/London', description: 'Made by Nat OS. Sessions and plans from the app; changes here go back to the app.' }) })
    return r.id
  }
  insert(body: EventBody) { return this.call<GEvent>(`/calendars/${this.life()}/events`, { method: 'POST', body: JSON.stringify(body) }) }
  patch(eventId: string, body: Partial<EventBody>) { return this.call<GEvent>(`/calendars/${this.life()}/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) }) }
  remove(eventId: string) { return this.call<void>(`/calendars/${this.life()}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }) }
}
