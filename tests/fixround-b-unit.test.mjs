// Fix round, part B (plans/fix-round.md): the study planner and the Your week card on Nat's real autumn (half-term
// 17 Oct – 1 Nov, ACT Sun 25 Oct, school back Mon 2 Nov; THIS = 19 Oct, NEXT = 26 Oct, SCHOOL = 2 Nov; today Wed 21 Oct).
// Plain code only (no database): what may go on a day (not before, Later, focus periods, test days, App ideas), the
// bot's focus_period change, one block per task, ACT free time, "plan next week" any day, small edits re-fitted in code,
// and Today's picks narrowed the same way.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/fixround-b-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ACT_DAY, GOALS, NEXT, PLANNING, SCHOOL, TASKS, THIS, TODAY, day, at } from './support/nat-real.mjs'
import { actFillDay, actFillers, blockedWhy, dayRules, focusChange, focusLines, focusOn, inFocus, isAppIdea, rulesForAI, testDays } from '../lib/today/focus.ts'
import { editStudy, weekAsked } from '../lib/telegram/yourweek.ts'
import { narrowWorld, onePerTask, taskPicks } from '../lib/today/load.ts'
import { planStudyDay } from '../lib/tracker/engine.ts'
import { deadlineOf } from '../lib/tasks.ts'
import { isoDow } from '../lib/time.ts'

const task = (id) => TASKS.find((t) => t.id === id)
const HALF_TERM_DAYS = (d) => d >= '2026-10-17' && d <= '2026-11-01'
// a school day: a weekday outside half-term
const schoolDay = (d) => isoDow(d) <= 5 && !HALF_TERM_DAYS(d)
const tests = testDays(GOALS, schoolDay)
const rulesOf = (d, planning = PLANNING) => dayRules(planning, tests, d)
const SUBJ = { 'subj-fm': 'Further Maths', 'subj-phys': 'Physics', 'subj-act': 'ACT' }
/** Why a task can't go on a day of the week being planned (null: it can). */
const why = (id, date, until = day(NEXT, 6), planning = PLANNING) => {
  const t = task(id)
  return blockedWhy({ title: t.title, subject: SUBJ[t.subject_id] ?? null, heavy: true, task: t, deadline: deadlineOf(t), ofTest: false }, date, rulesOf(date, planning), { until })
}

test('1: FM, physics, Vlad and HT2 are never planned before Mon 26 Oct (not before + the ACT focus), and are from then on', () => {
  for (const id of ['t-fm', 't-phys', 't-vlad', 't-ht2']) {
    for (let i = 3; i <= 6; i++) assert.ok(why(id, day(THIS, i), day(THIS, 6)), `${id} on ${day(THIS, i)}`)
    assert.equal(why(id, NEXT), null, `${id} from Mon 26 Oct`)
  }
  assert.match(why('t-fm', day(THIS, 3), day(THIS, 6)), /not before Mon 26 Oct/)
  // the not-before alone (no focus period): still not before Mon 26 Oct
  const noFocus = { ...PLANNING, focusPeriods: [] }
  assert.match(why('t-vlad', day(THIS, 4), day(THIS, 6), noFocus), /not before Mon 26 Oct/)
  // the focus alone: an ACT task is fine, the overdue chemistry isn't (until it ends)
  assert.equal(why('t-act-read', day(THIS, 2), day(THIS, 6)), null)
  assert.match(why('t-overdue', day(THIS, 2), day(THIS, 6)), /only ACT until Sun 25 Oct/)
  assert.equal(why('t-overdue', NEXT), null, 'the focus ended by itself')
  // Later: left out of the week unless due in it
  assert.equal(why('t-later', NEXT), 'in Later')
  assert.equal(why('t-later', day(NEXT, 1)) , 'in Later')
  const dueLater = { ...task('t-later'), due_at: at(day(NEXT, 4), '23:59') }
  assert.equal(blockedWhy({ title: dueLater.title, heavy: false, task: dueLater, deadline: deadlineOf(dueLater) }, NEXT, rulesOf(NEXT), { until: day(NEXT, 6) }), null, 'due this week: planned')
  // in the first school week everything is back to normal
  assert.equal(why('t-ht2', SCHOOL, day(SCHOOL, 6)), null)
})

