// Planner fixes + the maths system (13 Oct 2026), plain tests (no database): upper never lighter and on its fixed
// days/times, leaving school at 16:05, school free periods for study (never training), no extra training on a day,
// Tue + Wed high-CNS as the baseline, school Games counted once; maths modes, the topic queue and colours by chat.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/planner-maths-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTraining, fixedLoad, studySlots, trainingRooms } from '../lib/week.ts'
import { planningSettings, freeDays } from '../lib/freetime.ts'
import { moreSettings, daysOf, parseSetting } from '../lib/settings.ts'
import { planningEvents, shapesFor, DEFAULT_SESSIONS, sessionTimes } from '../lib/setup.ts'
import { owenChange, sessionChange } from '../lib/setup-edit.ts'
import { mentalDays } from '../lib/mental.ts'
import { DEFAULT_RULES, DEFAULT_TYPES } from '../lib/training.ts'
import { assess } from '../lib/load.ts'
import { addDays, isoDow } from '../lib/time.ts'
import { modeOf, nextBlocks, weekBlocks, accelerationQueue, resolveTopics, parseStatus, seedRows, trackerText, nextText, SEED } from '../lib/maths.ts'

const MON = '2026-10-19'
const d = (i) => addDays(MON, i)
const ev = (o) => ({ id: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null, start_time: null, end_time: null,
  repeat_from: '2026-09-01', repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, external_source: 'manual', ...o })
const lesson = (title, date, start, end) => ev({ id: `${title}${date}${start}`, title, starts_at: `${date}T${start}:00+01:00`, ends_at: `${date}T${end}:00+01:00`, external_source: 'google', calendar_id: 'ucs', repeat_from: null })
// Nat's real week (13 Oct): school, CS tutor Mon/Thu 17:30, Club 360 Mon 20:00 + Wed 19:45, Tue school football + Owen
const NAT = [
  ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00' }),
  ev({ title: 'CS tutor', repeat_days: [1, 4], start_time: '17:30', end_time: '18:30' }),
  ev({ title: 'Maths tutor', repeat_days: [3], start_time: '17:00', end_time: '18:00' }),
  ev({ title: 'Club 360 Talent football training', repeat_days: [1], start_time: '20:00', end_time: '22:00', training_type: 'football', load: 'hard' }),
  ev({ title: 'School football training', repeat_days: [2], start_time: '16:30', end_time: '18:00', training_type: 'football', load: 'hard' }),
  ev({ title: 'Owen sprint session', repeat_days: [2], start_time: '18:30', end_time: '20:00', training_type: 'sprint', load: 'hard' }),
  ev({ title: 'Club 360 Talent', repeat_days: [3], start_time: '19:45', end_time: '21:30', training_type: 'football', load: 'hard' }),
  // the school timetable (Google): Tue 09:10–10:15 is Private Study; Wed has Games over three periods
  ...[0, 1, 2, 3, 4].flatMap((i) => [lesson('School', d(i), '08:45', '16:15'), lesson('Physics', d(i), '10:35', '11:40'), lesson('Maths', d(i), '11:45', '12:50'), lesson('Bios', d(i), '14:20', '14:50')]),
  ...[0, 2, 3, 4].map((i) => lesson('Maths Further', d(i), '09:10', '10:15')),
  lesson('Private Study', d(1), '09:10', '09:40'), lesson('Private Study', d(1), '09:45', '10:15'),
  lesson('Games', d(2), '14:55', '15:25'), lesson('Games', d(2), '15:30', '16:00'), lesson('Games', d(2), '16:05', '16:15'),
]
const PLANNING = {
  sessionTypes: DEFAULT_SESSIONS.map((s) => s.key === 'stretch' ? { ...s, archived: true } : s.key === 'upper' ? (({ maxPerWeek, ...r }) => ({ ...r, minutes: 90, noLighter: true }))(s) : s),
  owenDays: { speed: [2], heavy_lower: [4], injury: [5], core: [6], upper: [1, 6] },
  sessionTimes: { upper: { 6: '09:30' } },
  noTrainingDays: 'wednesday', cnsBaseline: 'tuesday, wednesday', leaveSchoolAt: '16:05', dayMaxLoad: 40, weekMaxLoad: 160,
}
const target = (name, n) => ({ id: `t-${name}`, name, target_count: n, counts_from: 'logs', is_active: true, activity_type: null, subject_id: null, bonus_count: null, sync_source: 'manual', sort_order: 0 })

