// Fix round part A on the TEST database (clock: Wed 21 Oct 2026 08:00, his half-term, ACT Sun 25 Oct). Item 12: a
// session moved on top of something in the week he typed (week_notes) gives the 1️⃣/2️⃣ clash card, and 1️⃣ works: the
// typed item is left out of that week note (it used to fail with “invalid input syntax for type uuid: week:1”); ↩️ Undo
// puts the note back. The same session in his typed week ("Owen" Thu 17:00) isn't a clash at all.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/fixround-a-chat.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { PLANNING, THIS, TODAY, day } from './support/nat-real.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const act = (o) => ({ op: 'event_move', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const refIn = (body, name) => {
  const m = body.messages[0].content[0].text.match(new RegExp(`((?:TR|[TMPWGE])\\d+) \\| (?:TEST: |goal: )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.ok(m, `no ref for ${name}`)
  return m[1]
}
const TUE = day(THIS, 1), THU = day(THIS, 3)

before(async () => {
  if (skip) return
  const { setClock } = await import('./support/clock.mjs')
  const { zonedToUTC } = await import('../lib/time.ts')
  setClock(zonedToUTC(TODAY, '08:00'))
})
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })

/** His real set-up, his weekly Owen session (Tue 18:30) and the week he typed (Thu: dentist 11:00, Owen 17:00). */
async function setUp() {
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify({ holidays: PLANNING.holidays, gameDay: 'none' })])
  const owen = await add('events', { title: 'Owen training', repeat_days: [2], start_time: '18:30', end_time: '19:30', repeat_from: '2026-09-01', training_type: 'sprint', load: 'hard' })
  const items = [
    { date: THU, start: '11:00', end: '12:00', title: 'Dentist', kind: 'other', training_type: '', intensity: '', travel_minutes: 0 },
    { date: THU, start: '17:00', end: '18:00', title: 'Owen', kind: 'training', training_type: 'sprint', intensity: '', travel_minutes: 0 },
  ]
  const [note] = await q(`insert into week_notes (user_id, week_from, week_to, text, items) values ($1, $2, $3, $4, $5) returning id`,
    [chat.users.owner, TODAY, day(THIS, 6), 'Thu dentist 11-12, Owen 5pm', JSON.stringify(items)])
  return { owen, note, items }
}
const move = (time) => async () => {
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ ref: refIn(body, 'Owen training'), date: TUE, date_to: THU, time, words: `Thursday ${time}` })] }))
  await nat(`Owen moved to Thursday ${time} this week`)
}

test('item 12 · 1️⃣ on a clash with the typed week: the dentist is left out of the week note (no uuid error); Undo puts it back', { skip }, async () => {
  const { owen, note, items } = await setUp()
  await move('11:00')()
  const card = last()
  assert.match(card.text, /⚠️ <b>Clash<\/b>: 11:00–12:00 is on top of Dentist \(11:00–12:00\)/)
  assert.match(card.text, /1️⃣ Owen training at 11:00, and cancel Dentist that day/)
  await tap('1️⃣')
  assert.doesNotMatch(last().text, /invalid input syntax|uuid|Couldn’t/i, last().text)
  assert.deepEqual(await q(`select new_date::text d, new_start::text s from event_exceptions where event_id = $1`, [owen.id]), [{ d: THU, s: '11:00:00' }])
  const [{ items: now }] = await q(`select items from week_notes where id = $1`, [note.id])
  assert.deepEqual(now.map((x) => x.title), ['Owen'], 'only the dentist is left out; the rest of his typed week stays')
  assert.equal((await q(`select count(*)::int n from week_notes where archived_at is null`))[0].n, 1, 'the note is kept (never deleted)')
  await tap('Undo')
  assert.deepEqual((await q(`select items from week_notes where id = $1`, [note.id]))[0].items, items, 'Undo: the dentist is back')
  assert.deepEqual(await q(`select new_date from event_exceptions where event_id = $1`, [owen.id]), [{ new_date: null }])
})

test('item 12 · moving Owen onto his typed “Owen” Thu 17:00: one session, not a clash', { skip }, async () => {
  await setUp()
  await move('17:00')()
  const card = last()
  assert.doesNotMatch(card.text, /Clash/, card.text)
  assert.ok(chat.button(card, 'Apply'), 'a plain change card')
})
