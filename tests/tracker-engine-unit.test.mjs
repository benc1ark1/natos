// The study planner (plans/contracts.md §3.4), plain tests (no database, no clock): the strict priority order, homework
// never dropped for time, tests within 21 days, reviews + mistake redos, one taught 🔴, the leftover split (half-term /
// school), the ahead session (maths only, school order, move on at 🟡), stretch only on 🟢, programmes, temporary rules
// (pause / boost / cap / note, live dates only), the light day before a test, ≤ maxPicks (default 5), extras merged by tier,
// deterministic output, what's done today isn't picked again.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-engine-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planStudyDay, MAX_PICKS, DEFAULT_PICKS, slotRank, HOMEWORK_OPEN } from '../lib/tracker/engine.ts'
import { TIER } from '../lib/plan-items.ts'
import { addDays } from '../lib/time.ts'
import { emptyWorld, realWorld, realTests, topic, test as mkTest, mistake, homework, rule, programme, item, stepProgramme, dayOf, LINKS } from './fixtures/tracker-world.mjs'

const MON = '2026-10-19', SAT = '2026-10-24'
const kinds = (plan) => plan.picks.map((p) => p.kind)
const keys = (plan) => plan.picks.map((p) => p.key)
const mins = (plan, f = () => true) => plan.picks.filter(f).reduce((a, p) => a + p.minutes, 0)
const act = (o = {}) => ({ key: 'act:english:steady', kind: 'act', tier: TIER.leftover, subject: 'ACT', title: 'ACT English: Meltzer ch 3', open: 'Complete Guide to ACT English – chapter 3', minutes: 75, why: 'steady ACT', done: { kind: 'act', section: 'english' }, ...o })

// a small calm world: no tests; one of each kind of topic
const T = {
  green1: topic({ code: 'Y1-01', subject: 'Maths', strand: 'Pure', name: 'Proof', taughtFrom: '2026-09-01', status: 'exam_ready', step: 5, lastDone: '2026-10-17', bookRef: 'Y1 red · 1', bicen: 'Bicen Pure → AS: Algebraic Methods (proof)', order: 0 }),
  green2: topic({ code: 'Y1-02', subject: 'Maths', strand: 'Pure', name: 'Indices and surds', taughtFrom: '2026-09-01', status: 'exam_ready', step: 5, lastDone: '2026-10-16', bookRef: 'Y1 red · 2', order: 1 }),
  yellow: topic({ code: 'Y1-03', subject: 'Maths', strand: 'Pure', name: 'Quadratic functions', taughtFrom: '2026-09-01', status: 'understand', step: 4, lastDone: '2026-10-16', bookRef: 'Y1 red · 3', bicen: 'Bicen Pure → AS: Quadratics', order: 2 }),
  red: topic({ code: 'Y1-07', subject: 'Maths', strand: 'Pure', name: 'Logarithms', taughtFrom: '2026-09-21', status: 'not_secure', step: 2, lastDone: null, bookRef: 'Y1 red · 7', bicen: 'Bicen Pure → AS: Exponentials and Logarithms', order: 3 }),
  next1: topic({ code: 'PC1-06', subject: 'Further Maths', strand: 'Further Pure', name: 'Mathematical induction', taughtFrom: '2026-11-02', bookRef: 'PC1 blue · 6', bicen: 'Bicen Core Pure → CP1: Proof by Induction', order: 3 }),
  next2: topic({ code: 'PC1-04', subject: 'Further Maths', strand: 'Further Pure', name: 'Complex numbers', taughtFrom: '2026-11-02', bookRef: 'PC1 blue · 4', order: 4 }),
  nextY: topic({ code: 'Y1-16', subject: 'Maths', strand: 'Statistics', name: 'Working with data', taughtFrom: '2026-10-26', status: 'understand', order: 10 }),
  physNext: topic({ code: 'P3.3', subject: 'Physics', strand: 'Dynamics', name: 'Linear momentum', taught: 'not_yet', taughtFrom: '2026-10-26', booklet: 'todo', pmt: 'todo', order: 7 }),
  physClass: topic({ code: 'P7.1', subject: 'Physics', strand: 'Waves', name: 'Progressive waves', taught: 'in_class', booklet: 'todo', pmt: 'todo', pmtRef: 'PMT topic 7', order: 15 }),
  later: topic({ code: 'Y2-06', subject: 'Maths', strand: 'Pure', name: 'General binomial expansion', taughtFrom: '2027-01-04', order: 33 }),
}
const calm = (o = {}) => emptyWorld({ topics: Object.values(T).map((t) => ({ ...t })), links: LINKS, ...o })

test('the strict order: homework → test → review → fix 🔴 → ahead → leftover share; tiers never go down the list', () => {
  const w = calm({
    homework: [homework({ id: 'h1', title: 'Logs worksheet', subject: 'Maths', dueAt: '2026-10-20T12:00:00Z', minutes: 30 })],
    tests: [mkTest({ id: 'quiz', title: 'Stats quiz', date: '2026-10-23', subject: 'Maths', lengthMin: 30 })],
    topics: Object.values(T).map((t) => (t.code === 'Y1-03' ? { ...t, lastDone: '2026-10-15' } : { ...t })),
  })
  const plan = planStudyDay(w, { ...dayOf(MON, 'half_term', 400), maxPicks: 6 })
  assert.deepEqual(kinds(plan), ['homework', 'test_timed', 'test_booklet', 'review', 'fix', 'ahead'])
  assert.deepEqual(plan.picks.map((p) => p.tier), [TIER.homework, TIER.test, TIER.test, TIER.review, TIER.fix, TIER.ahead])
  assert.equal(plan.picks[2].key, 'test:quiz:booklet', 'a test with no topics: its teacher booklet after the timed practice')
  assert.equal(plan.picks[4].topicId, 't-Y1-07', 'tier 4: the taught 🔴')
  assert.equal(plan.picks.length, MAX_PICKS)
  const five = planStudyDay(w, dayOf(MON, 'half_term', 400))
  assert.equal(five.picks.length, DEFAULT_PICKS, 'default: 5 study picks')
  assert.deepEqual(kinds(five), ['homework', 'test_timed', 'test_booklet', 'review', 'fix'])
})

