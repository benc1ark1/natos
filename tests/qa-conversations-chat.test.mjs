// Final QA (queue "TESTING"): 60+ short Telegram conversations across every area, table-driven, on the TEST database
// (the real bot, a fake Telegram, a scripted AI). Normal words, typos, slang, vague requests, changes (✏️), cancels (❌),
// undo (↩️), and things it can't do (→ one line + App ideas). Each says what Nat sees and what is in the database after
// ✅ or ❌. The rule under every one: NOTHING of his changes before ✅ (checked after every message: a fingerprint of
// all his data tables). Routing is asserted too: fast paths call no AI at all; the quick router answers small talk and
// lists without the brain; everything else goes to the brain (scripted here, as in the other chat tests).
// The clock is Monday 10:00 last week, so "tomorrow", "Sat" and "Wed" always mean the same days.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/qa-conversations-chat.test.mjs
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT, ROUTE } from './support/chat.mjs'
import { brain, routed, sorted } from './support/fakes.mjs'
import { fakeGoogle } from './support/fake-google.mjs'
import { seed as seedTracker } from './support/tracker-bot.mjs'

const chat = useChat()
const skip = chat.skip
let g, MON
const clock = () => import('./support/clock.mjs')
before(async () => {
  if (skip) return
  g = await fakeGoogle()
  Object.assign(process.env, g.env, { TOKEN_KEY: '5a'.repeat(32) })
})
after(async () => { g?.close(); (await clock()).setClock(null) })
beforeEach(async () => {
  if (skip) return
  g.reset()
  const { setClock } = await clock()
  setClock(null)
  MON = T().addDays(T().weekStartISO(T().todayISO()), -7)
  setClock(T().zonedToUTC(MON, '10:00'))
})

const T = () => chat.time
const D = (n) => T().addDays(MON, n)            // D(0) = Monday (today), D(1) = tomorrow …
const day = (iso) => `${T().dowShort(iso)} ${T().shortDate(iso)}`
const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
/** Every message the bot sent, each as it looks now (Telegram edits applied), not the pinned Today. */
const bot = () => chat.tg.sent().map((m) => {
  const e = chat.tg.of('editMessageText').filter((c) => c.body.message_id === m.message_id).at(-1)
  return e ? { ...m, text: e.body.text, reply_markup: e.body.reply_markup } : m
}).filter((m) => !m.text.startsWith('📌 <b>Today'))
const last = () => bot().at(-1)
const act = (o) => ({ op: 'setting', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const refIn = (body, re) => { const t = body.messages[0].content.map((x) => x.text).join('\n'); const m = t.match(re); assert.ok(m, `no ref ${re} in the snapshot`); return m[1] }
const ONE_LINE = /^I can’t do that yet — it needs adding in Claude Code\. 💡 Saved to your App ideas \(\/ideas\)\.$/

// ---- his data, fingerprinted: every table of his records (not the bot's own: turns, cards, sent keys, AI usage,
// App ideas, Today's saved list). "Nothing changes before ✅" = the fingerprint is the same after the message.
const MINE = ['act_scores', 'categories', 'day_state', 'event_exceptions', 'events', 'goals', 'guides', 'habit_items', 'habit_logs', 'habits', 'lift_sets', 'mistakes',
  'places', 'plan_rules', 'profiles', 'programme_items', 'programmes', 'projects', 'reminders', 'resources', 'routine_steps', 'subjects', 'target_logs', 'target_weeks',
  'tasks', 'test_attempts', 'topic_progress', 'topics', 'training_rules', 'travel_times', 'weekly_targets']
async function fingerprint() {
  const out = {}
  for (const t of MINE) out[t] = (await q(`select count(*)::int n, md5(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), '')) h from public.${t} x`))[0]
  return out
}
const changed = (a, b) => MINE.filter((t) => a[t].h !== b[t].h)

// ---- a small, realistic starting point: his tracker (topics in every colour, 3 tests, mistakes, STEP, a rule),
// football Mon + Wed, a family dinner on Saturday, Physics homework due Wed, his weekly targets
async function seed() {
  const ids = await seedTracker(chat)
  const own = chat.users.owner
  const phys = (await q(`select id from subjects where user_id = $1 and name = 'Physics'`, [own]))[0].id
  ids.football = (await add('events', { title: 'Football', repeat_days: [1, 3], start_time: '18:00', end_time: '19:30', repeat_from: D(-28), training_type: 'football', load: 'hard' })).id
  ids.dinner = (await add('events', { title: 'Family dinner', starts_at: T().zonedToUTC(D(5), '19:00'), ends_at: T().zonedToUTC(D(5), '21:00') })).id
  ids.hw = (await add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: T().zonedToUTC(D(2), '08:45'), duration_minutes: 45, subject_id: phys, origin: 'school' })).id
  await add('weekly_targets', { name: 'Upper', target_count: 2 })
  await q(`update profiles set planning = $1 where user_id = $2`, [{ holidays: 'none', owenDays: { speed: [2], heavy_lower: [4] } }, own])
  return ids
}

