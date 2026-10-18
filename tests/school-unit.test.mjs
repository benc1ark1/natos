// School as one line in the week/day views: both calendars' School merged, lessons hidden, only free periods,
// break and lunch shown (plain tests, no database). Nat's real timetable shape (Mon 12 + Tue 13 Oct 2026).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/school-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixedFreePeriods, schoolDays, withSchool } from '../lib/school.ts'
import { freeDays, planningSettings, DEFAULT_PLANNING } from '../lib/freetime.ts'
import { parseSetting } from '../lib/settings.ts'
import { dayItems, itemLine } from '../lib/day.ts'

let n = 0
const ev = (title, date, start, end, more = {}) => ({
  id: `e${++n}`, title, category_id: null, subject_id: null, location: null,
  starts_at: `${date}T${start}:00+01:00`, ends_at: `${date}T${end}:00+01:00`,
  repeat_days: null, start_time: null, end_time: null, repeat_from: null, repeat_until: null,
  is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, is_school: null, external_source: 'google', calendar_id: 'ucs', ...more,
})
const MINE = { calendar_id: 'me@gmail' }
const events = [
  { ...ev('School', '2026-10-12', '08:45', '08:46'), id: 'manual', starts_at: null, ends_at: null, repeat_days: [1, 2, 3, 4, 5], start_time: '08:45:00', end_time: '16:00:00', external_source: 'manual', calendar_id: null },
  ev('School', '2026-10-12', '08:45', '16:15'), ev('School', '2026-10-12', '08:45', '16:00', MINE),
  ev('Maths Further', '2026-10-12', '09:10', '09:40'), ev('Maths Further', '2026-10-12', '09:45', '10:15'),
  ev('Private Study', '2026-10-12', '10:35', '11:05'), ev('Private Study', '2026-10-12', '11:10', '11:40'),
  ev('Physics', '2026-10-12', '14:55', '15:25'), ev('Physics', '2026-10-12', '15:30', '16:00'),
  ev('Dentist', '2026-10-12', '11:00', '11:30', MINE),
  ev('School', '2026-10-13', '08:45', '16:15'), ev('School', '2026-10-13', '08:45', '16:00', MINE),
  ev('Private Study', '2026-10-13', '09:10', '09:40'), ev('Private Study', '2026-10-13', '09:45', '10:15'),
  ev('Physics', '2026-10-13', '10:35', '11:05'), ev('Physics', '2026-10-13', '11:10', '11:40'),
  ev('Maths Further', '2026-10-13', '11:45', '12:15'), ev('Maths Further', '2026-10-13', '12:20', '12:50'),
  ev('Bios', '2026-10-13', '14:20', '14:50'), ev('Maths Further', '2026-10-13', '14:55', '15:25'), ev('Maths Further', '2026-10-13', '15:30', '16:00'),
]

test('School blocks from both calendars (and his own) merge into one; lessons are hidden', () => {
  const m = schoolDays(events, [], '2026-10-12', '2026-10-13')
  const mon = m.get('2026-10-12')
  assert.equal(mon.start, '08:45'); assert.equal(mon.end, '16:15')
  const shown = events.filter((e) => ![...mon.hidden].some((k) => k.startsWith(e.id + '2026-10-12')) && e.starts_at?.startsWith('2026-10-12'))
  assert.deepEqual(shown.map((e) => e.title), ['Dentist'])   // his own calendar's events stay
})

test('only free periods are shown (no break or lunch), on period times', () => {
  const m = schoolDays(events, [], '2026-10-12', '2026-10-13')
  const words = (d) => m.get(d).windows.map((w) => `${w.start}–${w.end} ${w.label}`)
  assert.deepEqual(words('2026-10-12'), ['10:35–12:50 Free', '14:20–14:50 Free'])
  assert.deepEqual(words('2026-10-13'), ['09:10–10:15 Free'])
})

test('one School line, with anything planned in school hours under its window', () => {
  const sd = schoolDays(events, [], '2026-10-12', '2026-10-12').get('2026-10-12')
  const lines = withSchool(sd, [{ at: '11:00', line: '11:00 Dentist' }, { at: '17:30', line: '17:30 CS tutor' }, { at: '07:00', line: '07:00 Gym' }])
  assert.deepEqual(lines, ['07:00 Gym', '🏫 School 08:45–16:15', '  10:35–12:50 🆓 Free', '    11:00 Dentist', '  14:20–14:50 🆓 Free', '17:30 CS tutor'])
})

test('the day plan shows School once and no lessons', () => {
  const items = dayItems({ date: '2026-10-13', events, changes: [], travel: null, shape: null, blocks: [], planning: {}, bufferMin: 10 })
  const text = items.map((it) => itemLine(it, (s) => s))
  assert.equal(text.filter((l) => /School/.test(l)).length, 1)
  assert.ok(!text.some((l) => /Physics|Maths|Bios|Private Study/.test(l)), text.join('\n'))
  assert.ok(text.includes('   09:10–10:15 🆓 Free'), text.join('\n'))
  assert.ok(!text.some((l) => /Lunch|Break/.test(l)))
})

test('no lessons (only his own School event): one line, no windows', () => {
  const m = schoolDays([events[0]], [], '2026-10-12', '2026-10-12')
  assert.deepEqual(m.get('2026-10-12').windows, [])
  assert.equal(m.get('2026-10-12').end, '16:00')
})

test('his free periods every week (setting) replace the timetable ones, every week, even with no lessons in Google', () => {
  const FREE = 'mon 11:40-12:50, tue 09:10-10:15, thu 14:20-14:50, fri 09:10-10:15'
  assert.equal(fixedFreePeriods('mon 11:40 - 12:50, tuesday 9:10-10:15').get(2)[0].start, '09:10')
  assert.equal(fixedFreePeriods('mon 12:50-11:40'), null)
  assert.equal(parseSetting('schoolFreePeriods', FREE, {}), FREE)
  assert.equal(parseSetting('schoolFreePeriods', 'mondays sometimes', {}), null)
  // next week: only his own repeating School block, no lessons from the school calendar
  const m = schoolDays(events, [], '2026-10-19', '2026-10-23', FREE)
  assert.deepEqual(m.get('2026-10-19').windows.map((w) => `${w.start}-${w.end}`), ['11:40-12:50'])
  assert.deepEqual(m.get('2026-10-21').windows, [])
  assert.deepEqual(m.get('2026-10-23').windows.map((w) => `${w.start}-${w.end}`), ['09:10-10:15'])
  const s = { ...planningSettings({ leaveSchoolAt: '16:05', schoolFreePeriods: FREE }) }
  const [thu] = freeDays(events, [], '2026-10-22', '2026-10-22', s, '2026-10-13', 0, null, { freePeriods: true })
  assert.ok(thu.slots.some((x) => x.start === '14:20' && x.end === '14:50'), 'study can use it')
  assert.ok(!freeDays(events, [], '2026-10-22', '2026-10-22', s, '2026-10-13', 0)[0].slots.some((x) => x.start === '14:20'), 'never for training')
  assert.equal(DEFAULT_PLANNING.schoolFreePeriods, undefined)
})
