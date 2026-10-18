// Jarvis phase B2, plain tests: the pinned "Today" message text. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPinned } from '../lib/telegram/pinned.ts'
import { DEFAULT_PLANNING } from '../lib/freetime.ts'

const ev = (o) => ({
  id: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null,
  start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, ...o,
})
const task = (o) => ({
  id: o.title, user_id: 'u', category_id: null, subject_id: null, details: null, priority: 'medium', status: 'today', due_at: null,
  is_key: false, source: 'test', source_text: null, completed_at: null, archived_at: null, created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z', importance: 'nice', window_start: null, window_end: null, window_label: null, origin: 'own',
  duration_minutes: null, postpone_count: 0, last_postponed_at: null, target_id: null, goal_id: null, is_system: false, session_no: null,
  archive_reason: null, project_id: null, hand_in: null, hand_in_url: null, needs_sorting: false, ...o,
})
const events = [
  ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00' }),
  ev({ title: 'Football', repeat_days: [4], start_time: '18:00', end_time: '19:30', travel_minutes: 25 }),
]
const at = (iso, tasks = [task({ title: 'Tidy desk' }), task({ title: 'Physics homework', importance: 'must', due_at: `${iso.slice(0, 10)}T12:00:00Z` })]) => ({
  today: iso.slice(0, 10), now: new Date(iso), settings: DEFAULT_PLANNING, events, changes: [], targets: [], logs: [], reminders: [], goals: [], projects: [], tasks,
})

test('after school: next event, leave-by as a fixed time, musts first', () => {
  const t = buildPinned(at('2026-10-15T15:30:00Z'))   // Thu 16:30 BST
  assert.match(t, /^📌 <b>Today · Thursday, 15 October/)
  assert.match(t, /⏭ <b>Next<\/b>: Football 18:00–19:30/)
  assert.match(t, /🚶 Leave by <b>17:35<\/b> for Football \(18:00; 25 min\)/)
  assert.ok(t.indexOf('Physics homework') < t.indexOf('Tidy desk'), 'musts first')
  assert.doesNotMatch(t, /▶️/)
  assert.doesNotMatch(t, /in \d+ min/, 'no countdowns, so it is not edited every 5 minutes')
})

test('during school: "Now", then what is next; past the leave time: "Leave now"', () => {
  const morning = buildPinned(at('2026-10-15T08:00:00Z'))   // 09:00
  assert.match(morning, /▶️ <b>Now<\/b>: School \(until 16:00\)/)
  assert.match(morning, /⏭ <b>Next<\/b>: Football/)
  assert.match(buildPinned(at('2026-10-15T16:40:00Z')), /🚶 <b>Leave now<\/b> for Football \(18:00; 25 min\)/)   // 17:40
})

test('evening, nothing booked: the top task is next; nothing at all says so', () => {
  assert.match(buildPinned(at('2026-10-15T19:30:00Z')), /⏭ <b>Next<\/b>: Physics homework/)
  const empty = buildPinned(at('2026-10-15T19:30:00Z', []))
  assert.match(empty, /Nothing else booked today/)
  assert.match(empty, /Nothing on the to-do list/)
})

test('winter time (GMT) uses London clock times too', () => {
  const t = buildPinned(at('2026-12-10T16:30:00Z'))   // Thu 10 Dec, 16:30 GMT
  assert.match(t, /Leave by <b>17:35<\/b>/)
  assert.match(t, /Thursday, 10 December/)
})

test('the same data always gives the same text (so nothing is edited needlessly)', () => {
  assert.equal(buildPinned(at('2026-10-15T15:30:00Z')), buildPinned(at('2026-10-15T15:45:00Z')))
})
