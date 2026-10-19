// Simulated weeks (plans/contracts.md §3.4, the overnight queue's TESTING list), plain tests (no database): the real
// curriculum (60 Maths/FM + 32 Physics topics), the four real tests, made-up colours / mistakes / homework, STEP and a
// steady ACT pick from "the ACT planner". Each day is planned, every pick is ticked (its done hint applied), and the
// next day is planned from the result. Every day must follow the rules:
//   homework first · tiers in order · ≤ 5 picks (maxPicks) · strict by count (nothing lower placed while something
//   higher that fits has no room) · minutes within the day · tests only within 21 days, ≤ 2 a test, never dropped
//   silently · diagnostic → booklets → topic work (only where the booklet is done, never on 🟢) · timed practice only
//   3–4 days before (once) · light the day before (only the light pick in its subjects) · consolidation slot 60
//   (half-term) / 30 (school) · reviews ≤ 2 · ahead only maths, ⏭ Next up, ⚪/🔴, first in school order · stretch only
//   🟢 · STEP only at the weekend, once a week · steady ACT only missing for room or minutes.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-week-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planStudyDay, DEFAULT_PICKS, slotRank } from '../lib/tracker/engine.ts'
import { TIER } from '../lib/plan-items.ts'
import { addDays, daysBetween, weekStartISO } from '../lib/time.ts'
import { taughtState } from '../lib/tracker/rules.ts'
import { bookletDone, testsInWindow, testPhase, diagnosed } from '../lib/tracker/testmode.ts'
import { realWorld, homework, rule, dayOf, simulate } from './fixtures/tracker-world.mjs'

const MATHS = new Set(['Maths', 'Further Maths'])
const TEST_KINDS = new Set(['test_diagnostic', 'test_booklet', 'test_topic', 'test_timed', 'test_light', 'consolidation'])
const steadyAct = (day, minutes) => ({ key: `act:rotation:${day.date}`, kind: 'act', tier: TIER.leftover, subject: 'ACT', title: 'ACT steady: English', open: 'Complete Guide to ACT English – next chapter + exercise', minutes, why: 'steady ACT', done: { kind: 'act', section: 'english' } })
/** "The ACT planner": half-term ~75 min a day; school weeks 30 min × 3 (Mon, Wed, Fri). */
const actFor = (day) => (day.mode === 'half_term' ? [steadyAct(day, 75)] : [1, 3, 5].includes(day.dow) ? [steadyAct(day, 30)] : [])
const week = (start, mode, minutes) => minutes.map((m, i) => dayOf(addDays(start, i), mode, m))
const HALF = [300, 300, 300, 300, 300, 240, 180]
const SCHOOL = [120, 120, 120, 120, 120, 240, 150]

