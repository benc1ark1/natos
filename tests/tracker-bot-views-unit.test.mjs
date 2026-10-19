// What the tracker bot shows (lib/tracker/bot-views.ts): /maths /physics /tests /review /rules /programmes
// (about one phone screen each), the brain's snapshot lines, the "Next: …" line after ✅ (the resource ladder), the Your
// week "📌 Rules this week" line, "what next?" (the CSV export is lib/tracker/csv.ts, tested by 1a).
// Fixed today: Mon 19 Oct 2026. Pure: no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { world } from './support/tracker-bot.mjs'

const V = await import('../lib/tracker/bot-views.ts')
const TODAY = '2026-10-19'
const W = world(TODAY)
const topic = (code) => W.topics.find((t) => t.code === code)
const lines = (html) => html.split('\n').length

test('/maths: strands as colour chips, due reviews, next up, the test within 3 weeks, what to open next', () => {
  const html = V.mathsView(W)
  assert.match(html, /^📐 <b>Maths \+ Further Maths<\/b> · 1\/13 🟢/)
  assert.match(html, /<b>Maths<\/b>\nPure 🟢🟡⚪⚪🟡⚪⚪⚪ <i>1\/8 🟢 · 4 taught<\/i>\nStatistics 🔴/)
  assert.match(html, /<b>Further Maths<\/b>\nFurther Pure 🔴⚪🟡 <i>0\/3 🟢<\/i>\nFurther Stats ⚪/)
  assert.match(html, /🔁 <b>Due<\/b>: 🔴 PC1-01 Matrices · 🔴 Y1-16 Working with data · 🟡 Y1-04 Polynomials/, 'most overdue first')
  assert.match(html, /⏭ <b>Next up<\/b>: Y1-10 Trigonometric functions &amp; equations \(Mon 2 Nov\) · FS-01/)
  assert.doesNotMatch(html, /🔥 <b>FM HT2 test/, '24 days away: not yet')
  assert.match(html, /🔥 <b>FM HT1 consolidation<\/b> in 14 days: 🔴 PC1-01/)
  assert.match(html, /👉 <b>Next<\/b>: PC1-01 Matrices → fix it: re-learn: your notes \/ the Bicen chapter summary for Matrices → 5 questions from Textbook: Matrices → Bicen Core Pure → CP1: Matrices exam questions → ≥ 80 % = 🟡/, 'a 🔴 past the textbook is fixed first')
  assert.ok(lines(html) <= 25, `phone length (${lines(html)} lines)`)
})

test('/physics: chips by strand, booklets and PMT for taught topics, next up', () => {
  const html = V.physicsView(W)
  assert.match(html, /^⚛️ <b>Physics<\/b> · 0\/3 🟢/)
  assert.match(html, /Mechanics 🟡⚪/)
  assert.match(html, /📘 Booklets 0\/2 · PMT 0\/2 \(taught topics\)/)
  assert.match(html, /⏭ <b>Next up<\/b>: P3\.1 Momentum \(Sat 31 Oct\)/)
  assert.match(html, /👉 <b>Next<\/b>: P7\.3 Stationary waves → School booklet: Waves → Stationary waves/, 'physics: keep up with what’s taught, never ahead')
  assert.doesNotMatch(html, /🔥/, 'the mechanics test is 22 days away: not in the 3-week window yet')
  const soon = world(TODAY)
  soon.tests[1].date = '2026-11-02'
  assert.match(V.physicsView(soon), /🔥 <b>Physics mechanics test<\/b> in 14 days: 🟡 P1\.1/)
})

test('/tests: days left, tries, topics, mistakes to redo, limits and minutes a day', () => {
  const w = world(TODAY)
  w.tests[0].attempts = [{ id: 'a', goalId: w.tests[0].id, doneOn: TODAY, what: 'timed', label: 'HT2 practice', score: 38, outOf: 45 }]
  const html = V.testsView(w)
  assert.match(html, /<b>FM HT1 consolidation<\/b> · Mon 2 Nov · <b>14 days<\/b>\n  now: the daily consolidation slot\n  no tries yet\n/, 'within 3 weeks: where it is (lib/tracker/testmode.ts)')
  assert.match(html, /<b>FM HT2 test<\/b> · Thu 12 Nov · <b>24 days<\/b>\n  tries: timed 38\/45 84%\n  topics: 🔴 PC1-01 · ⚪ PC1-02 · 🟡 PC1-03\n  1 mistake to redo \(next Mon 19 Oct\)/)
  const soon = world(TODAY)
  soon.tests[0].date = '2026-10-29'
  assert.match(V.testsView(soon), /<b>FM HT2 test<\/b> · Thu 29 Oct · <b>10 days<\/b>\n  now: diagnostic first: 1–2 fresh Qs a topic, no notes → colour each/)
  soon.tests[0].date = '2026-10-22'
  soon.tests[0].attempts = [{ id: 'd', goalId: soon.tests[0].id, doneOn: '2026-10-12', what: 'diagnostic', label: null, score: 20, outOf: 45 }]
  assert.match(V.testsView(soon), /3 days<\/b>\n  now: timed practice at the real length/)
  assert.match(html, /<b>Physics mechanics test<\/b>.*\n.*\n.*\n  no momentum/)
  assert.match(html, /30–60 min\/day/)
  assert.match(V.testsView({ ...W, tests: [] }), /No tests coming up/)
})

