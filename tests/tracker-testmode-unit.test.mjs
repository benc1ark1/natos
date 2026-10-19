// Test mode (plans/contracts.md §3.4 step 3, the SCHOOL TEST playbook), plain tests (no database): the 21-day window,
// the phase on each day (diagnostic first → teacher booklets, 🔴 first → topic work → timed practice 3–4 days before
// → light the day before → test day), consolidation's daily slot (half-term: the most, school: the least), the
// booklet named from the test's info, limits on every pick, the final-two-weeks 70/20/10 mix, the done hints.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-testmode-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { testsInWindow, testPhase, testCandidates, bookletDone, bookletFor, lightSubjects, nearestTest, orderedTestTopics, workTopics, testTopicsOf, timedRecently, practicePaper, TEST_WINDOW_DAYS, PER_TEST_PER_DAY } from '../lib/tracker/testmode.ts'
import { realWorld, test as mkTest, LINKS } from './fixtures/tracker-world.mjs'

const windowOf = (world, id, date) => testsInWindow(world, date).find((w) => w.test.id === id)
const attempt = (goalId, what, doneOn, label = null) => ({ id: `a-${what}-${doneOn}`, goalId, doneOn, what, label, score: null, outOf: null })
const withAttempts = (world, id, attempts) => ({ ...world, tests: world.tests.map((t) => (t.id === id ? { ...t, attempts: [...t.attempts, ...attempts] } : t)) })

test('the window: tests from today to 21 days ahead, nearest first; past, undated and ACT tests are out', () => {
  const w = realWorld()
  const ids = (date) => testsInWindow(w, date).map((x) => x.test.id)
  assert.equal(TEST_WINDOW_DAYS, 21)
  assert.deepEqual(ids('2026-10-19'), ['g-ht1'], 'only the consolidation (due 2 Nov) on Mon 19 Oct')
  assert.deepEqual(ids('2026-10-20'), ['g-ht1', 'g-mech'], 'mechanics (10 Nov) is 21 days away on Tue 20 Oct')
  assert.deepEqual(ids('2026-10-22'), ['g-ht1', 'g-mech', 'g-ht2', 'g-waves'])
  assert.deepEqual(ids('2026-11-03'), ['g-mech', 'g-ht2', 'g-waves'], 'the consolidation is past')
  assert.deepEqual(ids('2026-11-13'), [])
  const more = { ...w, tests: [...w.tests, mkTest({ id: 'act', title: 'ACT retake', kind: 'act', date: '2026-11-01' }), mkTest({ id: 'x', title: 'Someday', date: null })] }
  assert.ok(!ids.call(null, '2026-10-22').includes('act'))
  assert.deepEqual(testsInWindow(more, '2026-10-22').map((x) => x.test.id).filter((i) => i === 'act' || i === 'x'), [])
})

test('a test\'s topics come from its codes; a consolidation also gets the topics of its mistakes; its subjects include its topics\'', () => {
  const w = realWorld()
  const ht2 = windowOf(w, 'g-ht2', '2026-10-22')
  assert.deepEqual(ht2.topics.map((t) => t.code), ['PC1-01', 'PC1-03', 'PC1-02', 'Y1-08', 'Y1-13', 'Y1-14'])
  assert.deepEqual(ht2.subjects.sort(), ['Further Maths', 'Maths'], 'an FM test with Y1 topics is light for Maths too')
  const ht1 = windowOf(w, 'g-ht1', '2026-10-19')
  assert.deepEqual(ht1.topics.map((t) => t.code), ['PC1-01', 'PC1-03', 'Y1-10'])
  assert.deepEqual(testTopicsOf(mkTest({ id: 'q', topicCodes: ['pc1-01', 'NOPE'] }), w.topics).map((t) => t.code), ['PC1-01'], 'case-insensitive; unknown codes ignored')
})