test('homework is never dropped for time: 0 study minutes → still both homeworks, nothing else', () => {
  const w = calm({ homework: [homework({ id: 'a', title: 'Sheet A', subject: 'Physics', dueAt: '2026-10-21T12:00:00Z', minutes: 60 }), homework({ id: 'b', title: 'Sheet B', dueAt: '2026-10-20' })] })
  const plan = planStudyDay(w, dayOf(MON, 'school', 0))
  assert.deepEqual(keys(plan), ['task:b', 'task:a'], 'earliest first')
  assert.equal(plan.picks[0].minutes, 45, 'no minutes → 45')
  assert.equal(plan.picks[0].open, HOMEWORK_OPEN)
  assert.equal(plan.picks[0].open, 'Do it in black · mark green/red/purple · log red/purple as mistakes')
  assert.deepEqual(plan.picks[1].done, { kind: 'task', taskId: 'a' })
  assert.match(plan.notes.join(' | '), /homework fills today's study time \(105 min over\)/)
  const busy = planStudyDay({ ...w, rules: [rule({ kind: 'cap', target: 'subjects:Maths,Physics', minutes: 10 }), rule({ kind: 'pause', target: 'physics' })] }, dayOf(MON, 'school', 30))
  assert.deepEqual(keys(busy), ['task:b', 'task:a'], 'pause / cap never touch homework')
})

test('homework: due within 7 days or overdue, earliest first; later or undated ones wait', () => {
  const w = calm({ homework: [
    homework({ id: 'late', title: 'Old one', subject: 'Maths', dueAt: '2026-10-16T12:00:00Z' }),
    homework({ id: 'd7', title: 'Due in 7', dueAt: '2026-10-26T12:00:00Z' }),
    homework({ id: 'd8', title: 'Due in 8', dueAt: '2026-10-27T12:00:00Z' }),
    homework({ id: 'none', title: 'No date', dueAt: null }),
    homework({ id: 'today', title: 'Today', subject: 'Further Maths', dueAt: '2026-10-19T12:00:00Z' }),
  ] })
  const plan = planStudyDay(w, dayOf(MON, 'school', 60))
  const hw = plan.picks.filter((p) => p.kind === 'homework')
  assert.deepEqual(hw.map((p) => p.key), ['task:late', 'task:today', 'task:d7'])
  assert.deepEqual(hw.map((p) => p.why), ['overdue (was due Fri)', 'due today', 'due Mon 26 Oct'])
  assert.deepEqual(hw.map((p) => p.title), ['Maths homework: Old one', 'Further Maths homework: Today', 'Homework: Due in 7'])
})

test('tests: only within 21 days; ≤ 2 picks a test, no daily test cap (nearest first, one each first); left-out tests are named', () => {
  const far = calm({ tests: [mkTest({ id: 'far', title: 'Far test', date: addDays(MON, 22), subject: 'Maths', topicCodes: ['Y1-03'] })] })
  assert.equal(planStudyDay(far, dayOf(MON, 'half_term', 300)).picks.filter((p) => p.goalId === 'far').length, 0)
  const near = calm({ tests: [mkTest({ id: 'near', title: 'Near test', date: addDays(MON, 21), subject: 'Maths', topicCodes: ['Y1-03', 'Y1-07'] })] })
  const p1 = planStudyDay(near, dayOf(MON, 'half_term', 300)).picks.filter((p) => p.goalId === 'near')
  assert.deepEqual(p1.map((p) => p.kind), ['test_diagnostic', 'test_booklet'], 'diagnostic first, then its booklet')
  const five = calm({ tests: [1, 2, 3, 4, 5].map((n) => mkTest({ id: `t${n}`, title: `Test ${n}`, date: addDays(MON, 6 + n), subject: 'Maths', topicCodes: ['Y1-03', 'Y1-07', 'Y1-01'] })) })
  const plan = planStudyDay(five, { ...dayOf(MON, 'half_term', 600), maxPicks: 6 })
  const t = plan.picks.filter((p) => p.tier === TIER.test)
  assert.deepEqual(t.map((p) => p.goalId), ['t1', 't2', 't3', 't4', 't5', 't1'], 'one each (nearest first), then a second; no daily test cap')
  for (const g of ['t1', 't2', 't3', 't4', 't5']) assert.ok(t.filter((p) => p.goalId === g).length <= 2)
  const tight = planStudyDay(five, dayOf(MON, 'half_term', 600))
  const note = tight.notes.find((n) => n.startsWith('left for another day:'))
  for (const g of ['Test 1', 'Test 2', 'Test 3', 'Test 4', 'Test 5']) assert.ok(tight.picks.some((p) => p.title.startsWith(g)) || note.includes(g), `${g} is never silently dropped`)
  assert.ok(note.includes('Test 1') && note.includes('Test 2'), 'their second picks lost to the cap → named')
})

test('the day before a test: only its light pick in its subjects (redos + homework still fine); other subjects as normal', () => {
  const w = realWorld()
  const day = dayOf('2026-11-09', 'school', 240)
  w.tests = w.tests.map((t) => ({ ...t, attempts: [...t.attempts, { id: `d-${t.id}`, goalId: t.id, doneOn: '2026-10-22', what: 'diagnostic', label: null, score: null, outOf: null }] }))
  w.homework = [homework({ id: 'hp', title: 'Physics sheet', subject: 'Physics', dueAt: '2026-11-10T12:00:00Z', minutes: 30 })]
  const plan = planStudyDay(w, day)
  const physics = plan.picks.filter((p) => p.subject === 'Physics')
  assert.ok(physics.some((p) => p.kind === 'test_light' && p.goalId === 'g-mech'))
  assert.ok(physics.every((p) => ['test_light', 'homework', 'mistake_redo'].includes(p.kind)), physics.map((p) => p.kind).join())
  assert.ok(!plan.picks.some((p) => p.goalId === 'g-waves'), 'the waves test is physics too: its timed practice waits')
  assert.ok(plan.picks.some((p) => p.goalId === 'g-ht2'), 'maths test prep goes on')
  assert.equal(plan.picks[0].kind, 'homework')
  assert.ok(plan.notes.includes('day before Physics mechanics test: light only for Physics'))
  const light = plan.picks.find((p) => p.kind === 'test_light')
  assert.equal(light.minutes, 20)
  assert.match(light.why, /^Physics mechanics test tomorrow · day before: light only · no momentum$/)
})

test('the test day itself: no prep for it, a note to log the score + mistakes', () => {
  const plan = planStudyDay(realWorld(), dayOf('2026-11-12', 'school', 120))
  assert.ok(!plan.picks.some((p) => p.goalId === 'g-ht2' || p.goalId === 'g-waves'))
  assert.ok(plan.notes.includes('FM HT2 test is today – afterwards log the score + every mistake'))
})

test('consolidation daily slot: half-term the most (60 min), school the least (30 min)', () => {
  const w = realWorld({ homework: [] })
  const half = planStudyDay(w, dayOf(MON, 'half_term', 300)).picks.find((p) => p.kind === 'consolidation')
  const school = planStudyDay(w, dayOf(MON, 'school', 300)).picks.find((p) => p.kind === 'consolidation')
  assert.equal(half.minutes, 60)
  assert.equal(school.minutes, 30)
  assert.equal(half.tier, TIER.test)
})

test('limits are shown on test picks ("no momentum")', () => {
  const plan = planStudyDay(realWorld(), dayOf('2026-10-20', 'half_term', 300))
  const mech = plan.picks.filter((p) => p.goalId === 'g-mech')
  assert.ok(mech.length >= 1)
  for (const p of mech) { assert.match(p.why, /no momentum/); assert.match(p.open, /no momentum/) }
})

test('reviews: ≤ 2 a day, 🔴 first then the most overdue; all mistake redos due = one pick (5 min each, 10–30, ≤ 6)', () => {
  const due = (code, status, lastDone, order) => topic({ code, subject: 'Maths', strand: 'Pure', name: code, taughtFrom: '2026-09-01', status, lastDone, order })
  const w = emptyWorld({
    topics: [due('A', 'understand', '2026-10-10', 0), due('B', 'exam_ready', '2026-10-01', 1), due('C', 'not_secure', '2026-10-18', 2), due('D', 'understand', '2026-10-16', 3)],
    mistakes: Array.from({ length: 8 }, (_, i) => mistake({ id: `m${i}`, code: 'A', question: `Q${i + 1}`, loggedOn: '2026-10-10', reviewOn: addDays('2026-10-12', i % 4) })),
  })
  const plan = planStudyDay(w, dayOf(MON, 'half_term', 300))
  const reviews = plan.picks.filter((p) => p.kind === 'review')
  assert.deepEqual(reviews.map((p) => p.topicId), ['t-C', 't-A'], '🔴 first, then A (due 13 Oct) before B (due 15 Oct) and D (due 19 Oct)')
  assert.equal(reviews[0].key, 'topic:t-C:review')
  assert.equal(reviews[0].why, 'review due (🔴, last done yesterday)')
  assert.equal(reviews[1].minutes, 30, 'open mistakes → 30 min')
  const redo = plan.picks.filter((p) => p.kind === 'mistake_redo')
  assert.equal(redo.length, 1)
  assert.equal(redo[0].key, `mistakes:${MON}`)
  assert.equal(redo[0].minutes, 30)
  assert.equal(redo[0].done.mistakeIds.length, 6, 'at most 6 at once, oldest redo dates first')
  assert.deepEqual(redo[0].done.mistakeIds, ['m0', 'm4', 'm1', 'm5', 'm2', 'm6'])
  assert.match(redo[0].open, /^Redo without looking \(close it, from scratch\): A Q1 · A Q5 · A Q2 · A Q6 \+2 more$/)
  assert.ok(!plan.picks.some((p) => p.topicId === 't-B' && p.kind === 'review'))
})

test('fix: one taught 🔴 a day (never-done first); an untaught 🔴 is not "fixed"', () => {
  const w = calm({ topics: [...Object.values(T).map((t) => ({ ...t })), topic({ code: 'Y1-08', subject: 'Maths', strand: 'Pure', name: 'Exponential models', taughtFrom: '2026-10-05', status: 'not_secure', lastDone: '2026-10-10', order: 5 }), topic({ code: 'Y2-01', subject: 'Maths', name: 'Proof 2', taughtFrom: '2026-11-16', status: 'not_secure', order: 26 })] })
  const plan = planStudyDay(w, dayOf(MON, 'half_term', 300))
  const fixes = plan.picks.filter((p) => p.tier === TIER.fix)
  assert.equal(fixes.length, 1)
  assert.equal(fixes[0].topicId, 't-Y1-07')
  assert.equal(fixes[0].title, 'Y1-07 Logarithms: fix 🔴')
  assert.deepEqual(fixes[0].steps.map((s) => s.minutes), [10, 10, 25])
  assert.ok(!plan.picks.some((p) => p.topicId === 't-Y2-01' && p.kind === 'fix'))
})

test('ahead: maths only, the first ⏭ Next up in school order that is ⚪/🔴 (🟡 → move on), 90 min 10/25/25/20/10', () => {
  const plan = planStudyDay(calm(), dayOf(MON, 'half_term', 400))
  const ahead = plan.picks.filter((p) => p.kind === 'ahead')
  assert.equal(ahead.length, 1)
  assert.equal(ahead[0].topicId, 't-PC1-06', 'Y1-16 (26 Oct) is 🟡 → move on; next: PC1-06 before PC1-04 (school order)')
  assert.equal(ahead[0].minutes, 90)
  assert.deepEqual(ahead[0].steps.map((s) => s.minutes), [10, 25, 25, 20, 10])
  assert.equal(ahead[0].tier, TIER.ahead)
  assert.deepEqual(ahead[0].done, { kind: 'topic', topicId: 't-PC1-06', step: 2 })
  assert.match(ahead[0].why, /^⏭ next up in school order \(taught from Mon 2 Nov\)$/)
  assert.match(ahead[0].open, /^Textbook PC1 blue · 6 \(Mathematical induction\): learn it/)
  assert.ok(!plan.picks.some((p) => p.kind === 'ahead' && p.subject === 'Physics'), 'physics never ahead')
  const red = calm({ topics: Object.values(T).map((t) => (t.code === 'PC1-06' ? { ...t, status: 'not_secure' } : t.code === 'Y1-16' ? { ...t, status: 'not_started' } : { ...t })) })
  assert.equal(planStudyDay(red, dayOf(MON, 'half_term', 400)).picks.find((p) => p.kind === 'ahead').topicId, 't-Y1-16', 'a ⚪ next up earlier in school order comes first')
  const onlyPhysics = emptyWorld({ topics: [{ ...T.physNext }, { ...T.later }] })
  assert.equal(planStudyDay(onlyPhysics, dayOf(MON, 'half_term', 400)).picks.filter((p) => p.kind === 'ahead').length, 0, 'physics next up and Later topics are never learnt ahead')
})

// no reviews due, no 🔴: only the leftover split works
const quiet = () => calm({ topics: Object.values(T).filter((t) => t.code !== 'Y1-07' && t.code !== 'P7.1').map((t) => (t.code === 'Y1-03' ? { ...t, lastDone: '2026-10-18' } : { ...t })) })

test('ahead session scales to its share (never under 45); a smaller share goes to fixing', () => {
  const w = quiet()
  const p100 = planStudyDay(w, dayOf(MON, 'half_term', 100))
  const a = p100.picks.find((p) => p.kind === 'ahead')
  assert.equal(a.minutes, 55, '55 % of 100')
  assert.equal(a.steps.reduce((s, x) => s + x.minutes, 0), 55)
  const p60 = planStudyDay(w, dayOf(MON, 'half_term', 60))
  assert.ok(!p60.picks.some((p) => p.kind === 'ahead'), '33 min < 45 → no ahead session')
  assert.ok(p60.picks.some((p) => p.kind === 'fix' && p.topicId === 't-Y1-03'), 'its time went to fixing the 🟡')
})

test('half-term leftover: ahead, then fixing 🟡, then old; school leftover: current, old, ahead', () => {
  const half = planStudyDay(quiet(), dayOf(MON, 'half_term', 240))
  assert.deepEqual(half.picks.map((p) => [p.kind, p.minutes]), [['ahead', 90], ['stretch', 45], ['fix', 60], ['old', 45]])
  const fixing = half.picks.find((p) => p.kind === 'fix')
  assert.equal(fixing.topicId, 't-Y1-03')
  assert.equal(fixing.tier, TIER.leftover)
  assert.equal(fixing.title, 'Y1-03 Quadratic functions: exam questions')
  const S = '2026-11-04'
  const sw = emptyWorld({ today: S, links: LINKS, topics: [
    topic({ code: 'C1', subject: 'Maths', name: 'Taught last week', taughtFrom: '2026-10-28', order: 1 }),
    topic({ code: 'O1', subject: 'Maths', name: 'Older yellow', taughtFrom: '2026-09-07', status: 'understand', lastDone: '2026-11-02', order: 0 }),
    topic({ code: 'G1', subject: 'Further Maths', name: 'Older green', taughtFrom: '2026-09-07', status: 'exam_ready', lastDone: '2026-11-01', order: 0 }),
    topic({ code: 'N1', subject: 'Further Maths', name: 'Next up', taughtFrom: '2026-11-16', order: 1 }),
    topic({ code: 'OLD', subject: 'Maths', name: 'Taught long ago', taughtFrom: '2026-09-01', status: 'not_started', order: 2 }),
  ] })
  const school = planStudyDay(sw, dayOf(S, 'school', 250))
  // 250 → current 100 (60 used) · old 75 + 40 (45 used) · ahead 75 + 70 (90 used) · 55 left, no other 🟢 → free
  assert.deepEqual(school.picks.map((p) => [p.kind, p.topicId, p.minutes]), [['ahead', 't-N1', 90], ['current', 't-C1', 60], ['old', 't-G1', 45]])
  const cur = school.picks.find((p) => p.kind === 'current')
  assert.equal(cur.why, 'current topic (taught from 28 Oct) · ⚪')
  assert.equal(cur.title, 'C1 Taught last week: learn from the textbook', 'its next ladder step')
})

test('physics: keep up (booklet → PMT) in the current share, never ahead', () => {
  const w = emptyWorld({ today: '2026-11-04', topics: [{ ...T.physClass }, { ...T.physNext }], links: LINKS })
  const plan = planStudyDay(w, dayOf('2026-11-04', 'school', 120))
  const cur = plan.picks.find((p) => p.topicId === 't-P7.1')
  assert.equal(cur.kind, 'current')
  assert.equal(cur.title, 'P7.1 Progressive waves: school booklet')
  assert.match(cur.open, /^School booklet: Waves → Progressive waves/)
  assert.deepEqual(cur.done, { kind: 'topic', topicId: 't-P7.1', physics: 'booklet' })
  assert.match(cur.why, /being taught now – keep up/)
  assert.ok(!plan.picks.some((p) => p.topicId === 't-P3.3'), 'not taught yet → nothing (no learning ahead in physics)')
})

test('stretch only on 🟢 and only with time left', () => {
  const none = emptyWorld({ topics: [{ ...T.yellow, lastDone: '2026-10-18' }] })
  assert.ok(!planStudyDay(none, dayOf(MON, 'half_term', 300)).picks.some((p) => p.kind === 'stretch'))
  const two = emptyWorld({ topics: [{ ...T.green1 }, { ...T.green2 }], links: LINKS })
  const plan = planStudyDay(two, dayOf(MON, 'half_term', 300))
  const s = plan.picks.find((p) => p.kind === 'stretch')
  assert.ok(s)
  assert.equal(s.tier, TIER.stretch)
  assert.equal(s.open, 'Bicen 9 Hardest Questions: Pure → AS: Algebraic Methods (proof)')
  assert.deepEqual(s.done, { kind: 'topic', topicId: 't-Y1-01', step: 6 })
  const busy = emptyWorld({ topics: [{ ...T.green1 }, { ...T.green2 }, { ...T.yellow, lastDone: '2026-10-18' }], links: LINKS })
  const tight = planStudyDay(busy, dayOf(MON, 'half_term', 40))
  assert.deepEqual(kinds(tight), ['fix'], 'the 40 min go to fixing the 🟡 – nothing left for stretch')
  assert.ok(planStudyDay(two, dayOf(MON, 'half_term', 40)).picks.some((p) => p.kind === 'stretch'), 'nothing else to do → the time left goes to stretch')
})

test('programmes: STEP at the weekend (once), not on weekdays; paused / stopped / ACT-area ones are not the study planner\'s', () => {
  const w = emptyWorld({ programmes: [stepProgramme(), stepProgramme({ id: 'p-paused', name: 'Paused one', pausedUntil: '2026-10-31' }), programme({ id: 'p-act', name: 'Complete Guide to ACT English', area: 'act', items: [item('p-act', 1)] })] })
  const sat = planStudyDay(w, dayOf(SAT, 'half_term', 200))
  const progs = sat.picks.filter((p) => p.kind === 'programme')
  assert.deepEqual(progs.map((p) => p.key), ['prog:p-step-3'])
  assert.equal(progs[0].title, 'STEP Support – Assignment 3')
  assert.equal(progs[0].minutes, 75)
  assert.match(progs[0].open, /^STEP Support – Assignment 3 · Attempt properly first \(30\+ min, no hints\)/)
  assert.deepEqual(progs[0].done, { kind: 'programme_item', itemId: 'p-step-3' })
  assert.equal(progs[0].why, 'STEP: 1 a week (weekend)')
  assert.equal(progs[0].subject, null, 'subject from the topics list (none here)')
  assert.equal(planStudyDay(w, dayOf('2026-10-21', 'half_term', 200)).picks.filter((p) => p.kind === 'programme').length, 0)
})

test('gaps_only programme: the chapter test pick asks for the score; optional only when boosted', () => {
  const cp = programme({ id: 'cp', name: 'Gaps book', mode: 'gaps_only', perWeek: 2, items: [item('cp', 1, { title: 'Chapter 1' })] })
  const opt = programme({ id: 'op', name: 'Extra reading', mode: 'optional', items: [item('op', 1, { title: 'Part 1' })] })
  const w = emptyWorld({ programmes: [cp, opt] })
  const plan = planStudyDay(w, dayOf(MON, 'half_term', 200))
  const p = plan.picks.find((x) => x.key === 'prog:cp-1')
  assert.equal(p.title, 'Gaps book: Chapter 1: chapter test')
  assert.deepEqual(p.done, { kind: 'programme_item', itemId: 'cp-1', score: true })
  assert.ok(!plan.picks.some((x) => x.key === 'prog:op-1'), 'optional: not on its own')
  const boosted = planStudyDay({ ...w, rules: [rule({ kind: 'boost', target: 'programme:Extra reading' })] }, dayOf(MON, 'half_term', 200))
  const o = boosted.picks.find((x) => x.key === 'prog:op-1')
  assert.ok(o, 'boosted → on, right after homework')
  assert.equal(o.tier, TIER.boost)
})

test('rule: "pause getting ahead until 25 Oct" — no ahead 19–25 Oct (time goes to fixing), back on Mon 26 Oct', () => {
  const r = rule({ kind: 'pause', target: 'ahead', words: 'pause getting ahead until 25 Oct', startsOn: MON, endsOn: '2026-10-25' })
  const w = calm({ rules: [r] })
  for (let i = 0; i < 7; i++) {
    const plan = planStudyDay(w, dayOf(addDays(MON, i), 'half_term', 300))
    assert.ok(!plan.picks.some((p) => p.kind === 'ahead'), addDays(MON, i))
    assert.ok(plan.notes.includes('paused: getting ahead until Sun 25 Oct'))
  }
  const back = planStudyDay(w, dayOf('2026-10-26', 'half_term', 300))
  assert.ok(back.picks.some((p) => p.kind === 'ahead'), 'expired → ahead again')
  assert.ok(!back.notes.some((n) => n.startsWith('paused')))
})

test('rule: "ACT top priority this week" puts the ACT picks right after homework (before tests); expired → back to tier 7', () => {
  const w = realWorld({ homework: [], rules: [rule({ kind: 'boost', target: 'act', words: 'ACT top priority this week', startsOn: MON, endsOn: '2026-10-25' })] })
  const plan = planStudyDay(w, dayOf('2026-10-22', 'half_term', 300), [act()])
  assert.equal(plan.picks[0].kind, 'act', 'no homework that day: ACT first')
  assert.equal(plan.picks[0].tier, TIER.boost)
  assert.equal(plan.picks[1].tier, TIER.test, 'then the tests')
  assert.equal(plan.picks[0].minutes, 75)
  assert.ok(plan.notes.includes('top priority: ACT until Sun 25 Oct'))
  const withHw = planStudyDay(realWorld({ rules: w.rules }), dayOf(MON, 'half_term', 300), [act()])
  assert.deepEqual(withHw.picks.slice(0, 2).map((p) => p.kind), ['homework', 'act'], 'homework stays first')
  const expired = planStudyDay(w, dayOf('2026-10-26', 'half_term', 300), [act()])
  const a = expired.picks.find((p) => p.kind === 'act')
  assert.ok(!a || a.tier === TIER.leftover)
})

test('rule: "maths + physics 45 min/day this week" caps those subjects (higher tiers keep their minutes, homework exempt); ACT untouched', () => {
  const cap = rule({ kind: 'cap', target: 'subjects:Maths,Further Maths,Physics', minutes: 45, words: 'maths + physics 45 min/day this week' })
  const w = realWorld({ rules: [cap] })
  for (const date of ['2026-10-19', '2026-10-22', '2026-10-24']) {
    const plan = planStudyDay(w, dayOf(date, 'half_term', 300), [act()])
    const capped = mins(plan, (p) => p.kind !== 'homework' && ['Maths', 'Further Maths', 'Physics'].includes(p.subject))
    assert.ok(capped <= 45, `${date}: ${capped} min`)
    assert.ok(capped >= 30, `${date}: the cap is used, ${capped}`)
    assert.ok(plan.picks.some((p) => p.kind === 'act' && p.minutes === 75), 'ACT is not capped')
    assert.ok(plan.notes.includes('cap: Maths + Further Maths + Physics 45 min/day until Sun 25 Oct'))
  }
  const mon = planStudyDay(w, dayOf(MON, 'half_term', 300), [act()])
  assert.equal(mon.picks[0].kind, 'homework')
  assert.equal(mon.picks[0].minutes, 40, 'homework is not cut')
  assert.equal(mon.picks.find((p) => p.key === `mistakes:${MON}:tests`).minutes, 10, "the consolidation's own redo first (tier 2)")
  assert.equal(mon.picks.find((p) => p.kind === 'consolidation').minutes, 35, 'then the consolidation, shrunk from 60 to the 35 left')
  const after = planStudyDay(w, dayOf('2026-10-26', 'half_term', 300), [act()])
  assert.ok(mins(after, (p) => p.kind !== 'homework' && ['Maths', 'Further Maths', 'Physics'].includes(p.subject)) > 45, 'expired → no cap')
})

test('rule: a note only shows; pause physics / reviews / programme:STEP remove just those', () => {
  const w = realWorld({ rules: [rule({ kind: 'note', target: 'act', words: 'ACT mock Saturday' }), rule({ id: 'pp', kind: 'pause', target: 'physics' }), rule({ id: 'pr', kind: 'pause', target: 'reviews' })] })
  const plan = planStudyDay(w, dayOf('2026-10-20', 'half_term', 300))
  assert.ok(plan.notes.includes('ACT mock Saturday (until Sun 25 Oct)'))
  assert.ok(!plan.picks.some((p) => p.subject === 'Physics' && p.kind !== 'homework'))
  assert.ok(!plan.picks.some((p) => p.kind === 'review' || p.kind === 'mistake_redo'))
  assert.ok(plan.notes.includes('paused: Physics until Sun 25 Oct'))
  const s = emptyWorld({ programmes: [stepProgramme()], rules: [rule({ kind: 'pause', target: 'programme:STEP' })] })
  assert.ok(!planStudyDay(s, dayOf(SAT, 'half_term', 200)).picks.some((p) => p.kind === 'programme'))
})

test('done today is not picked again, and counts in the daily limits', () => {
  const w = calm()
  const first = planStudyDay(w, dayOf(MON, 'half_term', 400))
  const ahead = first.picks.find((p) => p.kind === 'ahead')
  const again = planStudyDay({ ...w, doneToday: [ahead.key] }, dayOf(MON, 'half_term', 310))
  assert.ok(!again.picks.some((p) => p.key === ahead.key))
  assert.ok(!again.picks.some((p) => p.kind === 'ahead'), 'one ahead session a day')
  const rw = emptyWorld({ topics: ['A', 'B', 'C'].map((c, i) => topic({ code: c, subject: 'Maths', name: c, taughtFrom: '2026-09-01', status: 'understand', lastDone: '2026-10-10', order: i })) })
  const r1 = planStudyDay({ ...rw, doneToday: ['topic:t-A:review'] }, dayOf(MON, 'half_term', 300))
  assert.deepEqual(r1.picks.filter((p) => p.kind === 'review').map((p) => p.topicId), ['t-B'], '≤ 2 reviews a day, one already done')
  const redo = realWorld({ doneToday: [`mistakes:${MON}`, `mistakes:${MON}:tests`] })
  assert.ok(!planStudyDay(redo, dayOf(MON, 'half_term', 300)).picks.some((p) => p.kind === 'mistake_redo'))
})

test('extras merge by tier: ACT countdown (tier 2) sits with the tests, steady ACT (tier 7) comes out of the leftover first, training (8) passes through', () => {
  const w = calm()
  const countdown = act({ key: 'act:english:timed', tier: TIER.test, minutes: 40, title: 'ACT timed English section' })
  const training = { key: 'gym:upper', kind: 'training', tier: TIER.training, subject: null, title: 'Upper body', open: 'PureGym', minutes: 90, why: 'fixed day', done: { kind: 'block' } }
  const plan = planStudyDay(w, dayOf(MON, 'half_term', 300), [countdown, training])
  assert.equal(plan.picks.find((p) => p.key === 'act:english:timed').tier, TIER.test)
  assert.equal(plan.picks.at(-1).key, 'gym:upper', 'training last, untouched')
  assert.ok(plan.picks.indexOf(plan.picks.find((p) => p.key === 'act:english:timed')) < plan.picks.findIndex((p) => p.kind === 'fix'))
  const steady = planStudyDay(w, dayOf(MON, 'half_term', 150), [act()])
  const k = kinds(steady)
  assert.ok(k.includes('act'), 'steady ACT taken from the leftover before the split')
  assert.ok(!k.includes('ahead'), 'the 90-min ahead session no longer fits after ACT')
})

test('every pick: a stable key, the exact thing to open, integer minutes, a short why, a done hint; ≤ 5 picks by default', () => {
  const w = realWorld()
  for (let i = 0; i < 28; i++) {
    const date = addDays(MON, i)
    const plan = planStudyDay(w, dayOf(date, i < 7 ? 'half_term' : 'school', [300, 120, 240][i % 3]), [act()])
    assert.ok(plan.picks.length <= DEFAULT_PICKS, `${date}: ${plan.picks.length}`)
    for (const p of plan.picks) {
      assert.match(p.key, /^(task:|topic:t-[^:]+:(review|fix|fixing|rate|keepup|ahead|current|old|stretch)$|test:g-[a-z0-9]+:(diagnostic|booklet|timed|light|consolidation|topic:t-.+|booklet:t-.+)$|mistakes:\d{4}-\d{2}-\d{2}(:tests)?$|prog:|act:)/, p.key)
      assert.ok(p.open && p.open.length > 10, p.key)
      assert.ok(Number.isInteger(p.minutes) && p.minutes > 0, `${p.key} ${p.minutes}`)
      assert.ok(p.why && p.why.length <= 90, `${p.key}: ${p.why}`)
      assert.ok(p.done && p.done.kind, p.key)
      if (p.steps) assert.equal(p.steps.reduce((a, s) => a + s.minutes, 0), p.minutes, p.key)
    }
    assert.equal(new Set(keys(plan)).size, plan.picks.length, 'no duplicates')
    const topicIds = plan.picks.map((p) => p.topicId).filter(Boolean)
    assert.equal(new Set(topicIds).size, topicIds.length, `${date}: a topic once a day`)
  }
})

test('deterministic: same input → same plan; the world is not changed; no clock', () => {
  const w = realWorld()
  const before = JSON.stringify(w)
  const a = planStudyDay(w, dayOf('2026-10-22', 'half_term', 300), [act()])
  const b = planStudyDay(realWorld(), dayOf('2026-10-22', 'half_term', 300), [act()])
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(w), before)
  assert.equal(a.mode, 'half_term')
  assert.deepEqual(a.testMode, { goalId: 'g-mech', title: 'Physics mechanics test', daysLeft: 19 })
})

