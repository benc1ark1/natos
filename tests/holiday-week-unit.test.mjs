// Half-term week of 19 Oct 2026 (his real week, 20 Oct bug): on holiday dates every school event is left out (his
// repeating School and the Google school calendar's copies: School blocks and lessons) from Your week, Today's day and
// the training planner; Owen's speed moves to its holiday day (Wed morning) instead of Tue 18:30.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/holiday-week-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holidayChanges } from '../lib/today/holidays.ts'
import { expandEvents } from '../lib/events.ts'
import { schoolDays } from '../lib/school.ts'
import { dayItems } from '../lib/day.ts'
import { planTraining } from '../lib/week.ts'
import { renderWeek } from '../lib/telegram/views.ts'
import { planningSettings } from '../lib/freetime.ts'
import { moreSettings } from '../lib/settings.ts'
import { fixedDaysFor, planningEvents, shapesFor } from '../lib/setup.ts'
import { owenChange } from '../lib/setup-edit.ts'
import { DEFAULT_RULES, DEFAULT_TYPES } from '../lib/training.ts'
import { addDays, isoDow } from '../lib/time.ts'

const MON = '2026-10-19', TUE = '2026-10-20', WED = '2026-10-21', BACK = '2026-11-02'
const ev = (o) => ({ id: o.id ?? o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null, start_time: null, end_time: null,
  repeat_from: '2026-09-01', repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, external_source: 'manual', all_day: false, ...o })
// a copy from his school's Google calendar (London is on BST until 25 Oct, GMT after)
const g = (title, date, start, end) => {
  const off = date < '2026-10-25' ? 1 : 0
  const z = (t) => { const [h, m] = t.split(':').map(Number); return `${date}T${String(h - off).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z` }
  return ev({ id: `g:${title}:${date}`, title, starts_at: z(start), ends_at: z(end), external_source: 'google', calendar_id: 'school-cal' })
}
const weekdays = (from) => [0, 1, 2, 3, 4].map((i) => addDays(from, i))
const schoolWeeks = [addDays(MON, -7), MON, addDays(MON, 7), BACK]   // the week before, half-term ×2, back to school
const EVENTS = [
  ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15' }),   // his own (school by guess)
  ev({ title: 'Football training', repeat_days: [2], start_time: '19:45', end_time: '21:00', training_type: 'football', load: 'hard' }),
  ev({ title: 'Mock exam', is_school: true, starts_at: '2026-10-22T08:00:00Z', ends_at: '2026-10-22T10:00:00Z' }),   // a one-off he added
  ...schoolWeeks.flatMap(weekdays).flatMap((d) => [g('School', d, '08:45', '16:15'), g('Maths', d, '08:45', '09:50'), g('Physics', d, '10:05', '11:10')]),
]
const PLANNING = {
  holidays: '2026-10-17..2026-11-01',
  owenDays: { speed: [2], heavy_lower: [4] }, sessionTimes: { speed: { 2: '18:30' } },
  holidayOwenDays: { speed: [3] }, holidaySessionTimes: { speed: { 3: '10:00' } },
}
const changesFor = (from, to) => holidayChanges(EVENTS, [], PLANNING, from, to)
const titlesOn = (date, ch) => expandEvents(EVENTS, date, date, ch).filter((o) => o.date === date && !o.cancelled).map((o) => o.event.title).sort()

test('half-term: every school event is off (his School and the Google copies); football and his own mock stay', () => {
  const ch = changesFor(addDays(MON, -3), addDays(BACK, 4))
  assert.deepEqual(titlesOn(TUE, ch), ['Football training'], 'Tue 20 Oct: no School, no Google School or lessons')
  assert.deepEqual(titlesOn('2026-10-22', ch), ['Mock exam'], 'a one-off he added still happens')
  assert.deepEqual(titlesOn('2026-10-16', ch), ['Maths', 'Physics', 'School', 'School'], 'the Friday before: school as usual')
  assert.deepEqual(titlesOn(BACK, ch), ['Maths', 'Physics', 'School', 'School'], 'back to school on 2 Nov')
  assert.equal(schoolDays(EVENTS, ch, MON, addDays(MON, 13)).size, 0, 'no 🏫 School line on any half-term day')
  assert.equal(schoolDays(EVENTS, ch, BACK, BACK).get(BACK)?.start, '08:45')
})

