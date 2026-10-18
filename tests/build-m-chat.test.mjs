// Build 2, phase M on the TEST database: the email watcher. The Gmail scripts' route (key, never twice), sorting
// (his rules, robots for free, the cheap model for the rest), what Telegram shows (task card, calendar card, reply
// alert + draft), rules by chat, /mail with cost per day, and the school fallback through the Homework feed calendar.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/build-m-chat.test.mjs
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT, OWNER_TG } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'
import { fakeGoogle } from './support/fake-google.mjs'

const chat = useChat()
const skip = chat.skip
const KEY = 'm'.repeat(64)
let g
before(async () => {
  if (skip) return
  g = await fakeGoogle()
  Object.assign(process.env, g.env, { TOKEN_KEY: '5a'.repeat(32), MAIL_SECRET: KEY })
})
after(() => g?.close())
beforeEach(() => g?.reset())

const q = (...a) => chat.q(...a)
const T = () => chat.time
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const post = async (body, key = KEY) => (await import('../lib/mail/incoming.ts')).receiveMail(key ? `Bearer ${key}` : null, JSON.stringify(body))
const process_ = async () => (await import('../lib/mail/watcher.ts')).processMail(await session(), OWNER_TG)
const ago = (min) => new Date(Date.now() - min * 60_000).toISOString()
const mail = (id, from, subject, snippet, o = {}) => ({ id, thread: `t-${id}`, from, subject, snippet, received: ago(o.min ?? 10), labels: o.labels ?? ['CATEGORY_PERSONAL'], automated: !!o.automated })
const classified = (n, kind, summary, ev = {}) => ({ n, kind, summary, event_title: '', event_date: '', event_start: '', event_end: '', date_words: '', ...ev })
const texts = () => chat.tg.sent().map((m) => m.text).join('\n---\n')
const urlButton = (m, label) => (m?.reply_markup?.inline_keyboard ?? []).flat().find((b) => b.text.includes(label))?.url

test('the route: only with the key; each email stored once; the account’s check-in noted', { skip }, async () => {
  const body = { account: 'school', address: 'nat@school.org', messages: [mail('a1', 'Sam <sam@tutor.com>', 'Hi', 'Hello')] }
  assert.equal((await post(body, 'wrong'.repeat(10))).status, 401)
  assert.equal((await post(body, null)).status, 401)
  assert.equal((await q(`select count(*)::int n from emails`))[0].n, 0, 'nothing stored without the key')
  assert.equal((await post({ account: 'school', messages: 'nope' })).status, 200, 'an empty check-in is fine')
  assert.equal((await post({ nope: 1 })).status, 400)
  assert.equal((await post(body)).json.added, 1)
  assert.equal((await post(body)).json.added, 0, 'never twice')
  const [acc] = await q(`select account, address, via, last_seen_at from mail_accounts`)
  assert.deepEqual([acc.account, acc.address, acc.via], ['school', 'nat@school.org', 'url'])
  assert.ok(Date.now() - acc.last_seen_at.getTime() < 60_000)
  const stranger = await q(`select count(*)::int n from emails where user_id = $1`, [chat.users.stranger])
  assert.equal(stranger[0].n, 0)
})