/**
 * One conversation. steps:
 *   'text'                      Nat sends it (a card it shows must have changed nothing)
 *   { tap: 'Apply' }            taps that button on the newest message that has it
 *   { see: /re/ }               the bot's last message matches
 *   { brain: o | fn }           the brain's next answer (fn gets the request body)
 *   { route: o } { sort: o }    the quick router's / the sorter's next answer
 *   { db: async (ids) => … }    checks the database
 *   { same: true }              nothing of his changed since the conversation started
 * ai: 'none' (no AI at all) · 'router' (the router answered, no brain) · 'brain' (the brain was asked) · 'sorter'.
 */
const CASES = []
const C = (area, name, ai, steps, opts = {}) => CASES.push({ area, name, ai, steps, ...opts })

// ===================================================================== study tracker (fast paths: no AI)
C('tracker', 'normal words: "matrices 🟢" → card; ✅ → green, review in 14 days', 'none', [
  'matrices 🟢', { see: /🔧 <b>Change<\/b>\n• <b>PC1-01 Matrices<\/b>: 🔴 → <b>🟢<\/b>/ }, { tap: 'Apply' }, { see: /✅ <b>Done<\/b>/ },
  { db: async () => assert.equal((await q(`select status from topics where code = 'PC1-01'`))[0].status, 'exam_ready') }])
C('tracker', 'typos: "matrics grean" → the same card; ❌ → nothing changed', 'none', [
  'matrics grean', { see: /<b>PC1-01 Matrices<\/b>: 🔴 → <b>🟢<\/b>/ }, { tap: 'Cancel' }, { see: /^Cancelled\. Nothing changed\.$/ }, { same: true }])
C('tracker', 'a change: "set trig yellow" → ✏️ "no, red" (the brain reads the correction) → corrected card → ✅ red', 'brain', [
  'set trig yellow', { see: /Y1-10 Trigonometric functions &amp; equations<\/b>: ⚪ → <b>🟡<\/b>/ }, { tap: 'Change' }, { see: /✏️ What should be different\?/ },
  { brain: brain({ intent: 'instruction', reply: 'Trig to red.', actions: [act({ op: 'trk_colour', ref: 'Y1-10', value: 'colour=red' })] }) }, 'no, red',
  { see: /✏️ <b>Corrected<\/b>[\s\S]*⚪ → <b>🔴<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select status from topics where code = 'Y1-10'`))[0].status, 'not_secure') }])
C('tracker', 'a score: "did Bicen matrices set 8/10" → 80 % → 🟡, step 4', 'none', [
  'did Bicen matrices set 8/10', { see: /<b>PC1-01 Matrices<\/b>: Bicen set 8\/10 = 80% · 🔴 → <b>🟡<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.deepEqual(Object.values((await q(`select status, step, fresh_pct::int p from topics where code = 'PC1-01'`))[0]), ['understand', 4, 80]) }])
C('tracker', 'vague-ish: "finished textbook exercise on logs" → step 2', 'none', [
  'finished textbook exercise on logs', { see: /<b>Y1-07 Logarithms<\/b>: textbook exercise/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select step from topics where code = 'Y1-07'`))[0].step, 2) }])
