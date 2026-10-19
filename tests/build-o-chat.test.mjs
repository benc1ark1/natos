// Build O on the TEST database: the Your week card, the gap finder, the clean-up card, Owen days, the daily
// timeline with ticks, the 21:00 wrap-up, self-adjusting, ROI and the new chat paths. Scripted brain and planner.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/build-o-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, OWNER_TG } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const T = () => chat.time
const tapOn = async (m, label) => { const b = chat.button(m, label); assert.ok(b, `no button “${label}” on: ${m?.text?.slice(0, 80)}`); await chat.tap(b, m.message_id) }
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await tapOn(m, label) }
const refIn = (body, name) => {
  const m = body.messages[0].content[0].text.match(new RegExp(`((?:TR|ST|[TMPWGEX])\\d+) \\| (?:TEST: |goal: )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.ok(m, `no ref for ${name}`)
  return m[1]
}
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}\n${JSON.stringify(m.reply_markup?.inline_keyboard?.map((r) => r.map((b) => b.text)) ?? [])}`) }

/** Nat's real week shape: own school, tutors and football events; targets; a homework due in two days. */
export async function natsWeek() {
  const from = T().addDays(T().todayISO(), -14)
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', repeat_from: from, is_school: true })
  await add('events', { title: 'CS tutor', repeat_days: [1, 4], start_time: '17:30', end_time: '18:30', repeat_from: from })
  await add('events', { title: 'Maths tutor', repeat_days: [3], start_time: '17:00', end_time: '18:00', repeat_from: from })
  await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', repeat_from: from, training_type: 'football', load: 'hard' })
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 3 })
  const lower = await add('weekly_targets', { name: 'Lower + plyo', target_count: 2 })
  const hw = await add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: `${T().addDays(T().todayISO(), 2)}T12:00:00Z`, duration_minutes: 45 })
  return { upper, lower, hw }
}

test('O3: “plan my week” → one Your week card (review, routines, school, study, training with place + leave-by, 🧠/💪 per day); 🔁 re-fits without asking the AI again; ✅ applies all; Undo', { skip }, async () => {
  const { hw } = await natsWeek()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning your week.', plan_week: true }))
  const today = T().todayISO()
  chat.ai.script(PLAN, (body) => ({ days: [{ date: today, items: [{ ref: refIn(body, 'Physics homework'), title: '', minutes: 45, kind: 'focus', focus: '', why: 'due soon' }] }], note: 'Homework first.', push_back: '' }))
  await nat('plan my week')
  const card = last()
  show(card)
  assert.match(card.text, /🗓 <b>Your week<\/b>/)
  assert.match(card.text, /✅ <b>Last week<\/b>/, 'starts with last week')
  assert.match(card.text, /☀️ Wake \d\d:\d\d \+ morning routine · 🌙 night routine from \d\d:\d\d, bed \d\d:\d\d \(guess\)/, 'the day is built around the routines')
  assert.match(card.text, /🧠(?:🟢|🟡|🔴) 💪(?:⚪|🟢|🟡|🔴)/, 'mental and physical load per day')
  assert.match(card.text, /🏫 School 08:45–16:00/, 'school as one line')
  assert.match(card.text, /🏋️ Heavy lower @ (School gym|PureGym Swiss Cottage)/, 'heavy lower where the barbell is')
  assert.match(card.text, /🏋️ Speed \+ circuits @ Owen/)
  assert.match(card.text, /\(leave school \d\d:\d\d\)|\(leave \d\d:\d\d\)/, 'a leave-by time')
  assert.match(card.text, /📚 Physics homework <i>45m<\/i>/)
  assert.match(card.text, /💪 <i>Upper [23]× /, 'upper 2× or 3× with a reason')
  assert.match(card.text, /Still guessing: .*session lengths/)
  assert.ok(card.text.length < 4000, `fits one Telegram message (${card.text.length})`)
  chat.noSurprises()

  // 🔁 the heavy lower: other days, best first → pick one → the week again, no new AI call
  const move = card.reply_markup.inline_keyboard.flat().find((b) => /🔁 \w+ Heavy lower/.test(b.text))
  await chat.tap(move.callback_data, card.message_id)
  const options = last()
  assert.match(options.text, /Where instead\?/)
  await chat.tap(options.reply_markup.inline_keyboard[0][0].callback_data, options.message_id)
  const moved = last()
  show(moved)
  assert.match(moved.text, /✏️ <b>Heavy lower<\/b> → \w+ \d+ \w+ \(\w+\); the rest re-fitted/)
  assert.match(moved.text, /📚 Physics homework/, 'the study the planner picked is kept')
  chat.noSurprises()

  await tapOn(moved, '✅ Apply')
  assert.match(last().text, /✅ <b>Your week is set<\/b>: \d+ training sessions? and 1 study block/)
  const rows = await q(`select title, kind, status, task_id from plan_blocks where status = 'planned'`)
  assert.ok(rows.some((r) => r.kind === 'training' && / @ /.test(r.title)), 'training saved with its place')
  assert.ok(rows.some((r) => r.task_id === hw.id), 'the homework block')
  await tap('Undo')
  assert.equal((await q(`select count(*)::int n from plan_blocks where status = 'planned'`))[0].n, 0)
})