/** Every rule, checked on one planned day against the world as it was that morning. */
function checkDay({ day, plan, snapshot: w }) {
  const at = day.date
  const picks = plan.picks
  const msg = (s) => `${at}: ${s}\n  ${picks.map((p) => `${p.kind} ${p.minutes}m ${p.title}`).join('\n  ')}\n  notes: ${plan.notes.join(' | ')}`
  const topicOf = new Map(w.topics.map((t) => [t.id, t]))
  const windows = testsInWindow(w, at)
  const max = day.maxPicks ?? DEFAULT_PICKS

  assert.ok(picks.length <= max, msg(`≤ ${max} picks`))
  // homework first (all of it when there's room)
  const hwDue = w.homework.filter((h) => h.dueAt && h.dueAt.slice(0, 10) <= addDays(at, 7))
  const hw = picks.filter((p) => p.kind === 'homework')
  assert.equal(hw.length, Math.min(max, hwDue.length), msg('every homework due is on'))
  assert.ok(picks.slice(0, hw.length).every((p) => p.kind === 'homework'), msg('homework first'))
  // tiers in order; strict by count
  const tiers = picks.map((p) => p.tier)
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), msg('tiers in order'))
  for (const l of plan.left.filter((x) => x.reason === 'room')) {
    for (const p of picks) assert.ok(slotRank(p) <= slotRank(l), msg(`${p.key} placed while ${l.key} had no room`))
  }
  // minutes within the day
  const hwMin = hw.reduce((a, p) => a + p.minutes, 0)
  const rest = picks.filter((p) => p.kind !== 'homework').reduce((a, p) => a + p.minutes, 0)
  assert.ok(rest <= Math.max(0, day.studyMinutes - hwMin), msg(`minutes ${rest} within ${day.studyMinutes - hwMin}`))
  for (const p of picks) {
    assert.ok(Number.isInteger(p.minutes) && p.minutes > 0 && p.open && p.why && p.done, msg(`pick shape ${p.key}`))
    if (p.steps) assert.equal(p.steps.reduce((a, s) => a + s.minutes, 0), p.minutes, msg(`steps add up ${p.key}`))
  }
  const topicIds = picks.map((p) => p.topicId).filter(Boolean)
  assert.equal(new Set(topicIds).size, topicIds.length, msg('a topic once a day'))
  // tests: in the window, ≤ 2 each, playbook order; a test left out for room is named
  const testPicks = picks.filter((p) => TEST_KINDS.has(p.kind))
  for (const p of testPicks) {
    const win = windows.find((x) => x.test.id === p.goalId)
    assert.ok(win, msg(`${p.key}: its test is within 21 days`))
    assert.ok(testPicks.filter((x) => x.goalId === p.goalId).length <= 2, msg('≤ 2 picks a test'))
    const phase = testPhase(win, at)
    if (p.kind === 'test_timed') assert.ok(win.daysLeft >= 3 && win.daysLeft <= 4, msg('timed only 3–4 days before'))
    if (p.kind === 'test_light') assert.equal(win.daysLeft, 1, msg('light only the day before'))
    if (p.kind === 'test_diagnostic') assert.ok(!diagnosed(win.test), msg('diagnostic only once'))
    if (p.kind === 'test_booklet' || p.kind === 'test_topic') {
      assert.ok(diagnosed(win.test) || win.daysLeft < 5 || testPicks.some((x) => x.goalId === p.goalId && x.kind === 'test_diagnostic'), msg(`${p.key}: diagnostic first`))
    }
    if (p.kind === 'test_topic') {
      const t = topicOf.get(p.topicId)
      assert.ok(bookletDone(win.test, t), msg(`${p.key}: its teacher booklet first`))
      assert.notEqual(t.status, 'exam_ready', msg(`${p.key}: no 🟢 topic work`))
    }
    if (p.kind === 'consolidation') assert.equal(p.minutes, day.mode === 'half_term' ? 60 : 30, msg('consolidation slot'))
    assert.notEqual(phase, 'test_day', msg('no prep on the test day itself'))
  }
  const testNote = plan.notes.find((n) => n.startsWith('left for another day:')) ?? ''
  for (const l of plan.left.filter((x) => x.tier <= TIER.test && x.reason === 'room')) assert.ok(testNote.includes(l.title), msg(`${l.title} named in the notes`))
  // the day before a test: only its light pick in its subjects
  for (const win of windows.filter((x) => testPhase(x, at) === 'light')) {
    if (picks.length < max || picks.some((p) => p.goalId === win.test.id)) assert.ok(picks.some((p) => p.kind === 'test_light' && p.goalId === win.test.id), msg(`${win.test.title}: a light pick`))
    for (const p of picks.filter((x) => x.subject && win.subjects.includes(x.subject))) {
      assert.ok(['test_light', 'homework', 'mistake_redo'].includes(p.kind), msg(`${p.key}: nothing heavy the day before ${win.test.title}`))
    }
  }
  // reviews ≤ 2; at most one redo pick of each kind (a test's own: tier 2; the rest: tier 3)
  assert.ok(picks.filter((p) => p.kind === 'review').length <= 2, msg('≤ 2 reviews'))
  assert.ok(picks.filter((p) => p.kind === 'mistake_redo' && p.tier === TIER.test).length <= 1, msg('one test redo pick'))
  assert.ok(picks.filter((p) => p.kind === 'mistake_redo' && p.tier === TIER.review).length <= 1, msg('one redo pick'))
  // getting ahead: maths only, ⏭ Next up, ⚪/🔴, the first such topic in school order not used today
  for (const p of picks.filter((x) => x.kind === 'ahead')) {
    const t = topicOf.get(p.topicId)
    assert.ok(MATHS.has(t.subject), msg('ahead: maths only'))
    assert.equal(taughtState(t, at), 'next_up', msg('ahead: ⏭ Next up only'))
    assert.ok(t.status === 'not_started' || t.status === 'not_secure', msg('ahead: move on at 🟡'))
    const order = (a, b) => (a.taughtFrom ?? '').localeCompare(b.taughtFrom ?? '') || a.order - b.order
    const first = w.topics.filter((x) => MATHS.has(x.subject) && taughtState(x, at) === 'next_up' && (x.status === 'not_started' || x.status === 'not_secure') && (x.id === t.id || !topicIds.includes(x.id))).sort(order)[0]
    assert.equal(first.id, t.id, msg('ahead: school order'))
    assert.ok(p.minutes >= 45 && p.minutes <= 90, msg('ahead 45–90 min'))
  }
  for (const p of picks.filter((x) => x.kind === 'stretch')) assert.equal(topicOf.get(p.topicId).status, 'exam_ready', msg('stretch only on 🟢'))
  assert.ok(!picks.some((p) => p.subject === 'Physics' && (p.kind === 'ahead' || p.kind === 'stretch')), msg('physics: keep up + review only'))
  // programmes: STEP at the weekend only, never shortened
  for (const p of picks.filter((x) => x.kind === 'programme')) { assert.ok(day.dow >= 6, msg('STEP only at the weekend')); assert.equal(p.minutes, 75, msg('STEP full length')) }
  // steady ACT: missing only for lack of room or minutes
  for (const a of actFor(day)) if (!picks.some((p) => p.key === a.key)) assert.ok(plan.left.some((x) => x.key === a.key), msg('steady ACT left out for a reason'))
}