test('1: the focus period ends by itself; the bot sets it with focus_period (and clears it)', () => {
  assert.equal(focusOn(PLANNING, TODAY).only, 'ACT')
  assert.equal(focusOn(PLANNING, ACT_DAY).only, 'ACT')
  assert.equal(focusOn(PLANNING, NEXT), null)
  assert.ok(inFocus({ only: 'ACT' }, { title: 'ACT countdown: timed English' }))
  assert.ok(!inFocus({ only: 'ACT' }, { title: 'Physics: react to the feedback' }))
  assert.ok(inFocus({ only: 'Physics' }, { title: 'Booklet', subject: 'physics' }))
  const r = focusChange('until=2026-10-25; only=ACT', {}, TODAY)
  assert.deepEqual(r.change.patch, { focusPeriods: [{ from: TODAY, until: ACT_DAY, only: 'ACT' }] })
  assert.match(r.change.line, /Focus: <b>only ACT until Sun 25 Oct<\/b>/)
  assert.match(focusChange('until=2026-10-25; only=ACT', { focusPeriods: [{ from: TODAY, until: ACT_DAY, only: 'ACT' }] }, TODAY).problem, /already/)
  assert.deepEqual(focusChange('clear=yes', PLANNING, TODAY).change.patch, { focusPeriods: [] })
  assert.match(focusChange('clear=yes', PLANNING, NEXT).problem, /no focus period/, 'an ended one is gone already')
  assert.match(focusChange('until=2026-10-20; only=ACT', {}, TODAY).problem, /until which date/)
  assert.match(focusChange('until=2026-10-25', {}, TODAY).problem, /what is the focus on/)
})

test('2: the ACT on Sun 25 Oct takes the day (nothing else, homework included); Sat 24 is light; HT2 (a school day) isn’t a test day', () => {
  assert.deepEqual([...tests], [[ACT_DAY, 'ACT retake']])
  const sun = rulesOf(ACT_DAY), sat = rulesOf(day(THIS, 5))
  assert.equal(sun.test, 'ACT retake')
  assert.equal(sat.eve, 'ACT retake')
  const hw = { title: 'Physics homework: forces', heavy: true, task: { title: 'Physics homework: forces', status: 'this_week' }, deadline: day(NEXT, 0) }
  assert.match(blockedWhy(hw, ACT_DAY, { ...sun, focus: null }, { until: ACT_DAY }), /ACT retake today: nothing else/)
  assert.equal(blockedWhy({ title: 'ACT retake today 🍀', heavy: false, ofTest: true }, ACT_DAY, sun, { until: ACT_DAY }), null, 'its warm-up stays')
  assert.ok(blockedWhy({ title: 'ACT reading passage set', heavy: true, ofTest: true }, ACT_DAY, sun, { until: ACT_DAY }), 'no ACT work on the day either')
  assert.match(blockedWhy({ title: 'ACT mock: full timed test', heavy: true, ofTest: true }, day(THIS, 5), sat, { until: ACT_DAY }), /the day before ACT retake: light only/)
  assert.equal(blockedWhy({ title: 'ACT eve: rules + misses, early night', heavy: false, ofTest: true }, day(THIS, 5), sat, { until: ACT_DAY }), null)
  // HT2 is on Wed 4 Nov, a school day: an ordinary day (its revision on Tue is fine)
  assert.equal(rulesOf(day(SCHOOL, 1)).eve, null)
  assert.equal(why('t-ht2', day(SCHOOL, 1), day(SCHOOL, 6)), null)
})

test('7: an App idea is never a task to plan (the same message, or its words as the title)', () => {
  const ideas = [{ request: 'Show focus periods in Settings', source_text: 'can settings show my focus period' }]
  const t = { ...task('t-later'), title: 'Show focus periods in Settings', status: 'this_week' }
  assert.ok(isAppIdea(t, ideas))
  assert.ok(isAppIdea({ ...task('t-later'), source_text: 'can settings show my focus period' }, ideas))
  assert.ok(!isAppIdea(task('t-fm'), ideas))
  assert.equal(blockedWhy({ title: t.title, heavy: false, task: t }, NEXT, rulesOf(NEXT), { until: day(NEXT, 6), ideas }), 'an App idea, not a task')
})

