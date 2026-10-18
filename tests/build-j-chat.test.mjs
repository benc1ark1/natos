// Build 2, phase J on the TEST database: Whoop against a fake Whoop (tests/support/fake-whoop.mjs).
// Connect (encrypted), days keyed by the morning he woke, workouts counted toward a target once, low recovery
// = a lighter day (brief, planner, AI), Whoop's rotating refresh tokens, and the bot.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/build-j-chat.test.mjs
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, OWNER_TG } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { fakeWhoop } from './support/fake-whoop.mjs'

const chat = useChat()
const skip = chat.skip
let w
before(async () => {
  if (skip) return
  w = await fakeWhoop()
  Object.assign(process.env, w.env, { TOKEN_KEY: '6b'.repeat(32) })
})
after(() => w?.close())
beforeEach(() => w?.reset())

const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const T = () => chat.time
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const connect = async () => {
  const { finishWhoopConnect } = await import('../lib/whoop/oauth.ts')
  return finishWhoopConnect(await session(), { code: 'good-code', state: 'state-123456', error: null, cookie: 'state-123456', origin: 'http://localhost:3000' })
}
const sync = async () => (await import('../lib/whoop/sync.ts')).syncWhoop(await session(), { force: true })
const at = (date, hhmm) => T().zonedToUTC(date, hhmm)
/** A night's sleep ending at 07:00 on `date`, its recovery and the day's strain. */
function night(date, recovery, strain, i) {
  const sleepId = `00000000-0000-0000-0000-00000000000${i}`
  w.state.data['activity/sleep'].push({ id: sleepId, start: at(T().addDays(date, -1), '23:00'), end: at(date, '07:00'), nap: false, score_state: 'SCORED', score: { sleep_performance_percentage: 88, stage_summary: { total_in_bed_time_milli: 8 * 3_600_000, total_awake_time_milli: 20 * 60_000 } } })
  w.state.data.cycle.push({ id: 100 + i, start: at(T().addDays(date, -1), '23:00'), end: null, score_state: 'SCORED', score: { strain } })
  w.state.data.recovery.push({ cycle_id: 100 + i, sleep_id: sleepId, created_at: at(date, '07:05'), score_state: 'SCORED', score: { recovery_score: recovery, hrv_rmssd_milli: 61.34, resting_heart_rate: 52, user_calibrating: false } })
}

test('connecting Whoop: refused if the answer isn’t ours; saved encrypted with the account when it is', { skip }, async () => {
  const { finishWhoopConnect } = await import('../lib/whoop/oauth.ts')
  const sb = await session()
  assert.equal(await finishWhoopConnect(sb, { code: 'good-code', state: 'forged-state', error: null, cookie: 'state-123456', origin: 'http://x' }), 'expired')
  assert.equal(await finishWhoopConnect(sb, { code: 'bad-code', state: 'state-123456', error: null, cookie: 'state-123456', origin: 'http://x' }), 'rejected')
  assert.equal(await connect(), null)
  const [row] = await q(`select provider, status, account, token_enc from integrations`)
  assert.deepEqual([row.provider, row.status, row.account], ['whoop', 'connected', 'nat@example.com'])
  assert.doesNotMatch(row.token_enc, /wr-1|wa-1/, 'encrypted')
})

test('days are the morning he woke; a workout he said counts is logged toward the target once; pages are followed', { skip }, async () => {
  await connect()
  const today = T().todayISO(), yday = T().addDays(today, -1)
  night(yday, 75, 14.2, 1)
  night(today, 28, 3.1, 2)
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 3, whoop_sports: ['Weightlifting'] })
  w.state.data['activity/workout'].push({ id: 'aaaaaaaa-0000-0000-0000-000000000001', start: at(yday, '17:00'), end: at(yday, '18:00'), sport_name: 'weightlifting', score_state: 'SCORED', score: { strain: 9.9 } })
  for (let i = 0; i < 30; i++) w.state.data['activity/workout'].push({ id: `bbbbbbbb-0000-0000-0000-0000000000${String(i).padStart(2, '0')}`, start: at(yday, '08:00'), end: at(yday, '08:20'), sport_name: 'Walking', score_state: 'SCORED', score: { strain: 2 } })

  const r = await sync()
  assert.ok(r.ok, r.error)
  assert.deepEqual(await q(`select on_date::text, recovery, hrv::float, resting_hr, sleep_minutes, sleep_performance, strain::float from whoop_days order by on_date`), [
    { on_date: yday, recovery: 75, hrv: 61.3, resting_hr: 52, sleep_minutes: 460, sleep_performance: 88, strain: 14.2 },
    { on_date: today, recovery: 28, hrv: 61.3, resting_hr: 52, sleep_minutes: 460, sleep_performance: 88, strain: 3.1 },
  ])
  assert.equal((await q(`select count(*)::int n from whoop_workouts`))[0].n, 31, 'all pages read (25 + 6)')
  assert.deepEqual(r.logged, [{ target: 'Upper', sport: 'weightlifting', date: yday }])
  const logs = () => q(`select target_id, done_on::text, source, note from target_logs`)
  assert.deepEqual(await logs(), [{ target_id: upper.id, done_on: yday, source: 'whoop', note: 'weightlifting' }])
  assert.deepEqual((await sync()).logged, [], 'not counted twice')
  assert.equal((await logs()).length, 1)
})