/** STEP picks per Mon–Sun week: at most one, always on a weekend day. */
function stepOncePerWeek(days) {
  const byWeek = new Map()
  for (const { day, plan } of days) for (const p of plan.picks.filter((x) => x.kind === 'programme')) {
    const wk = weekStartISO(day.date)
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + 1)
  }
  for (const [wk, n] of byWeek) assert.ok(n <= 1, `STEP ${n}× in the week of ${wk}`)
  return byWeek
}

const plan = (world, day) => planStudyDay(world, day, actFor(day))

test('half-term week Mon 19 – Sun 25 Oct 2026: every day follows the rules', () => {
  const w = realWorld()
  const days = simulate(w, week('2026-10-19', 'half_term', HALF), plan)
  days.forEach(checkDay)
  stepOncePerWeek(days)
  const on = (date) => days.find((d) => d.day.date === date).plan
  // Mon: homework due Wed first; the consolidation slot is the only test in the window
  assert.equal(on('2026-10-19').picks[0].key, 'task:h-kin')
  assert.deepEqual(on('2026-10-19').picks.filter((p) => p.tier === TIER.test).map((p) => p.kind), ['mistake_redo', 'consolidation'], "the consolidation's own redo (playbook step 5), then its slot")
  assert.equal(on('2026-10-19').testMode.title, 'FM HT1 Consolidation')
  // the consolidation slot every day of half-term, 60 min
  for (const d of days) assert.equal(d.plan.picks.find((p) => p.kind === 'consolidation')?.minutes, 60, d.day.date)
  // Tue: the mechanics test enters the window (21 days) → its diagnostic first, then the 🔴 topic's booklet
  assert.deepEqual(on('2026-10-20').picks.filter((p) => p.goalId === 'g-mech').map((p) => p.kind), ['test_diagnostic', 'test_booklet'])
  assert.equal(on('2026-10-20').testMode.title, 'Physics mechanics test')
  // Thu: FM HT2 + waves enter the window → their diagnostics
  for (const id of ['g-ht2', 'g-waves']) assert.equal(on('2026-10-22').picks.find((p) => p.goalId === id)?.kind, 'test_diagnostic', id)
  // the mistake redos happen (one pick) when due
  assert.ok(on('2026-10-19').picks.some((p) => p.kind === 'mistake_redo'))
  // four tests in the window and 5 slots: tiers 1–4 fill every day, so steady ACT waits (strict priority by count) –
  // it is listed as left for another day, never silently dropped
  assert.ok(days.every((d) => !d.plan.picks.some((p) => p.kind === 'act') && d.plan.left.some((x) => x.kind === 'act')))
  assert.ok(days.slice(0, 3).every((d) => d.plan.notes.some((n) => n.includes('ACT steady: English'))))
  // nothing is learnt ahead in physics, ever; tests take over this half-term ("ahead only after")
  assert.ok(days.every((d) => !d.plan.picks.some((p) => p.kind === 'ahead' && !MATHS.has(p.subject))))
  // the world moved on: diagnostics logged, booklets done, homework done
  assert.ok(w.tests.find((t) => t.id === 'g-mech').attempts.some((a) => a.what === 'diagnostic'))
  assert.equal(w.homework.length, 0)
})

