// Queue item 4: events and life by chat, on the TEST database (real bot code, fake Telegram, scripted AI, fake Google).
// "family dinner Sat 7" → a card (nothing saved) → ✅ → a Life OS event the planner works around → ↩️ Undo archives it.
// Cancelling and moving his own events the same way; Google copies are read-only; routines and the week's priorities.
// The clock is set to Monday 10:00 last week, so "tomorrow", "Sat" and "Wed" always mean the same days.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/life-chat.test.mjs
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { fakeGoogle } from './support/fake-google.mjs'

const chat = useChat()
const skip = chat.skip
let g, MON
const clock = () => import('./support/clock.mjs')
before(async () => {
  if (skip) return
  g = await fakeGoogle()
  Object.assign(process.env, g.env, { TOKEN_KEY: '5a'.repeat(32) })
})
after(async () => { g?.close(); (await clock()).setClock(null) })
beforeEach(async () => {
  if (skip) return
  g.reset()
  const { setClock } = await clock()
  setClock(null)
  MON = T().addDays(T().weekStartISO(T().todayISO()), -7)
  setClock(T().zonedToUTC(MON, '10:00'))
})

const T = () => chat.time
const D = (n) => T().addDays(MON, n)            // D(0) = Monday (today), D(1) = Tuesday (tomorrow) …
const day = (iso) => `${T().dowShort(iso)} ${T().shortDate(iso)}`
const at = (date, hhmm) => T().zonedToUTC(date, hhmm)
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const sent = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌'))
const last = () => sent().at(-1)
const tap = async (label) => {
  const m = sent().filter((x) => chat.button(x, label)).at(-1)
  assert.ok(m, `no “${label}” button`)
  await chat.tap(chat.button(m, label), m.message_id)
}
const events = () => q(`select id, title, starts_at, ends_at, repeat_days, start_time::text, end_time::text, is_busy, sync_google, external_source, archived_at from events order by created_at`)
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const connect = async () => (await import('../lib/google/oauth.ts')).finishConnect(await session(), { code: 'good-code', state: 'st', error: null, cookie: 'st.verifier', origin: 'http://localhost:3000' })
const sync = async () => (await import('../lib/google/sync.ts')).syncGoogle(await session(), {})
const block = (o) => q(`insert into plan_blocks (user_id, plan_id, on_date, start_time, end_time, title, kind) values ($1, gen_random_uuid(), $2, $3, $4, $5, $6) returning id`,
  [chat.users.owner, o.date, o.start, o.end, o.title, o.kind ?? 'focus']).then((r) => r[0])
/** A card redrawn in place after a quick-tap answer (editMessageText), and a tap on one of its buttons. */
const redrawn = () => chat.tg.of('editMessageText').at(-1)?.body
const tapRedrawn = async (label) => { const m = redrawn(); const b = chat.button(m, label); assert.ok(b, `no “${label}” on the redrawn card`); await chat.tap(b, m.message_id) }
const act = (o) => ({ op: 'event_new', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })

// ---------------------------------------------------------------------------
// New events: the queue's three examples
// ---------------------------------------------------------------------------

test('"out with friends tomorrow 2–9pm": a card (no AI, nothing saved), ✅ saves a busy Life OS event, free time works around it, ↩️ archives it', { skip }, async () => {
  await nat('out with friends tomorrow 2–9pm')
  const card = last().text
  assert.match(card, /➕ <b>New in your calendar<\/b>/)
  assert.match(card, new RegExp(`📅 New: <b>Out with friends</b> ${day(D(1))} 14:00–21:00`))
  assert.match(card, /Nothing changes until you tap ✅ Apply/)
  assert.doesNotMatch(card, /my guess/, 'he gave an end time')
  assert.equal((await events()).length, 0, 'nothing saved before ✅')
  chat.noSurprises()   // no AI at all

  await tap('Apply')
  assert.match(last().text, /✅ <b>Done<\/b>/)
  const [ev] = await events()
  assert.equal(ev.title, 'Out with friends')
  assert.equal(ev.starts_at.toISOString(), at(D(1), '14:00'))
  assert.equal(ev.ends_at.toISOString(), at(D(1), '21:00'))
  assert.equal(ev.is_busy, true)
  assert.equal(ev.sync_google, true, 'it goes in his Life OS calendar')
  assert.equal(ev.external_source, 'manual')

  // the planner works around it: free time tomorrow stops 10 min before and starts 10 min after (the buffer)
  await nat('/free tomorrow')
  assert.match(last().text, /• 08:30–13:50/)
  assert.match(last().text, /• 21:10–22:00/)
  assert.doesNotMatch(last().text, /• 1[4-9]:|• 20:/, 'no free slot inside it')

  await tap('Undo')
  assert.match(last().text, /↩️ <b>Undone<\/b>: Out with friends/)
  const rows = await events()
  assert.equal(rows.length, 1, 'kept, never deleted')
  assert.ok(rows[0].archived_at, 'archived')
  chat.noSurprises()
})

