// Build O: the week optimiser on realistic weeks (plain tests, no database). Nat's real week shape: school Mon–Fri
// 08:45–16:00, CS tutor Mon + Thu 17:30–18:30, maths tutor Wed 17:00–18:00, football Mon + Wed 19:00–20:30, the game
// on his usual day (Sunday) unless that week says otherwise.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/build-o-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTraining } from '../lib/week.ts'
import { planningSettings } from '../lib/freetime.ts'
import { moreSettings } from '../lib/settings.ts'
import { planningEvents, shapesFor, DEFAULT_SESSIONS } from '../lib/setup.ts'
import { mentalDays } from '../lib/mental.ts'
import { DEFAULT_RULES, DEFAULT_TYPES } from '../lib/training.ts'
import { expandEvents } from '../lib/events.ts'
import { minutesOf, addDays, isoDow } from '../lib/time.ts'

const MON = '2026-10-12'
const d = (i) => addDays(MON, i)
const ev = (o) => ({ id: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null, start_time: null, end_time: null,
  repeat_from: '2026-09-01', repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, external_source: 'manual', ...o })
const NAT = [
  ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', is_school: true }),
  ev({ title: 'CS tutor', repeat_days: [1, 4], start_time: '17:30', end_time: '18:30' }),
  ev({ title: 'Maths tutor', repeat_days: [3], start_time: '17:00', end_time: '18:00' }),
  ev({ title: 'Football training', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', training_type: 'football', load: 'hard' }),
]
const target = (name, n) => ({ id: `t-${name}`, name, target_count: n, counts_from: 'logs', is_active: true, activity_type: null, subject_id: null, bonus_count: null, sync_source: 'manual', sort_order: 0 })

/** A week world like the bot's loadWorld, for Mon–Sun with `today`. */
function world({ planning = {}, events = NAT, changes = [], goals = [], tasks = [], today = MON, whoop = null, energy = new Map(), tiredWhy, logs = [] } = {}) {
  const evs = planningEvents(events, changes, planning, addDays(MON, -7), addDays(MON, 13))
  const shapes = shapesFor(planning, evs, changes, goals, addDays(MON, -1), addDays(MON, 7))
  const settings = { ...planningSettings(planning), dayBounds: (x) => { const s = shapes.get(x); return s ? { start: s.morningEnd, end: s.nightStart } : null } }
  return {
    today, nowMin: 7 * 60, from: today, to: d(6), settings, events: evs, changes, targets: [target('Upper', 3), target('Lower + plyo', 2), target('SMC', 3)], logs, weekCounts: [],
    rules: DEFAULT_RULES, energy, planned: [], travel: null, types: DEFAULT_TYPES, trainingFrom: '15:00', costs: [], load: moreSettings(planning), whoop, tiredWhy,
    planning, mental: mentalDays({ from: addDays(today, -1), to: d(6), planning, events: evs, changes, goals, tasks, blocks: [] }), done: [],
  }
}

const busyOn = (w, date) => expandEvents(w.events, date, date, w.changes).filter((o) => o.date === date && !o.cancelled && o.event.is_busy && o.start)
/** Checks every plan must pass: no clash with busy time (travel and buffer included), heavy before 21:30, routines kept,
 *  Friday evening free and Friday light, nothing on the game day, a reason for each session. */
function sane(w, p, label) {
  for (const s of p.placed) {
    const a = minutesOf(s.start) - (s.before ?? 0), b = minutesOf(s.end) + (s.after ?? 0)
    for (const o of busyOn(w, s.date)) {
      const x = minutesOf(o.start) - w.settings.bufferMin, y = minutesOf(o.end ?? o.start) + w.settings.bufferMin
      assert.ok(b <= x || a >= y, `${label}: ${s.title} ${s.date} ${s.start}–${s.end} (with travel) clashes with ${o.event.title}`)
    }
    const shape = w.settings.dayBounds(s.date)
    assert.ok(minutesOf(s.start) - (s.before ?? 0) >= minutesOf(shape.start) && minutesOf(s.end) + (s.after ?? 0) <= minutesOf(shape.end), `${label}: ${s.title} inside the routines`)
    if (s.intensity === 'heavy') assert.ok(minutesOf(s.end) <= minutesOf('21:30'), `${label}: heavy ${s.title} ends by 21:30`)
    if (isoDow(s.date) === 5) {
      assert.ok(minutesOf(s.end) + (s.after ?? 0) <= minutesOf('18:00'), `${label}: Friday evening stays free (${s.title})`)
      assert.equal(s.intensity, 'light', `${label}: only light on Friday (${s.title})`)
    }
    assert.ok(s.why && s.why.length > 5, `${label}: ${s.title} has a reason`)
  }
  // nothing overlaps anything else he's doing that day
  for (const date of new Set(p.placed.map((s) => s.date))) {
    const list = p.placed.filter((s) => s.date === date).map((s) => [minutesOf(s.start) - (s.before ?? 0), minutesOf(s.end) + (s.after ?? 0), s.title]).sort((a, b) => a[0] - b[0])
    for (let i = 1; i < list.length; i++) assert.ok(list[i][0] >= list[i - 1][1], `${label}: ${list[i - 1][2]} and ${list[i][2]} overlap on ${date}`)
  }
}
const one = (p, key) => p.placed.find((s) => s.key.startsWith(`${key}#`))
const gap = (a, b) => Math.abs(Date.parse(`${a.date}T${a.start}:00Z`) - Date.parse(`${b.date}T${b.start}:00Z`)) / 3_600_000

test('O: a Sunday-game week: every session placed with a place and a reason, heavy lower and speed apart, the game protected, Friday light, deterministic', () => {
  const w = world()
  const t0 = Date.now()
  const p = planTraining(w)
  const ms = Date.now() - t0
  if (process.env.SHOW) console.log(ms, 'ms\n', p.placed.map((s) => `${s.date} ${s.start}-${s.end} ${s.title} @ ${s.label} ${s.intensity} | ${s.why}`).join('\n'), '\n', p.upper, '\n', p.compare, '\n', p.tbc)
  assert.ok(ms < 15000, `fast enough (${ms} ms)`)
  sane(w, p, 'sunday')
  const lower = one(p, 'heavy_lower'), speed = one(p, 'speed')
  assert.ok(lower && speed, 'heavy lower and speed are both placed')
  assert.notEqual(lower.date, speed.date, 'not the same day')
  assert.ok(gap(lower, speed) >= 36, 'heavy lower and speed not back to back')
  assert.notEqual(lower.date, d(5), 'no heavy lower the day before the Sunday game')
  assert.ok(['school_gym', 'puregym'].includes(lower.place), 'heavy lower where there is a barbell and a rack')
  assert.equal(one(p, 'core').place, 'home')
  assert.ok(p.placed.filter((s) => s.key.startsWith('stretch#')).length >= 2, 'at least two stretching units')
  assert.ok(p.upper && [2, 3].includes(p.upper.count) && p.upper.reason.length > 10, 'upper 2× or 3× with a reason')
  assert.equal(p.placed.filter((s) => s.type === 'upper').length, p.upper.count)
  assert.ok(p.compare, 'a comparison with Owen’s current days')
  assert.ok(!p.placed.some((s) => s.date === d(6) && s.intensity !== 'light'), 'nothing hard on game day')
  // the same input always gives the same week
  const again = planTraining(world())
  assert.deepEqual(again.placed.map((s) => [s.key, s.date, s.start, s.place, s.intensity]), p.placed.map((s) => [s.key, s.date, s.start, s.place, s.intensity]))
})

test('O: a Saturday-game week ("game is Saturday this week"): the days around Saturday are protected instead', () => {
  const w = world({ planning: { gameWeeks: { [MON]: { date: d(5), leave: '09:00', back: '15:00' } } } })
  const p = planTraining(w)
  sane(w, p, 'saturday')
  assert.ok(w.events.some((e) => e.id === `game:${d(5)}`), 'the game is Saturday')
  assert.ok(!w.events.some((e) => e.id === `game:${d(6)}`), 'not Sunday')
  const lower = one(p, 'heavy_lower')
  assert.ok(![d(4), d(5), d(6)].includes(lower.date) || lower.intensity === 'light', 'no heavy legs Fri–Sun around a Saturday game')
})

test('O: a test week: no hard training on the test eve or a high-🧠 day', () => {
  const goals = [{ kind: 'test', target_date: d(3), title: 'Physics mock' }]
  const w = world({ goals, tasks: [] })
  const eve = w.mental.find((m) => m.date === d(2))
  assert.ok(eve.testEve && eve.items.some((i) => /Physics mock tomorrow/.test(i.what)), 'Wed is the eve of the mock')
  const p = planTraining(w)
  sane(w, p, 'test')
  assert.ok(!p.placed.some((s) => s.date === d(2) && s.intensity === 'heavy'), 'nothing heavy on the test eve')
  // the night before the test is earlier
  assert.ok(minutesOf(w.settings.dayBounds(d(2)).end) < minutesOf(w.settings.dayBounds(d(1)).end), 'an earlier night before the test')
})

test('O: a low-Whoop morning: today only light; the rest of the week still gets its sessions', () => {
  const w = world({ whoop: { recovery: 22, strain: null }, energy: new Map([[MON, 'tired']]), tiredWhy: new Map([[MON, 'Whoop recovery 22%']]) })
  const p = planTraining(w)
  sane(w, p, 'whoop')
  assert.ok(!p.placed.some((s) => s.date === MON && s.intensity !== 'light'), 'only light today')
  assert.ok(one(p, 'heavy_lower') && one(p, 'speed'), 'heavy lower and speed still this week')
})

test('O: a no-football week: more room, so upper can go 3× without hurting lower or speed', () => {
  const changes = [d(0), d(2)].map((x) => ({ id: x, event_id: 'Football training', on_date: x, cancelled: true, new_date: null, new_start: null, new_end: null, missed: false }))
  const w = world({ changes })
  const p = planTraining(w)
  sane(w, p, 'no football')
  const withFootball = planTraining(world())
  assert.ok(p.upper.count >= withFootball.upper.count, 'at least as many uppers without football')
  assert.ok(p.cost <= withFootball.cost + 1, 'an easier week costs less')
})

test('O: upper 2× vs 3× is his to override; Owen’s days pin his sessions; ignored sessions and stacking work', () => {
  const p2 = planTraining(world(), { upperCount: 2 })
  assert.equal(p2.placed.filter((s) => s.type === 'upper').length, 2)
  const owen = planTraining(world({ planning: { owenDays: { speed: [2], heavy_lower: [4] } } }))
  assert.equal(one(owen, 'speed').date, d(1), 'speed on his Owen day (Tue)')
  assert.equal(one(owen, 'heavy_lower').date, d(3), 'heavy lower on his Owen day (Thu)')
  // an ignored read-only session is gone from planning; a kept one stays
  const g = [ev({ title: 'EFA training', external_source: 'google', starts_at: `${d(6)}T07:30:00Z`, ends_at: `${d(6)}T09:00:00Z` })]
  const evs = planningEvents([...NAT, ...g], [], { ignoredSessions: ['EFA training'] }, MON, d(6))
  assert.ok(!evs.some((e) => e.title === 'EFA training'))
  // core stacked onto injury prevention: one home session
  const stacked = DEFAULT_SESSIONS.map((s) => (s.key === 'core' ? { ...s, stackWith: 'injury' } : s))
  const ps = planTraining(world({ planning: { sessionTypes: stacked } }))
  assert.ok(ps.placed.some((s) => s.title === 'Injury prevention + Core'), 'one stacked session')
  assert.ok(!ps.placed.some((s) => s.title === 'Core'), 'no separate core session')
})

test('O4: a typed reply is only taken as the answer when it is one (never “game moved to Saturday, leave 9” as 9 minutes)', async () => {
  const { readAnswer } = await import('../lib/gaps.ts')
  const g = (key, options = []) => ({ key, options, question: '', why: '', guess: '', free: '' })
  const cases = [
    [g('minutes:upper'), 'game moved to Saturday, leave 9 back 3', null], [g('minutes:upper'), '45', '45'], [g('minutes:upper'), 'about an hour', '60'], [g('minutes:upper'), '1h15', '75'],
    [g('wake'), '6:50', '06:50'], [g('wake'), '7', '07:00'], [g('wake'), 'I wake at 7 usually', null], [g('bed'), '10:30pm', '22:30'],
    [g('type:games'), 'football is cancelled tomorrow', null], [g('type:games'), 'football, light', 'football light'], [g('type:games'), 'not training', 'none'],
    [g('football'), '18:00-19:30', '18:00–19:30'], [g('football'), 'football is cancelled tomorrow', null], [g('football'), '6-7:30', '18:00–19:30'],
    [g('game:2026-10-05'), 'game moved to Saturday, leave 9 back 3', 'day=6;leave=09:00;back=15:00'], [g('game:2026-10-05'), 'yes', 'usual'], [g('game:2026-10-05'), 'no game', 'none'],
  ]
  for (const [gap, text, want] of cases) assert.equal(readAnswer(gap, text), want, `${gap.key}: “${text}”`)
})