function world({ planning = PLANNING, events = NAT, today = MON } = {}) {
  const evs = planningEvents(events, [], planning, addDays(MON, -7), addDays(MON, 13))
  const shapes = shapesFor(planning, evs, [], [], addDays(MON, -1), addDays(MON, 7))
  const settings = { ...planningSettings(planning), dayBounds: (x) => { const s = shapes.get(x); return s ? { start: s.morningEnd, end: s.nightStart } : null } }
  return {
    today, nowMin: 7 * 60, from: today, to: d(6), settings, events: evs, changes: [], targets: [target('Upper', 2), target('Lower + plyo', 1)], logs: [], weekCounts: [],
    rules: DEFAULT_RULES, energy: new Map(), planned: [], travel: null, types: DEFAULT_TYPES, trainingFrom: '15:00', costs: [{ scope: 'type', type_key: 'upper', title: null, weekday: null, legs: 0, upper: 9, cns: 2 }],
    load: moreSettings(planning), planning, mental: mentalDays({ from: addDays(today, -1), to: d(6), planning, events: evs, changes: [], goals: [], tasks: [], blocks: [] }), done: [],
  }
}

test('upper: always heavy, never lighter; Saturday 09:30; heavy lower Thursday; nothing on Wednesday; no Stretching', () => {
  const w = world()
  const p = planTraining(w)
  const uppers = p.placed.filter((x) => x.type === 'upper')
  assert.ok(uppers.length >= 1, 'an upper is placed')
  for (const u of uppers) assert.equal(u.intensity, 'heavy', `${u.date} upper is heavy`)
  const sat = uppers.find((u) => u.date === d(5))
  assert.ok(sat, 'upper on Saturday')
  assert.equal(sat.start, '09:30')
  assert.equal(sat.end, '11:00', '90 minutes')
  const lower = p.placed.find((x) => x.type === 'lower')
  assert.ok(lower, 'heavy lower is placed')
  assert.equal(lower.date, d(3), 'heavy lower on Thursday')
  assert.ok(!p.placed.some((x) => isoDow(x.date) === 3), 'nothing extra on Wednesday')
  assert.ok(!p.placed.some((x) => /Stretch/.test(x.title)), 'no separate stretching')
})

test('leaving school at 16:05: free time and after-school training start from then (PureGym 20 min from school)', () => {
  const planning = { ...PLANNING, trainingPlaces: undefined }
  const w = world({ planning })
  const [thu] = freeDays(w.events, [], d(3), d(3), w.settings, w.today, 0, null)
  assert.ok(thu.slots.some((s) => s.start === '16:05'), thu.slots.map((s) => s.start).join(' '))
  const lower = planTraining(w).placed.find((x) => x.type === 'lower')
  assert.equal(lower.start, '16:05', 'school gym straight after school')
  // without the setting: when school ends plus the buffer (the old way)
  const old = freeDays(w.events, [], d(3), d(3), planningSettings({}), w.today, 0, null)[0]
  assert.ok(old.slots.some((s) => s.start === '16:25'), 'school (16:15 in the timetable) + 10 min buffer')
})

test('school free periods count for study, never for training; break and lunch are not free periods', () => {
  const w = world()
  const study = studySlots(w, [])
  assert.ok(study.get(d(1)).some((s) => s.start === '09:10' && s.end === '10:15'), 'Tue Private Study is study time')
  const rooms = trainingRooms(w, [])
  assert.ok(!rooms.find((r) => r.date === d(1)).slots.some((s) => s.start >= '08:45' && s.start < '16:05'), 'no training in school hours')
  assert.ok(!study.get(d(1)).some((s) => s.start === '10:15'), 'break is not study time')
})

