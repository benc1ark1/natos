// Fix round, part C (the bot conversation), on the TEST database with Nat's real autumn (tests/support/nat-real.mjs):
// half-term 17 Oct – 1 Nov, ACT Sun 25 Oct, school back Mon 2 Nov. Clock: Wed 21 Oct 18:00 (THIS week, the ACT week).
// 10: while the Your week card waits, a calendar change, a task change or "plan next week" is its own message (the card
//     re-fits after the change's ✅, without the AI) · 11: a tap that reaches the bot late (next to "/app") applies
//     nothing · 13: "Owen speed Wed 28 Oct 11:00" keeps Wed 28 Oct · 14: "Upper · PureGym" as the event's title.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/fixround-c-chat.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'
import { NEXT, PLANNING, THIS, TODAY, day } from './support/nat-real.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const act = (o) => ({ op: 'event_move', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const refIn = (body, name) => body.messages[0].content.map((c) => c.text).join('\n').match(new RegExp(`([TMPWGE]\\d+) \\| (?:TEST: |goal: )?${name} \\|`))?.[1]
const tapOn = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const cards = () => q(`select id, status, text, payload->'week'->>'from' as week from telegram_pending where kind = 'plan' order by created_at`)
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}`) }

before(async () => {
  if (skip) return
  const { setClock } = await import('./support/clock.mjs')
  const { zonedToUTC } = await import('../lib/time.ts')
  setClock(zonedToUTC(TODAY, '18:00'))
})
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })

/** His set-up (holidays, Owen's days, upper 3× until 1 Nov, the ACT focus), Owen's speed session (term: Tue 18:30) and the
 *  ACT retake; then "plan my week" → the Your week card for THIS week (Wed 21 – Sun 25 Oct), waiting for ✅. */
async function weekCardWaiting() {
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify(PLANNING)])
  const owen = await add('events', { title: 'Owen speed', repeat_days: [2], start_time: '18:30', end_time: '19:30', repeat_from: '2026-09-01', training_type: 'sprint', load: 'hard' })
  const actSubject = await add('subjects', { name: 'ACT' })
  await add('goals', { title: 'ACT retake', kind: 'test', test_kind: 'act', target_date: '2026-10-25', subject_id: actSubject.id })
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning your week.', plan_week: true }))
  chat.ai.script(PLAN, { days: [], note: '', push_back: '' })
  await nat('plan my week')
  const card = last()
  show(card)
  assert.match(card.text, /🗓 <b>Your week<\/b>/)
  assert.ok(chat.button(card, 'Apply'))
  return { owen, card }
}

test('10: "Owen speed is Wed 28 Oct 11:00 next week" while the week card waits: its own change card (no re-plan of the week card, no AI planning); after ✅ the week card re-fits without the AI', { skip }, async () => {
  const { owen } = await weekCardWaiting()
  const [first] = await cards()
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Moving Owen’s session.', actions: [act({ ref: refIn(body, 'Owen speed') ?? '', date_to: day(NEXT, 2), time: '11:00', words: 'Wed 28 Oct 11:00' })] }))
  await nat('Owen speed is Wed 28 Oct 11:00 next week')
  show(last())
  assert.match(last().text, /Owen speed<\/b>: Tue 27 Oct 18:30–19:30 → Wed 28 Oct 11:00–12:00 <i>\(just this week\)/)
  assert.deepEqual((await cards()).map((c) => [c.id, c.status]), [[first.id, 'open']], 'the week card is untouched (not re-planned with his words)')
  assert.equal(chat.ai.byModel(PLAN).length, 1, 'no second AI plan')
  await tapOn('Apply')
  const [ex] = await q(`select on_date::text, new_date::text, new_start::text from event_exceptions where event_id = $1`, [owen.id])
  assert.deepEqual(ex, { on_date: '2026-10-27', new_date: '2026-10-28', new_start: '11:00:00' })
  // the waiting week card is sent again, re-fitted around the change (no AI call)
  const after = await cards()
  assert.deepEqual(after.map((c) => c.status), ['replaced', 'open'])
  assert.match(after[1].text, /with that change/)
  assert.match(last().text, /🔄 <b>Your week, re-planned with that change<\/b>/)
  chat.noSurprises()
})

test('10: a task change the AI first reads into the week card ("Chemistry corrections are due Friday") is read again on its own: a change card; the week card stays', { skip }, async () => {
  await weekCardWaiting()
  const chem = await add('tasks', { title: 'Chemistry corrections', status: 'this_week', importance: 'must', due_at: '2026-10-16T22:59:00Z' })
  const [first] = await cards()
  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Chemistry corrections due Friday' }))
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content.map((c) => c.text).join('\n'), /<open_card>\(none\)<\/open_card>/, 'read without the card')
    return brain({ intent: 'instruction', reply: 'Moving the due date.', actions: [act({ op: 'due', ref: refIn(body, 'Chemistry corrections') ?? '', date: day(THIS, 4), words: 'Friday' })] })
  })
  await nat('Chemistry corrections are due Friday')
  show(last())
  assert.match(last().text, /Chemistry corrections/)
  assert.match(last().text, /due Fri 23 Oct/)
  assert.deepEqual((await cards()).map((c) => [c.id, c.status]), [[first.id, 'open']], 'the week card is untouched')
  await tapOn('Apply')
  assert.equal((await q(`select (due_at at time zone 'Europe/London')::date::text d from tasks where id = $1`, [chem.id]))[0].d, '2026-10-23')
  chat.noSurprises()
})

test('10: "plan next week" while this week’s card waits is a new plan, not a change to this week’s card (that one stays waiting)', { skip }, async () => {
  await weekCardWaiting()
  const [first] = await cards()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning next week.', plan_week: true }))
  chat.ai.script(PLAN, { days: [], note: '', push_back: '' })
  await nat('plan next week')
  const all = await cards()
  assert.equal(all.find((c) => c.id === first.id).status, 'open', 'this week’s card isn’t replaced')
  assert.equal(all.length, 2)
  assert.doesNotMatch(last().text, /✏️ <b>Changed<\/b>/, 'a new card, not “this card, changed”')
  chat.noSurprises()
})

test('10: a real change to the plan ("upper Sat at PureGym") still changes the waiting card', { skip }, async () => {
  await weekCardWaiting()
  const [first] = await cards()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Moving upper.', plan_week: true, plan_training: '' }))
  await nat('upper Sat at PureGym')
  const all = await cards()
  assert.equal(all.find((c) => c.id === first.id).status, 'replaced')
  assert.match(last().text, /✏️ <b>Changed<\/b>/)
})

test('11: "/app" while the week card waits, then a ✅ tap that reaches the bot late (Telegram held it): nothing is applied; a fresh tap applies it', { skip }, async () => {
  const { card } = await weekCardWaiting()
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'natos.example.app'
  try { await nat('/app') } finally { delete process.env.VERCEL_PROJECT_PRODUCTION_URL }
  assert.match(last().text, /Your dashboard, inside Telegram/)
  assert.equal((await cards())[0].status, 'open', '/app touches no card')
  // Telegram hands over a tap made long ago: it can't be answered any more ("query is too old")
  chat.tg.failNext('answerCallbackQuery', 'Bad Request: query is too old and response timeout expired or query ID is invalid')
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  assert.match(last().text, /reached me late/)
  assert.doesNotMatch(chat.tg.sent().map((m) => m.text).join('\n'), /Your week is set/)
  assert.equal((await cards())[0].status, 'open', 'still waiting for his ✅')
  assert.equal((await q(`select count(*)::int n from plan_blocks`))[0].n, 0, 'nothing applied')
  // his own tap now
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  assert.match(chat.tg.sent().map((m) => m.text).join('\n'), /✅ <b>Your week is set<\/b>/)
  assert.equal((await cards())[0].status, 'saved')
})

test('13: "Owen speed is Wed 28 Oct 11:00 this time" as a new item: the card and the save keep Wed 28 Oct (not Tue 27 Oct), with no “removed a date”', { skip }, async () => {
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify(PLANNING)])
  const owen = await add('events', { title: 'Owen speed', repeat_days: [2], start_time: '18:30', end_time: '19:30', repeat_from: '2026-09-01' })
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Owen speed is Wed 28 Oct 11:00 this time' }))
  chat.ai.script(SORT, sorted({ kind: 'event_change', title: 'Owen speed', event: 'Owen speed', new_date: day(NEXT, 2), new_start: '11:00', date_words: 'Wednesday 28 October' }))
  await nat('Owen speed is Wed 28 Oct 11:00 this time')
  const card = last()
  show(card)
  assert.match(card.text, /Owen speed on Tue 27 Oct → Wed 28 Oct 11:00–12:00/)
  assert.doesNotMatch(card.text, /Removed a date/)
  await chat.tap(chat.button(card, 'Save'), card.message_id)
  const [ex] = await q(`select on_date::text, new_date::text, new_start::text from event_exceptions where event_id = $1`, [owen.id])
  assert.deepEqual(ex, { on_date: '2026-10-27', new_date: '2026-10-28', new_start: '11:00:00' })
  chat.noSurprises()
})

test('14: an extra upper in half-term (Fri 30 Oct): the event and its line say “Upper · PureGym”, never “Upper (PureGym Swiss Cottage; type=upper)”', { skip }, async () => {
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify(PLANNING)])
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Adding it.', actions: [act({ op: 'event_new', value: 'Upper (PureGym Swiss Cottage; type=upper)', date: day(NEXT, 4), time: '15:00', time_to: '16:30', words: 'on the 30th, 3 till half 4' })] }))
  await nat('fit an extra upper in at PureGym on the 30th, 3 till half 4 (the AI reads this one)')
  show(last())
  assert.match(last().text, /📅 New: <b>Upper · PureGym<\/b> Fri 30 Oct 15:00–16:30 · Upper/)
  assert.doesNotMatch(last().text, /type=/)
  await tapOn('Apply')
  const [e] = await q(`select title, training_type from events where title like 'Upper%'`)
  assert.deepEqual(e, { title: 'Upper · PureGym', training_type: 'upper' })
})

// ---------------------------------------------------------------------------
// Second pass (review): 13 on the instruction path; 10 when the AI labels a record change 'plan'
// ---------------------------------------------------------------------------

test('13 + 10: "Owen moved to Wed 28 Oct 11:00" while the week card waits, the AI first calling it a plan, then sending date "" and no date_to: its own card, Wed 28 Oct kept (not Tue 27 Oct)', { skip }, async () => {
  const { owen } = await weekCardWaiting()
  const [first] = await cards()
  // with the card: the AI (told changes while a plan card is open are 'plan') calls it a plan
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Re-planning your week.', plan_week: true }))
  // read again without the card: an instruction, the date only in his words (Nat's case, 21 Oct)
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content.map((c) => c.text).join('\n'), /<open_card>\(none\)<\/open_card>/, 'read without the card')
    return brain({ intent: 'instruction', reply: 'Moving Owen’s session.', actions: [act({ ref: refIn(body, 'Owen speed') ?? '', date: '', date_to: '', time: '11:00', words: 'Wednesday 28 October 11:00' })] })
  })
  await nat('Owen moved to Wed 28 Oct 11:00')
  show(last())
  assert.match(last().text, /Owen speed<\/b>: Tue 27 Oct 18:30–19:30 → Wed 28 Oct 11:00–12:00 <i>\(just this week\)/)
  assert.doesNotMatch(chat.tg.sent().map((m) => m.text).join('\n'), /wasn’t in your words/)
  assert.deepEqual((await cards()).map((c) => [c.id, c.status]), [[first.id, 'open']], 'the week card is untouched')
  assert.equal(chat.ai.byModel(PLAN).length, 1, 'no second AI plan')
  await tapOn('Apply')
  const [ex] = await q(`select on_date::text, new_date::text, new_start::text from event_exceptions where event_id = $1`, [owen.id])
  assert.deepEqual(ex, { on_date: '2026-10-27', new_date: '2026-10-28', new_start: '11:00:00' })
  chat.noSurprises()
})

test('13: the AI sends the usual day (Tue 27 Oct) as date and date_to: the date he gave (Wed 28 Oct) is kept', { skip }, async () => {
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify(PLANNING)])
  const owen = await add('events', { title: 'Owen speed', repeat_days: [2], start_time: '18:30', end_time: '19:30', repeat_from: '2026-09-01' })
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Moving it.', actions: [act({ ref: refIn(body, 'Owen speed') ?? '', date: day(NEXT, 1), date_to: day(NEXT, 1), time: '11:00', words: 'Wednesday 28th' })] }))
  await nat('Owen speed is Wed 28 Oct 11:00 this time')
  show(last())
  assert.match(last().text, /Owen speed<\/b>: Tue 27 Oct 18:30–19:30 → Wed 28 Oct 11:00–12:00/)
  await tapOn('Apply')
  const [ex] = await q(`select on_date::text, new_date::text from event_exceptions where event_id = $1`, [owen.id])
  assert.deepEqual(ex, { on_date: '2026-10-27', new_date: '2026-10-28' })
  chat.noSurprises()
})

test('10: "add physics homework due Friday" while the week card waits, the AI calling it a plan: read again on its own, a new task card; the week card stays', { skip }, async () => {
  await weekCardWaiting()
  const [first] = await cards()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Adding it to your week.', plan_week: true }))
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content.map((c) => c.text).join('\n'), /<open_card>\(none\)<\/open_card>/, 'read without the card')
    return brain({ intent: 'new', item_text: 'physics homework due Friday', item_kind: 'task' })
  })
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Physics homework', subject: 'Physics', due_date: day(THIS, 4), date_words: 'Friday' }))
  await nat('add physics homework due Friday')
  show(last())
  assert.match(last().text, /Physics homework/)
  assert.match(last().text, /Fri 23 Oct/)
  assert.ok(chat.button(last(), 'Save'))
  assert.deepEqual((await cards()).map((c) => [c.id, c.status]), [[first.id, 'open']], 'the week card is untouched')
  assert.equal(chat.ai.byModel(PLAN).length, 1, 'no second AI plan')
  chat.noSurprises()
})

test('10: "move upper on Friday to Saturday" (an edit OF the week card) still changes the waiting card', { skip }, async () => {
  await weekCardWaiting()
  const [first] = await cards()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Moving upper.', plan_week: true, plan_training: '' }))
  await nat('move upper on Friday to Saturday')
  const all = await cards()
  assert.equal(all.find((c) => c.id === first.id).status, 'replaced')
  assert.match(last().text, /✏️ <b>Changed<\/b>/)
})

// ---------------------------------------------------------------------------
// Third pass: a date and time for a session ON the card edits it (10); his message on more lines (13)
// ---------------------------------------------------------------------------

test('10 (third pass): "move upper to Sat 24 Oct 3pm" (upper is on the waiting week card; an Upper event is saved too) changes that card: no second week card, not read again', { skip }, async () => {
  await add('events', { title: 'Upper · PureGym', repeat_days: [6], start_time: '15:00', end_time: '16:30', repeat_from: '2026-09-01', training_type: 'upper' })
  await weekCardWaiting()
  const [first] = await cards()
  const [{ titles }] = await q(`select payload->'blocks' as titles from telegram_pending where id = $1`, [first.id])
  assert.ok(titles.some((b) => /upper/i.test(b.title)), 'upper is on the card')
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Moving upper.', plan_week: true, plan_training: '' }))
  await nat('move upper to Sat 24 Oct 3pm')
  const all = await cards()
  assert.equal(all.find((c) => c.id === first.id).status, 'replaced', 'the waiting card is the one changed')
  assert.equal(all.filter((c) => c.status === 'open').length, 1, 'one week card waiting, not two')
  assert.match(last().text, /✏️ <b>Changed<\/b>/)
  assert.equal(chat.ai.byModel(CHAT).length, 2, 'the AI read it once (not again without the card)')
})

test('13 (third pass): "Owen moved to Wed 28 Oct" + a new line + "11:00", the AI sending date "" and no date_to: Wed 28 Oct kept (not Tue 27 Oct)', { skip }, async () => {
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify(PLANNING)])
  const owen = await add('events', { title: 'Owen speed', repeat_days: [2], start_time: '18:30', end_time: '19:30', repeat_from: '2026-09-01' })
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Moving it.', actions: [act({ ref: refIn(body, 'Owen speed') ?? '', date: '', date_to: '', time: '11:00', words: 'Wednesday 28 October' })] }))
  await nat('Owen moved to Wed 28 Oct\n11:00')
  show(last())
  assert.match(last().text, /Owen speed<\/b>: Tue 27 Oct 18:30–19:30 → Wed 28 Oct 11:00–12:00/)
  await tapOn('Apply')
  const [ex] = await q(`select on_date::text, new_date::text from event_exceptions where event_id = $1`, [owen.id])
  assert.deepEqual(ex, { on_date: '2026-10-27', new_date: '2026-10-28' })
})
