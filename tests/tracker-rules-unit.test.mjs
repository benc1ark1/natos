// Study tracker rules (plans/contracts.md §3.2) and temporary rules (§3.6), plain tests (no database): colours from
// fresh-question %, review dates per colour, taught / next up / later, mistake redos, pipeline steps; which rules are
// live on a date (auto-expiry), what each rule target covers, the rule lines.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-rules-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { colourFromPct, nextReview, isDue, taughtState, firstRedo, afterRedo, stepAfter, DEFAULT_REVIEW_DAYS, parseMistakeKind } from '../lib/tracker/rules.ts'
import { isLive, liveRules, targetMatches, pausedBy, boostedBy, capRules, ruleNote, targetLabel, subjectCovers, programmeBoosted } from '../lib/tracker/rulesets.ts'
import { rule } from './fixtures/tracker-world.mjs'

const pick = (o) => ({ key: 'k', kind: 'review', tier: 3, subject: 'Maths', title: 't', open: 'o', minutes: 20, why: 'w', done: { kind: 'block' }, ...o })

// ---- colours and review dates ------------------------------------------------

test('colour from fresh questions: 🔴 < 65 · 🟡 65–84 · 🟢 ≥ 85 only without notes', () => {
  assert.equal(colourFromPct(0), 'not_secure')
  assert.equal(colourFromPct(64), 'not_secure')
  assert.equal(colourFromPct(65), 'understand')
  assert.equal(colourFromPct(84), 'understand')
  assert.equal(colourFromPct(85), 'exam_ready')
  assert.equal(colourFromPct(100), 'exam_ready')
  assert.equal(colourFromPct(95, true), 'understand', 'with notes it is at most 🟡')
})

test('review dates: 🔴 +1 · 🟡 +3 · 🟢 +14 · ⚪ +7 after last done; never done = no review', () => {
  const last = '2026-10-19'
  assert.equal(nextReview({ lastDone: last, status: 'not_secure' }), '2026-10-20')
  assert.equal(nextReview({ lastDone: last, status: 'understand' }), '2026-10-22')
  assert.equal(nextReview({ lastDone: last, status: 'exam_ready' }), '2026-11-02')
  assert.equal(nextReview({ lastDone: last, status: 'not_started' }), '2026-10-26')
  assert.equal(nextReview({ lastDone: null, status: 'understand' }), null)
  assert.deepEqual(DEFAULT_REVIEW_DAYS, { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 })
})

test('due on the review date and after it, not before; editable gaps are used', () => {
  const t = { lastDone: '2026-10-19', status: 'understand' }
  assert.equal(isDue(t, '2026-10-21'), false)
  assert.equal(isDue(t, '2026-10-22'), true)
  assert.equal(isDue(t, '2026-10-30'), true)
  assert.equal(isDue(t, '2026-10-21', { ...DEFAULT_REVIEW_DAYS, understand: 2 }), true)
  assert.equal(isDue({ lastDone: null, status: 'not_secure' }, '2026-12-01'), false)
})

test('taught / next up (≤ 21 days) / later; physics "Taught?" wins over the date', () => {
  const today = '2026-10-19'
  assert.equal(taughtState({ taughtFrom: '2026-09-01', taught: null }, today), 'taught')
  assert.equal(taughtState({ taughtFrom: today, taught: null }, today), 'taught')
  assert.equal(taughtState({ taughtFrom: '2026-11-02', taught: null }, today), 'next_up')
  assert.equal(taughtState({ taughtFrom: '2026-11-09', taught: null }, today), 'next_up', '21 days ahead is still next up')
  assert.equal(taughtState({ taughtFrom: '2026-11-10', taught: null }, today), 'later')
  assert.equal(taughtState({ taughtFrom: null, taught: null }, today), 'later')
  assert.equal(taughtState({ taughtFrom: null, taught: 'in_class' }, today), 'taught')
  assert.equal(taughtState({ taughtFrom: null, taught: 'yes' }, today), 'taught')
  assert.equal(taughtState({ taughtFrom: null, taught: 'not_yet' }, today), 'later')
})