test('maxPicks: default 5, clamped 1–6; tier-8 training passes through outside the cap; homework takes the first slots', () => {
  const w = realWorld()
  const training = { key: 'gym:upper', kind: 'training', tier: TIER.training, subject: null, title: 'Upper body', open: 'PureGym', minutes: 90, why: 'fixed day', done: { kind: 'block' } }
  const count = (n) => planStudyDay(w, { ...dayOf('2026-10-22', 'half_term', 600), maxPicks: n }, [training]).picks.filter((p) => p.tier < TIER.training).length
  assert.equal(count(undefined), 5)
  assert.equal(count(3), 3)
  assert.equal(count(0), 1, 'at least 1')
  assert.equal(count(9), 6, 'at most 6')
  const plan = planStudyDay(w, { ...dayOf('2026-10-22', 'half_term', 600), maxPicks: 2 }, [training])
  assert.equal(plan.picks.at(-1).key, 'gym:upper', 'training on top of the 2')
  const hw = realWorld({ homework: [1, 2, 3].map((i) => homework({ id: `h${i}`, title: `Sheet ${i}`, dueAt: `2026-10-2${i}`, minutes: 10 })) })
  const p2 = planStudyDay(hw, { ...dayOf(MON, 'half_term', 300), maxPicks: 2 })
  assert.deepEqual(keys(p2), ['task:h1', 'task:h2'], 'earliest due first; never more than maxPicks')
  assert.match(p2.notes.join(' | '), /left for another day: Homework: Sheet 3/)
})

