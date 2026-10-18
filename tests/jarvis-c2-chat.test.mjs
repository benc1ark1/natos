// Jarvis phase C2: changing events, tests and goals from Telegram, on the TEST database. Run: npm run test:chat
// Each spec example: a card first (nothing changes), ✅ Apply (the database and the bot's own lists show it),
// ↩️ Undo (back as it was; nothing deleted). Google events are read-only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const act = (o) => ({ op: 'event_move', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const refIn = (body, name) => {
  const m = body.messages[0].content[0].text.match(new RegExp(`([TMPWGE]\\d+) \\| (?:TEST: |goal: )?${name} \\|`))   // the whole name
  assert.ok(m, `no ref for ${name}`)
  return m[1]
}
async function ask(text, changes) {
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: changes.map((c) => act({ ...c, ref: c.ref ? refIn(body, c.ref) : '' })) }))
  await nat(text)
}
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const T = () => chat.time
const day = (iso) => `${T().dowShort(iso)} ${T().shortDate(iso)}`
const weekday = (iso) => T().longDate(iso).split(',')[0]

test('"Owen moved training to <day> 6pm this week": this week only; /week shows it moved; undo puts it back', { skip }, async () => {
  const usual = T().addDays(T().todayISO(), 2), moved = T().addDays(T().todayISO(), 4)
  const owen = await add('events', { title: 'Owen training', repeat_days: [T().isoDow(usual)], start_time: '18:00', end_time: '19:30', travel_minutes: 20 })
  const text = `Owen moved training to ${weekday(moved)} 6pm this week`
  await ask(text, [{ ref: 'Owen training', date: usual, date_to: moved, time: '18:00', words: `${weekday(moved)} 6pm` }])
  assert.match(last().text, new RegExp(`Owen training</b>: ${day(usual)} 18:00–19:30 → ${day(moved)} 18:00–19:30 <i>\\(just this week\\)`))
  assert.equal((await q(`select count(*)::int n from event_exceptions`))[0].n, 0, 'nothing changes before ✅')
  await tap('Apply')
  const [ex] = await q(`select on_date::text, new_date::text, new_start::text, cancelled from event_exceptions where event_id = $1`, [owen.id])
  assert.deepEqual(ex, { on_date: usual, new_date: moved, new_start: '18:00:00', cancelled: false })
  await nat('/week')
  assert.match(last().text, new RegExp(`<b>${day(moved)}</b>\\n  18:00–19:30 Owen training <i>\\(moved\\)`))
  await tap('Undo')
  const [back] = await q(`select new_date, new_start, cancelled from event_exceptions where event_id = $1`, [owen.id])
  assert.deepEqual(back, { new_date: null, new_start: null, cancelled: false }, 'the week’s change is cleared (the row stays: nothing deleted)')
  await nat('/week')
  assert.match(last().text, new RegExp(`<b>${day(usual)}</b>\\n  18:00–19:30 Owen training`))
})

test('"Match cancelled <day>": a one-off event is archived, not deleted; undo restores it', { skip }, async () => {
  const d = T().addDays(T().todayISO(), 3)
  const match = await add('events', { title: 'Match', starts_at: T().zonedToUTC(d, '10:00'), ends_at: T().zonedToUTC(d, '11:30') })
  await ask(`match cancelled ${weekday(d)}`, [{ op: 'event_cancel', ref: 'Match', date: d }])
  await tap('Apply')
  assert.ok((await q(`select archived_at from events where id = $1`, [match.id]))[0].archived_at)
  await tap('Undo')
  assert.equal((await q(`select archived_at from events where id = $1`, [match.id]))[0].archived_at, null)
})

test('"CS tutor is off this week": that session cancelled, so that evening shows as free; undo', { skip }, async () => {
  const d = T().addDays(T().todayISO(), 2)
  const cs = await add('events', { title: 'CS tutor', repeat_days: [T().isoDow(d)], start_time: '17:00', end_time: '18:00' })
  await ask('CS tutor is off this week', [{ op: 'event_cancel', ref: 'CS tutor' }])
  assert.match(last().text, /CS tutor<\/b> .* → cancelled <i>\(just this week\)/)
  await tap('Apply')
  assert.deepEqual(await q(`select on_date::text, cancelled from event_exceptions where event_id = $1`, [cs.id]), [{ on_date: d, cancelled: true }])
  await nat(`/free ${T().dowShort(d)}`)
  // Build O: the day runs from the end of the morning routine to the start of the night routine (guesses: no school
  // that day, so up at 08:00 + 30 min; night routine from 22:00)
  assert.match(last().text, /• 08:30–22:00/, 'the whole day is free now')
  await tap('Undo')
  assert.deepEqual(await q(`select cancelled from event_exceptions where event_id = $1`, [cs.id]), [{ cancelled: false }])
})

