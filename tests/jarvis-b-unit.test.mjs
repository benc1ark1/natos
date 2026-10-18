// Jarvis phase B, plain tests (free, no database, no AI). Run: npm run test:unit
// Free time (travel, buffers, cancelled/moved sessions, clock changes, school nights), spotting list
// questions, and the instant lists themselves. Fixed dates: Sat 10 Oct 2026 is "today".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freeSlots, freeDays, busyBlocks, isSchoolNight, planningSettings, DEFAULT_PLANNING } from '../lib/freetime.ts'
import { expandEvents } from '../lib/events.ts'
import { matchView, dayFromWords, render, freeTimeForAI } from '../lib/telegram/views.ts'

const S = DEFAULT_PLANNING
const ev = (o) => ({
  id: o.id ?? o.title, title: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null,
  repeat_days: null, start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0,
  target_id: null, archived_at: null, ...o,
})
const SCHOOL = ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45:00', end_time: '16:00:00' })
const FOOTBALL = ev({ title: 'Football', repeat_days: [4], start_time: '18:00:00', end_time: '19:30:00', travel_minutes: 25 })
const change = (o) => ({ id: 'c', event_id: 'Football', on_date: '2026-10-15', cancelled: false, new_date: null, new_start: null, new_end: null, missed: false, ...o })
const slots = (events, date, changes = [], now = null) => freeSlots(expandEvents(events, date, date, changes), date, S, now).map((s) => `${s.start}-${s.end}`)

// ---------------------------------------------------------------- free time

test('busy = event + travel both ways + 10-min buffers', () => {
  // Thu 15 Oct: school 08:45–16:00, football 18:00–19:30 with 25 min travel each way
  assert.deepEqual(slots([SCHOOL, FOOTBALL], '2026-10-15'), ['07:00-08:35', '16:10-17:25', '20:05-22:30'])
  const [, , evening] = freeSlots(expandEvents([SCHOOL, FOOTBALL], '2026-10-15', '2026-10-15'), '2026-10-15', S)
  assert.equal(evening.minutes, 145)
  assert.equal(evening.heavyMinutes, 85, 'nothing heavy after 21:30')
})

test('a cancelled session frees its time; a moved one is busy where it moved to', () => {
  assert.deepEqual(slots([SCHOOL, FOOTBALL], '2026-10-15', [change({ cancelled: true })]), ['07:00-08:35', '16:10-22:30'])
  const moved = [change({ new_date: '2026-10-16', new_start: '17:00', new_end: '18:00' })]
  assert.deepEqual(slots([SCHOOL, FOOTBALL], '2026-10-15', moved), ['07:00-08:35', '16:10-22:30'], 'Thursday is free now')
  const fri = freeSlots(expandEvents([SCHOOL, FOOTBALL], '2026-10-16', '2026-10-16', moved), '2026-10-16', S).map((s) => `${s.start}-${s.end}`)
  assert.deepEqual(fri, ['07:00-08:35', '16:10-16:25', '18:35-22:30'], 'Friday has it, with its travel')
})

test('today starts from now (rounded up to 5 minutes)', () => {
  assert.deepEqual(slots([SCHOOL, FOOTBALL], '2026-10-15', [], 17 * 60 + 2), ['17:05-17:25', '20:05-22:30'])
  assert.deepEqual(slots([SCHOOL, FOOTBALL], '2026-10-15', [], 23 * 60), [], 'after the day ends: nothing')
})

test('overlaps merge; no end = 1 hour; not-busy events are ignored; all-day busy blocks the day', () => {
  const a = ev({ title: 'A', starts_at: '2026-10-10T13:00:00Z' , ends_at: '2026-10-10T15:00:00Z' })   // 14:00–16:00 BST
  const b = ev({ title: 'B', starts_at: '2026-10-10T14:00:00Z', ends_at: null })                         // 15:00, no end -> 16:00
  const c = ev({ title: 'C', starts_at: '2026-10-10T18:00:00Z', ends_at: '2026-10-10T19:00:00Z', is_busy: false })
  assert.deepEqual(slots([a, b, c], '2026-10-10'), ['07:00-13:50', '16:10-22:30'])
  const allDay = [{ key: 'x', event: ev({ title: 'Trip' }), usualDate: '2026-10-10', date: '2026-10-10', start: null, end: null, change: null, cancelled: false, moved: false, missed: false }]
  assert.deepEqual(freeSlots(allDay, '2026-10-10', S), [])
  assert.equal(busyBlocks(allDay, '2026-10-10', S).length, 1)
})

