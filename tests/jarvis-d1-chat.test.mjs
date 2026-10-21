// Jarvis phase D1: "plan my day" end to end on the TEST database, with a scripted brain AND a scripted planner.
// Run: npm run test:chat. Plans are for tomorrow (a whole free day) unless the test needs today, so they don't
// depend on what time the tests run.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const T = () => chat.time
const tomorrow = () => T().addDays(T().todayISO(), 1)
const refIn = (body, name) => body.messages[0].content[0].text.match(new RegExp(`([TWG]\\d+) \\| ${name} \\|`))?.[1] ?? 'T999'
const item = (o) => ({ ref: '', title: '', minutes: 30, kind: 'focus', focus: '', why: 'because', ...o })
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const planned = () => q(`select title, start_time::text s, end_time::text e, kind, status from plan_blocks order by created_at, start_time`)

/** He asks; the brain says "plan"; the planner picks these items (by name, looked up in its snapshot). */
async function plan(text, { date = tomorrow(), from = '', minutes = 0, energy = '' } = {}, picks = [], extra = {}) {
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning.', plan_day: date, plan_from: from, plan_minutes: minutes, plan_until: '', energy }))
  chat.ai.script(PLAN, (body) => {
    extra.onRequest?.(body)
    return { items: picks.map((p) => item({ ...p, ref: p.name ? refIn(body, p.name) : '', title: p.title ?? '' })), note: extra.note ?? 'SMC first.', push_back: extra.pushBack ?? '' }
  })
  await nat(text)
}

async function seed() {
  const smc = await add('tasks', { title: 'SMC past paper', status: 'this_week', importance: 'must', due_at: `${T().addDays(T().todayISO(), 3)}T12:00:00Z`, duration_minutes: 90, postpone_count: 3 })
  const phys = await add('tasks', { title: 'Physics homework', status: 'this_month', importance: 'must', due_at: `${T().addDays(T().todayISO(), 5)}T12:00:00Z`, duration_minutes: 45 })
  const email = await add('tasks', { title: 'Email Mr Khan', status: 'inbox' })
  return { smc, phys, email }
}

test('"plan tomorrow": Opus picks, code places; the card is a timeline; nothing saved before ✅; Apply and Undo', { skip }, async () => {
  await seed()
  let sent = ''
  await plan('plan tomorrow', {}, [{ name: 'SMC past paper', minutes: 90 }, { name: 'Physics homework', minutes: 45 }, { name: 'Email Mr Khan', minutes: 15, kind: 'light' }], { onRequest: (b) => { sent = JSON.stringify(b) } })
  assert.match(sent, /<free_time>/, 'the planner is given the free time')
  assert.match(sent, /claude-opus-5-5/, 'planning uses the planning model')
  const card = last()
  assert.match(card.text, /🗓 <b>Plan · /)
  // Build O: the day starts after the morning routine (no school tomorrow here: up at 08:00 + 30 min, both guesses)
  assert.match(card.text, /08:30–10:00 <b>SMC past paper<\/b> <i>· focus/)
  assert.match(card.text, /10:10–10:55 <b>Physics homework<\/b>/)
  assert.match(card.text, /11:05–11:20 Email Mr Khan <i>· light/)
  assert.doesNotMatch(card.text, /moves .* to Today/, 'tomorrow’s plan doesn’t move tasks to Today')
  assert.deepEqual(await planned(), [], 'nothing saved before ✅')
  await tap('Apply')
  assert.match(last().text, /✅ <b>Plan saved<\/b>/)
  assert.deepEqual((await planned()).map((b) => `${b.s.slice(0, 5)} ${b.title} ${b.status}`), ['08:30 SMC past paper planned', '10:10 Physics homework planned', '11:05 Email Mr Khan planned'])
  await tap('Undo')
  assert.deepEqual((await planned()).map((b) => b.status), ['cancelled', 'cancelled', 'cancelled'], 'undone, never deleted')
  const usage = await q(`select feature, model from ai_usage order by id`)
  assert.deepEqual(usage.map((u) => `${u.feature}:${u.model}`).sort(), ['chat:claude-sonnet-5-5', 'plan:claude-opus-5-5'])
  chat.noSurprises()
})

test('a re-plan replaces the old plan; undoing it brings the old one back', { skip }, async () => {
  await seed()
  await plan('plan tomorrow', {}, [{ name: 'SMC past paper', minutes: 90 }])
  await tap('Apply')
  await plan('actually re-plan tomorrow', {}, [{ name: 'Physics homework', minutes: 45 }])
  await tap('Apply')
  assert.deepEqual((await planned()).map((b) => `${b.title}:${b.status}`), ['SMC past paper:replaced', 'Physics homework:planned'])
  await tap('Undo')
  assert.deepEqual((await planned()).map((b) => `${b.title}:${b.status}`), ['SMC past paper:planned', 'Physics homework:cancelled'])
})

test('"I\'m ill tomorrow": a light plan only, and how he feels is saved with ✅ (and undone)', { skip }, async () => {
  await seed()
  await plan('I’m ill tomorrow, plan it light', { energy: 'ill' }, [{ name: 'SMC past paper', minutes: 90 }, { name: 'Email Mr Khan', minutes: 15, kind: 'light' }, { title: 'Rest and fluids', minutes: 60, kind: 'rest' }])
  const card = last()
  assert.match(card.text, /\(ill: a lighter day\)/)
  assert.doesNotMatch(card.text, /07:00–08:30 <b>SMC/)
  assert.match(card.text, /Didn’t fit: SMC past paper \(you’re ill: rest instead\)/)
  assert.match(card.text, /notes you’re ill today/)
  await tap('Apply')
  assert.deepEqual(await q(`select on_date::text d, energy from day_state`), [{ d: tomorrow(), energy: 'ill' }])
  await tap('Undo')
  assert.deepEqual(await q(`select energy from day_state`), [{ energy: null }])
})