test('"dinner tonight 8": ✅ → today’s brief shows it, and the rest of today is planned around it', { skip }, async () => {
  await nat('dinner tonight 8')
  assert.match(last().text, new RegExp(`<b>Dinner</b> ${day(D(0))} 20:00–22:00`))
  await tap('Apply')
  await nat('/brief')
  assert.match(last().text, /20:00[^\n]*Dinner/)
  await nat('/free today')
  assert.match(last().text, /Busy: [^\n]*Dinner 20:00–22:00/)
  assert.doesNotMatch(last().text, /• 2[01]:/, 'no free time inside dinner')
  chat.noSurprises()
})

test('"family dinner Sat 7": evening, 2 h guessed (and said so); ✅ → in /week', { skip }, async () => {
  await nat('family dinner Sat 7')
  const card = last().text
  assert.match(card, new RegExp(`📅 New: <b>Family dinner</b> ${day(D(5))} 19:00–21:00`))
  assert.match(card, /No end time given: 2 h is my guess \(✏️ Change to set it\)/)
  await tap('Apply')
  await nat('/week')
  assert.match(last().text, /19:00–21:00 Family dinner/)
  chat.noSurprises()
})

test('"football Wed 7:45": 19:45, 1 h 30 min guessed; ✅ saves it and asks once what type of training it is', { skip }, async () => {
  await nat('football Wed 7:45')
  assert.match(last().text, new RegExp(`📅 New: <b>Football</b> ${day(D(2))} 19:45–21:15`))
  assert.match(last().text, /1 h 30 min is my guess/)
  await tap('Apply')
  const [ev] = await events()
  assert.equal(ev.starts_at.toISOString(), at(D(2), '19:45'))
  assert.ok(sent().some((m) => /What type of training is the calendar session <b>Football<\/b>/.test(m.text)), 'the usual training-type question')
  chat.noSurprises()
})

test('more shapes: "dentist Thursday 3:30" (1 h), "cinema with Sam Friday 8-11", "revision session at school Tue 4-5:30", "football every Mon and Wed 6-7:30" (weekly)', { skip }, async () => {
  await nat('dentist Thursday 3:30')
  assert.match(last().text, new RegExp(`<b>Dentist</b> ${day(D(3))} 15:30–16:30`))
  assert.match(last().text, /1 h is my guess/)
  await tap('Apply')
  await nat('cinema with Sam Friday 8-11')
  assert.match(last().text, new RegExp(`<b>Cinema with Sam</b> ${day(D(4))} 20:00–23:00`))
  await tap('Apply')
  await nat('revision session at school Tue 4-5:30')
  assert.match(last().text, new RegExp(`<b>Revision session at school</b> ${day(D(1))} 16:00–17:30`))
  await tap('Apply')
  await nat('football every Mon and Wed 6-7:30')
  assert.match(last().text, /➕ <b>New in your calendar<\/b> <i>\(every week\)<\/i>/)
  assert.match(last().text, /📅 New: <b>Football<\/b> every Mon \+ Wed 18:00–19:30/)
  await tap('Apply')
  const rows = await events()
  assert.deepEqual(rows.map((r) => r.title), ['Dentist', 'Cinema with Sam', 'Revision session at school', 'Football'])
  assert.deepEqual(rows[3].repeat_days, [1, 3])
  assert.equal(rows[3].start_time, '18:00:00')
  chat.noSurprises()
})