test('FM HT2, day by day: diagnostic first → booklets → topics → timed practice 3–4 days before → topics → light the day before → test day', () => {
  let w = realWorld()
  const phase = (date) => testPhase(windowOf(w, 'g-ht2', date), date)
  assert.equal(phase('2026-10-22'), 'diagnostic', '21 days before, no diagnostic yet')
  assert.equal(phase('2026-11-07'), 'diagnostic', 'still no diagnostic 5 days before → still first')
  w = withAttempts(w, 'g-ht2', [attempt('g-ht2', 'diagnostic', '2026-10-22')])
  assert.equal(phase('2026-10-23'), 'booklet', 'diagnostic done → teacher booklets')
  w = withAttempts(w, 'g-ht2', [attempt('g-ht2', 'booklet', '2026-10-27', 'HT2 booklets')])
  assert.equal(phase('2026-10-28'), 'topics', 'a booklet attempt naming no code = all its booklets done')
  assert.equal(phase('2026-11-07'), 'topics', '5 days before')
  assert.equal(phase('2026-11-08'), 'timed', '4 days before')
  assert.equal(phase('2026-11-09'), 'timed', '3 days before, no timed yet')
  w = withAttempts(w, 'g-ht2', [attempt('g-ht2', 'timed', '2026-11-08')])
  assert.equal(phase('2026-11-09'), 'topics', 'a timed practice in the last 3 days → no second one')
  assert.equal(phase('2026-11-10'), 'topics', '2 days before')
  assert.equal(phase('2026-11-11'), 'light', 'the day before')
  assert.equal(phase('2026-11-12'), 'test_day')
})

test('diagnostic is skipped when the timed practice is already due (it tells the colours too)', () => {
  const w = realWorld()
  assert.equal(testPhase(windowOf(w, 'g-ht2', '2026-11-08'), '2026-11-08'), 'timed')
  assert.equal(testPhase(windowOf(w, 'g-ht2', '2026-11-10'), '2026-11-10'), 'booklet', '2 days before, never diagnosed: booklets, no diagnostic')
  const t = { attempts: [attempt('g', 'paper', '2026-11-06')] }
  assert.ok(timedRecently(t, '2026-11-09'))
  assert.ok(!timedRecently(t, '2026-11-10'))
})

test('booklets: per topic, 🔴 first; a booklet attempt naming codes marks only those; physics uses its booklet column', () => {
  const w = withAttempts(realWorld(), 'g-ht2', [attempt('g-ht2', 'diagnostic', '2026-10-22')])
  const win = windowOf(w, 'g-ht2', '2026-10-23')
  const cands = testCandidates(win, '2026-10-23', LINKS, 'half_term', w.mistakes)
  const booklets = cands.filter((c) => c.pick.kind === 'test_booklet')
  assert.deepEqual(booklets.map((c) => c.pick.title).slice(0, 2), ['FM HT2 test booklet: Y1-08 Exponential models', 'FM HT2 test booklet: PC1-03 Applications of matrices'], '🔴 topics first (never done first)')
  assert.equal(booklets[1].pick.open, 'Same booklet – invariant lines NOT through the origin → PC1-03 Applications of matrices: every question, mark it (green / red / purple)')
  assert.deepEqual(booklets[0].pick.done, { kind: 'attempt', goalId: 'g-ht2', what: 'booklet', label: 'Y1-08' }, 'the tick names the topic')
  const test2 = { ...win.test, attempts: [attempt('g-ht2', 'booklet', '2026-10-24', 'booklet PC1-03 and pc1-01')] }
  assert.ok(bookletDone(test2, w.topics.find((t) => t.code === 'PC1-03')))
  assert.ok(bookletDone(test2, w.topics.find((t) => t.code === 'PC1-01')))
  assert.ok(!bookletDone(test2, w.topics.find((t) => t.code === 'Y1-08')))
  const mech = windowOf(w, 'g-mech', '2026-10-23')
  const p11 = w.topics.find((t) => t.code === 'P1.1')
  assert.ok(bookletDone(mech.test, p11), 'P1.1 booklet column = done')
  const pc = testCandidates({ ...mech, test: { ...mech.test, attempts: [attempt('g-mech', 'diagnostic', '2026-10-20')] } }, '2026-10-23', LINKS, 'half_term')
  const first = pc.find((c) => c.pick.kind === 'test_booklet')
  assert.equal(first.pick.title, "Physics mechanics test booklet: P3.1 Newton's laws of motion")
  assert.equal(first.pick.open, "Mechanics booklet: the Newton's laws of motion (momentum part later) section – every exam question, mark it · no momentum")
  assert.deepEqual(first.pick.done, { kind: 'topic', topicId: 't-P3.1', physics: 'booklet' })
})