test('STRICT by count: no lower pick is placed while a higher one that fits is left out for room (many fixture days)', () => {
  const w0 = realWorld()
  let checked = 0
  for (let i = 0; i < 35; i++) {
    const date = addDays(MON, i)
    for (const maxPicks of [2, 3, 5, 6]) for (const mins of [90, 180, 420]) {
      const w = { ...w0, programmes: [stepProgramme()], rules: i % 5 === 0 ? [rule({ kind: 'boost', target: 'physics', startsOn: date, endsOn: date })] : [] }
      const plan = planStudyDay(w, { ...dayOf(date, i < 7 ? 'half_term' : 'school', mins), maxPicks }, [act({ minutes: i % 2 ? 30 : 75 })])
      assert.ok(plan.picks.length <= maxPicks)
      for (const l of plan.left.filter((x) => x.reason === 'room')) {
        checked++
        for (const p of plan.picks) assert.ok(slotRank(p) <= slotRank(l), `${date} max ${maxPicks} ${mins}m: ${p.key} (${slotRank(p)}) placed while ${l.key} (${slotRank(l)}) had no room`)
      }
    }
  }
  assert.ok(checked > 100, `the property was exercised (${checked})`)
})

test('steady ACT / a due programme take the first free slots after tiers 1–4 (never displacing them), with the minutes left', () => {
  const plan = planStudyDay(realWorld({ homework: [] }), { ...dayOf(MON, 'half_term', 300), maxPicks: 5 }, [act()])
  assert.ok(plan.picks.every((p) => p.tier <= TIER.fix), 'five tier 1–4 picks fill the day: ACT waits')
  assert.ok(plan.left.some((x) => x.kind === 'act' && x.reason === 'room'))
  const roomy = planStudyDay(realWorld({ homework: [], mistakes: [] }), { ...dayOf(MON, 'half_term', 300), maxPicks: 6 }, [act()])
  const ai = roomy.picks.findIndex((p) => p.kind === 'act')
  assert.ok(ai > 0, 'a free slot after tiers 1–4 → ACT')
  assert.ok(!roomy.left.some((x) => x.tier <= TIER.fix && x.reason === 'room'))
  const noMinutes = planStudyDay(realWorld({ homework: [], mistakes: [] }), { ...dayOf(MON, 'half_term', 150), maxPicks: 6 }, [act()])
  assert.ok(!noMinutes.picks.some((p) => p.kind === 'act'), 'no minutes left → not today')
  assert.equal(noMinutes.left.find((x) => x.kind === 'act').reason, 'time')
})