test('"pause getting ahead until 25 Oct" over a half-term week without tests: ahead would happen, but not while paused; the rule shows every day, then it is gone', () => {
  const calm = (o = {}) => realWorld({ tests: [], homework: [], ...o })
  const without = simulate(calm(), week('2026-10-19', 'half_term', HALF), plan)
  without.forEach(checkDay)
  assert.ok(without.filter((d) => d.plan.picks.some((p) => p.kind === 'ahead')).length >= 4, 'without the rule: an ahead session on most days')
  const pause = rule({ kind: 'pause', target: 'ahead', words: 'pause getting ahead until 25 Oct', startsOn: '2026-10-19', endsOn: '2026-10-25' })
  const days = simulate(calm({ rules: [pause] }), [...week('2026-10-19', 'half_term', HALF), dayOf('2026-10-26', 'half_term', 300)], plan)
  days.forEach(checkDay)
  for (const d of days.slice(0, 7)) {
    assert.ok(!d.plan.picks.some((p) => p.kind === 'ahead'), d.day.date)
    assert.ok(d.plan.notes.includes('paused: getting ahead until Sun 25 Oct'), d.day.date)
    assert.ok(d.plan.picks.some((p) => p.kind === 'fix' && p.tier === TIER.leftover) || d.plan.picks.length === DEFAULT_PICKS, `${d.day.date}: its time went to fixing (when a slot was free)`)
  }
  assert.ok(days[7].plan.picks.some((p) => p.kind === 'ahead'), 'Mon 26 Oct: the rule has expired')
  assert.ok(!days[7].plan.notes.some((n) => n.startsWith('paused')))
})