C('tracker', 'a mistake: "mistake: PC1-03 Q3b assumed through origin – knowledge" → redo in 3 days', 'none', [
  'mistake: PC1-03 Q3b assumed through origin – knowledge', { see: /📝 Mistake <b>PC1-03 Applications of matrices Q3b<\/b>: “assumed through origin” · Knowledge · redo / }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select count(*)::int n from mistakes where body = 'assumed through origin' and kind = 'knowledge' and review_on = $1`, [D(3)]))[0].n, 1) }])
C('tracker', 'a redo: "redid PC1-03 Q3b" → redo 1 of 2, next in a week', 'none', [
  'redid PC1-03 Q3b', { see: /🔁 <b>PC1-03 Q3b<\/b>.*redo 1 of 2 ✓/ }, { tap: 'Apply' },
  { db: async () => assert.deepEqual(Object.values((await q(`select redo_stage, review_on::text from mistakes where question = 'Q3b'`))[0]), [1, D(7)]) }])
C('tracker', 'a test score: "HT2 practice 38/45" → an attempt, 84 %', 'none', [
  'HT2 practice 38/45', { see: /📝 <b>FM HT2 test<\/b>: timed practice 38\/45 = <b>84%<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.deepEqual(Object.values((await q(`select score::int, out_of::int from test_attempts`))[0]), [38, 45]) }])
C('tracker', 'a rule with an end: "pause getting ahead until <date>" → ✅ a pause rule ending then', 'none', [
  () => `pause getting ahead until ${T().shortDate(D(10))}`, { see: /📌 New rule: <b>.*getting ahead/i }, { tap: 'Apply' },
  { db: async () => assert.deepEqual(Object.values((await q(`select kind, target, ends_on::text from plan_rules where archived_at is null and kind = 'pause' and target = 'ahead'`))[0]), ['pause', 'ahead', D(10)]) }])
C('tracker', 'a rule with no end: "pause getting ahead" → asks when; "this week" tap → card', 'none', [
  'pause getting ahead', { see: /❓ <b>When should it end\?<\/b>/ }, { same: true }, { tap: 'This week' }, { see: /📌 New rule/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select ends_on::text from plan_rules where target = 'ahead' and archived_at is null`))[0].ends_on, D(6)) }])
C('tracker', 'priorities: "ACT top priority this week" → a boost rule until Sunday', 'none', [
  'ACT top priority this week', { see: /📌 New rule: <b>ACT top priority<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.deepEqual(Object.values((await q(`select kind, ends_on::text from plan_rules where words ilike '%ACT%'`))[0]), ['boost', D(6)]) }])
C('tracker', 'a cap: "maths + physics 45 min/day this week" → a cap rule', 'none', [
  'maths + physics 45 min/day this week', { see: /📌 New rule: <b>Maths \+ Further Maths \+ Physics max 45 min\/day<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select minutes from plan_rules where kind = 'cap'`))[0].minutes, 45) }])
C('tracker', 'a programme: "done STEP 3, solved with hints" → item 3 done', 'none', [
  'done STEP 3, solved with hints', { see: /✅ <b>STEP<\/b> #3 .*todo → <b>done<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select status from programme_items where position = 3`))[0].status, 'done') }])
