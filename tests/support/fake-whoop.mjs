// A stand-in for Whoop (sign-in + API v2) on localhost. Like the real one, every refresh gives a NEW refresh token
// and the old one stops working. Lists come in pages of 25.
import http from 'node:http'

export async function fakeWhoop() {
  let n = 1
  const state = { access: 'wa-1', refresh: 'wr-1', refreshes: 0, revoked: false, deletes: 0, data: { recovery: [], 'activity/sleep': [], cycle: [], 'activity/workout': [] } }
  const json = (res, status, body) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)) }
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://x')
      if (url.pathname === '/oauth/token') {
        const f = new URLSearchParams(raw)
        if (f.get('grant_type') === 'authorization_code') {
          if (f.get('code') !== 'good-code') return json(res, 400, { error: 'invalid_grant' })
          return json(res, 200, { access_token: state.access, refresh_token: state.refresh, expires_in: 3600, scope: 'offline read:recovery read:cycles read:sleep read:workout read:profile' })
        }
        if (state.revoked || f.get('refresh_token') !== state.refresh || f.get('scope') !== 'offline') return json(res, 400, { error: 'invalid_grant' })
        n++; state.refreshes++
        state.access = `wa-${n}`; state.refresh = `wr-${n}`
        return json(res, 200, { access_token: state.access, refresh_token: state.refresh, expires_in: 3600, scope: 'offline read:recovery' })
      }
      if (req.headers.authorization !== `Bearer ${state.access}`) return json(res, 401, { error: 'unauthorized' })
      if (url.pathname === '/dev/v2/user/profile/basic') return json(res, 200, { email: 'nat@example.com', first_name: 'Nat' })
      if (url.pathname === '/dev/v2/user/access' && req.method === 'DELETE') { state.deletes++; res.statusCode = 204; return res.end() }
      const kind = url.pathname.replace(/^\/dev\/v2\//, '')
      const all = state.data[kind]
      if (!all) return json(res, 404, {})
      const start = url.searchParams.get('start')
      const list = all.filter((r) => !start || (r.start ?? r.created_at) >= start)
      const from = Number(url.searchParams.get('nextToken') ?? 0), limit = Math.min(Number(url.searchParams.get('limit') ?? 10), 25)
      return json(res, 200, { records: list.slice(from, from + limit), next_token: from + limit < list.length ? String(from + limit) : null })
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return {
    url, state, close: () => server.close(),
    env: { WHOOP_API_BASE: `${url}/dev`, WHOOP_TOKEN_URL: `${url}/oauth/token`, WHOOP_AUTH_URL: `${url}/auth`, WHOOP_CLIENT_ID: 'w-client', WHOOP_CLIENT_SECRET: 'w-secret' },
    reset: () => { n = 1; Object.assign(state, { access: 'wa-1', refresh: 'wr-1', refreshes: 0, revoked: false, deletes: 0 }); for (const k of Object.keys(state.data)) state.data[k] = [] },
  }
}
