// Build 2, phase I on the TEST database: Google Calendar against a fake Google (tests/support/fake-google.mjs).
// Connect (encrypted, refused when wrong), Life OS both ways, other calendars read-only, Classroom homework,
// a sign-in Google stops accepting. Nothing is ever written to any calendar but Life OS.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/build-i-chat.test.mjs
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, OWNER_TG } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { fakeGoogle } from './support/fake-google.mjs'

const chat = useChat()
const skip = chat.skip
let g
before(async () => {
  if (skip) return
  g = await fakeGoogle()
  Object.assign(process.env, g.env, { TOKEN_KEY: '5a'.repeat(32) })
})
after(() => g?.close())
beforeEach(() => g?.reset())

const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const T = () => chat.time
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const connect = async (code = 'good-code') => {
  const { finishConnect } = await import('../lib/google/oauth.ts')
  return finishConnect(await session(), { code, state: 'st', error: null, cookie: 'st.verifier', origin: 'http://localhost:3000' })
}
const sync = async (o = {}) => (await import('../lib/google/sync.ts')).syncGoogle(await session(), o)
const otherWrites = () => g.state.writes.filter((w) => w.method !== 'CREATE_CALENDAR' && w.calendarId !== g.lifeOs()?.id)
const at = (date, hhmm) => T().zonedToUTC(date, hhmm)

test('connecting: refused if the answer isn’t ours or a box was left unticked; saved encrypted when it’s right', { skip }, async () => {
  const { finishConnect } = await import('../lib/google/oauth.ts')
  const sb = await session()
  assert.equal(await finishConnect(sb, { code: 'good-code', state: 'forged', error: null, cookie: 'st.verifier', origin: 'http://x' }), 'expired', 'state must match the cookie')
  assert.equal(await finishConnect(sb, { code: 'good-code', state: 'st', error: null, cookie: null, origin: 'http://x' }), 'expired', 'no cookie, no connection')
  assert.equal(await finishConnect(sb, { code: null, state: null, error: 'access_denied', cookie: null, origin: 'http://x' }), 'cancelled')
  assert.equal(await connect('narrow-code'), 'scopes', 'every permission is needed')
  assert.equal(g.state.revokes.length, 1, 'the half-granted sign-in is handed back to Google')
  assert.equal((await q(`select count(*)::int n from integrations`))[0].n, 0, 'nothing saved so far')

  assert.equal(await connect(), null)
  const [row] = await q(`select provider, status, account, token_enc from integrations`)
  assert.equal(row.provider, 'google')
  assert.equal(row.status, 'connected')
  assert.equal(row.account, 'nat@example.com')
  assert.match(row.token_enc, /^v1:/)
  assert.doesNotMatch(row.token_enc, /refresh-1|access-1/, 'tokens are never stored readable')
  // the stranger can't see it (row level security)
  const stranger = await q(`select count(*)::int n from integrations where user_id = $1`, [chat.users.stranger])
  assert.equal(stranger[0].n, 0)
})