test('"Dentist <day> 3pm": a new event, shown in the week; undo archives it', { skip }, async () => {
  const d = T().addDays(T().todayISO(), 2)
  await ask(`Dentist ${weekday(d)} 3pm`, [{ op: 'event_new', value: 'Dentist', date: d, time: '15:00', words: `${weekday(d)} 3pm` }])
  assert.match(last().text, new RegExp(`📅 New: <b>Dentist</b> ${day(d)} 15:00–16:00`))
  await tap('Apply')
  await nat('/week')
  assert.match(last().text, /15:00–16:00 Dentist/)
  await tap('Undo')
  const rows = await q(`select archived_at from events where title = 'Dentist'`)
  assert.equal(rows.length, 1, 'kept, not deleted')
  assert.ok(rows[0].archived_at)
})

test('"Physics test moved to <day>": the test moves and its prep sessions re-plan before it; undo moves it back', { skip }, async () => {
  const today = T().todayISO(), old = T().addDays(today, 10), newer = T().addDays(today, 5)
  const g = await add('goals', { title: 'Physics test', kind: 'test', target_date: old, priority: 'high' })
  for (const [n, off] of [[1, 2], [2, 5], [3, 8]]) {
    await add('tasks', { title: `Physics test prep ${n}`, goal_id: g.id, is_system: true, session_no: n, due_at: `${T().addDays(today, off)}T12:00:00Z`, status: 'this_week', duration_minutes: 45 })
  }
  await ask(`Physics test moved to ${weekday(newer)}`, [{ op: 'test_date', ref: 'Physics test', date: newer, words: weekday(newer) }])
  assert.match(last().text, /its prep sessions re-plan/)
  await tap('Apply')
  assert.equal((await q(`select target_date::text d from goals where id = $1`, [g.id]))[0].d, newer)
  const due = (await q(`select (due_at at time zone 'Europe/London')::date::text d from tasks where goal_id = $1 order by session_no`, [g.id])).map((r) => r.d)
  assert.ok(due.every((x) => x < newer), `all prep sessions before the new date: ${due.join(', ')}`)
  await tap('Undo')
  assert.equal((await q(`select target_date::text d from goals where id = $1`, [g.id]))[0].d, old)
  assert.equal((await q(`select count(*)::int n from tasks where goal_id = $1 and archived_at is null`, [g.id]))[0].n, 3, 'sessions still there')
})

test('"Add moments to the Physics test" and "Archive the SMC goal": applied and undone', { skip }, async () => {
  const t = await add('goals', { title: 'Physics test', kind: 'test', target_date: T().addDays(T().todayISO(), 9), topics: 'forces' })
  const smc = await add('goals', { title: 'SMC', kind: 'goal' })
  await ask('add moments to the Physics test', [{ op: 'goal_topics', ref: 'Physics test', value: 'forces, moments' }])
  await tap('Apply')
  assert.equal((await q(`select topics from goals where id = $1`, [t.id]))[0].topics, 'forces, moments')
  await tap('Undo')
  assert.equal((await q(`select topics from goals where id = $1`, [t.id]))[0].topics, 'forces')
  await ask('archive the SMC goal', [{ op: 'goal_archive', ref: 'SMC' }])
  await tap('Apply')
  assert.ok((await q(`select archived_at from goals where id = $1`, [smc.id]))[0].archived_at)
  await tap('Undo')
  assert.equal((await q(`select archived_at from goals where id = $1`, [smc.id]))[0].archived_at, null)
})

test('a Google calendar event is never changed: it has no ref, so no change can point at it', { skip }, async () => {
  const d = T().addDays(T().todayISO(), 2)
  const g = await add('events', { title: 'Lessons', repeat_days: [T().isoDow(d)], start_time: '08:40', end_time: '15:30', external_source: 'google' })
  chat.ai.script(CHAT, (body) => {
    const seen = body.messages[0].content[0].text
    assert.doesNotMatch(seen, /E\d+ \| Lessons/, 'no ref for a Google event')
    assert.match(seen, /Lessons \(Google\)/, 'shown in the calendar, marked')
    return brain({ intent: 'chat', reply: 'Lessons are on your Google calendar, so change them there.' })
  })
  await nat('no lessons this week')
  assert.match(last().text, /on your Google calendar/)
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0, 'no card')
  assert.equal((await q(`select count(*)::int n from event_exceptions where event_id = $1`, [g.id]))[0].n, 0)
})

test('Undo leaves a session alone if it was changed again since', { skip }, async () => {
  const usual = T().addDays(T().todayISO(), 2), moved = T().addDays(T().todayISO(), 3)
  const owen = await add('events', { title: 'Owen training', repeat_days: [T().isoDow(usual)], start_time: '18:00', end_time: '19:30' })
  await ask(`owen moved to ${weekday(moved)} 6pm`, [{ ref: 'Owen training', date: usual, date_to: moved, time: '18:00', words: `${weekday(moved)} 6pm` }])
  await tap('Apply')
  await q(`update event_exceptions set new_start = '19:00' where event_id = $1`, [owen.id])   // changed on the dashboard
  await tap('Undo')
  assert.match(last().text, /Left as it is \(changed since\): Owen training/)
  assert.equal((await q(`select new_start::text s from event_exceptions where event_id = $1`, [owen.id]))[0].s, '19:00:00')
})