test('Today on Tue 20 Oct: no 🏫 School 08:45–16:15 item (nothing is planned around school hours)', () => {
  const ch = changesFor(addDays(TUE, -1), addDays(TUE, 1))
  const items = dayItems({ date: TUE, events: EVENTS, changes: ch, travel: null, shape: null, blocks: [], planning: PLANNING, bufferMin: 10 })
  assert.ok(!items.some((it) => it.kind === 'school' || /School|Maths|Physics/.test(it.title)), items.map((i) => i.title).join(', '))
  assert.ok(items.some((it) => it.title === 'Football training'))
})

test('Your week from Tue 20 Oct: no school line on any half-term day', () => {
  const ch = changesFor(addDays(MON, -7), addDays(TUE, 28))
  const { html } = renderWeek({ today: TUE, events: EVENTS, changes: ch, tasks: [], goals: [], targets: [], logs: [], weekCounts: [], settings: planningSettings(PLANNING) })
  assert.ok(!/🏫 School|School lessons|Maths|Physics/.test(html), html)
  assert.match(html, /19:45–21:00 Football training/)
})

/** The bot's week world (like build-o-unit's), with the holiday changes loadDay adds. */
function world(planning, today = MON) {
  const ch = holidayChanges(EVENTS, [], planning, addDays(MON, -7), addDays(MON, 13))
  const evs = planningEvents(EVENTS, ch, planning, addDays(MON, -7), addDays(MON, 13))
  const shapes = shapesFor(planning, evs, ch, [], addDays(MON, -1), addDays(MON, 7))
  const settings = { ...planningSettings(planning), dayBounds: (x) => { const s = shapes.get(x); return s ? { start: s.morningEnd, end: s.nightStart } : null } }
  return { today, nowMin: 7 * 60, from: today, to: addDays(MON, 6), settings, events: evs, changes: ch, targets: [], logs: [], weekCounts: [], rules: DEFAULT_RULES,
    energy: new Map(), planned: [], travel: null, types: DEFAULT_TYPES, trainingFrom: '15:00', costs: [], load: moreSettings(planning), planning, mental: [], done: [] }
}
const one = (p, key) => p.placed.find((s) => s.key.startsWith(`${key}#`))

test('training planner in half-term: nothing in school hours; Owen’s speed is Wed 10:00 (its holiday day), not Tue 18:30', () => {
  const p = planTraining(world(PLANNING))
  const speed = one(p, 'speed')
  assert.ok(speed, 'speed is placed')
  assert.equal(speed.date, WED)
  assert.equal(speed.start, '10:00')
  // weekday daytime is free in half-term: a session between 08:45 and 16:15 is fine now
  assert.ok(p.placed.some((s) => isoDow(s.date) <= 5 && s.start >= '08:45' && s.start < '16:15'), 'planned in what were school hours')
  // without holiday days set: his usual Owen day, even in half-term
  assert.equal(one(planTraining(world({ ...PLANNING, holidayOwenDays: null, holidaySessionTimes: null })), 'speed').date, TUE)
})

test('holiday days: only in a holiday week; the bot saves them with owen_days holiday=yes', () => {
  assert.deepEqual(fixedDaysFor(PLANNING, true), { days: { speed: [3], heavy_lower: [4] }, times: { speed: { 3: '10:00' } } })
  assert.deepEqual(fixedDaysFor(PLANNING, false), { days: { speed: [2], heavy_lower: [4] }, times: { speed: { 2: '18:30' } } })
  const r = owenChange('holiday=yes; speed=wed 10:00', { owenDays: { speed: [2] } })
  assert.deepEqual(r.change.patch, { holidayOwenDays: { speed: [3] }, holidaySessionTimes: { speed: { 3: '10:00' } } })
  assert.match(r.change.line, /In the holidays: <b>Speed \+ circuits Wed 10:00<\/b>/)
  assert.deepEqual(owenChange('holiday=yes; clear=yes', PLANNING).change.patch, { holidayOwenDays: null, holidaySessionTimes: null })
  assert.deepEqual(owenChange('speed=tue 18:30', PLANNING).change.patch.owenDays, { speed: [2], heavy_lower: [4] }, 'the usual days still save as before')
})