test("redos of a test's own mistakes (its goal, or a code on it) are its prep: tier 2, ≥ 10 min; the others stay tier 3", () => {
  const plan = planStudyDay(realWorld({ homework: [] }), { ...dayOf(MON, 'half_term', 300), maxPicks: 6 })
  const tests = plan.picks.find((p) => p.key === `mistakes:${MON}:tests`)
  assert.equal(tests.tier, TIER.test)
  assert.deepEqual(tests.done.mistakeIds, ['m-ht1-1'], "the HT1 consolidation's mistake")
  assert.ok(tests.minutes >= 10)
  assert.equal(tests.why, 'FM HT1 Consolidation · redo every wrong question')
  const other = plan.picks.find((p) => p.key === `mistakes:${MON}`)
  assert.equal(other.tier, TIER.review)
  assert.deepEqual(other.done.mistakeIds, ['m-2'], 'P3.1 is not on a test in the window yet (mechanics enters it tomorrow)')
  const tue = planStudyDay(realWorld({ homework: [], mistakes: [mistake({ id: 'x', code: 'P3.1', reviewOn: '2026-10-20' })] }), dayOf('2026-10-20', 'half_term', 300))
  assert.equal(tue.picks.find((p) => p.kind === 'mistake_redo').tier, TIER.test, 'a code on the mechanics test → its prep')
})