test('8: free time in the ACT focus goes to ACT reading, grammar and ACT maths; not on the test day or its eve, nor after it', () => {
  assert.deepEqual(actFillers(60).map((f) => f.title), ['ACT reading: timed passages + review', 'ACT grammar: rules + English questions', 'ACT maths: timed questions + review'])
  assert.ok(actFillers(30).every((f) => f.minutes <= 30 && f.subject === 'ACT'))
  assert.ok(actFillDay(rulesOf(TODAY)) && actFillDay(rulesOf(day(THIS, 4))))
  assert.ok(!actFillDay(rulesOf(day(THIS, 5))) && !actFillDay(rulesOf(ACT_DAY)) && !actFillDay(rulesOf(NEXT)))
  // the card says so, and what starts later
  const lines = focusLines(PLANNING, TASKS, TODAY, day(THIS, 6))
  assert.equal(lines[0], '🎯 Focus: only ACT until Sun 25 Oct')
  assert.match(lines[1], /^⏳ From Mon 26 Oct: FM homework: complex numbers ex 2B, Physics: SHM booklet, Vlad: mechanics questions \(\+1 more\)$/)
  assert.deepEqual(focusLines(PLANNING, TASKS, NEXT, day(NEXT, 6)), [], 'next week: nothing waiting, no focus')
  // the planner AI is told the same rules
  const words = rulesForAI([day(NEXT, 0), day(NEXT, 1)], (d) => rulesOf(d), TASKS, day(NEXT, 6))
  assert.match(words, /Tasks in Later: only if due by Sun 1 Nov\. App ideas are never tasks\./)
  assert.match(rulesForAI([TODAY], (d) => rulesOf(d), TASKS, day(THIS, 6)), /"Vlad: mechanics questions" not before Mon 26 Oct/)
})

test('9: “plan next week” works any day: on Wed 21 Oct it is Mon 26 Oct – Sun 1 Nov', () => {
  assert.deepEqual(weekAsked('plan next week', TODAY), { from: NEXT, to: day(NEXT, 6) })
  assert.deepEqual(weekAsked('Can you plan next week please, Vlad + FM + physics', TODAY), { from: NEXT, to: day(NEXT, 6) })
  assert.deepEqual(weekAsked('next week’s plan', day(THIS, 5)), { from: NEXT, to: day(NEXT, 6) })
  assert.equal(weekAsked('plan my week', TODAY), null)
  assert.equal(weekAsked('FM homework is due next week', TODAY), null, 'a deadline next week isn’t a request to plan it')
})

const ITEMS = [
  { date: day(NEXT, 0), items: [{ title: 'Vlad: mechanics questions', minutes: 60, kind: 'focus', ref: { kind: 'task', id: 't-vlad' } }] },
  { date: day(NEXT, 3), items: [{ title: 'Physics: SHM booklet', minutes: 45, kind: 'focus', ref: { kind: 'task', id: 't-phys' }, subject: 'Physics' }, { title: 'FM HT2 revision', minutes: 45, kind: 'focus', ref: { kind: 'task', id: 't-ht2' } }] },
  { date: day(NEXT, 4), items: [{ title: 'FM homework: complex numbers ex 2B', minutes: 60, kind: 'focus', ref: { kind: 'task', id: 't-fm' } }, { title: 'Early night', minutes: 30, kind: 'rest', ref: null }] },
]
const range = { from: NEXT, to: day(NEXT, 6) }

test('17: small changes re-fit the planner’s picks in code: “nothing on Friday”, “no physics on Thu”, “FM homework to Sat”', () => {
  const off = editStudy(ITEMS, 'nothing on Friday', range)
  assert.deepEqual(off.items.find((d) => d.date === day(NEXT, 4)).items.map((i) => i.title), ['Early night'])
  assert.deepEqual(off.said, ['study off Fri'])
  const phys = editStudy(ITEMS, 'no physics on Thursday', range)
  assert.deepEqual(phys.items.find((d) => d.date === day(NEXT, 3)).items.map((i) => i.title), ['FM HT2 revision'])
  const moved = editStudy(ITEMS, 'move FM homework to Saturday', range)
  assert.deepEqual(moved.items.find((d) => d.date === day(NEXT, 5))?.items.map((i) => i.title) ?? [], [], 'Sat had no picks, so…')
  // (a day with no picks yet isn't in the list: a move there needs the day to exist)
  const withSat = [...ITEMS, { date: day(NEXT, 5), items: [] }]
  const m2 = editStudy(withSat, 'move FM homework to Saturday', range)
  assert.deepEqual(m2.items.find((d) => d.date === day(NEXT, 5)).items.map((i) => i.title), ['FM homework: complex numbers ex 2B'])
  assert.deepEqual(m2.items.find((d) => d.date === day(NEXT, 4)).items.map((i) => i.title), ['Early night'])
  // training words are the optimiser's, not study changes
  assert.deepEqual(editStudy(ITEMS, 'upper Sat at PureGym', range).said, [])
  assert.deepEqual(editStudy(ITEMS, 'upper 3x this week', range).said, [])
  assert.equal(ITEMS[2].items.length, 2, 'the card’s own picks are never changed in place')
})

