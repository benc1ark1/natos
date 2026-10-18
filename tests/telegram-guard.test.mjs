// Proves the Telegram bot's guardrails (Step 9). Run: npm run test:telegram
// 1. Unit: the secret check and the "is this Nat?" check.
// 2. Code: the service role key is used in exactly one file, which never logs.
// 3. Live: the built app, pointed at a fake Telegram on localhost. Requests without the secret, or from
//    anyone but the owner, make NO Telegram calls. One positive control proves calls are being seen.
//    A planted fake service key must never appear in any response or message.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { secretMatches, bearer, isOwnerUpdate } from '../lib/telegram/guard.ts'
import { timeOf, todayISO } from '../lib/time.ts'

const ROOT = new URL('..', import.meta.url).pathname
const OWNER = 111
const OTHER = 222
const WEBHOOK_SECRET = 'test-webhook-secret-0123456789abcdef'
const TICK_SECRET = 'test-tick-secret-0123456789abcdef'
const MAIL_SECRET = 'test-mail-secret-0123456789abcdef'
const PLANTED_KEY = 'sk-test-SERVICE-KEY-MUST-NEVER-APPEAR'
const PORT = 3107

const msg = (from, chat = from, text = 'Physics homework due Friday', type = 'private') =>
  ({ update_id: Math.floor(Math.random() * 1e9), message: { message_id: 1, from: { id: from }, chat: { id: chat, type }, text } })
const tap = (from, chat) =>
  ({ update_id: Math.floor(Math.random() * 1e9), callback_query: { id: 'q1', from: { id: from }, data: 's:00000000-0000-0000-0000-000000000000', message: { message_id: 2, chat: { id: chat, type: 'private' } } } })

// ---------------------------------------------------------------- 1. unit

test('secret check: only the exact secret passes', () => {
  assert.equal(secretMatches(WEBHOOK_SECRET, WEBHOOK_SECRET), true)
  assert.equal(secretMatches(null, WEBHOOK_SECRET), false)
  assert.equal(secretMatches('', WEBHOOK_SECRET), false)
  assert.equal(secretMatches(`${WEBHOOK_SECRET}x`, WEBHOOK_SECRET), false)
  assert.equal(secretMatches('anything', undefined), false, 'no secret configured = nothing passes')
  assert.equal(secretMatches('short', 'short'), false, 'a weak configured secret never passes')
  assert.equal(bearer(`Bearer ${TICK_SECRET}`), TICK_SECRET)
  assert.equal(bearer(TICK_SECRET), null)
})

test('owner check: only Nat, only in his private chat', () => {
  const o = String(OWNER)
  assert.equal(isOwnerUpdate(msg(OWNER), o), true)
  assert.equal(isOwnerUpdate(tap(OWNER, OWNER), o), true)
  assert.equal(isOwnerUpdate(msg(OTHER), o), false, 'another person')
  assert.equal(isOwnerUpdate(msg(OTHER, OWNER), o), false, 'another person writing into the owner chat id')
  assert.equal(isOwnerUpdate(msg(OWNER, -100, 'hi', 'group'), o), false, 'owner in a group')
  assert.equal(isOwnerUpdate(tap(OTHER, OWNER), o), false, 'another person tapping a button')
  assert.equal(isOwnerUpdate({ update_id: 1, edited_message: msg(OWNER).message }, o), false, 'other update types')
  assert.equal(isOwnerUpdate(msg(OWNER), undefined), false, 'no owner configured = nobody')
  assert.equal(isOwnerUpdate(msg(OWNER), 'abc'), false)
  assert.equal(isOwnerUpdate(null, o), false)
})

test('morning brief is 07:00 Europe/London, summer and winter', () => {
  const src = readFileSync(join(ROOT, 'lib/telegram/tick.ts'), 'utf8')
  assert.match(readFileSync(join(ROOT, 'lib/settings.ts'), 'utf8'), /briefAt: '07:00'/, 'the default brief time (his setting can change it)')
  assert.match(src, /const BRIEF_AT = set\.briefAt/, 'the tick uses his brief time')
  assert.match(src, /const now = timeOf\(nowDate\)/, 'the tick compares London wall-clock time')
  assert.equal(timeOf(new Date('2026-10-07T06:00:00Z')), '07:00', 'BST: 06:00 UTC is 07:00 in London')
  assert.equal(timeOf(new Date('2026-12-07T07:00:00Z')), '07:00', 'GMT: 07:00 UTC is 07:00 in London')
  assert.equal(timeOf(new Date('2026-03-29T06:00:00Z')), '07:00', 'the day the clocks go forward')
  assert.equal(timeOf(new Date('2026-10-25T07:00:00Z')), '07:00', 'the day the clocks go back')
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/)
})

