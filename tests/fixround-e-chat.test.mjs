// Fix round, part E (homework and email) on the TEST database, with his real autumn (tests/support/nat-real.mjs):
// 20. Classroom homework from the Homework feed: "Homework from 15/10" is named after its objective, the questions are
//     in the notes, the real due time is kept; one made by the old code is put right.
// 21. Sam's homework is archived (reason "expired", never deleted) once his next lesson has passed, on the 5-minute tick.
// 22. An email he's only CC'd on, or between other people: no AI, no card, no alert; listed in /mail and on the Inbox page.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/fixround-e-chat.test.mjs
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, SORT, OWNER_TG } from './support/chat.mjs'
import { fakeGoogle } from './support/fake-google.mjs'
import { THIS, NEXT, SCHOOL, TODAY, day, at } from './support/nat-real.mjs'

const chat = useChat()
const skip = chat.skip
const KEY = 'e'.repeat(64)
let g
before(async () => {
  if (skip) return
  g = await fakeGoogle()
  Object.assign(process.env, g.env, { TOKEN_KEY: '5a'.repeat(32), MAIL_SECRET: KEY })
})
after(() => g?.close())
beforeEach(() => g?.reset())

const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const setPlanning = (p) => q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify(p)])

// ---------------------------------------------------------------------------------------------------------------
// 20. Classroom homework
// ---------------------------------------------------------------------------------------------------------------

const connect = async () => {
  const { finishConnect } = await import('../lib/google/oauth.ts')
  return finishConnect(await session(), { code: 'good-code', state: 'st', error: null, cookie: 'st.verifier', origin: 'http://localhost:3000' })
}
const sync = async () => (await import('../lib/google/sync.ts')).syncGoogle(await session(), { readOthers: true })
const feed = (text, ref, cls = 'Maths Further Mf1a', subject = 'Further Maths') =>
  `Class: ${cls}\nSubject: ${subject}\nClassroom: https://classroom.google.com/c/AAA/a/${ref}/details\n\n${text}\n\nRef: ${ref}`