test('the same event twice that day: the card warns it’s already there', { skip }, async () => {
  await add('events', { title: 'Family dinner', starts_at: at(D(5), '19:00'), ends_at: at(D(5), '21:00') })
  await nat('family dinner Sat 7')
  assert.match(last().text, new RegExp(`⚠️ <i>Already in your calendar: Family dinner ${day(D(5))} 19:00–21:00`))
})

// ---------------------------------------------------------------------------
// The planner works around it: knock-on and clashes
// ---------------------------------------------------------------------------

test('a new event on top of a planned study block: the card shows the knock-on; ✅ moves the block; ↩️ puts both back', { skip }, async () => {
  const b = await block({ date: D(1), start: '19:00', end: '20:00', title: 'Physics homework' })
  await nat('cinema with Sam tomorrow 7-10')
  const card = last().text
  assert.match(card, /↪️ <b>Knock-on in your plan<\/b>/)
  assert.match(card, new RegExp(`• Physics homework: ${day(D(1))} 19:00 → .*something is booked then now`))
  assert.deepEqual(await q(`select start_time::text s, status from plan_blocks where id = $1`, [b.id]), [{ s: '19:00:00', status: 'planned' }], 'nothing moves before ✅')
  await tap('Apply')
  assert.match(last().text, /moved in your plan/)
  const moved = (await q(`select on_date::text d, start_time::text s, status from plan_blocks where id = $1`, [b.id]))[0]
  assert.ok(moved.status === 'cancelled' || moved.s !== '19:00:00', `the block left 19:00: ${JSON.stringify(moved)}`)
  await tap('Undo')
  assert.deepEqual(await q(`select on_date::text d, start_time::text s, status from plan_blocks where id = $1`, [b.id]), [{ d: D(1), s: '19:00:00', status: 'planned' }])
  assert.ok((await events())[0].archived_at)
  chat.noSurprises()
})

test('a new event on top of another session: 1️⃣ / 2️⃣ — 2️⃣ puts it at the nearest free time and leaves football alone', { skip }, async () => {
  await add('events', { title: 'Football', repeat_days: [2], start_time: '18:00', end_time: '19:30' })
  await nat('dinner with Sam tomorrow 6:30')
  const card = last()
  assert.match(card.text, /⚠️ <b>Clash<\/b>: 18:30–20:30 is on top of Football \(18:00–19:30\)/)
  assert.match(card.text, /1️⃣ Dinner with Sam at 18:30, and cancel Football that day/)
  assert.match(card.text, /2️⃣ Dinner with Sam at \d\d:\d\d instead/)
  await tap('2️⃣')
  const ev = (await events()).find((e) => e.title === 'Dinner with Sam')
  assert.ok(ev && ev.starts_at.toISOString() !== at(D(1), '18:30'), 'moved to the free time')
  assert.equal((await q(`select count(*)::int n from event_exceptions where cancelled`))[0].n, 0, 'football untouched')
})

// ---------------------------------------------------------------------------
// Cancelling and moving his own events
// ---------------------------------------------------------------------------

test('cancelling: "dinner’s off" and "not going out tomorrow anymore" archive the one-offs (never deleted); ↩️ brings one back', { skip }, async () => {
  const dinner = await add('events', { title: 'Family dinner', starts_at: at(D(5), '19:00'), ends_at: at(D(5), '21:00') })
  const out = await add('events', { title: 'Out with friends', starts_at: at(D(1), '14:00'), ends_at: at(D(1), '21:00') })
  await nat('dinner’s off')
  assert.match(last().text, /<b>Family dinner<\/b>: → cancelled <i>\(archived, can be restored\)<\/i>/)
  assert.equal((await q(`select archived_at from events where id = $1`, [dinner.id]))[0].archived_at, null, 'nothing before ✅')
  await tap('Apply')
  assert.ok((await q(`select archived_at from events where id = $1`, [dinner.id]))[0].archived_at)
  await tap('Undo')
  assert.equal((await q(`select archived_at from events where id = $1`, [dinner.id]))[0].archived_at, null, 'back')

  await nat('not going out tomorrow anymore')
  assert.match(last().text, /<b>Out with friends<\/b>: → cancelled/)
  await tap('Apply')
  assert.ok((await q(`select archived_at from events where id = $1`, [out.id]))[0].archived_at)
  assert.equal((await q(`select count(*)::int n from events`))[0].n, 2, 'nothing deleted')
  chat.noSurprises()
})

