// Half-term week of 19 Oct 2026, no database: the ACT countdown to the Sat 24 Oct retake on holiday days (4 h a day,
// full timed tests Tue + Thu reviewed straight after, Fri light, nothing timed on the day), his ACT tasks on the days he
// gave, "upper 3× a week until 1 Nov", and a second quick message never replacing a card it has nothing to do with.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/halfterm-week-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actPicks } from '../lib/act/engine.ts'
import { actSettings, DEFAULT_ACT_SETTINGS } from '../lib/act/config.ts'
import { actTaskMinutes, isActTask } from '../lib/act/tasks.ts'
import { taskPicks } from '../lib/today/load.ts'
import { upperWeekChange, upperWeek } from '../lib/setup-edit.ts'
import { sharesWords } from '../lib/telegram/converse.ts'
import { holidayChanges, dayMode } from '../lib/today/holidays.ts'
import { TIER } from '../lib/plan-items.ts'

const DAYS = { mon: '2026-10-19', tue: '2026-10-20', wed: '2026-10-21', thu: '2026-10-22', fri: '2026-10-23', sat: '2026-10-24', sun: '2026-10-25' }
const DOW = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 }
const world = (o = {}) => ({
  today: DAYS.mon, retake: { goalId: 'g-act', date: DAYS.sat }, goal: 36,
  scores: [{ id: 's1', takenOn: '2026-09-12', kind: 'real', english: 35, maths: 34, reading: 33, science: 34, composite: 34 }],
  books: [], misses: [], doneToday: [], settings: DEFAULT_ACT_SETTINGS, subjectId: 'subj-act', ...o,
})
const day = (k, o = {}) => ({ date: DAYS[k], dow: DOW[k], mode: dayMode({}, DAYS[k]), studyMinutes: 0, ...o })
const total = (ps) => ps.reduce((n, p) => n + p.minutes, 0)

test('his ACT settings: 4 h a day in the holidays, full timed tests Tue + Thu (his own days win)', () => {
  const s = actSettings({})
  assert.equal(s.countdownHolidayMin, 240)
  assert.deepEqual(s.mockDows, [2, 4])
  assert.deepEqual(actSettings({ actMockDays: 'wednesday, saturday', actCountdownHolidayMin: 180 }).mockDows, [3, 6])
  assert.equal(dayMode({}, DAYS.mon), 'half_term', 'this week is half-term (the Holidays setting)')
})

test('the countdown on holiday days: 4 h; Tue + Thu the full timed test then its review straight after; Fri light; the retake day nothing timed', () => {
  const w = world()
  const mon = actPicks(w, day('mon'))
  assert.deepEqual(mon.map((p) => p.title), ['ACT: timed English + Reading', 'ACT: timed Maths + Science'], 'English first, then the weakest (Reading 33)')
  assert.ok(total(mon) <= 240 && total(mon) >= 200, `4 h (${total(mon)} min)`)
  assert.ok(mon.every((p) => p.minutes <= 240), 'each block fits one sitting')
  for (const k of ['tue', 'thu']) {
    const ps = actPicks(w, day(k))
    assert.deepEqual(ps.map((p) => p.key), ['act:full:mock', 'act:review:mock'], k)
    assert.equal(ps[0].minutes, 165, 'the full test in one sitting (English 35, Maths 50, Reading 40, Science 40)')
    assert.equal(total(ps), 240)
    assert.equal(ps[0].tier, TIER.test, 'top priority: the retake is in 5 days')
  }
  assert.deepEqual(actPicks(w, day('wed')).map((p) => p.key), ['act:english:timed', 'act:sections:maths'], 'Wed: no review of Tuesday’s test (done straight after)')
  const fri = actPicks(w, day('fri'))
  assert.deepEqual(fri.map((p) => [p.key, p.minutes]), [['act:light:eve', 20]], 'Fri light: rules + misses, early night')
  const sat = actPicks(w, day('sat'))
  assert.deepEqual(sat.map((p) => p.key), ['act:test:day'])
  assert.doesNotMatch(JSON.stringify(sat), /timed|practice test/i, 'never a practice test on the real test day')
  assert.deepEqual(actPicks(w, day('sun')), [], 'after the retake: nothing (no books set up)')
})