test('the booklet named from the test\'s info: a "CODE: …" line, else its booklet sentence, else the teacher booklet', () => {
  const w = realWorld()
  const ht2 = w.tests.find((t) => t.id === 'g-ht2')
  const byCode = (c) => w.topics.find((t) => t.code === c)
  assert.equal(bookletFor(ht2, byCode('PC1-02')), 'Booklet: AS Further Vectors')
  assert.equal(bookletFor(ht2, byCode('Y1-14')), 'Booklet: Differentiation – optimisation')
  assert.equal(bookletFor(ht2, null), "Booklets on Classroom ('HT2 Test Information')")
  assert.equal(bookletFor(w.tests.find((t) => t.id === 'g-mech'), byCode('P2.1')), 'Mechanics booklet')
  assert.equal(bookletFor(w.tests.find((t) => t.id === 'g-waves'), byCode('P7.1')), 'the teacher booklet for Physics waves test')
})

test('diagnostic pick: 1–2 fresh questions per topic, no notes → colour each; 5 min a topic (15–60); limits shown', () => {
  const w = realWorld()
  const [diag] = testCandidates(windowOf(w, 'g-mech', '2026-10-20'), '2026-10-20', LINKS, 'half_term')
  assert.equal(diag.pick.kind, 'test_diagnostic')
  assert.equal(diag.pick.key, 'test:g-mech:diagnostic')
  assert.equal(diag.pick.minutes, 45, '9 topics × 5')
  assert.match(diag.pick.open, /^Diagnostic: 1–2 fresh questions per topic \(PMT CAIE topic questions\), no notes → colour each: P1\.1, P1\.2, P1\.3, P1\.4, P5\.1, P5\.2, P2\.1, P3\.1, P3\.2 · no momentum$/)
  assert.equal(diag.pick.why, 'Physics mechanics test in 21 days · diagnostic first · no momentum')
  assert.deepEqual(diag.pick.done, { kind: 'attempt', goalId: 'g-mech', what: 'diagnostic' })
  const [fm] = testCandidates(windowOf(w, 'g-ht2', '2026-10-22'), '2026-10-22', LINKS, 'half_term')
  assert.equal(fm.pick.minutes, 30)
  assert.match(fm.pick.open, /\(Bicen exam questions\)/)
  const one = { test: mkTest({ id: 'one', title: 'Quiz', date: '2026-11-01', topicCodes: ['Y1-01'] }), daysLeft: 13, topics: [w.topics[0]], subjects: ['Maths'] }
  assert.equal(testCandidates(one, '2026-10-19', LINKS, 'school')[0].pick.minutes, 15, 'at least 15')
})

