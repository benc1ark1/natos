// Fix round part D (views) on the TEST database, his real autumn (tests/support/nat-real.mjs; clock: Wed 21 Oct 2026,
// the ACT week of half-term). 18: /today is a numbered list with minutes (no clock time on study; training keeps its
// time). 19: /week reads the next 7 days' planned study and training blocks and shows them among the bookings.
// No AI is called (chat.noSurprises()).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/fixround-d-chat.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { useChat } from './support/chat.mjs'
import { NEXT, PLANNING, THIS, TODAY, day } from './support/nat-real.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}`) }

before(async () => {
  if (skip) return
  const { setClock } = await import('./support/clock.mjs')
  const { zonedToUTC } = await import('../lib/time.ts')
  setClock(zonedToUTC(TODAY, '08:00'))
})
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })

async function world() {
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15', repeat_from: '2026-09-01', is_school: true })
  await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', repeat_from: '2026-09-01', training_type: 'football', load: 'hard' })
  // his planning, without the training rules a test here doesn't need (no training suggested on top of the blocks)
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify({ holidays: PLANNING.holidays, noTrainingDays: 'monday, tuesday, wednesday, thursday, friday, saturday, sunday' })])
}
const block = (plan_id, on_date, start_time, end_time, title, extra = {}) => add('plan_blocks', { plan_id, on_date, start_time, end_time, title, kind: 'focus', status: 'planned', ...extra })

test('19 · /week from Wed 21 Oct: the week’s planned ACT, FM and Vlad blocks and training show on their days (7 days only, nothing replaced)', { skip }, async () => {
  await world()
  const week = randomUUID()
  await block(week, day(THIS, 3), '10:00', '10:40', 'ACT reading: timed passages')
  await block(week, day(THIS, 3), '13:00', '13:30', 'ACT maths: old plan', { status: 'replaced' })
  await block(week, day(THIS, 4), '12:30', '13:30', 'Upper @ PureGym', { kind: 'training' })
  await block(week, day(THIS, 4), '15:00', '15:30', 'Rest', { kind: 'rest' })
  await block(week, NEXT, '10:00', '11:00', 'FM homework: complex numbers ex 2B')
  await block(week, day(NEXT, 1), '09:30', '10:30', 'Vlad: mechanics questions')
  await block(week, day(NEXT, 2), '11:00', '12:00', 'Speed @ Owen', { kind: 'training' })   // Wed 28 Oct: past the 7 days
  await nat('/week')
  const t = chat.last().text
  show({ text: t })
  assert.match(t, /<b>Thu 22 Oct<\/b>\n {2}📚 ACT reading: timed passages <i>· 40m<\/i>/)
  assert.match(t, /<b>Fri 23 Oct<\/b>\n {2}🏋️ 12:30–13:30 Upper @ PureGym/)
  assert.match(t, /<b>Mon 26 Oct<\/b>\n {2}📚 FM homework: complex numbers ex 2B <i>· 1h<\/i>\n {2}19:00–20:30 Football training/)
  assert.match(t, /<b>Tue 27 Oct<\/b>\n {2}📚 Vlad: mechanics questions <i>· 1h<\/i>/)
  assert.doesNotMatch(t, /old plan|Rest|Speed @ Owen/, 'replaced, rest and after-the-week blocks are not shown')
  assert.doesNotMatch(t, /🏫 School/, 'half-term: no school')
  chat.noSurprises()
})

