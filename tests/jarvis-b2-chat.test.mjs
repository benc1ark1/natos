// Jarvis phase B2: the pinned "Today" message, against the fake Telegram and the TEST database.
// It must: start after a ✅, be edited in place (never re-sent) when something changes, stay still when
// nothing did, start fresh each day from the morning message, 07:30 (old one unpinned, never deleted), survive being deleted,
// and never be sent twice when two updates race. Run: npm run test:chat
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT, OWNER_TG } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), last = () => chat.last(), q = (...a) => chat.q(...a)
const state = async () => (await q(`select today_message_id::int id, today_date::text date, today_hash from telegram_state where user_id = $1`, [chat.users.owner]))[0]
const pinnedTexts = () => chat.tg.sent().filter((m) => m.text.startsWith('📌'))
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const refresh = async (now, opts) => (await import('../lib/telegram/pinned.ts')).refreshPinned(await session(), OWNER_TG, now, opts)

async function saveTask(title) {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: `${title} today` }))
  chat.ai.script(SORT, sorted({ title, importance: 'must', due_date: chat.time.todayISO(), date_words: 'today' }))
  await nat(`${title} today`)
  await chat.tap(chat.button(last(), 'Save'), last().message_id)
}

test('a ✅ starts the pinned Today message; the next ✅ edits it in place', { skip }, async () => {
  await saveTask('Physics homework')
  const pins = chat.tg.of('pinChatMessage')
  assert.equal(pins.length, 1)
  assert.equal(pins[0].body.disable_notification, true, 'pinned quietly')
  const s1 = await state()
  assert.equal(s1.id, pins[0].body.message_id)
  assert.equal(s1.date, chat.time.todayISO())
  assert.match(pinnedTexts()[0].text, /📌 Physics homework/)   // (item 5: the pinned Today is the Today list)

  await saveTask('Maths sheet')
  const edits = chat.tg.of('editMessageText')
  assert.equal(edits.length, 1)
  assert.equal(edits[0].body.message_id, s1.id, 'the same message, edited')
  assert.match(edits[0].body.text, /Maths sheet/)
  assert.equal(pinnedTexts().length, 1, 'never sent again')
  assert.equal(chat.tg.of('pinChatMessage').length, 1)
})

test('nothing changed: no edit; /pin says it is up to date', { skip }, async () => {
  await saveTask('Physics homework')
  chat.tg.clear()
  await nat('/pin')
  assert.equal(chat.tg.of('editMessageText').length, 0)
  assert.match(last().text, /up to date/)
})

test('a new day: a fresh message from 07:30 (the tick waits before that); yesterday’s unpinned, never deleted', { skip }, async () => {
  await saveTask('Physics homework')
  const old = (await state()).id
  await q(`update telegram_state set today_date = today_date - 1`)
  chat.tg.clear()
  const today = chat.time.todayISO()
  // (item 5: the tick's new day starts with the morning message, 07:30 by default; on holidays later: none here)
  await q(`update profiles set planning = '{"holidays": "none"}' where user_id = $1`, [chat.users.owner])
  assert.equal(await refresh(new Date(chat.time.zonedToUTC(today, '06:00')), { startAfter: '07:30' }), 'waiting')
  assert.equal(await refresh(new Date(chat.time.zonedToUTC(today, '07:25')), { startAfter: '07:00' }), 'waiting')
  assert.equal(chat.tg.calls.length, 0, 'nothing before 07:30')
  assert.equal(await refresh(new Date(chat.time.zonedToUTC(today, '07:35')), { startAfter: '07:30' }), 'sent')
  assert.equal(chat.tg.of('sendMessage').length, 1)
  assert.equal(chat.tg.of('pinChatMessage').length, 1)
  assert.deepEqual(chat.tg.of('unpinChatMessage').map((c) => c.body.message_id), [old])
  assert.ok(!chat.tg.calls.some((c) => /delete/i.test(c.method)), 'nothing is ever deleted')
  assert.equal((await state()).date, today)
})

test('if Nat deleted the pinned message, a new one is sent and pinned', { skip }, async () => {
  await saveTask('Physics homework')
  chat.tg.failNext('editMessageText', 'Bad Request: message to edit not found')
  await saveTask('Maths sheet')
  assert.equal(pinnedTexts().length, 2)
  assert.equal(chat.tg.of('pinChatMessage').length, 2)
  assert.equal((await state()).id, chat.tg.of('pinChatMessage')[1].body.message_id)
})

test('"message is not modified" from Telegram is fine; other Telegram errors never break a save', { skip }, async () => {
  await saveTask('Physics homework')
  await q(`update telegram_state set today_hash = 'stale'`)
  chat.tg.failNext('editMessageText', 'Bad Request: message is not modified')
  assert.equal(await refresh(new Date(), { byNat: true }), 'same')
  await q(`update telegram_state set today_hash = 'stale'`)
  chat.tg.failNext('editMessageText', 'Too Many Requests: retry after 5')
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Email Mr Khan' }))
  chat.ai.script(SORT, sorted({ title: 'Email Mr Khan' }))
  await nat('Email Mr Khan')
  await chat.tap(chat.button(last(), 'Save'), last().message_id)
  assert.equal((await q(`select count(*)::int n from tasks where title = 'Email Mr Khan'`))[0].n, 1, 'the task is saved')
  assert.match(chat.tg.sent().filter((m) => m.text.startsWith('✅')).at(-1).text, /Email Mr Khan/, 'and Nat is told')
})

test('two updates racing on a new day send only one message', { skip }, async () => {
  const now = new Date()
  const results = await Promise.all([refresh(now, { byNat: true }), refresh(now, { byNat: true }), refresh(now, { byNat: true })])
  assert.equal(results.filter((r) => r === 'sent').length, 1, results.join(','))
  assert.equal(pinnedTexts().length, 1)
})

test('the tick keeps it current (e.g. a change made on the dashboard)', { skip }, async () => {
  await saveTask('Physics homework')
  await chat.add('tasks', { title: 'Added on the dashboard', status: 'today' })
  chat.tg.clear()
  const { runTick } = await import('../lib/telegram/tick.ts')
  const res = await runTick(await session(), OWNER_TG, new Date())
  assert.equal(res.pinned, 'edited')
  assert.match(chat.tg.of('editMessageText')[0].body.text, /Added on the dashboard/)
})
