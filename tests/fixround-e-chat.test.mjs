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

// the AI's answer for each email it's shown, by subject (anything it's shown that isn't listed fails the test)
const sortBy = (kinds) => (body) => {
  const p = body.messages[0].content
  return { emails: [...p.matchAll(/<email n="(\d+)"[^>]*>\nFrom: [^\n]*\nSubject: ([^\n]*)/g)].map(([, n, subject]) => {
    assert.ok(subject in kinds, `the AI was shown “${subject}”`)
    return classified(Number(n), kinds[subject], `${subject} (summary)`)
  }) }
}
const sentAt = (min) => new Date(Date.now() - min * 60_000).toISOString()

test('22: only CC’d or clearly between other people: no AI, no card, no alert; homework, deadlines, flagged and group mail still come through; in /mail and the Inbox list', { skip }, async () => {
  await setPlanning({ mailHomeworkFrom: 'vlad.tutor@example.com' })
  await add('mail_rules', { pattern: '@ucs.org.uk', action: 'flag', label: 'school' })
  const r = await post({ account: 'school', address: 'babichn@ucs.org.uk', messages: [
    // Mum asks Dad about Saturday's lift, Nat CC'd: worth a look
    mail('cc1', 'Mum <mum@example.com>', 'Lift on Saturday', 'Can you take the boys to the match?', { to: 'Dad <dad@example.com>', cc: 'Nat <babichn@ucs.org.uk>', received: sentAt(9) }),
    // the club's treasurer thanks Dad: between other people
    mail('ot1', 'Mr Lee <lee@club.example.com>', 'Club fees', 'Thanks for paying October.', { to: 'Dad <dad@example.com>', cc: '', received: sentAt(8) }),
    // Vlad writes to his mum about half-term homework, Nat CC'd: homework is never filed away
    mail('hw1', 'Vlad <vlad.tutor@example.com>', 'Half-term lessons and homework', 'Hi, Nat’s homework for next week is the mechanics sheet…', { to: 'Mum <mum@example.com>', cc: 'Nat <babichn@ucs.org.uk>', received: sentAt(7) }),
    // two teachers about the trip: not to him, but his rule flags @ucs.org.uk
    mail('fl1', 'Ms Hall <hall@ucs.org.uk>', 'Re: Y12 trip numbers', 'Can you confirm the coach…', { to: 'Mr Lee <lee@ucs.org.uk>', cc: '', received: sentAt(6) }),
    // the coach writes to the team's group address (he's in it): for him
    mail('gr1', 'Coach Dan <dan@club.example.com>', 'Saturday?', 'Can you all play on Saturday?', { to: 'U18 team <u18team@club.example.com>', cc: '', received: sentAt(5) }),
    // between other people, but with a deadline: comes through
    mail('dl1', 'Mr Lee <lee@club.example.com>', 'Kit order', 'Sizes in by Friday please', { to: 'Dad <dad@example.com>', cc: '', received: sentAt(4) }),
  ] })
  assert.equal(r.status, 200)
  const { processMail } = await import('../lib/mail/watcher.ts')
  chat.ai.script(SORT, sortBy({ 'Half-term lessons and homework': 'homework', 'Re: Y12 trip numbers': 'ignore', 'Saturday?': 'reply', 'Kit order': 'reply' }))
  const res = await processMail(await session(), OWNER_TG)
  assert.equal(res.sorted, 6)
  const rows = await q(`select message_id, kind, flagged, details, why from emails order by message_id`)
  const by = Object.fromEntries(rows.map((x) => [x.message_id, x]))
  assert.deepEqual([by.cc1.kind, by.cc1.details, by.cc1.flagged], ['ignore', { look: 'cc' }, false])
  assert.match(by.cc1.why, /only CC’d/)
  assert.deepEqual([by.ot1.kind, by.ot1.details], ['ignore', { look: 'others' }])
  assert.equal(by.hw1.kind, 'homework', 'Vlad’s CC is homework')
  assert.equal(by.fl1.flagged, true, 'a flagged sender is never filed away')
  assert.equal(by.gr1.kind, 'reply', 'a group he’s in is for him')
  assert.equal(by.dl1.kind, 'reply', 'a deadline is never filed away')
  for (const id of ['hw1', 'fl1', 'gr1', 'dl1']) assert.ok(!by[id].details?.look, id)
  const sent = chat.tg.sent().map((x) => x.text).join('\n---\n')
  assert.doesNotMatch(sent, /Lift on Saturday|Club fees/, 'no alert for the two worth a look')
  assert.match(sent, /Coach Dan/)
  assert.match(sent, /Kit order/)
  // the cards for the four that came through are sorted as usual (not scripted here); none is about the two filed away
  const calls = chat.ai.byModel(SORT).map((x) => JSON.stringify(x.body.messages))
  assert.ok(calls.length >= 2)
  for (const c of calls) assert.doesNotMatch(c, /Lift on Saturday|Club fees/)
  assert.equal(chat.ai.pending(), 0)

  // /mail lists them, with a Gmail link each
  await chat.nat('/mail')
  const m = chat.last().text
  assert.match(m, /👀 <b>Emails worth a look<\/b>/)
  assert.match(m, /<a href="https:\/\/mail\.google\.com\/mail\/\?authuser=babichn%40ucs\.org\.uk#all\/t-cc1">Mum: Lift on Saturday<\/a> <i>\(\w+ \d+ \w+ · only CC’d\)<\/i>/)
  assert.match(m, /Mr Lee: Club fees<\/a> <i>\(\w+ \d+ \w+ · between other people\)<\/i>/)
  assert.doesNotMatch(m, /Coach Dan: Saturday|Half-term lessons/)

  // the Inbox page's list (his own session, row level security)
  const { loadWorthALook } = await import('../lib/mail/look.ts')
  const list = await loadWorthALook(await session())
  assert.deepEqual(list.map((e) => [e.subject, e.look]).sort(), [['Club fees', 'others'], ['Lift on Saturday', 'cc']])
})