C('tracker', '"it": "PC1-01 yellow" ✅ then "make it green" → the same topic', 'none', [
  'PC1-01 yellow', { tap: 'Apply' }, 'make it green', { see: /<b>PC1-01 Matrices<\/b>: 🟡 → <b>🟢<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select status from topics where code = 'PC1-01'`))[0].status, 'exam_ready') }])
C('tracker', 'vague with nothing to point at: "make it green" → the brain asks which topic, nothing changes', 'brain', [
  { brain: brain({ intent: 'unclear', reply: 'Which topic should go green?' }) }, 'make it green', { see: /^Which topic/ }, { same: true }])
C('tracker', 'a question: /tests → the tests with days left', 'none', ['/tests', { see: /<b>FM HT2 test<\/b> · .* · <b>\d+ days<\/b>/ }, { same: true }])
C('tracker', 'a question: /maths → the colour chips', 'none', ['/maths', { see: /^📐 <b>Maths \+ Further Maths<\/b>/ }, { same: true }])
C('tracker', 'a question: /review → what is due', 'none', ['/review', { see: /^🔁 <b>Due today<\/b>/ }, { same: true }])
C('tracker', 'can’t do: "sync my tracker to google sheets every day" → one line + App ideas', 'none', [
  'sync my tracker to google sheets every day', { see: ONE_LINE }, { same: true },
  { db: async () => assert.equal((await q(`select count(*)::int n from app_ideas where source_text = 'sync my tracker to google sheets every day' and status = 'open'`))[0].n, 1) }])
C('tracker', '"export my tracker" → a CSV document, nothing changed', 'none', [
  'export my tracker', { db: async () => assert.equal(chat.tg.of('sendDocument').length, 1) }, { same: true }])

// ===================================================================== ACT (fast paths)
const setUpAct = ['set up ACT', { see: /🎯 <b>ACT set-up<\/b>/ }, { same: true }, { tap: 'Apply' }]
C('act', 'set-up: "set up ACT" → one card; ✅ → the books, flashcards and last real score', 'none', [
  ...setUpAct, { db: async () => assert.equal((await q(`select count(*)::int n from programmes where area = 'act'`))[0].n, 6) }])
C('act', 'typos: "ACT pratice: E 33, M35 r34" → a practice score', 'none', [
  ...setUpAct, 'ACT pratice: E 33, M35 r34', { see: /E33 M35 R34/ }, { tap: 'Apply' },
  { db: async () => assert.deepEqual(Object.values((await q(`select english, maths, reading from act_scores where kind = 'practice'`))[0]), [33, 35, 34]) }])
C('act', 'countdown: "ACT retake is 12 Dec" → ✅ a retake date', 'none', [
  ...setUpAct, 'ACT retake is 12 Dec', { see: /🎯 ACT retake: <b>/ }, { tap: 'Apply' }, { see: /🔥 Countdown/ },
  { db: async () => assert.equal((await q(`select count(*)::int n from goals where test_kind = 'act' and archived_at is null`))[0].n, 1) }])
C('act', 'a test with no date: "retaking the ACT" → asks the date, nothing saved', 'none', [
  ...setUpAct, 'retaking the ACT', { see: /date|When/i }, { db: async () => assert.equal((await q(`select count(*)::int n from goals where test_kind = 'act'`))[0].n, 0) }])
C('act', 'a miss: "ACT miss: english Q12 comma splice — joined two sentences with a comma"', 'none', [
  ...setUpAct, 'ACT miss: english Q12 comma splice — joined two sentences with a comma', { see: /comma splice/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select rule from mistakes where question = 'Q12'`))[0].rule, 'comma splice') }])
C('act', 'a book: "finished Meltzer chapter 1" → chapter 1 done', 'none', [
  ...setUpAct, 'finished Meltzer chapter 1', { see: /Meltzer|ACT English/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select i.status from programme_items i join programmes p on p.id = i.programme_id where p.name like '%Meltzer%' and i.title = 'Chapter 1'`))[0].status, 'done') }])
C('act', 'a question: /act → the plan for today', 'none', [...setUpAct, '/act', { see: /ACT/ }])

// ===================================================================== gym (fast paths)
C('gym', 'a lift: "bench 80x5x3" → card with e1RM; ✅ → one lift saved', 'none', [
  'bench 80x5x3', { see: /<b>Bench press<\/b> 80 kg × 5 × 3 · e1RM 93.3 kg/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select count(*)::int n from lift_sets where exercise_key = 'bench press' and archived_at is null`))[0].n, 1) }])
C('gym', 'typos: "benhc 80x5x3" → the same; ❌ → nothing', 'none', [
  'benhc 80x5x3', { see: /<b>Bench press<\/b> 80 kg × 5 × 3/ }, { tap: 'Cancel' }, { same: true }])
C('gym', 'slang + lbs: "squats 225lbs 3x5" → kg', 'none', [
  'squats 225lbs 3x5', { see: /<b>Squat<\/b> 102.06 kg × 5 × 3/ }, { tap: 'Apply' },
  { db: async () => assert.equal(Number((await q(`select weight_kg from lift_sets`))[0].weight_kg), 102.06) }])