test('18 · /today on Wed 21 Oct: a numbered list with minutes, no clock times on study; football keeps 19:00 on the fixed line', { skip }, async () => {
  await world()
  const { autoPlanId } = await import('../lib/today/data.ts')
  const plan = await autoPlanId(TODAY)
  await block(plan, TODAY, '10:00', '10:40', 'ACT reading passage set', { source: 'auto' })
  await block(plan, TODAY, '11:00', '11:30', 'ACT grammar: punctuation drill', { source: 'auto', kind: 'light' })
  await nat('/today')
  const m = chat.tg.sent().filter((x) => x.text.startsWith('📌 <b>Today')).at(-1)
  show(m)
  assert.match(m.text, /<i>⚽ Football training 19:00<\/i>/)
  assert.match(m.text, /\n1\. 📚 ACT reading passage set <i>· 40m<\/i>\n(?: {5}↳.*\n)?2\. 📚 ACT grammar: punctuation drill <i>· 30m<\/i>/)
  assert.doesNotMatch(m.text, /10:00|11:00/, 'no clock time on study')
  const texts = (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text)
  assert.deepEqual(texts.slice(0, 2), ['☐ ACT reading passage set', '☐ ACT grammar: punctuation drill'])
  chat.noSurprises()
})

// Item 18 (follow-up): only FIXED things show a time. His half-term set time (speed Wed 11:00) keeps its clock time and
// leave-by line; a session the planner placed itself (upper 12:30, from his applied week) shows its minutes like study.
async function worldWithTimes() {
  await world()
  await q(`update profiles set planning = planning || $2::jsonb where user_id = $1`, [chat.users.owner, JSON.stringify({
    owenDays: PLANNING.owenDays, sessionTimes: PLANNING.sessionTimes, holidayOwenDays: PLANNING.holidayOwenDays, holidaySessionTimes: PLANNING.holidaySessionTimes })])
}

test('18 · /today and "what next?" on Wed 21 Oct: the planner’s upper 12:30 has its minutes, no clock time and no leave-by line', { skip }, async () => {
  await worldWithTimes()
  const { autoPlanId } = await import('../lib/today/data.ts')
  await block(autoPlanId(TODAY), TODAY, '10:00', '10:40', 'ACT reading passage set', { source: 'auto' })
  await block(randomUUID(), TODAY, '12:30', '13:30', 'Upper @ PureGym', { kind: 'training' })   // his applied week: the planner chose 12:30
  await nat('/today')
  const m = chat.tg.sent().filter((x) => x.text.startsWith('📌 <b>Today')).at(-1)
  show(m)
  assert.match(m.text, /\n1\. 📚 ACT reading passage set <i>· 40m<\/i>\n(?: {5}↳.*\n)?2\. 🏋️ Upper @ PureGym <i>· 1h<\/i>/)
  assert.doesNotMatch(m.text, /12:30|leave/, 'no clock time and no leave-by line for a session the planner placed')
  const texts = (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text)
  assert.deepEqual(texts.slice(0, 2), ['☐ ACT reading passage set', '☐ Upper @ PureGym'])
  await nat('what next?')
  const next = chat.last().text
  show({ text: next })
  assert.match(next, /👉 <b>ACT reading passage set<\/b>/)
  assert.match(next, /Then: Upper @ PureGym/)
  assert.doesNotMatch(next, /12:30/)
  chat.noSurprises()
})

test('18 · /today and "what next?" on Wed 21 Oct: Owen’s speed at his half-term time 11:00 keeps its clock time and leave-by line', { skip }, async () => {
  await worldWithTimes()
  await block(randomUUID(), TODAY, '11:00', '12:00', 'Speed + circuits @ Owen', { kind: 'training' })
  await nat('/today')
  const m = chat.tg.sent().filter((x) => x.text.startsWith('📌 <b>Today')).at(-1)
  show(m)
  assert.match(m.text, /\n1\. <b>11:00<\/b> 🏋️ Speed \+ circuits @ Owen <i>· 1h<\/i>\n {5}↳ leave \d\d:\d\d/)
  assert.ok((m.reply_markup?.inline_keyboard ?? []).flat().some((b) => b.text === '☐ 11:00 Speed + circuits @ Owen'))
  await nat('what next?')
  assert.match(chat.last().text, /👉 <b>11:00 Speed \+ circuits @ Owen<\/b>/)
  chat.noSurprises()
})
