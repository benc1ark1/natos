// One local "Supabase" address per test instance (test-only):
//   /rest/v1/*  -> passed through to that instance's PostgREST, unchanged both ways
//   /auth/v1/*  -> a small stand-in for Supabase's auth server, with users in auth.users of the same database
// Only the endpoints supabase-js uses here: admin users list/create/get/update/delete, generate_link,
// verify (token_hash / email+otp), token (password / refresh_token), user (get/update), logout.
// Run on its own for debugging: node tests/localdb/gateway.mjs <n>   (start.mjs normally runs it)
import http from 'node:http'
import { randomBytes, randomUUID, randomInt, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  HOST, PG_PORT, PG_USER, PG_PASSWORD, ANON_KEY, SERVICE_KEY, signJwt, verifyJwt,
  gatewayPort, postgrestPort, dbName,
} from './config.mjs'

const SESSION_SECONDS = 3600
const LINK_MS = 60 * 60 * 1000
// PostgREST errors that mean "my schema cache is behind the database". It reloads after a NOTIFY (bootstrap.sql
// sends one after every schema change), so for a few seconds after one, retry those: new tables/columns are then
// usable right after the tests apply SQL. Outside that window they're real errors and go straight back.
const STALE = new Set(['PGRST200', 'PGRST202', 'PGRST204', 'PGRST205'])
const DOWN = new Set(['PGRST000', 'PGRST001', 'PGRST002']) // database/schema cache not reachable yet: always retry
const RETRY_MS = 100, RETRY_FOR_MS = 5000, RELOAD_WINDOW_MS = 5000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const iso = (d) => (d ? new Date(d).toISOString() : undefined)