C('gym', 'vague: "did bench" → asks how much (no card)', 'none', [
  'did bench', { see: /How much\? Send it like “bench 80x5x3”/ }, { same: true },
  { db: async () => assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action' and status = 'open'`))[0].n, 0) }])
C('gym', 'a change: "squat 100 5x5" → ✏️ "actually it was 102.5" (through the brain) → corrected → ✅', 'brain', [
  'squat 100 5x5', { tap: 'Change' }, { brain: brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'lift_log', value: 'exercise=squat; weight=102.5; reps=5; sets=5' })] }) }, 'actually it was 102.5', { see: /✏️ <b>Corrected<\/b>[\s\S]*102.5 kg × 5 × 5/ }, { tap: 'Apply' },
  { db: async () => assert.equal(Number((await q(`select weight_kg from lift_sets`))[0].weight_kg), 102.5) }])
C('gym', 'undo: "deadlift 140kg 3x5" ✅ then ↩️ Undo → archived, never deleted', 'none', [
  'deadlift 140kg 3x5', { tap: 'Apply' }, { tap: 'Undo' },
  { db: async () => { const r = await q(`select archived_at from lift_sets`); assert.equal(r.length, 1); assert.ok(r[0].archived_at) } }])
C('gym', 'a question: /owen → a ready-to-send message to Owen', 'none', ['/owen', { see: /^📋 <b>Message for Owen<\/b>/ }, { same: true }])
C('gym', 'a question: /gym → his lifts', 'none', ['bench 80x5x3', { tap: 'Apply' }, '/gym', { see: /Bench press/ }])

// ===================================================================== events + life (fast paths)
C('life', 'normal words: "out with friends tomorrow 2–9pm" → a Life OS event after ✅', 'none', [
  'out with friends tomorrow 2–9pm', { see: /➕ <b>New in your calendar<\/b>/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select count(*)::int n from events where title ilike 'out with friends%' and archived_at is null`))[0].n, 1) }])
C('life', 'casual time: "family dinner Sun 7" → 19:00–21:00; ❌ → nothing', 'none', [
  'family dinner Sun 7', { see: new RegExp(`📅 New: <b>Family dinner</b> .* 19:00–21:00`) }, { tap: 'Cancel' }, { same: true }])
C('life', 'a range: "cinema with Sam Friday 8-11" → 20:00–23:00', 'none', [
  'cinema with Sam Friday 8-11', { see: /<b>Cinema with Sam<\/b> .* 20:00–23:00/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select count(*)::int n from events where title = 'Cinema with Sam'`))[0].n, 1) }])
C('life', 'a cancel: "dinner’s off" → archived after ✅ (can be restored)', 'none', [
  'dinner’s off', { see: /<b>Family dinner<\/b>: → cancelled/ }, { same: true }, { tap: 'Apply' },
  { db: async (ids) => assert.ok((await q(`select archived_at from events where id = $1`, [ids.dinner]))[0].archived_at) }])
C('life', 'one week only: "cancel football Wed" → a one-week change', 'none', [
  'cancel football Wed', { see: /<b>Football<\/b> .*→ cancelled <i>\(just this week\)/ }, { tap: 'Apply' },
  { db: async (ids) => assert.deepEqual(Object.values((await q(`select on_date::text, cancelled from event_exceptions where event_id = $1`, [ids.football]))[0]), [D(2), true]) }])
C('life', 'a move: "move football to Thu 8" → this week only, 20:00', 'none', [
  'move football to Thu 8', { see: /<b>Football<\/b>: .* → .* 20:00–21:30 <i>\(just this week\)/ }, { tap: 'Apply' },
  { db: async (ids) => assert.equal((await q(`select new_start::text from event_exceptions where event_id = $1`, [ids.football]))[0].new_start, '20:00:00') }])
C('life', 'recurring: "climbing every Tue 5-6:30" → a weekly event', 'none', [
  'climbing every Tue 5-6:30', { see: /every Tue 17:00–18:30/ }, { tap: 'Apply' },
  { db: async () => assert.deepEqual((await q(`select repeat_days from events where title ilike 'climbing%'`))[0].repeat_days, [2]) }])
C('life', 'a question: "/free tomorrow" → free slots', 'none', ['/free tomorrow', { see: /Free/ }, { same: true }])