test('sorting and Telegram: homework → task card, event → calendar card, needs a reply → alert + draft; robots and rules cost nothing', { skip }, async () => {
  const thu = chat.next(4), tue = chat.next(2)
  await chat.add('mail_rules', { pattern: 'Hudl', action: 'ignore' })
  await post({ account: 'personal', address: 'nat@gmail.com', messages: [
    mail('h1', 'Sam Smith <sam@tutor.com>', 'CS homework', 'Hi Nat, please do the binary search exercises for Thursday', { min: 40 }),
    mail('e1', 'Ms Patel <patel@school.org>', 'Parents’ evening', 'Parents’ evening is on Tuesday 6–8pm in the hall', { min: 35 }),
    mail('r1', 'Coach Dan <dan@club.com>', 'Saturday?', 'Can you play on Saturday? Let me know by tonight', { min: 30 }),
    mail('i1', 'Alex <alex@x.com>', 'fyi', 'Just sharing the photos from the trip', { min: 25 }),
    mail('n1', 'Shop <deals@shop.com>', 'Sale', '50% off', { min: 20, labels: ['CATEGORY_PROMOTIONS'], automated: true }),
    mail('x1', 'Hudl <team@hudl.com>', 'Your Hudl weekly digest', 'Highlights', { min: 15 }),
  ] })
  // one AI call for the four that need it (the promo and his "ignore Hudl" rule cost nothing); then the homework card's sorter
  chat.ai.script(SORT, (body) => {
    const p = body.messages[0].content
    assert.match(p, /People and places that set him work: /)
    assert.equal((p.match(/<email /g) ?? []).length, 4)
    assert.doesNotMatch(p, /Hudl|50% off/)
    return { emails: [
      classified(1, 'homework', 'Sam set CS homework: binary search exercises, due Thursday'),
      classified(2, 'event', 'Parents’ evening Tuesday 18:00–20:00', { event_title: 'Parents’ evening', event_date: tue, event_start: '18:00', event_end: '20:00', date_words: 'Tuesday' }),
      classified(3, 'reply', 'Dan asks if you can play Saturday; answer by tonight'),
      classified(4, 'ignore', 'Alex shared trip photos'),
    ] }
  })
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Binary search exercises', subject: 'Computer Science', importance: 'must', due_date: thu, date_words: 'Thursday' }))
  const r = await process_()
  assert.deepEqual(r, { sorted: 6, notified: 3 })
  const rows = await q(`select message_id, kind, why from emails order by received_at`)
  assert.deepEqual(rows.map((x) => [x.message_id, x.kind]), [['h1', 'homework'], ['e1', 'event'], ['r1', 'reply'], ['i1', 'ignore'], ['n1', 'ignore'], ['x1', 'ignore']])
  assert.match(rows[4].why, /automated/)
  assert.match(rows[5].why, /your rule: ignore emails mentioning “Hudl”/)

  const sent = chat.tg.sent()
  assert.equal(sent.length, 3, 'one message each for homework, the event and the reply; nothing for the rest')
  const [hw, ev, rep] = sent
  assert.match(hw.text, /📧 <b>Sam Smith<\/b>: CS homework\n<b>Task<\/b>: Binary search exercises\nComputer Science · must · due Thu/)
  assert.ok(chat.button(hw, 'Save'), 'a normal task card')
  assert.match(ev.text, /📅 New: <b>Parents’ evening<\/b> \w+ \d+ \w+ 18:00–20:00/)
  assert.match(rep.text, /✉️ <b>Coach Dan<\/b>: Saturday\?\nDan asks if you can play Saturday/)
  assert.equal(urlButton(rep, 'Gmail'), 'https://mail.google.com/mail/?authuser=nat%40gmail.com#all/t-r1')
  assert.match((await q(`select text from telegram_turns where intent = 'email' order by id`)).map((t) => t.text).join('\n'), /Coach Dan: Saturday\?/, 'the bot remembers the alert')
  chat.noSurprises()

  // ✅ on the homework card saves the task; ✅ Apply on the event card adds the event
  await chat.tap(chat.button(hw, 'Save'), hw.message_id)
  const [task] = await q(`select title, importance, due_at, (select name from subjects where id = subject_id) subject from tasks`)
  assert.deepEqual([task.title, task.importance, task.subject], ['Binary search exercises', 'must', 'Computer Science'])
  await chat.tap(chat.button(ev, 'Apply'), ev.message_id)
  const [event] = await q(`select title, starts_at from events`)
  assert.equal(event.title, 'Parents’ evening')
  assert.equal(T().timeOf(event.starts_at.toISOString()), '18:00')

  // ✍️ Draft a reply: a draft to copy (never sent), and Gmail one tap away
  chat.ai.script(CHAT, () => ({ status: 200, json: { id: 'd1', type: 'message', role: 'assistant', model: CHAT, content: [{ type: 'text', text: 'Hi Dan,\n\nYes, I can play on Saturday. [time?]\n\nThanks, Nat' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 400, output_tokens: 60 } } }))
  await chat.tap(chat.button(rep, 'Draft'), rep.message_id)
  const draft = chat.last()
  assert.match(draft.text, /✍️ <b>Draft reply<\/b> to Coach Dan <i>\(copy it into Gmail: I never send emails\)<\/i>\n<pre>Hi Dan,\n\nYes, I can play on Saturday/)
  assert.ok(urlButton(draft, 'Gmail'))
  assert.match(chat.ai.byModel(CHAT).at(-1).body.messages[0].content, /Preview: Can you play on Saturday\?/)
  chat.noSurprises()

  // the cost is the watcher's: classify + homework card + draft
  assert.equal((await q(`select count(*)::int n from ai_usage where feature = 'mail'`))[0].n, 3)
  // nothing announced twice
  assert.deepEqual(await process_(), { sorted: 0, notified: 0 })
})

test('rules by chat: “always flag emails from @ucs.org.uk teachers” is a card with Undo; flagged robots still reach him; /mail shows cost per day', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [{ op: 'mail_rule', ref: '', value: 'from=ucs.org.uk; do=flag; label=ucs.org.uk teachers', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }] }))
  await chat.nat('always flag emails from @ucs.org.uk teachers')
  assert.match(chat.last().text, /📧 New email rule: <b>always flag emails from @ucs\.org\.uk \(ucs\.org\.uk teachers\)<\/b>/)
  const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
  await tap('Apply')
  assert.deepEqual(await q(`select pattern, action, label from mail_rules where archived_at is null`), [{ pattern: '@ucs.org.uk', action: 'flag', label: 'ucs.org.uk teachers' }])

  // a school mailing (automated) from a teacher: flagged, so the AI sees it, and it reaches him even if "ignore"
  await post({ account: 'school', messages: [mail('s1', 'Mr Jones <jones@ucs.org.uk>', 'Sixth form notice', 'Lanyards must be worn from Monday', { automated: true })] })
  chat.ai.script(SORT, (body) => { assert.match(body.messages[0].content, /flagged="yes"/); return { emails: [classified(1, 'ignore', 'Lanyards must be worn from Monday')] } })
  await process_()
  assert.match(chat.last().text, /📌 <b>Mr Jones<\/b> <i>\(school\)<\/i>: Sixth form notice\nLanyards must be worn from Monday\n<i>\(you asked to always hear from this sender\)<\/i>/)

  // the snapshot shows his rules and the flagged email, so he can ask about them
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))
  await chat.nat('hi')
  assert.match(chat.lastBrainText(), /## Email watcher[^\n]*\n- Rule: always flag emails from @ucs\.org\.uk \(ucs\.org\.uk teachers\)\n- Email .* from Mr Jones: “Sixth form notice” → ignore \(flagged\)/)

  await chat.nat('/mail')
  const m = chat.last().text
  assert.match(m, /📧 <b>Email watcher<\/b>/)
  assert.match(m, /• School: checked just now/)
  assert.match(m, /• Personal: not set up yet/)
  assert.match(m, /• always flag emails from @ucs\.org\.uk/)
  assert.match(m, new RegExp(`<b>Cost per day</b> \\(AI\\)\\n${T().dowShort(T().todayISO())} \\d+ \\w+: \\$0\\.0\\d\\d \\(1\\)`), 'today’s cost, then 6 more days')

  // ↩️ Undo: the rule is archived (never deleted)
  await tap('Undo')
  assert.deepEqual(await q(`select count(*)::int n from mail_rules where archived_at is null`), [{ n: 0 }])
  assert.deepEqual(await q(`select count(*)::int n from mail_rules`), [{ n: 1 }])
})