test('22: school mail forwarded to his personal Gmail is To him (both his accounts are his); a group he’s in too', { skip }, async () => {
  // the school watcher has checked in, so its address is known
  await post({ account: 'school', address: 'babichn@ucs.org.uk', messages: [] })
  const r = await post({ account: 'personal', address: 'nat.babich@gmail.com', messages: [
    // forwarded from school: To his school address, not this account's
    mail('fw1', 'Ms Hall <hall@ucs.org.uk>', 'Trip consent', 'Please could you confirm you’re coming.', { to: 'Nat Babich <babichn@ucs.org.uk>', cc: '', received: sentAt(6) }),
    // a teacher to the Year 13 Google Group, forwarded too
    mail('fw2', 'Mr Lee <lee@ucs.org.uk>', 'Assembly moved', 'Assembly is in the hall this week.', { to: 'Year 13 <year13@ucs.org.uk>', cc: '', received: sentAt(5) }),
    // before his Google account is known: an email CC'd to it looks like other people's
    mail('fw3', 'Coach Dan <dan@club.example.com>', 'Training', 'Training is at 6 tonight.', { to: 'mum@example.com', cc: 'Nat <nat.b.google@gmail.com>', received: sentAt(4) }),
  ] })
  assert.equal(r.status, 200)
  // his Google account's address (Settings → Google) counts as his
  await add('integrations', { provider: 'google', status: 'connected', account: 'nat.b.google@gmail.com' })
  const r2 = await post({ account: 'personal', address: 'nat.babich@gmail.com', messages: [
    mail('fw4', 'Coach Dan <dan@club.example.com>', 'Training', 'Training is at 6 tonight.', { to: 'mum@example.com', cc: 'Nat <nat.b.google@gmail.com>', received: sentAt(3) }),
  ] })
  assert.equal(r2.status, 200)
  const rows = await q(`select message_id, details from emails where account = 'personal' order by message_id`)
  const by = Object.fromEntries(rows.map((x) => [x.message_id, x.details]))
  assert.deepEqual(by.fw1, {}, 'To his school address: for him')
  assert.deepEqual(by.fw2, {}, 'the Year 13 group: for him')
  assert.deepEqual(by.fw3, { addressed: 'others' }, '(before his Google account was known)')
  assert.deepEqual(by.fw4, { addressed: 'cc' }, 'his Google account’s address: only CC’d')
})

test('22: a script copied before this round (no To/Cc) is sorted as before', { skip }, async () => {
  await post({ account: 'personal', address: 'nat@gmail.com', messages: [mail('old1', 'Coach Dan <dan@club.example.com>', 'Saturday?', 'Can you play on Saturday?')] })
  chat.ai.script(SORT, () => ({ emails: [classified(1, 'reply', 'Dan asks if you can play Saturday')] }))
  const { processMail } = await import('../lib/mail/watcher.ts')
  assert.deepEqual(await processMail(await session(), OWNER_TG), { sorted: 1, notified: 1 })
  assert.deepEqual((await q(`select details from emails`))[0].details, {})
  chat.noSurprises()
})