// ===================================================================== Today, help, weekly, ideas (fast paths)
C('today', '/today → at most 5 things, a tap each', 'none', ['/today', { db: async () => {
  const m = chat.tg.sent().at(-1)
  assert.match(m.text, /^📌 <b>Today/)
  const taps = (m.reply_markup?.inline_keyboard ?? []).flat()
  assert.ok(taps.length >= 1 && taps.length <= 5)
} }])
C('today', 'a tick: tap the homework on Today → completed (archived); tap again → back', 'none', ['/today', { db: async (ids) => {
  const m = chat.tg.sent().at(-1)
  const b = (m.reply_markup?.inline_keyboard ?? []).flat().find((x) => /Physics homework/.test(x.text))
  assert.ok(b, 'the homework is on Today')
  await chat.tap(b.callback_data, m.message_id)
  assert.equal((await q(`select status from tasks where id = $1`, [ids.hw]))[0].status, 'completed')
  await chat.tap(b.callback_data.replace(/^tdy:mb1:/, 'tdy:mb0:'), m.message_id)
  assert.notEqual((await q(`select status from tasks where id = $1`, [ids.hw]))[0].status, 'completed')
} }])
C('today', '"what next?" → exactly what to open', 'none', ['what next?', { see: /👉/ }, { same: true }])
C('help', '"/help" → the guide', 'none', ['/help', { db: async () => { const { HELP } = await import('../lib/telegram/bot.ts'); assert.equal(last().text, HELP) } }])
C('help', '"How do I use this?" → the guide', 'none', ['How do I use this?', { db: async () => { const { HELP } = await import('../lib/telegram/bot.ts'); assert.equal(last().text, HELP) } }])
C('weekly', '"/weekly" → the weekly check', 'none', ['/weekly', { see: /📊 <b>Weekly check<\/b>/ }, { same: true }])
C('weekly', 'typo-ish: "Hows my week been" → the same weekly check', 'none', ['Hows my week been', { see: /📊 <b>Weekly check<\/b>/ }])
C('ideas', '"/ideas" with none → says so', 'none', ['/ideas', { see: /No App ideas yet/ }])

// ===================================================================== the quick router (small talk + exact lists, no brain)
C('router', 'small talk: "thanks" → the router answers, no brain', 'router', [{ route: routed({ route: 'chat', reply: 'Any time.' }) }, 'thanks', { see: /^Any time\.$/ }, { same: true }])
C('router', 'slang list: "wots due this wk" → the week list', 'router', [{ route: routed({ route: 'list', show: 'week' }) }, 'wots due this wk', { see: /🗓 <b>Your week<\/b>[\s\S]*Physics homework/ }, { same: true }])
C('router', 'typo list: "am i free tmrw" → free tomorrow', 'router', [{ route: () => routed({ route: 'list', show: 'free', show_arg: D(1) }) }, 'am i free tmrw', { see: /^🕒 <b>Free tomorrow<\/b>/ }])
C('sorter', 'a new item: "can u add maths hw due fri" → the sorter’s card; ✅ saves it', 'sorter', [
  { route: routed({ route: 'new', item_text: 'maths hw due fri', what: 'homework' }) }, { sort: () => sorted({ title: 'Maths homework', subject: 'Maths', importance: 'must', due_date: D(4), date_words: 'fri' }) },
  'can u add maths hw due fri', { see: /<b>Task<\/b>: Maths homework/ }, { same: true }, { tap: 'Save' },
  { db: async () => assert.equal((await q(`select count(*)::int n from tasks where title = 'Maths homework'`))[0].n, 1) }])
C('sorter', 'a new item, cancelled: "remind me to email Mr Lee" → ❌ → nothing saved', 'sorter', [
  { route: routed({ route: 'new', item_text: 'email Mr Lee', what: 'task' }) }, { sort: () => sorted({ title: 'Email Mr Lee', importance: 'nice' }) },
  'remind me to email Mr Lee', { see: /Email Mr Lee/ }, { tap: 'Cancel' }, { same: true }])

// ===================================================================== the brain (scripted: anything the fast paths don't read)
const taskRef = (re) => (body) => refIn(body, re)
C('brain', 'a change in his words: "move physics homework to tomorrow" → card; ✅ → due tomorrow', 'brain', [
  { brain: (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'due', ref: taskRef(/(T\d+) \| Physics homework/)(body), date: D(1), words: 'tomorrow' })] }) },
  'move physics homework to tomorrow', { see: /Physics homework/ }, { tap: 'Apply' },
  { db: async (ids) => assert.equal(T().dateISOOf((await q(`select due_at from tasks where id = $1`, [ids.hw]))[0].due_at.toISOString()), D(1)) }])