test("ACT is not this planner's: ACT test goals, ACT programmes and ACT misses are skipped (they come in through extra)", () => {
  const w = realWorld({ homework: [],
    tests: [...realTests(), mkTest({ id: 'g-act', title: 'ACT retake', kind: 'act', date: '2026-10-30' })],
    programmes: [programme({ id: 'p-act', name: 'Complete Guide to ACT English', area: 'act', items: [item('p-act', 1)] })],
    mistakes: [mistake({ id: 'a1', code: null, topicId: null, source: 'ACT practice 3', reviewOn: MON }), mistake({ id: 'a2', code: null, topicId: null, subjectId: 'sub-act', reviewOn: MON }), mistake({ id: 'm', code: 'Y1-03', reviewOn: MON })],
  })
  w.topics = [...w.topics, topic({ code: 'ACT-E1', subject: 'ACT', subjectId: 'sub-act', name: 'Commas' })]
  const plan = planStudyDay(w, { ...dayOf(MON, 'half_term', 600), maxPicks: 6 })
  assert.ok(!plan.picks.some((p) => p.goalId === 'g-act' || p.key === 'prog:p-act-1'))
  assert.ok(!plan.left.some((x) => x.key.includes('g-act') || x.key === 'prog:p-act-1'))
  assert.deepEqual(plan.picks.filter((p) => p.kind === 'mistake_redo').flatMap((p) => p.done.mistakeIds), ['m'])
})