test('Tue + Wed high-CNS is his baseline: no warning; school Games over three periods counts once', () => {
  const w = world()
  const fixed = fixedLoad(w)
  assert.equal(fixed.filter((f) => f.title === 'Games').length, 1)
  const games = fixed.find((f) => f.title === 'Games')
  assert.equal(games.end, '16:15')
  const p = planTraining(w)
  assert.ok(!p.notes.some((n) => /high-CNS/.test(n)), p.notes.join(' | '))
  assert.deepEqual(daysOf('tuesday, wednesday'), [2, 3])
  assert.deepEqual(daysOf('none'), [])
})

test('chat: fixed days with a time ("upper=mon, sat 09:30"); "lighter=no"; leave school setting', () => {
  const r = owenChange('upper=mon, sat 09:30', { sessionTypes: PLANNING.sessionTypes })
  assert.deepEqual(r.change.patch.owenDays.upper, [1, 6])
  assert.deepEqual(r.change.patch.sessionTimes, { upper: { 6: '09:30' } })
  assert.match(r.change.line, /Upper Mon\/Sat 09:30/)
  assert.deepEqual(sessionTimes({ sessionTimes: { upper: { 6: '09:30', 9: 'x' } } }), { upper: { 6: '09:30' } })
  const s = sessionChange('session=Core; lighter=no', { sessionTypes: PLANNING.sessionTypes })
  assert.equal(s.change.patch.sessionTypes.find((x) => x.key === 'core').noLighter, true)
  assert.equal(parseSetting('leaveSchoolAt', '16:05', {}), '16:05')
  assert.equal(parseSetting('noTrainingDays', 'wednesday', {}), 'wednesday')
})

// ---------------------------------------------------------------------------
// Maths
// ---------------------------------------------------------------------------

const SUBJECTS = [{ id: 'ma', name: 'Maths' }, { id: 'fm', name: 'Further Maths' }, { id: 'ph', name: 'Physics' }]
const topics = () => [...seedRows('Maths').map((r, i) => ({ id: `ma${i}`, subject_id: 'ma', notes_url: null, archived_at: null, status: 'not_started', ...r })),
  ...seedRows('Further Maths').map((r, i) => ({ id: `fm${i}`, subject_id: 'fm', notes_url: null, archived_at: null, status: 'not_started', ...r }))]
const SETTINGS = moreSettings({})
const mw = (o = {}) => ({ today: '2026-10-13', subjects: SUBJECTS, topics: topics(), tasks: [], goals: [], settings: SETTINGS, ...o })
const esc = (s) => s

test('seed: every topic in textbook order, with its section and chapter', () => {
  const t = topics()
  assert.equal(t.length, SEED.reduce((a, s) => a + s.topics.length, 0))
  assert.equal(t.length, 80)
  assert.equal(t.find((x) => x.name === 'Matrices').spec_ref, 'Pure Core 1 · 1')
  assert.equal(t.find((x) => x.name === 'Objects in contact').spec_ref, 'Book 1 · 22')
  assert.equal(t.find((x) => x.name === 'Proof' && x.subject_id === 'ma').spec_ref, 'Book 2 · 1')
})

test('acceleration (no homework, no test): the courses take turns through the books; red first, then yellow', () => {
  const w = mw()
  assert.equal(modeOf(w).kind, 'acceleration')
  const b = nextBlocks(w, 3)
  assert.equal(b[0].title, '🚀 Maths: Proof & mathematical communication — textbook + questions')
  assert.equal(b[1].title, '🚀 FM: Matrices — textbook + questions')
  assert.equal(b[2].title, '🚀 Maths: Indices & surds — textbook + questions')
  const t = topics()
  t.find((x) => x.name === 'Vectors').status = 'understand'
  t.find((x) => x.name === 'Complex numbers').status = 'not_secure'
  t.find((x) => x.name === 'Proof & mathematical communication').status = 'understand'   // 🟡 is enough to move on
  const q = accelerationQueue(mw({ topics: t })).map((x) => x.topic.name)
  assert.deepEqual(q.slice(0, 4), ['Complex numbers', 'Proof & mathematical communication', 'Vectors', 'Indices & surds'])
})

