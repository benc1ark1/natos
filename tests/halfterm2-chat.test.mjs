// Half-term week of 19 Oct 2026, round 2, on the TEST database (clock: Mon 19 Oct 08:00). His Holidays setting as he
// typed it ("Half-term 2026-10-17..2026-11-01"), the ACT test on SUN 25 Oct (no game that day, Sat light), upper 3×
// with gym from 12:00 on holidays, "Sam's CS homework is done" while a card waits (its own message), chat never
// saved, and the one-off clean-up of the two chat messages saved as items.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/halfterm2-chat.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT, OWNER_TG } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const act = (o) => ({ op: 'move', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}`) }
const W = { mon: '2026-10-19', sat: '2026-10-24', sun: '2026-10-25' }
const refIn = (body, name) => body.messages[0].content[0].text.match(new RegExp(`([TMPWG]\\d+) \\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))?.[1]

before(async () => {
  if (skip) return
  const { setClock } = await import('./support/clock.mjs')
  const { zonedToUTC } = await import('../lib/time.ts')
  setClock(zonedToUTC(W.mon, '08:00'))
})
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })

const dayOf = (text, label) => {
  const start = text.indexOf(`<b>${label}</b>`)
  assert.ok(start >= 0, `no ${label} on the card`)
  const next = text.slice(start + 1).search(/\n<b>(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)<\/b>/)
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}

test('his Holidays setting as typed: no school all week; the ACT test Sun 25 Oct (no game that day, Sat light); upper 3×, gym from 12:00', { skip }, async () => {
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15', repeat_from: '2026-09-01', is_school: true })
  await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', repeat_from: '2026-09-01', training_type: 'football', load: 'hard' })
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify({ holidays: 'Half-term 2026-10-17..2026-11-01', gameDay: 'sunday', owenDays: { speed: [2], heavy_lower: [4] }, upperWeeks: { [W.mon]: 3, '2026-10-26': 3 } })])
  const actSubject = await add('subjects', { name: 'ACT' })
  await add('goals', { title: 'ACT test', kind: 'test', test_kind: 'act', target_date: W.sun, subject_id: actSubject.id })
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning your week.', plan_week: true }))
  chat.ai.script(PLAN, { days: [], note: '', push_back: '' })
  await nat('plan my week')
  const card = last()
  show(card)
  assert.doesNotMatch(card.text, /🏫|School 08:45/, 'half-term: no school')
  assert.doesNotMatch(dayOf(card.text, 'Sun'), /Game/, 'no game on the ACT test day')
  assert.match(dayOf(card.text, 'Sun'), /ACT retake today/)
  assert.match(dayOf(card.text, 'Sat'), /ACT eve: rules \+ misses, early night/)
  for (const d of ['Tue', 'Thu']) assert.match(dayOf(card.text, d), /ACT full timed test[\s\S]*ACT: review today’s test/)
  assert.match(card.text, /💪 <i>Upper 3×/)
  const gym = [...card.text.matchAll(/\n {2}(\d\d:\d\d) 🏋️ (?!Stretching|Core)/g)].map((m) => m[1])
  assert.ok(gym.length >= 5, `gym sessions: ${gym.join(', ')}`)
  assert.ok(gym.every((t) => t >= '12:00'), `on holidays gym from 12:00 (${gym.join(', ')})`)
  chat.noSurprises()
})

test('“Sam’s CS homework is done” while a card waits: handled as its own message (the homework marked done); the card stays as it was', { skip }, async () => {
  const hw = await add('tasks', { title: 'Sam’s CS homework', status: 'this_week', importance: 'must', due_at: `${W.mon}T12:00:00Z` })
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Chemistry notes due Friday' }))
  chat.ai.script(SORT, sorted({ title: 'Chemistry notes' }))
  await nat('Chemistry notes due Friday')
  // the AI first reads it as a change to the waiting card; then, asked again without the card, as what it is
  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Sam’s CS homework is done' }))
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content.map((c) => c.text).join('\n'), /<open_card>\(none\)<\/open_card>/, 'read without the card')
    return brain({ intent: 'instruction', reply: 'Marking it done.', actions: [act({ op: 'complete', ref: refIn(body, 'Sam’s CS homework') ?? '' })] })
  })
  await nat('Sam’s CS homework is done')
  const card = last()
  assert.match(card.text, /Sam’s CS homework/)
  assert.ok(chat.button(card, 'Apply'))
  assert.deepEqual((await q(`select status, payload->'proposal'->>'title' t from telegram_pending where kind = 'capture'`)).map((c) => [c.t, c.status]), [['Chemistry notes', 'open']], 'the waiting card untouched')
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  assert.equal((await q(`select status from tasks where id = $1`, [hw.id]))[0].status, 'completed')
  chat.noSurprises()
})

test('chat is never saved: “hello” (even if the AI calls it a new item) and “That okay maybe”', { skip }, async () => {
  // as messages: answered, nothing saved
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi!' }))
  await nat('hello')
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Sure.' }))
  await nat('That okay maybe')
  assert.equal((await q(`select count(*)::int n from tasks`))[0].n, 0)
  // even when the AI calls one a new item, the card maker refuses chat (no card, nothing sorted)
  const { newCard } = await import('../lib/telegram/cards.ts')
  const { openOwnerSession: open } = await import('../lib/telegram/owner-session.ts')
  for (const t of ['hello', 'That okay maybe', 'ok thanks']) {
    await newCard(await open(), OWNER_TG, t)
    assert.equal(last().text, 'That’s just chat, so nothing was saved.', t)
  }
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'capture'`))[0].n, 0, 'no card')
  assert.equal(chat.ai.byModel(SORT).length, 0, 'not even sorted')
  // the raw "keep it in Inbox" path (when sorting fails) refuses chat too
  const { captureToInbox } = await import('../lib/data.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  assert.equal((await captureToInbox(await openOwnerSession(), 'ok thanks')).error, 'That’s just chat, so nothing was saved.')
  assert.ok((await captureToInbox(await openOwnerSession(), 'buy printer ink')).task)
  chat.noSurprises()
})

test('the two chat messages saved as items are archived once (never deleted), and he’s told; real items stay', { skip }, async () => {
  const a = await add('tasks', { title: 'hello', status: 'inbox' })
  const b = await add('tasks', { title: 'That okay maybe', status: 'inbox' })
  const keep = await add('tasks', { title: 'Physics notes to sort', status: 'inbox' })
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  await runTick(await openOwnerSession(), OWNER_TG)
  const rows = await q(`select id, archived_at, archive_reason from tasks order by created_at`)
  assert.ok(rows.find((r) => r.id === a.id).archived_at && rows.find((r) => r.id === b.id).archived_at)
  assert.equal(rows.find((r) => r.id === a.id).archive_reason, 'dropped')
  assert.equal(rows.find((r) => r.id === keep.id).archived_at, null)
  assert.ok(chat.tg.sent().some((m) => /🧹 Archived 2 chat messages that had been saved as items: “hello”, “That okay maybe”/.test(m.text)))
  // once only
  await add('tasks', { title: 'ok', status: 'inbox' })
  await runTick(await openOwnerSession(), OWNER_TG)
  assert.equal((await q(`select count(*)::int n from tasks where archived_at is null`))[0].n, 2, 'the clean-up ran once (new chat can’t be saved any more anyway)')
})