test('O3: the Your week card comes by itself on Sunday at the week-reset time (once), for the coming week', { skip }, async () => {
  await natsWeek()
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  // the next Sunday (today counts)
  const sun = chat.next(7)
  const at = (hhmm) => new Date(T().zonedToUTC(sun, hhmm))
  chat.ai.script(PLAN, () => ({ days: [], note: '', push_back: '' }))
  const sb = await openOwnerSession()
  await runTick(sb, OWNER_TG, at('18:05'))
  await runTick(sb, OWNER_TG, at('18:10'))
  const cards = chat.tg.sent().filter((m) => /🗓 <b>Your week<\/b>/.test(m.text))
  assert.equal(cards.length, 1, 'one card, once')
  assert.match(cards[0].text, new RegExp(`Your week</b> · Mon ${+T().addDays(sun, 1).slice(8)} `), 'for the coming week')
  chat.noSurprises()
})

/** The most recent past date with this ISO weekday (1 = Mon … 7 = Sun), never today. */
const past = (dow) => { let d = T().addDays(T().todayISO(), -1); while (T().isoDow(d) !== dow) d = T().addDays(d, -1); return d }
const planningNow = async () => (await q(`select planning from profiles where user_id = $1`, [chat.users.owner]))[0].planning ?? {}

test('O4: gap questions: most important first, quick taps or typed answers, saved as settings with Undo, the next one follows, never in school, “what do you still need to know?”', { skip }, async () => {
  const { setClock } = await import('./support/clock.mjs')
  await natsWeek()
  await q(`delete from telegram_sent where key = 'gaps:paused'`)   // the fixture pauses the questions
  const tue = past(2)
  setClock(T().zonedToUTC(tue, '07:35'))   // (item 5: the morning is 07:30 now; questions only after it)
  try {
    const { askNextGap } = await import('../lib/telegram/gapask.ts')
    const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
    const sb = await openOwnerSession()
    assert.equal(await askNextGap(sb, OWNER_TG, new Date(), { intro: true }), true)
    let m = last()
    show(m)
    assert.match(m.text, /I need a few details to plan your week properly — 2 min/)
    assert.match(m.text, /Your game this week: Sun as usual \(leave 08:30, back 16:00\)\?/)
    assert.match(m.text, /Until you answer I use: Sun, leave 08:30, back 16:00 \(guess\)/)
    await tapOn(m, 'Saturday')
    const saved = chat.tg.sent().find((x) => /⚽ Game, week of/.test(x.text))
    assert.match(saved.text, /→ <b>Sat \d+ \w+, leave 08:30, back 16:00<\/b>/)
    const sat = T().addDays(T().addDays(tue, -1), 5)
    assert.deepEqual((await planningNow()).gameWeeks[T().addDays(tue, -1)], { date: sat, leave: '08:30', back: '16:00' })
    // the next question follows by itself
    m = last()
    show(m)
    assert.match(m.text, /What time do you wake up on school days\?/)
    // typed instead of tapped: no AI needed
    await nat('6:50')
    assert.equal((await planningNow()).wakeAt, '06:50')
    assert.match(last().text, /Bedtime on school nights\?/)
    chat.noSurprises()
    // during school, nothing is asked
    setClock(T().zonedToUTC(tue, '10:00'))
    assert.equal(await askNextGap(sb, OWNER_TG, new Date()), false)
    setClock(T().zonedToUTC(tue, '16:40'))
    await nat('what do you still need to know?')
    show(last())
    assert.match(last().text, /🧩 <b>Still to find out<\/b> \(\d+\)/)
    assert.match(last().text, /Bedtime on school nights\? <i>\(using: 22:30\)<\/i>/)
    assert.doesNotMatch(last().text, /wake up/, 'answered ones are gone')
    // ↩️ Undo on the game answer puts the usual day back
    await tapOn(saved, 'Undo')
    assert.equal((await planningNow()).gameWeeks?.[T().addDays(tue, -1)], undefined)
  } finally { setClock(null) }
})