test('mistakes: redo 3 days after logging, then ~1 week after the first redo, then done', () => {
  assert.equal(firstRedo('2026-10-17'), '2026-10-20')
  assert.deepEqual(afterRedo(0, '2026-10-20'), { stage: 1, reviewOn: '2026-10-27' })
  assert.deepEqual(afterRedo(1, '2026-10-27'), { stage: 2, reviewOn: null })
  assert.equal(parseMistakeKind('Knowledge'), 'knowledge')
  assert.equal(parseMistakeKind('careless slip'), 'careless')
  assert.equal(parseMistakeKind('ran out of time'), 'time')
})

test('pipeline steps only move forward; the Integral needs ≥ 85 %', () => {
  assert.equal(stepAfter(0, 'textbook'), 1)
  assert.equal(stepAfter(1, 'exercise'), 2)
  assert.equal(stepAfter(2, 'mixed'), 3)
  assert.equal(stepAfter(3, 'bicen'), 4)
  assert.equal(stepAfter(4, 'integral', 84), 4)
  assert.equal(stepAfter(4, 'integral', 85), 5)
  assert.equal(stepAfter(5, 'textbook'), 5, 'never back')
  assert.equal(stepAfter(5, 'stretch'), 6)
})

// ---- temporary rules -----------------------------------------------------------

test('a rule is live only from starts_on to ends_on (inclusive), then it simply stops counting', () => {
  const r = rule({ kind: 'pause', target: 'ahead', startsOn: '2026-10-19', endsOn: '2026-10-25' })
  assert.equal(isLive(r, '2026-10-18'), false)
  assert.equal(isLive(r, '2026-10-19'), true)
  assert.equal(isLive(r, '2026-10-25'), true)
  assert.equal(isLive(r, '2026-10-26'), false)
  const later = rule({ id: 'r2', kind: 'boost', target: 'act', startsOn: '2026-10-26', endsOn: '2026-11-01' })
  assert.deepEqual(liveRules([r, later], '2026-10-22').map((x) => x.id), [r.id])
  assert.deepEqual(liveRules([r, later], '2026-10-27').map((x) => x.id), ['r2'])
  assert.deepEqual(liveRules([r, later], '2026-11-02'), [])
})

test('rule targets: act, ahead, stretch, reviews (+ redos), physics, maths = Maths + FM, subject:, subjects:, programme:, topic:', () => {
  assert.ok(targetMatches('act', pick({ subject: 'ACT', kind: 'act', key: 'act:english:timed' })))
  assert.ok(targetMatches('act', pick({ subject: null, kind: 'flashcards', key: 'act:flashcards' })))
  assert.ok(!targetMatches('act', pick({})))
  assert.ok(targetMatches('ahead', pick({ kind: 'ahead' })))
  assert.ok(!targetMatches('ahead', pick({ kind: 'current' })))
  assert.ok(targetMatches('stretch', pick({ kind: 'stretch' })))
  assert.ok(targetMatches('reviews', pick({ kind: 'review' })))
  assert.ok(targetMatches('reviews', pick({ kind: 'mistake_redo' })))
  assert.ok(targetMatches('tests', pick({ kind: 'test_timed' })))
  assert.ok(targetMatches('tests', pick({ kind: 'consolidation' })))
  assert.ok(targetMatches('physics', pick({ subject: 'Physics' })))
  assert.ok(!targetMatches('physics', pick({ subject: 'Maths' })))
  assert.ok(targetMatches('maths', pick({ subject: 'Further Maths' })), '"maths" = Maths + Further Maths')
  assert.ok(targetMatches('subject:Maths', pick({ subject: 'Further Maths' })))
  assert.ok(targetMatches('subject:Further Maths', pick({ subject: 'Further Maths' })))
  assert.ok(!targetMatches('subject:Further Maths', pick({ subject: 'Maths' })))
  assert.ok(targetMatches('subjects:Maths,Physics', pick({ subject: 'Physics' })))
  assert.ok(targetMatches('subjects:Maths,Physics', pick({ subject: 'Further Maths' })))
  assert.ok(!targetMatches('subjects:Maths,Physics', pick({ subject: 'ACT', kind: 'act', key: 'act:x' })))
  assert.ok(targetMatches('programme:STEP', pick({ kind: 'programme' }), { programme: 'STEP' }))
  assert.ok(targetMatches('programme:step', pick({ kind: 'programme' }), { programme: 'STEP Support' }))
  assert.ok(!targetMatches('programme:STEP', pick({ kind: 'programme' }), { programme: 'College Panda' }))
  assert.ok(targetMatches('topic:PC1-03', pick({}), { code: 'PC1-03' }))
  assert.ok(!targetMatches('nonsense', pick({})))
  assert.ok(subjectCovers('fm', 'Further Maths'))
})