test('timed practice at real length (+15 to mark), unshrinkable; light day: that test\'s mistakes + formula booklet / equations', () => {
  const w = realWorld()
  const [timed] = testCandidates(windowOf(w, 'g-ht2', '2026-11-08'), '2026-11-08', LINKS, 'school')
  assert.equal(timed.pick.kind, 'test_timed')
  assert.equal(timed.pick.minutes, 65)
  assert.equal(timed.min, 65)
  assert.equal(timed.pick.open, 'Timed practice, closed book: a mixed set of exam questions on PC1-01, PC1-03, PC1-02, Y1-08, Y1-13, Y1-14, timed at 50 min → mark it → log the score + every mistake', 'one resource')
  assert.deepEqual(timed.pick.steps, [{ minutes: 50, what: 'timed, closed book, 50 min (~45 marks)' }, { minutes: 15, what: 'mark it, log the score + every mistake' }])
  assert.deepEqual(timed.pick.done, { kind: 'attempt', goalId: 'g-ht2', what: 'timed' })
  const light = testCandidates(windowOf(w, 'g-ht2', '2026-11-11'), '2026-11-11', LINKS, 'school', w.mistakes)
  assert.equal(light.length, 1, 'the day before: only the light pick')
  assert.equal(light[0].pick.kind, 'test_light')
  assert.equal(light[0].pick.minutes, 20)
  assert.equal(light[0].pick.open, "Light: read FM HT2 test's mistakes (3) + the formula booklet, then sleep early", 'the mistakes on its topics')
  assert.equal(light[0].pick.heavy, false)
  const plight = testCandidates(windowOf(w, 'g-mech', '2026-11-09'), '2026-11-09', LINKS, 'school', w.mistakes)
  assert.match(plight[0].pick.open, /the equations you must know, then sleep early · no momentum$/)
  assert.deepEqual(testCandidates(windowOf(w, 'g-ht2', '2026-11-12'), '2026-11-12', LINKS, 'school'), [], 'test day: nothing to prep')
})

test('the day before a test is light for its subjects (test subject + its topics\' subjects)', () => {
  const w = realWorld()
  assert.deepEqual([...lightSubjects(testsInWindow(w, '2026-11-11'), '2026-11-11').keys()].sort(), ['further maths', 'maths', 'physics'])
  assert.deepEqual([...lightSubjects(testsInWindow(w, '2026-11-09'), '2026-11-09').keys()], ['physics'])
  assert.deepEqual([...lightSubjects(testsInWindow(w, '2026-11-08'), '2026-11-08').keys()], [])
})

test('consolidation: one daily slot — half-term the most (60), school the least (30); topics you lost marks on; rotates', () => {
  const w = realWorld()
  const win = windowOf(w, 'g-ht1', '2026-10-19')
  assert.equal(testPhase(win, '2026-10-19'), 'consolidation')
  const [half] = testCandidates(win, '2026-10-19', LINKS, 'half_term')
  const [school] = testCandidates(win, '2026-10-19', LINKS, 'school')
  assert.equal(half.pick.minutes, 60)
  assert.equal(school.pick.minutes, 30)
  assert.equal(half.min, 30, 'can shrink to the least')
  assert.equal(half.pick.key, 'test:g-ht1:consolidation')
  assert.equal(half.pick.why, 'due Mon 2 Nov · 30–60 min/day')
  assert.equal(half.pick.open, "Consolidation booklets on Classroom ('HT1 Consolidation') · today: Y1-10 Trigonometric functions and equations (🔴)", 'the Classroom booklets only, no "min/day" clause')
  assert.ok(half.pick.open.length <= 120)
  assert.deepEqual(half.pick.done, { kind: 'topic', topicId: 't-Y1-10' })
  assert.equal(testCandidates(win, '2026-11-01', LINKS, 'half_term').length, 1, 'the day before its due date: still the slot (no light day for a consolidation)')
})