test('boost targets current / old / fixing / physics / maths produce a leftover pick right after homework; nothing to boost → said so', () => {
  const S = '2026-11-04'
  const base = () => emptyWorld({ today: S, links: LINKS, topics: [
    topic({ code: 'C1', subject: 'Maths', name: 'Taught last week', taughtFrom: '2026-10-28', order: 1 }),
    topic({ code: 'O1', subject: 'Maths', name: 'Older yellow', taughtFrom: '2026-09-07', status: 'understand', lastDone: '2026-11-02', order: 0 }),
    topic({ code: 'G1', subject: 'Further Maths', name: 'Older green', taughtFrom: '2026-09-07', status: 'exam_ready', lastDone: '2026-11-01', order: 0 }),
    topic({ code: 'P7.1', subject: 'Physics', strand: 'Waves', name: 'Progressive waves', taught: 'in_class', booklet: 'todo', pmt: 'todo', order: 0 }),
  ] })
  for (const [target, kind, topicId] of [['current', 'current', 't-C1'], ['old', 'old', 't-G1'], ['fixing', 'fix', 't-O1'], ['physics', 'current', 't-P7.1'], ['maths', 'current', 't-C1']]) {
    const w = { ...base(), rules: [rule({ kind: 'boost', target, startsOn: S, endsOn: '2026-11-08' })] }
    const plan = planStudyDay(w, dayOf(S, 'school', 200))
    assert.equal(plan.picks[0].tier, TIER.boost, target)
    assert.deepEqual([plan.picks[0].kind, plan.picks[0].topicId], [kind, topicId], target)
    assert.ok(plan.notes.some((n) => n.startsWith('top priority:')), target)
  }
  const none = planStudyDay({ ...base(), rules: [rule({ kind: 'boost', target: 'stretch', startsOn: S, endsOn: '2026-11-08' }), rule({ id: 'p', kind: 'pause', target: 'stretch', startsOn: S, endsOn: '2026-11-08' })] }, dayOf(S, 'school', 200))
  assert.ok(none.notes.includes('nothing of stretch to put first today (rule until Sun 8 Nov)'))
  assert.ok(!none.notes.some((n) => n.startsWith('top priority')))
})