C('brain', 'a change, cancelled: "push physics hw to thursday" → ❌ → still due Wed', 'brain', [
  { brain: (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'due', ref: taskRef(/(T\d+) \| Physics homework/)(body), date: D(3), words: 'thursday' })] }) },
  'push physics hw to thursday', { tap: 'Cancel' }, { see: /^Cancelled\. Nothing changed\.$/ }, { same: true }])
C('brain', 'the AI guesses a date he never said: "push physics hw back" → no card, "wasn’t in your words"', 'brain', [
  { brain: (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'due', ref: taskRef(/(T\d+) \| Physics homework/)(body), date: D(3), words: 'a day later' })] }) },
  'push physics hw back', { see: /Nothing to change: the date for “Physics homework” wasn’t in your words/ }, { same: true },
  { db: async () => assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action' and status = 'open'`))[0].n, 0) }])
C('brain', 'a setting: "wake me at 7 on school days" → ✅ wakeAt 07:00', 'brain', [
  { brain: brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'wakeAt=07:00', words: 'wake at 7' })] }) },
  'wake me at 7 on school days', { see: /07:00/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select planning->>'wakeAt' w from profiles where user_id = $1`, [chat.users.owner]))[0].w, '07:00') }])
C('brain', 'his Today size: "only 3 things a day pls" → ✅ todayItems 3', 'brain', [
  { brain: brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'todayItems=3', words: '3 things a day' })] }) },
  'only 3 things a day pls', { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select planning->>'todayItems' n from profiles where user_id = $1`, [chat.users.owner]))[0].n, '3') }])
C('brain', 'a vague question: "hmm what should i do abt physics" → an answer, nothing changes', 'brain', [
  { brain: brain({ intent: 'question', reply: 'Physics homework first (due Wed), then 3–4 PMT questions on kinematics.' }) },
  'hmm what should i do abt physics', { see: /^Physics homework first/ }, { same: true }])
C('brain', 'unclear: "sort it out" → one question back, nothing changes', 'brain', [
  { brain: brain({ intent: 'unclear', reply: 'Sort out what: your plan for tonight, or the Physics homework?' }) }, 'sort it out', { see: /^Sort out what/ }, { same: true }])
C('brain', 'can’t do: "rename CS tutor to Computing tutor" → one line + App ideas (his exact words)', 'brain', [
  { brain: brain({ intent: 'app_idea', idea: 'Rename a calendar event from Telegram', needs: 'A change that renames an event, on the usual ✅ card' }) },
  'rename CS tutor to Computing tutor', { see: ONE_LINE }, { same: true },
  { db: async () => assert.deepEqual(Object.values((await q(`select request, source_text from app_ideas`))[0]), ['Rename a calendar event from Telegram', 'rename CS tutor to Computing tutor']) }])
C('brain', 'can’t do, slang: "cn u sync my strava pls" → idea; ↩️ Undo → dropped (kept)', 'brain', [
  { brain: brain({ intent: 'app_idea', idea: 'Connect Strava', needs: 'A Strava connection' }) }, 'cn u sync my strava pls', { see: ONE_LINE }, { tap: 'Undo' },
  { see: /Taken off your App ideas/ }, { db: async () => assert.equal((await q(`select status from app_ideas`))[0].status, 'dropped') }])
C('brain', 'typed undo: "undo that" after a ✅ → the brain points at ↩️, nothing else changes', 'brain', [
  'bench 80x5x3', { tap: 'Apply' }, { brain: brain({ intent: 'chat', reply: 'Tap ↩️ Undo on the ✅ Done message and it goes back.' }) }, 'undo that', { see: /↩️ Undo/ },
  { db: async () => assert.equal((await q(`select count(*)::int n from lift_sets where archived_at is null`))[0].n, 1) }])
C('brain', '"help me plan tonight" (not the guide) → the brain', 'brain', [
  { brain: brain({ intent: 'question', reply: 'Tonight: Physics homework 16:10, then matrices.' }) }, 'help me plan tonight', { see: /^Tonight:/ }, { same: true }])