test('/review: due topics (most overdue first, how to review), mistake redos; or when the next one is', () => {
  const html = V.reviewView(W)
  assert.match(html, /^🔁 <b>Due today<\/b> \(Mon 19 Oct\)/)
  assert.match(html, /\(Mon 19 Oct\)\n• 🔴 <b>PC1-01 Matrices<\/b> <i>\(2 days late\)<\/i>: re-learn: notes \/ Bicen chapter summary \(5 min\) → 3–4 questions from Bicen Core Pure → CP1: Matrices \+ redo its mistakes · ≥ 80 % = 🟡, wrong → stays 🔴\n• 🔴 <b>Y1-16/, 'most overdue first')
  assert.match(html, /• 🟡 <b>Y1-04 Polynomials<\/b> <i>\(1 day late\)<\/i>: 3–4 questions from Bicen Pure: Polynomials \+ redo its 1 mistake · clean → colour up/)
  assert.doesNotMatch(html, /Kinematics/, 'not due yet')
  assert.match(html, /🧠 <b>Mistakes to redo<\/b> \(without looking\)\n• <b>PC1-03 Q3b<\/b>: assumed it went through the origin <i>\(redo 1 of 2\)<\/i>/)
  const calm = world(TODAY)
  calm.topics.forEach((t) => { t.lastDone = null })
  calm.mistakes = calm.mistakes.filter((m) => m.reviewOn > TODAY)
  assert.equal(V.reviewView(calm), '✅ Nothing due today. Next: a mistake redo Sun 25 Oct.')
})

