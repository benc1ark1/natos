// Half-term week of 19 Oct 2026, round 2, no database: his Holidays setting as he typed it ("Half-term 2026-10-17..
// 2026-11-01"), the ACT test on SUN 25 Oct (Sat light, nothing timed on the day, no game that day), a "done" report
// while a card waits, chat never saved, and the settings check that names what Vercel is missing.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/halfterm2-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHolidays, dayMode, holidayChanges } from '../lib/today/holidays.ts'
import { actPicks } from '../lib/act/engine.ts'
import { DEFAULT_ACT_SETTINGS } from '../lib/act/config.ts'
import { gameEvents } from '../lib/setup.ts'
import { looksDone } from '../lib/telegram/converse.ts'
import { isChatOnly } from '../lib/chat-only.ts'
import { missingEnv, missingEnvText } from '../lib/health.ts'
import { setting } from '../lib/settings.ts'

const HIS = { holidays: 'Half-term 2026-10-17..2026-11-01' }
const W = { mon: '2026-10-19', tue: '2026-10-20', wed: '2026-10-21', thu: '2026-10-22', fri: '2026-10-23', sat: '2026-10-24', sun: '2026-10-25' }
const DOW = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }

test('his Holidays setting with its name in front is read (it used to be no holiday at all, so school showed every day)', () => {
  assert.deepEqual(parseHolidays('Half-term 2026-10-17..2026-11-01'), [{ from: '2026-10-17', to: '2026-11-01' }])
  assert.deepEqual(parseHolidays('Half-term: 2026-10-17 to 2026-11-01, Christmas 2026-12-19..2027-01-03'), [{ from: '2026-10-17', to: '2026-11-01' }, { from: '2026-12-19', to: '2027-01-03' }])
  assert.deepEqual(parseHolidays('2026-10-17..2026-11-01'), [{ from: '2026-10-17', to: '2026-11-01' }], 'the plain form still works')
  assert.deepEqual(parseHolidays('none'), [])
  assert.deepEqual(parseHolidays('2026-11-01..2026-10-17'), [], 'backwards: ignored')
  for (const k of Object.keys(W)) assert.equal(dayMode(HIS, W[k]), 'half_term', k)
  const school = { id: 's', title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15', repeat_from: '2026-09-01', is_school: true, starts_at: null }
  assert.equal(holidayChanges([school], [], HIS, W.mon, W.sun).filter((c) => c.on_date <= W.sun).length, 5, 'no school Mon–Fri')
  assert.equal(setting(HIS, 'holidayTrainingFrom'), '12:00', 'on holidays gym can be from 12:00')
})

test('the ACT test on Sun 25 Oct: Tue + Thu full tests reviewed after, Fri 4 h, Sat light, Sun nothing timed', () => {
  const world = { today: W.mon, retake: { goalId: 'g', date: W.sun }, goal: 36, scores: [], books: [], misses: [], doneToday: [], settings: DEFAULT_ACT_SETTINGS, subjectId: 'act' }
  const on = (k) => actPicks(world, { date: W[k], dow: DOW[k], mode: dayMode(HIS, W[k]), studyMinutes: 0 })
  for (const k of ['tue', 'thu']) assert.deepEqual(on(k).map((p) => p.key), ['act:full:mock', 'act:review:mock'], k)
  const fri = on('fri')
  assert.ok(fri.reduce((n, p) => n + p.minutes, 0) >= 200, 'Friday is a full 4 h day now')
  assert.deepEqual(on('sat').map((p) => p.key), ['act:light:eve'], 'Saturday light')
  const sun = on('sun')
  assert.deepEqual(sun.map((p) => p.key), ['act:test:day'])
  assert.doesNotMatch(JSON.stringify(sun), /timed|practice test/i)
})

test('no game from his usual game day on a test day; a game he says is on that week still counts', () => {
  const planning = { gameDay: 'sunday' }
  assert.deepEqual(gameEvents(W.mon, W.sun, planning, () => false, []).map((e) => e.id), ['game:2026-10-25'], 'a normal Sunday: the game')
  assert.deepEqual(gameEvents(W.mon, W.sun, planning, () => false, [W.sun]), [], 'the ACT test on Sunday: no game')
  const said = { ...planning, gameWeeks: { [W.mon]: { date: W.sun, leave: '09:00', back: '15:00' } } }
  assert.equal(gameEvents(W.mon, W.sun, said, () => false, [W.sun]).length, 1, 'he said the game is on: it stays')
})

test('a report that something is done is its own message, not a change to the waiting card', () => {
  for (const m of ['Sam’s CS homework is done', "sam's cs homework is done", 'finished the physics sheet', 'done with the reading', 'the essay was submitted', 'did my ACT reading']) assert.ok(looksDone(m), m)
  for (const m of ['make it 30 min', 'due Friday', 'CS homework due Monday', 'how do I get it done?']) assert.ok(!looksDone(m), m)
})

test('chat is never saved as a task or an Inbox item', () => {
  for (const m of ['hello', 'Hello!', 'That okay maybe', 'ok thanks', 'okay', 'thanks mate', 'yes', '👍', 'hmm', 'lol ok']) assert.ok(isChatOnly(m), m)
  for (const m of ['physics homework due fri', 'hello kitty notebook for mum', 'email Sam about Thursday', 'maybe learn guitar', 'ok buy milk']) assert.ok(!isChatOnly(m), m)
})

test('what Vercel is missing: names and what they’re for, never values; an odd TOKEN_KEY counts', () => {
  const full = Object.fromEntries(['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NAT_OS_OWNER_USER_ID', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_TICK_SECRET', 'ANTHROPIC_API_KEY', 'MAIL_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].map((k) => [k, 'x']))
  assert.deepEqual(missingEnv({ ...full, TOKEN_KEY: 'a'.repeat(64) }), [])
  assert.equal(missingEnvText({ ...full, TOKEN_KEY: 'a'.repeat(64) }), '')
  const m = missingEnv({ ...full, MAIL_SECRET: '', TOKEN_KEY: 'short' })
  assert.deepEqual(m.map((x) => [x.name, !!x.invalid]), [['MAIL_SECRET', false], ['TOKEN_KEY', true]])
  const text = missingEnvText({ ...full, TOKEN_KEY: 'secret-value-123' })
  assert.match(text, /TOKEN_KEY \(not valid\) \(reading the saved Google and Whoop sign-ins\)/)
  assert.doesNotMatch(text, /secret-value-123/, 'never the value')
})