test('✏️ Change: "no SMC" re-plans the same day with the old plan in view; the old card is replaced', { skip }, async () => {
  await seed()
  await plan('plan tomorrow', {}, [{ name: 'SMC past paper', minutes: 90 }, { name: 'Physics homework', minutes: 45 }])
  await tap('Change')
  assert.match(last().text, /What should be different/)
  let sent = ''
  await plan('no SMC tomorrow', {}, [{ name: 'Physics homework', minutes: 45 }], { onRequest: (b) => { sent = JSON.stringify(b) } })
  assert.match(sent, /<current_plan>/, 'the planner sees the plan being changed')
  assert.match(sent, /no SMC tomorrow/)
  assert.match(last().text, /Changed<\/b>\n🗓/)
  assert.deepEqual((await q(`select status from telegram_pending where kind = 'plan' order by created_at`)).map((r) => r.status), ['replaced', 'open'])
})

test('invented records are dropped; heavy work that only fits late is left out, and the card says so', { skip }, async () => {
  await seed()
  // Build O: from 21:00 the evening runs to the night routine (22:00), so 45 min of heavy work only fits after 21:30
  await plan('plan tomorrow from 9pm', { from: '21:00' }, [{ name: 'Not a real task', minutes: 30 }, { name: 'SMC past paper', minutes: 45 }, { name: 'Email Mr Khan', minutes: 15, kind: 'light' }])
  const t = last().text
  assert.doesNotMatch(t, /Not a real task/)
  assert.match(t, /Didn’t fit: SMC past paper \(only fits after 21:30, too late for it\)/)
  assert.match(t, /21:00–21:15 Email Mr Khan/)
})

test('today’s plan moves its tasks to Today (and Undo moves them back); /today and the pinned message show it', { skip }, async (t) => {
  // the homework is heavy: it needs ~45 min + buffers before 21:30 (nothing heavy after)
  const left = 21 * 60 + 30 - (Number(T().timeOf(new Date()).slice(0, 2)) * 60 + Number(T().timeOf(new Date()).slice(3)))
  if (left < 75) return t.skip('too late in the day to plan heavy work today')
  const { phys } = await seed()
  await plan('plan my evening', { date: T().todayISO() }, [{ name: 'Physics homework', minutes: 45 }])
  assert.match(last().text, /✅ also moves 1 task to Today/)
  await tap('Apply')
  assert.equal((await q(`select status from tasks where id = $1`, [phys.id]))[0].status, 'today')
  // (item 5: /today is the Today list: his applied plan is kept, a tap each)
  await nat('/today')
  const m = chat.tg.sent().at(-1)
  assert.match(m.text, /\n\d\. 📌 Physics homework/)
  assert.ok(chat.button(m, 'Physics homework'), 'a tap to tick it')
  assert.ok(chat.tg.sent().some((m) => m.text.startsWith('📌') && /Physics homework/.test(m.text)))
  await tap('Undo')
  assert.equal((await q(`select status from tasks where id = $1`, [phys.id]))[0].status, 'this_month')
})

test('"I\'ve got 2 hours now": nothing planned past two hours from now', { skip }, async (t) => {
  const nowMin = Number(T().timeOf(new Date()).slice(0, 2)) * 60 + Number(T().timeOf(new Date()).slice(3))
  if (nowMin > 20 * 60) return t.skip('too late in the day')
  if (nowMin < 7 * 60) return t.skip('before the free day starts (07:00): "now" has no free time')
  await seed()
  await plan('I’ve got 2 hours now', { date: T().todayISO(), minutes: 120 }, [{ name: 'SMC past paper', minutes: 90 }, { name: 'Physics homework', minutes: 45 }, { name: 'Email Mr Khan', minutes: 15, kind: 'light' }])
  const ends = [...last().text.matchAll(/(\d\d:\d\d)–(\d\d:\d\d)/g)].map((m) => Number(m[2].slice(0, 2)) * 60 + Number(m[2].slice(3)))
  assert.ok(ends.length > 0)
  assert.ok(ends.every((e) => e <= Math.ceil(nowMin / 5) * 5 + 120), `${ends} vs now ${nowMin}`)
})

test('a planner failure says so; nothing is planned', { skip }, async () => {
  await seed()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning.', plan_day: tomorrow() }))
  chat.ai.script(PLAN, { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } })
  await nat('plan tomorrow')
  assert.match(last().text, /Planner error 400.*Nothing planned/)
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'plan'`))[0].n, 0)
})

test('the morning brief shows today’s plan', { skip }, async () => {
  const today = T().todayISO()
  await q(`insert into plan_blocks (user_id, plan_id, on_date, start_time, end_time, title, kind) values ($1, gen_random_uuid(), $2, '19:00', '19:45', 'Physics homework', 'focus')`, [chat.users.owner, today])
  // item 5: the morning message is Today: his plan's blocks, each with a tap; the whole-day timeline is /brief full
  await nat('/brief')
  const m = chat.tg.sent().at(-1)
  assert.match(m.text, /\n\d\. 📚 Physics homework <i>· 45m<\/i>/)
  assert.ok(chat.button(m, '☐ Physics homework'), 'a tick button for it')
  await nat('/brief full')
  assert.match(last().text, /📋 <b>Your day<\/b>[\s\S]*19:00 📚 Physics homework <i>45m<\/i>/)
})