test('clock-change days: London wall-clock times stay right (BST -> GMT, GMT -> BST)', () => {
  // 25 Oct 2026, clocks go back: 17:00 UTC is 17:00 in London
  const back = ev({ title: 'Back', starts_at: '2026-10-25T17:00:00Z', ends_at: '2026-10-25T18:00:00Z' })
  assert.deepEqual(slots([back], '2026-10-25'), ['07:00-16:50', '18:10-22:30'])
  // the day before, still BST: 16:00 UTC is 17:00 in London
  const before = ev({ title: 'Before', starts_at: '2026-10-24T16:00:00Z', ends_at: '2026-10-24T17:00:00Z' })
  assert.deepEqual(slots([before], '2026-10-24'), ['07:00-16:50', '18:10-22:30'])
  // 29 Mar 2026, clocks go forward: 16:00 UTC is 17:00 in London
  const fwd = ev({ title: 'Fwd', starts_at: '2026-03-29T16:00:00Z', ends_at: '2026-03-29T17:00:00Z' })
  assert.deepEqual(slots([fwd], '2026-03-29'), ['07:00-16:50', '18:10-22:30'])
})

test('school nights: the night before a school day (unless school is cancelled)', () => {
  const occ = (changes = []) => expandEvents([SCHOOL], '2026-10-10', '2026-10-18', changes)
  assert.equal(isSchoolNight(occ(), '2026-10-11'), true, 'Sunday night')
  assert.equal(isSchoolNight(occ(), '2026-10-15'), true, 'Thursday night')
  assert.equal(isSchoolNight(occ(), '2026-10-16'), false, 'Friday night')
  assert.equal(isSchoolNight(occ(), '2026-10-10'), false, 'Saturday night')
  const noSchoolFri = [{ id: 'c', event_id: 'School', on_date: '2026-10-16', cancelled: true, new_date: null, new_start: null, new_end: null, missed: false }]
  assert.equal(isSchoolNight(occ(noSchoolFri), '2026-10-15'), false, 'school off on Friday')
  const days = freeDays([SCHOOL], [], '2026-10-11', '2026-10-11', S, '2026-10-10', 0)
  assert.equal(days[0].focusMin, 150)
})

test('settings: editable, checked, with safe defaults', () => {
  assert.deepEqual(planningSettings(null), DEFAULT_PLANNING)
  assert.deepEqual(planningSettings({ dayEnd: '22:00', bufferMin: 15 }), { ...DEFAULT_PLANNING, dayEnd: '22:00', bufferMin: 15 })
  assert.deepEqual(planningSettings({ dayEnd: '25:00', bufferMin: -5, heavyUntil: 'late' }), DEFAULT_PLANNING)
  assert.deepEqual(planningSettings({ dayStart: '23:00', dayEnd: '07:00' }), DEFAULT_PLANNING, 'an end before the start is ignored')
})

// ---------------------------------------------------------------- spotting list questions

