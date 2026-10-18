// Jarvis phase F, plain tests: the Telegram Mini App sign-in check. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyInitData, MAX_AGE_SECONDS } from '../lib/telegram/miniapp.ts'

const TOKEN = '123456:test-token', OWNER = '7151682023', NOW = 1_800_000_000_000
const sign = (fields, token = TOKEN) => {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString()
}
const fields = (o = {}) => ({ auth_date: String(NOW / 1000 - 30), query_id: 'AAH', user: JSON.stringify({ id: Number(OWNER), first_name: 'Nat' }), ...o })
const v = (data, o = {}) => verifyInitData(data, 'token' in o ? o.token : TOKEN, 'owner' in o ? o.owner : OWNER, o.now ?? NOW)

test('genuine, fresh and his: passes', () => {
  const r = v(sign(fields()))
  assert.equal(r.ok, true)
  assert.equal(r.userId, Number(OWNER))
})

test('anything else fails', () => {
  const good = sign(fields())
  assert.equal(v(good.replace('Nat', 'Nut')).ok, false, 'changed after signing')
  assert.equal(v(sign(fields(), 'another:token')).ok, false, 'signed by another bot')
  assert.equal(v(sign(fields({ user: JSON.stringify({ id: 222 }) }))).ok, false, 'someone else')
  assert.equal(v(sign(fields({ auth_date: String(NOW / 1000 - MAX_AGE_SECONDS - 1) }))).ok, false, 'too old')
  assert.equal(v(sign(fields({ auth_date: String(NOW / 1000 + 600) }))).ok, false, 'from the future')
  assert.equal(v(sign(fields({ user: 'not json' }))).ok, false)
  assert.equal(v(`${good}&user=${encodeURIComponent(JSON.stringify({ id: Number(OWNER) }))}`).ok, false, 'a key twice')
  assert.equal(v(good.replace(/hash=[0-9a-f]+/, '')).ok, false, 'no signature')
  assert.equal(v('').ok, false)
  assert.equal(v(good, { token: undefined }).ok, false, 'no bot token configured')
  assert.equal(v(good, { owner: undefined }).ok, false, 'no owner configured')
})