test('5 + 6: Today on Wed 21 Oct (ACT focus): no Vlad homework (not before 26 Oct), no overdue chemistry on top; one block per task', () => {
  const rules = rulesOf(TODAY)
  const ok = (x) => {
    const t = x.taskId ? TASKS.find((y) => y.id === x.taskId) : null
    return !blockedWhy({ title: x.title, subject: x.subject ?? null, heavy: x.heavy, task: t, deadline: t ? deadlineOf(t) : null }, TODAY, rules, { until: TODAY, later: false })
  }
  const world = {
    today: TODAY, topics: [{ id: 'top-1', subjectId: 'subj-fm', subject: 'Further Maths', code: 'PC1-01', name: 'Complex numbers', strand: 'Further Pure', teacher: null, halfTerm: null, taughtFrom: '2026-10-01', taught: null,
      status: 'not_secure', step: 1, bicen: null, integralUrl: null, freshPct: null, lastDone: '2026-10-10', weakNotes: null, concepts: null, booklet: null, pmt: null, pmtRef: null, bookRef: null, order: 1 }],
    tests: [], mistakes: [], programmes: [], rules: [], doneToday: [], reviewDays: { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 },
    homework: [{ id: 't-vlad', title: 'Vlad: mechanics questions', subjectId: 'subj-phys', subject: 'Physics', dueAt: task('t-vlad').due_at, minutes: 60 }],
    links: { bicenPure: '', bicenStats: '', bicenMech: '', bicenCorePure: '', bicenMemorise: '', bicenSummaries: '', bicenHardest: '', integralFurther: '', integralAssessments: '', madas: '', step: '', pmtPhysics: '', isaac: '', amsp: '' },
  }
  const ctx = { date: TODAY, dow: 3, mode: 'half_term', studyMinutes: 300 }
  // before the fix: Vlad's questions (due Wed 28 Oct) were Today's first item, and an FM topic came next
  const old = planStudyDay(world, ctx).picks
  assert.equal(old[0].key, 'task:t-vlad')
  assert.ok(old.some((p) => p.topicId === 'top-1'))
  const narrowed = narrowWorld(world, rules, ok)
  assert.deepEqual(narrowed.homework, [])
  assert.deepEqual(narrowed.topics, [])
  assert.deepEqual(planStudyDay(narrowed, ctx).picks, [])
  // his must-do tasks: the overdue chemistry is due-tier (top of Today) without the focus; with it, it isn't there
  const tasks = taskPicks(TASKS, TODAY, 'subj-act')
  assert.ok(tasks.some((p) => p.taskId === 't-overdue' && p.tier === 1), 'it would jump to the top')
  const kept = tasks.filter((p) => ok({ title: p.title, subject: p.subject, heavy: true, taskId: p.taskId }))
  assert.ok(!kept.some((p) => p.taskId === 't-overdue'))
  // from Mon 26 Oct (focus over, not-before reached): the FM homework is back
  const r2 = rulesOf(NEXT)
  const ok2 = (x) => !blockedWhy({ title: x.title, subject: x.subject ?? null, heavy: x.heavy, task: x.taskId ? task(x.taskId) : null }, NEXT, r2, { until: NEXT, later: false })
  assert.equal(narrowWorld(world, r2, ok2).homework.length, 1)
  // one block per task a day (the one he ticked wins)
  const rows = [
    { id: 'a', task_id: 't-act-read', status: 'planned', kind: 'focus' }, { id: 'b', task_id: 't-act-read', status: 'done', kind: 'focus' },
    { id: 'c', task_id: null, status: 'planned', kind: 'focus' }, { id: 'd', task_id: null, status: 'planned', kind: 'training' }, { id: 'e', task_id: 't-act-read', status: 'planned', kind: 'focus' },
  ]
  assert.deepEqual(onePerTask(rows).map((r) => r.id), ['b', 'c', 'd'])
})