test('Life OS, app → Google: each week’s session and planned block, with leave-by reminders; nothing sent twice', { skip }, async () => {
  await connect()
  const mon = chat.next(1), wed = chat.next(3), tue = chat.next(2)
  const ev = await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '18:00', end_time: '19:30', travel_minutes: 20, repeat_from: T().todayISO() })
  const dentist = await add('events', { title: 'Dentist', starts_at: at(tue, '15:00'), ends_at: at(tue, '15:30') })
  await add('events', { title: 'Private thing', starts_at: at(tue, '19:00'), ends_at: at(tue, '20:00'), sync_google: false })
  await q(`insert into event_exceptions (user_id, event_id, on_date, cancelled) values ($1, $2, $3, true)`, [chat.users.owner, ev.id, mon])
  await q(`insert into event_exceptions (user_id, event_id, on_date, new_start, new_end) values ($1, $2, $3, '17:00', '18:30')`, [chat.users.owner, ev.id, wed])
  await q(`insert into plan_blocks (user_id, plan_id, on_date, start_time, end_time, title, kind) values ($1, gen_random_uuid(), $2, '16:30', '17:15', 'Physics homework', 'focus')`, [chat.users.owner, tue])

  const r = await sync()
  assert.ok(r.ok, r.error)
  const life = g.lifeOs()
  assert.ok(life, 'the Life OS calendar was made')
  const live = g.live(life.id)
  const find = (summary, date) => live.find((e) => e.summary === summary && T().dateISOOf(e.start.dateTime) === date)
  // 4 weeks × 2 sessions, minus this Monday's (cancelled)
  const sessions = live.filter((e) => e.summary === 'Football training')
  assert.ok(sessions.length >= 7 && sessions.length <= 8, `${sessions.length} sessions`)
  assert.equal(find('Football training', mon), undefined, 'the cancelled week isn’t there')
  const moved = find('Football training', wed)
  assert.equal(T().timeOf(moved.start.dateTime), '17:00', 'this week’s move is there')
  assert.deepEqual(moved.reminders.overrides.map((o) => o.minutes), [20, 30], 'leave-by (20 min travel) and 10 min before it')
  assert.match(moved.description, /Leave by 16:40/)
  assert.deepEqual(find('Dentist', tue).reminders.overrides.map((o) => o.minutes), [30], 'no journey: 30 min before')
  assert.ok(find('🗓 Physics homework', tue), 'the planned block')
  assert.equal(find('Private thing', tue), undefined, 'not in Google if he said so')
  assert.deepEqual(otherWrites(), [], 'nothing written to any other calendar')

  const before = g.state.writes.length
  assert.deepEqual(await sync().then((x) => [x.pushed, x.changed, x.removed]), [0, 0, 0])
  assert.equal(g.state.writes.length, before, 'nothing sent twice')

  // archived in the app (never deleted there): taken out of Life OS
  await q(`update events set archived_at = now() where id = $1`, [dentist.id])
  assert.equal((await sync()).removed, 1)
  assert.equal(find('Dentist', tue) && g.live(life.id).some((e) => e.summary === 'Dentist'), false)
})

test('Life OS, Google → app: moving or deleting a session in Google changes it here (that week only), never deleting', { skip }, async () => {
  await connect()
  const wed = chat.next(3), thu = chat.next(4)
  const ev = await add('events', { title: 'Football training', repeat_days: [3], start_time: '18:00', end_time: '19:30', repeat_from: T().todayISO() })
  const one = await add('events', { title: 'Dentist', starts_at: at(thu, '15:00'), ends_at: at(thu, '15:30') })
  await sync()
  const life = g.lifeOs().id
  const gid = (summary, date) => g.live(life).find((e) => e.summary === summary && T().dateISOOf(e.start.dateTime) === date).id

  g.edit(life, gid('Football training', wed), { start: { dateTime: at(wed, '19:00') }, end: { dateTime: at(wed, '20:30') } })
  g.remove(life, gid('Dentist', thu))
  const r = await sync()
  assert.equal(r.pulled, 2)
  assert.deepEqual(await q(`select on_date::text, new_date, new_start::text, new_end::text, cancelled from event_exceptions where event_id = $1`, [ev.id]),
    [{ on_date: wed, new_date: null, new_start: '19:00:00', new_end: '20:30:00', cancelled: false }], 'that week only')
  assert.equal((await q(`select start_time::text from events where id = $1`, [ev.id]))[0].start_time, '18:00:00', 'the usual time is unchanged')
  assert.ok((await q(`select archived_at from events where id = $1`, [one.id]))[0].archived_at, 'archived, not deleted')
  assert.equal((await sync()).pulled, 0, 'his change isn’t sent back as a new one')
  assert.deepEqual(otherWrites(), [])
})