test('O5: the calendar clean-up card lists every recurring session (Life OS + Google, lessons as one row), EFA training pre-set to Archive; tap to switch; ✅ archives / ignores; Undo', { skip }, async () => {
  await natsWeek()
  const g = (title, day, start, end, n, id) => add('events', { title, starts_at: T().zonedToUTC(T().addDays(day, 7 * n), start), ends_at: T().zonedToUTC(T().addDays(day, 7 * n), end), external_source: 'google', external_id: `${id}-${n}`, calendar_id: 'cal1' })
  for (const n of [0, 1, 2]) {
    await g('EFA training', chat.next(7), '08:30', '10:00', n, 'efa')
    await g('EFA football', chat.next(2), '17:30', '19:00', n, 'efaf')
    await g('Physics', chat.next(1), '10:35', '11:10', n, 'phys')
  }
  await g('Dentist', chat.next(3), '15:00', '15:30', 0, 'dent')
  const { sendCleanup } = await import('../lib/telegram/cleanup.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const sb = await openOwnerSession()
  assert.equal(await sendCleanup(sb, OWNER_TG, ['EFA training']), true)
  const card = last()
  show(card)
  assert.match(card.text, /🧹 <b>Calendar clean-up<\/b>/)
  for (const t of ['School', 'CS tutor', 'Maths tutor', 'Football training', 'EFA football']) assert.match(card.text, new RegExp(`✓ \\d+\\. <b>${t}</b>`), t)
  assert.match(card.text, /🗄 \d+\. <b>EFA training<\/b> · Sun 08:30 · Google → <b>archive<\/b>/, 'EFA training pre-set to Archive')
  assert.match(card.text, /School lessons \(1: Physics\)/)
  assert.doesNotMatch(card.text, /Dentist/, 'a one-off isn’t recurring')
  // switch CS tutor to Archive and back: the card is redrawn in place
  const cs = card.reply_markup.inline_keyboard.flat().find((b) => / CS tutor/.test(b.text))
  await chat.tap(cs.callback_data, card.message_id)
  assert.match(chat.tg.of('editMessageText').at(-1).body.text, /🗄 \d+\. <b>CS tutor<\/b>/)
  await chat.tap(cs.callback_data, card.message_id)
  assert.match(chat.tg.of('editMessageText').at(-1).body.text, /✓ \d+\. <b>CS tutor<\/b>/)
  await tapOn(card, '✅ Apply')
  assert.match(last().text, /✅ <b>Done<\/b>[\s\S]*EFA training<\/b>: ignored by the app/)
  assert.deepEqual((await planningNow()).ignoredSessions, ['EFA training'])
  assert.equal((await q(`select count(*)::int n from events where archived_at is not null`))[0].n, 0, 'nothing of his archived (he kept them all)')
  const { loadViewData } = await import('../lib/telegram/views.ts')
  assert.ok(!(await loadViewData(sb, T().todayISO())).events.some((e) => e.title === 'EFA training'), 'the app ignores it')
  await tap('Undo')
  assert.deepEqual((await planningNow()).ignoredSessions ?? [], [])
})

test('O7: “which days should I give Owen?” → the optimiser on a typical week: his sessions’ days with reasons, vs Owen’s days, a message to copy; ✅ saves them; Undo', { skip }, async () => {
  await natsWeek()
  await nat('which days should I give Owen?')
  const card = last()
  show(card)
  assert.match(card.text, /🗓 <b>Days to give Owen<\/b>/)
  for (const s of ['Speed \\+ circuits', 'Heavy lower', 'Injury prevention', 'Core']) assert.match(card.text, new RegExp(`• <b>${s}</b>: <b>(Mon|Tue|Wed|Thu|Fri|Sat|Sun)`), s)
  assert.match(card.text, /<code>Hi Owen, the days I can train best are: .+ on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/)
  assert.match(card.text, /Owen’s current (days|suggestion)/)
  chat.noSurprises()
  await tapOn(card, '✅ Use these days')
  const saved = (await planningNow()).owenDays
  assert.ok(saved.speed?.length && saved.heavy_lower?.length, 'saved as his Owen days')
  await tap('Undo')
  assert.equal((await planningNow()).owenDays ?? null, null)
})

const block = (o) => q(`insert into plan_blocks (user_id, plan_id, on_date, start_time, end_time, title, kind, target_id, task_id) values ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8) returning id`,
  [chat.users.owner, o.date, o.start, o.end, o.title, o.kind ?? 'focus', o.target_id ?? null, o.task_id ?? null]).then((r) => r[0])
const tick = async (at) => {
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  return runTick(await openOwnerSession(), OWNER_TG, new Date(at))
}

test('O6: the 07:00 brief and the pinned Today show the day in time order (routine, school, training with place + leave-by, study, routine) with ticks; a tick logs the target; untick puts it back', { skip }, async () => {
  const { setClock } = await import('./support/clock.mjs')
  const { upper, hw } = await natsWeek()
  const tue = past(2)
  await block({ date: tue, start: '16:25', end: '17:25', title: 'Upper @ PureGym Swiss Cottage', kind: 'training', target_id: upper.id })
  await block({ date: tue, start: '18:30', end: '19:15', title: 'Physics homework', kind: 'focus', task_id: hw.id })
  // (item 5: the morning message is Today at 07:30: his plan's things with a tap each, and it is the pinned Today;
  // the whole day in time order is /brief full)
  setClock(T().zonedToUTC(tue, '07:30'))
  try {
    await tick(new Date())
    const brief = chat.tg.sent().find((m) => m.text.startsWith('📌 <b>Today'))
    show(brief)
    assert.match(brief.text, /<i>🏫 School 08:45–16:00<\/i>/)
    assert.match(brief.text, /<b>16:25<\/b> 🏋️ Upper @ PureGym Swiss Cottage <i>· 1h<\/i>\n {5}↳ leave school 16:10 \(15 min\)/)
    assert.match(brief.text, /<b>18:30<\/b> 📌 Physics homework <i>· 45m<\/i>/)
    assert.deepEqual(chat.tg.of('pinChatMessage').map((c) => c.body.message_id), [brief.message_id], 'the morning message is the pinned Today')
    await nat('/brief full')
    const full = chat.tg.sent().at(-1)
    assert.match(full.text, /📋 <b>Your day<\/b> · 🧠(?:🟢|🟡|🔴) 💪(?:⚪|🟢|🟡|🔴)/)
    const order = ['☀️ Morning routine', '🏫 School', '🏋️ Upper @ PureGym Swiss Cottage', '📚 Physics homework', '🌙 Night routine']
    const at = order.map((x) => full.text.indexOf(x))
    assert.ok(at.every((i) => i > 0), `all there: ${at}`)
    assert.deepEqual([...at].sort((a, b) => a - b), at, 'in time order')
    assert.match(full.text, /16:25 🏋️ Upper @ PureGym Swiss Cottage <i>60m<\/i> <i>\(leave school 16:10, 15 min\)<\/i>/)
    // tick Upper on the morning message: done, logged toward Upper; the pinned Today shows it ticked
    await tapOn(brief, '☐ 16:25 Upper')
    assert.equal((await q(`select status from plan_blocks where title like 'Upper%'`))[0].status, 'done')
    assert.equal((await q(`select count(*)::int n from target_logs where target_id = $1`, [upper.id]))[0].n, 1)
    assert.match(chat.tg.of('editMessageText').at(-1).body.text, /✅ <s>16:25 🏋️ Upper/)
    assert.ok(JSON.stringify(chat.tg.of('editMessageText').at(-1).body.reply_markup).includes('✅ 16:25 Upper'), 'its button shows the tick')
    // untick: back to planned, the log goes
    await tapOn({ ...brief, reply_markup: chat.tg.of('editMessageText').at(-1).body.reply_markup }, '16:25 Upper')
    assert.equal((await q(`select status from plan_blocks where title like 'Upper%'`))[0].status, 'planned')
    assert.equal((await q(`select count(*)::int n from target_logs where target_id = $1`, [upper.id]))[0].n, 0)
  } finally { setClock(null) }
})

// (item 5: the evening message replaces the "move the rest? ✅" wrap-up: a tap per item; what isn't ticked rolls on to
// tomorrow by itself — tests/today-chat.test.mjs has the roll-forward)
test('O12: at 21:00, tap what you did (a tap per item, no ✅ card); once a day', { skip }, async () => {
  const { setClock } = await import('./support/clock.mjs')
  const { upper, hw } = await natsWeek()
  const tue = past(2)
  await block({ date: tue, start: '16:25', end: '17:25', title: 'Upper @ PureGym Swiss Cottage', kind: 'training', target_id: upper.id }).then((b) => q(`update plan_blocks set status = 'done' where id = $1`, [b.id]))
  const study = await block({ date: tue, start: '18:30', end: '19:15', title: 'Physics homework', kind: 'focus', task_id: hw.id })
  setClock(T().zonedToUTC(tue, '21:05'))
  try {
    await tick(new Date())
    const m = last()
    show(m)
    assert.match(m.text, /^🌙 <b>Tap what you did today<\/b> <i>\(1\/2 so far\)<\/i>\n✅ Upper @ PureGym Swiss Cottage\n☐ Physics homework\n\n<i>Anything not ticked moves to tomorrow by itself\.<\/i>$/)
    assert.equal((await q(`select count(*)::int n from telegram_pending`))[0].n, 0, 'no ✅ card')
    await tapOn(m, '☐ 18:30 Physics homework')
    assert.equal((await q(`select status from plan_blocks where id = $1`, [study.id]))[0].status, 'done')
    assert.equal((await q(`select status from tasks where id = $1`, [hw.id]))[0].status, 'completed', 'its task is done (archived)')
    assert.match(chat.tg.of('editMessageText').at(-1).body.text, /^🌙 <b>All 2 done today\.<\/b> 👏/)
    // once a day
    await tick(new Date())
    assert.equal(chat.tg.sent().filter((x) => /^🌙/.test(x.text)).length, 1)
  } finally { setClock(null) }
})

test('O18: the first brief after this build brings, in order: the gap questions, the clean-up card, Owen’s days, this week’s card', { skip }, async () => {
  const { setClock } = await import('./support/clock.mjs')
  await natsWeek()
  await q(`delete from telegram_sent where key like 'onboard:%' or key = 'gaps:paused'`)
  const mon = past(1)
  setClock(T().zonedToUTC(mon, '07:30'))   // (item 5: the morning message is at 07:30)
  chat.ai.script(PLAN, () => ({ days: [], note: '', push_back: '' }))
  try {
    await tick(new Date())
    // the week card plans with the AI, so it comes on the next tick (07:35)
    setClock(T().zonedToUTC(mon, '07:35'))
    await tick(new Date())
    const texts = chat.tg.sent().map((m) => m.text)
    const at = (re) => texts.findIndex((t) => re.test(t))
    const brief = at(/^📌 <b>Today/), gaps = at(/I need a few details to plan your week properly — 2 min/), clean = at(/🧹 <b>Calendar clean-up<\/b>/), owen = at(/🗓 <b>Days to give Owen<\/b>/), week = at(/🗓 <b>Your week<\/b>/)
    assert.ok([brief, gaps, clean, owen, week].every((i) => i >= 0), `all sent: ${[brief, gaps, clean, owen, week]}`)
    assert.ok(brief < gaps && gaps < clean && clean < owen && owen < week, 'in that order')
    chat.noSurprises()
    // never again
    setClock(T().zonedToUTC(mon, '07:40'))
    await tick(new Date())
    assert.equal(chat.tg.sent().filter((m) => /Calendar clean-up/.test(m.text)).length, 1)
  } finally { setClock(null) }
})

test('O8: “where can I save time?” → suggestions (time saved + trade-off) with ✅ Apply / ✋ Not now, and where the week goes; applied ones change his set-up (Undo)', { skip }, async () => {
  await natsWeek()
  await nat('where can I save time?')
  const m = last()
  show(m)
  assert.match(m.text, /⏱ <b>Where you can save time this week<\/b>/)
  assert.match(m.text, /Upper is 60 min \(guess\)\. A 40 min version \(supersets, cut the low-value accessories\) keeps about 90% of the benefit and saves \d+ min this week\./)
  assert.match(m.text, /Saves \d+ min\/week · trade-off: /)
  assert.match(m.text, /<b>Where this week goes<\/b>\n🏫 School \d+h[\s\S]*🕊 Free/)
  chat.noSurprises()
  const n = m.text.split('\n').find((l) => /Upper is 60 min/.test(l)).match(/^(\d)\./)[1]
  await tapOn(m, `✅ Apply ${n}`)
  assert.match(last().text, /✅ <b>Done<\/b>\n• 🏋️ <b>Upper<\/b>: \? → 40 min/)
  assert.equal((await planningNow()).sessionTypes.find((s) => s.key === 'upper').minutes, 40)
  const undo = last()
  // asked again: what he applied this week isn't suggested again; ✋ Not now hides one for the week
  await nat('where can I save time?')
  const again = last()
  assert.doesNotMatch(again.text, /Upper is 60 min/)
  const other = again.reply_markup?.inline_keyboard?.flat().find((b) => /✋ Not now/.test(b.text))
  if (other) {
    await chat.tap(other.callback_data, again.message_id)
    assert.match(last().text, /✋ Not now: I won’t suggest it again this week\./)
  }
  await tapOn(undo, 'Undo')
  assert.equal((await planningNow()).sessionTypes, undefined, 'back to the defaults')
})

const act = (o) => ({ op: 'setting', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
/** One instruction: the brain (scripted) proposes these changes; the card must say `line`; ✅ applies. */
async function change(words, actions, line) {
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: actions.map((a) => act({ ...a, ref: typeof a.ref === 'function' ? a.ref(body) : a.ref ?? '' })) }))
  await nat(words)
  const card = last()
  show(card)
  assert.match(card.text, line, words)
  await tapOn(card, '✅ Apply')
  assert.match(last().text, /✅ <b>Done<\/b>/, `${words}: applied`)
  return last()
}