export function startGateway({ n, port = gatewayPort(n), upstreamPort = postgrestPort(n), database = dbName(n), log = () => {} }) {
  const base = `http://${HOST}:${port}`
  const pool = new pg.Pool({ host: HOST, port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database, max: 4 })
  pool.on('error', (e) => log(`db pool: ${e.message}`))
  const agent = new http.Agent({ keepAlive: true, maxSockets: 32 })
  const links = new Map() // hashed_token -> { userId, type, otp, email, until }
  const refresh = new Map() // refresh_token -> { userId, sessionId, at, revoked }
  let lastReload = 0, listener = null, closed = false

  // Hear the same "reload schema" notifications PostgREST gets
  async function listen() {
    if (closed) return
    const c = new pg.Client({ host: HOST, port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database })
    let again = false
    // lost the connection: notifications may have been missed, so treat it as a reload and listen again
    const retry = () => { if (again || closed) return; again = true; lastReload = Date.now(); setTimeout(listen, 1000) }
    c.on('notification', () => { lastReload = Date.now() })
    c.on('error', retry)
    c.on('end', retry)
    try { await c.connect(); await c.query('listen pgrst'); listener = c } catch { retry(); c.end().catch(() => {}) }
  }
  listen()

  // ---------- helpers ----------
  const send = (res, status, body, headers = {}) => {
    const buf = body === undefined ? Buffer.alloc(0) : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'x-supabase-api-version': '2024-01-01', ...headers })
    res.end(buf)
  }
  const fail = (res, status, code, msg) => send(res, status, { code, error_code: code, msg, message: msg })
  const bearer = (req) => /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1]?.trim()
  const apikey = (req, url) => req.headers.apikey ?? url.searchParams.get('apikey')
  const q = async (sql, args = []) => (await pool.query(sql, args)).rows

  const identity = (u) => ({
    identity_id: u.id, id: u.id, user_id: u.id, provider: 'email', email: u.email ?? undefined,
    identity_data: { email: u.email ?? undefined, email_verified: !!u.email_confirmed_at, phone_verified: false, sub: u.id },
    last_sign_in_at: iso(u.last_sign_in_at), created_at: iso(u.created_at), updated_at: iso(u.updated_at),
  })
  const userJson = (u) => ({
    id: u.id, aud: u.aud ?? 'authenticated', role: u.role ?? 'authenticated', email: u.email ?? '',
    email_confirmed_at: iso(u.email_confirmed_at), phone: u.phone ?? '', phone_confirmed_at: iso(u.phone_confirmed_at),
    confirmed_at: iso(u.confirmed_at), last_sign_in_at: iso(u.last_sign_in_at), banned_until: iso(u.banned_until),
    app_metadata: u.raw_app_meta_data ?? {}, user_metadata: u.raw_user_meta_data ?? {},
    identities: u.email ? [identity(u)] : [], created_at: iso(u.created_at), updated_at: iso(u.updated_at),
    is_anonymous: !!u.is_anonymous,
  })
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const byId = async (id) => (UUID.test(id ?? '') ? (await q(`select * from auth.users where id = $1`, [id]))[0] : undefined)
  const byEmail = async (email) => (await q(`select * from auth.users where email = $1`, [String(email ?? '').trim().toLowerCase()]))[0]

  async function createUser(b) {
    const email = b.email ? String(b.email).trim().toLowerCase() : null
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return { status: 400, code: 'validation_failed', msg: 'Unable to validate email address: invalid format' }
    if (await byEmail(email)) return { status: 422, code: 'email_exists', msg: 'A user with this email address has already been registered' }
    const [u] = await q(
      `insert into auth.users (email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, phone)
       values ($1, case when $2::text is null then null else extensions.crypt($2, extensions.gen_salt('bf')) end,
               case when $3 then now() end, coalesce($4::jsonb, '{}'),
               '{"provider": "email", "providers": ["email"]}'::jsonb || coalesce($5::jsonb, '{}'), $6)
       returning *`,
      [email, b.password ?? null, !!b.email_confirm, JSON.stringify(b.user_metadata ?? b.data ?? {}), JSON.stringify(b.app_metadata ?? {}), b.phone || null],
    )
    return { user: u }
  }

  async function updateUser(id, b) {
    const sets = [], args = [id]
    const add = (sql, v) => { args.push(v); sets.push(sql.replace('$$', `$${args.length}`)) }
    if (b.email !== undefined) add(`email = $$`, String(b.email).trim().toLowerCase())
    if (b.password !== undefined) add(`encrypted_password = extensions.crypt($$, extensions.gen_salt('bf'))`, b.password)
    if (b.email_confirm === true) sets.push(`email_confirmed_at = coalesce(email_confirmed_at, now())`)
    const meta = b.user_metadata ?? b.data
    if (meta !== undefined) add(`raw_user_meta_data = raw_user_meta_data || $$::jsonb`, JSON.stringify(meta))
    if (b.app_metadata !== undefined) add(`raw_app_meta_data = raw_app_meta_data || $$::jsonb`, JSON.stringify(b.app_metadata))
    if (b.phone !== undefined) add(`phone = $$`, b.phone || null)
    if (!sets.length) return byId(id)
    return (await q(`update auth.users set ${sets.join(', ')}, updated_at = now() where id = $1 returning *`, args))[0]
  }

  async function newSession(u, method) {
    const [row] = await q(`update auth.users set last_sign_in_at = now(), updated_at = now() where id = $1 returning *`, [u.id])
    const now = Math.floor(Date.now() / 1000), exp = now + SESSION_SECONDS, sessionId = randomUUID()
    const access_token = signJwt({
      aud: 'authenticated', exp, iat: now, iss: `${base}/auth/v1`, sub: row.id, email: row.email ?? '', phone: row.phone ?? '',
      app_metadata: row.raw_app_meta_data ?? {}, user_metadata: row.raw_user_meta_data ?? {}, role: 'authenticated',
      aal: 'aal1', amr: [{ method, timestamp: now }], session_id: sessionId, is_anonymous: !!row.is_anonymous,
    })
    const refresh_token = randomBytes(18).toString('base64url')
    refresh.set(refresh_token, { userId: row.id, sessionId, at: Date.now(), revoked: false })
    return { access_token, token_type: 'bearer', expires_in: SESSION_SECONDS, expires_at: exp, refresh_token, user: userJson(row) }
  }

  const prune = () => {
    const now = Date.now()
    for (const [k, v] of links) if (v.until < now) links.delete(k)
    for (const [k, v] of refresh) if (now - v.at > 7 * 24 * 3600e3) refresh.delete(k)
  }

  /** The signed-in user from the bearer token, or an error already sent. */
  async function sessionUser(req, res) {
    const claims = verifyJwt(bearer(req))
    if (!claims) { fail(res, 403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is unverifiable or has expired'); return null }
    if (!claims.sub) { fail(res, 403, 'bad_jwt', 'invalid claim: missing sub claim'); return null }
    const u = await byId(claims.sub)
    if (!u) { fail(res, 403, 'user_not_found', 'User from sub claim in JWT does not exist'); return null }
    return { u, claims }
  }

  // ---------- auth ----------
  async function auth(req, res, url, body) {
    const path = url.pathname.slice('/auth/v1'.length) || '/'
    const m = req.method
    if (path === '/health') return send(res, 200, { version: 'local', name: 'GoTrue (local test stand-in)', description: 'test-only' })
    if (path === '/settings') return send(res, 200, { external: { email: true, phone: false }, disable_signup: false, mailer_autoconfirm: true, phone_autoconfirm: false, sms_provider: '', saml_enabled: false })
    if (path === '/.well-known/jwks.json') return send(res, 200, { keys: [] })

    if (path.startsWith('/admin/')) {
      const tok = bearer(req)
      if (!tok) return fail(res, 401, 'no_authorization', 'This endpoint requires a Bearer token')
      const role = verifyJwt(tok)?.role
      if (role !== 'service_role' && role !== 'supabase_admin') return fail(res, 403, 'not_admin', 'User not allowed')

      if (path === '/admin/users' && m === 'GET') {
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
        const per = Math.min(1000, Math.max(1, Number(url.searchParams.get('per_page')) || 50))
        const [{ total }] = await q(`select count(*)::int as total from auth.users`)
        const rows = await q(`select * from auth.users order by created_at, id limit $1 offset $2`, [per, (page - 1) * per])
        const last = Math.max(1, Math.ceil(total / per))
        const link = [page < last ? `</admin/users?page=${page + 1}&per_page=${per}>; rel="next"` : null, `</admin/users?page=${last}&per_page=${per}>; rel="last"`].filter(Boolean).join(', ')
        return send(res, 200, { aud: 'authenticated', users: rows.map(userJson) }, { 'x-total-count': String(total), link })
      }
      if (path === '/admin/users' && m === 'POST') {
        const r = await createUser(body ?? {})
        return r.user ? send(res, 200, userJson(r.user)) : fail(res, r.status, r.code, r.msg)
      }
      const one = /^\/admin\/users\/([^/]+)$/.exec(path)
      if (one) {
        const u = await byId(one[1])
        if (!u) return fail(res, 404, 'user_not_found', 'User not found')
        if (m === 'GET') return send(res, 200, userJson(u))
        if (m === 'PUT') {
          const other = body?.email ? await byEmail(body.email) : null
          if (other && other.id !== u.id) return fail(res, 422, 'email_exists', 'A user with this email address has already been registered')
          return send(res, 200, userJson(await updateUser(u.id, body ?? {})))
        }
        if (m === 'DELETE') {
          await q(`delete from auth.users where id = $1`, [u.id])
          for (const [k, v] of refresh) if (v.userId === u.id) refresh.delete(k)
          return send(res, 200, userJson(u))
        }
      }
      if (path === '/admin/generate_link' && m === 'POST') {
        const b = body ?? {}
        const type = b.type
        if (!['magiclink', 'recovery', 'signup', 'invite'].includes(type)) return fail(res, 422, 'validation_failed', 'Invalid link type')
        let u = await byEmail(b.email)
        if (!u && (type === 'signup' || type === 'invite')) {
          const r = await createUser({ email: b.email, password: b.password, data: b.data })
          if (!r.user) return fail(res, r.status, r.code, r.msg)
          u = r.user
        }
        if (!u) return fail(res, 404, 'user_not_found', 'User with this email not found')
        if (type === 'invite') u = (await q(`update auth.users set invited_at = now() where id = $1 returning *`, [u.id]))[0]
        prune()
        const otp = String(randomInt(100000, 1000000))
        const hashed = createHash('sha224').update(`${u.email}${otp}${randomBytes(8).toString('hex')}`).digest('hex')
        links.set(hashed, { userId: u.id, type, otp, email: u.email, until: Date.now() + LINK_MS })
        const redirectTo = url.searchParams.get('redirect_to') ?? b.redirect_to ?? base
        return send(res, 200, {
          ...userJson(u),
          action_link: `${base}/auth/v1/verify?token=${hashed}&type=${type}&redirect_to=${encodeURIComponent(redirectTo)}`,
          email_otp: otp, hashed_token: hashed, redirect_to: redirectTo, verification_type: type,
        })
      }
      return fail(res, 404, 'not_found', 'Not found (local auth stand-in does not have this admin endpoint)')
    }

    if (path === '/verify') {
      const b = m === 'GET' ? { token_hash: url.searchParams.get('token'), type: url.searchParams.get('type') } : body ?? {}
      prune()
      let key = b.token_hash
      if (!key && b.token && b.email) key = [...links].find(([, v]) => v.otp === String(b.token) && v.email === String(b.email).trim().toLowerCase())?.[0]
      const link = key && links.get(key)
      const typeOk = link && (b.type === link.type || (b.type === 'email' && link.type !== 'recovery') || (b.type === 'magiclink' && link.type === 'signup'))
      if (!link || !typeOk) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
      links.delete(key)
      let u = await byId(link.userId)
      if (!u) return fail(res, 403, 'otp_expired', 'Email link is invalid or has expired')
      if (!u.email_confirmed_at) u = (await q(`update auth.users set email_confirmed_at = now() where id = $1 returning *`, [u.id]))[0]
      const s = await newSession(u, 'otp')
      if (m === 'GET') {
        const to = url.searchParams.get('redirect_to') || base
        const frag = new URLSearchParams({ access_token: s.access_token, expires_at: String(s.expires_at), expires_in: String(s.expires_in), refresh_token: s.refresh_token, token_type: 'bearer', type: link.type })
        res.writeHead(303, { location: `${to}#${frag}` })
        return res.end()
      }
      return send(res, 200, s)
    }

    if (path === '/token' && m === 'POST') {
      const grant = url.searchParams.get('grant_type')
      const b = body ?? {}
      if (grant === 'password') {
        if (!b.email || !b.password) return fail(res, 400, 'validation_failed', 'missing email or phone')
        const [u] = await q(`select * from auth.users where email = $1 and encrypted_password is not null and encrypted_password = extensions.crypt($2, encrypted_password)`, [String(b.email).trim().toLowerCase(), String(b.password)])
        if (!u) return fail(res, 400, 'invalid_credentials', 'Invalid login credentials')
        if (!u.email_confirmed_at) return fail(res, 400, 'email_not_confirmed', 'Email not confirmed')
        return send(res, 200, await newSession(u, 'password'))
      }
      if (grant === 'refresh_token') {
        const r = refresh.get(b.refresh_token)
        if (!r || r.revoked) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
        r.revoked = true
        const u = await byId(r.userId)
        if (!u) return fail(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found')
        return send(res, 200, await newSession(u, 'token_refresh'))
      }
      return fail(res, 400, 'unsupported_grant_type', 'unsupported_grant_type (local auth stand-in)')
    }

    if (path === '/user') {
      const s = await sessionUser(req, res)
      if (!s) return
      if (m === 'GET') return send(res, 200, userJson(s.u))
      if (m === 'PUT') return send(res, 200, userJson(await updateUser(s.u.id, body ?? {})))
    }

    if (path === '/logout' && m === 'POST') {
      const claims = verifyJwt(bearer(req))
      if (!claims?.sub) return fail(res, 403, 'bad_jwt', 'invalid JWT')
      const scope = url.searchParams.get('scope') ?? 'global'
      for (const v of refresh.values()) {
        const same = v.sessionId === claims.session_id
        if (v.userId === claims.sub && (scope === 'global' || (scope === 'local' && same) || (scope === 'others' && !same))) v.revoked = true
      }
      res.writeHead(204)
      return res.end()
    }

    return fail(res, 404, 'not_found', 'Not found (local auth stand-in does not have this endpoint)')
  }

  // ---------- rest: straight through to PostgREST ----------
  function forward(method, path, headers, body) {
    return new Promise((resolve, reject) => {
      const r = http.request({ host: HOST, port: upstreamPort, method, path, headers, agent }, (up) => {
        const chunks = []
        up.on('data', (c) => chunks.push(c))
        up.on('end', () => resolve({ status: up.statusCode, headers: up.headers, body: Buffer.concat(chunks) }))
        up.on('error', reject)
      })
      r.on('error', reject)
      r.end(body)
    })
  }

  async function rest(req, res, url, raw) {
    const headers = { ...req.headers }
    for (const h of ['host', 'connection', 'keep-alive', 'transfer-encoding', 'content-length']) delete headers[h]
    if (raw.length) headers['content-length'] = String(raw.length)
    const path = (url.pathname.slice('/rest/v1'.length) || '/') + url.search
    const until = Date.now() + RETRY_FOR_MS
    for (;;) {
      let r
      try {
        r = await forward(req.method, path, headers, raw)
      } catch (e) {
        if (Date.now() < until) { await sleep(RETRY_MS); continue }
        return send(res, 502, { message: `local gateway: PostgREST not reachable (${e.code ?? e.message})` })
      }
      if (r.status >= 400 && Date.now() < until) {
        let code
        try { code = JSON.parse(r.body.toString()).code } catch {}
        if (DOWN.has(code) || (STALE.has(code) && Date.now() - lastReload < RELOAD_WINDOW_MS)) { await sleep(RETRY_MS); continue }
      }
      const out = { ...r.headers }
      for (const h of ['connection', 'keep-alive', 'transfer-encoding']) delete out[h]
      out['content-length'] = String(r.body.length)
      res.writeHead(r.status, out)
      return res.end(r.body)
    }
  }

  // ---------- server ----------
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks)
      const url = new URL(req.url, base)
      try {
        if (url.pathname === '/' || url.pathname === '/health') return send(res, 200, { ok: true, instance: n })
        const isRest = url.pathname === '/rest/v1' || url.pathname.startsWith('/rest/v1/')
        const isAuth = url.pathname.startsWith('/auth/v1/')
        if (!isRest && !isAuth) return send(res, 404, { message: 'no route (local gateway serves /rest/v1 and /auth/v1 only)' })
        const key = apikey(req, url)
        if (key !== ANON_KEY && key !== SERVICE_KEY) return send(res, 401, { message: key ? 'Invalid API key' : 'No API key found in request', hint: 'Use the keys from tests/localdb/env.mjs' })
        if (isRest) return await rest(req, res, url, raw)
        let body
        if (raw.length) {
          try { body = JSON.parse(raw.toString()) } catch { return fail(res, 400, 'bad_json', 'Could not parse request body as JSON') }
        }
        return await auth(req, res, url, body)
      } catch (e) {
        log(`instance ${n} ${req.method} ${url.pathname}: ${e.stack ?? e.message}`)
        if (!res.headersSent) fail(res, 500, 'unexpected_failure', `local gateway error: ${e.message}`)
        else res.destroy()
      }
    })
  })
  server.keepAliveTimeout = 30_000

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, HOST, () => {
      server.off('error', reject)
      resolve({
        port,
        close: async () => {
          await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.() })
          agent.destroy()
          closed = true
          await listener?.end().catch(() => {})
          await pool.end().catch(() => {})
        },
      })
    })
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const n = Number(process.argv[2] ?? 1)
  const g = await startGateway({ n, log: (s) => console.error(s) })
  console.log(`gateway for instance ${n} on http://${HOST}:${g.port} -> PostgREST ${postgrestPort(n)}`)
}