test('20: "Homework from 15/10" → its objective, the questions in the notes, the real due time; an old one is put right', { skip }, async () => {
  await connect()
  // NEXT week (half-term): FM due Fri 30 Oct 08:30 · SCHOOL week: physics due Mon 2 Nov, all day · a real title stays
  const fm = { id: 'f1', summary: 'Assignment: Homework from 15/10', start: { dateTime: at(day(NEXT, 4), '08:30') }, end: { dateTime: at(day(NEXT, 4), '08:30') },
    description: feed('Objective: To be able to sketch loci in the Argand diagram.\n\nQuestions: Ex 2B Q1–12 (odd numbers), then Ex 2C Q3, Q5.', '0123456789abcdef') }
  const ph = { id: 'p1', summary: 'Assignment: Homework from 16.10', start: { date: SCHOOL }, end: { date: day(SCHOOL, 1) },
    description: feed('Hi all,\nSimple harmonic motion: read 4.1–4.3 and answer questions 1–8.', 'fedcba9876543210', 'Physics Ph1a', 'Physics') }
  const sheet = { id: 's1', summary: 'Assignment: Integration sheet', start: { date: day(NEXT, 2) }, end: { date: day(NEXT, 3) }, description: feed('Q1–10.', 'aaaaaaaaaaaaaaaa') }
  // what the old code had already made of the physics one: "Homework from 16.10", no questions, due at noon
  await add('tasks', { title: 'Homework from 16.10', origin: 'school', importance: 'must', status: 'this_week', source: 'import', external_id: 'classroom:fedcba9876543210',
    due_at: `${SCHOOL}T12:00:00Z`, details: 'Physics Ph1a', hand_in: 'Google Classroom' })
  // and an old timed one (SCHOOL week, Wed 4 Nov 09:00) the old code saved at the day only
  const vec = { id: 'v1', summary: 'Assignment: Vectors sheet', start: { dateTime: at(day(SCHOOL, 2), '09:00') }, end: { dateTime: at(day(SCHOOL, 2), '09:00') }, description: feed('', 'bbbbbbbbbbbbbbbb') }
  await add('tasks', { title: 'Vectors sheet', origin: 'school', importance: 'must', status: 'this_week', source: 'import', external_id: 'classroom:bbbbbbbbbbbbbbbb',
    due_at: `${day(SCHOOL, 2)}T12:00:00Z`, details: 'Maths Further Mf1a · Due 09:00' })
  g.addCalendar('feed@x', 'Homework feed', [fm, ph, sheet, vec])
  const r = await sync()
  assert.ok(r?.ok, r?.error)

  const rows = await q(`select external_id, title, details, due_at, status, archived_at from tasks`)
  const by = Object.fromEntries(rows.map((x) => [x.external_id.slice(10), x]))
  const [a, b, c] = [by['0123456789abcdef'], by.fedcba9876543210, by.aaaaaaaaaaaaaaaa]
  assert.equal(a.title, 'Sketch loci in the Argand diagram', 'never “Homework from 15/10”')
  assert.equal(a.details, 'Maths Further Mf1a · Due 08:30\n\nObjective: To be able to sketch loci in the Argand diagram.\n\nQuestions: Ex 2B Q1–12 (odd numbers), then Ex 2C Q3, Q5.')
  assert.equal(a.due_at.toISOString(), at(day(NEXT, 4), '08:30'), 'due at 08:30 on Fri 30 Oct (it has to be done before school)')
  assert.equal(c.title, 'Integration sheet', 'his teacher’s own title')
  assert.match(c.details, /Q1–10\./)
  // the old one: the same task (never a second), its title and notes put right, still due Mon 2 Nov
  assert.equal(rows.length, 4)
  assert.equal(by.bbbbbbbbbbbbbbbb.due_at.toISOString(), at(day(SCHOOL, 2), '09:00'), 'the old timed one gets its real due time')
  assert.equal(b.title, 'Simple harmonic motion: read 4.1–4.3 and answer questions 1–8')
  assert.equal(b.details, 'Physics Ph1a\n\nHi all,\nSimple harmonic motion: read 4.1–4.3 and answer questions 1–8.')
  assert.equal(b.due_at.toISOString(), `${SCHOOL}T12:00:00.000Z`)
  assert.equal(b.archived_at, null)

  // he renames one: a later sync keeps his title
  await q(`update tasks set title = 'SHM questions' where external_id = 'classroom:fedcba9876543210'`)
  await sync()
  assert.equal((await q(`select title from tasks where external_id = 'classroom:fedcba9876543210'`))[0].title, 'SHM questions')
})

// ---------------------------------------------------------------------------------------------------------------
// 21. Sam's homework expires after his next lesson
// ---------------------------------------------------------------------------------------------------------------