const TODAY = '2026-10-10'   // Saturday
test('list questions are spotted word for word; anything else goes to the brain', () => {
  const v = (m) => matchView(m, TODAY)
  assert.deepEqual(v('What’s in my inbox?'), { view: 'inbox', arg: null })
  assert.deepEqual(v('show my week'), { view: 'week', arg: null })
  assert.deepEqual(v("what's coming up?"), { view: 'coming', arg: null })
  assert.deepEqual(v('When am I free tomorrow?'), { view: 'free', arg: '2026-10-11' })
  assert.deepEqual(v('when am i free on Thursday'), { view: 'free', arg: '2026-10-15' })
  assert.deepEqual(v('when am I free'), { view: 'free', arg: TODAY })
  assert.deepEqual(v('What have I been postponing?'), { view: 'postponed', arg: null })
  assert.deepEqual(v("What's next on Football comeback?"), { view: 'project', arg: 'football comeback' })
  assert.deepEqual(v('/free fri'), { view: 'free', arg: '2026-10-16' })
  assert.deepEqual(v('/next Football comeback'), { view: 'project', arg: 'football comeback' })
  assert.deepEqual(v('/today'), { view: 'today', arg: null })
  assert.deepEqual(v('today?'), { view: 'today', arg: null })
  for (const m of ['what should I do today?', 'am I free tonight to see Sam?', 'when am I free to see Sam', 'Physics homework due today',
    'inbox zero is the goal', 'what’s coming up that I might forget?', 'plan my week', 'what should I do now']) {
    assert.equal(v(m), null, m)
  }
})

test('day words -> dates (today counts)', () => {
  assert.equal(dayFromWords('tomorrow', TODAY), '2026-10-11')
  assert.equal(dayFromWords('saturday', TODAY), TODAY)
  assert.equal(dayFromWords('weds', TODAY), '2026-10-14')
  assert.equal(dayFromWords('next monday', TODAY), '2026-10-12', 'said on a Saturday: the coming Monday')
  assert.equal(dayFromWords('next monday', '2026-10-12'), '2026-10-19', 'said on a Monday: a week on')
  assert.equal(dayFromWords('someday', TODAY), null)
})

// ---------------------------------------------------------------- the lists

const task = (o) => ({
  id: o.title, user_id: 'u', category_id: null, subject_id: null, details: null, priority: 'medium', status: 'this_week', due_at: null,
  is_key: false, source: 'test', source_text: null, completed_at: null, archived_at: null, created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z', importance: 'nice', window_start: null, window_end: null, window_label: null, origin: 'own',
  duration_minutes: null, postpone_count: 0, last_postponed_at: null, target_id: null, goal_id: null, is_system: false, session_no: null,
  archive_reason: null, project_id: null, hand_in: null, hand_in_url: null, needs_sorting: false, ...o,
})
const data = (o = {}) => ({
  today: TODAY, now: new Date('2026-10-10T15:05:00Z'), settings: DEFAULT_PLANNING,
  events: [SCHOOL, FOOTBALL], changes: [], targets: [], logs: [], reminders: [],
  goals: [{ id: 'g1', title: 'Physics test', kind: 'test', target_date: '2026-10-15', archived_at: null, created_at: '', subject_id: null, topics: null, priority: 'high', project_id: null }],
  projects: [{ id: 'p1', name: 'Football comeback', category_id: null, notes: null, sort_order: 0, archived_at: null, created_at: '' }],
  tasks: [
    task({ title: 'SMC past paper', importance: 'must', due_at: '2026-10-14T12:00:00Z', postpone_count: 3, duration_minutes: 90 }),
    task({ title: 'Physics homework', importance: 'must', due_at: '2026-10-16T12:00:00Z', postpone_count: 1 }),
    task({ title: 'Old essay', importance: 'must', due_at: '2026-10-08T12:00:00Z' }),
    task({ title: 'Look up vectors video', status: 'inbox' }),
    task({ title: 'Something unsorted', status: 'inbox', needs_sorting: true }),
    task({ title: 'Learn guitar', status: 'someday', postpone_count: 5 }),
    task({ title: 'Book physio', project_id: 'p1', importance: 'must', due_at: '2026-10-13T12:00:00Z' }),
    task({ title: 'Buy new boots', project_id: 'p1' }),
  ],
  ...o,
})

test('inbox: exactly the Inbox, with Someday counted, never invented', () => {
  const r = render(data(), { view: 'inbox', arg: null })
  assert.match(r.html, /Inbox<\/b> \(2\)/)
  assert.match(r.html, /Look up vectors video/)
  assert.match(r.html, /Something unsorted <i>\(not sorted yet\)/)
  assert.match(r.html, /1 in Someday/)
  assert.deepEqual(r.refs.map((x) => x.title).sort(), ['Look up vectors video', 'Something unsorted'])
  assert.match(render(data({ tasks: [] }), { view: 'inbox', arg: null }).html, /Inbox is empty/)
})

