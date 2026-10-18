// Build 2, phase H: plain checks (no database). Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isSchoolNight } from '../lib/freetime.ts'
import { expandEvents, gridHours } from '../lib/events.ts'
import { placeWeek, DEFAULT_RULES } from '../lib/training.ts'

const ev = (o) => ({ id: o.title, title: 'x', category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null, start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, ...o })

test('school is his answer on the event; without one, an event on 5+ weekdays is guessed to be school', () => {
  const sun = '2026-10-11', mon = '2026-10-12'
  const night = (e) => isSchoolNight(expandEvents([e], sun, mon), sun)
  assert.equal(night(ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00' })), true, 'guessed')
  assert.equal(night(ev({ title: 'Holiday camp', repeat_days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '15:00', is_school: false })), false, 'he said no')
  assert.equal(night(ev({ title: 'Sixth form (Mon only)', repeat_days: [1], start_time: '09:00', end_time: '12:00', is_school: true })), true, 'he said yes')
})

test('the calendar grid stretches to fit early and late events with their travel (08–22 otherwise)', () => {
  const occ = (start, end, travel = 0) => ({ start, end, event: { travel_minutes: travel } })
  assert.deepEqual(gridHours([occ('16:00', '17:30')]), { startH: 8, endH: 22, hours: [8, 10, 12, 14, 16, 18, 20, 22] })
  assert.equal(gridHours([occ('07:00', '08:00', 20)]).startH, 6, 'a 07:00 start with 20 min travel needs 06:40')
  assert.equal(gridHours([occ('22:00', '23:15')]).endH, 24)
})

test('gym sessions go from his usual time (trainingFrom), earlier only if nothing later fits', () => {
  const need = [{ key: 'u#1', title: 'Upper', type: 'upper', load: 'hard', minutes: 60, preferred: null }]
  const days = [{ date: '2026-10-13', slots: [{ start: '15:30', end: '16:30' }, { start: '18:00', end: '20:00' }] }]
  assert.equal(placeWeek(need, [], days, DEFAULT_RULES, '21:30').placed[0].start, '15:30', 'default 15:00: the first slot after it')
  assert.equal(placeWeek(need, [], days, DEFAULT_RULES, '21:30', '17:00').placed[0].start, '18:00', 'he trains from 17:00')
})