test('topic work: 🔴 → 🟡 → ⚪ → 🟢; >14 days: 🔴 = fix steps, 🟡/⚪ = one Bicen / PMT set; last 14 days: 70 % exam Qs · 20 % relearning · 10 % stretch', () => {
  let w = withAttempts(realWorld(), 'g-ht2', [attempt('g-ht2', 'diagnostic', '2026-10-22'), attempt('g-ht2', 'booklet', '2026-10-25')])
  const early = windowOf(w, 'g-ht2', '2026-10-26')
  assert.deepEqual(orderedTestTopics(early, '2026-10-26').map((t) => t.code), ['Y1-08', 'PC1-03', 'Y1-13', 'PC1-01', 'PC1-02', 'Y1-14'], '🔴 (never done first) → 🟡 (least recent first) → ⚪')
  const cands = testCandidates(early, '2026-10-26', LINKS, 'half_term')
  assert.equal(cands[1].pick.title, 'PC1-03 Applications of matrices: fix 🔴')
  assert.deepEqual(cands[1].pick.steps.map((s) => s.minutes), [10, 10, 25])
  assert.equal(cands[2].pick.title, 'Y1-13 Differentiation: exam questions')
  assert.equal(cands[2].pick.open, 'Bicen Pure → AS: Differentiation: one 30–45 min set, mark straight after + redo its mistakes')
  assert.deepEqual(cands[2].pick.done, { kind: 'topic', topicId: 't-Y1-13', step: 4 })
  assert.equal(cands[2].pick.why, 'FM HT2 test in 17 days · 🟡')
  const late = testCandidates(windowOf(w, 'g-ht2', '2026-11-02'), '2026-11-02', LINKS, 'school')
  const s = late[1].pick.steps
  assert.deepEqual(s.map((x) => x.minutes), [9, 32, 4], '45 min split 20 / 70 / 10')
  assert.match(s[0].what, /^targeted relearning: invariant lines not through the origin$/, 'his weak notes')
  assert.match(s[1].what, /^exam questions: Bicen Core Pure → CP1: Linear Transformations/)
  assert.match(s[2].what, /^stretch: one harder question/)
  const mech = withAttempts(w, 'g-mech', [attempt('g-mech', 'diagnostic', '2026-10-20')])
  const m = testCandidates(windowOf({ ...mech, topics: mech.topics.map((t) => ({ ...t, booklet: 'done' })) }, 'g-mech', '2026-10-25'), '2026-10-25', LINKS, 'half_term')
  const p14 = m.find((c) => c.pick.title.startsWith('P1.4'))
  assert.equal(p14.pick.open, 'PMT CAIE topic questions: PMT topic 1 → Scalars and vectors · no momentum', 'limits on every pick')
  assert.deepEqual(p14.pick.done, { kind: 'topic', topicId: 't-P1.4', physics: 'pmt' })
})

test('limits; nearest test for "🔥 Test mode" prefers a real test over a consolidation; daily caps', () => {
  const w = realWorld()
  assert.deepEqual(nearestTest(testsInWindow(w, '2026-10-20')), { goalId: 'g-mech', title: 'Physics mechanics test', daysLeft: 21 })
  assert.deepEqual(nearestTest(testsInWindow(w, '2026-10-19')), { goalId: 'g-ht1', title: 'FM HT1 Consolidation', daysLeft: 14 })
  assert.equal(nearestTest([]), null)
  assert.equal(PER_TEST_PER_DAY, 2)
})

const attemptL = (goalId, what, doneOn, label) => ({ id: `a-${what}-${doneOn}-${label}`, goalId, doneOn, what, label, score: null, outOf: null })

test('ticking one booklet ends only THAT topic\'s booklet: the other 5 stay due', () => {
  const w = withAttempts(realWorld(), 'g-ht2', [attempt('g-ht2', 'diagnostic', '2026-10-22')])
  const win = windowOf(w, 'g-ht2', '2026-10-23')
  const first = testCandidates(win, '2026-10-23', LINKS, 'half_term').find((c) => c.pick.kind === 'test_booklet')
  assert.equal(first.pick.done.label, 'Y1-08')
  const after = withAttempts(w, 'g-ht2', [attemptL('g-ht2', 'booklet', '2026-10-23', first.pick.done.label)])
  const win2 = windowOf(after, 'g-ht2', '2026-10-24')
  const due = testCandidates(win2, '2026-10-24', LINKS, 'half_term').filter((c) => c.pick.kind === 'test_booklet').map((c) => c.pick.topicId)
  assert.equal(due.length, 5)
  assert.ok(!due.includes('t-Y1-08'))
  assert.equal(testPhase(win2, '2026-10-24'), 'booklet')
  assert.deepEqual(workTopics(win2, '2026-10-24').map((t) => t.code), ['Y1-08'], 'topic work only where the booklet is done')
})

