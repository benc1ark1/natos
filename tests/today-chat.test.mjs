// Queue item 5 on the TEST database: the 07:30 morning message (= the pinned Today), the holiday morning, one-tap done
// with what it moves forward (+ undo), no double counting with reports, the evening "tap what you did" message and
// the roll-forward next morning, quiet hours, /today and /brief, and everything still working before today.sql.
// No AI is called anywhere here (c.noSurprises()).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/today-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { useChat, OWNER_TG } from './support/chat.mjs'

const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const T = () => chat.time
const today = () => T().todayISO()
const day = (n) => T().addDays(today(), n)
const at = (hhmm, date = today()) => new Date(T().zonedToUTC(date, hhmm))
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const tick = async (hhmm, date) => (await import('../lib/telegram/tick.ts')).runTick(await session(), OWNER_TG, at(hhmm, date))
const autoPlanId = async (d) => (await import('../lib/today/data.ts')).autoPlanId(d)
const mornings = () => chat.tg.sent().filter((m) => m.text.startsWith('📌 <b>Today'))
const evenings = () => chat.tg.sent().filter((m) => m.text.startsWith('🌙'))
const buttons = (m) => (m?.reply_markup?.inline_keyboard ?? []).flat()
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}\n${JSON.stringify(buttons(m).map((b) => `${b.text} → ${b.callback_data}`))}`) }
/** The latest version of a message (Telegram edits included): its text and buttons. */
const latest = (messageId) => {
  const edits = chat.tg.of('editMessageText').filter((c) => c.body.message_id === messageId)
  const e = edits.at(-1)
  if (e) return { text: e.body.text, reply_markup: e.body.reply_markup, message_id: messageId }
  return chat.tg.sent().find((m) => m.message_id === messageId)
}
const tapOn = async (m, re) => {
  const b = buttons(latest(m.message_id)).find((x) => re.test(x.text))
  assert.ok(b, `no button ${re} on: ${m.text.slice(0, 80)}`)
  await chat.tap(b.callback_data, m.message_id)
}

// a normal school day, no extra training suggested (each test says what it needs)
const ALL_DAYS = 'monday, tuesday, wednesday, thursday, friday, saturday, sunday'
const BASE = { holidays: 'none', noTrainingDays: ALL_DAYS }
const setPlanning = (p) => q(`update profiles set planning = $1 where user_id = $2`, [p, chat.users.owner])
const subject = async (name) => (await q(`select id from subjects where user_id = $1 and name = $2`, [chat.users.owner, name]))[0].id

/** School and football today (whatever weekday the test runs on), a homework due today and a must-do due tomorrow. */
async function schoolDay() {
  const dow = T().isoDow(today())
  await add('events', { title: 'School', repeat_days: [dow], start_time: '08:45', end_time: '16:00', repeat_from: day(-14), is_school: true })
  await add('events', { title: 'Football training', repeat_days: [dow], start_time: '19:45', end_time: '21:00', repeat_from: day(-14), training_type: 'football', load: 'hard' })
  const hw = await add('tasks', { title: 'Physics homework: waves worksheet', status: 'this_week', importance: 'must', due_at: `${today()}T12:00:00Z`, duration_minutes: 45, details: 'Worksheet 3, questions 1–8', subject_id: await subject('Physics') })
  const form = await add('tasks', { title: 'Email the trip form', status: 'this_week', importance: 'must', due_at: `${day(1)}T12:00:00Z`, duration_minutes: 15 })
  return { hw, form }
}

/** Today's list as the morning message saves it (the planner's picks), so a test controls exactly what's on it. */
async function savedList(date, rows) {
  const plan = await autoPlanId(date)
  const out = []
  for (const r of rows) out.push(await add('plan_blocks', { plan_id: plan, on_date: date, kind: 'focus', source: 'auto', status: 'planned', ...r }))
  return out
}

test('the morning message: once at 07:30, Today with a time, what to open and a tap each, plus the fixed line; it IS the pinned Today', { skip }, async () => {
  await setPlanning(BASE)
  const { hw, form } = await schoolDay()
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 2 })
  await add('plan_blocks', { plan_id: randomUUID(), on_date: today(), start_time: '16:30', end_time: '18:00', title: 'Upper @ PureGym', kind: 'training', target_id: upper.id, source: 'week' })

  await tick('07:00'); await tick('07:25')
  assert.equal(chat.tg.sent().length, 0, 'nothing before 07:30 (no brief, no pinned Today)')

  await tick('07:30')
  assert.equal(mornings().length, 1)
  const m = mornings()[0]
  show(m)
  assert.match(m.text, /^📌 <b>Today · \w+day, \d+ \w+<\/b>\n<i>🏫 School 08:45–16:00 · ⚽ Football training 19:45<\/i>\n/)
  assert.match(m.text, /<b>\d\d:\d\d<\/b> 📌 Physics homework: waves worksheet <i>· 45m<\/i>\n {5}↳ Worksheet 3, questions 1–8/, 'its time, how long and exactly what to open')
  assert.match(m.text, /<b>16:30<\/b> 🏋️ Upper @ PureGym <i>· 1h 30m<\/i>/, 'training as one item')
  assert.match(m.text, /Email the trip form/)
  assert.doesNotMatch(m.text, /Your day|Don’t forget|Targets left|Study next/, 'nothing else')
  const taps = buttons(m)
  assert.equal(taps.length, 3)
  assert.ok(taps.every((b) => /^tdy:mb1:[0-9a-f-]{36}$/.test(b.callback_data) && b.text.startsWith('☐')))
  // one morning message: it is pinned (no separate brief, no second "Today" message)
  assert.deepEqual(chat.tg.of('pinChatMessage').map((c) => c.body.message_id), [m.message_id])
  assert.equal(chat.tg.sent().length, 1)
  const st = (await q(`select today_message_id, today_date from telegram_state`))[0]
  assert.equal(Number(st.today_message_id), m.message_id)
  // saved as plan blocks: the planner's key, what to open, what done moves forward
  const rows = await q(`select title, source, pick_key, open_text, done_hint, task_id from plan_blocks where on_date = $1 and source = 'auto' order by start_time`, [today()])
  assert.deepEqual(rows.map((r) => r.pick_key).sort(), [`task:${form.id}`, `task:${hw.id}`].sort())
  assert.equal(rows.find((r) => r.task_id === hw.id).open_text, 'Worksheet 3, questions 1–8')
  assert.deepEqual(rows.find((r) => r.task_id === hw.id).done_hint, { kind: 'task', taskId: hw.id })

  // later ticks: no second morning message, the pinned one isn't resent
  await tick('07:35'); await tick('09:10')
  assert.equal(mornings().length, 1, 'once a day')
  assert.equal(chat.tg.of('pinChatMessage').length, 1)
  assert.equal((await q(`select count(*)::int n from plan_blocks where on_date = $1 and source = 'auto'`, [today()]))[0].n, 2, 'the list is saved once')
  chat.noSurprises()
})

test('holiday morning: half-term, no school, and the message waits for his holiday wake time (09:00)', { skip }, async () => {
  await setPlanning({ ...BASE, holidays: `${day(-1)}..${day(3)}`, holidayWakeAt: '09:00' })
  await schoolDay()
  await tick('07:30'); await tick('08:55')
  assert.equal(chat.tg.sent().length, 0, 'nothing before his holiday wake time')
  await tick('09:00')
  assert.equal(mornings().length, 1)
  const m = mornings()[0]
  show(m)
  assert.match(m.text, /^📌 <b>Today · [^<]+<\/b> · <i>half-term<\/i>\n<i>⚽ Football training 19:45<\/i>/, 'no school on a holiday; football still on')
  const times = [...m.text.matchAll(/<b>(\d\d:\d\d)<\/b>/g)].map((x) => x[1])
  assert.ok(times.length >= 2 && times.every((t) => t >= '09:30'), `after wake + the morning routine: ${times}`)
  assert.equal(chat.tg.of('pinChatMessage').length, 1)
  chat.noSurprises()
})

test('one tap = done and it moves things forward (topic last_done + step, task archived); a second tap puts it all back', { skip }, async () => {
  await setPlanning(BASE)
  const fm = await subject('Further Maths')
  const topic = await add('topics', { subject_id: fm, name: 'Matrices', code: 'PC1-01', status: 'not_secure', step: 2, last_done: day(-5) })
  const task = await add('tasks', { title: 'Maths homework: logs', status: 'this_week', importance: 'must', due_at: `${day(2)}T12:00:00Z`, duration_minutes: 40 })
  const [b1, b2] = await savedList(today(), [
    { start_time: '16:10', end_time: '16:50', title: task.title, task_id: task.id, pick_key: `task:${task.id}`, open_text: 'Do it in black · mark green/red/purple', done_hint: { kind: 'task', taskId: task.id } },
    { start_time: '17:00', end_time: '17:40', title: 'PC1-01 Matrices: exam questions', pick_key: `topic:${topic.id}:fix`, topic_id: topic.id, open_text: 'Bicen Core Pure → CP1: Matrices', done_hint: { kind: 'topic', topicId: topic.id, step: 4 } },
  ])
  await tick('07:30')
  const m = mornings()[0]
  show(m)
  assert.match(m.text, /<b>17:00<\/b> 📚 PC1-01 Matrices: exam questions <i>· 40m<\/i>\n {5}↳ Bicen Core Pure → CP1: Matrices/, 'the saved list, as saved')

  await tapOn(m, /Matrices/)
  let tp = (await q(`select last_done::text, step from topics where id = $1`, [topic.id]))[0]
  assert.deepEqual([tp.last_done, tp.step], [today(), 4], 'last done today, on to Bicen exam questions')
  assert.equal((await q(`select status from plan_blocks where id = $1`, [b2.id]))[0].status, 'done')
  const after = latest(m.message_id)
  assert.match(after.text, /✅ <s>17:00 📚 PC1-01 Matrices: exam questions · 40m<\/s>/, 'the pinned Today redrawn in place')
  assert.ok(buttons(after).some((b) => /^✅ 17:00 PC1-01 Matrices/.test(b.text)))
  assert.equal(chat.tg.sent().length, 1, 'no extra ✅ card or message: the tap is the confirmation')

  await tapOn(m, /Matrices/)
  tp = (await q(`select last_done::text, step from topics where id = $1`, [topic.id]))[0]
  assert.deepEqual([tp.last_done, tp.step], [day(-5), 2], 'put back exactly')
  assert.equal((await q(`select status, done_effect from plan_blocks where id = $1`, [b2.id]))[0].status, 'planned')

  await tapOn(m, /Maths homework/)
  let t = (await q(`select status, archived_at, archive_reason from tasks where id = $1`, [task.id]))[0]
  assert.deepEqual([t.status, t.archive_reason, !!t.archived_at], ['completed', 'done', true], 'completed = archived, never deleted')
  await tapOn(m, /Maths homework/)
  t = (await q(`select status, archived_at from tasks where id = $1`, [task.id]))[0]
  assert.deepEqual([t.status, t.archived_at], ['this_week', null], 'back where it was')
  assert.equal((await q(`select status from plan_blocks where id = $1`, [b1.id]))[0].status, 'planned')
  // the bot remembers the taps (so "undo that" / "it" make sense)
  assert.ok((await q(`select text from telegram_turns where role = 'nat' and text like '(ticked%'`)).length >= 4)
  chat.noSurprises()
})

test('done hints: mistake redos move on a stage, a programme item is done, a physics booklet is done; a test attempt asks for the score in one line', { skip }, async () => {
  await setPlanning(BASE)
  const fm = await subject('Further Maths'), ph = await subject('Physics')
  const m1 = await add('mistakes', { subject_id: fm, body: 'Assumed it went through the origin', code: 'PC1-03', question: 'Q3b', kind: 'knowledge', logged_on: day(-3), review_on: today() })
  const m2 = await add('mistakes', { subject_id: fm, body: 'Sign slip', code: 'PC1-03', question: 'Q5', kind: 'careless', logged_on: day(-10), review_on: today(), redo_stage: 1 })
  const prog = await add('programmes', { name: 'STEP', per_week: 1, minutes: 75, days: 'weekend' })
  const item = await add('programme_items', { programme_id: prog.id, position: 1, title: 'STEP Support Assignment 1' })
  const panda = await add('programmes', { name: 'College Panda ACT Math', area: 'act', mode: 'gaps_only' })
  const ch4 = await add('programme_items', { programme_id: panda.id, position: 4, title: 'Chapter 4 test' })
  const test1 = await add('goals', { title: 'FM HT2 test', period: 'month', kind: 'test', target_date: day(20), subject_id: fm })
  const waves = await add('topics', { subject_id: ph, name: 'Waves', code: 'P07', booklet: 'todo', last_done: day(-2) })
  const [bm, bp, bt, bw, bc] = await savedList(today(), [
    { start_time: '16:10', end_time: '16:30', title: 'Redo 2 mistakes', pick_key: `mistakes:${today()}`, kind: 'light', done_hint: { kind: 'mistakes', mistakeIds: [m1.id, m2.id] } },
    { start_time: '16:40', end_time: '17:40', title: 'STEP Support Assignment 1', pick_key: `prog:${item.id}`, programme_item_id: item.id, done_hint: { kind: 'programme_item', itemId: item.id } },
    { start_time: '17:50', end_time: '18:20', title: 'FM HT2 diagnostic', pick_key: `test:${test1.id}:diagnostic`, goal_id: test1.id, done_hint: { kind: 'attempt', goalId: test1.id, what: 'diagnostic' } },
    { start_time: '18:30', end_time: '19:00', title: 'P07 Waves: teacher booklet', pick_key: `test:${test1.id}:booklet:${waves.id}`, topic_id: waves.id, done_hint: { kind: 'topic', topicId: waves.id, physics: 'booklet' } },
    { start_time: '19:10', end_time: '19:40', title: 'College Panda ch 4 test', pick_key: `prog:${ch4.id}`, programme_item_id: ch4.id, done_hint: { kind: 'programme_item', itemId: ch4.id, score: true } },
  ])
  await chat.nat('/today')
  const m = chat.tg.sent().at(-1)
  show(m)
  assert.equal(buttons(m).length, 5)

  await tapOn(m, /Redo 2 mistakes/)
  const ms = await q(`select id, redo_stage, review_on::text, reviewed_at from mistakes order by logged_on desc`)
  assert.deepEqual([ms[0].redo_stage, ms[0].review_on, ms[0].reviewed_at], [1, day(7), null], 'first redo → again in a week')
  assert.equal(ms[1].redo_stage, 2, 'second redo → done')
  assert.ok(ms[1].reviewed_at)
  await tapOn(m, /STEP Support/)
  assert.deepEqual(Object.values((await q(`select status, done_on::text from programme_items where id = $1`, [item.id]))[0]), ['done', today()])
  await tapOn(m, /P07 Waves/)
  const w = (await q(`select booklet, last_done::text from topics where id = $1`, [waves.id]))[0]
  assert.deepEqual([w.booklet, w.last_done], ['done', today()])

  await tapOn(m, /FM HT2 diagnostic/)
  assert.equal(chat.tg.sent().at(-1).text, '📝 How did the FM HT2 test diagnostic go? Send the score, e.g. “FM HT2 diagnostic 31/45”.')
  assert.equal((await q(`select count(*)::int n from test_attempts`))[0].n, 0, 'no attempt until he sends the score (so his report is the only one)')
  await tapOn(m, /College Panda/)
  assert.match(chat.tg.sent().at(-1).text, /^📝 What did you score on College Panda ACT Math: Chapter 4 test\? Send it like “College Panda ch 4 test 12\/15” \(full marks = skip that chapter\)\.$/)
  assert.equal((await q(`select status from programme_items where id = $1`, [ch4.id]))[0].status, 'todo', 'the chapter stays to do until its score says skip')
  assert.equal((await q(`select count(*)::int n from plan_blocks where id = any($1) and status = 'done'`, [[bm.id, bp.id, bt.id, bw.id, bc.id]]))[0].n, 5)

  // second taps put back exactly what the first changed
  await tapOn(m, /Redo 2 mistakes/)
  const back = await q(`select redo_stage, review_on::text, reviewed_at from mistakes order by logged_on desc`)
  assert.deepEqual(back.map((x) => [x.redo_stage, x.review_on, x.reviewed_at]), [[0, today(), null], [1, today(), null]])
  await tapOn(m, /STEP Support/)
  assert.deepEqual(Object.values((await q(`select status, done_on from programme_items where id = $1`, [item.id]))[0]), ['todo', null])
  await tapOn(m, /P07 Waves/)
  assert.deepEqual(Object.values((await q(`select booklet, last_done::text from topics where id = $1`, [waves.id]))[0]), ['todo', day(-2)])
  chat.noSurprises()
})

test('no double counting: what he already reported by message shows as done, and ticking it changes nothing twice', { skip }, async () => {
  await setPlanning(BASE)
  const fm = await subject('Further Maths')
  const topic = await add('topics', { subject_id: fm, name: 'Roots of polynomials', code: 'PC1-03', status: 'understand', step: 4, last_done: day(-3) })
  const task = await add('tasks', { title: 'Chemistry form', status: 'this_week', importance: 'must', due_at: `${today()}T12:00:00Z`, duration_minutes: 10 })
  const [bt, bk] = await savedList(today(), [
    { start_time: '16:10', end_time: '16:50', title: 'PC1-03 Roots: Bicen exam questions', pick_key: `topic:${topic.id}:fix`, topic_id: topic.id, done_hint: { kind: 'topic', topicId: topic.id, step: 4 } },
    { start_time: '17:00', end_time: '17:10', title: task.title, task_id: task.id, pick_key: `task:${task.id}`, kind: 'light', done_hint: { kind: 'task', taskId: task.id } },
  ])
  // he reports both by message: the tracker bot moves the topic on and ticks Today's item by its key; the task is done
  const { markPickDone } = await import('../lib/today/data.ts')
  await q(`update topics set last_done = $1 where id = $2`, [today(), topic.id])
  assert.equal(await markPickDone(await session(), today(), `topic:${topic.id}:fix`), true)
  await q(`update tasks set status = 'completed', completed_at = now(), archived_at = now(), archive_reason = 'done' where id = $1`, [task.id])
  const stamp = (await q(`select updated_at from topics where id = $1`, [topic.id]))[0].updated_at

  await chat.nat('/today')
  const m = chat.tg.sent().at(-1)
  show(m)
  assert.match(m.text, /✅ <s>16:10 📚 PC1-03 Roots: Bicen exam questions/)
  assert.match(m.text, /✅ <s>17:00 📌 Chemistry form/, 'the task done elsewhere shows done too')
  assert.ok(buttons(m).every((b) => b.text.startsWith('✅')))

  // tapping the reported topic now unticks it on Today only: the report's record isn't touched
  await tapOn(m, /PC1-03/)
  assert.equal((await q(`select status from plan_blocks where id = $1`, [bt.id]))[0].status, 'planned')
  assert.equal((await q(`select updated_at from topics where id = $1`, [topic.id]))[0].updated_at.getTime(), stamp.getTime())
  // and ticking it again (a tick wants "done") changes nothing in his records either (already done today, at that step)
  await chat.tap(`tdy:mb1:${bt.id}`, m.message_id)
  const b = (await q(`select status, done_effect from plan_blocks where id = $1`, [bt.id]))[0]
  assert.deepEqual([b.status, b.done_effect], ['done', null], 'nothing to undo: nothing was counted twice')
  assert.equal((await q(`select updated_at from topics where id = $1`, [topic.id]))[0].updated_at.getTime(), stamp.getTime())
  // the completed task: a tick doesn't complete it again
  await tapOn(m, /Chemistry/)
  assert.equal((await q(`select done_effect from plan_blocks where id = $1`, [bk.id]))[0].done_effect, null)
  assert.equal((await q(`select status from tasks where id = $1`, [task.id]))[0].status, 'completed')
  chat.noSurprises()
})

test('evening: one message with a tap per item (no “move them? ✅” card); what isn’t ticked rolls on to tomorrow by itself', { skip }, async () => {
  await setPlanning(BASE)
  const fm = await subject('Further Maths')
  const topic = await add('topics', { subject_id: fm, name: 'Matrices', code: 'PC1-01', status: 'not_secure', step: 3 })
  const hw = await add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: `${day(1)}T12:00:00Z`, duration_minutes: 45 })
  // yesterday: the homework wasn't done, the matrices was
  await savedList(day(-1), [
    { start_time: '16:10', end_time: '16:55', title: hw.title, task_id: hw.id, pick_key: `task:${hw.id}`, done_hint: { kind: 'task', taskId: hw.id } },
    { start_time: '17:05', end_time: '17:45', title: 'PC1-01 Matrices', pick_key: `topic:${topic.id}:fix`, status: 'done', done_hint: { kind: 'topic', topicId: topic.id } },
  ])
  // this morning: the homework rolls on (the planner picks it again), marked rolled_from yesterday
  await tick('07:30')
  const rolled = (await q(`select rolled_from::text, why from plan_blocks where on_date = $1 and pick_key = $2`, [today(), `task:${hw.id}`]))[0]
  assert.equal(rolled.rolled_from, day(-1))
  assert.match(rolled.why, /^from yesterday · [Dd]ue tomorrow/)
  assert.equal((await q(`select status from plan_blocks where on_date = $1 and pick_key = $2`, [day(-1), `task:${hw.id}`]))[0].status, 'planned', 'yesterday’s stays as it was: not done (never deleted)')

  // 21:00: tap what you did
  await tick('21:00')
  assert.equal(evenings().length, 1)
  const e = evenings()[0]
  show(e)
  assert.match(e.text, /^🌙 <b>Tap what you did today<\/b> <i>\(0\/1 so far\)<\/i>\n☐ Physics homework\n\n<i>Anything not ticked moves to tomorrow by itself\.<\/i>$/)
  assert.match(buttons(e)[0].callback_data, /^tdy:eb1:/)
  assert.equal((await q(`select count(*)::int n from telegram_pending`))[0].n, 0, 'no ✅ card: it only moves his plan')
  await tapOn(e, /Physics homework/)
  assert.match(latest(e.message_id).text, /^🌙 <b>All 1 done today\.<\/b> 👏\n✅ Physics homework/)
  assert.equal((await q(`select status from tasks where id = $1`, [hw.id]))[0].status, 'completed')
  await tick('21:30')
  assert.equal(evenings().length, 1, 'once')
  chat.noSurprises()
})

test('quiet hours: nothing before the morning message, nothing late; the evening message still comes at its own time', { skip }, async () => {
  await setPlanning({ ...BASE, quietFrom: '20:30' })
  await schoolDay()
  await tick('05:00'); await tick('06:30'); await tick('07:25')
  assert.equal(chat.tg.sent().length, 0)
  await tick('07:30')
  assert.equal(mornings().length, 1)
  await tick('21:00')
  assert.equal(evenings().length, 1, 'its own time, even after quietFrom')
  const before = chat.tg.sent().length
  await tick('22:05'); await tick('23:30')
  assert.equal(chat.tg.sent().length, before, 'nothing late')
  chat.noSurprises()
})

test('/today and /brief: the same list with taps; "+N more" → /today all; /brief full is the old whole-day brief', { skip }, async () => {
  await setPlanning(BASE)
  for (let i = 1; i <= 7; i++) await add('tasks', { title: `Must-do ${i}`, status: 'today', importance: 'must', due_at: `${today()}T12:00:00Z`, duration_minutes: 15 })
  await chat.nat('/today')
  const m = chat.tg.sent().at(-1)
  show(m)
  assert.equal(buttons(m).length, 5, 'at most 5')
  assert.match(m.text, /<i>\+2 more · \/today all<\/i>$/)
  await chat.nat('/today all')
  assert.match(chat.tg.sent().at(-1).text, /<b>Also on the list<\/b> \(2\)\n• Must-do \d/)
  await setPlanning({ ...BASE, todayItems: 3 })
  await chat.nat('/brief')
  const b = chat.tg.sent().at(-1)
  assert.equal(buttons(b).length, 3, 'his setting (3–5) applies straight away')
  assert.match(b.text, /<i>\+4 more · \/today all<\/i>$/)
  await chat.nat('/brief full')
  assert.match(chat.tg.sent().at(-1).text, /📋 <b>Your day<\/b>/)
  chat.noSurprises()
})

test('before supabase/today.sql: Today still works with plain plan blocks; a tap still completes a task; one note says to run it', { skip }, async () => {
  const reload = async (want) => {
    await q(`notify pgrst, 'reload schema'`)
    const sb = await session()
    for (let i = 0; i < 40; i++) {
      const { error } = await sb.from('plan_blocks').select('pick_key').limit(1)
      if (!!error === want) return
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error('PostgREST did not reload its schema')
  }
  const COLS = ['source', 'pick_key', 'open_text', 'open_url', 'topic_id', 'programme_item_id', 'rolled_from', 'why', 'done_hint', 'done_effect']
  for (const c of COLS) await q(`alter table plan_blocks rename column ${c} to ${c}_off`)
  try {
    await reload(true)
    await setPlanning(BASE)
    const { hw } = await schoolDay()
    await tick('07:30')
    assert.equal(mornings().length, 1)
    const m = mornings()[0]
    show(m)
    assert.match(m.text, /Physics homework: waves worksheet/)
    const rows = await q(`select plan_id, task_id, title from plan_blocks where on_date = $1`, [today()])
    const id = await autoPlanId(today())
    assert.ok(rows.some((r) => r.task_id === hw.id))
    assert.ok(rows.every((r) => r.plan_id === id), 'Today’s blocks, found by their plan id')
    const note = chat.tg.sent().filter((x) => /supabase\/today\.sql/.test(x.text))
    assert.equal(note.length, 1, 'one note to run today.sql')
    await tapOn(m, /Physics homework/)
    assert.equal((await q(`select status from tasks where id = $1`, [hw.id]))[0].status, 'completed')
    assert.match(buttons(latest(m.message_id)).find((b) => /Physics/.test(b.text)).text, /^✅/)
    await tapOn(m, /Physics homework/)
    assert.equal((await q(`select status from tasks where id = $1`, [hw.id]))[0].status, 'today', 'put back on his Today list')
    await tick('07:35')
    assert.equal(chat.tg.sent().filter((x) => /supabase\/today\.sql/.test(x.text)).length, 1, 'said once')
    chat.noSurprises()
  } finally {
    for (const c of COLS) await q(`alter table plan_blocks rename column ${c}_off to ${c}`)
    await reload(false)
  }
})

// ---- review fixes (pr/5) ----

test('fix 2: a plan he applies after ticking one item replaces the rest of the list (his plan + what he already ticked)', { skip }, async () => {
  await setPlanning(BASE)
  await savedList(today(), [
    { start_time: '16:10', end_time: '16:40', title: 'Saved item A', pick_key: 'x:a', done_hint: { kind: 'block' }, status: 'done' },
    { start_time: '17:00', end_time: '17:30', title: 'Saved item B', pick_key: 'x:b', done_hint: { kind: 'block' } },
  ])
  // "plan my day" ✅: the open blocks become 'replaced' (lib/telegram/dayplan.ts applyPlan), his own are added
  await q(`update plan_blocks set status = 'replaced' where on_date = $1 and status = 'planned'`, [today()])
  await add('plan_blocks', { plan_id: randomUUID(), on_date: today(), start_time: '18:00', end_time: '18:45', title: 'His own plan: maths', kind: 'focus' })
  await chat.nat('/today')
  const m = chat.tg.sent().at(-1)
  show(m)
  assert.match(m.text, /His own plan: maths/)
  assert.match(m.text, /✅ <s>16:10 📚 Saved item A/, 'what he ticked stays, ticked')
  assert.doesNotMatch(m.text, /Saved item B/)
  chat.noSurprises()
})

test('fix 3: a tap says what it wants (done / not done): a double tap or an old message never flips it back; a tick still saving can’t be unticked', { skip }, async () => {
  await setPlanning(BASE)
  const task = await add('tasks', { title: 'Chemistry form', status: 'this_week', importance: 'must', due_at: `${today()}T12:00:00Z`, duration_minutes: 10 })
  const [b] = await savedList(today(), [{ start_time: '16:10', end_time: '16:20', title: task.title, task_id: task.id, pick_key: `task:${task.id}`, kind: 'light', done_hint: { kind: 'task', taskId: task.id } }])
  await chat.nat('/today')
  const m = chat.tg.sent().at(-1)
  const data = buttons(m)[0].callback_data
  assert.equal(data, `tdy:mb1:${b.id}`)
  await chat.tap(data, m.message_id)
  await chat.tap(data, m.message_id)   // the same (now stale) button again
  assert.equal((await q(`select status from plan_blocks where id = $1`, [b.id]))[0].status, 'done', 'still done')
  assert.equal((await q(`select status from tasks where id = $1`, [task.id]))[0].status, 'completed')
  await chat.tap(`tdy:mb0:${b.id}`, m.message_id)
  assert.equal((await q(`select status from tasks where id = $1`, [task.id]))[0].status, 'this_week', 'unticked: back where it was')
  // a button from a message sent before this fix (no state in it) still toggles
  await chat.tap(`tdy:mb:${b.id}`, m.message_id)
  assert.equal((await q(`select status from plan_blocks where id = $1`, [b.id]))[0].status, 'done')
  // a tick that's still being saved (another tap is half-way) can't be unticked: it says so, nothing changes
  await q(`update plan_blocks set done_effect = '{"pending": true}' where id = $1`, [b.id])
  await chat.tap(`tdy:mb0:${b.id}`, m.message_id)
  assert.match(chat.tg.sent().at(-1).text, /Still saving that tick: try again in a moment/)
  assert.equal((await q(`select status from plan_blocks where id = $1`, [b.id]))[0].status, 'done')
  chat.noSurprises()
})

test('fix 4: unticking says honestly when what the tick changed was changed again since (it stays)', { skip }, async () => {
  await setPlanning(BASE)
  const fm = await subject('Further Maths')
  const topic = await add('topics', { subject_id: fm, name: 'Matrices', code: 'PC1-01', status: 'not_secure', step: 2, last_done: day(-5) })
  const [b] = await savedList(today(), [{ start_time: '17:00', end_time: '17:40', title: 'PC1-01 Matrices: exam questions', pick_key: `topic:${topic.id}:fix`, topic_id: topic.id, done_hint: { kind: 'topic', topicId: topic.id, step: 4 } }])
  await chat.nat('/today')
  const m = chat.tg.sent().at(-1)
  await tapOn(m, /Matrices/)
  // he reports more work on it by message: step 5 now
  await q(`update topics set step = 5 where id = $1`, [topic.id])
  await tapOn(m, /Matrices/)
  assert.match(chat.tg.sent().at(-1).text, /^↩️ Unticked; Matrices was changed since, so it stays as it is\.$/)
  const tp = (await q(`select step, last_done::text from topics where id = $1`, [topic.id]))[0]
  assert.deepEqual([tp.step, tp.last_done], [5, today()], 'his later change kept')
  assert.equal((await q(`select status from plan_blocks where id = $1`, [b.id]))[0].status, 'planned')
  chat.noSurprises()
})

test('fix 5 (chat): yesterday’s untouched item is back on today’s list, straight after homework', { skip }, async () => {
  await setPlanning(BASE)
  const fm = await subject('Further Maths')
  const topic = await add('topics', { subject_id: fm, name: 'Logarithms', code: 'Y1-07', status: 'not_secure', step: 3 })
  await savedList(day(-1), [{ start_time: '17:00', end_time: '17:30', title: 'Y1-07 Logarithms: review', pick_key: `topic:${topic.id}:review`, topic_id: topic.id, open_text: 'Bicen Pure → AS: Logs, Q1–4', why: 'due review', done_hint: { kind: 'topic', topicId: topic.id } }])
  await tick('07:30')
  const m = mornings()[0]
  show(m)
  assert.match(m.text, /Y1-07 Logarithms: review[^\n]*\n {5}↳ Bicen Pure → AS: Logs, Q1–4/)
  const row = (await q(`select rolled_from::text, why from plan_blocks where on_date = $1 and pick_key = $2`, [today(), `topic:${topic.id}:review`]))[0]
  assert.equal(row.rolled_from, day(-1))
  assert.match(row.why, /^from yesterday · due review$/)
  chat.noSurprises()
})

test('fix 7: "what next?" is the first thing on Today not done yet, exactly what to open', { skip }, async () => {
  await setPlanning(BASE)
  await savedList(today(), [
    { start_time: '16:10', end_time: '16:40', title: 'First thing', pick_key: 'x:1', open_text: 'Book 1, ex 3A', status: 'done', done_hint: { kind: 'block' } },
    { start_time: '17:00', end_time: '17:30', title: 'Second thing', pick_key: 'x:2', open_text: 'Bicen Pure → AS: Logs', done_hint: { kind: 'block' } },
    { start_time: '18:00', end_time: '18:30', title: 'Third thing', pick_key: 'x:3', open_text: 'PMT topic 3', done_hint: { kind: 'block' } },
  ])
  await chat.nat('what next?')
  const m = chat.tg.sent().at(-1)
  show(m)
  assert.match(m.text, /^👉 <b>17:00 Second thing<\/b> · 30 min\n📖 Bicen Pure → AS: Logs/)
  assert.match(m.text, /Then: 18:00 Third thing/)
  chat.noSurprises()
})

test('fix 11 + 13: score questions escape his titles; a task with no time today goes back to its own column when unticked', { skip }, async () => {
  await setPlanning(BASE)
  const fm = await subject('Further Maths')
  const g = await add('goals', { title: 'FM <HT2> & mock', period: 'month', kind: 'test', target_date: day(20), subject_id: fm })
  await savedList(today(), [{ start_time: '17:00', end_time: '17:30', title: 'Diagnostic', pick_key: `test:${g.id}:diagnostic`, goal_id: g.id, done_hint: { kind: 'attempt', goalId: g.id, what: 'diagnostic' } }])
  await chat.nat('/today')
  await tapOn(chat.tg.sent().at(-1), /Diagnostic/)
  assert.match(chat.tg.sent().at(-1).text, /How did the FM &lt;HT2&gt; &amp; mock diagnostic go\?/)
  const t = await add('tasks', { title: 'Sign the form', status: 'this_week', importance: 'must', due_at: `${today()}T12:00:00Z`, duration_minutes: 10 })
  await chat.tap(`tdy:mt1:${t.id}`, 1)
  assert.equal((await q(`select status from tasks where id = $1`, [t.id]))[0].status, 'completed')
  await chat.tap(`tdy:mt0:${t.id}`, 1)
  assert.equal((await q(`select status from tasks where id = $1`, [t.id]))[0].status, 'this_week', 'not "today": where it was')
  chat.noSurprises()
})

test('fix 12: when the morning message and Home save at once, the loser waits for the winner’s list', { skip }, async () => {
  await setPlanning(BASE)
  await schoolDay()
  const sb = await session()
  const { loadToday } = await import('../lib/today/load.ts')
  // the other run has claimed the save and writes its list a moment later
  await q(`insert into telegram_sent (user_id, key) values ($1, $2)`, [chat.users.owner, `today:${today()}`])
  const plan = await autoPlanId(today())
  setTimeout(() => { add('plan_blocks', { plan_id: plan, on_date: today(), start_time: '18:00', end_time: '18:30', title: 'The winner’s item', kind: 'focus', source: 'auto', pick_key: 'x:w' }).catch(() => null) }, 150)
  const t = await loadToday(sb, { save: true })
  assert.equal(t.plan.source, 'auto')
  assert.ok(t.plan.items.some((i) => i.title === 'The winner’s item'))
})