test('the school fallback: emails put in the Homework feed calendar arrive like posted ones, and aren’t copied as events', { skip }, async () => {
  const { finishConnect } = await import('../lib/google/oauth.ts')
  await finishConnect(await session(), { code: 'good-code', state: 'st', error: null, cookie: 'st.verifier', origin: 'http://localhost:3000' })
  const sent = ago(3)
  const at = (min) => ({ dateTime: ago(min) })
  const one = (m) => `natos-mail ${JSON.stringify({ account: 'school', address: 'nat@school.org', sent, messages: [m] })}`
  g.addCalendar('feed@x', 'Homework feed', [
    { id: 'f1', summary: '📧 Email for Nat OS', start: at(10), end: at(10), description: one(mail('fb1', 'Ms Patel <patel@ucs.org.uk>', 'Coursework', 'Please send your draft by Friday')) },
    { id: 'f2', summary: '📧 Nat OS email watcher (check-in)', start: at(3), end: at(3), description: `natos-mail ${JSON.stringify({ account: 'school', sent, messages: [] })}` },
  ])
  const r = await (await import('../lib/google/sync.ts')).syncGoogle(await session(), { readOthers: true })
  assert.ok(r.ok, r.error)
  const [e] = await q(`select account, message_id, from_email, subject, via from emails`)
  assert.deepEqual([e.account, e.message_id, e.from_email, e.subject, e.via], ['school', 'fb1', 'patel@ucs.org.uk', 'Coursework', 'calendar'])
  const [acc] = await q(`select via, last_seen_at from mail_accounts`)
  assert.equal(acc.via, 'calendar')
  assert.equal(acc.last_seen_at.toISOString(), sent, 'checked in when the script ran, not when the app read it')
  assert.equal((await q(`select count(*)::int n from events where external_source = 'google'`))[0].n, 0, 'not busy time in his calendar')
  await (await import('../lib/google/sync.ts')).syncGoogle(await session(), { readOthers: true })
  assert.equal((await q(`select count(*)::int n from emails`))[0].n, 1, 'never twice')
})
