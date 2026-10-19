// The tracker's data side without a database: "Export my tracker" CSVs (RFC 4180, BOM, the spreadsheet's columns,
// and they read back in unchanged), the tracker settings, which tasks count as homework, and loadStudyWorld before
// supabase/tracker.sql has run (a fake client that answers "column does not exist"). Made-up data only.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-data-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell, toCsv, trackerCsvFiles, trackerCsvAll } from '../lib/tracker/csv.ts'
import { TRACKER_SETTINGS, LINK_KEYS, REVIEW_KEYS, linksFrom, reviewDaysFrom } from '../lib/tracker/settings.ts'
import { isHomework, loadStudyWorld, loadTrackerData, isMissing, applyImport, READ_FAILED } from '../lib/tracker/data.ts'
import { parseTracker, buildImportPlan, bookSection } from '../lib/tracker/import.ts'
import { moreSettings, parseSetting, SETTINGS } from '../lib/settings.ts'
import { MATHS_HEAD, PHYSICS_HEAD } from './tracker-import-fixture.mjs'

const TODAY = '2026-10-19'

/** A tiny RFC 4180 reader, to check the CSV reads back exactly. */
function readCsv(text) {
  const s = text.replace(/^﻿/, '')
  const rows = []; let row = [], cell = '', q = false
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (q) { if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') q = false; else cell += ch; continue }
    if (ch === '"') q = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\r' && s[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++ }
    else cell += ch
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

const topic = (o) => ({ id: o.code, subjectId: o.subject === 'Physics' ? 'sp' : o.subject === 'Maths' ? 'sm' : 'sf', subject: 'Maths', code: null, name: '', strand: null, teacher: null, halfTerm: null, taughtFrom: null, taught: null, status: 'not_started', step: 0, bicen: null, integralUrl: null, freshPct: null, lastDone: null, weakNotes: null, concepts: null, booklet: null, pmt: null, pmtRef: null, bookRef: null, order: 0, ...o })
function world() {
  return {
    today: TODAY,
    topics: [
      topic({ code: 'Y1-13', subject: 'Maths', name: 'Differentiation', strand: 'Pure', teacher: 'Teacher B', halfTerm: 'HT1', taughtFrom: '2026-09-14', status: 'understand', step: 3, bicen: 'Bicen Pure → AS: Differentiation', integralUrl: 'https://example.org/i', freshPct: 70, lastDone: '2026-10-10', weakNotes: 'chain rule, "signs"', bookRef: 'Y1 red · 13', order: 1 }),
      topic({ code: 'PC1-06', subject: 'Further Maths', name: 'Mathematical induction', strand: 'Further Pure', teacher: 'Teacher A', halfTerm: 'HT2', taughtFrom: '2026-11-02', bookRef: 'PC1 blue · 6', bicen: 'Bicen Core Pure → CP1: Proof by Induction', order: 5 }),
      topic({ code: 'PC1-01', subject: 'Further Maths', name: 'Matrices', strand: 'Further Pure', teacher: 'Teacher A', halfTerm: 'HT1', taughtFrom: '2026-09-07', status: 'exam_ready', step: 5, lastDone: '2026-10-01', bookRef: 'PC1 blue · 1', order: 0 }),
      topic({ code: 'P3.1', subject: 'Physics', name: "Newton's laws of motion", strand: 'Dynamics', teacher: 'Teacher C', taught: 'yes', status: 'not_secure', booklet: 'doing', pmt: 'todo', freshPct: 55, concepts: 'resultant force, net force', lastDone: '2026-10-12', pmtRef: 'PMT topic 3', order: 1 }),
      topic({ code: 'P7.1', subject: 'Physics', name: 'Progressive waves', strand: 'Waves', teacher: 'Teacher D', taught: 'in_class', order: 2 }),
    ],
    tests: [{ id: 'g1', title: 'Further Maths HT2 test', date: '2026-11-12', kind: 'test', subjectId: 'sf', subject: 'Further Maths', info: '50 min · ~45 marks\nTopic notes: …', topicCodes: ['PC1-01', 'Y1-13'], minutesPerDay: null, minutesMax: null, limits: null, lengthMin: 50, marks: 45,
      attempts: [{ id: 'a1', goalId: 'g1', doneOn: '2026-10-15', what: 'timed', label: 'Timed practice', score: 30, outOf: 45 }] }],
    mistakes: [],
    programmes: [
      { id: 'p1', name: 'STEP', area: 'study', subjectId: 'sm', perWeek: 1, minutes: 90, days: 'weekend', startsOn: null, endsOn: null, status: 'active', pausedUntil: null, mode: 'in_order', notes: null, items: [
        { id: 'i2', programmeId: 'p1', position: 2, title: 'STEP Support – Assignment 2', details: null, url: null, minutes: null, status: 'todo', doneOn: null, result: null, score: null, outOf: null },
        { id: 'i1', programmeId: 'p1', position: 1, title: 'STEP Support – Assignment 1', details: null, url: null, minutes: 75, status: 'done', doneOn: '2026-10-11', result: 'solved: with hints · idea: factor theorem, again', score: null, outOf: null },
      ] },
      { id: 'p2', name: 'Complete Guide to ACT English', area: 'act', subjectId: null, perWeek: 3, minutes: 30, days: null, startsOn: null, endsOn: '2026-12-01', status: 'paused', pausedUntil: '2026-10-25', mode: 'in_order', notes: null, items: [
        { id: 'j1', programmeId: 'p2', position: 1, title: 'Chapter 1', details: null, url: null, minutes: null, status: 'doing', doneOn: null, result: '=8/10', score: 8, outOf: 10 },
      ] },
    ],
    rules: [], homework: [], links: {}, reviewDays: { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 }, doneToday: [],
  }
}
const mistakes = [
  { id: 'm1', goalId: 'g1', topicId: 'PC1-01', subjectId: 'sf', code: 'PC1-01', question: 'Q3b', body: 'det, wrong sign', kind: 'algebra', rule: 'check det first', source: null, loggedOn: '2026-10-15', reviewOn: '2026-10-18', redoStage: 0, reviewedAt: null },
  { id: 'm2', goalId: null, topicId: 'Y1-13', subjectId: 'sm', code: 'Y1-13', question: 'Q5', body: 'Dropped a minus sign\nin line 2', kind: 'careless', rule: null, source: 'Bicen AS Differentiation', loggedOn: '2026-10-12', reviewOn: '2026-10-22', redoStage: 1, reviewedAt: null },
  { id: 'm3', goalId: null, topicId: null, subjectId: 'sp', code: null, question: null, body: 'old one', kind: null, rule: null, source: null, loggedOn: '2026-09-01', reviewOn: '2026-09-04', redoStage: 2, reviewedAt: '2026-09-11T12:00:00Z' },
]

test('csv cells: RFC 4180 quoting, a BOM and CRLF; a leading = + - @ stays text', () => {
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a, b'), '"a, b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('two\nlines'), '"two\nlines"')
  assert.equal(csvCell(' edge'), '" edge"')
  assert.equal(csvCell(70), '70'); assert.equal(csvCell(null), ''); assert.equal(csvCell(undefined), ''); assert.equal(csvCell(NaN), '')
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(csvCell('@me'), "'@me"); assert.equal(csvCell('-3'), '-3'); assert.equal(csvCell('+ve'), "'+ve")
  assert.equal(csvCell('🟢'), '🟢')
  assert.equal(toCsv([['a', 'b'], [1, null]]), '﻿a,b\r\n1,\r\n')
})

test('export: one CSV per tab with the spreadsheet’s columns and values (emoji, steps, status, reviews, tests)', () => {
  const files = trackerCsvFiles({ world: world(), allMistakes: mistakes })
  assert.deepEqual(files.map((f) => [f.tab, f.name, f.rows]), [
    ['Maths+FM', `tracker-maths-fm-${TODAY}.csv`, 3], ['Physics', `tracker-physics-${TODAY}.csv`, 2], ['Tests & papers', `tracker-tests-${TODAY}.csv`, 1],
    ['Mistakes – practice', `tracker-mistakes-${TODAY}.csv`, 2], ['STEP', `tracker-step-${TODAY}.csv`, 2], ['Programmes', `tracker-programmes-${TODAY}.csv`, 3],
  ])
  for (const f of files) { assert.ok(f.csv.startsWith('﻿')); assert.ok(f.csv.endsWith('\r\n')) }
  const maths = readCsv(files[0].csv)
  assert.deepEqual(maths[0], MATHS_HEAD)
  assert.deepEqual(maths.slice(1).map((r) => r[0]), ['PC1-01', 'Y1-13', 'PC1-06'], 'school order')
  assert.deepEqual(maths[2], ['Y1-13', 'Maths', 'Pure', 'Teacher B', 'HT1', '2026-09-14', '✅ Taught', 'Y1 red · 13', 'Differentiation', '🟡', '3 Mixed exercise', 'Bicen Pure → AS: Differentiation', 'https://example.org/i', '70', '2026-10-10', '2026-10-13', 'DUE', 'Further Maths HT2 test', 'chain rule, "signs"'])
  assert.deepEqual(maths[1].slice(0, 2), ['PC1-01', 'FM'])
  assert.equal(maths[1][15], '2026-10-15'); assert.equal(maths[1][16], 'DUE')
  assert.equal(maths[3][6], '⏭ Next up'); assert.equal(maths[3][15], '', 'never done: no review yet')
  const phys = readCsv(files[1].csv)
  assert.deepEqual(phys[0], PHYSICS_HEAD)
  assert.deepEqual(phys[1], ['P3.1', 'Dynamics', "Newton's laws of motion", 'Teacher C', 'Yes', '🔴', '⏳', '❌', '55', 'resultant force, net force', '2026-10-12', '2026-10-13', 'DUE', '', 'PMT topic 3'])
  assert.equal(phys[2][4], 'In class')
  const tests = readCsv(files[2].csv)
  assert.deepEqual(tests[0], ['FURTHER MATHS HT2 TEST', '', '', '', '', '2026-11-12', '24 days left'])
  assert.deepEqual(tests[1], ['50 min · ~45 marks'])
  assert.deepEqual(tests[3], ['PC1-01', 'Matrices', '🟢', '', ''])
  assert.deepEqual(tests[7], ['2026-10-15', 'Timed practice', '30', '45', '', '67%'])
  assert.deepEqual(tests[10], ['Q3b', 'det, wrong sign', 'PC1-01', 'Algebra', 'check det first', '2026-10-18', '', ''])
  const mk = readCsv(files[3].csv)
  assert.deepEqual(mk[0], ['Date', 'Code', 'Topic', 'Source (sheet + Q)', 'What went wrong', 'Type', 'Rule for next time', 'Redo on', 'Redone?'])
  assert.deepEqual(mk[2], ['2026-10-12', 'Y1-13', 'Differentiation', 'Bicen AS Differentiation Q5', 'Dropped a minus sign\nin line 2', 'Careless', '', '2026-10-22', 'once'])
  assert.deepEqual(mk[1], ['2026-09-01', '', '', '', 'old one', '', '', '', 'twice'])
  const step = readCsv(files[4].csv)
  assert.deepEqual(step[0], ['#', 'Assignment', 'Status', 'Date', 'Minutes', 'Solved without help?', 'Idea I learnt'])
  assert.deepEqual(step[1], ['1', 'STEP Support – Assignment 1', 'Done', '2026-10-11', '75', 'with hints', 'factor theorem, again'])
  const prog = readCsv(files[5].csv)
  assert.deepEqual(prog[3], ['Complete Guide to ACT English', '3', '', 'paused', '2026-12-01', '1', 'Chapter 1', 'In progress', '', '', "'=8/10", '8', '10'])
  const all = trackerCsvAll({ world: world(), allMistakes: mistakes })
  assert.equal(all.name, `tracker-${TODAY}.csv`)
  assert.equal(readCsv(all.csv).filter((r) => r[0].startsWith('## ')).length, 6)
})

test('export → import round trip: the CSV tabs read back as the same topics (nothing would change)', () => {
  const w = world()
  const files = trackerCsvFiles({ world: w, allMistakes: [] })
  const wb = { sheets: [{ name: 'Maths+FM', rows: readCsv(files[0].csv), links: {} }, { name: 'Physics', rows: readCsv(files[1].csv), links: {} }] }
  for (const s of wb.sheets) s.rows = s.rows.map((r) => r.map((v) => (v === '' ? null : v)))
  const parsed = parseTracker(wb, TODAY)
  const cur = {
    ready: true, categories: [], mistakes: [], tests: [], attempts: [], programmes: [], planning: {},
    subjects: [{ id: 'sm', name: 'Maths', categoryId: null, archived: false }, { id: 'sf', name: 'Further Maths', categoryId: null, archived: false }, { id: 'sp', name: 'Physics', categoryId: null, archived: false }],
    topics: w.topics.map((t) => { const b = bookSection(t.bookRef); return { ...t, id: `id-${t.code}`, specRef: b ? `${b.section} · ${b.n}` : null, sortOrder: t.order, notesUrl: null, statusAt: null } }),
  }
  // the sheet's order is the export's row order (0, 1, 2 per tab), so line the app's up the same way first
  const order = new Map(parsed.topics.map((t) => [t.code, t.order]))
  for (const t of cur.topics) t.sortOrder = order.get(t.code)
  const plan = buildImportPlan(parsed, cur, TODAY)
  assert.deepEqual(plan.topics.update, [])
  assert.equal(plan.topics.create.length, 0)
  assert.deepEqual(plan.clashes, [])
})

test('tracker settings: valid defaults, links must be http(s), review gaps read his values', () => {
  const now = moreSettings({})
  for (const [k, x] of Object.entries(TRACKER_SETTINGS)) { assert.ok(SETTINGS[k], k); assert.equal(now[k], x.default, k) }
  assert.equal(Object.keys(LINK_KEYS).length, 14)
  assert.deepEqual(Object.values(REVIEW_KEYS).map((k) => now[k]), [1, 3, 14, 7])
  assert.equal(now.nextUpDays, 21); assert.equal(now.testWindowDays, 21)
  assert.equal(parseSetting('linkBicenPure', 'https://example.org/bicen', {}), 'https://example.org/bicen')
  assert.equal(parseSetting('reviewRedDays', '2', {}), 2)
  assert.equal(parseSetting('reviewRedDays', '0', {}), null)
  const links = linksFrom(moreSettings({ linkBicenPure: 'https://example.org/bicen', linkMadas: 'not a link', linkStep: 'javascript:alert(1)' }))
  assert.equal(links.bicenPure, 'https://example.org/bicen'); assert.equal(links.madas, ''); assert.equal(links.step, '')
  assert.deepEqual(reviewDaysFrom(moreSettings({ reviewRedDays: 2, reviewGreenDays: 21 })), { not_secure: 2, understand: 3, exam_ready: 21, not_started: 7 })
})

test('homework: from Classroom or a tutor, or titled homework; never prep sessions, Someday or done tasks', () => {
  const t = (o) => ({ origin: 'own', title: 'x', subject_id: null, source: 'app', external_id: null, status: 'today', is_system: false, archived_at: null, ...o })
  assert.equal(isHomework(t({ origin: 'school', title: 'Vectors worksheet', subject_id: 's1', source: 'import', external_id: 'classroom:abc' })), true)
  assert.equal(isHomework(t({ origin: 'tutor_maths_physics', title: 'Tutor worksheet' })), true)
  assert.equal(isHomework(t({ title: 'Maths homework ex 3B' })), true)
  assert.equal(isHomework(t({ title: 'Buy football boots' })), false)
  assert.equal(isHomework(t({ origin: 'school', title: 'Permission slip for trip' })), false)
  assert.equal(isHomework(t({ origin: 'school', title: 'Homework 4', is_system: true })), false)
  assert.equal(isHomework(t({ origin: 'school', title: 'Homework 4', status: 'someday' })), false)
  assert.equal(isHomework(t({ origin: 'school', title: 'Homework 4', status: 'completed' })), false)
})

// ---------------------------------------------------------------------------
// loadStudyWorld before supabase/tracker.sql has run
// ---------------------------------------------------------------------------

/** A fake Supabase client: `answer(table, cols)` → { data, error } (every filter is accepted and ignored). */
function fakeClient(answer) {
  return {
    from(table) {
      const b = { cols: '', single: false }
      const chain = new Proxy(b, {
        get(target, prop) {
          if (prop === 'then') return (res, rej) => Promise.resolve(answer(table, target.cols, target.single)).then(res, rej)
          if (prop === 'select') return (c) => { target.cols = c; return chain }
          if (prop === 'maybeSingle') return () => { target.single = true; return chain }
          return () => chain
        },
      })
      return chain
    },
  }
}
const MISSING_COL = (c) => ({ data: null, error: { code: '42703', message: `column ${c} does not exist` } })
const MISSING_TABLE = (t) => ({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${t}' in the schema cache` } })

test('loadStudyWorld before tracker.sql: topics (with colours), tests and mistakes the old way; no programmes, rules or attempts', async () => {
  const sb = fakeClient((table, cols, single) => {
    if (table === 'profiles') return { data: single ? { planning: { linkIsaac: 'https://isaacphysics.org/' } } : null, error: null }
    if (table === 'subjects') return { data: [{ id: 'sm', name: 'Maths' }, { id: 'sf', name: 'further maths' }, { id: 'sc', name: 'Computer Science' }], error: null }
    if (table === 'topics') return cols.includes('code') ? MISSING_COL('topics.code') : { data: [
      { id: 't1', subject_id: 'sm', name: 'Proof', spec_ref: 'Book 1 · 1', notes_url: null, sort_order: 0, archived_at: null, status: 'understand' },
      { id: 't2', subject_id: 'sf', name: 'Matrices', spec_ref: 'Pure Core 1 · 1', notes_url: null, sort_order: 0, archived_at: null, status: 'nonsense' },
      { id: 't3', subject_id: 'sc', name: 'Binary search', spec_ref: null, notes_url: null, sort_order: 0, archived_at: null, status: 'not_started' },
    ], error: null }
    if (table === 'goals') return cols.includes('test_kind') ? MISSING_COL('goals.test_kind') : { data: [
      { id: 'g1', title: 'FM test', kind: 'test', subject_id: 'sf', target_date: '2026-11-12', topics: 'matrices', archived_at: null },
      { id: 'g2', title: 'ACT retake', kind: 'test', subject_id: null, target_date: '2026-12-12', topics: null, archived_at: null },
    ], error: null }
    if (table === 'mistakes') return cols.includes('redo_stage') ? MISSING_COL('mistakes.redo_stage') : { data: [
      { id: 'm1', subject_id: 'sf', topic_id: 't2', body: 'det sign', logged_on: '2026-10-10', review_on: '2026-10-13', reviewed_at: null, archived_at: null },
      { id: 'm2', subject_id: 'sf', topic_id: 't2', body: 'old', logged_on: '2026-09-10', review_on: '2026-09-13', reviewed_at: '2026-09-13T10:00:00Z', archived_at: null },
    ], error: null }
    if (['test_attempts', 'programmes', 'programme_items', 'plan_rules'].includes(table)) return MISSING_TABLE(table)
    if (table === 'plan_blocks') return MISSING_COL('plan_blocks.pick_key')
    if (table === 'tasks') return { data: [
      { id: 'k1', title: 'Matrices worksheet', subject_id: 'sf', due_at: '2026-10-21T12:00:00Z', duration_minutes: 40, origin: 'school', source: 'import', external_id: 'classroom:1', status: 'this_week', is_system: false, archived_at: null },
      { id: 'k2', title: 'Tidy room', subject_id: null, due_at: null, duration_minutes: null, origin: 'own', source: 'app', external_id: null, status: 'today', is_system: false, archived_at: null },
      { id: 'k3', title: 'FM test prep 1', subject_id: 'sf', due_at: '2026-10-20T12:00:00Z', duration_minutes: 40, origin: 'school', source: 'app', external_id: null, status: 'today', is_system: true, archived_at: null },
    ], error: null }
    return { data: [], error: null }
  })
  const data = await loadTrackerData(sb, TODAY)
  assert.equal(data.ready, false)
  const w = data.world
  assert.deepEqual(w.topics.map((t) => [t.name, t.subject, t.status, t.step, t.code]), [['Proof', 'Maths', 'understand', 0, null], ['Matrices', 'Further Maths', 'not_started', 0, null]], 'only Maths / Further Maths / Physics topics; an odd colour reads ⚪')
  assert.deepEqual(w.tests.map((t) => [t.id, t.kind, t.subject, t.topicCodes, t.attempts]), [['g1', 'test', 'Further Maths', [], []]], 'ACT is left to lib/act; no codes before the SQL')
  assert.deepEqual(w.mistakes.map((m) => [m.id, m.redoStage]), [['m1', 0]], 'a mistake reviewed the old way counts as done')
  assert.deepEqual([w.programmes, w.rules, w.doneToday], [[], [], []])
  assert.deepEqual(w.homework.map((h) => [h.id, h.subject, h.minutes]), [['k1', 'Further Maths', 40]])
  assert.equal(w.links.isaac, 'https://isaacphysics.org/'); assert.equal(w.links.bicenPure, '')
  assert.deepEqual(w.reviewDays, { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 })
  assert.equal((await loadStudyWorld(sb, TODAY)).topics.length, 2)
})

test('loadStudyWorld: a real error (not a missing column) is reported, never swallowed', async () => {
  const sb = fakeClient((table, _cols, single) => (table === 'topics' ? { data: null, error: { code: '42501', message: 'permission denied for table topics' } } : { data: single ? null : [], error: null }))
  const quiet = console.error; console.error = () => {}
  try {
    await assert.rejects(loadStudyWorld(sb, TODAY), (e) => e.message === READ_FAILED && !/permission/.test(e.message), 'a fixed message; the database’s words go to the log')
  } finally { console.error = quiet }
  assert.equal(isMissing({ code: '42P01', message: 'relation "public.plan_rules" does not exist' }), true)
  assert.equal(isMissing({ code: '42501', message: 'permission denied' }), false)
})

test('applyImport after a partial failure: counts only the rows the database confirmed, and never shows its raw error', async () => {
  // topic t1 (codes etc.) saves; t2 (school order only) fails with a database error; t3 isn't found
  const writes = []
  const sb = {
    from(table) {
      const q = { table, patch: null, id: null }
      const chain = {
        update(patch) { q.patch = patch; return chain },
        eq(col, val) { if (col === 'id') q.id = val; return chain },
        is() { return chain }, in() { return chain },
        select() { return chain },
        then(res, rej) {
          writes.push(q)
          const r = q.id === 't2' ? { data: null, error: { code: '23514', message: 'new row violates check constraint "topics_tracker_check" SECRET-DETAIL' } }
            : q.id === 't3' ? { data: [], error: null } : { data: [{ id: q.id }], error: null }
          return Promise.resolve(r).then(res, rej)
        },
      }
      return chain
    },
  }
  const plan = {
    subjects: [], topics: { create: [], archive: [], same: 0, update: [
      { id: 't1', label: 'Y1-01 Proof', patch: { code: 'Y1-01' }, reorderOnly: false },
      { id: 't2', label: 'Hyperbolic functions', patch: { sort_order: 1011 }, reorderOnly: true },
      { id: 't3', label: 'Old topic', patch: { sort_order: 1012 }, reorderOnly: true },
    ] },
    tests: { create: [], update: [], same: 0 }, attempts: [], mistakes: [], programmes: { create: [], addItems: [], updateItems: [] }, settings: [], clashes: [], warnings: [], counts: {},
  }
  const logs = []
  const quiet = console.error; console.error = (...a) => logs.push(a.join(' '))
  let r
  try { r = await applyImport(sb, plan, true) } finally { console.error = quiet }
  assert.equal(r.ok, false)
  assert.equal(r.saved.topicsUpdated, 1, 't1 was saved')
  assert.equal(r.saved.topicsReordered, 0, 'neither reorder was confirmed, so none is claimed')
  assert.match(r.error, /^Stopped while saving topics\. Importing the same file again is safe/)
  assert.doesNotMatch(r.error, /SECRET|constraint/, 'the database’s own words stay in the log')
  assert.ok(logs.some((l) => /SECRET-DETAIL/.test(l)))
  assert.deepEqual(writes.map((w) => w.id), ['t1', 't2', 't3'])
})
