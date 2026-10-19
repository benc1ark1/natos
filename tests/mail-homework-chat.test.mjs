// Homework emails become tasks with the right deadline, on the TEST database. The bug: Sam's "Computer Science Homework
// - Due 20th October 2026" (sent Thu 15 Oct) got due Thu 15 Oct, the day it was sent (the sorter read "received Thu
// 15 Oct" as the date, and its check let it through because those words were in the text it was given).
// Now the deadline comes from the email's own words in code (the earlier of subject and body), the notes say what to
// do, and his tutors' and school's emails are always homework (saved straight away, with ↩️ Undo).
// Sam's real address isn't in this file (the repo is public): sam.tutor@example.com stands in for it.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/mail-homework-chat.test.mjs
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, SORT, OWNER_TG } from './support/chat.mjs'
import { sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const KEY = 'h'.repeat(64)
before(() => { if (!skip) process.env.MAIL_SECRET = KEY })

const q = (...a) => chat.q(...a)
const T = () => chat.time
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const post = async (body) => (await import('../lib/mail/incoming.ts')).receiveMail(`Bearer ${KEY}`, JSON.stringify(body))
const process_ = async () => (await import('../lib/mail/watcher.ts')).processMail(await session(), OWNER_TG)
const setPlanning = (p) => q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify(p)])
const classified = (n, kind, summary) => ({ n, kind, summary, event_title: '', event_date: '', event_start: '', event_end: '', date_words: '' })
const aiError = { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'test: the AI is down' } } }

// the email's dates relative to now (it must be recent to be announced): sent a few minutes ago
const SENT = new Date(Date.now() - 3 * 60_000).toISOString()
const sentDay = () => T().dateISOOf(SENT)
const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const ord = (n) => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
const longDate = (iso) => `${ord(+iso.slice(8, 10))} ${MONTH[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`
const weekday = (iso) => DAY[T().isoDow(iso) - 1]
const dueText = (iso, time) => `${T().dowShort(iso)} ${T().shortDate(iso)}${time ? `, ${time}` : ''}`

/** Sam's email as it was, moved to now: due in 5 days in the subject, "before <the day in 4 days> evening at 8pm" in the body. */
const samEmail = (id = 'sam1', from = 'Sam <sam.tutor@example.com>') => {
  const d5 = T().addDays(sentDay(), 5), d4 = T().addDays(sentDay(), 4)
  const body = `Hi Nat,\n\nPlease do the following problems before ${weekday(d4)} evening at 8pm:\n\n1. Binary search: write it iteratively and recursively\n2. Big-O of bubble sort vs merge sort, with a table\n3. Exercise 4.3 questions 1–6 from the textbook\n\nSend me your code as a zip.\n\nThanks,\nSam`
  return {
    msg: { id, thread: `t-${id}`, from, subject: `Computer Science Homework - Due ${longDate(d5)}`, snippet: body.slice(0, 120).replace(/\n+/g, ' '), received: SENT, labels: ['CATEGORY_PERSONAL'], automated: false, body },
    d4, d5,
  }
}