test('/rules and /programmes', () => {
  assert.match(V.rulesView(W), /📌 <b>Rules<\/b>\n• paused: reviews until Sun 25 Oct\n/)
  const later = { ...W, rules: [{ ...W.rules[1], kind: 'boost', target: 'act', startsOn: '2026-10-26', endsOn: '2026-11-01' }] }
  assert.match(V.rulesView(later), /• from Mon 26 Oct: top priority: ACT until Sun 1 Nov/)
  assert.doesNotMatch(V.rulesView(W), /stretch/, 'ended rules aren’t listed')
  assert.match(V.rulesView({ ...W, rules: [] }), /No temporary rules right now/)
  const p = V.programmesView(W)
  assert.match(p, /▶️ <b>STEP<\/b> · this week 0\/1\n  1 a week · weekend · 2\/28 done · next: STEP Support – Assignment 3 \(#3\)/)
  const paused = world(TODAY)
  Object.assign(paused.programmes[0], { status: 'paused', pausedUntil: '2026-11-01' })
  assert.match(V.programmesView(paused), /⏸ <b>STEP<\/b>[\s\S]*paused until 2026-11-01/)
})

test('the resource ladder (lib/tracker/ladder.ts): textbook → exercise → mixed → Bicen (Integral Further for FS/FM) → Integral → stretch; 🔴 = fix first; physics', () => {
  const t = (o) => ({ ...topic('Y1-07'), ...o })
  const L = W.links
  assert.match(V.nextResource(t({ step: 0 }), L), /^Textbook: Logarithms: read the section \+ do the worked examples/)
  assert.match(V.nextResource(t({ step: 0, bookRef: 'Y1 red · 7' }), L), /^Textbook Y1 red · 7 \(Logarithms\)/)
  assert.match(V.nextResource(t({ step: 1 }), L), /the exercise, every 2nd question/)
  assert.match(V.nextResource(t({ step: 2 }), L), /the MIXED exercise \+ the red\/blue problem-solving questions/)
  assert.match(V.nextResource(t({ step: 3, bicen: 'Bicen Pure → Logs' }), L), /^Bicen Pure → Logs: one 30–45 min set, mark straight after/)
  assert.match(V.nextResource(t({ step: 3, strand: 'Further Stats', code: 'FS-01' }), L), /^Integral Further Statistics: Logarithms/)
  assert.match(V.nextResource(t({ step: 4 }), L), /^Integral topic assessment: Logarithms – timed, closed book \(≥ 85 % = 🟢\)/)
  assert.match(V.nextResource(t({ step: 5, status: 'exam_ready' }), L), /^Bicen 9 Hardest Questions/)
  assert.match(V.nextResource(t({ step: 4, status: 'not_secure' }), L), /^fix it: re-learn/)
  assert.match(V.nextResource(t({ step: 1, status: 'not_secure' }), L), /the exercise, every 2nd question/, 'not past the textbook yet: just the next step')
  assert.match(V.nextResource(topic('P1.1'), L), /^School booklet: Mechanics → Kinematics/)
  assert.match(V.nextResource({ ...topic('P1.1'), booklet: 'done' }, L), /^PMT CAIE topic questions: Kinematics/)
  assert.match(V.nextResource({ ...topic('P1.1'), booklet: 'done', pmt: 'done', concepts: 'vector resolution' }, L), /^Concepts I don't get \(vector resolution\)/)
  assert.match(V.nextResource(t({ step: 3 }), { ...L, bicenPure: 'https://example.org/bicen' }), /https:\/\/example\.org\/bicen$/, 'his pasted link goes with it')
})

test('"Next: …" after ✅: the topic’s next resource, the programme’s next item, a test’s next step, a mistake’s redo', () => {
  assert.match(V.nextLine(W, [{ topicId: topic('Y1-07').id }]), /^👉 <b>Next for Y1-07 Logarithms<\/b>: Textbook: Logarithms: read the section/)
  assert.equal(V.nextLine(W, [{ programmeId: W.programmes[0].id }]), '👉 <b>Next</b>: STEP #3 STEP Support – Assignment 3')
  assert.match(V.nextLine(W, [{ testId: W.tests[0].id }]), /a diagnostic, 1–2 fresh questions per topic/)
  assert.match(V.nextLine(W, [{ mistakeId: W.mistakes[0].id }]), /Redo it today without looking/)
  assert.equal(V.nextLine(W, [{ rule: 'added' }]), null)
})

test('Your week: "📌 Rules this week" lists the rules that overlap the week; none → no line', () => {
  assert.equal(V.rulesWeekLine(W.rules, '2026-10-19', '2026-10-25'), '📌 <b>Rules this week</b>: paused: reviews until Sun 25 Oct')
  assert.equal(V.rulesWeekLine(W.rules, '2026-10-26', '2026-11-01'), null)
})

test('the snapshot for the brain: one compact line per record, with its ref', () => {
  const s = V.snapshotSections(W)
  const topics = s[0].lines.join('\n')
  assert.match(topics, /^PC1-01 \| Matrices \| Further Maths · Further Pure \| 🔴 step 3 \| taught \| review due$/m)
  assert.match(topics, /^Y1-10 \| Trigonometric functions & equations \| Maths · Pure \| ⚪ step 0 \| next up 2026-11-02$/m)
  assert.match(topics, /^P1\.1 \| Kinematics \| Physics · Mechanics \| 🟡 booklet todo · pmt todo \| taught \| review 2026-10-20$/m)
  assert.match(s[1].lines.join('\n'), /^TS3 \| FM HT2 test \| 2026-11-12 \(24 days\) \| test · Further Maths \| topics PC1-01, PC1-02, PC1-03$/m)
  assert.match(s[2].lines[0], /^MK1 \| PC1-03 Q3b \| assumed it went through the origin \| knowledge \| redo 1 of 2 due$/)
  assert.match(s[3].lines[0], /^PG1 \| STEP \| active · 1\/week · weekend · this week 0\/1 \| next #3 STEP Support – Assignment 3$/)
  const gaps = world(TODAY)
  gaps.programmes[0].mode = 'gaps_only'
  assert.match(V.snapshotSections(gaps)[3].lines[0], /gaps_only \| next #3 STEP Support – Assignment 3 \(chapter test first\)$/)
  assert.match(s[4].lines[0], /^RL1 \| pause reviews \| 2026-10-18 to 2026-10-25/)
  assert.deepEqual(V.snapshotSections({ ...W, sqlMissing: true }), [])
})

test('"what next?": the top pick with exactly what to open, its steps and the next two', () => {
  const pick = { key: 'topic:x:ahead', kind: 'ahead', tier: 5, subject: 'Maths', title: 'Y1-10 Trig: learn ahead', open: 'Y1 red textbook ch 10 + worked examples', minutes: 90, why: 'next up in school order',
    steps: [{ minutes: 10, what: 'prerequisite check' }, { minutes: 25, what: 'learn from the textbook' }], done: { kind: 'block' } }
  const html = V.whatNextText(pick, [{ ...pick, title: 'Review Polynomials' }, { ...pick, title: 'STEP #3' }, { ...pick, title: 'hidden' }])
  assert.match(html, /^👉 <b>Y1-10 Trig: learn ahead<\/b> · 90 min\n📖 Y1 red textbook ch 10 \+ worked examples\n  10′ prerequisite check\n  25′ learn from the textbook\n<i>next up in school order<\/i>\n\nThen: Review Polynomials · STEP #3/)
  assert.doesNotMatch(html, /hidden/)
})

test('"what next?" with the real planner (lib/tracker/engine.ts): its top pick, and a "Done?" line the fast paths read back', async () => {
  const { planStudyDay } = await import('../lib/tracker/engine.ts')
  const { parseFast } = await import('../lib/tracker/bot-fast.ts')
  const sw = { ...W, homework: [], reviewDays: { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 }, doneToday: [] }
  const plan = planStudyDay(sw, { date: TODAY, dow: 1, mode: 'half_term', studyMinutes: 240 })
  assert.ok(plan.picks.length >= 3)
  const html = V.whatNextText(plan.picks[0], plan.picks.slice(1), W)
  assert.match(html, /^👉 <b>FM HT1 consolidation: daily slot<\/b> · 60 min\n📖 the teacher booklet for FM HT1 consolidation/, 'the consolidation within 3 weeks comes first')
  assert.match(html, /<i>Done\? Send the score \(“bicen PC1-01 8\/10”\) or the colour \(“PC1-01 🟡”\)<\/i>$/)
  // every hint is a message the bot understands without the AI
  for (const p of plan.picks) {
    const said = V.doneHint(p, W).match(/“([^”]+)”/)[1]
    const r = parseFast(said, W, TODAY)
    assert.equal(r?.kind, 'actions', `“${said}” is read back`)
  }
  const prog = W.programmes[0]
  const item = prog.items[2]
  assert.equal(V.doneHint({ ...plan.picks[0], done: { kind: 'programme_item', itemId: item.id } }, W), 'Done? “done STEP 3” (add “with hints, idea: …”)')
  assert.equal(V.doneHint({ ...plan.picks[0], done: { kind: 'programme_item', itemId: item.id, score: true } }, W), 'Done? Send the chapter-test score: “done STEP 3 12/15” (full marks skips that chapter)')
  assert.equal(V.doneHint({ ...plan.picks[0], topicId: W.topics.find((t) => t.code === 'P1.1').id, done: { kind: 'topic', topicId: 'x', physics: 'booklet' } }, W), 'Done? “P1.1 booklet done”')
  assert.equal(V.doneHint({ ...plan.picks[0], done: { kind: 'mistakes', mistakeIds: [W.mistakes[0].id] } }, W), 'Done? “redid PC1-03 Q3b” for each one')
  assert.equal(V.doneHint({ ...plan.picks[0], done: { kind: 'attempt', goalId: W.tests[0].id, what: 'diagnostic' } }, W), 'Done? Send the score: “FM HT2 test diagnostic 30/45”')
  for (const h of ['done STEP 3', 'P1.1 booklet done', 'redid PC1-03 Q3b', 'FM HT2 test diagnostic 30/45', 'done STEP 3 12/15']) assert.equal(parseFast(h, W, TODAY)?.kind, 'actions', h)
  // a booklet pick's label is its topic code: the hint says it, and it is kept on the attempt (only that topic's booklet ends)
  const booklet = V.doneHint({ ...plan.picks[0], done: { kind: 'attempt', goalId: W.tests[0].id, what: 'booklet', label: 'PC1-01' } }, W)
  assert.equal(booklet, 'Done? Send the score: “FM HT2 test booklet PC1-01 30/45”')
  const r = parseFast('FM HT2 test booklet PC1-01 30/45', W, TODAY)
  assert.equal(r.actions[0].ref, `test:${W.tests[0].id}`)
  assert.match(r.actions[0].value, /what=booklet; score=30; out_of=45; label=FM HT2 test booklet PC1-01/)
})