test('"cancel football Wed": a weekly session is cancelled just that week (the rest of the weeks stay)', { skip }, async () => {
  const f = await add('events', { title: 'Football', repeat_days: [3], start_time: '19:45', end_time: '21:15' })
  await nat('cancel football Wed')
  assert.match(last().text, new RegExp(`<b>Football</b> ${day(D(2))} 19:45–21:15: → cancelled <i>\\(just this week\\)`))
  await tap('Apply')
  assert.deepEqual(await q(`select on_date::text d, cancelled from event_exceptions where event_id = $1`, [f.id]), [{ d: D(2), cancelled: true }])
  assert.equal((await q(`select archived_at from events where id = $1`, [f.id]))[0].archived_at, null)
  chat.noSurprises()
})

test('"cancel football Wed" when that session is already cancelled: says so (no card, no AI)', { skip }, async () => {
  const f = await add('events', { title: 'Football', repeat_days: [3], start_time: '19:45', end_time: '21:15' })
  await q(`insert into event_exceptions (user_id, event_id, on_date, cancelled) values ($1, $2, $3, true)`, [chat.users.owner, f.id, D(2)])
  await nat('cancel football Wed')
  assert.match(last().text, new RegExp(`<b>Football</b> on ${day(D(2))} is already cancelled`))
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0)
  chat.noSurprises()
})

test('moving: "move football to Thu 8" (this week only, 20:00 not 08:00); "family dinner is now 7:30"; "push the dentist to next week"', { skip }, async () => {
  const f = await add('events', { title: 'Football', repeat_days: [3], start_time: '19:45', end_time: '21:15' })
  await nat('move football to Thu 8')
  assert.match(last().text, new RegExp(`<b>Football</b>: ${day(D(2))} 19:45–21:15 → ${day(D(3))} 20:00–21:30 <i>\\(just this week\\)`))
  await tap('Apply')
  assert.deepEqual(await q(`select on_date::text d, new_date::text nd, new_start::text s, new_end::text e from event_exceptions where event_id = $1`, [f.id]),
    [{ d: D(2), nd: D(3), s: '20:00:00', e: '21:30:00' }])
  await tap('Undo')
  assert.deepEqual(await q(`select new_date, new_start from event_exceptions where event_id = $1`, [f.id]), [{ new_date: null, new_start: null }])

  const dinner = await add('events', { title: 'Family dinner', starts_at: at(D(5), '19:00'), ends_at: at(D(5), '21:00') })
  await nat('family dinner is now 7:30')
  assert.match(last().text, new RegExp(`<b>Family dinner</b>: ${day(D(5))} 19:00–21:00 → ${day(D(5))} 19:30–21:30`))
  await tap('Apply')
  assert.equal((await q(`select starts_at from events where id = $1`, [dinner.id]))[0].starts_at.toISOString(), at(D(5), '19:30'))

  const dentist = await add('events', { title: 'Dentist', starts_at: at(D(3), '15:30'), ends_at: at(D(3), '16:30') })
  await nat('push the dentist to next week')
  assert.match(last().text, new RegExp(`<b>Dentist</b>: ${day(D(3))} 15:30–16:30 → ${day(D(10))} 15:30–16:30`))
  await tap('Apply')
  assert.equal((await q(`select starts_at from events where id = $1`, [dentist.id]))[0].starts_at.toISOString(), at(D(10), '15:30'))
  chat.noSurprises()
})

test('"football is now 8" (a weekly session): one quick tap — just this week, or every week — then ✅', { skip }, async () => {
  const f = await add('events', { title: 'Football', repeat_days: [3], start_time: '19:45', end_time: '21:15' })
  await nat('football is now 8')
  assert.match(last().text, new RegExp(`❓ <b>Just ${day(D(2))} 19:45–21:15, or every week\\?</b>`))
  assert.ok(chat.button(last(), 'Every week') && chat.button(last(), `Just ${day(D(2))}`))
  await tap('Every week')
  assert.match(redrawn().text, /<b>Football<\/b>: .* 19:45–21:15 → .* 20:00–21:30 <i>\(every week\)<\/i>/)
  await tapRedrawn('Apply')
  assert.deepEqual(await q(`select start_time::text s, end_time::text e from events where id = $1`, [f.id]), [{ s: '20:00:00', e: '21:30:00' }])
  chat.noSurprises()
})

