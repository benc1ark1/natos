// The leftover split (plans/contracts.md §3.4 step 6), plain tests (no database): half-term 55 / 25 / 20, school
// 40 / 30 / 30, shares under 20 min merged on, the ahead session 45–90 min (smaller share or no candidate → fixing),
// unused minutes flow to the next share, what's still left → stretch, else free.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-leftover-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitLeftover, runShares, SPLIT, MIN_SHARE, AHEAD_MIN, AHEAD_MAX, SHARE_MAX } from '../lib/tracker/leftover.ts'

const sum = (xs) => xs.reduce((a, b) => a + b.minutes, 0)

test('half-term: 55 % ahead · 25 % fixing · 20 % old', () => {
  assert.deepEqual(SPLIT.half_term, [['ahead', 55], ['fixing', 25], ['old', 20]])
  assert.deepEqual(splitLeftover(200, 'half_term'), [{ kind: 'ahead', minutes: 110 }, { kind: 'fixing', minutes: 50 }, { kind: 'old', minutes: 40 }])
  const odd = splitLeftover(137, 'half_term')
  assert.equal(sum(odd), 137, 'integers, the sum is exact')
  assert.ok(odd.every((s) => Number.isInteger(s.minutes)))
})

test('school week: 40 % current · 30 % old · 30 % ahead', () => {
  assert.deepEqual(SPLIT.school, [['current', 40], ['old', 30], ['ahead', 30]])
  assert.deepEqual(splitLeftover(100, 'school'), [{ kind: 'current', minutes: 40 }, { kind: 'old', minutes: 30 }, { kind: 'ahead', minutes: 30 }])
})

test('a share under 20 min is merged into the next one (the last one into the one before); under 20 in all → nothing', () => {
  assert.deepEqual(splitLeftover(60, 'half_term'), [{ kind: 'ahead', minutes: 33 }, { kind: 'old', minutes: 27 }], 'fixing 15 → into old')
  assert.deepEqual(splitLeftover(30, 'half_term'), [{ kind: 'fixing', minutes: 30 }], 'ahead 17 → into fixing (24); old 6 is last → joins fixing')
  assert.deepEqual(splitLeftover(50, 'school'), [{ kind: 'current', minutes: 20 }, { kind: 'ahead', minutes: 30 }], 'old 15 → into ahead (30)')
  assert.deepEqual(splitLeftover(40, 'school'), [{ kind: 'old', minutes: 40 }], 'current 16 → into old (28); ahead 12 is last → joins old')
  for (const m of [20, 21, 33, 47, 59, 61, 99, 140, 301]) for (const mode of ['half_term', 'school']) {
    const s = splitLeftover(m, mode)
    assert.equal(sum(s), m, `${mode} ${m}`)
    assert.ok(s.every((x) => x.minutes >= MIN_SHARE), `${mode} ${m}: every share ≥ 20`)
  }
  assert.deepEqual(splitLeftover(19, 'half_term'), [])
  assert.deepEqual(splitLeftover(0, 'school'), [])
})

test('runShares: ahead 90 max (rest flows on), each share takes at most its cap, stretch gets what is still left', () => {
  const calls = []
  const r = runShares(240, 'half_term', (kind, m) => { calls.push([kind, m]); return m })
  // 240 → ahead 132 (90 used, 42 on) · fixing 60+42=102 → 60 (42 on) · old 48+42=90 → 45 (45 on) · stretch 45
  assert.deepEqual(calls, [['ahead', 90], ['fixing', 60], ['old', 45], ['stretch', 45]])
  assert.deepEqual(r.taken.map((t) => t.kind), ['ahead', 'fixing', 'old', 'stretch'])
  assert.equal(r.free, 0)
  assert.equal(AHEAD_MAX, 90)
  assert.equal(SHARE_MAX.old, 45)
})

test('no ahead candidate (or paused) → its share goes to fixing', () => {
  const calls = []
  runShares(100, 'half_term', (kind, m) => { calls.push([kind, m]); return kind === 'ahead' ? 0 : m })
  // ahead 55 → none → fixing 25+55 = 80 → 60, 20 on · old 20+20 = 40 → 40
  assert.deepEqual(calls, [['ahead', 55], ['fixing', 60], ['old', 40]])
})

test('ahead share under 45 min → no ahead session, its time goes to fixing (school weeks: fixing is added)', () => {
  const calls = []
  runShares(100, 'school', (kind, m) => { calls.push([kind, m]); return m })
  // current 40 · old 30 · ahead 30 < 45 → fixing 30
  assert.deepEqual(calls, [['current', 40], ['old', 30], ['fixing', 30]])
  assert.equal(AHEAD_MIN, 45)
  const half = []
  runShares(70, 'half_term', (kind, m) => { half.push([kind, m]); return m })
  // ahead 38.5→39 < 45 → fixing 17+39 = 56 · old 14… merged: shares ahead 39, old 31 → fixing gets 39
  assert.deepEqual(half.map((c) => c[0]), ['fixing', 'old'])
  assert.equal(half.reduce((a, c) => a + c[1], 0), 70)
})

test('unused minutes flow to the next share; a school week can still reach a 45-min ahead session that way', () => {
  const calls = []
  runShares(150, 'school', (kind, m) => { calls.push([kind, m]); return kind === 'old' ? 0 : m })
  // current 60 · old 45 → nothing → 45 on · ahead 45+45 = 90 → 90
  assert.deepEqual(calls, [['current', 60], ['old', 45], ['ahead', 90]])
})

test('nothing takes anything → all of it is free time (no stretch candidate either)', () => {
  const r = runShares(120, 'half_term', () => 0)
  assert.deepEqual(r.taken, [])
  assert.equal(r.free, 120)
})