test('21: Sam’s homework is archived (expired, never deleted) on the tick once his next lesson has passed; Vlad’s stays', { skip }, async () => {
  await setPlanning({ sources: [{ key: 'school', label: 'School (Classroom)' }, { key: 'tutor_maths_physics', label: 'Maths/physics tutor (Vlad)' }, { key: 'tutor_cs', label: 'CS tutor (Sam)' }, { key: 'own', label: 'Own' }] })
  await add('events', { title: 'CS tutor', repeat_days: [1, 4], start_time: '17:00', end_time: '18:00', repeat_from: '2026-09-01' })
  await add('events', { title: 'Maths tutor (Vlad)', repeat_days: [3], start_time: '17:00', end_time: '18:00', repeat_from: '2026-09-01' })
  // THIS week: set Mon 19 Oct after the lesson (by source) and from Sam's email · SCHOOL week: due Thu 5 Nov
  const sam = await add('tasks', { title: 'Binary search exercises', origin: 'tutor_cs', importance: 'must', status: 'this_week', created_at: at(day(THIS, 0), '20:30') })
  const mail = await add('tasks', { title: 'Computer Science homework', origin: 'own', importance: 'must', status: 'this_week', created_at: at(day(THIS, 0), '21:00'),
    details: 'Exercise 4.3 questions 1–6.\n\nFrom Sam’s email: “Computer Science Homework”.' })
  const later = await add('tasks', { title: 'Merge sort write-up', origin: 'tutor_cs', importance: 'must', status: 'this_week', created_at: at(day(THIS, 0), '20:30'), due_at: at(day(SCHOOL, 3), '23:59') })
  const vlad = await add('tasks', { title: 'Vlad: mechanics questions', origin: 'tutor_maths_physics', importance: 'must', status: 'this_week', created_at: at(day(THIS, 0), '19:00'), due_at: at(day(NEXT, 2), '23:59') })
  const { processMail } = await import('../lib/mail/watcher.ts')
  const open = async () => (await q(`select id from tasks where archived_at is null order by title`)).map((r) => r.id)

  await processMail(await session(), OWNER_TG, new Date(at(TODAY, '12:00')))
  assert.equal((await open()).length, 4, 'Wed 21 Oct: Thursday’s lesson is still to come')

  // the 5-minute tick, Thu 22 Oct 18:05 (after the lesson)
  const { runTick } = await import('../lib/telegram/tick.ts')
  await runTick(await session(), OWNER_TG, new Date(at(day(THIS, 3), '18:05')))
  assert.deepEqual((await open()).sort(), [later.id, vlad.id].sort(), 'Sam’s two from Monday are gone from his lists')
  const gone = await q(`select id, archived_at, archive_reason, status from tasks where id = any($1) order by title`, [[sam.id, mail.id]])
  assert.equal(gone.length, 2, 'never deleted')
  for (const t of gone) { assert.equal(t.archive_reason, 'expired'); assert.ok(t.archived_at) }

  // SCHOOL week: Monday's lesson doesn't end the one due Thursday; Thursday's does. Vlad's never expires
  await processMail(await session(), OWNER_TG, new Date(at(day(SCHOOL, 0), '19:00')))
  assert.deepEqual((await open()).sort(), [later.id, vlad.id].sort())
  await processMail(await session(), OWNER_TG, new Date(at(day(SCHOOL, 3), '18:30')))
  assert.deepEqual(await open(), [vlad.id])

  // "none": nothing expires
  const again = await add('tasks', { title: 'Recursion sheet', origin: 'tutor_cs', importance: 'must', status: 'this_week', created_at: at(day(THIS, 0), '20:30') })
  await setPlanning({ homeworkUntilLesson: 'none' })
  await processMail(await session(), OWNER_TG, new Date(at(day(SCHOOL, 3), '18:30')))
  assert.ok((await open()).includes(again.id))
})

// ---------------------------------------------------------------------------------------------------------------
// 22. Only CC'd, or between other people
// ---------------------------------------------------------------------------------------------------------------

const post = async (body) => (await import('../lib/mail/incoming.ts')).receiveMail(`Bearer ${KEY}`, JSON.stringify(body))
const SENT = new Date(Date.now() - 3 * 60_000).toISOString()
const mail = (id, from, subject, snippet, o = {}) => ({ id, thread: `t-${id}`, from, subject, snippet, received: SENT, labels: [], automated: false, ...o })
const classified = (n, kind, summary) => ({ n, kind, summary, event_title: '', event_date: '', event_start: '', event_end: '', date_words: '' })