test('two events fit "cancel football": a quick tap says which; then ✅ cancels only that one', { skip }, async () => {
  const tue = await add('events', { title: 'Football', repeat_days: [2], start_time: '16:00', end_time: '17:00' })
  const thu = await add('events', { title: 'Football', starts_at: at(D(3), '19:00'), ends_at: at(D(3), '20:30') })
  await nat('cancel football')
  assert.match(last().text, /❓ <b>Which football do you mean\?<\/b>/)
  await tap(`Football · ${T().dowShort(D(3))} 19:00`)
  assert.match(redrawn().text, /<b>Football<\/b>: → cancelled <i>\(archived/)
  await tapRedrawn('Apply')
  assert.ok((await q(`select archived_at from events where id = $1`, [thu.id]))[0].archived_at)
  assert.equal((await q(`select archived_at from events where id = $1`, [tue.id]))[0].archived_at, null)
  assert.equal((await q(`select count(*)::int n from event_exceptions`))[0].n, 0)
  chat.noSurprises()
})

test('nothing of his matches: "cancel bowling" (like nothing in his calendar) goes to the brain; "no football Thursday" says when football is', { skip }, async () => {
  await add('events', { title: 'Football', repeat_days: [3], start_time: '19:45', end_time: '21:15' })
  // nothing in his calendar is like "bowling" (it could be a membership, a habit…): the brain reads it
  chat.ai.script(CHAT, brain({ intent: 'unclear', reply: 'There’s no bowling in your calendar. What did you want to cancel?' }))
  await nat('cancel bowling')
  assert.match(last().text, /no bowling in your calendar/)
  await nat('no football Thursday')
  assert.match(last().text, new RegExp(`There’s no <b>Football</b> on ${day(D(3))}: it’s ${day(D(2))} 19:45–21:15`))
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0, 'no card')
  chat.noSurprises()
})

test('a Google calendar event is read-only: one line says to change it in Google; nothing changes', { skip }, async () => {
  const g1 = await add('events', { title: 'Lessons', starts_at: at(D(1), '09:00'), ends_at: at(D(1), '15:30'), external_source: 'google', external_id: 'cal|x1', sync_google: false })
  await nat('move lessons to Fri')
  assert.match(last().text, /📅 <b>Lessons<\/b> is on your Google calendar, so I can’t change it here: change it in Google Calendar/)
  await nat('cancel lessons tomorrow')
  assert.match(last().text, /is on your Google calendar/)
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0, 'no card')
  assert.equal((await q(`select starts_at, archived_at from events where id = $1`, [g1.id]))[0].archived_at, null)
  chat.noSurprises()
})

test('"no game this week" is his set-up’s game (game_week, the brain), even with a Google “Games” in the calendar', { skip }, async () => {
  await add('events', { title: 'Games', starts_at: at(D(3), '13:00'), ends_at: at(D(3), '15:00'), external_source: 'google', external_id: 'cal|g1', sync_google: false })
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'brain: game_week' }))
  await nat('no game this week')
  assert.equal(last().text, 'brain: game_week')
  chat.noSurprises()
})

test('a task isn’t an event: "move physics homework to tomorrow" goes to the brain as before', { skip }, async () => {
  await add('tasks', { title: 'Physics homework', status: 'this_week', due_at: `${D(3)}T12:00:00Z` })
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'brain got it' }))
  await nat('move physics homework to tomorrow')
  assert.equal(last().text, 'brain got it')
  chat.noSurprises()
})

// ---------------------------------------------------------------------------
// The card's buttons: ✏️ change, ✖ cancel; and things it can't do
// ---------------------------------------------------------------------------

