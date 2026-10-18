// A stand-in for Google (sign-in + Calendar API) on localhost, so the sync can be tested exactly and for free.
// It keeps calendars and events in memory, issues sync tokens, and records every write (with its calendar), so a
// test can prove nothing was ever written outside the Life OS calendar.
import http from 'node:http'

export async function fakeGoogle() {
  let seq = 0
  const at = () => new Date(Date.UTC(2026, 0, 1) + ++seq * 1000).toISOString()
  const state = {
    access: 'access-1', refresh: 'refresh-1', revoked: new Set(), email: 'nat@example.com',
    calendars: [],            // { id, summary, accessRole, selected }
    events: new Map(),        // calendarId -> Map(eventId -> event)
    writes: [],               // { method, calendarId, eventId }
    revokes: [],
  }
  const cal = (id) => { if (!state.events.has(id)) state.events.set(id, new Map()); return state.events.get(id) }
  const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(body === undefined ? '' : JSON.stringify(body)) }
  const idToken = () => `x.${Buffer.from(JSON.stringify({ email: state.email })).toString('base64url')}.y`
  const ALL = 'https://www.googleapis.com/auth/calendar.app.created https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly openid email'

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      const p = url.pathname
      // ---- sign-in
      if (p === '/oauth/token') {
        const f = new URLSearchParams(raw)
        if (f.get('grant_type') === 'authorization_code') {
          const code = f.get('code')
          if (code === 'bad-code') return json(res, 400, { error: 'invalid_grant' })
          return json(res, 200, { access_token: state.access, refresh_token: code === 'no-refresh' ? undefined : state.refresh, expires_in: 3600, scope: code === 'narrow-code' ? 'https://www.googleapis.com/auth/calendar.events.readonly openid email' : ALL, id_token: idToken() })
        }
        if (state.revoked.has(f.get('refresh_token'))) return json(res, 400, { error: 'invalid_grant' })
        state.access = `access-${++seq}`
        return json(res, 200, { access_token: state.access, expires_in: 3600, scope: ALL })
      }
      if (p === '/oauth/revoke') { state.revokes.push(url.searchParams.get('token')); return json(res, 200, {}) }
      // ---- calendar API (needs the current access token)
      if (req.headers.authorization !== `Bearer ${state.access}`) return json(res, 401, { error: { message: 'Invalid Credentials' } })
      if (p === '/cal/users/me/calendarList') return json(res, 200, { items: state.calendars })
      if (p === '/cal/calendars' && req.method === 'POST') {
        const id = `lifeos-${++seq}@group.calendar.google.com`
        state.calendars.push({ id, summary: JSON.parse(raw).summary, accessRole: 'owner', selected: true })
        state.writes.push({ method: 'CREATE_CALENDAR', calendarId: id })
        cal(id)
        return json(res, 200, { id })
      }
      const m = p.match(/^\/cal\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/)
      if (!m) return json(res, 404, { error: { message: 'not found' } })
      const calendarId = decodeURIComponent(m[1]), eventId = m[2] && decodeURIComponent(m[2])
      const evs = cal(calendarId)
      if (req.method === 'GET') {
        const token = url.searchParams.get('syncToken')
        let items = [...evs.values()]
        if (token !== null) {
          if (token === 'expired') return json(res, 410, { error: { message: 'gone' } })
          items = items.filter((e) => e._seq > Number(token))
        } else {
          if (url.searchParams.get('showDeleted') !== 'true') items = items.filter((e) => e.status !== 'cancelled')
          const min = url.searchParams.get('timeMin'), max = url.searchParams.get('timeMax')
          const startOf = (e) => e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`
          if (min) items = items.filter((e) => startOf(e) >= min || (e.end?.dateTime ?? '') > min)
          if (max) items = items.filter((e) => startOf(e) < max)
        }
        return json(res, 200, { items: items.map(({ _seq, ...e }) => e), nextSyncToken: String(seq) })
      }
      const body = raw ? JSON.parse(raw) : {}
      state.writes.push({ method: req.method, calendarId, eventId: eventId ?? null })
      if (req.method === 'POST') {
        const e = { ...body, id: `ev${++seq}`, status: 'confirmed', updated: at(), _seq: seq }
        evs.set(e.id, e)
        const { _seq, ...out } = e
        return json(res, 200, out)
      }
      const e = evs.get(eventId)
      if (!e || e.status === 'cancelled') return json(res, req.method === 'DELETE' ? 410 : 404, { error: { message: 'gone' } })
      if (req.method === 'PATCH') { Object.assign(e, body, { updated: at() }); e._seq = seq; const { _seq, ...out } = e; return json(res, 200, out) }
      if (req.method === 'DELETE') { e.status = 'cancelled'; e.updated = at(); e._seq = seq; res.statusCode = 204; return res.end() }
      return json(res, 405, {})
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url, state, close: () => server.close(),
    env: { GOOGLE_API_BASE: `${url}/cal`, GOOGLE_OAUTH_BASE: `${url}/oauth`, GOOGLE_AUTH_URL: `${url}/auth`, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret' },
    /** One of his other calendars, with events ({ summary, start: {dateTime}|{date}, end, transparency }). */
    addCalendar: (id, summary, events = []) => {
      state.calendars.push({ id, summary, accessRole: 'reader', selected: true })
      for (const e of events) { const x = { status: 'confirmed', ...e, id: e.id ?? `o${++seq}`, updated: at(), _seq: seq }; cal(id).set(x.id, x) }
    },
    /** A new event in one of his other calendars. */
    addEvent: (calendarId, e) => { const x = { status: 'confirmed', ...e, id: e.id ?? `o${++seq}`, updated: at(), _seq: seq }; cal(calendarId).set(x.id, x) },
    /** What he does in Google himself: change or delete an event (the app should follow, for Life OS). */
    edit: (calendarId, eventId, change) => { const e = cal(calendarId).get(eventId); Object.assign(e, change, { updated: at() }); e._seq = seq },
    remove: (calendarId, eventId) => { const e = cal(calendarId).get(eventId); e.status = 'cancelled'; e.updated = at(); e._seq = seq },
    lifeOs: () => state.calendars.find((c) => c.summary === 'Life OS'),
    live: (calendarId) => [...cal(calendarId).values()].filter((e) => e.status !== 'cancelled'),
    reset: () => { state.calendars.length = 0; state.events.clear(); state.writes.length = 0; state.revokes.length = 0; state.revoked.clear(); state.access = 'access-1' },
  }
}