test('postponing: most-put-off first, Someday left out, push-back at 3×', () => {
  const r = render(data(), { view: 'postponed', arg: null }).html
  assert.ok(r.indexOf('SMC past paper') < r.indexOf('Physics homework'))
  assert.doesNotMatch(r, /guitar/i)
  assert.match(r, /“SMC past paper” has been put off 3 times: do it tonight, or drop it\?/)
  assert.match(render(data({ tasks: [] }), { view: 'postponed', arg: null }).html, /Nothing postponed/)
})

test('project: the next step is the most urgent open task; unknown names list the projects', () => {
  const r = render(data(), { view: 'project', arg: 'football comeback' }).html
  assert.match(r, /Football comeback<\/b>: next step\n• <b>Book physio<\/b>/)
  assert.match(r, /Then:<\/i>\n• Buy new boots/)
  assert.match(render(data(), { view: 'project', arg: 'piano' }).html, /No project called “piano”\. Your projects: Football comeback/)
  assert.match(render(data(), { view: 'project', arg: 'football' }).html, /Book physio/, 'part of the name is enough when it is clear')
})

test('coming up: overdue first, deadlines, tests; repeating events only once; School left out', () => {
  const r = render(data(), { view: 'coming', arg: null }).html
  assert.ok(r.indexOf('Overdue') < r.indexOf('Deadlines'))
  assert.match(r, /Old essay/)
  assert.match(r, /Physics test<\/b> <i>\(Thu 15 Oct, in 5 days\)/)
  assert.equal(r.match(/Football/g).length, 1, 'the weekly session shows once (its next one)')
  assert.doesNotMatch(r, /School/)
})

test('week: 7 days from today with events, tests and deadlines; School as one line a day', () => {
  const r = render(data(), { view: 'week', arg: null }).html
  assert.match(r, /Your week<\/b> \(Sat 10 Oct – Fri 16 Oct\)/)
  assert.match(r, /<b>Thu 15 Oct<\/b>\n  🏫 School 08:45–16:00\n  18:00–19:30 Football\n  📝 <b>Physics test<\/b>/, 'one thing per line (no time range wraps on a phone)')
  assert.match(r, /<b>Today<\/b>\n  ⚠️ overdue: Old essay/)
  assert.match(r, /<b>Wed 14 Oct<\/b>\n  🏫 School 08:45–16:00\n  📌 due: <b>SMC past paper<\/b>/)
  assert.doesNotMatch(r, /Plus School/)
  assert.equal((r.match(/School/g) ?? []).length, 5)   // Mon–Fri
})

test('free: the slots, with the school-night limit and what is busy', () => {
  const r = render(data(), { view: 'free', arg: '2026-10-15' }).html
  assert.match(r, /Free on Thu 15 Oct/)
  assert.match(r, /• 16:10–17:25: 1 h 15 min/)
  assert.match(r, /• 20:05–22:30: 2 h 25 min <i>\(nothing heavy after 21:30\)/)
  assert.match(r, /School night: about 150 min/)
  assert.match(r, /Football 18:00–19:30 \+25 min travel each way/)
  const today = render(data(), { view: 'free', arg: TODAY }).html
  assert.match(today, /Free today<\/b> \(from 16:05\)\n• 16:05–22:30/)
})

test('the brain gets 7 days of free time worked out by code', () => {
  const t = freeTimeForAI(data())
  assert.match(t, /never work free time out yourself/)
  assert.match(t, /- Today from 16:05: 16:05–22:30/)
  assert.match(t, /- Thu 15 Oct: 07:00–08:35 \(95 min\) · 16:10–17:25 \(75 min\) · 20:05–22:30 \(145 min, nothing heavy after 21:30\) · school night/)
  assert.equal(t.split('\n').filter((l) => l.startsWith('- ')).length, 7)
})