// ---------------------------------------------------------------- 2. code

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx|mjs|js)$/.test(f) ? [p] : []
  })
}

test('service role key: used in exactly one server-only file, which never logs', () => {
  const files = ['app', 'components', 'lib'].flatMap((d) => sourceFiles(join(ROOT, d))).concat(join(ROOT, 'proxy.ts'))
  const users = files.filter((f) => /SUPABASE_SERVICE_ROLE_KEY|service_role/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(ROOT.length))
  assert.deepEqual(users, ['lib/telegram/owner-session.ts'])
  const src = readFileSync(join(ROOT, 'lib/telegram/owner-session.ts'), 'utf8')
  assert.match(src, /^import 'server-only'/m, 'must be server-only')
  assert.doesNotMatch(src, /console\./, 'must never log')
  assert.doesNotMatch(src, /export (const|let|function) (admin|serviceKey)/, 'the admin client is never exported')
  assert.doesNotMatch(src, /new OwnerSessionError\(`/, 'error messages are fixed text, never built from upstream errors')
  const importers = files.filter((f) => readFileSync(f, 'utf8').includes('owner-session')).map((f) => f.slice(ROOT.length)).sort()
  // the Gmail scripts' route (lib/mail/incoming.ts) checks MAIL_SECRET first, like the tick checks its secret
  assert.deepEqual(importers, ['app/api/telegram/miniapp/route.ts', 'app/api/telegram/tick/route.ts', 'lib/telegram/bot.ts', 'lib/mail/incoming.ts'].sort())
})

// ---------------------------------------------------------------- 3. live

let calls = []
let fake, app

before(async () => {
  fake = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      calls.push({ path: req.url, body })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true, result: { message_id: 9 } }))
    })
  })
  await new Promise((r) => fake.listen(0, '127.0.0.1', r))
  app = spawn('npx', ['next', 'start', '-p', String(PORT)], {
    cwd: ROOT,
    env: {
      ...process.env,
      TELEGRAM_API_BASE: `http://127.0.0.1:${fake.address().port}`,
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
      TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
      TELEGRAM_TICK_SECRET: TICK_SECRET,
      MAIL_SECRET,
      TELEGRAM_OWNER_ID: String(OWNER),
      // a fake key: if the session code ever echoed it, the checks below would catch it
      SUPABASE_SERVICE_ROLE_KEY: PLANTED_KEY,
      NAT_OS_OWNER_USER_ID: '00000000-0000-4000-8000-000000000000',
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { await fetch(`http://localhost:${PORT}/login`); return } catch { await new Promise((r) => setTimeout(r, 500)) }
  }
  throw new Error('app did not start (run `next build` first)')
})

after(() => { app?.kill(); fake?.close() })

const post = (path, body, headers = {}) =>
  fetch(`http://localhost:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) })
const settle = () => new Promise((r) => setTimeout(r, 2500))   // give any after() work time to run
const hook = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }

test('webhook without the secret: 401, nothing sent', async () => {
  calls = []
  assert.equal((await post('/api/telegram/webhook', msg(OWNER, OWNER, '/help'))).status, 401)
  assert.equal((await post('/api/telegram/webhook', msg(OWNER, OWNER, '/help'), { 'x-telegram-bot-api-secret-token': 'wrong-secret-0123456789abcdef' })).status, 401)
  await settle()
  assert.equal(calls.length, 0)
})

test('webhook with the secret but from anyone else: ignored, nothing sent', async () => {
  calls = []
  for (const u of [msg(OTHER, OTHER, '/help'), msg(OTHER, OWNER, '/help'), tap(OTHER, OWNER), msg(OWNER, -100, '/help', 'group')]) {
    const res = await post('/api/telegram/webhook', u, hook)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true }, 'same reply as a real message, so nothing is revealed')
  }
  await settle()
  assert.equal(calls.length, 0)
})

test('positive control: the owner gets a reply (proves calls are being seen)', async () => {
  calls = []
  assert.equal((await post('/api/telegram/webhook', msg(OWNER, OWNER, '/help'), hook)).status, 200)
  await settle()
  assert.equal(calls.length, 1)
  assert.match(calls[0].path, /\/bottest-bot-token\/sendMessage$/)
  assert.equal(JSON.parse(calls[0].body).chat_id, OWNER)
})

test('a session failure tells the owner, without ever showing the key', async () => {
  calls = []
  await post('/api/telegram/webhook', msg(OWNER, OWNER, 'Physics homework due Friday'), hook)
  // the session check makes a real network call, so wait for the reply (up to 15 s) rather than a fixed time
  for (let i = 0; i < 60 && calls.length === 0; i++) await new Promise((r) => setTimeout(r, 250))
  await settle()
  assert.equal(calls.length, 1)
  const text = JSON.parse(calls[0].body).text
  assert.match(text, /Couldn’t open your session/)
  assert.ok(!text.includes(PLANTED_KEY))
})

test('tick without the secret: 401, nothing sent', async () => {
  calls = []
  assert.equal((await post('/api/telegram/tick')).status, 401)
  assert.equal((await post('/api/telegram/tick', {}, { authorization: 'Bearer wrong-secret-0123456789abcdef' })).status, 401)
  assert.equal((await post('/api/telegram/tick', {}, { authorization: TICK_SECRET })).status, 401, 'must be a Bearer token')
  await settle()
  assert.equal(calls.length, 0)
})

test('tick with the secret: errors are safe and never show the key', async () => {
  calls = []
  const res = await post('/api/telegram/tick', {}, { authorization: `Bearer ${TICK_SECRET}` })
  const body = await res.text()
  assert.equal(res.status, 200)
  assert.match(body, /Couldn’t open your session/)
  assert.ok(!body.includes(PLANTED_KEY))
  assert.equal(calls.length, 0)
})

test('Gmail scripts’ route: without the key 401 and nothing sent; with it, errors are safe and never show the key', async () => {
  calls = []
  const emails = { account: 'school', messages: [{ id: 'a1', from: 'x@y.com', subject: 'Hi', snippet: 'Hi', received: new Date().toISOString() }] }
  assert.equal((await post('/api/mail/incoming', emails)).status, 401)
  assert.equal((await post('/api/mail/incoming', emails, { authorization: 'Bearer wrong-secret-0123456789abcdef' })).status, 401)
  assert.equal((await post('/api/mail/incoming', emails, { authorization: MAIL_SECRET })).status, 401, 'must be a Bearer token')
  const res = await post('/api/mail/incoming', emails, { authorization: `Bearer ${MAIL_SECRET}` })
  const body = await res.text()
  assert.match(body, /Couldn’t open your session/)
  assert.ok(!body.includes(PLANTED_KEY))
  await settle()
  assert.equal(calls.length, 0)
})

test('dashboard sign-in from Telegram (Mini App): forged or someone else’s data gets the same 401, no tokens', async () => {
  const { createHmac } = await import('node:crypto')
  const sign = (fields, token = 'test-bot-token') => {
    const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')
    const secret = createHmac('sha256', 'WebAppData').update(token).digest()
    return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString()
  }
  const fresh = String(Math.floor(Date.now() / 1000))
  const cases = [
    'garbage',
    sign({ auth_date: fresh, user: JSON.stringify({ id: OTHER }) }),                       // someone else
    sign({ auth_date: fresh, user: JSON.stringify({ id: OWNER }) }, 'another-bots-token'), // signed by another bot
    sign({ auth_date: String(Number(fresh) - 3600), user: JSON.stringify({ id: OWNER }) }), // an hour old
  ]
  for (const initData of cases) {
    const res = await post('/api/telegram/miniapp', { initData })
    assert.equal(res.status, 401)
    const body = await res.text()
    assert.equal(body, '{"ok":false}', 'the same answer every time, no tokens')
  }
  // genuine and his: it gets as far as opening the session (which fails here, safely, with the planted fake key)
  const res = await post('/api/telegram/miniapp', { initData: sign({ auth_date: fresh, user: JSON.stringify({ id: OWNER }) }) })
  assert.equal(res.status, 401)
  assert.ok(!(await res.text()).includes(PLANTED_KEY))
})

test('the Mini App page loads signed out; other pages still send you to sign in', async () => {
  const tg = await fetch(`http://localhost:${PORT}/tg`, { redirect: 'manual' })
  assert.equal(tg.status, 200)
  const home = await fetch(`http://localhost:${PORT}/`, { redirect: 'manual' })
  assert.ok([302, 307].includes(home.status))
  assert.match(home.headers.get('location') ?? '', /\/login/)
})