test('low recovery: the brief says so, the week planner treats today as tired, the AI is told', { skip }, async () => {
  await connect()
  night(T().todayISO(), 21, 2.0, 1)
  await sync()
  await chat.nat('/brief')
  assert.match(chat.last().text, /🔴 21% recovery · HRV 61\.3 · 7h 40m sleep\n<i>Low recovery: lighter training today, and protect your sleep tonight\.<\/i>/)
  const { loadViewData } = await import('../lib/telegram/views.ts')
  const { loadWorld } = await import('../lib/telegram/ripple.ts')
  const sb = await session()
  const world = await loadWorld(sb, await loadViewData(sb, T().todayISO()))
  assert.equal(world.energy.get(T().todayISO()), 'tired', 'no gym placed today')
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))
  await chat.nat('hi')
  assert.match(chat.lastBrainText(), /## Whoop \(low recovery = below 34%[^\n]*\n[^\n]*\(today\): 21% recovery[^\n]*· LOW/)
})

test('Whoop’s refresh tokens change every time: the new one is kept; a refused one asks him to connect again, once', { skip }, async () => {
  await connect()
  const { loadConnection, tokensOf, saveTokens } = await import('../lib/integrations/store.ts')
  const sb = await session()
  const expire = async () => { const c = await loadConnection(sb, 'whoop'); await saveTokens(sb, c, { ...tokensOf(c), expires_at: 0 }) }
  await expire()
  assert.ok((await sync()).ok)
  assert.equal(tokensOf(await loadConnection(sb, 'whoop')).refresh_token, 'wr-2', 'the rotated token is saved')
  await expire()
  assert.ok((await sync()).ok, 'and works for the next refresh')
  assert.equal(w.state.refreshes, 2)

  w.state.revoked = true
  await expire()
  const { runTick } = await import('../lib/telegram/tick.ts')
  await q(`update integrations set settings = settings - 'synced_at'`)
  await runTick(sb, OWNER_TG, new Date(at(T().todayISO(), '12:00')))
  assert.equal((await q(`select status from integrations`))[0].status, 'needs_reconnect')
  await runTick(sb, OWNER_TG, new Date(at(T().todayISO(), '12:35')))
  assert.equal(chat.tg.sent().filter((m) => /Whoop stopped accepting/.test(m.text)).length, 1)
})

test('the bot: /whoop shows today; “count weightlifting toward Upper” is a card with Undo', { skip }, async () => {
  await connect()
  night(T().todayISO(), 81, 5.5, 1)
  const t = await add('weekly_targets', { name: 'Upper', target_count: 3 })
  await chat.nat('/whoop')
  assert.match(chat.last().text, /⌚ <b>Today<\/b>: 81% recovery · HRV 61\.3 · 7h 40m sleep · strain 5\.5/)
  chat.ai.script(CHAT, (body) => {
    const ref = body.messages[0].content[0].text.match(/(W\d+) \| Upper/)[1]
    return brain({ intent: 'instruction', reply: 'Okay.', actions: [{ op: 'target_set', ref, value: 'whoop=Weightlifting', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }] })
  })
  await chat.nat('whoop weightlifting sessions count toward upper')
  assert.match(chat.last().text, /🎯 <b>Upper<\/b> counts Whoop: nothing → <b>Weightlifting<\/b>/)
  const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
  await tap('Apply')
  assert.deepEqual((await q(`select whoop_sports from weekly_targets where id = $1`, [t.id]))[0].whoop_sports, ['Weightlifting'])
  await tap('Undo')
  assert.deepEqual((await q(`select whoop_sports from weekly_targets where id = $1`, [t.id]))[0].whoop_sports, [])
})