test('his other calendars: read-only copies (busy or not), school lessons, and Classroom assignments as homework once', { skip }, async () => {
  await connect()
  const today = T().todayISO(), fri = chat.next(5), tue = chat.next(2)
  g.addCalendar('personal@x', 'Nat', [
    { id: 'p1', summary: 'Haircut', start: { dateTime: at(tue, '17:00') }, end: { dateTime: at(tue, '17:30') } },
    { id: 'p2', summary: 'Maybe cinema', transparency: 'transparent', start: { dateTime: at(tue, '20:00') }, end: { dateTime: at(tue, '22:00') } },
    { id: 'p3', summary: 'Half term', start: { date: fri }, end: { date: T().addDays(fri, 3) } },
  ])
  g.addCalendar('school@x', 'Year 12 Physics', [
    { id: 's1', summary: 'Physics lesson', start: { dateTime: at(tue, '09:00') }, end: { dateTime: at(tue, '10:00') } },
    { id: 's2', summary: 'Assignment: Forces worksheet', start: { dateTime: at(fri, '23:59') }, end: { dateTime: at(fri, '23:59') } },
  ])
  let r = await sync({ readOthers: true })
  assert.ok(r.ok, r.error)
  // mark the school calendar (Settings or the bot), then read again
  await q(`update integrations set settings = jsonb_set(settings, '{calendars}', (select jsonb_agg(case when c->>'id' = 'school@x' then c || '{"school": true}' else c end) from jsonb_array_elements(settings->'calendars') c))`)
  r = await sync({ readOthers: true })
  const copies = await q(`select title, is_busy, all_day, is_school, external_source from events where external_source = 'google' and archived_at is null order by title`)
  assert.deepEqual(copies.map((c) => [c.title, c.is_busy, c.all_day, c.is_school]), [
    ['Haircut', true, false, null], ['Half term', false, true, null], ['Maybe cinema', false, false, null], ['Physics lesson', true, false, true],
  ])
  const hw = await q(`select title, origin, importance, due_at, external_id, (select name from subjects where id = subject_id) subject from tasks`)
  assert.equal(hw.length, 1)
  assert.equal(hw[0].title, 'Forces worksheet')
  assert.equal(hw[0].origin, 'school')
  assert.equal(hw[0].importance, 'must')
  assert.equal(T().dateISOOf(hw[0].due_at.toISOString()), fri)
  assert.equal(hw[0].subject, 'Physics', 'matched from the calendar’s name')

  // read again: no second copy, no second homework; a deleted event's copy is archived
  g.remove('personal@x', 'p1')
  await sync({ readOthers: true })
  assert.equal((await q(`select count(*)::int n from tasks`))[0].n, 1)
  assert.deepEqual((await q(`select title from events where external_source = 'google' and archived_at is not null`)).map((x) => x.title), ['Haircut'])
  assert.deepEqual(otherWrites(), [], 'his other calendars are never written')

  // the tick tells him about new homework, once
  g.addCalendar('school2@x', 'Maths', [{ id: 'm1', summary: 'Assignment: Integration sheet', start: { date: fri }, end: { date: T().addDays(fri, 1) } }])
  await q(`update integrations set settings = settings - 'read_at'`)
  const { runTick } = await import('../lib/telegram/tick.ts')
  await runTick(await session(), OWNER_TG, new Date(at(today, '12:00')))
  assert.match(chat.tg.sent().map((m) => m.text).join('\n'), /📚 <b>New homework from Google Classroom<\/b>\n• Maths: Integration sheet/)
  void today
})

test('Homework feed (copied from the school account by the Apps Script): subject, link and date; never twice; a date change follows', { skip }, async () => {
  await connect()
  const today = T().todayISO(), fri = chat.next(5), tue = chat.next(2), mon = chat.next(1)
  // what google-apps-script/homework-feed.gs writes (one with a Subject line, one where only the class name says it)
  const fm = (start, id) => ({ id, summary: 'Assignment: Integration sheet', start: { dateTime: at(start, '08:30') }, end: { dateTime: at(start, '08:30') },
    description: 'Class: Maths Further Mf1a\nSubject: Further Maths\nClassroom: https://classroom.google.com/c/AAA/a/BBB/details\n\nQ1–10 please.\n\nRef: 0123456789abcdef' })
  g.addCalendar('feed@x', 'Homework feed', [
    fm(fri, 'f1'),
    { id: 'f2', summary: 'Assignment: Binomial questions', start: { date: tue }, end: { date: T().addDays(tue, 1) },
      description: 'Class: 2026-28 A Level Single Maths\nClassroom: (no link in the Classroom event)\n\nRef: fedcba9876543210' },
  ])
  const { runTick } = await import('../lib/telegram/tick.ts')
  await runTick(await session(), OWNER_TG, new Date(at(today, '12:00')))
  const msg = chat.tg.sent().map((m) => m.text).join('\n')
  assert.match(msg, /📚 <b>New homework from Google Classroom<\/b>/)
  assert.match(msg, new RegExp(`• Further Maths: Integration sheet <i>\\(due Fri ${+fri.slice(8)} \\w+, 08:30\\)</i>`))
  assert.match(msg, /• Maths: Binomial questions/, '“Single Maths” is Maths, not Further Maths')
  const tasks = async () => q(`select title, origin, importance, due_at, status, hand_in, hand_in_url, details, external_id, (select name from subjects where id = subject_id) subject from tasks order by title`)
  let [bin, sheet] = await tasks()
  assert.deepEqual([sheet.title, sheet.subject, sheet.origin, sheet.importance, sheet.hand_in, sheet.hand_in_url, sheet.details, sheet.external_id],
    ['Integration sheet', 'Further Maths', 'school', 'must', 'Google Classroom', 'https://classroom.google.com/c/AAA/a/BBB/details', 'Maths Further Mf1a · Due 08:30', 'classroom:0123456789abcdef'])
  assert.equal(T().dateISOOf(sheet.due_at.toISOString()), fri)
  assert.equal(bin.subject, 'Maths')
  assert.equal(bin.hand_in_url, null, 'no link: none made up')

  // the teacher moves it to Monday and the script's copy is remade (new Google event, same Ref): the same task moves
  g.remove('feed@x', 'f1')
  g.addEvent('feed@x', fm(mon, 'f1-again'))
  const r = await sync({ readOthers: true })
  assert.deepEqual(r.homework, [], 'not new homework')
  ;[bin, sheet] = await tasks()
  assert.equal((await tasks()).length, 2, 'never twice')
  assert.equal(T().dateISOOf(sheet.due_at.toISOString()), mon)
  assert.equal(sheet.status, mon === today ? 'today' : 'this_week', 'its column follows the new date')
  assert.deepEqual(otherWrites(), [], 'the feed is only read')
})