test('✏️ Change: "make it 8" (the brain, with the card) → a corrected card at 20:00; ✅ saves only that one', { skip }, async () => {
  await nat('family dinner Sat 7')
  await tap('Change')
  assert.match(last().text, /✏️ What should be different\?/)
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content.map((x) => x.text).join('\n'), /Family dinner/, 'the brain sees the card')
    return brain({ intent: 'instruction', reply: 'Dinner at 8.', actions: [act({ value: 'Family dinner', date: D(5), time: '20:00', time_to: '22:00', words: 'Sat' })] })
  })
  await nat('make it 8')
  assert.match(last().text, /✏️ <b>Corrected<\/b>/)
  assert.match(last().text, new RegExp(`<b>Family dinner</b> ${day(D(5))} 20:00–22:00`))
  await tap('Apply')
  const rows = await events()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].starts_at.toISOString(), at(D(5), '20:00'))
  chat.noSurprises()
})

test('✖ Cancel on the card: nothing saved', { skip }, async () => {
  await nat('football Wed 7:45')
  await tap('Cancel')
  assert.equal(last().text, 'Cancelled. Nothing changed.')
  assert.equal((await events()).length, 0)
})

test('something it can’t do yet ("football every other Wed 7") → one line + saved to App ideas with his words; /ideas lists it', { skip }, async () => {
  await nat('football every other Wed 7')
  assert.match(last().text, /I can’t do that yet — it needs adding in Claude Code\./)
  assert.match(last().text, /💡 Saved to your App ideas \(\/ideas\)\./)   // one line since item 3
  assert.match((await q(`select request from app_ideas`))[0].request, /^Add calendar events that repeat every other week/)
  assert.deepEqual(await q(`select source_text, status from app_ideas`), [{ source_text: 'football every other Wed 7', status: 'open' }])
  assert.equal((await events()).length, 0)
  await nat('/ideas')
  assert.match(last().text, /repeat every other week/)
  chat.noSurprises()
})

test('a card already waiting: a different new event gets its own card (both can be ✅); the same one again is left to the brain (a correction)', { skip }, async () => {
  await nat('family dinner Sat 7')
  const first = last()
  await nat('football Wed 7:45')
  assert.match(last().text, /<b>Football<\/b>/)
  await chat.tap(chat.button(first, 'Apply'), first.message_id)
  await tap('Apply')
  assert.deepEqual((await events()).map((e) => e.title).sort(), ['Family dinner', 'Football'])
  chat.noSurprises()

  await nat('cinema Fri 8')
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'brain read it' }))
  await nat('cinema Fri 8:30')
  assert.equal(last().text, 'brain read it', 'probably a change to the cinema card: the brain reads it with the card')
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'brain again' }))
  await nat('dinner’s off')
  assert.equal(last().text, 'brain again', 'with a card waiting, only new events skip the brain')
  chat.noSurprises()
})

// ---------------------------------------------------------------------------
// Life OS: the Google sync pushes it (only ever to Life OS) and follows a cancel
// ---------------------------------------------------------------------------

test('Life OS: ✅ → the sync puts it in Life OS (no other calendar written); cancelled → taken out; ↩️ → back', { skip }, async () => {
  assert.equal(await connect(), null)
  g.addCalendar('school@x', 'School', [])
  await nat('dentist Thursday 3:30')
  await tap('Apply')
  let r = await sync()
  assert.ok(r.ok, r.error)
  const life = g.lifeOs()
  const find = () => g.live(life.id).find((e) => e.summary === 'Dentist')
  assert.ok(find(), 'in Life OS')
  assert.equal(T().dateISOOf(find().start.dateTime), D(3))
  assert.equal(T().timeOf(find().start.dateTime), '15:30')
  assert.equal(T().timeOf(find().end.dateTime), '16:30')

  await nat('cancel the dentist')
  await tap('Apply')
  r = await sync()
  assert.ok(r.ok, r.error)
  assert.equal(find(), undefined, 'taken out of Life OS')
  await tap('Undo')
  r = await sync()
  assert.ok(find(), 'back in Life OS')
  const others = g.state.writes.filter((w) => w.method !== 'CREATE_CALENDAR' && w.calendarId !== life.id)
  assert.deepEqual(others, [], 'nothing written outside Life OS')
})

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