test('homework first: maths/FM homework with a due date', () => {
  const w = mw({ tasks: [{ id: 'h1', title: 'FM exercise 3B', subject_id: 'fm', status: 'this_week', due_at: '2026-10-15T12:00:00Z', archived_at: null, duration_minutes: 45 },
    { id: 'p1', title: 'Physics booklet', subject_id: 'ph', status: 'this_week', due_at: '2026-10-14T12:00:00Z', archived_at: null, duration_minutes: null }] })
  assert.equal(modeOf(w).kind, 'homework')
  const b = nextBlocks(w, 2)
  assert.equal(b.length, 1)
  assert.equal(b[0].title, '📝 FM homework: FM exercise 3B')
  assert.equal(b[0].minutes, 45)
  assert.equal(b[0].taskId, 'h1')
})

test('test mode (a maths test within 7 days): only its topics, 🔴 then 🟡 then quick checks on 🟢; mixed set the day before', () => {
  const t = topics()
  t.find((x) => x.name === 'Proof & mathematical communication').status = 'exam_ready'
  t.find((x) => x.name === 'Vectors').status = 'not_secure'
  const w = mw({ topics: t, goals: [{ id: 'g', title: 'Maths test', kind: 'test', subject_id: 'ma', target_date: '2026-10-20', topics: 'proof, vectors', archived_at: null }] })
  const m = modeOf(w)
  assert.equal(m.kind, 'test')
  assert.deepEqual(m.topics.map((x) => x.name), ['Proof & mathematical communication', 'Vectors'])
  const b = nextBlocks(w, 5)
  assert.deepEqual(b.map((x) => x.title), ['🔥 Maths: Vectors — back to it: textbook + questions', '🔥 Maths: Proof & mathematical communication — quick check'])
  assert.equal(b[1].minutes, 30)
  const days = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'].map((date) => ({ date }))
  const wb = weekBlocks(w, days)
  assert.match(wb.get('2026-10-19')[0].title, /mixed set for Maths test/)
  assert.ok(![...wb.keys()].some((x) => x >= '2026-10-20'))
  // too far away: back to acceleration
  assert.equal(modeOf(mw({ goals: [{ ...w.goals[0], target_date: '2026-10-30' }] })).kind, 'acceleration')
})

test('the week: 5 maths blocks spread over the days, none on game day', () => {
  const days = ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'].map((date) => ({ date, skip: date === '2026-10-18' }))
  const wb = weekBlocks(mw(), days)
  const all = [...wb.values()].flat()
  assert.equal(all.length, 5)
  assert.ok(!wb.has('2026-10-18'))
  assert.equal(new Set(all.map((b) => b.title)).size, 5, 'a different topic each block')
})

test('colours by chat: "trig yellow", "matrices green", "Book 1 chapters 1–13 green"', () => {
  const w = mw()
  assert.equal(parseStatus('yellow'), 'understand')
  assert.equal(parseStatus('🟢'), 'exam_ready')
  assert.equal(parseStatus('red'), 'not_secure')
  assert.equal(resolveTopics(w, { topics: 'trig' }).topics[0].name, 'Trigonometric functions & equations', 'earliest in the books')
  assert.equal(resolveTopics(w, { topics: 'matrices' }).topics[0].name, 'Matrices')
  const r = resolveTopics(w, { subject: 'Maths', section: 'Book 1', chapters: '1-13' })
  assert.equal(r.topics.length, 13)
  assert.equal(r.topics.at(-1).name, 'Differentiation')
  assert.match(resolveTopics(w, { chapters: '1-13' }).problem, /which book/)
  assert.match(resolveTopics(w, { topics: 'knitting' }).problem, /no topic/)
})

test('tracker and "what maths should I do?" texts', () => {
  const t = topics()
  t.slice(0, 3).forEach((x) => { x.status = 'exam_ready' })
  const w = mw({ topics: t })
  const tr = trackerText(w, esc)
  assert.match(tr, /Maths<\/b> 3\/44 🟢/)
  assert.match(tr, /Book 1: 🟢🟢🟢⚪/)
  assert.match(tr, /Pure Core 1: ⚪⚪⚪⚪⚪⚪/)
  assert.match(tr, /🚀 Acceleration mode/)
  const nx = nextText(w, esc)
  assert.match(nx, /Next: <b>🚀 Maths: Polynomials — textbook \+ questions<\/b>, 60m/)
  assert.match(nx, /OCR\/Cambridge/)
})