test('homework is never paused, boosted or capped', () => {
  const hw = pick({ kind: 'homework', subject: 'Maths', key: 'task:1' })
  for (const target of ['maths', 'subject:Maths', 'subjects:Maths,Physics', 'reviews', 'tests']) assert.equal(targetMatches(target, hw), false, target)
})

test('pausedBy / boostedBy / capRules pick the right live rules', () => {
  const rules = [
    rule({ id: 'p', kind: 'pause', target: 'ahead' }),
    rule({ id: 'b', kind: 'boost', target: 'act' }),
    rule({ id: 'c', kind: 'cap', target: 'subjects:Maths,Further Maths,Physics', minutes: 45 }),
    rule({ id: 'n', kind: 'note', target: 'act' }),
  ]
  assert.equal(pausedBy(rules, pick({ kind: 'ahead' }))?.id, 'p')
  assert.equal(pausedBy(rules, pick({ kind: 'review' })), null)
  assert.equal(boostedBy(rules, pick({ subject: 'ACT', kind: 'act', key: 'act:e' }))?.id, 'b')
  assert.equal(boostedBy(rules, pick({ kind: 'ahead' })), null)
  assert.deepEqual(capRules(rules).map((r) => r.id), ['c'])
  assert.ok(programmeBoosted([rule({ kind: 'boost', target: 'programme:Critical Reader' })], 'Critical Reader 5th ed'))
  assert.ok(!programmeBoosted([rule({ kind: 'boost', target: 'act' })], 'Critical Reader'))
  assert.ok(!programmeBoosted([rule({ kind: 'boost', target: 'programme:' })], 'STEP'), 'an empty target name boosts nothing')
  assert.ok(!programmeBoosted([rule({ kind: 'boost', target: 'programme:STEP' })], ''), 'an empty programme name is never boosted')
})

test('rule lines: "paused: getting ahead until Sun 25 Oct", "top priority: ACT …", "cap: … 45 min/day …"', () => {
  assert.equal(ruleNote(rule({ kind: 'pause', target: 'ahead', endsOn: '2026-10-25' })), 'paused: getting ahead until Sun 25 Oct')
  assert.equal(ruleNote(rule({ kind: 'boost', target: 'act', endsOn: '2026-10-25' })), 'top priority: ACT until Sun 25 Oct')
  assert.equal(ruleNote(rule({ kind: 'cap', target: 'subjects:Maths,Further Maths,Physics', minutes: 45, endsOn: '2026-10-25' })), 'cap: Maths + Further Maths + Physics 45 min/day until Sun 25 Oct')
  assert.equal(ruleNote(rule({ kind: 'note', target: 'act', words: 'ACT mock on Saturday', endsOn: '2026-10-25' })), 'ACT mock on Saturday (until Sun 25 Oct)')
  assert.equal(targetLabel('programme:STEP'), 'STEP')
  assert.equal(targetLabel('subject:Physics'), 'Physics')
})
