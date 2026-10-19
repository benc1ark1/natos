// Queue item 7 on the TEST database: the weekly check through the real bot (fake Telegram, scripted AI, the clock moved
// back to last week). Sunday 18:00 → ONE message with "Plan next week? ✅" (no Your week card by itself, no check-in
// reminder); the tap → the usual Your week card; quiet hours; /weekly and "how was my week?" any day (no AI); the
// start-of-week snapshot; before the new SQL files ran; the setting off → the old Sunday card.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/weekly-chat.test.mjs
import { test, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { useChat, OWNER_TG } from './support/chat.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const T = () => chat.time
const sent = () => chat.tg.sent()
const checks = () => sent().filter((m) => /📊 <b>Weekly check<\/b>/.test(m.text))
const cards = () => sent().filter((m) => /🗓 <b>Your week<\/b>/.test(m.text))
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}\n${JSON.stringify(m.reply_markup?.inline_keyboard?.map((r) => r.map((b) => b.text)) ?? [])}`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** The most recent past date with this ISO weekday (1 = Mon … 7 = Sun), never today. */
const past = (dow) => { let d = T().addDays(T().todayISO(), -1); while (T().isoDow(d) !== dow) d = T().addDays(d, -1); return d }
const setAt = async (date, hhmm) => { const { setClock } = await import('./support/clock.mjs'); setClock(T().zonedToUTC(date, hhmm)) }
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })
beforeEach(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })   // each test starts from the real today
async function tick() {
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  return runTick(await openOwnerSession(), OWNER_TG, new Date())
}
const subject = async (name) => (await q(`select id from subjects where user_id = $1 and name = $2`, [chat.users.owner, name]))[0].id
const setPlanning = (planning) => q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, planning])
const day = (iso) => `${T().dowShort(iso)} ${T().shortDate(iso)}`

/** A realistic week (Mon M … Sun S) across every part of the check. */
async function seedWeek(S) {
  const M = T().addDays(S, -6), D = (n) => T().addDays(M, n)
  const [maths, fm, physics] = [await subject('Maths'), await subject('Further Maths'), await subject('Physics')]
  const pc1 = await add('topics', { subject_id: fm, name: 'Matrices', code: 'PC1-01', status: 'exam_ready', last_done: D(2), sort_order: 1 })
  const pc3 = await add('topics', { subject_id: fm, name: 'Complex numbers', code: 'PC1-03', status: 'not_secure', last_done: T().addDays(M, -2), sort_order: 3 })
  const hw = await add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: `${D(3)}T12:00:00Z`, subject_id: physics, duration_minutes: 45 })
  await add('tasks', { title: 'Sign the trip form', status: 'this_week', importance: 'must', due_at: `${T().addDays(S, 1)}T08:00:00Z` })   // due Monday
  const plan = randomUUID()
  const blk = (on_date, title, o = {}) => add('plan_blocks', { plan_id: plan, on_date, start_time: '17:00', end_time: '17:45', title, kind: 'focus', status: 'planned', ...o })
  await blk(D(0), '🚀 Maths: Vectors', { status: 'done' })
  await blk(D(2), '🚀 Maths: Vectors')
  await blk(D(2), 'PC1-01 Matrices: review', { status: 'done', pick_key: `topic:${pc1.id}:review`, topic_id: pc1.id })
  await blk(D(3), 'Physics homework', { task_id: hw.id })
  await blk(D(5), 'ACT English: timed section', { status: 'done', pick_key: 'act:english:timed' })
  await blk(S, '🚀 Maths: Vectors', { start_time: '19:00', end_time: '19:45' })   // Sunday evening: not missed at 18:05
  await blk(D(0), 'Upper @ PureGym', { kind: 'training', status: 'done', start_time: '16:30', end_time: '18:00' })
  await add('weekly_snapshots', { week_start: M, topics: { [pc1.id]: ['understand', T().addDays(M, -3)], [pc3.id]: ['not_secure', T().addDays(M, -2)] }, mistakes: {} })
  const mk = await add('mistakes', { subject_id: fm, topic_id: pc3.id, body: 'assumed it went through the origin', code: 'PC1-03', question: 'Q3b', kind: 'knowledge', logged_on: T().addDays(M, -4), review_on: T().addDays(S, 5), redo_stage: 1 })
  await q(`update weekly_snapshots set mistakes = $2 where week_start = $1`, [M, { [mk.id]: 0 }])
  await add('goals', { title: 'FM HT2', kind: 'test', target_date: T().addDays(S, 10), subject_id: fm, test_kind: 'test', topic_codes: ['PC1-01', 'PC1-03'] })
  await add('act_scores', { taken_on: T().addDays(M, -30), kind: 'real', english: 34, maths: 34, reading: 35, science: 35, composite: 34 })
  await add('act_scores', { taken_on: D(5), kind: 'practice', english: 35, maths: 33, reading: 36 })
  await add('lift_sets', { done_on: T().addDays(M, -7), exercise: 'Bench press', exercise_key: 'bench press', weight_kg: 80, reps: 3, sets: 3 })
  await add('lift_sets', { done_on: D(0), exercise: 'Bench press', exercise_key: 'bench press', weight_kg: 80, reps: 5, sets: 3 })
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 2 })
  await add('target_logs', { target_id: upper.id, done_on: D(0), amount: 1 })
  const step = await add('programmes', { name: 'STEP', area: 'study', subject_id: maths, per_week: 1, days: 'weekend', minutes: 75 })
  await add('programme_items', { programme_id: step.id, position: 1, title: 'STEP Support Assignment 4' })
  return { M, D, pc1, pc3, hw, maths, fm, physics }
}

test('W1: Sunday at the week-reset time → ONE weekly check (once) with “Plan next week? ✅”; no Your week card by itself, no check-in reminder', { skip }, async () => {
  const S = past(7)
  const { M, D } = await seedWeek(S)
  await setAt(S, '18:05')
  await tick()
  await setAt(S, '18:10')
  await tick()
  assert.equal(checks().length, 1, 'one weekly check, once')
  const m = checks()[0]
  show(m)
  const lines = m.text.split('\n')
  assert.equal(lines[0], `📊 <b>Weekly check</b> · Mon ${+M.slice(8)}${M.slice(5, 7) === S.slice(5, 7) ? '' : ` ${T().shortDate(M).split(' ')[1]}`} – ${day(S)}`)
  assert.equal(lines[1], '📚 Maths 1/2 · FM 1/1 · Physics 0/1 · ACT 1/1', 'done vs planned per subject (training left out)')
  assert.equal(lines[2], '🎯 ⬆️ 1 topic up a colour (🟢 PC1-01) · reviews 1 done · 1 due · 1 mistake redone', 'tracker movement against Monday’s starting point')
  assert.equal(lines[3], '📈 ACT 35 ⬆️ from 34 · goal 36 · weakest Maths 33')
  assert.equal(lines[4], '🏋️ 🏆 Bench press e1RM 93.3 kg · Upper 1/2', 'PRs as the gym’s 🏆 alerts')
  assert.equal(lines[5], `⚠️ Behind: Physics homework (due ${T().dowShort(D(3))}), STEP 0/1`)
  assert.equal(lines[6], '⏰ Before tomorrow: Sign the trip form (Mon)', 'what the daily nudge would have said')
  assert.equal(lines[7], `📝 FM HT2 ${day(T().addDays(S, 10))} (10 days): 🔴 PC1-03`)
  assert.equal(lines[8], `💡 Start Monday with Physics homework: it was due ${day(D(3))}.`, 'one suggestion: overdue homework comes first')
  assert.equal(lines.length, 9, 'one phone screen')
  assert.ok(!sent().some((x) => /Before tomorrow, don’t forget/.test(x.text)), 'no daily nudge on the check-in day: one message')
  assert.deepEqual(m.reply_markup.inline_keyboard.flat().map((b) => b.text), ['Plan next week? ✅'])
  assert.equal(chat.button(m, 'Plan next week'), `wk:plan:${T().addDays(S, 1)}`, 'names the week it plans')
  assert.equal(cards().length, 0, 'the Your week card waits for the tap')
  assert.ok(!sent().some((x) => /Weekly check-in/.test(x.text)), 'no separate check-in reminder')
  assert.ok((await q(`select text from telegram_turns where role = 'bot' and text like '📊 Weekly check%'`)).length === 1, 'remembered, so a reply to it has the context')
  chat.noSurprises()
})

test('W2: tapping “Plan next week? ✅” sends the Your week card for the coming week (once); its ✅ Apply still decides', { skip }, async () => {
  const S = past(7)
  await seedWeek(S)
  await setAt(S, '18:05')
  await tick()
  const m = checks()[0]
  assert.ok(m, 'the weekly check')
  chat.ai.script(PLAN, () => ({ days: [], note: 'Light week of study.', push_back: '' }))
  await setAt(S, '18:20')
  await chat.tap(chat.button(m, 'Plan next week'), m.message_id)
  assert.equal(cards().length, 1, 'the Your week card')
  const card = cards()[0]
  show(card)
  assert.match(card.text, new RegExp(`🗓 <b>Your week</b> · Mon ${+T().addDays(S, 1).slice(8)} `), 'for the coming week')
  assert.ok(chat.button(card, '✅ Apply'), 'nothing is applied until its own ✅')
  assert.equal((await q(`select count(*)::int n from plan_blocks where on_date > $1`, [S]))[0].n, 0, 'nothing saved yet')
  assert.ok(chat.tg.of('editMessageReplyMarkup').some((c) => c.body.message_id === m.message_id && !c.body.reply_markup.inline_keyboard.length), 'the button comes off the weekly check')
  chat.noSurprises()
  // a second tap doesn't plan the week twice
  await chat.tap(chat.button(m, 'Plan next week'), m.message_id)
  assert.equal(cards().length, 1)
  assert.match(sent().at(-1).text, /The Your week card for that went out above ↑\. Say “plan my week” for a fresh one\./)
  chat.noSurprises()
  // ✅ Apply on the card works as before
  await chat.tap(chat.button(card, '✅ Apply'), card.message_id)
  assert.match(sent().filter((x) => !x.text.startsWith('📌')).at(-1).text, /✅ <b>Your week is set<\/b>/)
})

test('W3: never in quiet hours, never before the reset time, only on the check-in day; a later reset time and day are his settings', { skip }, async () => {
  const S = past(7), sat = T().addDays(S, -1)
  await seedWeek(S)
  await setAt(sat, '18:05'); await tick()
  assert.ok(sent().some((x) => /Before tomorrow, don’t forget/.test(x.text)), 'other days keep the daily nudge')
  await setAt(S, '17:55'); await tick()
  assert.equal(checks().length, 0, 'not Saturday, not before 18:00')
  // reset at 21:00, quiet from 21:30: 21:40 is quiet → nothing, and nothing else goes out for it later that night
  await setPlanning({ resetAt: '21:00' })
  await setAt(S, '21:40'); await tick()
  await setAt(S, '22:30'); await tick()
  assert.equal(checks().length, 0, 'quiet hours')
  assert.equal(cards().length, 0)
  // his check-in day moved to Saturday: Saturday at the reset time
  await setPlanning({ checkinDay: 'saturday' })
  await setAt(sat, '18:05'); await tick()
  assert.equal(checks().length, 1)
  assert.equal(checks()[0].reply_markup.inline_keyboard[0][0].text, 'Plan next week? ✅')
  chat.noSurprises()
})

test('W4: /weekly and “how was my week?” any day → the same check (“so far”), instantly, with no AI', { skip }, async () => {
  const S = past(7)
  const { D } = await seedWeek(S)
  const wed = D(2)
  await setAt(wed, '16:30')
  await chat.nat('/weekly')
  const a = sent().at(-1)
  show(a)
  assert.match(a.text, /^📊 <b>Weekly check<\/b> · Mon \d+.* – Sun .+ \(so far\)\n/)
  assert.match(a.text, /\n📚 Maths 1\/1 · FM 1\/1\n/, 'blocks up to now only (the 17:00 Maths block is still to come)')
  assert.match(a.text, /\n💡 FM HT2 is in 14 days and PC1-03 is still 🔴 — start tomorrow with its booklet\.$/, 'midweek: “tomorrow”, not “Monday” (the homework isn’t overdue yet)')
  assert.deepEqual(a.reply_markup.inline_keyboard.flat().map((b) => b.text), ['Plan the rest of the week? ✅'])
  await chat.nat('how was my week?')
  const b = sent().at(-1)
  assert.equal(b.text, a.text, 'the same message')
  await chat.nat('Hows my week been')
  assert.equal(sent().at(-1).text, a.text, 'typo-ish wording too')
  chat.noSurprises()
  // the "/" menu lists it
  const { COMMANDS } = await import('../lib/telegram/bot.ts')
  assert.ok(COMMANDS.some((c) => c.command === 'weekly'))
})

test('W5: Monday’s first tick keeps the week’s starting point (once); Sunday says what moved since', { skip }, async () => {
  const S = past(7), M = T().addDays(S, -6)
  const fm = await subject('Further Maths')
  const t1 = await add('topics', { subject_id: fm, name: 'Matrices', code: 'PC1-01', status: 'understand', last_done: T().addDays(M, -3), sort_order: 1 })
  const t2 = await add('topics', { subject_id: fm, name: 'Roots', code: 'PC1-05', status: 'exam_ready', last_done: T().addDays(M, -2), sort_order: 5 })
  await setAt(M, '00:05'); await tick()
  await setAt(M, '00:10'); await tick()
  const snaps = await q(`select week_start::text w, topics from weekly_snapshots`)
  assert.equal(snaps.length, 1, 'one starting point a week')
  assert.equal(snaps[0].w, M)
  assert.deepEqual(snaps[0].topics[t1.id], ['understand', T().addDays(M, -3)])
  // the week: Matrices goes 🟢 on Wednesday, Roots drops to 🟡 after a test
  await q(`update topics set status = 'exam_ready', last_done = $2 where id = $1`, [t1.id, T().addDays(M, 2)])
  await q(`update topics set status = 'understand' where id = $1`, [t2.id])
  await setAt(S, '18:05'); await tick()
  const m = checks()[0]
  show(m)
  assert.match(m.text, /🎯 ⬆️ 1 topic up a colour \(🟢 PC1-01\) · ⬇️ 1 down · reviews 1 done · 1 due\n/)
  assert.ok(checks().length === 1)
  chat.noSurprises()
})

test('W6: before the new SQL files ran (no tracker, ACT, gym, Today or weekly tables/columns) → still a sensible check', { skip, timeout: 120_000 }, async () => {
  const S = past(7)
  const { D } = await seedWeek(S)
  // hide what tracker.sql, act.sql, gym.sql, today.sql and weekly.sql add (put back afterwards)
  const hide = [
    ['table', 'act_scores'], ['table', 'lift_sets'], ['table', 'weekly_snapshots'], ['table', 'programmes'], ['table', 'programme_items'], ['table', 'test_attempts'],
    ['column', 'topics', 'code'], ['column', 'topics', 'last_done'], ['column', 'goals', 'test_kind'], ['column', 'goals', 'topic_codes'],
    ['column', 'mistakes', 'redo_stage'], ['column', 'plan_blocks', 'pick_key'],
  ]
  const ddl = (back) => hide.map(([kind, t, c]) => kind === 'table'
    ? `alter table public.${back ? `${t}__hidden` : t} rename to ${back ? t : `${t}__hidden`}`
    : `alter table public.${t} rename column ${back ? `${c}__hidden` : c} to ${back ? c : `${c}__hidden`}`).join('; ')
  await q(ddl(false))
  try {
    await sleep(5500)   // the local PostgREST reloads its schema; then a missing table is an error straight away
    await setAt(D(0), '00:05'); await tick()   // Monday: the starting point can't be kept yet, and nothing breaks
    await setAt(S, '18:05')
    await tick()
    const m = checks()[0]
    assert.ok(m, 'the weekly check still goes out')
    show(m)
    assert.match(m.text, /^📊 <b>Weekly check<\/b> · .+\n📚 Maths 1\/2 · Physics 0\/1 · ACT 1\/1 · other 1\/1\n/, 'plan blocks still count, by their links and titles (no pick keys yet)')
    assert.match(m.text, /🏋️ Upper 1\/2\n/)
    assert.match(m.text, /⚠️ Behind: Physics homework \(due \w+\)\n/)
    assert.match(m.text, /💡 Start Monday with Physics homework/)
    assert.doesNotMatch(m.text, /📈 ACT|PR|📝 FM HT2|STEP|undefined|null|NaN/)
    assert.match(m.text, /\n🛠 <b>One thing<\/b>: paste <code>supabase\/weekly\.sql<\/code> into Supabase → SQL Editor → Run/, 'says once which file to run')
    assert.match(m.text, /\n⏰ Before tomorrow: Sign the trip form \(Mon\)\n/)
    assert.ok(m.text.split('\n').length <= 7)
    assert.equal(chat.button(m, 'Plan next week'), `wk:plan:${T().addDays(S, 1)}`)
    await chat.nat('/weekly')
    assert.match(sent().at(-1).text, /📊 <b>Weekly check<\/b>/)
    assert.doesNotMatch(sent().at(-1).text, /supabase\/weekly\.sql/, 'only once')
    chat.noSurprises()
  } finally {
    await q(ddl(true))
  }
  // everything back (and the API sees it again) before the next test
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const sb = await openOwnerSession()
  for (let i = 0; i < 50; i++) { if (!(await sb.from('weekly_snapshots').select('id').limit(1)).error && !(await sb.from('topics').select('code').limit(1)).error) break; await sleep(200) }
})

test('W7: weekly check off → Sunday is the old way: the Your week card by itself at the reset time', { skip }, async () => {
  const S = past(7)
  await seedWeek(S)
  await setPlanning({ weeklyCheck: 'off' })
  chat.ai.script(PLAN, () => ({ days: [], note: '', push_back: '' }))
  await setAt(S, '18:05'); await tick()
  await setAt(S, '18:10'); await tick()
  assert.equal(checks().length, 0)
  assert.equal(cards().length, 1, 'the card, once')
  assert.match(cards()[0].text, new RegExp(`Your week</b> · Mon ${+T().addDays(S, 1).slice(8)} `))
  // and /weekly still works on request
  await chat.nat('/weekly')
  assert.match(sent().at(-1).text, /📊 <b>Weekly check<\/b>/)
  chat.noSurprises()
})

test('W8: “stop the Sunday weekly check” by chat → the setting, on a ✅ card with Undo (the brain sees the setting)', { skip }, async () => {
  const { CHAT } = await import('./support/chat.mjs')
  const { brain } = await import('./support/fakes.mjs')
  const act = (o) => ({ op: 'setting', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
  chat.ai.script(CHAT, () => brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'weeklyCheck=off' })] }))
  await chat.nat('stop the sunday weekly check please')
  assert.match(chat.lastBrainText(), /weeklyCheck = on · Weekly check on your check-in day/)
  const card = sent().filter((x) => !x.text.startsWith('📌')).at(-1)
  assert.match(card.text, /⚙️ Weekly check .+: on → <b>off<\/b>/)
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  const planning = async () => (await q(`select planning from profiles where user_id = $1`, [chat.users.owner]))[0].planning ?? {}
  assert.equal((await planning()).weeklyCheck, 'off')
  const done = sent().filter((x) => !x.text.startsWith('📌')).at(-1)
  await chat.tap(chat.button(done, 'Undo'), done.message_id)
  assert.equal((await planning()).weeklyCheck, undefined, 'back to the default (on)')
  chat.noSurprises()
})

test('W9: a weekday check-in day: the check plans the rest of that week, and Sunday still brings next week’s card', { skip }, async () => {
  const S = past(7), fri = T().addDays(S, -2)
  await seedWeek(S)
  await setPlanning({ checkinDay: 'friday' })
  await setAt(fri, '18:05'); await tick()
  assert.equal(checks().length, 1, 'the check on Friday')
  assert.deepEqual(checks()[0].reply_markup.inline_keyboard.flat().map((b) => b.text), ['Plan the rest of the week? ✅'])
  chat.ai.script(PLAN, () => ({ days: [], note: '', push_back: '' }))
  await setAt(S, '18:05'); await tick()
  assert.equal(checks().length, 1, 'no second check on Sunday')
  assert.equal(cards().length, 1, 'next week is still offered: the Sunday card comes by itself')
  assert.match(cards()[0].text, new RegExp(`Your week</b> · Mon ${+T().addDays(S, 1).slice(8)} `))
  chat.noSurprises()
})

test('W10: a Monday check-in looks back on the week that just ended', { skip }, async () => {
  const mon = past(1), S = T().addDays(mon, -1), M = T().addDays(S, -6)
  await seedWeek(S)
  await setPlanning({ checkinDay: 'monday' })
  await setAt(mon, '18:05'); await tick()
  const m = checks()[0]
  assert.ok(m, 'the check on Monday')
  show(m)
  assert.match(m.text, new RegExp(`^📊 <b>Weekly check</b> · Mon ${+M.slice(8)}.* – Sun ${+S.slice(8)} [A-Z][a-z]{2}\\n`), 'last week, not “so far”')
  assert.match(m.text, /\n📚 Maths 1\/3 · FM 1\/1 · Physics 0\/1 · ACT 1\/1\n/, 'last week’s blocks (Sunday evening’s counts as missed now)')
  assert.match(m.text, /💡 Start today with Physics homework/)
  chat.noSurprises()
})

test('W11: the daily nudge on the check-in day only waits for a check that can still go out', { skip }, async () => {
  const S = past(7)
  await seedWeek(S)
  // the reset time is in quiet hours: no check today, so the nudge goes as usual
  await setPlanning({ resetAt: '22:00' })
  await setAt(S, '18:05'); await tick()
  assert.equal(checks().length, 0)
  assert.ok(sent().some((x) => /Before tomorrow, don’t forget/.test(x.text)), 'the nudge goes')
  chat.noSurprises()
})

test('W12: “already planned” comes from the Your week card itself: a run that died leaves no card, so a later tap plans it', { skip }, async () => {
  const S = past(7), next = T().addDays(S, 1)
  await seedWeek(S)
  await setAt(S, '18:05'); await tick()
  const m = checks()[0]
  // a tap a minute ago is still planning: wait for it
  await add('telegram_sent', { key: `weekly-plan:${next}`, created_at: new Date(Date.now() - 60_000).toISOString() })
  await setAt(S, '18:06')
  await chat.tap(chat.button(m, 'Plan next week'), m.message_id)
  assert.match(sent().at(-1).text, /Planning it now: the Your week card comes in a moment\./)
  assert.equal(cards().length, 0)
  // ten minutes later still no card: that run died (the webhook's time ran out) → this tap plans it
  await q(`update telegram_sent set created_at = $2 where key = $1`, [`weekly-plan:${next}`, new Date(Date.now() - 10 * 60_000).toISOString()])
  chat.ai.script(PLAN, () => ({ days: [], note: '', push_back: '' }))
  await chat.tap(chat.button(m, 'Plan next week'), m.message_id)
  assert.equal(cards().length, 1, 'planned')
  // cancelled: no card waiting any more, so the button plans it again
  await chat.tap(chat.button(cards()[0], 'Cancel'), cards()[0].message_id)
  chat.ai.script(PLAN, () => ({ days: [], note: '', push_back: '' }))
  await q(`update telegram_sent set created_at = $2 where key = $1`, [`weekly-plan:${next}`, new Date(Date.now() - 10 * 60_000).toISOString()])
  await chat.tap(chat.button(m, 'Plan next week'), m.message_id)
  assert.equal(cards().length, 2, 'a fresh card after the cancel')
  chat.noSurprises()
})

test('W13: the button plans the week it names: a Friday “plan the rest of the week” tapped on Saturday says so instead of planning next week', { skip }, async () => {
  const S = past(7), fri = T().addDays(S, -2), sat = T().addDays(S, -1)
  await seedWeek(S)
  await setAt(fri, '16:00')
  await chat.nat('/weekly')
  const m = sent().at(-1)
  assert.equal(chat.button(m, 'Plan the rest'), `wk:plan:${T().addDays(S, -6)}`)
  await setAt(sat, '10:00')
  await chat.tap(chat.button(m, 'Plan the rest'), m.message_id)
  assert.equal(sent().at(-1).text, 'That check is from an earlier week — say “plan my week”.')
  assert.equal(cards().length, 0)
  chat.noSurprises()
})

test('W14: review counts use his review gaps (the tracker’s settings), like the planner', { skip }, async () => {
  const S = past(7), M = T().addDays(S, -6), fri = T().addDays(S, -2)
  const fm = await subject('Further Maths')
  const t = await add('topics', { subject_id: fm, name: 'Matrices', code: 'PC1-01', status: 'understand', last_done: fri, sort_order: 1 })
  await add('weekly_snapshots', { week_start: M, topics: { [t.id]: ['understand', fri] }, mistakes: {} })
  await setAt(S, '16:00')
  await chat.nat('/weekly')
  assert.doesNotMatch(sent().at(-1).text, /review/, '🟡 +3 days: due Monday, not yet')
  await setPlanning({ reviewYellowDays: 1 })
  await chat.nat('/weekly')
  assert.match(sent().at(-1).text, /\n🎯 1 review due\n/, '🟡 +1 day: due Saturday')
  assert.match(sent().at(-1).text, /💡 1 review due — start Monday with PC1-01/)
  chat.noSurprises()
})
