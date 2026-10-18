// Jarvis phase D2: "ready for anything" on the TEST database, with a scripted brain and planner.
// The spec's examples: a change knocks on the week's plan (in the same card, each with a reason), a clash gives
// two options, plan my week, new homework gets a slot, ill moves the gym session, rules and types are data.
// Run: npm run test:chat. Days used: today+1 and today+2 (always inside the planned week).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const T = () => chat.time
const D = (n) => T().addDays(T().todayISO(), n)
const day = (iso) => `${T().dowShort(iso)} ${T().shortDate(iso)}`
const weekday = (iso) => T().longDate(iso).split(',')[0]
const act = (o) => ({ op: 'event_move', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const refIn = (body, name) => {
  const m = body.messages[0].content[0].text.match(new RegExp(`((?:TR|[TMPWGE])\\d+) \\| (?:TEST: |goal: )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.ok(m, `no ref for ${name}`)
  return m[1]
}
async function ask(text, changes) {
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: changes.map((c) => act({ ...c, ref: c.ref ? refIn(body, c.ref) : '' })) }))
  await nat(text)
}
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const block = (o) => q(`insert into plan_blocks (user_id, plan_id, on_date, start_time, end_time, title, kind, target_id) values ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7) returning id`,
  [chat.users.owner, o.date, o.start, o.end, o.title, o.kind ?? 'focus', o.target_id ?? null]).then((r) => r[0])

test('"Owen moved training to <day> this week" knocks on the plan: Lower moves off the day before (same card, with the reason)', { skip }, async () => {
  const lower = await add('weekly_targets', { name: 'Lower', target_count: 1, training_type: 'lower' })
  await add('events', { title: 'Owen training', repeat_days: [T().isoDow(D(0))], start_time: '06:00', end_time: '06:45', training_type: 'sprint' })
  const b = await block({ date: D(1), start: '16:10', end: '17:10', title: 'Lower', kind: 'training', target_id: lower.id })
  await ask(`Owen moved training to ${weekday(D(2))} 6pm this week`, [{ ref: 'Owen training', date: D(0), date_to: D(2), time: '18:00', words: `${weekday(D(2))} 6pm` }])
  const card = last().text
  assert.match(card, /↪️ <b>Knock-on in your plan<\/b>/)
  assert.match(card, new RegExp(`• Lower: ${day(D(1))} 16:10 → .*No Lower or plyo the day before`))
  assert.equal((await q(`select on_date::text d, status from plan_blocks where id = $1`, [b.id]))[0].d, D(1), 'nothing moves before ✅')
  await tap('Apply')
  assert.match(last().text, /moved in your plan/)
  const after = (await q(`select on_date::text d, status from plan_blocks where id = $1`, [b.id]))[0]
  assert.ok(after.d !== D(1) || after.status === 'cancelled', `Lower is off ${D(1)}: ${JSON.stringify(after)}`)
  await tap('Undo')
  assert.doesNotMatch(last().text, /Left as it is/)
  assert.deepEqual(await q(`select on_date::text d, start_time::text s, status from plan_blocks where id = $1`, [b.id]), [{ d: D(1), s: '16:10:00', status: 'planned' }])
  assert.equal((await q(`select count(*)::int n from event_exceptions where new_date is not null`))[0].n, 0, 'the Owen change is undone too')
})

test('a clash gives two options: 1️⃣ do it and cancel the other session that day, 2️⃣ the nearest free time', { skip }, async () => {
  await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30', training_type: 'football' })
  const owen = await add('events', { title: 'Owen training', repeat_days: [T().isoDow(D(2))], start_time: '18:00', end_time: '19:00', training_type: 'sprint' })
  await ask(`Owen moved to ${weekday(D(1))} 6pm this week`, [{ ref: 'Owen training', date: D(2), date_to: D(1), time: '18:00', words: `${weekday(D(1))} 6pm` }])
  const card = last()
  assert.match(card.text, /⚠️ <b>Clash<\/b>: 18:00–19:00 is on top of Football \(18:00–19:30\)/)
  assert.match(card.text, /1️⃣ Owen training at 18:00, and cancel Football that day/)
  assert.match(card.text, /2️⃣ Owen training at 16:50 instead/, 'the nearest free hour: 16:50 is closer to 18:00 than 19:40')
  assert.ok(chat.button(card, '1️⃣') && chat.button(card, '2️⃣'))
  await tap('2️⃣')
  assert.deepEqual(await q(`select new_date::text d, new_start::text s from event_exceptions where event_id = $1`, [owen.id]), [{ d: D(1), s: '16:50:00' }])
  assert.equal((await q(`select count(*)::int n from event_exceptions where cancelled`))[0].n, 0, 'football untouched with option 2')
})

test('clash option 1 cancels the other session that day; Undo puts both back', { skip }, async () => {
  const football = await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30' })
  const owen = await add('events', { title: 'Owen training', repeat_days: [T().isoDow(D(2))], start_time: '18:00', end_time: '19:00' })
  await ask(`Owen moved to ${weekday(D(1))} 6pm this week`, [{ ref: 'Owen training', date: D(2), date_to: D(1), time: '18:00', words: `${weekday(D(1))} 6pm` }])
  await tap('1️⃣')
  assert.deepEqual(await q(`select cancelled from event_exceptions where event_id = $1`, [football.id]), [{ cancelled: true }])
  assert.deepEqual(await q(`select new_date::text d from event_exceptions where event_id = $1`, [owen.id]), [{ d: D(1) }])
  await tap('Undo')
  assert.deepEqual(await q(`select cancelled from event_exceptions where event_id = $1`, [football.id]), [{ cancelled: false }])
  assert.deepEqual(await q(`select new_date from event_exceptions where event_id = $1`, [owen.id]), [{ new_date: null }])
})

test('a fixed session that now breaks a training rule is flagged (the app can’t move fixed sessions: he decides)', { skip }, async () => {
  await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30', training_type: 'football' })
  await add('events', { title: 'Owen training', repeat_days: [T().isoDow(D(2))], start_time: '07:00', end_time: '07:45', training_type: 'sprint' })
  await block({ date: D(2), start: '16:10', end: '17:00', title: 'Physics homework' })
  await ask(`Owen moved to ${weekday(D(1))} morning`, [{ ref: 'Owen training', date: D(2), date_to: D(1), time: '07:00', words: `${weekday(D(1))} morning` }])
  assert.match(last().text, /⚠️ Owen training and Football on .*: 2 hard sessions in a day \(At most one hard session a day/)
})

test('"plan my week": gym sessions placed by the rules (code), study by the planner, one card; Apply and Undo', { skip }, async () => {
  const { checkinRange } = await import('../lib/ask/week.ts')
  const first = checkinRange(T().todayISO()).from   // at the weekend, the coming Monday
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 1, training_type: 'upper' })
  await add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: `${T().addDays(first, 2)}T12:00:00Z`, duration_minutes: 45 })
  const old = await block({ date: first, start: '19:00', end: '19:30', title: 'Old plan' })
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning your week.', plan_week: true }))
  let sent = ''
  chat.ai.script(PLAN, (body) => {
    sent = JSON.stringify(body)
    const ref = refIn(body, 'Physics homework')
    return { days: [{ date: first, items: [{ ref, title: '', minutes: 45, kind: 'focus', focus: '', why: 'due soon' }, { ref: 'W1', title: '', minutes: 60, kind: 'training', focus: '', why: '' }] }], note: 'Physics first.', push_back: '' }
  })
  await nat('plan my week')
  assert.match(sent, /Training placed: (?:[^\n]*Upper @ [^\n]*\d\d:\d\d–\d\d:\d\d|none)/, 'the planner is told where training already is')
  // Build O: one "Your week" card; training from the optimiser (with places), study from the planner
  const card = last().text
  assert.match(card, /🗓 <b>Your week<\/b>/)
  assert.match(card, /🏋️ Upper @ /, 'the gym sessions, placed by code, with a place')
  assert.match(card, /📚 Physics homework/)
  const uppers = Number(card.match(/💪 <i>Upper (\d)× /)[1])
  assert.equal((card.match(/🏋️ Upper @ /g) ?? []).length, uppers, 'the planner’s own training item was ignored')
  await tap('Apply')
  const rows = await q(`select title, status, on_date::text d, target_id from plan_blocks order by created_at`)
  assert.equal(rows.find((r) => r.title === 'Old plan').status, 'replaced')
  assert.ok(rows.some((r) => /^Upper @ /.test(r.title) && r.target_id === upper.id && r.status === 'planned'))
  assert.ok(rows.some((r) => r.title === 'Physics homework' && r.d === first && r.status === 'planned'))
  await tap('Undo')
  assert.equal((await q(`select status from plan_blocks where id = $1`, [old.id]))[0].status, 'planned')
})

test('"Vlad set extra homework due <day>": after ✅, a slot before the deadline is offered and added to the plan', { skip }, async () => {
  const keep = await block({ date: D(1), start: '16:10', end: '17:00', title: 'Existing block' })
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: `Vlad gave extra homework due ${weekday(D(2))}` }))
  chat.ai.script(SORT, sorted({ title: 'Extra homework from Vlad', importance: 'must', due_date: D(2), date_words: weekday(D(2)), duration_minutes: 40, origin: 'tutor_maths_physics' }))
  await nat(`Vlad gave extra homework due ${weekday(D(2))}`)
  await tap('Save')
  assert.match(last().text, /➕ Fit <b>Extra homework from Vlad<\/b> into your plan: <b>.*\d\d:\d\d–\d\d:\d\d<\/b>\? <i>\(due /)
  await tap('Add')
  const rows = await q(`select title, status from plan_blocks order by created_at`)
  assert.deepEqual(rows.map((r) => `${r.title}:${r.status}`), ['Existing block:planned', 'Extra homework from Vlad:planned'], 'added, nothing replaced')
  assert.equal((await q(`select status from plan_blocks where id = $1`, [keep.id]))[0].status, 'planned')
})

test('"I\'m ill today": the gym session planned today moves to a day that keeps the rules (in the plan card)', { skip }, async (t) => {
  const nowMin = Number(T().timeOf(new Date()).slice(0, 2)) * 60 + Number(T().timeOf(new Date()).slice(3))
  if (nowMin > 21 * 60) return t.skip('too late in the day')
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 1, training_type: 'upper' })
  await add('tasks', { title: 'Tidy desk', status: 'today' })
  const b = await block({ date: D(0), start: '21:00', end: '21:30', title: 'Upper', kind: 'training', target_id: upper.id })
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Rest up.', plan_day: D(0), energy: 'ill' }))
  chat.ai.script(PLAN, (body) => ({ items: [{ ref: refIn(body, 'Tidy desk'), title: '', minutes: 15, kind: 'light', focus: '', why: '' }], note: 'Take it easy.', push_back: '' }))
  await nat('I’m ill today')
  assert.match(last().text, new RegExp(`• Upper: ${day(D(0))} 21:00 → `))
  await tap('Apply')
  const r = (await q(`select on_date::text d, status from plan_blocks where id = $1`, [b.id]))[0]
  assert.ok(r.d !== D(0) || r.status === 'cancelled', `Upper is off today: ${JSON.stringify(r)}`)
})

test('rules are data: "no plyo within a day of a match" is saved (with the defaults); Undo switches it off, never deletes', { skip }, async () => {
  await ask('no plyo within a day of a match', [{ op: 'rule_set', value: 'what=plyo; near=match; side=both; days=1; label=No plyo within 24 h of a match' }])
  assert.match(last().text, /📏 New rule: <b>No plyo within 24 h of a match<\/b>/)
  await tap('Apply')
  const rows = await q(`select label, enabled from training_rules order by sort_order, created_at`)
  assert.equal(rows.length, 5, 'the four defaults written down, plus the new rule')
  assert.ok(rows.some((r) => r.label === 'No plyo within 24 h of a match' && r.enabled))
  await tap('Undo')
  assert.deepEqual((await q(`select enabled from training_rules where label = 'No plyo within 24 h of a match'`)), [{ enabled: false }])
  // switching a default off
  await ask('switch off the double-day rule', [{ op: 'rule_off', ref: 'After a double-session day' }])
  await tap('Apply')
  assert.deepEqual(await q(`select enabled from training_rules where kind = 'after_double'`), [{ enabled: false }])
})

test('"Owen\'s sessions are sprints": the type is saved on the event (and undone)', { skip }, async () => {
  const owen = await add('events', { title: 'Coach session', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:00' })
  await ask('the coach sessions are sprints', [{ op: 'training_type', ref: 'Coach session', value: 'sprint hard' }])
  assert.match(last().text, /🏃 <b>Coach session<\/b>: not training → Sprint \(hard\)/)
  await tap('Apply')
  assert.deepEqual(await q(`select training_type, load from events where id = $1`, [owen.id]), [{ training_type: 'sprint', load: 'hard' }])
  await tap('Undo')
  assert.deepEqual(await q(`select training_type, load from events where id = $1`, [owen.id]), [{ training_type: null, load: null }])
})

test('no plan this week: a change has no knock-on section (nothing to knock on)', { skip }, async () => {
  await add('events', { title: 'CS tutor', repeat_days: [T().isoDow(D(1))], start_time: '17:00', end_time: '18:00' })
  await ask('CS tutor is off this week', [{ op: 'event_cancel', ref: 'CS tutor' }])
  assert.doesNotMatch(last().text, /Knock-on/)
})