test('school week Mon 2 – Sun 8 Nov 2026 (and on to the tests on 10 + 12 Nov): every day follows the rules', () => {
  const w = realWorld()
  simulate(w, [...week('2026-10-19', 'half_term', HALF), ...week('2026-10-26', 'school', SCHOOL)], plan)
  w.homework = [
    homework({ id: 'h-exp', title: 'Exponentials exercise', subject: 'Maths', dueAt: '2026-11-04T12:00:00Z', minutes: 45 }),
    homework({ id: 'h-cx', title: 'Complex numbers sheet', subject: 'Further Maths', dueAt: '2026-11-05T12:00:00Z', minutes: 30 }),
    homework({ id: 'h-wav', title: 'Waves worksheet', subject: 'Physics', dueAt: '2026-11-06T12:00:00Z', minutes: 30 }),
  ]
  const days = simulate(w, [...week('2026-11-02', 'school', SCHOOL), ...week('2026-11-09', 'school', [120, 120, 120, 120])], plan)
  days.forEach(checkDay)
  const on = (date) => days.find((d) => d.day.date === date).plan
  // Mon: the three homeworks (due Wed / Thu / Fri) come first, earliest first; the consolidation was due today
  assert.deepEqual(on('2026-11-02').picks.slice(0, 3).map((p) => p.key), ['task:h-exp', 'task:h-cx', 'task:h-wav'])
  assert.ok(on('2026-11-02').notes.includes('FM HT1 Consolidation is today – afterwards log the score + every mistake'))
  assert.ok(days.every((d) => !d.plan.picks.some((p) => p.kind === 'consolidation')), 'no consolidation after its due date')
  // no diagnostics: they were done in half-term
  assert.ok(days.every((d) => !d.plan.picks.some((p) => p.kind === 'test_diagnostic')))
  // one timed practice per test, 3–4 days before
  const timed = days.flatMap((d) => d.plan.picks.filter((p) => p.kind === 'test_timed').map((p) => [p.goalId, d.day.date]))
  assert.deepEqual(timed.filter(([g]) => g === 'g-mech').map(([, d]) => d), ['2026-11-06'], 'mechanics: Fri 6 Nov (4 days before)')
  assert.deepEqual(timed.filter(([g]) => g === 'g-ht2').map(([, d]) => d), ['2026-11-08'])
  assert.deepEqual(timed.filter(([g]) => g === 'g-waves').map(([, d]) => d), ['2026-11-08'], 'before the physics light day on Mon 9 Nov')
  // Mon 9 Nov: the day before mechanics → physics is light (its light pick only), maths prep goes on
  const mon9 = on('2026-11-09')
  assert.deepEqual(mon9.picks.filter((p) => p.subject === 'Physics').map((p) => p.kind).filter((k) => k !== 'mistake_redo'), ['test_light'])
  assert.ok(mon9.picks.some((p) => p.goalId === 'g-ht2' && p.kind === 'test_topic'))
  // Tue 10 Nov: mechanics test day; Wed 11 Nov: light for FM HT2 + waves; Thu 12 Nov: both test days
  assert.ok(on('2026-11-10').notes.includes('Physics mechanics test is today – afterwards log the score + every mistake'))
  const wed11 = on('2026-11-11')
  assert.deepEqual(wed11.picks.filter((p) => p.kind === 'test_light').map((p) => p.goalId).sort(), ['g-ht2', 'g-waves'])
  assert.ok(wed11.picks.every((p) => ['test_light', 'mistake_redo', 'homework', 'act'].includes(p.kind)), wed11.picks.map((p) => p.kind).join())
  assert.equal(on('2026-11-12').notes.filter((n) => n.endsWith('is today – afterwards log the score + every mistake')).length, 2)
  // ACT steady on its school days when there's room; never on Tue/Thu/weekends
  for (const d of days) if (![1, 3, 5].includes(d.day.dow)) assert.ok(!d.plan.picks.some((p) => p.kind === 'act'), d.day.date)
})

test('a calm school week after the tests (Mon 16 – Sun 22 Nov): the leftover split runs — ahead in school order, current topics, STEP once at the weekend', () => {
  const w = realWorld()
  simulate(w, [...week('2026-10-19', 'half_term', HALF), ...week('2026-10-26', 'school', SCHOOL), ...week('2026-11-02', 'school', SCHOOL), ...week('2026-11-09', 'school', SCHOOL)], plan)
  const days = simulate(w, week('2026-11-16', 'school', [150, 150, 150, 150, 150, 300, 240]), plan)
  days.forEach(checkDay)
  const all = days.flatMap((d) => d.plan.picks.map((p) => ({ ...p, date: d.day.date })))
  assert.ok(days.every((d) => d.plan.testMode === null), 'no tests in the window')
  assert.ok(all.some((p) => p.kind === 'ahead'), 'getting ahead happens')
  assert.ok(all.some((p) => p.kind === 'current' || p.kind === 'old'), 'current / old shares happen')
  const step = stepOncePerWeek(days)
  assert.equal(step.get('2026-11-16'), 1, 'STEP once this weekend')
  const stepDay = all.find((p) => p.kind === 'programme')
  assert.match(stepDay.title, /^STEP Support – Assignment \d+$/)
  assert.ok(['2026-11-21', '2026-11-22'].includes(stepDay.date))
  for (const p of all.filter((x) => x.kind === 'current')) {
    const t = w.topics.find((x) => x.id === p.topicId)
    assert.ok(t.taught === 'in_class' || daysBetween(t.taughtFrom, p.date) <= 14, `${p.key}: taught in the last 14 days`)
  }
})
