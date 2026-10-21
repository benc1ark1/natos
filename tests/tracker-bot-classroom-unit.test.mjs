// Classroom tests (lib/tracker/classroom.ts): which assignments look like tests, the description kept for them, what
// plain code reads (date, codes, "50 min", "45 marks", "30–60 min a day", "no momentum"), the AI's read checked (codes
// only from his tracker, a sane date), and the card's change: a new test (its homework copy archived) or only what a
// test he already has is missing. Fixed today: Mon 19 Oct 2026. Pure: no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { world } from './support/tracker-bot.mjs'

const C = await import('../lib/tracker/classroom.ts')
const TODAY = '2026-10-19'
const W = world(TODAY)
const A = (o = {}) => ({ taskId: 'aaaaaaaa-0000-4000-8000-000000000001', ext: 'classroom:0123456789abcdef', title: 'FM HT3 Test', text: '', due: '2026-11-19', subject: 'Further Maths', ...o })

test('which assignments are tests: test, assessment, exam, consolidation, mock, quiz (whole words)', () => {
  for (const t of ['FM HT2 Test', 'Mechanics assessment', 'Mock exam', 'HT1 Consolidation', 'Waves quiz', 'Exams prep']) assert.ok(C.looksLikeTest(t), t)
  for (const t of ['Integration sheet', 'Forces worksheet', 'Contest entry form', 'Attestation']) assert.ok(!C.looksLikeTest(t), t)
})

test('the description: the Homework feed header and HTML go; it is kept for every assignment (fix round 20: the questions in the notes)', () => {
  const desc = 'Class: Maths Further Mf1a\nSubject: Further Maths\nClassroom: https://classroom.google.com/c/A\n\nTest on <b>Thursday 12 Nov</b>: matrices &amp; vectors<br>50 minutes, no momentum.\n\nRef: 0123456789abcdef'
  assert.equal(C.cleanDescription(desc), 'Test on Thursday 12 Nov: matrices & vectors\n50 minutes, no momentum.')
  assert.equal(C.classroomDetails('Mf1a · Due 08:30', 'FM HT2 Test', desc), 'Mf1a · Due 08:30\n\nTest on Thursday 12 Nov: matrices & vectors\n50 minutes, no momentum.')
  assert.equal(C.classroomDetails('Mf1a · Due 08:30', 'Integration sheet', desc), 'Mf1a · Due 08:30\n\nTest on Thursday 12 Nov: matrices & vectors\n50 minutes, no momentum.', 'ordinary homework keeps it too')
  assert.equal(C.classroomDetails(null, 'FM HT2 Test', ''), null)
  assert.equal(C.classroomDetails(null, 'FM HT2 Test', 'Do your best'), 'Do your best')
})

test('plain code reads the due date, codes and exact topic names, length, marks, minutes a day and limits', () => {
  const r = C.plainRead(A({ text: 'Covers PC1-01 and Further vectors. 50 minutes, 45 marks, calculator. No momentum.' }), W.topics)
  assert.deepEqual([r.date, r.codes, r.lengthMin, r.marks, r.limits, r.kind, r.perDay], ['2026-11-19', ['PC1-01', 'PC1-02'], 50, 45, 'No momentum', 'test', null])
  const c = C.plainRead(A({ title: 'HT1 Consolidation', text: 'Spend 30-60 minutes a day on the booklets until 2 Nov.' }), W.topics)
  assert.deepEqual([c.kind, c.perDay, c.lengthMin], ['consolidation', [30, 60], null], 'a daily slot is not the test’s length')
  assert.deepEqual(C.plainRead(A({ title: 'Mock', text: '20 min a day' }), W.topics).perDay, [20, null])
})

test('the AI’s read is checked: codes only from his tracker, a real date from today on, sane numbers, plain code fills gaps', () => {
  const a = A({ text: 'no momentum' })
  const plain = C.plainRead(a, W.topics)
  const r = C.checkRead({ is_test: true, title: 'FM HT3 test', kind: 'test', date: '2026-11-12', codes: ['pc1-01', 'XX9-99'], topics: 'matrices, eigenvalues', limits: '', length_min: 50, marks: 0, minutes_per_day: 0, minutes_max: 0, info: 'calculator allowed' }, a, W.topics, TODAY, plain)
  assert.deepEqual([r.title, r.date, r.codes, r.topicWords, r.limits, r.lengthMin, r.marks, r.info], ['FM HT3 test', '2026-11-12', ['PC1-01'], ['matrices', 'eigenvalues'], 'no momentum', 50, null, 'calculator allowed'])
  const bad = C.checkRead({ is_test: true, title: '', kind: 'nonsense', date: '2025-01-01', codes: [], topics: '', limits: '', length_min: 9999, marks: -3, minutes_per_day: 40, minutes_max: 0, info: '' }, a, W.topics, TODAY, plain)
  assert.deepEqual([bad.title, bad.date, bad.kind, bad.lengthMin, bad.perDay], ['FM HT3 Test', '2026-11-19', 'test', null, [40, null]], 'a past date → the due date; nonsense numbers dropped')
  assert.equal(C.checkRead({ is_test: false, title: '', kind: 'test', date: '', codes: [], topics: '', limits: '', length_min: 0, marks: 0, minutes_per_day: 0, minutes_max: 0, info: '' }, a, W.topics, TODAY, plain).isTest, false)
})

test('the card’s change: a new test (source classroom, asked-once ref, homework copy archived)', () => {
  const read = { isTest: true, title: 'FM HT3 test', kind: 'test', date: '2026-11-26', codes: ['PC1-01'], topicWords: ['further vectors', 'eigenvalues'], limits: 'no momentum', lengthMin: 50, marks: 45, perDay: null, info: 'calculator' }
  const a = C.testAction(W, A(), read, C.classroomKey('classroom:0123456789abcdef'), TODAY)
  assert.match(a.line, /^📝 New test: <b>FM HT3 test<\/b> · Thu 26 Nov \(in 38 days\) · Further Maths · topics PC1-01, PC1-02 · no momentum · 50 min · 45 marks/)
  assert.match(a.line, /its homework copy “FM HT3 Test” is archived/)
  const row = a.patch.steps[0].row
  assert.deepEqual([row.source, row.source_ref.startsWith('classroom:'), row.source_ref.length, row.info], ['classroom', true, 34, 'calculator · Topics: eigenvalues'])
  assert.equal(a.patch.steps[1].id, A().taskId)
  assert.equal(C.classroomKey('x'), C.classroomKey('x'))
  assert.match(C.classroomKey('x'), /^trk:cls:[0-9a-f]{24}$/)
})

test('a test he already has (same day, same subject): only what it is missing; nothing missing → no card', () => {
  const read = { isTest: true, title: 'HT2', kind: 'test', date: '2026-11-12', codes: [], topicWords: [], limits: 'no polar', lengthMin: 50, marks: 45, perDay: null, info: null }
  const a = C.testAction(W, A({ due: '2026-11-12' }), read, 'trk:cls:abc', TODAY)
  assert.equal(a.id, W.tests[0].id)
  assert.match(a.line, /^📝 <b>FM HT2 test<\/b>: limits → no polar/)
  assert.deepEqual(a.patch.steps[0].set, { limits: 'no polar' })
  assert.equal(C.testAction(W, A({ due: '2026-11-12' }), { ...read, limits: null }, 'trk:cls:abc', TODAY), null, 'nothing new: no question')
})
