// Queue item 1c on the TEST database: the study tracker in Telegram. Normal words, typos, vague "make it green", ✏️
// changes, ❌ cancels, ↩️ undo (only if nothing changed since; new rows archived, never deleted), quick-tap questions,
// the brain for anything the fast paths don't read (with the tracker in its snapshot), things it can't do → App ideas,
// "export my tracker" as a document, and every command. Nothing changes before ✅.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/tracker-bot-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { seed } from './support/tracker-bot.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a)
const T = () => chat.time
const today = () => T().todayISO()
const day = (iso) => `${T().dowShort(iso)} ${T().shortDate(iso)}`
const plus = (n) => T().addDays(today(), n)
const sunday = () => T().addDays(T().weekStartISO(today()), 6)
const bot = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌 <b>Today'))   // not the pinned Today
const last = () => bot().at(-1)
const tap = async (label) => { const m = bot().filter((x) => chat.button(x, label)).at(-1); assert.ok(m, `no “${label}” button`); await chat.tap(chat.button(m, label), m.message_id) }
const noAI = () => assert.equal(chat.ai.requests.length, 0, 'no AI call')
const topic = async (code) => (await q(`select status, step, fresh_pct, last_done::text, booklet, archived_at from topics where code = $1`, [code]))[0]
const act = (o) => ({ op: 'trk_colour', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const refIn = (body, re) => { const m = body.messages[0].content[0].text.match(re); assert.ok(m, `no ref for ${re}`); return m[1] }

test('"matrices 🟢": a card with no AI, nothing saved before ✅; Apply saves it and says what to open next; Undo puts it back', { skip }, async () => {
  await seed(chat)
  const before = await topic('PC1-01')
  await nat('matrices 🟢')
  noAI()
  const card = last()
  assert.match(card.text, new RegExp(`🔧 <b>Change</b>\\n• <b>PC1-01 Matrices</b>: 🔴 → <b>🟢</b> · review ${day(plus(14))}\\n\\nNothing changes until you tap ✅ Apply\\.`))
  assert.deepEqual(await topic('PC1-01'), before, 'nothing saved before ✅')
  await tap('Apply')
  const after = await topic('PC1-01')
  assert.deepEqual([after.status, after.last_done], ['exam_ready', today()])
  assert.match(last().text, /✅ <b>Done<\/b>\n• <b>PC1-01 Matrices<\/b>: 🔴 → <b>🟢<\/b>/)
  assert.match(last().text, /👉 <b>Next for PC1-01 Matrices<\/b>: Bicen Core Pure → CP1: Matrices: one 30–45 min set, mark straight after/, 'the next step, from its step 3 (lib/tracker/ladder.ts)')
  await tap('Undo')
  assert.match(last().text, /↩️ <b>Undone<\/b>: PC1-01 Matrices/)
  assert.deepEqual(await topic('PC1-01'), before, 'back as it was')
  chat.noSurprises()
})

test('typos: "matrics grean" is still Matrices → 🟢; ✖ Cancel changes nothing', { skip }, async () => {
  await seed(chat)
  await nat('matrics grean')
  assert.match(last().text, /<b>PC1-01 Matrices<\/b>: 🔴 → <b>🟢<\/b>/)
  await tap('Cancel')
  assert.match(last().text, /Cancelled\. Nothing changed\./)
  assert.equal((await topic('PC1-01')).status, 'not_secure')
  noAI()
  chat.noSurprises()
})

test('"set trig yellow" then ✏️ "no, red": the corrected card replaces it (the brain reads the correction)', { skip }, async () => {
  await seed(chat)
  await nat('set trig yellow')
  assert.match(last().text, /<b>Y1-10 Trigonometric functions &amp; equations<\/b>: ⚪ → <b>🟡<\/b>/)
  await tap('Change')
  assert.match(last().text, /✏️ What should be different\?/)
  chat.ai.script(CHAT, (body) => {
    assert.match(body.messages[0].content[1].text, /being edited/)
    return brain({ intent: 'instruction', reply: 'Trig to red.', actions: [act({ ref: 'Y1-10', value: 'colour=red' })] })
  })
  await nat('no, red')
  assert.match(last().text, /✏️ <b>Corrected<\/b>\n🔧 <b>Change<\/b>\n• <b>Y1-10 Trigonometric functions &amp; equations<\/b>: ⚪ → <b>🔴<\/b>/)
  await tap('Apply')
  assert.equal((await topic('Y1-10')).status, 'not_secure')
  assert.equal((await q(`select count(*)::int n from telegram_pending where status = 'replaced'`))[0].n, 1, 'the first card was replaced, not applied')
  chat.noSurprises()
})

test('vague: "PC1-01 yellow" ✅, then "make it green" knows "it" is PC1-01 (no AI)', { skip }, async () => {
  await seed(chat)
  await nat('PC1-01 yellow')
  await tap('Apply')
  await nat('make it green')
  noAI()
  assert.match(last().text, /<b>PC1-01 Matrices<\/b>: 🟡 → <b>🟢<\/b>/)
  await tap('Apply')
  assert.equal((await topic('PC1-01')).status, 'exam_ready')
  chat.noSurprises()
})

test('"make it green" with nothing talked about goes to the brain, which asks which topic', { skip }, async () => {
  await seed(chat)
  chat.ai.script(CHAT, brain({ intent: 'unclear', reply: 'Which topic?' }))
  await nat('make it green')
  assert.equal(last().text, 'Which topic?')
  chat.noSurprises()
})

test('"did Bicen matrices set 8/10": 🔴 → 🟡, step 3 → 4, review in 3 days; then "Next: the Integral assessment"', { skip }, async () => {
  await seed(chat)
  await nat('did Bicen matrices set 8/10')
  noAI()
  assert.match(last().text, new RegExp(`<b>PC1-01 Matrices</b>: Bicen set 8/10 = 80% · 🔴 → <b>🟡</b> · step 3 → <b>4</b> \\(Bicen exam Qs\\) · review ${day(plus(3))}`))
  await tap('Apply')
  assert.deepEqual(await topic('PC1-01'), { status: 'understand', step: 4, fresh_pct: 80, last_done: today(), booklet: null, archived_at: null })
  assert.match(last().text, /👉 <b>Next for PC1-01 Matrices<\/b>: Integral topic assessment: Matrices – timed, closed book \(≥ 85 % = 🟢\)/)
  chat.noSurprises()
})

test('"finished textbook exercise on logs": step 0 → 2, then "Next: the mixed exercise"; physics "kinematics booklet done"', { skip }, async () => {
  await seed(chat)
  await nat('finished textbook exercise on logs')
  assert.match(last().text, /<b>Y1-07 Logarithms<\/b>: textbook exercise · stays ⚪ · step 0 → <b>2<\/b> \(Textbook exercise\)/)
  await tap('Apply')
  assert.equal((await topic('Y1-07')).step, 2)
  assert.match(last().text, /👉 <b>Next for Y1-07 Logarithms<\/b>: Textbook: Logarithms: the MIXED exercise \+ the red\/blue problem-solving questions/)
  await nat('kinematics booklet done')
  assert.match(last().text, /<b>P1\.1 Kinematics<\/b>: booklet Qs · stays 🟡 · booklet todo → <b>done<\/b>/)
  await tap('Apply')
  assert.equal((await topic('P1.1')).booklet, 'done')
  assert.match(last().text, /👉 <b>Next for P1\.1 Kinematics<\/b>: PMT CAIE topic questions: Kinematics/)
  noAI()
  chat.noSurprises()
})

test('"mistake: PC1-03 Q3b assumed through origin – knowledge": a new mistake, redo in 3 days; Undo archives it (kept)', { skip }, async () => {
  const ids = await seed(chat)
  await nat('mistake: PC1-03 Q3b assumed through origin – knowledge')
  noAI()
  assert.match(last().text, new RegExp(`📝 Mistake <b>PC1-03 Applications of matrices Q3b</b>: “assumed through origin” · Knowledge · redo ${day(plus(3))}`))
  assert.equal((await q(`select count(*)::int n from mistakes where body = 'assumed through origin'`))[0].n, 0, 'nothing saved before ✅')
  await tap('Apply')
  const [m] = await q(`select topic_id, code, question, kind, review_on::text, redo_stage, archived_at, source_text from mistakes where body = 'assumed through origin'`)
  assert.deepEqual([m.topic_id, m.code, m.question, m.kind, m.review_on, m.redo_stage, m.archived_at], [ids.topics['PC1-03'], 'PC1-03', 'Q3b', 'knowledge', plus(3), 0, null])
  assert.equal(m.source_text, 'mistake: PC1-03 Q3b assumed through origin – knowledge', 'his words are kept')
  assert.match(last().text, new RegExp(`Redo it ${day(plus(3))} without looking`))
  await tap('Undo')
  const rows = await q(`select archived_at from mistakes where body = 'assumed through origin'`)
  assert.equal(rows.length, 1, 'never deleted')
  assert.ok(rows[0].archived_at, 'archived')
  chat.noSurprises()
})

test('"redid PC1-03 Q3b": redo 1 of 2, the next one in a week; "redid it… still wrong" goes back 3 days', { skip }, async () => {
  const ids = await seed(chat)
  await nat('redid PC1-03 Q3b')
  assert.match(last().text, new RegExp(`🔁 <b>PC1-03 Q3b</b> \\(“assumed it went through the origin”\\): redo 1 of 2 ✓ → next redo ${day(plus(7))}`))
  await tap('Apply')
  const id = ids.mistakes['PC1-03 Q3b']
  assert.deepEqual((await q(`select redo_stage, review_on::text from mistakes where id = $1`, [id]))[0], { redo_stage: 1, review_on: plus(7) })
  await nat('redid polynomials Q5 - still wrong')
  assert.match(last().text, new RegExp(`still wrong → redo again ${day(plus(3))}`))
  await tap('Apply')
  assert.deepEqual((await q(`select redo_stage, review_on::text from mistakes where id = $1`, [ids.mistakes['Y1-04 Q5']]))[0], { redo_stage: 0, review_on: plus(3) })
  noAI()
  chat.noSurprises()
})

test('"HT2 practice 38/45": a timed try on FM HT2 (84%, topics to work on); /tests shows it with days left', { skip }, async () => {
  const ids = await seed(chat)
  await nat('HT2 practice 38/45')
  noAI()
  assert.match(last().text, /📝 <b>FM HT2 test<\/b>: timed practice 38\/45 = <b>84%<\/b> · today · work on: 🔴 PC1-01, 🟡 PC1-03/)
  await tap('Apply')
  assert.deepEqual((await q(`select what, score::float, out_of::float, label, done_on::text from test_attempts where goal_id = $1`, [ids.tests['FM HT2 test']]))[0],
    { what: 'timed', score: 38, out_of: 45, label: 'HT2 practice', done_on: today() })
  assert.match(last().text, /👉 <b>Next for FM HT2 test<\/b>: a diagnostic, 1–2 fresh questions per topic, no notes/)
  await nat('/tests')
  const t = last().text
  assert.match(t, new RegExp(`<b>FM HT2 test</b> · ${day(plus(24))} · <b>24 days</b>\\n  tries: timed 38/45 84%\\n  topics: 🔴 PC1-01 · ⚪ PC1-02 · 🟡 PC1-03`))
  assert.match(t, /<b>Physics mechanics test<\/b>[\s\S]*no momentum/)
  chat.noSurprises()
})

test('"pause getting ahead until <date>": a rule ending that day; /rules lists it; the Your week line shows it', { skip }, async () => {
  await seed(chat)
  const end = plus(6)
  await nat(`pause getting ahead until ${T().shortDate(end)}`)
  noAI()
  assert.match(last().text, new RegExp(`📌 New rule: <b>pause getting ahead</b> · until ${day(end)}`))
  await tap('Apply')
  assert.deepEqual((await q(`select kind, target, starts_on::text, ends_on::text, words from plan_rules where target = 'ahead'`))[0],
    { kind: 'pause', target: 'ahead', starts_on: today(), ends_on: end, words: `pause getting ahead until ${T().shortDate(end)}` })
  await nat('/rules')
  assert.match(last().text, new RegExp(`• paused: getting ahead until ${day(end)}`))
  const { weekRulesLine } = await import('../lib/tracker/bot-data.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const line = await weekRulesLine(await openOwnerSession(), T().weekStartISO(today()), sunday())
  assert.match(line, /^📌 <b>Rules this week<\/b>: .*paused: getting ahead until/)
  chat.noSurprises()
})

test('"pause getting ahead" with no end: a quick-tap question (this week / 2 weeks / until I say); the tap fills the card', { skip }, async () => {
  await seed(chat)
  await nat('pause getting ahead')
  noAI()
  assert.match(last().text, /❓ <b>When should it end\?<\/b>/)
  assert.ok(chat.button(last(), 'This week') && chat.button(last(), '2 weeks') && chat.button(last(), 'Until I say'))
  await chat.tap(chat.button(last(), '2 weeks'), last().message_id)
  const card = chat.tg.of('editMessageText').at(-1).body
  assert.match(card.text, new RegExp(`📌 New rule: <b>pause getting ahead</b> · until ${day(T().addDays(sunday(), 7))}`))
  await chat.tap(card.reply_markup.inline_keyboard.flat().find((b) => b.text.includes('Apply')).callback_data, card.message_id)
  assert.equal((await q(`select ends_on::text e from plan_rules where target = 'ahead'`))[0].e, T().addDays(sunday(), 7))
  chat.noSurprises()
})

test('"ACT top priority this week" (until Sunday), then "end the ACT rule" (it started today, so it is archived, kept)', { skip }, async () => {
  await seed(chat)
  await nat('ACT top priority this week')
  const span = sunday() === today() ? 'today only' : `until ${day(sunday())}`
  assert.match(last().text, new RegExp(`📌 New rule: <b>ACT top priority</b> · ${span}`))
  await tap('Apply')
  await nat('end the ACT rule')
  assert.match(last().text, /📌 Rule <b>ACT top priority<\/b>: .* → <b>ended<\/b>/)
  await tap('Apply')
  const rows = await q(`select archived_at from plan_rules where target = 'act'`)
  assert.equal(rows.length, 1)
  assert.ok(rows[0].archived_at)
  await nat('/rules')
  assert.doesNotMatch(last().text, /ACT top priority/)
  noAI()
  chat.noSurprises()
})

test('"maths + physics 45 min/day this week": one cap for Maths, Further Maths and Physics', { skip }, async () => {
  await seed(chat)
  await nat('maths + physics 45 min/day this week')
  assert.match(last().text, /📌 New rule: <b>Maths \+ Further Maths \+ Physics max 45 min\/day<\/b>/)
  await tap('Apply')
  assert.deepEqual((await q(`select kind, target, minutes from plan_rules where kind = 'cap'`))[0], { kind: 'cap', target: 'subjects:Maths,Further Maths,Physics', minutes: 45 })
  noAI()
  chat.noSurprises()
})

test('"done STEP 3, solved with hints, idea: …": the item is done with its result; Next is #4 (next week: target met)', { skip }, async () => {
  const ids = await seed(chat)
  await nat('done STEP 3, solved with hints, idea: Look for symmetry first')
  noAI()
  assert.match(last().text, /✅ <b>STEP<\/b> #3 STEP Support – Assignment 3: todo → <b>done<\/b> \(solved with hints · idea: Look for symmetry first\) · this week 1\/1/)
  await tap('Apply')
  assert.deepEqual((await q(`select status, done_on::text, result from programme_items where id = $1`, [ids.items['STEP 3']]))[0],
    { status: 'done', done_on: today(), result: 'solved with hints · idea: Look for symmetry first' })
  assert.match(last().text, /👉 <b>Next<\/b>: STEP #4 STEP Support – Assignment 4 <i>\(next week: this week’s target is met\)<\/i>/)
  await nat('/programmes')
  assert.match(last().text, /▶️ <b>STEP<\/b> · this week 1\/1\n  1 a week · weekend · 3\/28 done · next: STEP Support – Assignment 4 \(#4\)/)
  chat.noSurprises()
})

test('"pause STEP until <date>", then "resume STEP"; Undo of a change made again since is left alone', { skip }, async () => {
  const ids = await seed(chat)
  const until = plus(10)
  await nat(`pause STEP until ${T().shortDate(until)}`)
  assert.match(last().text, new RegExp(`📚 <b>STEP</b>: ▶️ active → <b>⏸ paused until ${day(until)}</b>`))
  await tap('Apply')
  assert.deepEqual((await q(`select status, paused_until::text from programmes where id = $1`, [ids.programmes.STEP]))[0], { status: 'paused', paused_until: until })
  await q(`update programmes set paused_until = $2 where id = $1`, [ids.programmes.STEP, plus(12)])   // changed on the dashboard
  await tap('Undo')
  assert.match(last().text, /Left as it is \(changed since\): STEP/)
  assert.equal((await q(`select status from programmes where id = $1`, [ids.programmes.STEP]))[0].status, 'paused')
  await nat('resume STEP')
  await tap('Apply')
  assert.deepEqual((await q(`select status, paused_until from programmes where id = $1`, [ids.programmes.STEP]))[0], { status: 'active', paused_until: null })
  noAI()
  chat.noSurprises()
})

test('two topics could fit ("proof green"): a quick-tap "Which topic?"; the tap picks one', { skip }, async () => {
  await seed(chat)
  const [fm] = await q(`select id from subjects where name = 'Further Maths' and user_id = $1`, [chat.users.owner])
  await chat.add('topics', { subject_id: fm.id, name: 'Proof by induction', code: 'PC1-06', strand: 'Further Pure', taught_from: plus(-5), sort_order: 50 })
  await q(`update topics set status = 'understand' where code = 'Y1-01'`)
  await nat('proof green')
  noAI()
  assert.match(last().text, /❓ <b>Which topic\?<\/b>/)
  await chat.tap(chat.button(last(), 'PC1-06'), last().message_id)
  const card = chat.tg.of('editMessageText').at(-1).body
  assert.match(card.text, /<b>PC1-06 Proof by induction<\/b>: ⚪ → <b>🟢<\/b>/)
  await chat.tap(card.reply_markup.inline_keyboard.flat().find((b) => b.text.includes('Apply')).callback_data, card.message_id)
  assert.equal((await topic('PC1-06')).status, 'exam_ready')
  assert.equal((await topic('Y1-01')).status, 'understand', 'the other one is untouched')
  // when only one of them can change (the other is green already), the card names that one straight away
  await nat('proof green')
  assert.match(last().text, /🔧 <b>Change<\/b>\n• <b>Y1-01 Proof &amp; mathematical communication<\/b>: 🟡 → <b>🟢<\/b>/)
  chat.noSurprises()
})

test('the brain sees the tracker (codes, TS refs, the trk_ ops) and moves a test by its ref; Undo moves it back', { skip }, async () => {
  const ids = await seed(chat)
  const to = plus(25)
  chat.ai.script(CHAT, (body) => {
    assert.match(body.system[0].text, /trk_colour \(ref topic/)
    assert.ok(body.output_config.format.schema.properties.actions.items.properties.op.enum.includes('trk_rule'))
    const snap = body.messages[0].content[0].text
    assert.match(snap, /## Study tracker topics[\s\S]*\nPC1-01 \| Matrices \| Further Maths · Further Pure \| 🔴 step 3 \| taught/)
    assert.match(snap, /## Mistakes to redo \(MK…\)\nMK1 \| PC1-03 Q3b/)
    assert.match(snap, /## Programmes \(PG…[^\n]*\nPG1 \| STEP/)
    const ref = refIn(body, /(TS\d+) \| FM HT2 test \|/)
    return brain({ intent: 'instruction', reply: 'Moving HT2.', actions: [act({ op: 'trk_test', ref, date: to, words: T().shortDate(to) })] })
  })
  await nat(`the HT2 test has moved to ${T().shortDate(to)}`)
  assert.match(last().text, new RegExp(`📝 <b>FM HT2 test</b>: ${day(plus(24))} → <b>${day(to)}</b>`))
  await tap('Apply')
  assert.equal((await q(`select target_date::text d from goals where id = $1`, [ids.tests['FM HT2 test']]))[0].d, to)
  await tap('Undo')
  assert.equal((await q(`select target_date::text d from goals where id = $1`, [ids.tests['FM HT2 test']]))[0].d, plus(24))
  chat.noSurprises()
})

test('the brain: a new test in his words; a date he never said is refused', { skip }, async () => {
  await seed(chat)
  const on = plus(30)
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Adding it.', actions: [act({ op: 'trk_test', value: 'title=Physics waves test; subject=Physics; topics=stationary waves', date: on, words: T().shortDate(on) })] }))
  await nat(`physics waves test on ${T().shortDate(on)}, just stationary waves`)
  assert.match(last().text, new RegExp(`📝 New test: <b>Physics waves test</b> · ${day(on)} \\(in 30 days\\) · Physics · topics P7\\.3`))
  await tap('Apply')
  assert.deepEqual((await q(`select kind, test_kind, topic_codes, source from goals where title = 'Physics waves test'`))[0], { kind: 'test', test_kind: 'test', topic_codes: ['P7.3'], source: 'chat' })
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Adding it.', actions: [act({ op: 'trk_test', value: 'title=Chem test', date: plus(9), words: 'next friday' })] }))
  await nat('add a chem test')
  assert.match(last().text, /Nothing to change: the test date wasn’t clear/)
  assert.equal((await q(`select count(*)::int n from goals where title = 'Chem test'`))[0].n, 0)
  chat.noSurprises()
})

test('the brain asks a quick-tap question for a rule with no end ("no physics until the mocks are over")', { skip }, async () => {
  await seed(chat)
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Pausing physics.', actions: [], ask: [{ question: 'Until when?', options: [
    { label: 'This week', actions: [act({ op: 'trk_rule', value: 'do=add; kind=pause; target=physics; ends=week' })] },
    { label: 'Until I say', actions: [act({ op: 'trk_rule', value: 'do=add; kind=pause; target=physics; ends=until_i_say' })] },
  ] }] }))
  await nat('no physics until the mocks are over')
  assert.match(last().text, /❓ <b>Until when\?<\/b>/)
  await chat.tap(chat.button(last(), 'Until I say'), last().message_id)
  const card = chat.tg.of('editMessageText').at(-1).body
  assert.match(card.text, /📌 New rule: <b>pause Physics<\/b> · until /)
  await chat.tap(card.reply_markup.inline_keyboard.flat().find((b) => b.text.includes('Apply')).callback_data, card.message_id)
  assert.equal((await q(`select ends_on::text e from plan_rules where target = 'physics'`))[0].e, plus(55))
  chat.noSurprises()
})

test('things it can’t do: one line + saved to App ideas (a fast one, and one the brain spots)', { skip }, async () => {
  await seed(chat)
  await nat('sync my tracker to google sheets every day')
  noAI()
  assert.match(last().text, /I can’t do that yet — it needs adding in Claude Code\. 💡 Saved to your App ideas \(\/ideas\)\./)
  assert.match((await q(`select request from app_ideas order by created_at`))[0].request, /^Sync the study tracker to his Google Sheet automatically/)
  chat.ai.script(CHAT, brain({ intent: 'app_idea', idea: 'Delete a study topic for good' }))
  await nat('delete the matrices topic completely, not archive')
  assert.match(last().text, /💡 Saved to your App ideas \(\/ideas\)\./)
  assert.equal((await q(`select request from app_ideas order by created_at`))[1].request, 'Delete a study topic for good')
  assert.deepEqual((await q(`select request, source_text from app_ideas order by created_at`)).map((r) => r.source_text), ['sync my tracker to google sheets every day', 'delete the matrices topic completely, not archive'])
  assert.equal((await topic('PC1-01')).archived_at, null)
  chat.noSurprises()
})

test('"export my tracker": the CSV as a Telegram document (every tab), then how to import it; no AI', { skip }, async () => {
  await seed(chat)
  await nat('export my tracker')
  noAI()
  const [doc] = chat.tg.of('sendDocument')
  assert.ok(doc, 'a document was sent')
  assert.equal(doc.body.document.filename, `tracker-${today()}.csv`, 'the same export as the Subjects page (lib/tracker/csv.ts)')
  assert.equal(doc.body.document.type, 'text/csv')
  const csv = doc.body.document.content
  for (const tab of ['Maths+FM', 'Physics', 'Tests & papers', 'Mistakes – practice', 'STEP', 'Programmes']) assert.ok(csv.includes(`## ${tab}\r\n`), tab)
  assert.match(csv, /PC1-01,FM,Further Pure,.*Matrices,🔴,3 Mixed exercise,Bicen Core Pure → CP1: Matrices/)
  assert.match(csv, /STEP,1,weekend,active,,3,STEP Support – Assignment 3,Not started/)
  assert.match(doc.body.caption, /Study tracker/)
  assert.match(last().text, /📤 <b>Your tracker<\/b> \(16 topics, 3 tests, 2 mistakes, 1 programmes\) is in the file above: every tab/)
  chat.noSurprises()
})

test('/maths, /physics, /review, /programmes: instant lists from the tracker, about a phone screen each', { skip }, async () => {
  await seed(chat)
  await nat('/maths')
  const m = last().text
  assert.match(m, /^📐 <b>Maths \+ Further Maths<\/b> · 1\/13 🟢\n<b>Maths<\/b>\nPure 🟢🟡⚪⚪🟡⚪⚪⚪/)
  assert.match(m, /🔁 <b>Due<\/b>: 🔴 PC1-01 Matrices · 🔴 Y1-16 Working with data · 🟡 Y1-04 Polynomials/)
  assert.match(m, /⏭ <b>Next up<\/b>: Y1-10 Trigonometric functions &amp; equations/)
  assert.ok(m.split('\n').length <= 25)
  await nat('show my maths tracker')
  assert.equal(last().text, m, 'typed, it is the same tracker view')
  await nat('/physics')
  assert.match(last().text, /^⚛️ <b>Physics<\/b> · 0\/3 🟢\nMechanics 🟡⚪/)
  await nat('/review')
  assert.match(last().text, /^🔁 <b>Due today<\/b>[\s\S]*• 🔴 <b>PC1-01 Matrices<\/b> <i>\(2 days late\)<\/i>[\s\S]*🧠 <b>Mistakes to redo<\/b>[\s\S]*<b>PC1-03 Q3b<\/b>/)
  await nat('/programmes')
  assert.match(last().text, /▶️ <b>STEP<\/b> · this week 0\/1\n  1 a week · weekend · 2\/28 done · next: STEP Support – Assignment 3 \(#3\)/)
  noAI()
  chat.noSurprises()
})

test('/rules and /tests with nothing in them say how to add one', { skip }, async () => {
  await nat('/rules')
  assert.match(last().text, /No temporary rules right now/)
  await nat('/tests')
  assert.match(last().text, /No tests coming up/)
  await nat('/programmes')
  assert.match(last().text, /No programmes yet/)
  noAI()
  chat.noSurprises()
})

test('"what next?": the planner’s top pick with exactly what to open (until the planner has picks, the brain answers)', { skip }, async () => {
  await seed(chat)
  const { loadStudyWorld } = await import('../lib/tracker/data.ts')
  const { planStudyDay } = await import('../lib/tracker/engine.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const world = await loadStudyWorld(await openOwnerSession(), today())
  const picks = planStudyDay(world, { date: today(), dow: T().isoDow(today()), mode: 'school', studyMinutes: 120 }).picks
  if (!picks.length) chat.ai.script(CHAT, brain({ intent: 'question', reply: 'Matrices: Bicen questions.' }))
  await nat('what next?')
  if (picks.length) {
    noAI()
    assert.match(last().text, new RegExp(`^👉 <b>${picks[0].title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&amp;')}</b>`))
    assert.match(last().text, /📖 /)
  } else assert.match(last().text, /Matrices: Bicen questions\./)
  chat.noSurprises()
})
