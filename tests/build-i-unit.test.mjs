// Build 2, phase I (Google Calendar): plain checks, no database. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.TOKEN_KEY = 'ab'.repeat(32)
const { seal, open } = await import('../lib/integrations/crypto.ts')

test('sign-in tokens are stored encrypted: unreadable, tied to their service, and any change is caught', () => {
  const t = { access_token: 'ya29.secret-access', refresh_token: '1//secret-refresh', expires_at: 123 }
  const box = seal(t, 'google')
  assert.match(box, /^v1:[A-Za-z0-9+/=]+$/)
  assert.doesNotMatch(box, /secret/, 'no token text in what is stored')
  assert.deepEqual(open(box, 'google'), t)
  assert.notEqual(seal(t, 'google'), box, 'a fresh random start every time')
  assert.throws(() => open(box, 'whoop'), /couldn’t be read/, 'a Google token can’t pass as another service’s')
  const flipped = box.slice(0, -4) + (box.at(-4) === 'A' ? 'B' : 'A') + box.slice(-3)
  assert.throws(() => open(flipped, 'google'), /couldn’t be read/, 'tampering is caught')
  const key = process.env.TOKEN_KEY
  process.env.TOKEN_KEY = 'cd'.repeat(32)
  assert.throws(() => open(box, 'google'), /couldn’t be read/, 'another key can’t read it')
  delete process.env.TOKEN_KEY
  assert.throws(() => seal(t, 'google'), /TOKEN_KEY/, 'no key: nothing is stored')
  process.env.TOKEN_KEY = key
})

test('only Life OS can be written: the permissions asked for, and the code', () => {
  const api = readFileSync(new URL('../lib/google/api.ts', import.meta.url), 'utf8')
  // the only scopes: make/change the app's own calendar, list calendars, read events
  const scopes = [...api.matchAll(/'(https:\/\/www\.googleapis\.com\/auth\/[^']+)'/g)].map((m) => m[1])
  assert.deepEqual(scopes.sort(), [
    'https://www.googleapis.com/auth/calendar.app.created',
    'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
    'https://www.googleapis.com/auth/calendar.events.readonly',
  ])
  // every Calendar API write goes to this.life() (the Life OS id); there is no other POST/PATCH/DELETE on events
  const writes = api.split('\n').filter((l) => /\.call<[^(]*>\(/.test(l) && /method: '(POST|PATCH|DELETE)'/.test(l)).length
  const lifeWrites = [...api.matchAll(/\/calendars\/\$\{this\.life\(\)\}\/events[^`]*`, \{ method: '(POST|PATCH|DELETE)'/g)].length
  assert.equal(lifeWrites, 3, 'insert, patch and remove are on Life OS only')
  assert.equal(writes, 4, 'the fourth is making the Life OS calendar itself')
})