test("leftover picks have their own keys (fixing / rate / keepup): ticking one never removes the day's tier-4 🔴 fix", () => {
  const w = calm()
  const plan = planStudyDay(w, { ...dayOf(MON, 'half_term', 400), maxPicks: 6 })
  assert.equal(plan.picks.find((p) => p.tier === TIER.fix).key, 'topic:t-Y1-07:fix')
  const leftover = plan.picks.filter((p) => p.tier === TIER.leftover && p.kind === 'fix')
  assert.ok(leftover.length)
  for (const p of leftover) assert.match(p.key, /^topic:t-[^:]+:(fixing|rate|keepup)$/)
  const after = planStudyDay({ ...w, doneToday: leftover.map((p) => p.key) }, { ...dayOf(MON, 'half_term', 400), maxPicks: 6 })
  assert.ok(after.picks.some((p) => p.key === 'topic:t-Y1-07:fix'), 'the tier-4 fix is still on')
})

test('STEP is never shortened: no 75 min left on Saturday → it waits (note) and tries Sunday', () => {
  const w = emptyWorld({ programmes: [stepProgramme()], topics: [{ ...T.yellow, lastDone: '2026-10-21' }] })
  const sat = planStudyDay(w, dayOf(SAT, 'half_term', 60))
  assert.ok(!sat.picks.some((p) => p.kind === 'programme'))
  assert.match(sat.notes.join(' | '), /left for another day: STEP Support – Assignment 3/)
  const step = planStudyDay(w, dayOf('2026-10-25', 'half_term', 120)).picks.find((p) => p.kind === 'programme')
  assert.equal(step.minutes, 75)
})

test('programme days not understood → any day + a note; study minutes missing → homework only + a note', () => {
  const plan = planStudyDay(emptyWorld({ programmes: [stepProgramme({ days: 'whenever I feel like it' })] }), dayOf('2026-10-21', 'half_term', 200))
  assert.ok(plan.picks.some((p) => p.kind === 'programme'), 'any day')
  assert.ok(plan.notes.includes('STEP: days "whenever I feel like it" not understood – any day'))
  for (const bad of [NaN, undefined]) {
    const p = planStudyDay(realWorld(), { ...dayOf(MON, 'half_term', 0), studyMinutes: bad })
    assert.deepEqual(kinds(p), ['homework'])
    assert.ok(p.notes.includes('no study time known for today – homework only'))
  }
})