async function routines() {
  const morning = await add('habits', { name: 'Morning', sort_order: 1, days_of_week: [1, 2, 3, 4, 5, 6, 7] })
  const night = await add('habits', { name: 'Night', sort_order: 2, days_of_week: [1, 2, 3, 4, 5] })
  const blocks = {}
  for (const [h, names] of [[morning, ['Wake', 'Breakfast', 'Cold shower', 'Teeth']], [night, ['Wind-down', 'Skincare', 'Lights out']]]) {
    for (const [i, name] of names.entries()) blocks[`${h.name}:${name}`] = await add('habit_items', { habit_id: h.id, name, sort_order: i + 1 })
  }
  await add('routine_steps', { habit_item_id: blocks['Morning:Teeth'].id, title: 'Brush', sort_order: 1 })
  return { morning, night, blocks }
}
const order = (habitId) => q(`select name from habit_items where habit_id = $1 and archived_at is null order by sort_order`, [habitId]).then((r) => r.map((x) => x.name))

test('routines: "add stretch 10 min to my morning routine" → card → ✅ → the last block; ↩️ archives it (kept)', { skip }, async () => {
  const { morning } = await routines()
  await nat('add stretch 10 min to my morning routine')
  assert.match(last().text, /🔁 <b>Morning<\/b> routine: \+ <b>Stretch \(10 min\)<\/b> at the end/)
  assert.deepEqual(await order(morning.id), ['Wake', 'Breakfast', 'Cold shower', 'Teeth'], 'nothing before ✅')
  await tap('Apply')
  assert.deepEqual(await order(morning.id), ['Wake', 'Breakfast', 'Cold shower', 'Teeth', 'Stretch (10 min)'])
  await tap('Undo')
  assert.deepEqual(await order(morning.id), ['Wake', 'Breakfast', 'Cold shower', 'Teeth'])
  assert.equal((await q(`select count(*)::int n from habit_items where name = 'Stretch (10 min)' and archived_at is not null`))[0].n, 1, 'archived, not deleted')
  chat.noSurprises()
})

test('routines: "cold shower before breakfast" reorders (↩️ puts the order back); "add floss to teeth in my morning routine" adds a step', { skip }, async () => {
  const { morning, blocks } = await routines()
  await nat('cold shower before breakfast')
  assert.match(last().text, /🔁 <b>Morning<\/b>: Cold shower → <b>after Wake<\/b> <i>\(Wake → Cold shower → Breakfast → Teeth\)<\/i>/)
  await tap('Apply')
  assert.deepEqual(await order(morning.id), ['Wake', 'Cold shower', 'Breakfast', 'Teeth'])
  await tap('Undo')
  assert.deepEqual(await order(morning.id), ['Wake', 'Breakfast', 'Cold shower', 'Teeth'])
  await nat('add floss to teeth in my morning routine')
  assert.match(last().text, /🔁 <b>Morning<\/b> · Teeth: \+ <b>Floss<\/b>/)
  await tap('Apply')
  assert.deepEqual((await q(`select title from routine_steps where habit_item_id = $1 order by sort_order`, [blocks['Morning:Teeth'].id])).map((r) => r.title), ['Brush', 'Floss'])
  chat.noSurprises()
})

test('routines: "remove skincare from my night routine" archives it; "night routine every day"; "morning routine on weekdays only"', { skip }, async () => {
  const { morning, night, blocks } = await routines()
  await nat('remove skincare from my night routine')
  assert.match(last().text, /🔁 <b>Night<\/b>: − Skincare <i>\(archived, can be restored\)<\/i>/)
  await tap('Apply')
  assert.ok((await q(`select archived_at from habit_items where id = $1`, [blocks['Night:Skincare'].id]))[0].archived_at)
  assert.deepEqual(await order(night.id), ['Wind-down', 'Lights out'])
  await tap('Undo')
  assert.deepEqual(await order(night.id), ['Wind-down', 'Skincare', 'Lights out'])

  await nat('night routine every day')
  assert.match(last().text, /🔁 <b>Night<\/b> routine: Mon–Fri → <b>every day<\/b>/)
  await tap('Apply')
  await nat('morning routine on weekdays only')
  assert.match(last().text, /every day → <b>Mon–Fri<\/b>/)
  await tap('Apply')
  assert.deepEqual(await q(`select name, days_of_week from habits order by sort_order`), [{ name: 'Morning', days_of_week: [1, 2, 3, 4, 5] }, { name: 'Night', days_of_week: [1, 2, 3, 4, 5, 6, 7] }])
  // a clear message about a block that isn't there: said plainly, no AI
  await nat('remove yoga from my morning routine')
  assert.match(last().text, /Nothing to change: “yoga” isn’t in your Morning routine \(Wake, Breakfast, Cold shower, Teeth\)/)
  assert.ok(morning)
  chat.noSurprises()
})