C('brain', 'a card waiting, then "thanks" → the brain (it may be about the card), card still there', 'brain', [
  'bench 80x5x3', { brain: brain({ intent: 'chat', reply: 'Tap ✅ Apply when it looks right.' }) }, 'thanks', { see: /Tap ✅ Apply/ }, { same: true }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select count(*)::int n from lift_sets`))[0].n, 1) }])
C('brain', 'a tracker change in odd words: "polynomials is basically sorted now" → the brain sends trk_colour; ✅', 'brain', [
  { brain: brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'trk_colour', ref: 'Y1-04', value: 'colour=green', words: 'basically sorted' })] }) },
  'polynomials is basically sorted now', { see: /Y1-04 Polynomials/ }, { tap: 'Apply' },
  { db: async () => assert.equal((await q(`select status from topics where code = 'Y1-04'`))[0].status, 'exam_ready') }])
C('brain', 'an event the fast path doesn’t read: "gonna be at grans all sat" → the brain’s event card; ❌', 'brain', [
  { brain: () => brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'event_new', value: 'title=At Gran’s', date: D(5), time: '10:00', time_to: '18:00', words: 'all sat' })] }) },
  'gonna be at grans all sat', { see: /At Gran’s/ }, { tap: 'Cancel' }, { same: true }])

for (const c of CASES) {
  test(`[${c.area}] ${c.name}`, { skip }, async () => {
    const ids = await seed()
    const start = await fingerprint()
    let lastSaid = null
    for (const s of c.steps) {
      if (typeof s === 'string' || typeof s === 'function') {
        const text = typeof s === 'function' ? s() : s
        const before = await fingerprint()
        lastSaid = text
        await chat.nat(text)
        const ch = changed(before, await fingerprint())
        if (ch.length && process.env.SHOW) console.log('CHANGED', ch, JSON.stringify(await q(`select title, status, archived_at from tasks`)), chat.tg.sent().map((m) => m.text.slice(0, 200)))
        assert.deepEqual(ch, [], `“${text}” changed ${ch.join(', ')} before any ✅`)
      } else if (s.tap) {
        const m = bot().filter((x) => chat.button(x, s.tap)).at(-1)
        assert.ok(m, `no “${s.tap}” button after “${lastSaid}”: ${last()?.text?.slice(0, 120)}`)
        const before = await fingerprint()
        await chat.tap(chat.button(m, s.tap), m.message_id)
        if (/Cancel|This week|Change/.test(s.tap)) assert.deepEqual(changed(before, await fingerprint()), [], `${s.tap} changed nothing`)
      } else if (s.see) {
        assert.match(last()?.text ?? '', s.see, `after “${lastSaid}”`)
      } else if (s.brain) chat.ai.script(CHAT, typeof s.brain === 'function' ? s.brain : s.brain)
      else if (s.route) chat.ai.script(ROUTE, s.route)
      else if (s.sort) chat.ai.script(SORT, s.sort)
      else if (s.db) await s.db(ids)
      else if (s.same) assert.deepEqual(changed(start, await fingerprint()), [], 'nothing of his changed')
    }
    // the routing
    const n = (m) => chat.ai.byModel(m).length
    if (c.ai === 'none') assert.deepEqual([n(ROUTE), n(CHAT), n(SORT)], [0, 0, 0], 'a fast path: no AI at all')
    if (c.ai === 'router') assert.deepEqual([n(ROUTE) >= 1, n(CHAT)], [true, 0], 'the router answered, the brain was never called')
    if (c.ai === 'sorter') assert.deepEqual([n(ROUTE) >= 1, n(SORT), n(CHAT)], [true, 1, 0], 'router → sorter, no brain')
    if (c.ai === 'brain') assert.ok(n(CHAT) >= 1, 'the brain read it')
    // every reply reads well: no code or errors leaking
    for (const m of chat.tg.sent()) assert.doesNotMatch(m.text.replace(/<[^>]+>/g, ''), /\bundefined\b|\bNaN\b|\[object |⚠️ Something went wrong/, `a reply leaked something:\n${m.text}`)
    chat.noSurprises()
  })
}

test(`there are at least 50 conversations (${CASES.length})`, () => assert.ok(CASES.length >= 50, `${CASES.length}`))