test('22: only CC’d or between other people: no AI, no card, no alert (even from a tutor or a flagged sender); in /mail and the Inbox list', { skip }, async () => {
  await setPlanning({ mailHomeworkFrom: 'vlad.tutor@example.com' })
  await add('mail_rules', { pattern: '@ucs.org.uk', action: 'flag', label: 'school' })
  const r = await post({ account: 'school', address: 'babichn@ucs.org.uk', messages: [
    // Vlad writes to his mum about half-term lessons, Nat CC'd (a homework sender: would have been saved as homework)
    mail('cc1', 'Vlad <vlad.tutor@example.com>', 'Half-term lessons and homework', 'Hi, Nat’s homework for next week is the mechanics sheet…', { to: 'Mum <mum@example.com>', cc: 'Nat <babichn@ucs.org.uk>' }),
    // two teachers about the trip (a flagged sender), not to him
    mail('ot1', 'Ms Hall <hall@ucs.org.uk>', 'Re: Y12 trip numbers', 'Can you confirm the coach…', { to: 'Mr Lee <lee@ucs.org.uk>', cc: '' }),
    // to him: sorted as before
    mail('to1', 'Coach Dan <dan@club.example.com>', 'Saturday?', 'Can you play on Saturday?', { to: 'babichn@ucs.org.uk', cc: 'Mum <mum@example.com>' }),
  ] })
  assert.equal(r.status, 200)
  const { processMail } = await import('../lib/mail/watcher.ts')
  chat.ai.script(SORT, (body) => {
    const p = body.messages[0].content
    assert.doesNotMatch(p, /Half-term lessons|Y12 trip/, 'the AI never sees them (no cost)')
    return { emails: [classified(1, 'reply', 'Dan asks if you can play Saturday')] }
  })
  assert.deepEqual(await processMail(await session(), OWNER_TG), { sorted: 3, notified: 1 })
  const rows = await q(`select message_id, kind, flagged, details, why, notified_at from emails order by message_id`)
  const by = Object.fromEntries(rows.map((x) => [x.message_id, x]))
  assert.deepEqual([by.cc1.kind, by.cc1.details, by.cc1.flagged], ['ignore', { look: 'cc' }, false])
  assert.deepEqual([by.ot1.kind, by.ot1.details, by.ot1.flagged], ['ignore', { look: 'others' }, false], 'a flagged sender, but not to him')
  assert.match(by.cc1.why, /only CC’d/)
  assert.equal(by.to1.kind, 'reply')
  const sent = chat.tg.sent()
  assert.equal(sent.length, 1, 'one alert: Dan’s')
  assert.match(sent[0].text, /Coach Dan/)
  assert.equal((await q(`select count(*)::int n from tasks`))[0].n, 0, 'Vlad’s CC is not saved as homework')
  chat.noSurprises()

  // /mail lists them, with a Gmail link each
  await chat.nat('/mail')
  const m = chat.last().text
  assert.match(m, /👀 <b>Emails worth a look<\/b>/)
  assert.match(m, /<a href="https:\/\/mail\.google\.com\/mail\/\?authuser=babichn%40ucs\.org\.uk#all\/t-cc1">Vlad: Half-term lessons and homework<\/a> <i>\(\w+ \d+ \w+ · only CC’d\)<\/i>/)
  assert.match(m, /Ms Hall: Re: Y12 trip numbers<\/a> <i>\(\w+ \d+ \w+ · between other people\)<\/i>/)
  assert.doesNotMatch(m, /Coach Dan: Saturday/)

  // the Inbox page's list (his own session, row level security)
  const { loadWorthALook } = await import('../lib/mail/look.ts')
  const list = await loadWorthALook(await session())
  assert.deepEqual(list.map((e) => [e.subject, e.look]).sort(), [['Half-term lessons and homework', 'cc'], ['Re: Y12 trip numbers', 'others']])
  // nothing more is ever sent about them
  assert.deepEqual(await processMail(await session(), OWNER_TG), { sorted: 0, notified: 0 })
})

test('22: a script copied before this round (no To/Cc) is sorted as before', { skip }, async () => {
  await post({ account: 'personal', address: 'nat@gmail.com', messages: [mail('old1', 'Coach Dan <dan@club.example.com>', 'Saturday?', 'Can you play on Saturday?')] })
  chat.ai.script(SORT, () => ({ emails: [classified(1, 'reply', 'Dan asks if you can play Saturday')] }))
  const { processMail } = await import('../lib/mail/watcher.ts')
  assert.deepEqual(await processMail(await session(), OWNER_TG), { sorted: 1, notified: 1 })
  assert.deepEqual((await q(`select details from emails`))[0].details, {})
  chat.noSurprises()
})