test('O13: everything by chat (scripted brain): game this week, a Google session over, places, session length, Owen’s days, upper this week, a school day, plan blocks, a subject, a target, restore, mental load; the brain sees the optimiser’s week', { skip }, async () => {
  const { hw } = await natsWeek()
  const sat = chat.next(6)
  await change('game is Saturday this week', [{ op: 'game_week', value: `date=${sat}`, words: 'Saturday' }], /⚽ Game, week of .*: Sun 08:30–16:00 \(usual\) → <b>Sat \d+ \w+, leave 08:30, back 16:00<\/b>/)
  assert.match(chat.lastBrainText(), /<week_plan>\nThe optimiser's week/, 'the brain gets the optimiser’s week')
  assert.match(chat.lastBrainText(), /## His set-up[\s\S]*PureGym Swiss Cottage/, 'and his set-up in the snapshot')
  await add('events', { title: 'EFA training', starts_at: T().zonedToUTC(chat.next(7), '08:30'), ends_at: T().zonedToUTC(chat.next(7), '10:00'), external_source: 'google', external_id: 'efa-1' })
  await change('EFA training is over', [{ op: 'session_ignore', value: 'title=EFA training; ignore=yes' }], /🗄 <b>EFA training<\/b>: the app ignores it from now on/)
  await change('PureGym is 25 min by bus from home', [{ op: 'setup_set', value: 'place=PureGym; fromHome=25; toHome=25' }], /📍 <b>PureGym Swiss Cottage<\/b>: from home 30 → 25 min; back home 30 → 25 min/)
  await change('upper takes 50 min', [{ op: 'setup_set', value: 'session=Upper; minutes=50' }], /🏋️ <b>Upper<\/b>: \? → 50 min/)
  await change('Owen’s days are Tue and Thu', [{ op: 'owen_days', value: 'speed=tue; heavy_lower=thu' }], /🗓 Fixed days: <b>Speed \+ circuits Tue, Heavy lower Thu<\/b>/)
  await change('do upper 3x this week', [{ op: 'upper_week', value: 'count=3' }], /💪 Upper this week: <b>3×<\/b>/)
  await change('school ends 15:30 on Wednesdays', [{ op: 'school_day', value: 'day=wed; end=15:30' }], /🏫 <b>School<\/b> on Wednesdays: 08:45–16:00 → <b>08:45–15:30<\/b>/)
  assert.deepEqual((await q(`select repeat_days, end_time::text e from events where title = 'School' and archived_at is null order by created_at`)).map((r) => [r.repeat_days, r.e]), [[[1, 2, 4, 5], '16:00:00'], [[3], '15:30:00']])
  const p = await planningNow()
  assert.equal(p.gameWeeks[T().weekStartISO(T().todayISO())].date, sat)
  assert.deepEqual(p.ignoredSessions, ['EFA training'])
  assert.equal(p.trainingPlaces.find((x) => x.key === 'puregym').fromHome, 25)
  assert.deepEqual(p.owenDays, { speed: [2], heavy_lower: [4] })
  assert.equal(p.upperWeeks[T().weekStartISO(T().todayISO())], 3)
  // plan blocks: move study to 5pm, skip gym today
  const day = chat.next(2)
  await block({ date: day, start: '18:30', end: '19:15', title: 'Physics homework', kind: 'focus', task_id: hw.id })
  await block({ date: day, start: '16:10', end: '17:10', title: 'Upper @ School gym', kind: 'training' })
  const bref = (title) => (body) => body.messages[0].content[0].text.match(new RegExp(`(B\\d+) \\| [^\\n]*${title}`))[1]
  await change('move study to 5pm', [{ op: 'block_move', ref: bref('Physics homework'), time: '17:00', words: '5pm' }], /🗓 <b>Physics homework<\/b>: \w+ \d+ \w+ 18:30 → <b>\w+ \d+ \w+ 17:00–17:45<\/b>/)
  await change('skip gym that day', [{ op: 'block_skip', ref: bref('Upper @ School gym') }], /🗓 <b>Upper @ School gym<\/b> .*: → skipped/)
  assert.deepEqual((await q(`select title, start_time::text s, status from plan_blocks order by title`)).map((r) => [r.title, r.s, r.status]), [['Physics homework', '17:00:00', 'planned'], ['Upper @ School gym', '16:10:00', 'cancelled']])
  // a subject, a weekly target, restore, mental load
  await change('add ACT as a subject', [{ op: 'subject_new', value: 'name=ACT; area=Study' }], /📚 New subject: <b>ACT<\/b>/)
  await change('swimming twice a week as a target', [{ op: 'target_new', value: 'name=Swimming; count=2; type=other' }], /🎯 New weekly target: <b>Swimming<\/b> 2× a week/)
  await add('tasks', { title: 'Guitar idea', status: 'inbox', archived_at: new Date().toISOString(), archive_reason: 'dropped' })
  await change('bring back the guitar idea', [{ op: 'restore', ref: (body) => body.messages[0].content[0].text.match(/(A\d+) \| Guitar idea/)[1] }], /♻️ <b>Guitar idea<\/b>: Archive → Inbox/)
  assert.equal((await q(`select archived_at from tasks where title = 'Guitar idea'`))[0].archived_at, null)
  await add('events', { title: 'SMC mock', starts_at: T().zonedToUTC(chat.next(4), '09:00'), ends_at: T().zonedToUTC(chat.next(4), '11:00') })
  await change('the SMC mock is max mental', [{ op: 'load_set', value: 'session=SMC mock; mental=max' }], /⚖️ <b>SMC mock<\/b>: .* → <b>legs .* · 🧠 10<\/b>/)
  assert.equal((await q(`select mental from load_costs where title = 'SMC mock' and archived_at is null`))[0].mental, 10)
  chat.noSurprises()
})