test('Sam’s email (a homework sender): saved straight away, due the earlier deadline at its time, with the problem list in the notes; ↩️ Undo archives it', { skip }, async () => {
  await setPlanning({ mailHomeworkFrom: 'sam.tutor@example.com' })
  const old = await chat.add('tasks', { title: 'Physics past paper', status: 'this_week', importance: 'must', due_at: `${T().addDays(sentDay(), 3)}T12:00:00Z` })
  const { msg, d4 } = samEmail()
  const r = await post({ account: 'personal', address: 'nat@gmail.com', messages: [msg] })
  assert.deepEqual(r.json.bodyFrom, ['sam.tutor@example.com'], 'the script is told whose emails go with their text')

  // the sorter makes the old mistake (the day it was sent): the deadline comes from the email's words instead
  chat.ai.script(SORT, (body) => {
    const p = body.messages[0].content
    assert.match(p, /sets_homework="yes"/)
    assert.match(p, /Text: Hi Nat,\n\nPlease do the following problems/)
    return { emails: [classified(1, 'homework', 'Sam set CS homework')] }
  })
  chat.ai.script(SORT, (body) => {
    assert.doesNotMatch(body.messages[0].content, /received/, 'no “received …” date for the sorter to copy')
    return sorted({ kind: 'task', title: 'Computer Science homework', subject: 'Computer Science', importance: 'must', due_date: sentDay(), date_words: 'Computer Science Homework' })
  })
  assert.deepEqual(await process_(), { sorted: 1, notified: 1 })

  const [task] = await q(`select id, title, importance, due_at, details, archived_at, (select name from subjects where id = subject_id) subject from tasks where id <> $1`, [old.id])
  assert.equal(task.title, 'Computer Science homework')
  assert.equal(task.subject, 'Computer Science')
  assert.equal(task.importance, 'must')
  assert.equal(task.due_at.toISOString(), new Date(T().zonedToUTC(d4, '20:00')).toISOString(), 'the earlier deadline (the body’s), at 8pm, never the day it was sent')
  assert.match(task.details, /^Please do the following problems before \w+ evening at 8pm:\n\n1\. Binary search: write it iteratively and recursively\n2\. Big-O of bubble sort vs merge sort, with a table\n3\. Exercise 4\.3 questions 1–6 from the textbook\n\nSend me your code as a zip\./)
  assert.match(task.details, new RegExp(`Deadline: ${dueText(d4, '20:00')} \\(from “before \\w+ evening at 8pm”\\)\\.`))
  assert.match(task.details, /From Sam’s email: “Computer Science Homework - Due /)
  assert.doesNotMatch(task.details, /Hi Nat|Thanks,/)

  const m = chat.last()
  assert.match(m.text, new RegExp(`^📚 <b>Added to your tasks</b> from Sam: <b>Computer Science homework</b>\nDue ${dueText(d4, '20:00')} <i>\\(“before \\w+ evening at 8pm”\\)</i>\n📝 Please do the following problems`))
  assert.ok(chat.button(m, 'Undo'))
  assert.equal((await q(`select body is not null kept from emails`))[0].kept, true, 'homework keeps its text')
  // his other task is exactly as it was
  const [same] = await q(`select title, due_at, updated_at, created_at, archived_at from tasks where id = $1`, [old.id])
  assert.equal(same.title, 'Physics past paper')
  assert.equal(same.archived_at, null)
  chat.noSurprises()

  // ↩️ Undo: archived (kept, never deleted)
  await chat.tap(chat.button(m, 'Undo'), m.message_id)
  assert.match(chat.tg.sent().filter((x) => !x.text.startsWith('📌')).at(-1).text, /↩️ Undone: that task is off your list \(archived, not deleted\)/)
  const [gone] = await q(`select archived_at, archive_reason from tasks where id = $1`, [task.id])
  assert.ok(gone.archived_at)
  assert.equal(gone.archive_reason, 'dropped')
  assert.deepEqual(await process_(), { sorted: 0, notified: 0 }, 'nothing twice')
})

test('the same email from someone who isn’t a homework sender: a card with the right deadline and notes; nothing saved until ✅', { skip }, async () => {
  const { msg, d4 } = samEmail('x1', 'Ms Jones <jones@other-school.org>')
  await post({ account: 'personal', address: 'nat@gmail.com', messages: [msg] })
  chat.ai.script(SORT, { emails: [classified(1, 'homework', 'Ms Jones set CS homework')] })
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Computer Science homework', subject: 'Computer Science', importance: 'must', due_date: sentDay(), date_words: 'Thu' }))
  await process_()
  const card = chat.last()
  assert.match(card.text, new RegExp(`<b>Task</b>: Computer Science homework\nComputer Science · must · due \\w+ \\d+ \\w+ 20:00`))
  assert.match(card.text, /📝 Please do the following problems before \w+ evening at 8pm:/)
  assert.doesNotMatch(card.text, /Removed a date/)
  assert.equal((await q(`select count(*)::int n from tasks`))[0].n, 0, 'nothing saved before ✅')
  await chat.tap(chat.button(card, 'Save'), card.message_id)
  const [task] = await q(`select due_at, details from tasks`)
  assert.equal(task.due_at.toISOString(), new Date(T().zonedToUTC(d4, '20:00')).toISOString())
  assert.match(task.details, /1\. Binary search/)
  chat.noSurprises()
})

