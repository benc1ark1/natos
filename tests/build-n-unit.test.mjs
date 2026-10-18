// Build 2 phase N: load-based training planner (lib/load.ts). Plain tests, no database.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/build-n-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planLoad, costOf, dayLoads, levelWord, matchTarget, guessPlaceable } from '../lib/load.ts'
import { DEFAULT_MORE } from '../lib/settings.ts'
import { DEFAULT_TYPES } from '../lib/training.ts'

const MON = '2026-10-12'
const d = (i) => new Date(Date.parse(`${MON}T12:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
const ls = DEFAULT_MORE
const fixed = (key, title, type, i, start, intensity = 'heavy') => ({ key, title, type, intensity, date: d(i), start, end: start.replace(/^(\d\d)/, (h) => String(+h + 1).padStart(2, '0')), fixed: true, cost: costOf({ title, type, intensity, date: d(i) }, [], DEFAULT_TYPES, ls) })
const world = (o = {}) => ({
  from: MON, to: d(6), today: MON, rooms: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ date: d(i), slots: [{ start: '15:30', end: '21:00' }] })),
  fixed: [fixed('f1', 'Football training', 'football', 0, '18:00'), fixed('f2', 'Football training', 'football', 2, '18:00'), fixed('g', 'Match', 'match', 5, '10:00')],
  rules: [], settings: ls, costs: [], types: DEFAULT_TYPES, heavyUntil: '21:30', trainingFrom: '15:00', ...o,
})
const needs = [
  { key: 'u1', title: 'Upper', type: 'upper', intensity: 'heavy', minutes: 60 }, { key: 'u2', title: 'Upper', type: 'upper', intensity: 'heavy', minutes: 60 },
  { key: 'l1', title: 'Lower + plyo', type: 'lower', intensity: 'heavy', minutes: 60 }, { key: 'l2', title: 'Lower + plyo', type: 'lower', intensity: 'heavy', minutes: 60 },
]

test('N: sessions are placed by load: no heavy legs the day before or after the game, 48 h between leg sessions, upper and lower apart, a reason each', () => {
  const t0 = Date.now()
  const p = planLoad(needs, world())
  assert.ok(Date.now() - t0 < 3000, `fast enough (${Date.now() - t0} ms)`)
  assert.equal(p.tbc.length, 0)
  const legs = p.placed.filter((x) => x.type === 'lower')
  for (const s of legs) {
    assert.ok(!(s.date === d(4) && s.intensity !== 'light'), 'no heavy legs the day before the game')
    assert.ok(s.date !== d(6) || s.intensity === 'light', 'nor the day after')
  }
  const [a, b] = legs.map((x) => Date.parse(`${x.date}T${x.start}:00Z`)).sort()
  assert.ok((b - a) / 3_600_000 >= 48, '48 h between leg sessions')
  const upperDays = new Set(p.placed.filter((x) => x.type === 'upper').map((x) => x.date))
  assert.ok(legs.every((x) => !upperDays.has(x.date)), 'upper and lower on separate days')
  assert.ok(p.placed.every((x) => x.why.length > 5), 'each has a reason')
  assert.equal(p.days.length, 7)
  assert.equal(p.days[5].level, 'high', 'game day is high')
})

test('N: light lower is fine the day before a game when that is the only room; heavy is not', () => {
  // only Friday is free
  const rooms = [{ date: d(4), slots: [{ start: '16:00', end: '20:00' }] }]
  const p = planLoad([needs[2]], world({ rooms }))
  assert.equal(p.placed[0].date, d(4))
  assert.equal(p.placed[0].intensity, 'light')
  assert.match(p.placed[0].why, /light, not heavy: the day before Match/)
})

test('N: a low-recovery day gets only light work; his own costs and pins are used; words become levels', () => {
  const p = planLoad([needs[0]], world({ rooms: [{ date: MON, slots: [{ start: '16:00', end: '20:00' }] }, { date: d(3), slots: [{ start: '16:00', end: '20:00' }] }], tired: new Map([[MON, 'Whoop recovery 20%']]), whoop: { recovery: 20, strain: 5 } }))
  assert.equal(p.placed[0].date, d(3), 'moved off the low-recovery day')
  assert.match(p.notes.join(' '), /Whoop recovery 20% today: Football training/)
  // "Wednesday training is high CNS": his number wins on Wednesdays only
  const costs = [{ scope: 'session', type_key: null, title: 'Football training', weekday: 3, legs: 7, upper: 1, cns: 9 }]
  assert.equal(costOf({ title: 'Football training', type: 'football', intensity: 'heavy', date: d(2) }, costs, DEFAULT_TYPES, ls).cns, 9)
  assert.equal(costOf({ title: 'Football training', type: 'football', intensity: 'heavy', date: d(0) }, costs, DEFAULT_TYPES, ls).cns, 7)
  // he moved it himself: kept, even on a worse day
  const pinned = planLoad([needs[2]], world({ pins: new Map([['l1', { date: d(4), intensity: 'heavy' }]]) }))
  assert.equal(pinned.placed[0].date, d(4))
  assert.match(pinned.placed[0].why, /⚠️/)
  assert.equal(levelWord('max'), 10); assert.equal(levelWord('high'), 8); assert.equal(levelWord('low'), 2)
  assert.equal(matchTarget('Owen lower/plyo', [{ id: 'u', name: 'Upper' }, { id: 'l', name: 'Lower + plyo' }]).id, 'l')
  assert.equal(matchTarget('upper body', [{ id: 'u', name: 'Upper' }, { id: 'l', name: 'Lower + plyo' }]).id, 'u')
  assert.equal(guessPlaceable('Owen lower/plyo', DEFAULT_TYPES), 'lower')
  assert.equal(dayLoads([], world()).every((x) => x.level === 'rest'), true)
})
