// Queue item 6 on the TEST database: lifts by chat (one message per exercise, one ✅, no AI), PR lines on the card and
// after saving, typos, lbs, a set each, bodyweight, another day, vague "did bench", ✏️ change, cancel, ↩️ undo,
// "delete my last lift", a saved lift changed through the brain (LF refs), /gym, /owen, "how's my squat going?",
// and things it can't do (→ App ideas). Run:
// node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/gym-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const T = () => chat.time
// buttons by what they do (callback data), not their label: ✅ a:, ✏️ e:, ❌ x:, ↩️ u:
const CB = { Apply: 'a:', Change: 'e:', Cancel: 'x:', Undo: 'u:' }
const btn = (m, label) => (m?.reply_markup?.inline_keyboard ?? []).flat().find((b) => b.callback_data?.startsWith(CB[label]))?.callback_data
const tapOn = async (m, label) => { const b = btn(m, label); assert.ok(b, `no button “${label}” on: ${m?.text?.slice(0, 120)}`); await chat.tap(b, m.message_id) }
const tap = async (label) => { const m = chat.tg.sent().filter((x) => btn(x, label)).at(-1); await tapOn(m, label) }
const act = (o) => ({ op: 'lift_log', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const lifts = () => q(`select exercise, exercise_key, done_on::text, weight_kg::float8 w, reps, sets, rpe::float8, source, archived_at from lift_sets order by created_at, reps desc`)
const live = async () => (await lifts()).filter((r) => !r.archived_at)
const today = () => T().todayISO()
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}\n${JSON.stringify(m.reply_markup?.inline_keyboard?.map((r) => r.map((b) => b.text)) ?? [])}`) }

test('“bench 80x5x3”: a card with e1RM and the PR line (no AI); nothing saved before ✅; ✅ saves it, says the PR and the next session', { skip }, async () => {
  await add('lift_sets', { done_on: T().addDays(today(), -7), exercise: 'bench', exercise_key: 'bench press', weight_kg: 90, reps: 1, sets: 1 })
  await nat('bench 80x5x3')
  const card = last()
  show(card)
  assert.match(card.text, /^🏋️ <b>Log this lift\?<\/b>\n• 🏋️ <b>Bench press<\/b> 80 kg × 5 × 3 · e1RM 93.3 kg · 🏆 new PR \(was 90.0\)\n/)
  assert.ok(btn(card, 'Apply') && btn(card, 'Change') && btn(card, 'Cancel'), '✅ / ✏️ / ❌')
  assert.equal((await live()).length, 1, 'nothing saved before ✅')
  await tap('Apply')
  const done = last()
  show(done)
  assert.match(done.text, /✅ <b>Done<\/b>\n• 🏋️ <b>Bench press<\/b> 80 kg × 5 × 3/)
  assert.match(done.text, /🏆 <b>New PR<\/b>: Bench press e1RM 93.3 kg \(was 90.0\)/)
  assert.match(done.text, /➡️ Next time: 80 kg × 6 × 3 \(\+1 rep\)/)
  assert.ok(btn(done, 'Undo'))
  const rows = await live()
  assert.deepEqual(rows.at(-1), { exercise: 'bench', exercise_key: 'bench press', done_on: today(), w: 80, reps: 5, sets: 3, rpe: null, source: 'chat', archived_at: null })
  chat.noSurprises()
})

test('typos, aliases and lbs: “benhc 80x5x3”, “squats 225lbs 3x5” → bench press and squat, pounds saved as kg; the first log is not called a PR', { skip }, async () => {
  await nat('benhc 80x5x3')
  assert.match(last().text, /<b>Bench press<\/b> 80 kg × 5 × 3 · e1RM 93.3 kg · first one logged/)
  await tap('Apply')
  assert.doesNotMatch(last().text, /New PR/)
  await nat('squats 225lbs 3x5')
  assert.match(last().text, /<b>Squat<\/b> 102.06 kg × 5 × 3 · e1RM 119.1 kg · first one logged/)
  await tap('Apply')
  const rows = await live()
  assert.deepEqual(rows.map((r) => [r.exercise_key, r.exercise, r.w]), [['bench press', 'benhc', 80], ['squat', 'squats', 102.06]])
  chat.noSurprises()
})

test('his settings on the card: weights in lbs by default, and his own exercise from the set-up (“zercher 135x5x3”)', { skip }, async () => {
  await q(`update profiles set planning = $1 where user_id = $2`, [{ liftUnit: 'lbs', gymExercises: [{ name: 'Zercher squat', muscles: 'quads, glutes', aliases: 'zercher' }] }, chat.users.owner])
  await nat('zercher 135x5x3')
  assert.match(last().text, /<b>Zercher squat<\/b> 61.23 kg × 5 × 3 · e1RM 71.4 kg · first one logged/)
  assert.doesNotMatch(last().text, /new exercise/, 'his own exercise has its muscle groups')
  await tap('Apply')
  assert.deepEqual((await live()).map((r) => [r.exercise_key, r.w]), [['zercher squat', 61.23]])
  await nat('bench 60kg x 8 x 3')
  assert.match(last().text, /<b>Bench press<\/b> 60 kg × 8 × 3/, 'kg said: kg')
  chat.noSurprises()
})

test('“OHP 50 x 6,6,5” saves a row per rep count; “pull ups bw+10 3x8 yesterday” is bodyweight + 10 kg on yesterday', { skip }, async () => {
  await nat('OHP 50 x 6,6,5')
  assert.match(last().text, /<b>Overhead press<\/b> 50 kg × 6, 6, 5 · e1RM 60 kg/)
  await tap('Apply')
  assert.deepEqual((await live()).map((r) => [r.exercise_key, r.w, r.reps, r.sets]), [['overhead press', 50, 6, 2], ['overhead press', 50, 5, 1]])
  await nat('pull ups bw+10 3x8 yesterday')
  const y = T().addDays(today(), -1)
  assert.match(last().text, new RegExp(`<b>Pull-ups</b> BW\\+10 kg × 8 × 3 · first one logged · <i>${T().dowShort(y)} ${T().shortDate(y)}</i>`))
  await tap('Apply')
  const pu = (await live()).at(-1)
  assert.deepEqual([pu.exercise_key, pu.w, pu.reps, pu.sets, pu.done_on], ['pull ups', 10, 8, 3, y])
  chat.noSurprises()
})

test('vague “did bench” → asks how much (no card, no AI); “bench 80” → asks for reps', { skip }, async () => {
  await nat('did bench')
  assert.match(last().text, /How much\? Send it like “bench 80x5x3” \(80 kg × 5 reps × 3 sets\)/)
  await nat('bench 80')
  assert.match(last().text, /80 kg for how many reps and sets\?/)
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0, 'no card')
  assert.equal((await lifts()).length, 0)
  chat.noSurprises()
})

test('✏️ Change: “actually it was 82.5” corrects the card (through the brain); ✅ saves only the corrected lift', { skip }, async () => {
  await nat('bench 80x5x3')
  await tap('Change')
  assert.match(last().text, /What should be different/)
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content.map((x) => x.text).join('\n'), /Bench press 80 kg × 5 × 3/, 'the brain sees the card')
    return brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'exercise=bench press; weight=82.5; reps=5; sets=3' })] })
  })
  await nat('actually it was 82.5')
  const card = last()
  assert.match(card.text, /✏️ <b>Corrected<\/b>[\s\S]*<b>Bench press<\/b> 82.5 kg × 5 × 3 · e1RM 96.3 kg/)
  await tapOn(card, 'Apply')
  assert.deepEqual((await live()).map((r) => r.w), [82.5], 'one lift, the corrected one')
  assert.equal((await q(`select count(*)::int n from telegram_pending where status = 'replaced'`))[0].n, 1, 'the first card was replaced')
  chat.noSurprises()
})

test('❌ Cancel: nothing saved', { skip }, async () => {
  await nat('squat 100 5x5')
  assert.match(last().text, /<b>Squat<\/b> 100 kg × 5 × 5 · e1RM 116.7 kg/)
  await tap('Cancel')
  assert.match(last().text, /Cancelled\. Nothing changed\./)
  assert.equal((await lifts()).length, 0)
  chat.noSurprises()
})

test('↩️ Undo archives the lift (never deleted); “delete my last lift” → a ✅ card that archives it, and Undo brings it back', { skip }, async () => {
  await nat('deadlift 140kg 3x5')
  await tap('Apply')
  await tap('Undo')
  assert.match(last().text, /↩️ <b>Undone<\/b>: Deadlift/)
  let rows = await lifts()
  assert.equal(rows.length, 1, 'kept')
  assert.ok(rows[0].archived_at, 'archived')
  await nat('rdl 100x8x3')
  await tap('Apply')
  await nat('delete my last lift')
  assert.match(last().text, /🗑 <b>Remove this lift\?<\/b>\n• 🗑 <b>Romanian deadlift<\/b> 100 kg × 8 × 3 \(.*\): removed <i>\(kept in the archive\)<\/i>/)
  await tap('Apply')
  rows = await lifts()
  assert.ok(rows.find((r) => r.exercise_key === 'romanian deadlift').archived_at)
  await tap('Undo')
  rows = await lifts()
  assert.equal(rows.find((r) => r.exercise_key === 'romanian deadlift').archived_at, null, 'back')
  // Undo leaves a lift alone if it was changed since
  await nat('bench 70x8x3')
  await tap('Apply')
  await q(`update lift_sets set weight_kg = 72.5 where exercise_key = 'bench press'`)
  await tap('Undo')
  assert.match(last().text, /Left as it is \(changed since\): Bench press/)
  assert.equal((await live()).find((r) => r.exercise_key === 'bench press').w, 72.5)
  chat.noSurprises()
})

test('a saved lift changed through the brain: “Monday’s bench was actually 85” → lift_edit LF ref → ✅ → Undo puts it back', { skip }, async () => {
  const mon = T().addDays(today(), -2)
  const row = await add('lift_sets', { done_on: mon, exercise: 'bench', exercise_key: 'bench press', weight_kg: 80, reps: 5, sets: 3 })
  chat.ai.script(CHAT, (body) => {
    const text = body.messages[0].content.map((x) => x.text).join('\n')
    const m = text.match(/(LF\d+) \| [^|]+ \| Bench press 80 kg × 5 × 3/)
    assert.ok(m, 'the snapshot lists his recent lifts with refs')
    assert.match(text, /## Gym: bests, trends and next sessions/)
    return brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'lift_edit', ref: m[1], value: 'weight=85' })] })
  })
  await nat('that bench was actually 85 not 80')
  assert.match(last().text, /✏️ <b>Bench press<\/b> \(.*\): 80 kg × 5 × 3 → <b>85 kg × 5 × 3<\/b>/)
  await tap('Apply')
  assert.equal((await q(`select weight_kg::float8 w from lift_sets where id = $1`, [row.id]))[0].w, 85)
  await tap('Undo')
  assert.equal((await q(`select weight_kg::float8 w from lift_sets where id = $1`, [row.id]))[0].w, 80)
  chat.noSurprises()
})

test('“how’s my squat going?” → best, trend, last and next (no AI); /gym → this week, PRs, sets per muscle group, balance, next', { skip }, async () => {
  const t = today()
  const wk = T().weekStartISO(t)
  for (const [off, w] of [[-21, 95], [-14, 97.5], [-7, 100]]) await add('lift_sets', { done_on: T().addDays(wk, off), exercise: 'squat', exercise_key: 'squat', weight_kg: w, reps: 5, sets: 5 })
  await add('lift_sets', { done_on: wk, exercise: 'bench', exercise_key: 'bench press', weight_kg: 80, reps: 5, sets: 4 })
  await add('lift_sets', { done_on: wk, exercise: 'incline db', exercise_key: 'incline dumbbell press', weight_kg: 30, reps: 10, sets: 3 })
  await add('lift_sets', { done_on: wk, exercise: 'squat', exercise_key: 'squat', weight_kg: 102.5, reps: 5, sets: 5 })
  await nat('how’s my squat going?')
  const a = last()
  show(a)
  assert.match(a.text, /📈 <b>Squat<\/b>\nBest: e1RM <b>119.6 kg<\/b> — 102.5 kg × 5 × 5/)
  assert.match(a.text, /Last 4 sessions \(e1RM\): 110.8 → 113.8 → 116.7 → 119.6 kg/)
  assert.match(a.text, /➡️ Next: 102.5 kg × 6 × 5 \(\+1 rep\)/)
  await nat('/gym')
  const g = last()
  show(g)
  assert.match(g.text, /🏋️ <b>Gym this week<\/b>/)
  assert.match(g.text, /Bench press 80 kg × 5 × 4 · Incline dumbbell press 30 kg × 10 × 3 · Squat 102.5 kg × 5 × 5/)
  assert.match(g.text, /🏆 Squat e1RM 119.6 kg \(was 116.7\)/)
  assert.match(g.text, /💪 Sets: chest 7 · shoulders 3.5 · triceps 3.5 · quads 5/)
  assert.match(g.text, /⚖️ Pull is behind push \(0 sets vs 7 sets\)/)
  assert.match(g.text, /➡️ <b>Next sessions<\/b>/)
  await nat('/lifts')
  assert.equal(last().text, g.text, '/lifts is the same')
  chat.noSurprises()
})

test('/owen: a ready-to-send message (tap to copy) with Owen’s days from his set-up and his free slots this week', { skip }, async () => {
  const from = T().addDays(today(), -14)
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', repeat_from: from, is_school: true })
  await add('events', { title: 'Club 360 football', repeat_days: [1, 3], start_time: '20:00', end_time: '21:30', repeat_from: from, training_type: 'football', load: 'hard' })
  await q(`update profiles set planning = $1 where user_id = $2`, [{ owenDays: { speed: [2], heavy_lower: [4] } }, chat.users.owner])
  await nat('/owen')
  const m = last()
  show(m)
  assert.match(m.text, /^📋 <b>Message for Owen<\/b> <i>\(tap it to copy\)<\/i>:\n<code>Hi Owen, this week I can do our sessions on Tuesday and Thursday\. If one needs to move, I’m free (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d–\d\d:\d\d/)
  assert.match(m.text, /Already fixed: .*Club 360 football/)
  assert.match(m.text, /Does that work for you\?<\/code>/)
  assert.match(m.text, /Owen’s days from your set-up: Speed \+ circuits Tue, Heavy lower Thu/)
  assert.doesNotMatch(m.text.match(/<code>([\s\S]*)<\/code>/)[1], /2[2-3]:\d\d/, 'no slot runs past the heavy cut-off')
  // no days saved: this week's best days from the optimiser, and it says so
  await q(`update profiles set planning = '{}' where user_id = $1`, [chat.users.owner])
  await nat('/owen')
  assert.match(last().text, /No Owen days saved yet, so these are this week’s best days/)
  chat.noSurprises()
})

test('things it can’t do yet → one line + App ideas with his words: “sync my Hevy automatically”, TrainHeroic', { skip }, async () => {
  await nat('can you sync my hevy workouts automatically?')
  assert.match(last().text, /I can’t do that yet — it needs adding in Claude Code\. 💡 Saved to your App ideas \(\/ideas\)\./)   // one line since item 3
  assert.match((await q(`select request from app_ideas order by created_at`))[0].request, /^Sync Hevy workouts automatically/)
  await nat('import my trainheroic programme')
  assert.match(last().text, /^I can’t do that yet/)
  assert.match((await q(`select request from app_ideas order by created_at`))[1].request, /TrainHeroic/)
  const ideas = await q(`select request, source_text from app_ideas order by created_at`)
  assert.equal(ideas.length, 2)
  assert.equal(ideas[0].source_text, 'can you sync my hevy workouts automatically?', 'his exact words kept')
  chat.noSurprises()
})

test('not a lift: “upper 3x this week” goes to the brain as before (the gym fast path leaves it alone)', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Noted.' }))
  await nat('upper 3x this week')
  assert.equal(last().text, 'Noted.')
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0)
  chat.noSurprises()
})

test('several lifts in one message → one card, one ✅; a typed lift the brain sends with a day not in his words is left out', { skip }, async () => {
  await nat('bench 80x5x3 and squat 100 5x5')
  assert.match(last().text, /^🏋️ <b>Log these 2 lifts\?<\/b>\n• 🏋️ <b>Bench press<\/b> 80 kg × 5 × 3[^\n]*\n• 🏋️ <b>Squat<\/b> 100 kg × 5 × 5/)
  await tap('Apply')
  assert.deepEqual((await live()).map((r) => r.exercise_key), ['bench press', 'squat'])
  // the brain names a day he never said: that part is left out (dates come from his words)
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Logged.', actions: [act({ value: 'exercise=deadlift; weight=140; reps=5; sets=3', date: T().addDays(today(), -3), words: 'thursday' }), act({ value: 'exercise=curls; weight=15; reps=12; sets=3' })] }))
  await nat('log deadlifts and curls from the other day pls')
  const card = last()
  assert.match(card.text, /<b>Bicep curl<\/b> 15 kg × 12 × 3/)
  assert.match(card.text, /Left out: which day was it\? \(the day wasn’t in your words\)/)
  chat.noSurprises()
})

test('a card is waiting: “make it 82.5x5x3”, “no 85x5x3”, “actually 85x5x3” are corrections for the brain, not new lifts; a clearly new lift still gets its own card', { skip }, async () => {
  await nat('bench 80x5x3')
  for (const words of ['make it 82.5x5x3', 'no 85x5x3', 'actually 85x5x3', 'change to 85x5x3']) {
    chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Tap ✏️ Change on the card to correct it.' }))
    await nat(words)
    assert.equal(last().text, 'Tap ✏️ Change on the card to correct it.', `${words}: the brain got it`)
  }
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 1, 'no new cards')
  await nat('squat 100 5x5')
  assert.match(last().text, /<b>Squat<\/b> 100 kg × 5 × 5/, 'a new lift of another exercise: its own card')
  chat.noSurprises()
})

test('not lifts in chat: “squad meeting 5x5”, “revision 3x30”, “deadline 5x5” go to the brain; “squat 5x5” asks how much', { skip }, async () => {
  for (const words of ['squad meeting 5x5', 'revision 3x30', 'deadline 5x5', 'bench 80x5x3 and dinner 7x2']) {
    chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Noted.' }))
    await nat(words)
    assert.equal(last().text, 'Noted.', words)
  }
  await nat('squat 5x5')
  assert.match(last().text, /How much\?/)
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0, 'no cards')
  chat.noSurprises()
})

test('“delete my last lift” takes the one logged last, even if it was for an earlier day', { skip }, async () => {
  await nat('bench 80x5x3')
  await tap('Apply')
  await nat('squat 100 5x5 yesterday')
  await tap('Apply')
  await nat('delete my last lift')
  assert.match(last().text, /🗑 <b>Squat<\/b> 100 kg × 5 × 5/)
  chat.noSurprises()
})
