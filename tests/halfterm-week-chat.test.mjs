// Half-term week of 19 Oct 2026 on the TEST database (the clock set to Mon 19 Oct, 08:00): the Your week card with no
// school in half-term, the ACT countdown to the Sat 24 Oct retake (4 h on holiday days, full timed tests Tue + Thu
// reviewed straight after, Fri light, nothing timed on the day) with his ACT task on the day he gave, "upper 3× a week
// until 1 Nov" (football and Owen's days stay put), and two quick messages while a card waits (none lost).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/halfterm-week-chat.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const T = () => chat.time
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const act = (o) => ({ op: 'setting', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const tapOn = async (m, label) => { const b = chat.button(m, label); assert.ok(b, `no button “${label}” on: ${m?.text?.slice(0, 80)}`); await chat.tap(b, m.message_id) }
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}`) }
const W = { mon: '2026-10-19', tue: '2026-10-20', wed: '2026-10-21', thu: '2026-10-22', fri: '2026-10-23', sat: '2026-10-24', sun: '2026-10-25' }

before(async () => {
  if (skip) return
  const { setClock } = await import('./support/clock.mjs')
  const { zonedToUTC } = await import('../lib/time.ts')
  setClock(zonedToUTC(W.mon, '08:00'))
})
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })

/** This week: school (off: half-term), football Mon + Wed, Owen's days, the ACT retake Sat 24 Oct and his ACT task for Wednesday. */
async function thisWeek() {
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15', repeat_from: '2026-09-01', is_school: true })
  await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', repeat_from: '2026-09-01', training_type: 'football', load: 'hard' })
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify({ owenDays: { speed: [2], heavy_lower: [4] } })])
  const actSubject = await add('subjects', { name: 'ACT' })
  await add('goals', { title: 'ACT retake', kind: 'test', test_kind: 'act', target_date: W.sat, subject_id: actSubject.id })
  const task = await add('tasks', { title: 'ACT reading passages set 3', status: 'this_week', importance: 'must', due_at: `${W.wed}T12:00:00Z`, duration_minutes: 60, subject_id: actSubject.id })
  return { task }
}

/** The card's lines for one day ("Today", "Tue" …), up to the next day. */
const dayOf = (text, label) => {
  const start = text.indexOf(`<b>${label}</b>`)
  assert.ok(start >= 0, `no ${label} on the card`)
  const next = text.slice(start + 1).search(/\n<b>(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)<\/b>/)
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}

test('the Your week card in half-term: no school; ACT 4 h a day, tests Tue + Thu reviewed straight after, Fri light, the retake Sat; his ACT task on Wednesday', { skip }, async () => {
  const { task } = await thisWeek()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning your week.', plan_week: true }))
  chat.ai.script(PLAN, (body) => {
    const p = body.messages[0].content[0].text
    assert.match(body.messages[0].content.map((c) => c.text).join('\n'), /ACT .* is planned by the app itself: don't add any ACT items/)
    const ref = p.match(/(T\d+) \| ACT reading passages set 3/)?.[1]
    // the AI puts his Wednesday task on Monday and invents an ACT session: the app's own ACT plan wins
    return { days: [{ date: W.mon, items: [
      ...(ref ? [{ ref, title: '', minutes: 60, kind: 'focus', focus: '', why: 'ACT' }] : []),
      { ref: '', title: 'ACT practice questions', minutes: 60, kind: 'focus', focus: 'ACT', why: 'retake soon' },
    ] }], note: '', push_back: '' }
  })
  await nat('plan my week')
  const card = last()
  show(card)
  assert.match(card.text, /🗓 <b>Your week<\/b>/)
  assert.doesNotMatch(card.text, /🏫|School 08:45/, 'half-term: no school any day')
  assert.ok(card.text.length < 4096, `one Telegram message (${card.text.length})`)

  const mon = dayOf(card.text, 'Today')
  assert.match(mon, /ACT: timed English \+ Reading/)
  assert.match(mon, /ACT: timed Maths \+ Science/)
  assert.match(mon, /19:00 Football training/, 'football stays')
  assert.doesNotMatch(mon, /ACT reading passages set 3|ACT practice questions/, 'not the AI’s ACT items')
  for (const d of ['Tue', 'Thu']) {
    const t = dayOf(card.text, d)
    assert.match(t, /ACT full timed test[\s\S]*ACT: review today’s test/, `${d}: the full test, then its review straight after`)
  }
  const wed = dayOf(card.text, 'Wed')
  assert.match(wed, /ACT reading passages set 3/, 'his ACT task on the day he gave')
  assert.match(wed, /ACT: timed English/)
  assert.match(wed, /19:00 Football training/)
  assert.match(dayOf(card.text, 'Fri'), /ACT eve: rules \+ misses, early night/)
  const sat = dayOf(card.text, 'Sat')
  assert.match(sat, /ACT retake today/)
  assert.doesNotMatch(sat, /timed test|ACT: timed/, 'never a practice test on the real test day')

  // ✅ Apply: his task is planned on Wednesday
  await tapOn(card, '✅ Apply')
  const [b] = await q(`select on_date::text from plan_blocks where task_id = $1 and status = 'planned'`, [task.id])
  assert.equal(b.on_date, W.wed)
  chat.noSurprises()
})

test('Today in half-term (Mon 19 Oct): ACT 4 h, no school, and Wednesday’s ACT task isn’t on it yet', { skip }, async () => {
  await thisWeek()
  await nat('/today all')
  const t = chat.tg.sent().filter((m) => /📌 <b>Today/.test(m.text)).at(-1).text
  show({ text: t })
  assert.match(t, /half-term/)
  assert.doesNotMatch(t, /🏫/)
  assert.match(t, /ACT: timed English \+ Reading/)
  assert.doesNotMatch(t, /ACT reading passages set 3/)
  chat.noSurprises()
})

test('“upper 3x a week until 1 Nov”: a card, then every week until 1 Nov; the week plan has upper 3× with football and Owen’s days where they were', { skip }, async () => {
  await thisWeek()
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Upper 3× until 1 Nov.', actions: [act({ op: 'upper_week', value: 'count=3; until=2026-11-01', words: 'until 1 Nov' })] }))
  await nat('upper 3x a week until 1 nov')
  const card = last()
  assert.match(card.text, /💪 Upper: <b>3× a week until Sun 1 Nov<\/b>/)
  assert.equal((await q(`select planning->'upperWeeks' w from profiles where user_id = $1`, [chat.users.owner]))[0].w, null, 'nothing before ✅')
  await tapOn(card, '✅ Apply')
  const [p] = await q(`select planning from profiles where user_id = $1`, [chat.users.owner])
  assert.deepEqual(p.planning.upperWeeks, { '2026-10-19': 3, '2026-10-26': 3 })
  assert.deepEqual(p.planning.owenDays, { speed: [2], heavy_lower: [4] }, 'Owen’s days untouched')

  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning your week.', plan_week: true }))
  chat.ai.script(PLAN, { days: [], note: '', push_back: '' })
  await nat('plan my week')
  const week = last()
  show(week)
  assert.match(week.text, /💪 <i>Upper 3× \(your choice\)/)
  assert.equal((week.text.match(/🏋️ Upper @/g) ?? []).length, 3, 'three upper sessions')
  // at least 48 h apart: Mon, Wed, Sat this week (the others moved to make room; Owen's and football didn't)
  const uppers = ['Today', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter((d) => /🏋️ Upper @/.test(dayOf(week.text, d)))
  assert.deepEqual(uppers, ['Today', 'Wed', 'Sat'])
  assert.match(dayOf(week.text, 'Tue'), /🏋️ Speed \+ circuits @ Owen/, 'Owen’s speed on Tuesday')
  assert.match(dayOf(week.text, 'Thu'), /🏋️ Heavy lower/, 'heavy lower on Thursday')
  assert.match(dayOf(week.text, 'Today'), /19:00 Football training/)
  assert.match(dayOf(week.text, 'Wed'), /19:00 Football training/)
  chat.noSurprises()
})

test('two quick messages while a card waits: handled one after the other; the waiting card is never replaced by something else', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Chemistry notes due Friday' }))
  chat.ai.script(SORT, sorted({ title: 'Chemistry notes' }))
  await nat('Chemistry notes due Friday')
  const slow = (reply, ms) => async () => { await new Promise((r) => setTimeout(r, ms)); return reply }
  // the AI wrongly calls the first quick message a correction of the waiting card
  chat.ai.script(CHAT, slow(brain({ intent: 'correction', item_text: 'Maths test on Thursday' }), 800))
  // …so it's read again without the card: a new item
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Maths test on Thursday' }))
  chat.ai.script(SORT, sorted({ kind: 'test', title: 'Maths test', test_date: W.thu, date_words: 'Thursday' }))
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Physics worksheet due Monday' }))
  chat.ai.script(SORT, sorted({ title: 'Physics worksheet' }))
  await Promise.all([nat('maths test on thursday'), new Promise((r) => setTimeout(r, 150)).then(() => nat('physics worksheet due monday'))])
  const cards = await q(`select status, payload->'proposal'->>'title' title from telegram_pending where kind = 'capture' order by created_at`)
  assert.deepEqual(cards.map((c) => [c.title, c.status]), [['Chemistry notes', 'open'], ['Maths test', 'open'], ['Physics worksheet', 'open']], 'three cards: nothing lost')
  const turns = await q(`select text, status from telegram_turns where role = 'nat' order by id`)
  assert.deepEqual(turns.map((t) => t.text), ['Chemistry notes due Friday', 'maths test on thursday', 'physics worksheet due monday'], 'in the order he sent them')
  assert.ok(turns.every((t) => t.status === 'done'))
  // a real correction (✏️ or a few words about the card) still replaces it
  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Physics worksheet due Monday, 30 min' }))
  chat.ai.script(SORT, sorted({ title: 'Physics worksheet', duration_minutes: 30 }))
  await nat('30 min')
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'capture' and status = 'replaced'`))[0].n, 1)
  chat.noSurprises()
})