test('his school: a teacher at the school’s domain is always homework (even when the AI says “reply”); school robots stay ignored', { skip }, async () => {
  const fri = (() => { let d = T().addDays(sentDay(), 1); while (T().isoDow(d) !== 5) d = T().addDays(d, 1); return d })()
  await post({ account: 'school', address: 'nat@school-test.org.uk', messages: [
    { id: 's1', thread: 't-s1', from: 'Physics Department <physics@school-test.org.uk>', subject: 'Waves worksheet', snippet: 'Please complete the waves worksheet by Friday.', received: SENT, labels: [], automated: false, body: 'Dear all,\n\nPlease complete the waves worksheet by Friday.\nQuestions 1-8 only.\n\nKind regards,\nPhysics' },
    { id: 's2', thread: 't-s2', from: 'School News <noreply@school-test.org.uk>', subject: 'Weekly bulletin', snippet: 'This week at school', received: SENT, labels: [], automated: true },
  ] })
  chat.ai.script(SORT, { emails: [classified(1, 'reply', 'Physics asks you to complete a worksheet')] })
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Waves worksheet', subject: 'Physics', importance: 'must' }))
  assert.deepEqual(await process_(), { sorted: 2, notified: 1 })
  const rows = await q(`select message_id, kind, why from emails order by message_id`)
  assert.deepEqual(rows.map((x) => [x.message_id, x.kind]), [['s1', 'homework'], ['s2', 'ignore']])
  assert.match(rows[0].why, /your school: the AI said reply/)
  const [task] = await q(`select title, origin, due_at, details from tasks`)
  assert.deepEqual([task.title, task.origin, T().dateISOOf(task.due_at.toISOString())], ['Waves worksheet', 'school', fri])
  assert.match(task.details, /^Please complete the waves worksheet by Friday\.\nQuestions 1-8 only\./)
  assert.match(chat.last().text, /^📚 <b>Added to your tasks<\/b> from Physics Department <i>\(school\)<\/i>: <b>Waves worksheet<\/b>/)
  chat.noSurprises()
})

test('a homework sender while the AI is down: still homework, with a title from the subject and the deadline from the words', { skip }, async () => {
  await setPlanning({ mailHomeworkFrom: '@tutoring-test.co.uk' })
  await post({ account: 'personal', messages: [
    { id: 'v1', thread: 't-v1', from: 'Vlad <vlad@tutoring-test.co.uk>', subject: 'Homework', snippet: 'Mechanics questions, due tomorrow at 9am', received: SENT, labels: [], automated: false, body: 'Mechanics: questions 3, 5 and 7 from chapter 2, due tomorrow at 9am.' },
  ] })
  chat.ai.script(SORT, aiError)   // sorting
  chat.ai.script(SORT, aiError)   // the card's sorter
  assert.deepEqual(await process_(), { sorted: 1, notified: 1 })
  const [task] = await q(`select title, due_at, details from tasks`)
  assert.equal(task.title, 'Homework from Vlad')
  assert.equal(task.due_at.toISOString(), new Date(T().zonedToUTC(T().addDays(sentDay(), 1), '09:00')).toISOString())
  assert.match(task.details, /^Mechanics: questions 3, 5 and 7 from chapter 2, due tomorrow at 9am\./)
  chat.noSurprises()
})

test('no deadline in the email: due the day it was sent, said to be a guess; a homework sender’s email that doesn’t set work is a card, not saved', { skip }, async () => {
  await setPlanning({ mailHomeworkFrom: 'sam.tutor@example.com' })
  await post({ account: 'personal', messages: [
    { id: 'g1', thread: 't-g1', from: 'Sam <sam.tutor@example.com>', subject: 'Extra practice', snippet: 'Some extra questions on recursion for you to try', received: SENT, labels: [], automated: false, body: 'Some extra questions on recursion for you to try:\n- Towers of Hanoi\n- Fibonacci with memoisation' },
    { id: 'g2', thread: 't-g2', from: 'Sam <sam.tutor@example.com>', subject: 'Lesson', snippet: 'Can we start 10 minutes later?', received: new Date(Date.parse(SENT) + 1000).toISOString(), labels: [], automated: false },
  ] })
  chat.ai.script(SORT, { emails: [classified(1, 'homework', 'Sam sent extra recursion questions'), classified(2, 'reply', 'Sam asks to start later')] })
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Extra recursion questions', subject: 'Computer Science' }))
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Lesson starts 10 minutes later' }))
  assert.deepEqual(await process_(), { sorted: 2, notified: 2 })
  const [task] = await q(`select title, due_at, details from tasks`)
  assert.equal(task.title, 'Extra recursion questions')
  assert.equal(T().dateISOOf(task.due_at.toISOString()), sentDay())
  assert.match(task.details, /Deadline: a guess \(the email gives none\), the day it was sent/)
  const [added, card] = chat.tg.sent()
  assert.match(added.text, /\nDue \w+ \d+ \w+ <i>\(a guess: the email gives no deadline\)<\/i>/)
  assert.ok(chat.button(card, 'Save'), 'the lesson email is homework (his rule) but sets no work: a card, never saved by itself')
  assert.match(card.text, /No deadline in the email: due the day it was sent \(.+\) as a guess/)
  assert.equal((await q(`select count(*)::int n from tasks`))[0].n, 1)
  chat.noSurprises()
})