test('a sign-in Google stops accepting: marked "needs connecting again", one message, syncing pauses', { skip }, async () => {
  await connect()
  await sync()
  g.state.revoked.add('refresh-1')
  await q(`update integrations set token_enc = token_enc`)   // (the stored token is still the old one)
  // make the access token look expired so a refresh is tried
  const { loadConnection, tokensOf, saveTokens } = await import('../lib/integrations/store.ts')
  const sb = await session()
  const c = await loadConnection(sb, 'google')
  await saveTokens(sb, c, { ...tokensOf(c), expires_at: 0 })
  const { runTick } = await import('../lib/telegram/tick.ts')
  await runTick(sb, OWNER_TG, new Date(at(T().todayISO(), '12:00')))
  assert.equal((await q(`select status from integrations`))[0].status, 'needs_reconnect')
  await runTick(sb, OWNER_TG, new Date(at(T().todayISO(), '12:05')))
  assert.equal(chat.tg.sent().filter((m) => /stopped accepting the sign-in/.test(m.text)).length, 1, 'said once')
  assert.equal(await sync(), null, 'no sync until he connects again')
})

test('the bot: Google copies are read-only, /google shows the calendars, “stop reading X” is a card with Undo', { skip }, async () => {
  await connect()
  g.addCalendar('fam@x', 'Family', [{ id: 'f1', summary: 'Grandma visit', start: { dateTime: at(chat.next(6), '12:00') }, end: { dateTime: at(chat.next(6), '15:00') } }])
  await sync({ readOthers: true })
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))
  await chat.nat('hi')
  const snap = chat.lastBrainText()
  assert.match(snap, /Grandma visit \(Google\)/, 'in the calendar, marked')
  assert.doesNotMatch(snap, /E\d+ \| Grandma visit/, 'no ref, so it can’t be changed')
  assert.match(snap, /## Google Calendar\nConnected as nat@example\.com[\s\S]*- Family: read/)

  await chat.nat('/google')
  assert.match(chat.last().text, /Google Calendar<\/b>: connected as nat@example\.com[\s\S]*• Family: read/)

  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [{ op: 'calendar_set', ref: '', value: 'calendar=Family; read=no', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }] }))
  await chat.nat('stop reading the family calendar')
  assert.match(chat.last().text, /📆 Google calendar <b>Family<\/b>: read → <b>not read<\/b>/)
  const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
  await tap('Apply')
  const read = async () => (await q(`select settings->'calendars' c from integrations`))[0].c.find((x) => x.id === 'fam@x').read
  assert.equal(await read(), false)
  await sync({ readOthers: true })
  assert.equal((await q(`select count(*)::int n from events where external_source = 'google' and archived_at is null`))[0].n, 0, 'its copies are archived')
  await tap('Undo')
  assert.equal(await read(), true)
})