// ---------------------------------------------------------------------------------------------------------------
// 22 (round 2). A teacher's email to his year's Google Group is never filed as a newsletter
// ---------------------------------------------------------------------------------------------------------------

test('22: a teacher to year13@ (List-Id, so "automated") is sorted as usual: homework → a homework card, anything else → a normal card; newsletters and no-reply robots are still ignored', { skip }, async () => {
  // NEXT week (half-term): Ms Hall sets physics to the Year 13 Google Group; Mr Lee moves assembly for SCHOOL week
  const GROUP = { to: 'Year 13 <year13@ucs.org.uk>', cc: '', list: true, automated: true }
  const r = await post({ account: 'school', address: 'babichn@ucs.org.uk', messages: [
    // the new script: a Google Group's mail is group mail (not a newsletter)
    mail('gg1', 'Ms Hall <hall@ucs.org.uk>', 'Physics homework', 'Simple harmonic motion: questions 1–8, by Friday please', { ...GROUP, newsletter: false, bulk: false, toCut: false, ccCut: false,
      body: 'Hi all,\nRead 4.1–4.3 and answer questions 1–8 by Friday.\nMs Hall', received: sentAt(9) }),
    // the script installed now (no newsletter/bulk flags): no homework words, still his school's
    mail('gg2', 'Mr Lee <lee@ucs.org.uk>', 'Assembly moved', 'Assembly is in the sports hall this week.', { ...GROUP, received: sentAt(8) }),
    // a newsletter with List-Unsubscribe (homework-ish words too): still ignored, no AI
    mail('nl1', 'Study Tips <hello@studytips.example.com>', 'This week’s revision tips', 'Five ways to revise for mocks', { to: 'babichn@ucs.org.uk', cc: '', list: true, automated: true, newsletter: true, received: sentAt(7) }),
    // the school's no-reply system through a list: a robot
    mail('nr1', 'UCS <noreply@ucs.org.uk>', 'Homework due reminder', 'You have homework due', { ...GROUP, newsletter: false, bulk: false, received: sentAt(6) }),
    // a plain robot (Auto-Submitted, no list)
    mail('rb1', 'Server <alerts@ucs.org.uk>', 'Password expires', 'Change your password', { to: 'babichn@ucs.org.uk', cc: '', automated: true, bulk: true, received: sentAt(5) }),
  ] })
  assert.equal(r.status, 200)
  const { processMail } = await import('../lib/mail/watcher.ts')
  chat.ai.script(SORT, sortBy({ 'Physics homework': 'homework', 'Assembly moved': 'ignore' }))
  const res = await processMail(await session(), OWNER_TG)
  assert.equal(res.sorted, 5)
  const rows = await q(`select message_id, kind, status, why, details, pending_id from emails order by message_id`)
  const by = Object.fromEntries(rows.map((x) => [x.message_id, x]))
  assert.equal(by.gg1.kind, 'homework', 'the teacher’s homework to year13@')
  assert.notEqual(by.gg2.kind, 'ignore', 'his school’s email to the group comes through')
  for (const id of ['gg1', 'gg2']) {
    assert.doesNotMatch(by[id].why ?? '', /automated|worth a look/, id)
    assert.ok(!by[id].details?.look, `${id}: not “worth a look”: it was to a group he’s in`)
  }
  for (const id of ['nl1', 'nr1', 'rb1']) assert.deepEqual([id, by[id].kind, by[id].why], [id, 'ignore', 'automated (newsletter, promo or no-reply)'])
  // the AI only saw the two from his school
  const calls = chat.ai.byModel(SORT).map((x) => JSON.stringify(x.body.messages)).join('\n')
  assert.doesNotMatch(calls, /revision tips|Homework due reminder|Password expires/)
  assert.equal(chat.ai.pending(), 0)
  // Telegram: the physics homework (added from his school, with ↩️ Undo, or a card) and assembly as a card (✅ Save); nothing for the robots
  const sent = chat.tg.sent()
  const physics = sent.find((x) => /Physics homework|Added to your tasks/.test(x.text) && /Ms Hall/.test(x.text))
  assert.ok(physics, 'a message for the physics homework')
  const assembly = sent.find((x) => /Assembly moved/.test(x.text))
  assert.ok(assembly, 'a card for the assembly email')
  assert.match(JSON.stringify(assembly.reply_markup ?? {}), /Save|✅/, 'nothing saved until ✅')
  assert.doesNotMatch(sent.map((x) => x.text).join('\n'), /revision tips|Homework due reminder|Password expires/)
})
