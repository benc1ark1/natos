// Jarvis phase C2, plain tests: checking proposed changes to events, tests and goals. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkActions } from '../lib/telegram/actions.ts'

const TODAY = '2026-10-10'   // Saturday
const ev = (o) => ({
  id: o.title, title: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null,
  start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null,
  archived_at: null, external_source: 'manual', ...o,
})
const events = [
  ev({ title: 'Owen training', repeat_days: [2], start_time: '18:00:00', end_time: '19:30:00', travel_minutes: 20 }),
  ev({ title: 'Match', starts_at: '2026-10-17T09:00:00Z', ends_at: '2026-10-17T10:30:00Z' }),
  ev({ title: 'CS tutor', repeat_days: [1], start_time: '17:00:00', end_time: '18:00:00' }),
  ev({ title: 'Lessons', repeat_days: [1, 2, 3, 4, 5], start_time: '08:40:00', end_time: '15:30:00', external_source: 'google' }),
]
const goals = [
  { id: 'g1', title: 'Physics test', kind: 'test', target_date: '2026-10-15', topics: 'forces', archived_at: null, priority: 'high', subject_id: null, project_id: null, created_at: '' },
  { id: 'g2', title: 'SMC', kind: 'goal', target_date: null, topics: null, archived_at: null, priority: 'normal', subject_id: null, project_id: null, created_at: '' },
]
const refs = new Map([
  ...events.map((e, i) => [`E${i + 1}`, { kind: 'event', id: e.id, title: e.title }]),
  ['G1', { kind: 'goal', id: 'g1', title: 'Physics test' }], ['G2', { kind: 'goal', id: 'g2', title: 'SMC' }],
])
const ctx = { today: TODAY, weekStart: '2026-10-05', snapshot: '', refs }
const rows = { tasks: new Map(), reminders: new Map(), projects: new Map(), targets: new Map(), events: new Map(events.map((e) => [e.id, e])), changes: [], goals: new Map(goals.map((g) => [g.id, g])) }
const act = (o) => ({ op: 'event_move', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const check = (raw, said) => checkActions(raw, ctx, rows, said, TODAY)

test('"Owen moved training to Thursday 6pm this week": a one-week change, the usual session kept, length kept', () => {
  const { actions, problems } = check([act({ ref: 'E1', date_to: '2026-10-15', time: '18:00', words: 'Thursday 6pm' })], 'Owen moved training to Thursday 6pm this week')
  assert.deepEqual(problems, [])
  const a = actions[0]
  assert.equal(a.table, 'event_exceptions')
  assert.equal(a.usualDate, '2026-10-13', 'the session that normally happens on Tuesday')
  assert.deepEqual(a.patch, { cancelled: false, new_date: '2026-10-15', new_start: '18:00', new_end: '19:30' })
  assert.equal(a.line, '<b>Owen training</b>: Tue 13 Oct 18:00–19:30 → Thu 15 Oct 18:00–19:30 <i>(just this week)</i>')
  assert.match(check([act({ ref: 'E1', date_to: '2026-10-15', time: '18:00', words: 'Friday' })], 'Owen moved training').problems[0], /wasn’t in your words/)
})

test('"every week" changes the event itself; a one-off event just moves', () => {
  const every = check([act({ ref: 'E1', date_to: '2026-10-15', time: '18:00', value: 'every', words: 'Thursdays' })], 'Owen training is Thursdays from now on').actions[0]
  assert.equal(every.table, 'events')
  assert.deepEqual(every.patch, { start_time: '18:00', end_time: '19:30', repeat_days: [4] })
  const match = check([act({ ref: 'E2', time: '11:00', words: 'at 11' })], 'match is at 11 now').actions[0]
  assert.deepEqual(match.patch, { starts_at: '2026-10-17T10:00:00.000Z', ends_at: '2026-10-17T11:30:00.000Z' })
})

test('cancelling: this week only for a repeating session; a one-off event is archived (never deleted)', () => {
  const cs = check([act({ op: 'event_cancel', ref: 'E3' })], 'CS tutor is off this week').actions[0]
  assert.equal(cs.table, 'event_exceptions')
  assert.equal(cs.usualDate, '2026-10-12')
  assert.equal(cs.patch.cancelled, true)
  assert.match(cs.line, /just this week/)
  const match = check([act({ op: 'event_cancel', ref: 'E2', date: '2026-10-17' })], 'match cancelled Saturday').actions[0]
  assert.deepEqual(match.patch, { archived_at: '__now__' })
  assert.match(match.line, /archived, can be restored/)
})

test('Google calendar events are read-only', () => {
  const r = check([act({ op: 'event_cancel', ref: 'E4' })], 'no lessons this week')
  assert.equal(r.actions.length, 0)
  assert.match(r.problems[0], /on your Google calendar, so I can’t change it/)
})

test('"Dentist Tuesday 3pm": a new one-off event (1 hour unless he says); needs a day from his words and a time', () => {
  const a = check([act({ op: 'event_new', value: 'Dentist', date: '2026-10-13', time: '15:00', words: 'Tuesday 3pm' })], 'Dentist Tuesday 3pm').actions[0]
  assert.deepEqual(a.patch, { title: 'Dentist', starts_at: '2026-10-13T14:00:00.000Z', ends_at: '2026-10-13T15:00:00.000Z', is_busy: true, travel_minutes: 0 })
  assert.equal(a.line, '📅 New: <b>Dentist</b> Tue 13 Oct 15:00–16:00')
  assert.match(check([act({ op: 'event_new', value: 'Dentist', date: '2026-10-13', words: 'Tuesday' })], 'Dentist Tuesday').problems[0], /no start time/)
  assert.match(check([act({ op: 'event_new', value: 'Dentist', date: '2026-10-13', time: '15:00', words: 'Monday' })], 'Dentist Tuesday 3pm').problems[0], /no clear day/)
})

test('tests and goals: date (prep sessions re-plan), topics, archive; only real tests get a test date', () => {
  const t = check([act({ op: 'test_date', ref: 'G1', date: '2026-10-12', words: 'Monday' })], 'Physics test moved to Monday').actions[0]
  assert.deepEqual(t.patch, { target_date: '2026-10-12' })
  assert.match(t.line, /Thu 15 Oct → Mon 12 Oct <i>\(its prep sessions re-plan\)/)
  assert.match(check([act({ op: 'test_date', ref: 'G2', date: '2026-10-12', words: 'Monday' })], 'SMC moved to Monday').problems[0], /isn’t a test/)
  assert.match(check([act({ op: 'test_date', ref: 'G1', date: '2026-10-15', words: 'Thursday' })], 'test is Thursday').problems[0], /already on/)
  assert.deepEqual(check([act({ op: 'goal_topics', ref: 'G1', value: 'forces, moments' })], 'add moments').actions[0].patch, { topics: 'forces, moments' })
  assert.deepEqual(check([act({ op: 'goal_archive', ref: 'G2' })], 'archive the SMC goal').actions[0].patch, { archived_at: '__now__' })
})

test('times must make sense', () => {
  assert.match(check([act({ ref: 'E1', time: '19:00', time_to: '18:00', words: '7pm' })], 'owen at 7pm').problems[0], /end has to be after/)
  assert.match(check([act({ ref: 'E1', time: '18:00', words: '6pm' })], 'owen at 6pm').problems[0], /already then/)
  assert.match(check([act({ ref: 'E9', time: '18:00', words: '6pm' })], 'x at 6pm').problems[0], /couldn’t find that event/)
})
