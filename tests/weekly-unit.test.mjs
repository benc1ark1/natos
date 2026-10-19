// Queue item 7, plain tests: the weekly check's summary (lib/weekly/summary.ts) — each part, missing tables, an empty
// week, rounding, and the one suggestion picked by priority. Free: no database, no AI.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/weekly-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

const W = await import('../lib/weekly/summary.ts')
const { buildWeekly, weeklyText, actComposite, subjectFromTitle, planLabel, openMistake, reviewedWeekOf } = W

// Sunday 18 Oct 2026: the week is Mon 12 – Sun 18 Oct
const SUN = '2026-10-18', MON = '2026-10-12'
const d = (n) => { const x = new Date(`${MON}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }   // d(0) = Mon … d(6) = Sun
const SUBJECTS = [{ id: 's-m', name: 'Maths' }, { id: 's-fm', name: 'Further Maths' }, { id: 's-p', name: 'Physics' }, { id: 's-act', name: 'ACT' }, { id: 's-cs', name: 'Computer Science' }]
let n = 0
const block = (o) => ({ id: `b${++n}`, date: d(0), title: 'Study', kind: 'focus', status: 'planned', taskId: null, goalId: null, topicId: null, programmeItemId: null, pickKey: null, rolledFrom: null, start: null, ...o })
const topic = (o) => ({ id: `t${++n}`, subjectId: 's-fm', code: null, name: 'Topic', status: 'not_started', lastDone: null, statusAt: null, order: n, ...o })
const prog = (o) => ({ id: `p${++n}`, name: 'STEP', area: 'study', subjectId: 's-m', perWeek: 1, minutes: 60, days: 'weekend', startsOn: null, endsOn: null, status: 'active', pausedUntil: null, mode: 'in_order', notes: null, items: [], ...o })
const item = (o) => ({ id: `i${++n}`, programmeId: 'p', position: 1, title: 'Assignment 1', details: null, url: null, minutes: null, status: 'todo', doneOn: null, result: null, score: null, outOf: null, ...o })
/** Nothing at all: every table missing. */
const bare = (o = {}) => ({ today: SUN, subjects: SUBJECTS, blocks: null, tasks: [], goals: [], topics: null, snapshot: null, mistakes: null, tests: null, programmes: null, act: null, lifts: null, upper: null, ...o })
const leak = (html) => assert.doesNotMatch(html.replace(/<[^>]+>/g, ''), /\bundefined\b|\bNaN\b|\bnull\b|\[object /, `leaked into:\n${html}`)

test('rules: the week it looks back on, the enhanced ACT composite, open mistakes', () => {
  assert.equal(reviewedWeekOf(SUN), SUN)
  assert.equal(reviewedWeekOf(d(2)), d(2))
  assert.equal(reviewedWeekOf('2026-10-19'), SUN, 'a Monday looks back on the week that just ended')
  assert.equal(actComposite({ english: 34, maths: 34, reading: 35, science: 35, composite: null }), 34, 'round(mean of E, M, R); science left out')
  assert.equal(actComposite({ english: 35, maths: 35, reading: 36, science: null, composite: null }), 35)
  assert.equal(actComposite({ english: 35, maths: null, reading: 36, science: null, composite: null }), null, 'a section on its own has no composite')
  assert.equal(actComposite({ english: 30, maths: 30, reading: 30, science: null, composite: 33 }), 33, 'a stored composite wins')
  assert.equal(openMistake({ stage: 0, reviewedOn: null }), true)
  assert.equal(openMistake({ stage: 1, reviewedOn: '2026-10-12' }), true, 'between its two redos')
  assert.equal(openMistake({ stage: 2, reviewedOn: null }), false)
  assert.equal(openMistake({ stage: 0, reviewedOn: '2026-10-01' }), false, 'an old-style mistake reviewed once is done')
})

test('done vs planned per subject: pick keys, links, titles; training, other weeks and rolled-forward copies left out', () => {
  const t1 = topic({ subjectId: 's-p', code: 'P1.3' })
  const input = bare({
    blocks: [
      block({ pickKey: 'act:english:timed', status: 'done', date: d(0) }),
      block({ pickKey: 'act:reading:timed', date: d(2) }),
      block({ pickKey: `topic:${t1.id}:review`, status: 'done' }),
      block({ topicId: t1.id }),
      block({ pickKey: 'task:task-1', status: 'done' }),            // → the task's subject (Maths)
      block({ taskId: 'task-2' }),                                   // → Further Maths
      block({ title: '🚀 FM: Matrices', status: 'done' }),
      block({ title: '📝 Maths homework: ex 4B', status: 'done' }),
      block({ title: 'Physics booklet Qs' }),
      block({ pickKey: 'prog:item-1', status: 'done', date: d(5) }),  // → the programme's subject (Maths)
      block({ goalId: 'g-1', status: 'done' }),                      // → the test's subject (Further Maths)
      block({ title: 'Tidy room', kind: 'light' }),                  // no subject → other
      block({ title: 'Upper @ PureGym', kind: 'training', status: 'done' }),   // gym, not study
      block({ title: 'Maths', date: '2026-10-11' }),                 // last week
      // not done on Tue, rolled to Wed (counts once, on Wed, done)
      block({ pickKey: 'topic:t-x:fix', title: 'Physics: fix', date: d(1) }),
      block({ pickKey: 'topic:t-x:fix', title: 'Physics: fix', date: d(2), rolledFrom: d(1), status: 'done' }),
    ],
    tasks: [{ id: 'task-1', title: 'Ex 4B', subjectId: 's-m', due: d(3), open: false, homework: false }, { id: 'task-2', title: 'PC1 sheet', subjectId: 's-fm', due: d(4), open: false, homework: false }],
    goals: [{ id: 'g-1', subjectId: 's-fm' }],
    topics: [t1],
    programmes: [prog({ items: [item({ id: 'item-1', status: 'done', doneOn: d(5) })] })],
  })
  const s = buildWeekly(input)
  assert.deepEqual(s.subjects.map((x) => `${x.short} ${x.done}/${x.planned}`), ['Maths 3/3', 'FM 2/3', 'Physics 2/4', 'ACT 1/2'])
  assert.deepEqual(s.other, { done: 0, planned: 1 })
  const html = weeklyText(s)
  assert.match(html, /^📊 <b>Weekly check<\/b> · Mon 12 – Sun 18 Oct\n📚 Maths 3\/3 · FM 2\/3 · Physics 2\/4 · ACT 1\/2 · other 0\/1/)
  leak(html)
})

test('subjects from a block title: longest name first, FM, ACT in capitals only', () => {
  const names = SUBJECTS.map((s) => s.name)
  assert.equal(subjectFromTitle('📝 Further Maths homework', names), 'Further Maths')
  assert.equal(subjectFromTitle('🔥 FM: Complex numbers', names), 'Further Maths')
  assert.equal(subjectFromTitle('🚀 Maths: Vectors', names), 'Maths')
  assert.equal(subjectFromTitle('Math revision', names), 'Maths')
  assert.equal(subjectFromTitle('ACT English section', names), 'ACT')
  assert.equal(subjectFromTitle('Act on feedback', names), null, '"act" as a word isn’t ACT')
  assert.equal(subjectFromTitle('Computer Science project', names), 'Computer Science')
  assert.equal(subjectFromTitle('Read a book', names), null)
})

test('tracker against the week’s starting point: up a colour, reached 🟢, down, reviews done vs due, mistakes redone', () => {
  const a = topic({ code: 'PC1-01', status: 'exam_ready', lastDone: d(2) })   // 🟡 → 🟢
  const b = topic({ code: 'PC1-02', status: 'understand', lastDone: d(3) })   // 🔴 → 🟡
  const c = topic({ code: 'PC1-03', status: 'not_secure', lastDone: d(1) })   // ⚪ → 🔴: not "up"
  const e = topic({ code: 'Y1-07', status: 'understand', lastDone: '2026-10-01' })   // 🟢 → 🟡: down; due since 4 Oct (🟡 +3), not done
  const f = topic({ code: 'Y1-08', status: 'exam_ready', lastDone: '2026-10-10' })  // 🟢, not due until 24 Oct
  const snapshot = { weekStart: MON, topics: {
    [a.id]: ['understand', '2026-10-09'],   // due 12 Oct, done Wed → reviewed
    [b.id]: ['not_secure', '2026-10-11'],   // due 12 Oct, done Thu → reviewed
    [c.id]: ['not_started', null],
    [e.id]: ['exam_ready', '2026-10-01'],   // due 15 Oct, not done (status dropped by a test result)
    [f.id]: ['exam_ready', '2026-10-10'],
  }, mistakes: { m1: 0, m2: 1, m3: 0 } }
  const mistakes = [
    { id: 'm1', stage: 1, reviewOn: '2026-10-22', reviewedOn: null, updatedOn: d(2) },   // first redo done
    { id: 'm2', stage: 2, reviewOn: '2026-10-10', reviewedOn: d(4), updatedOn: d(4) },   // second redo done
    { id: 'm3', stage: 0, reviewOn: d(4), reviewedOn: null, updatedOn: '2026-10-08' },   // due Fri, not done
    { id: 'm4', stage: 0, reviewOn: '2026-10-21', reviewedOn: null, updatedOn: d(5) },   // logged this week, not due
  ]
  const s = buildWeekly(bare({ topics: [a, b, c, e, f], snapshot, mistakes }))
  assert.equal(s.tracker.mode, 'compare')
  assert.equal(s.tracker.up, 2)
  assert.equal(s.tracker.down, 1)
  assert.deepEqual(s.tracker.green, ['PC1-01'])
  // done this week: a, b. Still due now: b (🟡 done Thu → due again Sun), c (🔴 done Tue → due Wed), e (since 4 Oct)
  assert.deepEqual(s.tracker.reviews, { done: 2, due: 3 })
  assert.equal(s.reviewsDue, 3)
  assert.deepEqual(s.tracker.mistakes, { redone: 2, due: 1 })
  const html = weeklyText(s)
  assert.match(html, /🎯 ⬆️ 2 topics up a colour \(🟢 PC1-01\) · ⬇️ 1 down · reviews 2 done · 3 due · 2 mistakes redone \(1 due\)/)
  leak(html)
})

test('a review done this week that’s due again still counts as due (and the suggestion says so)', () => {
  const red = topic({ code: 'PC1-03', status: 'not_secure', lastDone: d(1) })   // 🔴 reviewed Tue → due again Wed, not redone
  const snapshot = { weekStart: MON, topics: { [red.id]: ['not_secure', '2026-10-10'] }, mistakes: {} }
  const s = buildWeekly(bare({ topics: [red], snapshot }))
  assert.deepEqual(s.tracker.reviews, { done: 1, due: 1 })
  assert.match(weeklyText(s), /🎯 1 topic worked on · reviews 1 done · 1 due\n/)
  assert.equal(s.suggestion, '1 review due — start Monday with PC1-03 (3–4 exam questions + its mistakes).')
  // only done / only due
  assert.match(weeklyText(buildWeekly(bare({ topics: [topic({ code: 'X1', status: 'exam_ready', lastDone: d(3) })], snapshot: { weekStart: MON, topics: { [`t${n}`]: ['exam_ready', '2026-10-01'] }, mistakes: {} } }))), /1 review done\n/)
})

test('the review gaps are his (the tracker’s settings), not fixed', () => {
  const t = topic({ code: 'PC1-02', status: 'understand', lastDone: d(3) })   // 🟡 done Thu: due Sun at +3, not at +5
  const snapshot = { weekStart: MON, topics: { [t.id]: ['understand', d(3)] }, mistakes: {} }
  assert.equal(buildWeekly(bare({ topics: [t], snapshot })).reviewsDue, 1)
  assert.equal(buildWeekly(bare({ topics: [t], snapshot, reviewDays: { not_secure: 1, understand: 5, exam_ready: 14, not_started: 7 } })).reviewsDue, 0)
})

test('a tracker imported mid-week isn’t “progress”: topics with no starting colour, or a colour set without work, don’t count as up or 🟢', () => {
  const was = topic({ code: 'PC1-01', status: 'exam_ready', lastDone: d(2) })
  const imported = Array.from({ length: 30 }, (_, i) => topic({ code: `Y1-${String(i).padStart(2, '0')}`, status: i % 2 ? 'exam_ready' : 'understand', lastDone: '2026-09-30', statusAt: d(3) }))
  const snapshot = { weekStart: MON, topics: { [was.id]: ['understand', '2026-10-09'] }, mistakes: {} }
  const s = buildWeekly(bare({ topics: [was, ...imported], snapshot }))
  assert.equal(s.tracker.up, 1)
  assert.deepEqual(s.tracker.green, ['PC1-01'])
  // no starting point at all, the same import: nothing counted as turning 🟢 this week
  const first = buildWeekly(bare({ topics: imported }))
  assert.deepEqual(first.tracker?.green ?? [], [])
})

test('tracker before there is a starting point (the first week): only how many topics were worked on', () => {
  const a = topic({ code: 'PC1-01', status: 'exam_ready', lastDone: d(2), statusAt: d(2) })
  const b = topic({ code: 'PC1-02', status: 'understand', lastDone: d(3), statusAt: d(3) })
  const old = topic({ code: 'Y1-01', status: 'exam_ready', lastDone: '2026-09-20', statusAt: '2026-09-20' })   // due 4 Oct (🟢 +14)
  const s = buildWeekly(bare({ topics: [a, b, old], mistakes: [] }))
  assert.equal(s.tracker.mode, 'worked')
  assert.deepEqual(s.tracker.green, [])
  assert.equal(s.tracker.worked, 2)
  assert.equal(s.tracker.reviews, null, 'no review counts without a starting point')
  assert.equal(s.tracker.mistakes, null, 'no redos done or due: left out')
  assert.match(weeklyText(s), /\n🎯 2 topics worked on\n/)
  assert.equal(s.reviewsDue, 2, 'what’s due now is still known, for the suggestion')
})

test('ACT trend: the latest composite vs the one before, the goal, the weakest section; left out with no scores or no table', () => {
  const sc = (takenOn, english, maths, reading, composite = null) => ({ takenOn, english, maths, reading, science: null, composite })
  let s = buildWeekly(bare({ act: { goal: 36, scores: [sc('2026-09-12', 34, 34, 35), sc(d(5), 35, 33, 36)] } }))
  assert.deepEqual(s.act, { latest: 35, previous: 34, goal: 36, weakest: { section: 'Maths', score: 33 } })
  assert.match(weeklyText(s), /📈 ACT 35 ⬆️ from 34 · goal 36 · weakest Maths 33/)
  s = buildWeekly(bare({ act: { goal: 36, scores: [sc(d(5), 35, 33, 36), sc('2026-09-12', 36, 36, 36)] } }))   // any order in
  assert.match(weeklyText(s), /📈 ACT 35 ⬇️ from 36/)
  s = buildWeekly(bare({ act: { goal: 36, scores: [sc('2026-09-12', 34, 34, 35)] } }))
  assert.match(weeklyText(s), /📈 ACT 34 · goal 36 · weakest English 34/, 'one score: no arrow; ties go to the first section')
  s = buildWeekly(bare({ act: { goal: 36, scores: [sc('2026-09-12', 36, 36, 36), sc(d(3), 36, 36, 36), sc(d(4), null, 33, null)] } }))
  assert.match(weeklyText(s), /📈 ACT 36 ➡️ same as last time · 🎯 goal 36 reached · weakest Maths 33/, 'a section on its own counts for the weakest, not the trend')
  assert.equal(buildWeekly(bare({ act: { goal: 36, scores: [] } })).act, null)
  assert.equal(buildWeekly(bare()).act, null)
  assert.doesNotMatch(weeklyText(buildWeekly(bare())), /ACT/)
})

test('gym: the week’s PRs exactly as item 6’s 🏆 alerts (its catalogue, bodyweight moves, best weight for the reps, the 0.05 margin); upper done vs target', async () => {
  const { DEFAULT_PREFS } = await import('../lib/gym/types.ts')
  const lift = (done_on, exercise_key, weight_kg, reps) => ({ done_on, exercise: exercise_key, exercise_key, weight_kg, reps, sets: 3 })
  const lifts = [
    lift('2026-10-05', 'bench press', 80, 3),      // e1RM 88
    lift(d(0), 'bench press', 80, 5),              // 93.3
    lift(d(0), 'bench press', 75, 8),              // 95: the week's best → e1RM PR
    lift('2026-09-28', 'squat', 100, 5),           // 116.7
    lift(d(5), 'squat', 102.5, 3),                 // e1RM lower, but the best weight for 3+ reps → a PR (as the 🏆 alert)
    lift('2026-10-01', 'pull ups', 0, 8),          // bodyweight
    lift(d(5), 'pull ups', 5, 8),                  // BW+5 for 8+ reps
    lift('2026-10-01', 'deadlift', 140, 5),        // 163.3
    lift(d(3), 'deadlift', 140, 5),                // the same: not a PR (the 0.05 margin)
    lift(d(2), 'dips', 20, 8),                     // first log: not a PR
  ]
  const s = buildWeekly(bare({ lifts, upper: { done: 1, target: 2 } }))
  assert.deepEqual(s.gym.prs.map((p) => `${p.name} ${p.text}`), ['Bench press e1RM 95 kg', 'Pull-ups BW+5 kg for 8+ reps', 'Squat 102.5 kg for 3+ reps'])
  assert.equal(s.gym.logged, 6)
  assert.match(weeklyText(s), /🏋️ 🏆 Bench press e1RM 95 kg, Pull-ups BW\+5 kg for 8\+ reps, Squat 102\.5 kg for 3\+ reps · Upper 1\/2/)
  // with his bodyweight set, pull-ups have an e1RM too (70 kg: 88.7 → 95)
  const bw = buildWeekly(bare({ lifts, gymPrefs: { ...DEFAULT_PREFS, bodyweightKg: 70 } }))
  assert.equal(bw.gym.prs.find((p) => p.key === 'pull ups').text, 'e1RM 95 kg')
  // lifts but no PR; upper only; nothing
  assert.match(weeklyText(buildWeekly(bare({ lifts: [lift(d(1), 'squat', 90, 5), lift('2026-10-01', 'squat', 100, 5)] }))), /🏋️ no new PRs \(1 lift logged\)/)
  assert.match(weeklyText(buildWeekly(bare({ lifts: [], upper: { done: 2, target: 2 } }))), /🏋️ Upper 2\/2\n/)
  assert.equal(buildWeekly(bare({ lifts: [] })).gym, null)
})

test('what’s behind: overdue homework, tests in the next 2 weeks with 🔴 topics (codes or names), programmes behind their weekly target', () => {
  const r1 = topic({ code: 'PC1-03', status: 'not_secure', order: 3 }), r2 = topic({ code: 'PC1-01', status: 'not_secure', order: 1 }), g = topic({ code: 'PC1-02', status: 'exam_ready' })
  const kin = topic({ subjectId: 's-p', code: null, name: 'Kinematics', status: 'not_secure' })
  const s = buildWeekly(bare({
    topics: [r1, r2, g, kin],
    tasks: [
      { id: 'h1', title: 'Physics homework', subjectId: 's-p', due: d(3), open: true, homework: true },
      { id: 'h2', title: 'Maths 4B', subjectId: 's-m', due: SUN, open: true, homework: true },          // due today: not overdue yet
      { id: 'h3', title: 'Buy socks', subjectId: null, due: d(1), open: true, homework: false },        // not homework
      { id: 'h4', title: 'Maths sheet', subjectId: null, due: '2026-10-19', open: true, homework: true }, // due tomorrow (Mon)
      { id: 'h5', title: 'Next week thing', subjectId: null, due: '2026-10-21', open: true, homework: false },
      { id: 'h6', title: 'Done already', subjectId: 's-p', due: d(1), open: false, homework: false },   // only linked to a block
    ],
    tests: [
      { id: 'g1', title: 'FM HT2', date: '2026-10-28', subjectId: 's-fm', kind: 'test', topicCodes: ['pc1-01', 'PC1-02', 'PC1-03'], topicWords: null, attempts: [] },
      { id: 'g2', title: 'Physics mechanics', date: '2026-10-26', subjectId: 's-p', kind: null, topicCodes: [], topicWords: 'kinematics, forces', attempts: null },
      { id: 'g3', title: 'Far test', date: '2026-11-12', subjectId: 's-fm', kind: 'test', topicCodes: ['PC1-03'], topicWords: null, attempts: [] },
      { id: 'g4', title: 'All green', date: '2026-10-20', subjectId: 's-fm', kind: 'test', topicCodes: ['PC1-02'], topicWords: null, attempts: [] },
      { id: 'g5', title: 'ACT retake', date: '2026-10-24', subjectId: 's-act', kind: 'act', topicCodes: [], topicWords: null, attempts: [] },
    ],
    programmes: [
      prog({ name: 'STEP', perWeek: 1, days: 'weekend', items: [item({ title: 'Assignment 4' })] }),
      prog({ name: 'Meltzer', area: 'act', perWeek: 3, days: null, items: [item({ status: 'done', doneOn: d(1) }), item({ position: 2, title: 'Chapter 5' })] }),
      prog({ name: 'Done one', perWeek: 1, items: [item({ status: 'done', doneOn: d(6) }), item({ position: 2 })] }),
      prog({ name: 'Paused', status: 'paused', items: [item({})] }),
      prog({ name: 'Critical Reader', mode: 'optional', items: [item({})] }),
    ],
  }))
  assert.deepEqual(s.behind.homework, [{ title: 'Physics homework', due: d(3) }])
  // what the daily "don't forget" nudge would have said (skipped on the check-in day): other overdue things, today, tomorrow
  assert.deepEqual(s.behind.soon.map((x) => `${x.title} ${x.when}`), ['Buy socks overdue', 'Maths 4B today', 'Maths sheet tomorrow'])
  assert.deepEqual(s.behind.tests.map((t) => [t.title, t.days, t.red]), [['Physics mechanics', 8, ['Kinematics']], ['FM HT2', 10, ['PC1-01', 'PC1-03']]])
  assert.deepEqual(s.behind.programmes.map((p) => `${p.name} ${p.done}/${p.perWeek}`), ['STEP 0/1', 'Meltzer 1/3'])
  const html = weeklyText(s)
  assert.match(html, /⚠️ Behind: Physics homework \(due Thu\), STEP 0\/1, Meltzer 1\/3\n⏰ Before tomorrow: Buy socks \(was Tue\), Maths 4B \(today\), Maths sheet \(Mon\)\n/)
  assert.match(html, /📝 Physics mechanics Mon 26 Oct \(8 days\): 🔴 Kinematics\n📝 FM HT2 Wed 28 Oct \(10 days\): 🔴 PC1-01, PC1-03\n/)
  // midweek: a weekend programme still has its days left, so it isn't behind yet
  const wed = buildWeekly(bare({ today: d(2), programmes: [prog({ name: 'STEP', items: [item({})] }), prog({ name: 'Daily', perWeek: 5, days: null, items: [item({})] })] }))
  assert.deepEqual(wed.behind.programmes.map((p) => p.name), ['Daily'], '5 a week with 4 days left: behind; STEP has Sat and Sun')
})

test('one suggestion, by priority: homework → test 🔴 → redos → reviews → programme → a slipping subject → upper → ACT → a good week', () => {
  const hw = { id: 'h1', title: 'Physics homework', subjectId: 's-p', due: d(3), open: true, homework: true }
  const red = topic({ code: 'PC1-03', status: 'not_secure', lastDone: '2026-10-01' })
  const test1 = { id: 'g1', title: 'FM HT2', date: '2026-10-28', subjectId: 's-fm', kind: 'test', topicCodes: ['PC1-03'], topicWords: null, attempts: [] }
  const redo = { id: 'm1', stage: 0, reviewOn: d(3), reviewedOn: null, updatedOn: d(0) }
  const step = prog({ name: 'STEP', items: [item({ title: 'Assignment 4' })] })
  const slack = [block({ title: 'Physics', status: 'done' }), block({ title: 'Physics' }), block({ title: 'Physics' }), block({ title: 'Maths', status: 'done' })]
  const sc = { takenOn: d(5), english: 35, maths: 33, reading: 36, science: null, composite: null }
  const full = { tasks: [hw], topics: [red], tests: [test1], mistakes: [redo], programmes: [step], blocks: slack, upper: { done: 1, target: 2 }, act: { goal: 36, scores: [sc] } }
  const say = (o) => buildWeekly(bare(o)).suggestion
  assert.equal(say(full), 'Start Monday with Physics homework: it was due Thu 15 Oct.')
  assert.equal(say({ ...full, tasks: [] }), 'FM HT2 is in 10 days and PC1-03 is still 🔴 — start Monday with its booklet.')
  assert.equal(say({ ...full, tasks: [], tests: [{ ...test1, attempts: ['booklet'] }] }), 'FM HT2 is in 10 days and PC1-03 is still 🔴 — start Monday with fresh exam questions on it.')
  assert.equal(say({ ...full, tasks: [], tests: [] }), '1 mistake redo due — redo it without looking first thing Monday (≤ 30 min).')
  assert.equal(say({ ...full, tasks: [], tests: [], mistakes: [] }), '1 review due — start Monday with PC1-03 (3–4 exam questions + its mistakes).')
  assert.equal(say({ ...full, tasks: [], tests: [], mistakes: [], topics: [] }), 'STEP is 0/1 this week — do “Assignment 4” Monday.')
  assert.equal(say({ ...full, tasks: [], tests: [], mistakes: [], topics: [], programmes: [] }), 'Physics was 1/3 this week — put it first Monday.')
  assert.equal(say({ ...full, tasks: [], tests: [], mistakes: [], topics: [], programmes: [], blocks: [] }), 'Upper was 1/2 — keep both upper sessions in next week’s plan.')
  assert.equal(say({ act: full.act, upper: { done: 2, target: 2 } }), 'ACT: Maths is your weakest (33) — next week’s ACT time goes there first.')
  assert.equal(say({ blocks: [block({ title: 'Maths', status: 'done' })] }), 'Good week — same rhythm next week.')
  assert.equal(say({}), 'Tick things off on Today as you go and this check fills itself in.')
  // two overdue: the oldest first; midweek it says "tomorrow"
  assert.equal(say({ tasks: [hw, { ...hw, id: 'h0', title: 'Maths 4A', due: d(1) }] }), 'Start Monday with Maths 4A: it was due Tue 13 Oct (+1 more overdue).')
  assert.match(buildWeekly(bare({ today: d(2), tasks: [{ ...hw, due: d(1) }] })).suggestion, /^Start tomorrow with/)
  // only ONE suggestion line in the message
  assert.equal(weeklyText(buildWeekly(bare(full))).match(/💡/g).length, 1)
})

test('a block later today isn’t missed yet: the 18:00 check leaves out today’s blocks that start after now', () => {
  const blocks = [block({ title: 'Maths', date: SUN, start: '10:00', status: 'done' }), block({ title: 'Maths', date: SUN, start: '15:00' }), block({ title: 'Maths', date: SUN, start: '19:00' }), block({ title: 'Maths', date: SUN, start: '20:00', status: 'done' })]
  assert.deepEqual(buildWeekly(bare({ blocks, now: '18:05' })).subjects.map((x) => `${x.done}/${x.planned}`), ['2/3'], 'the 19:00 block is still to come (a done one counts)')
  assert.deepEqual(buildWeekly(bare({ blocks })).subjects.map((x) => `${x.done}/${x.planned}`), ['2/4'], 'no time given: every block')
  assert.deepEqual(buildWeekly(bare({ blocks: [block({ title: 'Maths', date: d(5), start: '19:00' })], now: '18:05' })).subjects.map((x) => `${x.done}/${x.planned}`), ['0/1'], 'an earlier day’s evening block was missed')
})

test('on a Monday it looks back on the week that just ended (a Monday check-in, or /weekly on a Monday)', () => {
  const s = buildWeekly(bare({
    today: '2026-10-19', weekOf: reviewedWeekOf('2026-10-19'),
    blocks: [block({ title: 'Maths', date: d(2), status: 'done' }), block({ title: 'Maths', date: d(4) }), block({ title: 'Maths', date: '2026-10-19', status: 'done' })],
    programmes: [prog({ name: 'STEP', items: [item({ title: 'Assignment 4' })] })],
  }))
  assert.equal(s.weekStart, MON)
  assert.equal(s.soFar, false)
  assert.deepEqual(s.subjects.map((x) => `${x.short} ${x.done}/${x.planned}`), ['Maths 1/2'], 'last week’s blocks, not today’s')
  assert.deepEqual(s.behind.programmes.map((p) => `${p.name} ${p.done}/${p.perWeek}`), ['STEP 0/1'], 'judged on last week')
  assert.match(weeklyText(s), /^📊 <b>Weekly check<\/b> · Mon 12 – Sun 18 Oct\n/)
  assert.equal(s.suggestion, 'STEP was 0/1 last week — do “Assignment 4” today.')
})

test('Monday’s snapshot: once it’s taken, later ticks only look (no insert that fails 288 times a day)', async () => {
  const { plugin } = await import('../lib/telegram/plugins/weekly.ts')
  const inserts = []
  const sb = (taken) => ({ from: (table) => {
    const b = { select: () => b, eq: () => b, is: () => b, lt: () => b, limit: () => b,
      maybeSingle: async () => ({ data: taken && table === 'telegram_sent' ? { key: 'weekly-snap:2026-10-19' } : null, error: null }),
      insert: async (row) => { inserts.push([table, row]); return { error: taken ? { code: '23505', message: 'dup' } : null } },
      then: (r) => r({ data: [], error: null }) }
    return b
  } })
  const env = (taken) => ({ sb: sb(taken), chatId: 1, now: new Date(), today: '2026-10-19', time: '09:00', planning: {}, once: async () => {} })
  await plugin.tick(env(true))
  assert.deepEqual(inserts, [], 'already taken: nothing inserted')
  await plugin.tick(env(false))
  assert.deepEqual(inserts.map(([t]) => t), ['telegram_sent', 'weekly_snapshots'], 'first tick: claimed, then saved')
})

test('the daily nudge waits for the check only while the check can still go out today', async () => {
  const { checkStillPossible } = await import('../lib/telegram/plugins/weekly.ts')
  assert.equal(checkStillPossible({}, '18:05'), true, '18:00–20:00, quiet from 21:30')
  assert.equal(checkStillPossible({}, '12:00'), true, 'later today')
  assert.equal(checkStillPossible({}, '20:00'), false, 'its window is over')
  assert.equal(checkStillPossible({ resetAt: '21:00' }, '18:05'), true, '21:00–21:29 is still open')
  assert.equal(checkStillPossible({ resetAt: '21:00' }, '21:40'), false, 'quiet from 21:30')
  assert.equal(checkStillPossible({ resetAt: '22:00' }, '18:05'), false, 'all of it is in quiet hours: it can’t go out')
})

test('every table missing (before the new SQL files ran): still a short, sensible message', () => {
  const html = weeklyText(buildWeekly(bare()))
  assert.equal(html, '📊 <b>Weekly check</b> · Mon 12 – Sun 18 Oct\n📚 No study planned this week.\n💡 Tick things off on Today as you go and this check fills itself in.')
  leak(html)
})

test('an empty week (tables there, nothing in them) reads the same way; midweek says “so far”; a week across two months', () => {
  const empty = bare({ blocks: [], topics: [], mistakes: [], tests: [], programmes: [], act: { goal: 36, scores: [] }, lifts: [] })
  const html = weeklyText(buildWeekly(empty))
  assert.equal(html, '📊 <b>Weekly check</b> · Mon 12 – Sun 18 Oct\n📚 No study planned this week.\n💡 Tick things off on Today as you go and this check fills itself in.')
  assert.match(weeklyText(buildWeekly({ ...empty, today: d(2) })), /^📊 <b>Weekly check<\/b> · Mon 12 – Sun 18 Oct \(so far\)\n/)
  assert.match(weeklyText(buildWeekly({ ...empty, today: '2026-11-01' })), /^📊 <b>Weekly check<\/b> · Mon 26 Oct – Sun 1 Nov\n/)
  // blocks with no subject: one plain count
  assert.match(weeklyText(buildWeekly({ ...empty, blocks: [block({ title: 'Deep work', status: 'done' }), block({ title: 'Deep work' })] })), /📚 Study 1\/2\n/)
})

test('a full week fits one phone screen, escapes his words, and has no code leaking into it', () => {
  const topics = Array.from({ length: 8 }, (_, i) => topic({ code: `PC1-0${i}`, status: i < 4 ? 'exam_ready' : 'not_secure', lastDone: d(i % 6) }))
  const snapshot = { weekStart: MON, topics: Object.fromEntries(topics.map((t) => [t.id, ['not_secure', '2026-10-10']])), mistakes: {} }
  const s = buildWeekly(bare({
    blocks: [...Array.from({ length: 6 }, (_, i) => block({ title: 'Maths', status: i < 5 ? 'done' : 'planned' })), ...Array.from({ length: 4 }, (_, i) => block({ title: 'FM', status: i < 3 ? 'done' : 'planned' })), block({ pickKey: 'act:english:timed', status: 'done' })],
    tasks: [{ id: 'h', title: 'Physics <b>homework</b> & notes', subjectId: 's-p', due: d(2), open: true, homework: true }],
    topics, snapshot, mistakes: [{ id: 'm', stage: 0, reviewOn: d(2), reviewedOn: null, updatedOn: d(0) }],
    tests: [{ id: 'g', title: 'FM HT2', date: '2026-10-28', subjectId: 's-fm', kind: 'test', topicCodes: topics.map((t) => t.code), topicWords: null, attempts: [] }],
    programmes: [prog({ items: [item({})] })],
    act: { goal: 36, scores: [{ takenOn: d(5), english: 35, maths: 34, reading: 36, science: 35, composite: null }, { takenOn: '2026-09-01', english: 34, maths: 34, reading: 35, science: 35, composite: 34 }] },
    lifts: [{ done_on: d(0), exercise: 'Bench press', exercise_key: 'bench press', weight_kg: 80, reps: 5, sets: 3 }, { done_on: '2026-10-01', exercise: 'Bench press', exercise_key: 'bench press', weight_kg: 80, reps: 3, sets: 3 }],
    upper: { done: 2, target: 2 },
  }))
  const html = weeklyText(s)
  const lines = html.split('\n')
  assert.ok(lines.length <= 10, `${lines.length} lines`)
  assert.ok(html.replace(/<[^>]+>/g, '').length < 900, `${html.length} characters`)
  assert.match(html, /Physics &lt;b&gt;homework&lt;\/b&gt; &amp; notes/, 'his words are escaped')
  assert.match(html, /📝 FM HT2 Wed 28 Oct \(10 days\): 🔴 PC1-04, PC1-05, PC1-06 \+1\n/, 'long lists are cut to 3')
  assert.match(html, /⬆️ 4 topics up a colour \(🟢 PC1-00, PC1-01, PC1-02 \+1\)/)
  leak(html)
})

test('the button says what it plans; the setting is on by default and only “off” turns it off', async () => {
  assert.equal(planLabel(SUN), 'Plan next week? ✅')
  assert.equal(planLabel('2026-10-17'), 'Plan next week? ✅')
  assert.equal(planLabel(d(2)), 'Plan the rest of the week? ✅')
  const { weeklyCheckOn, WEEKLY_SETTINGS } = await import('../lib/weekly/settings.ts')
  assert.equal(weeklyCheckOn(null), true)
  assert.equal(weeklyCheckOn({}), true)
  assert.equal(weeklyCheckOn({ weeklyCheck: 'on' }), true)
  assert.equal(weeklyCheckOn({ weeklyCheck: 'off' }), false)
  assert.equal(WEEKLY_SETTINGS.weeklyCheck.default, 'on')
  const { setting, parseSetting } = await import('../lib/settings.ts')
  assert.equal(setting({}, 'weeklyCheck'), 'on')
  assert.equal(parseSetting('weeklyCheck', 'off', {}), 'off', 'changeable by chat (“turn the weekly check off”)')
})

test('when it goes out: his check-in day, from the week-reset time for 2 hours, never in quiet hours, not when it’s off', async () => {
  const { checkDue } = await import('../lib/telegram/plugins/weekly.ts')
  assert.equal(checkDue({}, SUN, '18:00'), true)
  assert.equal(checkDue({}, SUN, '19:55'), true, 'a missed tick still sends it')
  assert.equal(checkDue({}, SUN, '17:55'), false)
  assert.equal(checkDue({}, SUN, '20:00'), false)
  assert.equal(checkDue({}, '2026-10-17', '18:05'), false, 'Saturday')
  assert.equal(checkDue({ checkinDay: 'saturday' }, '2026-10-17', '18:05'), true, 'his check-in day')
  assert.equal(checkDue({ resetAt: '21:00' }, SUN, '21:10'), true)
  assert.equal(checkDue({ resetAt: '21:00' }, SUN, '21:40'), false, 'quiet from 21:30')
  assert.equal(checkDue({ resetAt: '06:00' }, SUN, '06:30'), false, 'before the morning brief is quiet too')
  assert.equal(checkDue({ weeklyCheck: 'off' }, SUN, '18:05'), false)
})

test('“how was my week?” and friends are the weekly check’s fast path; other week questions are not', async () => {
  const { WEEKLY_WORDS } = await import('../lib/telegram/plugins/weekly.ts')
  const norm = (m) => m.toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  for (const m of ['how was my week?', 'How was my week', 'how’s my week been?', 'how has my week been', 'how did my week go', 'how is my week going so far', 'weekly check', 'Weekly check-in', 'week review', 'my weekly summary', 'review my week', 'how did i do this week?', 'ok how was the week'])
    assert.ok(WEEKLY_WORDS.test(norm(m)), m)
  for (const m of ['plan my week', 'my week', 'what does my week look like', 'how’s my load this week', 'weekly check off', 'how was my weekend', 'how was football this week'])
    assert.ok(!WEEKLY_WORDS.test(norm(m)), m)
})