test('teacher booklet first everywhere: in the timed phase the booklets still due come right after the timed pick', () => {
  const w = withAttempts(realWorld(), 'g-ht2', [attempt('g-ht2', 'diagnostic', '2026-10-22'), attemptL('g-ht2', 'booklet', '2026-10-25', 'PC1-01')])
  const c = testCandidates(windowOf(w, 'g-ht2', '2026-11-08'), '2026-11-08', LINKS, 'school')
  assert.equal(c[0].pick.kind, 'test_timed')
  assert.ok(c.slice(1, 6).every((x) => x.pick.kind === 'test_booklet'), c.map((x) => x.pick.kind).join())
  assert.ok(c.filter((x) => x.pick.kind === 'test_topic').every((x) => x.pick.topicId === 't-PC1-01'), 'topic work only on PC1-01 (its booklet is done)')
})

test('test time goes to 🔴/🟡/⚪ only: no 🟢 topic work', () => {
  let w = withAttempts(realWorld(), 'g-mech', [attempt('g-mech', 'diagnostic', '2026-10-20')])
  w = { ...w, topics: w.topics.map((t) => ({ ...t, booklet: 'done' })) }
  const c = testCandidates(windowOf(w, 'g-mech', '2026-10-25'), '2026-10-25', LINKS, 'half_term')
  const ids = c.map((x) => x.pick.topicId)
  assert.ok(!ids.includes('t-P1.1') && !ids.includes('t-P1.2'), 'P1.1 / P1.2 are 🟢')
  assert.ok(ids.includes('t-P3.1') && ids.includes('t-P5.2'))
})

test('physics topic work in the final two weeks is the PMT step: its tick marks PMT done', () => {
  let w = withAttempts(realWorld(), 'g-mech', [attempt('g-mech', 'diagnostic', '2026-10-20')])
  w = { ...w, topics: w.topics.map((t) => ({ ...t, booklet: 'done' })) }
  const p = testCandidates(windowOf(w, 'g-mech', '2026-11-02'), '2026-11-02', LINKS, 'school').find((x) => x.pick.topicId === 't-P2.1')
  assert.deepEqual(p.pick.done, { kind: 'topic', topicId: 't-P2.1', physics: 'pmt' })
})

test('timed practice names ONE resource: the teacher\'s practice paper when the info names one', () => {
  const w = realWorld()
  const ht2 = w.tests.find((t) => t.id === 'g-ht2')
  assert.equal(practicePaper(ht2), null)
  const withPaper = { ...w, tests: w.tests.map((t) => (t.id === 'g-ht2' ? { ...t, info: `${t.info}\nPractice paper: HT2 practice test on Classroom.` } : t)) }
  const [timed] = testCandidates(windowOf(withPaper, 'g-ht2', '2026-11-08'), '2026-11-08', LINKS, 'school')
  assert.equal(timed.pick.open, 'Timed practice, closed book: Practice paper: HT2 practice test on Classroom → mark it → log the score + every mistake')
})

test('a test with no topic codes: every pick asks for them ("<test> topics: …") and uses its info', () => {
  const w = { ...realWorld(), tests: [mkTest({ id: 'q', title: 'Stats quiz', date: '2026-11-05', subject: 'Maths', info: 'Data and probability so far. 30 minutes.' })] }
  const c = testCandidates(windowOf(w, 'q', '2026-10-22'), '2026-10-22', LINKS, 'school')
  assert.equal(c[0].pick.kind, 'test_diagnostic')
  for (const x of c) assert.match(x.pick.why, /tell me its topics \("Stats quiz topics: …"\)/)
  assert.match(c[0].pick.open, /what its info says \("Data and probability so far"\)/)
  assert.equal(c[1].pick.kind, 'test_booklet')
})