test('already on his list (he added it himself): a card that says so, and his task isn’t changed', { skip }, async () => {
  await setPlanning({ mailHomeworkFrom: 'sam.tutor@example.com' })
  const mine = await chat.add('tasks', { title: 'Computer Science homework', status: 'this_week', importance: 'must', due_at: `${sentDay()}T12:00:00Z` })
  const [before] = await q(`select updated_at, due_at, details from tasks where id = $1`, [mine.id])
  const { msg } = samEmail('d1')
  await post({ account: 'personal', messages: [msg] })
  chat.ai.script(SORT, { emails: [classified(1, 'homework', 'Sam set CS homework')] })
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Computer Science homework', subject: 'Computer Science', importance: 'must' }))
  await process_()
  assert.match(chat.last().text, /⚠️ Looks like a duplicate: Open task “Computer Science homework”/)
  assert.ok(chat.button(chat.last(), 'Save'))
  assert.equal((await q(`select count(*)::int n from tasks`))[0].n, 1, 'nothing added')
  const [after] = await q(`select updated_at, due_at, details from tasks where id = $1`, [mine.id])
  assert.deepEqual(after, before, 'his task untouched')
  chat.noSurprises()
})

test('the text is kept only for homework; before supabase/mail-homework.sql it works from the preview line', { skip }, async () => {
  await post({ account: 'personal', messages: [
    { id: 'p1', thread: 't-p1', from: 'Alex <alex@x.com>', subject: 'Homework help?', snippet: 'Did you get question 3?', received: SENT, labels: [], automated: false, body: 'Did you get question 3? I am stuck.' },
  ] })
  chat.ai.script(SORT, { emails: [classified(1, 'reply', 'Alex asks about question 3')] })
  await process_()
  assert.equal((await q(`select body from emails`))[0].body, null, 'a reply email’s text is cleared after sorting')

  // the column isn't there yet (as before he runs the SQL file): stored without the text; the deadline from the preview
  const reload = async (want) => {
    await q(`notify pgrst, 'reload schema'`)
    const sb = await session()
    for (let i = 0; i < 40; i++) {
      const { error } = await sb.from('emails').select('body').limit(1)
      if (!!error === want) return
      await new Promise((r) => setTimeout(r, 150))
    }
  }
  await q(`alter table emails drop column body`)
  await reload(true)
  try {
    await setPlanning({ mailHomeworkFrom: 'sam.tutor@example.com' })
    const { msg, d4 } = samEmail('n1')
    msg.snippet = `Please do the following problems before ${weekday(d4)} evening at 8pm: 1. Binary search`
    const r = await post({ account: 'personal', messages: [msg] })
    assert.equal(r.json.added, 1)
    chat.ai.script(SORT, { emails: [classified(1, 'homework', 'Sam set CS homework')] })
    chat.ai.script(SORT, sorted({ kind: 'task', title: 'Computer Science homework', subject: 'Computer Science', importance: 'must' }))
    await process_()
    const [task] = await q(`select due_at, details from tasks`)
    assert.equal(task.due_at.toISOString(), new Date(T().zonedToUTC(d4, '20:00')).toISOString())
    assert.match(task.details, /^Please do the following problems/)
  } finally {
    await q(`alter table emails add column if not exists body text`)
    await q(`alter table emails drop constraint if exists emails_body_check; alter table emails add constraint emails_body_check check (body is null or char_length(body) <= 5000)`)
    await reload(false)
  }
  chat.noSurprises()
})