test('routines by the brain: it sees every block (snapshot) and its life_routine change gets the usual card', { skip }, async () => {
  const { morning } = await routines()
  chat.ai.script(CHAT, (body) => {
    const text = body.messages[0].content.map((x) => x.text).join('\n')
    assert.match(text, /Routine blocks \(in order; change with life_routine\)/)
    assert.match(text, /Morning \(every day\): Wake → Breakfast → Cold shower → Teeth/)
    return brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'life_routine', value: 'routine=Morning; do=rename; block=Cold shower; name=Cold shower (2 min)' })] })
  })
  await nat('the cold shower is only 2 mins, put that in its name')
  assert.match(last().text, /🔁 <b>Morning<\/b>: Cold shower → <b>Cold shower \(2 min\)<\/b> <i>\(renamed\)<\/i>/)
  await tap('Apply')
  assert.deepEqual(await order(morning.id), ['Wake', 'Breakfast', 'Cold shower (2 min)', 'Teeth'])
  await tap('Undo')
  assert.deepEqual(await order(morning.id), ['Wake', 'Breakfast', 'Cold shower', 'Teeth'])
  chat.noSurprises()
})

// ---------------------------------------------------------------------------
// The week's top priorities
// ---------------------------------------------------------------------------

const priorities = () => q(`select week_start::text w, priorities from weekly_reviews order by week_start`)

test('priorities: "top priority this week is FM HT2" → "my 3 priorities: HT2, ACT, gym" → "drop the ACT priority"; ↩️ restores the old list', { skip }, async () => {
  await nat('top priority this week is FM HT2')
  assert.match(last().text, new RegExp(`🎯 Top priorities, week of ${day(MON)}: none → <b>1\\. FM HT2</b>`))
  assert.deepEqual(await priorities(), [], 'nothing before ✅')
  await tap('Apply')
  assert.deepEqual(await priorities(), [{ w: MON, priorities: ['FM HT2'] }])
  await nat('my 3 priorities: HT2, ACT, gym')
  assert.match(last().text, /1\. FM HT2 → <b>1\. HT2 · 2\. ACT · 3\. gym<\/b>/)
  await tap('Apply')
  await nat('drop the ACT priority')
  assert.match(last().text, /→ <b>1\. HT2 · 2\. gym<\/b>/)
  await tap('Apply')
  assert.deepEqual(await priorities(), [{ w: MON, priorities: ['HT2', 'gym'] }])
  await tap('Undo')
  assert.deepEqual(await priorities(), [{ w: MON, priorities: ['HT2', 'ACT', 'gym'] }])
  // the brain reads them (the main snapshot's "Top priorities")
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content.map((x) => x.text).join('\n'), /This week: 1\. HT2 {2}2\. ACT {2}3\. gym/)
    return brain({ intent: 'question', reply: 'HT2 first.' })
  })
  await nat('what matters most this week?')
  chat.noSurprises()
})

test('priorities: a fourth one is refused plainly (no AI); "ACT top priority this week" is a planner rule, not a priority (left to the brain / tracker)', { skip }, async () => {
  await add('weekly_reviews', { week_start: MON, priorities: ['HT2', 'ACT', 'gym'] })
  await nat('add sleep to my priorities')
  assert.match(last().text, /Nothing to change: you already have 3 priorities \(HT2, ACT, gym\): drop one first/)
  await nat('ACT top priority this week')
  assert.match(last().text, /📌 New rule: <b>ACT top priority<\/b>/, 'the tracker’s temporary rule, not a weekly priority')
  assert.deepEqual((await q(`select priorities from weekly_reviews`))[0].priorities, ['HT2', 'ACT', 'gym'], 'priorities unchanged')
  chat.noSurprises()
})