test('his ACT tasks: on the day he gave (never the day before), and their minutes are part of that day’s 4 h', () => {
  const t = (o) => ({ id: o.id, title: o.title, status: 'this_week', importance: 'must', due_at: `${o.due}T12:00:00Z`, window_end: null, duration_minutes: o.min ?? 45, subject_id: o.subject_id ?? null, archived_at: null, is_system: false, is_key: false, details: null })
  const tasks = [t({ id: 'a1', title: 'ACT reading passages set 3', due: DAYS.wed, min: 60 }), t({ id: 'a2', title: 'Grammar drills', due: DAYS.thu, subject_id: 'subj-act' }), t({ id: 'h1', title: 'Physics homework', due: DAYS.wed })]
  assert.ok(isActTask(tasks[0], 'subj-act') && isActTask(tasks[1], 'subj-act') && !isActTask(tasks[2], 'subj-act'))
  assert.ok(!isActTask({ title: 'Act 2 essay', subject_id: null }, null), '“Act” in English isn’t the ACT')
  const tue = taskPicks(tasks, DAYS.tue, 'subj-act')
  assert.deepEqual(tue.map((p) => p.taskId), ['h1'], 'Tuesday: the homework due tomorrow, not the ACT task for Wednesday')
  const wed = taskPicks(tasks, DAYS.wed, 'subj-act')
  const act = wed.find((p) => p.taskId === 'a1')
  assert.equal(act.tier, TIER.test)
  assert.equal(act.why, 'your ACT task for today')
  assert.equal(actTaskMinutes(tasks, DAYS.wed, 'subj-act'), 60)
  const withTask = actPicks(world(), day('wed', { actTaskMin: 60 }))
  assert.ok(total(withTask) <= 180, `the ACT plan makes room for his task (${total(withTask)} min)`)
  // a day his tasks fill: only the flashcards (when he has them) or nothing
  assert.deepEqual(actPicks(world(), day('wed', { actTaskMin: 230 })), [])
})

test('ticking the full test (or logging its score) keeps the review straight after', () => {
  const ticked = actPicks(world({ today: DAYS.tue, doneToday: ['act:full:mock'] }), day('tue'))
  assert.deepEqual(ticked.map((p) => p.key), ['act:review:mock'])
  const scored = actPicks(world({ today: DAYS.tue, doneToday: ['act:day'] }), day('tue'))
  assert.deepEqual(scored.map((p) => p.key), ['act:review:mock'])
})

test('school weeks keep the old countdown: one mock on the first test day, reviewed the next day', () => {
  const w = world({ retake: { goalId: 'g', date: '2026-11-21' } })
  const tue = actPicks(w, { date: '2026-11-03', dow: 2, mode: 'school', studyMinutes: 0 })
  assert.deepEqual(tue.map((p) => p.key), ['act:full:mock'])
  const wed = actPicks(w, { date: '2026-11-04', dow: 3, mode: 'school', studyMinutes: 0 })
  assert.match(wed[0].title, /mock review/)
})

test('“upper 3× a week until 1 Nov”: this week and next; then the optimiser decides again', () => {
  const r = upperWeekChange('count=3; until=2026-11-01', {}, DAYS.mon)
  assert.ok(r.change, r.problem)
  assert.deepEqual(r.change.patch.upperWeeks, { '2026-10-19': 3, '2026-10-26': 3 })
  assert.match(r.change.line, /Upper: <b>3× a week until Sun 1 Nov<\/b>/)
  const planning = { upperWeeks: r.change.patch.upperWeeks }
  assert.equal(upperWeek(planning, '2026-10-26'), 3)
  assert.equal(upperWeek(planning, '2026-11-02'), null, 'after 1 Nov: the optimiser’s choice again')
  assert.match(upperWeekChange('count=3; until=2026-11-01', planning, DAYS.mon).problem, /already 3× every week/)
  assert.match(upperWeekChange('count=3; until=2026-10-01', {}, DAYS.mon).problem, /has passed/)
  assert.deepEqual(upperWeekChange('count=3', {}, DAYS.mon).change.patch.upperWeeks, { '2026-10-19': 3 }, 'without a date: this week only, as before')
})

test('half-term: no school on the Your week card and in the training planner (the same holiday logic as Today)', () => {
  const school = { id: 'e-school', title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15', repeat_from: '2026-09-01', is_school: true, starts_at: null }
  const off = holidayChanges([school], [], {}, DAYS.mon, DAYS.sun)
  assert.deepEqual(off.map((c) => c.on_date), [DAYS.mon, DAYS.tue, DAYS.wed, DAYS.thu, DAYS.fri, '2026-10-26'], 'and Mon 26 (still half-term) for the day after the range')
  assert.ok(off.every((c) => c.cancelled))
  assert.deepEqual(holidayChanges([school], [], { holidays: 'none' }, DAYS.mon, DAYS.sun), [], 'no holidays: school as usual')
})

test('two quick messages while a card waits: a “correction” about something else is its own item', () => {
  assert.equal(sharesWords('Chemistry notes', 'Chemistry notes due Friday, 30 min'), true)
  assert.equal(sharesWords('Chemistry notes', 'Maths test on Thursday'), false)
  assert.equal(sharesWords('Physics homework: waves', 'the physics one is due Friday'), true)
})
