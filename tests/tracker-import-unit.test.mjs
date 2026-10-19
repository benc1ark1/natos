// The study tracker import (plans/contracts.md §3.3): the .xlsx reader on real zip bytes, the cell mappings, and the
// ImportPlan — new topics, matches keep his colour, duplicates archived with their mistakes moved, clashes listed,
// tests / attempts / mistakes / STEP / settings, and importing the same file twice changes nothing.
// Made-up data only (tests/tracker-import-fixture.mjs); the real spreadsheet is checked only if it's on this PC.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-import-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { readXlsx, unzip, serialToISO, isDateFormat, cellRef, colName, XlsxError } from '../lib/tracker/xlsx.ts'
import * as I from '../lib/tracker/import.ts'
import { seedRows } from '../lib/maths.ts'
import { xlsx, zip, fixtureSheets, fixtureWorkbook, fixtureCurrent, simulateApply, IDS, INTEGRAL_URL, MATHS_HEAD, PHYSICS_HEAD } from './tracker-import-fixture.mjs'

const TODAY = '2026-10-19'
const REAL = 'C:/Users/Nat/natos/assets/Nat-Study-Tracker-FINAL.xlsx'

// ---------------------------------------------------------------------------
// The reader
// ---------------------------------------------------------------------------

test('xlsx reader: shared, inline and rich strings, numbers, dates, formula results, links, booleans, errors, gaps', () => {
  const bytes = xlsx([{
    name: 'Sheet A & B',
    rows: [
      ['Code', null, 'x &lt; y', { inline: '  inline text ' }],
      [12.5, { date: '2026-11-12' }, { builtinDate: '2027-01-04' }, { formula: 'IF(A1="","",HYPERLINK(B9,"Bicen Pure"))', value: 'Bicen Pure' }],
      [],
      [{ bool: true }, { error: '#N/A' }, { rich: ['Bold ', 'part'] }, { formula: 'HYPERLINK("https://example.org/a?x=1&y=2","open")', value: 'open' }],
      ['line_x000D_break', '', { formula: 'IF(1,"","")', value: '' }],
    ],
    links: { C1: 'https://example.org/c1' },
  }])
  const wb = readXlsx(bytes)
  assert.equal(wb.sheets.length, 1)
  const s = wb.sheets[0]
  assert.equal(s.name, 'Sheet A & B')
  assert.deepEqual(s.rows[0], ['Code', null, 'x &lt; y', '  inline text '])
  assert.deepEqual(s.rows[1], [12.5, '2026-11-12', '2027-01-04', 'Bicen Pure'])
  assert.deepEqual(s.rows[2], [])
  assert.deepEqual(s.rows[3], ['TRUE', null, 'Bold part', 'open'], 'rich text runs join; phonetic hints are left out; errors are empty')
  assert.deepEqual(s.rows[4], ['line\rbreak'], 'empty strings and empty formula results are empty cells')
  assert.equal(s.links.C1, 'https://example.org/c1')
  assert.equal(s.links.D4, 'https://example.org/a?x=1&y=2', 'a HYPERLINK formula with a written-out address counts as a link')
  assert.equal(s.links.D2, undefined, 'a HYPERLINK to another cell has no address to keep')
})

test('xlsx reader: stored (uncompressed) entries, and clear errors for files that aren’t spreadsheets', () => {
  const wb = readXlsx(xlsx([{ name: 'S', rows: [['hi', 3]] }], { store: true }))
  assert.deepEqual(wb.sheets[0].rows[0], ['hi', 3])
  assert.throws(() => readXlsx(Buffer.from('not a zip at all, just text')), (e) => e instanceof XlsxError && /isn’t an \.xlsx/.test(e.message))
  const z = zip([{ name: 'hello.txt', data: 'hi' }])
  assert.throws(() => readXlsx(z), (e) => e instanceof XlsxError && /no workbook/.test(e.message))
  const cut = xlsx([{ name: 'S', rows: [['a']] }]).subarray(0, 200)
  assert.throws(() => readXlsx(cut), XlsxError)
  assert.deepEqual([...unzip(z).keys()], ['hello.txt'])
})

test('xlsx helpers: serial dates (1900 system), date formats, cell refs', () => {
  assert.equal(serialToISO(46266), '2026-09-01')
  assert.equal(serialToISO(61), '1900-03-01')
  assert.equal(serialToISO(46266.5), '2026-09-01T12:00')
  assert.equal(serialToISO(0, true), '1904-01-01')
  assert.equal(isDateFormat('d\\ mmm\\ yy'), true)
  assert.equal(isDateFormat('ddd\\ d\\ mmm\\ yy'), true)
  assert.equal(isDateFormat('0\\%'), false)
  assert.equal(isDateFormat('0%'), false)
  assert.equal(isDateFormat('General'), false)
  assert.equal(isDateFormat('"Day "0'), false)
  assert.equal(isDateFormat('[Red]0.00'), false)
  assert.deepEqual(cellRef('AB12'), { c: 27, r: 11 })
  assert.deepEqual(cellRef('$D$45'), { c: 3, r: 44 })
  assert.equal(colName(0), 'A'); assert.equal(colName(25), 'Z'); assert.equal(colName(27), 'AB')
})

// ---------------------------------------------------------------------------
// Cells → the tracker's values
// ---------------------------------------------------------------------------

test('mappings: colours, steps, taught, ✅⏳❌, dates, percentages, subjects, attempt kinds, sources', () => {
  assert.equal(I.parseColour('🔴'), 'not_secure'); assert.equal(I.parseColour('🟡'), 'understand'); assert.equal(I.parseColour('🟢'), 'exam_ready')
  assert.equal(I.parseColour('⚪'), 'not_started'); assert.equal(I.parseColour('green'), 'exam_ready'); assert.equal(I.parseColour(''), null)
  assert.equal(I.parseStep('3 Mixed exercise'), 3); assert.equal(I.parseStep('0 Not started'), 0); assert.equal(I.parseStep('Bicen exam Qs'), 4)
  assert.equal(I.parseStep(5), 5); assert.equal(I.parseStep(''), null); assert.equal(I.parseStep('9 nonsense'), null)
  assert.equal(I.parseTaught('Yes'), 'yes'); assert.equal(I.parseTaught('In class'), 'in_class'); assert.equal(I.parseTaught('Not yet'), 'not_yet'); assert.equal(I.parseTaught(null), null)
  assert.equal(I.parseProgress('✅'), 'done'); assert.equal(I.parseProgress('⏳'), 'doing'); assert.equal(I.parseProgress('❌'), 'todo'); assert.equal(I.parseProgress(''), null)
  assert.equal(I.parseItemStatus('Not started'), 'todo'); assert.equal(I.parseItemStatus('Done'), 'done'); assert.equal(I.parseItemStatus('In progress'), 'doing'); assert.equal(I.parseItemStatus('Skipped'), 'skipped')
  assert.equal(I.parseDate('2026-10-17'), '2026-10-17'); assert.equal(I.parseDate('17/10/2026'), '2026-10-17'); assert.equal(I.parseDate('2/11/26'), '2026-11-02')
  assert.equal(I.parseDate('Thu 12 Nov 26'), '2026-11-12'); assert.equal(I.parseDate('12 Nov', TODAY), '2026-11-12'); assert.equal(I.parseDate('3 Jan', TODAY), '2027-01-03')
  assert.equal(I.parseDate('31/02/2026'), null); assert.equal(I.parseDate('soon'), null); assert.equal(I.parseDate(46266), '2026-09-01')
  assert.equal(I.parsePct(80), 80); assert.equal(I.parsePct(0.85), 85); assert.equal(I.parsePct('72%'), 72); assert.equal(I.parsePct('8/10'), 80); assert.equal(I.parsePct(140), null)
  assert.deepEqual(I.parseScore('38/45'), { score: 38, outOf: 45 }); assert.deepEqual(I.parseScore(30), { score: 30, outOf: null })
  assert.equal(I.parseSubject('FM'), 'Further Maths'); assert.equal(I.parseSubject('Maths'), 'Maths'); assert.equal(I.parseSubject('Physics'), 'Physics'); assert.equal(I.parseSubject('Art'), null)
  assert.equal(I.parseAttemptWhat('Timed practice'), 'timed'); assert.equal(I.parseAttemptWhat('REAL TEST'), 'real'); assert.equal(I.parseAttemptWhat('booklet'), 'booklet')
  assert.equal(I.parseAttemptWhat('Past paper June 2024'), 'paper'); assert.equal(I.parseAttemptWhat('diagnostic'), 'diagnostic'); assert.equal(I.parseAttemptWhat('?'), 'other')
  assert.deepEqual(I.splitSource('Bicen CP1 Linear Transformations Q3b'), { source: 'Bicen CP1 Linear Transformations', question: 'Q3b' })
  assert.deepEqual(I.splitSource('Integral worksheet'), { source: 'Integral worksheet', question: null })
  assert.deepEqual(I.bookSection('Y1 red · 13'), { section: 'Book 1', n: 13 }); assert.deepEqual(I.bookSection('Y2 green · 7'), { section: 'Book 2', n: 7 })
  assert.deepEqual(I.bookSection('PC1 blue · 3'), { section: 'Pure Core 1', n: 3 }); assert.deepEqual(I.bookSection('PC2 blue · 1'), { section: 'Pure Core 2', n: 1 })
  assert.deepEqual(I.bookSection('Further Stats · 2'), { section: 'Statistics', n: 2 }); assert.deepEqual(I.bookSection('Further Mech · 4'), { section: 'Mechanics', n: 4 })
  assert.equal(I.bookSection('whatever'), null)
  assert.equal(I.niceTitle('FURTHER MATHS HT2 TEST'), 'Further Maths HT2 test'); assert.equal(I.niceTitle('PHYSICS – WAVES TEST'), 'Physics – waves test')
  assert.equal(I.stepResult('with hints', 'factor theorem'), 'solved: with hints · idea: factor theorem')
  assert.deepEqual(I.splitStepResult('solved: with hints · idea: factor theorem'), { solved: 'with hints', idea: 'factor theorem' })
  assert.deepEqual(I.splitStepResult('8/10'), { solved: '', idea: '8/10' })
})

// ---------------------------------------------------------------------------
// The parsed tracker (the made-up workbook, through the real reader)
// ---------------------------------------------------------------------------

const parsedFixture = () => I.parseTracker(readXlsx(xlsx(fixtureSheets())), TODAY)

test('parse: topics in school order with their fields; tests with codes, info, limits, minutes; mistakes; STEP; links; review gaps', () => {
  const p = parsedFixture()
  assert.deepEqual(p.tabs, ['Maths+FM', 'Physics', 'Tests & papers', 'Mistakes – practice', 'STEP', 'Start here'])
  assert.deepEqual(p.warnings, [])
  assert.deepEqual(p.topics.map((t) => t.code), ['Y1-01', 'Y1-13', 'PC1-01', 'PC1-03', 'Y2-07a', 'PC1-06', 'Y2-07', 'FS-02', 'P1.3', 'P3.1', 'P7.1', 'P9.1'])
  const diff = p.topics.find((t) => t.code === 'Y1-13')
  assert.equal(diff.subject, 'Maths'); assert.equal(diff.status, 'understand'); assert.equal(diff.step, 3); assert.equal(diff.freshPct, 70)
  assert.equal(diff.lastDone, '2026-10-10'); assert.equal(diff.taughtFrom, '2026-09-14'); assert.equal(diff.halfTerm, 'HT1'); assert.equal(diff.teacher, 'Teacher B')
  assert.equal(diff.bicen, 'Bicen Pure → AS: Differentiation', 'the HYPERLINK formula’s text'); assert.equal(diff.integralUrl, INTEGRAL_URL)
  assert.deepEqual(diff.section, { section: 'Book 1', n: 13 }); assert.equal(diff.weakNotes, 'chain rule signs'); assert.equal(diff.order, 2, 'its row in the tab: one sequence across Maths and FM')
  assert.equal(p.topics.find((t) => t.code === 'PC1-01').subject, 'Further Maths', '"FM" is Further Maths')
  const p31 = p.topics.find((t) => t.code === 'P3.1')
  assert.equal(p31.subject, 'Physics'); assert.equal(p31.strand, 'Dynamics'); assert.equal(p31.name, "Newton's laws of motion (momentum part later)")
  assert.equal(p31.taught, 'yes'); assert.equal(p31.status, 'not_secure'); assert.equal(p31.booklet, 'doing'); assert.equal(p31.freshPct, 55)
  assert.equal(p31.concepts, 'resultant force vs net'); assert.equal(p31.pmtRef, 'PMT topic 3'); assert.equal(p31.order, 2)
  assert.equal(p.topics.find((t) => t.code === 'P7.1').taught, 'in_class')
  assert.equal(p.topics.find((t) => t.code === 'P1.3').pmt, 'doing')

  assert.deepEqual(p.tests.map((t) => [t.title, t.date, t.kind, t.subject]), [
    ['Further Maths HT2 test', '2026-11-12', 'test', 'Further Maths'],
    ['Further Maths HT1 Consolidation', '2026-11-02', 'consolidation', 'Further Maths'],
    ['Physics – mechanics test', '2026-11-10', 'test', 'Physics'],
  ], 'the blank past-paper template is skipped')
  const [ht2, ht1, mech] = p.tests
  assert.deepEqual(ht2.topicCodes, ['PC1-01', 'PC1-03', 'Y1-13'])
  assert.equal(ht2.lengthMin, 50); assert.equal(ht2.marks, 45); assert.equal(ht2.limits, null, '"NOT through origin" is not a limit')
  assert.equal(ht2.info, ['50 min · ~45 marks · calculator · booklets on Classroom.', 'PC1-01: Booklet: Matrices', 'PC1-03: Booklet: Matrices', 'PC1-03: invariant lines NOT through origin'].join('\n'),
    'one line per topic note; "Same booklet" names the one before')
  assert.deepEqual(I.topicNoteLines('Y1-08', '', 'Booklets: exp-models, log-modelling', null), [{ text: 'Y1-08: Booklet: exp-models, log-modelling', booklet: 'exp-models, log-modelling' }])
  assert.deepEqual(I.topicNoteLines('P3.1', '✅', 'Newton only', null), [{ text: 'P3.1: Newton only', booklet: null }], 'a ✅ in the booklet column is progress, not a name')
  assert.deepEqual(I.topicNoteLines('P1.1', 'Mechanics booklet', '', null), [{ text: 'P1.1: Booklet: Mechanics booklet', booklet: 'Mechanics booklet' }])
  assert.deepEqual(ht2.attempts, [{ row: 13, doneOn: '2026-10-15', what: 'timed', label: 'Timed practice', score: 30, outOf: 45, notes: 'ran out of time' }], 'a row with no score yet is left out')
  assert.equal(ht2.mistakes.length, 2)
  assert.deepEqual({ ...ht2.mistakes[1], tab: undefined }, { tab: undefined, row: 18, loggedOn: null, code: 'Y1-13', question: 'Q5', body: 'Dropped a minus sign', kind: 'careless', rule: null, source: null, redoOn: '2026-10-18', redone: 1 })
  assert.equal(ht1.minutesPerDay, 30); assert.equal(ht1.minutesMax, 60)
  assert.deepEqual(ht1.topicCodes, ['PC1-01'], 'a consolidation’s topics come from its mistakes'); assert.deepEqual(ht1.topicNames, ['Matrices'])
  assert.equal(ht1.mistakes.length, 1)
  assert.match(ht1.info, /Further Maths HT1 test \(already sat\)/)
  assert.equal(mech.limits, "P3.1: Newton's laws only – no momentum"); assert.match(mech.info, /Teacher C side/)

  assert.equal(p.mistakes.length, 1)
  assert.deepEqual({ ...p.mistakes[0], tab: undefined }, { tab: undefined, row: 5, loggedOn: '2026-10-17', code: 'PC1-03', question: 'Q3b', body: 'Assumed the invariant line goes through the origin', kind: 'knowledge', rule: 'Use y = mx + c unless told it passes through O', source: 'Bicen CP1 Linear Transformations', redoOn: '2026-10-20', redone: 0 })

  assert.equal(p.programmes.length, 1)
  const st = p.programmes[0]
  assert.deepEqual([st.name, st.perWeek, st.minutes, st.days, st.subject, st.items.length], ['STEP', 1, 90, 'weekend', 'Maths', 3])
  assert.deepEqual(st.items[0], { row: 5, position: 1, title: 'STEP Support – Assignment 1', url: 'https://example.org/step/1', status: 'done', doneOn: '2026-10-11', minutes: 75, result: 'solved: with hints · idea: factor theorem trick' })
  assert.equal(st.items[2].position, 3, 'school order, "M" rows too')

  assert.deepEqual(p.links, { bicenStats: 'https://example.org/bicen/stats', madas: 'https://example.org/madas', step: 'https://example.org/step' }, 'empty yellow cells don’t count')
  assert.deepEqual(p.reviewDays, { not_secure: 2, understand: 3, exam_ready: 14, not_started: 7 })
})

test('parse: rows without a code, duplicate codes and dateless tests are skipped with a warning', () => {
  const wb = fixtureWorkbook()
  const maths = wb.sheets.find((s) => s.name === 'Maths+FM')
  maths.rows.push(['', 'Maths', 'Pure', null, null, null, null, null, 'A topic with no code'])
  maths.rows.push(['Y1-01', 'Maths', 'Pure', null, null, null, null, null, 'Proof again'])
  const tests = wb.sheets.find((s) => s.name === 'Tests & papers')
  tests.rows.push(['MY MOCK PAPER'], ['no date here'], ['Code', 'Topic', 'Colour', 'Teacher booklet', 'Notes'], ['Y1-01', 'Proof'])
  const p = I.parseTracker(wb, TODAY)
  assert.equal(p.topics.filter((t) => t.code === 'Y1-01').length, 1)
  assert.ok(p.warnings.some((w) => /A topic with no code/.test(w)))
  assert.ok(p.warnings.some((w) => /code Y1-01 is also on/.test(w)))
  assert.ok(p.warnings.some((w) => /MY MOCK PAPER.*no date/.test(w)))
  assert.equal(p.tests.length, 3)
})

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

test('plan: matches by book + chapter, keeps his colour and notes, archives the duplicate and moves its mistake, lists clashes', () => {
  const plan = I.buildImportPlan(parsedFixture(), fixtureCurrent(), TODAY)
  const c = plan.counts
  assert.deepEqual([c.topicsNew, c.topicsUpdated, c.topicsReordered, c.duplicatesArchived, c.mistakesMoved], [7, 5, 1, 1, 1])
  assert.deepEqual(plan.topics.create.map((x) => x.code), ['Y2-07a', 'PC1-06', 'FS-02', 'P1.3', 'P3.1', 'P7.1', 'P9.1'], 'Y2-07 takes "Radian measure"; Y2-07a is new')
  const upd = Object.fromEntries(plan.topics.update.map((u) => [u.id, u.patch]))
  // first import: the school's name and code replace the textbook seed's
  assert.equal(upd['t-proof'].name, 'Proof'); assert.equal(upd['t-proof'].code, 'Y1-01'); assert.equal(upd['t-proof'].teacher, 'Teacher A')
  assert.equal(upd['t-proof'].integral_url, INTEGRAL_URL); assert.equal(upd['t-proof'].book_ref, 'Y1 red · 1'); assert.equal(upd['t-proof'].sort_order, 1, 'row 1 of the tab')
  assert.equal(upd['t-app'].name, 'Applications of matrices (invariant lines NOT through origin too)')
  assert.equal(upd['t-rad'].code, 'Y2-07'); assert.equal(upd['t-rad'].sort_order, 7)
  // his 🔴 wins over the sheet's 🟡 (a clash); his note stays; the sheet fills the step, last done and %
  const d = upd['t-diff']
  assert.equal(d.status, undefined); assert.equal(d.weak_notes, undefined); assert.equal(d.step, 3); assert.equal(d.last_done, '2026-10-10'); assert.equal(d.fresh_pct, 70); assert.equal(d.sort_order, 2)
  // the duplicate "Matrices" (🟡, made by chat) is archived; its colour and date carry over; the sheet's 🟢 clashes
  assert.deepEqual(plan.topics.archive, [{ id: 't-mat-dup', label: 'Matrices', keptId: 't-mat', keptLabel: 'PC1-01 Matrices', mistakeIds: ['m-dup'] }])
  assert.equal(upd['t-mat'].status, 'understand'); assert.equal(upd['t-mat'].last_done, '2026-10-05'); assert.equal(upd['t-mat'].notes_url, undefined, 'its own GoodNotes link stays')
  // a topic the sheet doesn't list goes after the school order, with its strand
  assert.deepEqual(plan.topics.update.find((u) => u.id === 't-hyp'), { id: 't-hyp', label: 'Hyperbolic functions', patch: { sort_order: 1011, strand: 'Further Pure' }, reorderOnly: true })
  assert.deepEqual(plan.clashes, [
    'Y1-13 Differentiation: colour — app 🔴, sheet 🟡 → kept the app’s',
    'Y1-13 Differentiation: notes — app has its own, sheet differs → kept the app’s',
    'PC1-01 Matrices: colour — app 🟡, sheet 🟢 → kept the app’s',
    'Link “Bicen: 2 Statistics”: the app’s is different from the sheet’s → kept the app’s',
  ])
  // new topics carry everything; FM topics get "Section · n" so the maths view still groups them
  const fs = plan.topics.create.find((x) => x.code === 'FS-02').row
  assert.equal(fs.subject_id, IDS.fm); assert.equal(fs.spec_ref, 'Statistics · 2'); assert.equal(fs.strand, 'Further Stats'); assert.equal(fs.sort_order, 8)
  const p31 = plan.topics.create.find((x) => x.code === 'P3.1').row
  assert.deepEqual([p31.subject_id, p31.status, p31.status_at, p31.taught, p31.booklet, p31.concepts], [IDS.physics, 'not_secure', 'now', 'yes', 'doing', 'resultant force vs net'])
})

test('plan: tests, attempts, mistakes (never twice), STEP and settings', () => {
  const plan = I.buildImportPlan(parsedFixture(), fixtureCurrent(), TODAY)
  assert.deepEqual(plan.tests.create.map((t) => [t.row.title, t.row.target_date, t.row.test_kind, t.row.subject_id, t.row.topic_codes, t.row.source]), [
    ['Further Maths HT2 test', '2026-11-12', 'test', IDS.fm, ['PC1-01', 'PC1-03', 'Y1-13'], 'sheet'],
    ['Further Maths HT1 Consolidation', '2026-11-02', 'consolidation', IDS.fm, ['PC1-01'], 'sheet'],
    ['Physics – mechanics test', '2026-11-10', 'test', IDS.physics, ['P1.3', 'P3.1'], 'sheet'],
  ])
  const ht1 = plan.tests.create[1].row
  assert.deepEqual([ht1.kind, ht1.minutes_per_day, ht1.minutes_max, ht1.priority, ht1.status], ['test', 30, 60, 'normal', 'active'])
  assert.equal(plan.tests.create[0].row.topics, 'Matrices, Applications of matrices, Differentiation', 'the old maths view reads goals.topics')
  assert.deepEqual(plan.attempts.map((a) => [a.goalId, a.row]), [[null, { done_on: '2026-10-15', what: 'timed', label: 'Timed practice', score: 30, out_of: 45, notes: 'ran out of time' }]])
  // the practice tab's example is the mistake he already logged by chat (same code + question): not added again
  assert.deepEqual(plan.mistakes.map((m) => [m.code, m.row.question, m.row.kind, m.row.redo_stage, m.row.review_on, m.topicId, m.testKey !== null]), [
    ['PC1-03', 'Q3b', 'knowledge', 0, '2026-10-18', 't-app', true],
    ['Y1-13', 'Q5', 'careless', 1, '2026-10-25', 't-diff', true],
    ['PC1-01', 'Q4', 'knowledge', 0, '2026-10-20', 't-mat', true],
  ])
  assert.notEqual(plan.mistakes[2].testKey, plan.mistakes[0].testKey, 'Q4 belongs to the HT1 consolidation')
  assert.equal(plan.mistakes[0].row.subject_id, IDS.fm)
  assert.equal(plan.mistakes[0].row.logged_on, '2026-10-15', 'no date: 3 days before its redo date')
  const step = plan.programmes.create[0]
  assert.deepEqual(step.row, { name: 'STEP', area: 'study', subject_id: IDS.maths, per_week: 1, minutes: 90, days: 'weekend', status: 'active', mode: 'in_order', notes: step.row.notes })
  assert.match(step.row.notes, /Attempt properly first/)
  assert.deepEqual(step.items[0], { position: 1, title: 'STEP Support – Assignment 1', url: 'https://example.org/step/1', minutes: 75, status: 'done', done_on: '2026-10-11', result: 'solved: with hints · idea: factor theorem trick' })
  assert.deepEqual(plan.settings, [
    { key: 'linkMadas', value: 'https://example.org/madas', label: 'Link: MadAs' },
    { key: 'linkStep', value: 'https://example.org/step', label: 'Link: STEP Support' },
    { key: 'reviewRedDays', value: 2, label: '🔴 review after 2 days' },
  ], 'his own Bicen stats link stays; review gaps equal to the defaults aren’t saved')
  assert.deepEqual(I.planSummary(plan), [
    'Add 7 new topics',
    'Update 5 topics (codes, teachers, dates, Bicen sections — your colours and notes stay)',
    'Put 1 topic in school order',
    'Archive 1 duplicate topic (their 1 mistake move to the kept topic)',
    'Add 3 tests: Further Maths HT2 test (Thu 12 Nov) · Further Maths HT1 Consolidation (Mon 2 Nov) · Physics – mechanics test (Tue 10 Nov)',
    'Add 1 test score',
    'Add 3 mistakes to redo',
    'Add the STEP programme (3 items, 1 a week, weekend)',
    'Save 3 settings: Link: MadAs · Link: STEP Support · 🔴 review after 2 days',
  ])
})

test('plan: importing the same file again changes nothing (only the same clashes are listed)', () => {
  const parsed = parsedFixture()
  const first = I.buildImportPlan(parsed, fixtureCurrent(), TODAY)
  const after = simulateApply(fixtureCurrent(), first)
  const again = I.buildImportPlan(parsed, after, TODAY)
  assert.deepEqual(I.planSummary(again), [])
  assert.equal(I.planIsEmpty(again), true)
  assert.equal(again.topics.same, 5 + 7)
  assert.equal(again.tests.same, 3)
  assert.deepEqual(again.clashes, first.clashes)
  // and a third time, from that state
  assert.deepEqual(I.planSummary(I.buildImportPlan(parsed, simulateApply(after, again), TODAY)), [])
})

test('plan: tests he already has are filled in (not doubled); a different date is a clash; STEP moves forward only', () => {
  const cur = fixtureCurrent()
  cur.tests.push({ id: 'g-ht2', title: 'FM HT2', date: '2026-11-11', subjectId: IDS.fm, testKind: null, info: null, topicCodes: ['PC1-01'], topics: null, minutesPerDay: null, minutesMax: null, limits: null, lengthMin: null, marks: null, source: 'classroom', sourceRef: 'classroom:abc' })
  cur.tests.push({ id: 'g-mech', title: 'Physics – mechanics test', date: '2026-11-10', subjectId: IDS.physics, testKind: 'test', info: 'my info', topicCodes: [], topics: null, minutesPerDay: null, minutesMax: null, limits: null, lengthMin: null, marks: null, source: null, sourceRef: null })
  cur.attempts.push({ id: 'a1', goalId: 'g-mech', doneOn: '2026-10-01', what: 'diagnostic', score: 5, outOf: 10 })
  cur.programmes.push({ id: 'p-step', name: 'STEP Support', items: [
    { id: 'i1', position: 1, title: 'STEP Support – Assignment 1', status: 'todo', doneOn: null, minutes: null, result: null, url: null },
    { id: 'i2', position: 2, title: 'STEP Support – Assignment 2', status: 'done', doneOn: '2026-10-18', minutes: 80, result: 'solved: yes', url: null },
  ] })
  const plan = I.buildImportPlan(parsedFixture(), cur, TODAY)
  assert.deepEqual(plan.tests.create.map((t) => t.row.title), ['Further Maths HT2 test', 'Further Maths HT1 Consolidation'], 'the mechanics test matched by name')
  assert.deepEqual(plan.tests.update.map((u) => [u.id, u.patch]), [['g-mech', {
    topic_codes: ['P1.3', 'P3.1'], topics: "Errors and uncertainties, Newton's laws of motion", limits: "P3.1: Newton's laws only – no momentum", source: 'sheet', source_ref: 'sheet:physics mechanics test teacher c side',
  }]], 'his own info stays')
  // HT2 on the 11th in the app isn't the sheet's 12th: a new test, no clash (not the same test)
  assert.equal(plan.programmes.create.length, 0, 'STEP exists already')
  assert.deepEqual(plan.programmes.updateItems, [
    { id: 'i1', label: 'STEP Support: STEP Support – Assignment 1', patch: { status: 'done', done_on: '2026-10-11', result: 'solved: with hints · idea: factor theorem trick', minutes: 75, url: 'https://example.org/step/1' } },
    { id: 'i2', label: 'STEP Support: STEP Support – Assignment 2', patch: { url: 'https://example.org/step/2' } },
  ], 'item 2 stays done (the sheet says not started); only its missing link is filled')
  assert.deepEqual(plan.programmes.addItems.map((a) => a.items.map((i) => [i.position, i.title])), [[[3, 'Mixed Pure STEP 1 questions']]])

  // the same HT2 test on the same date (made by Classroom) is updated, codes added to his; a date change is a clash
  cur.tests[0].date = '2026-11-12'
  const p2 = I.buildImportPlan(parsedFixture(), cur, TODAY)
  assert.equal(p2.tests.create.length, 1)
  const u = p2.tests.update.find((x) => x.id === 'g-ht2')
  assert.deepEqual(u.patch.topic_codes, ['PC1-01', 'PC1-03', 'Y1-13'])
  assert.equal(u.patch.test_kind, 'test'); assert.equal(u.patch.source, undefined, 'it came from Classroom'); assert.equal(u.patch.source_ref, undefined)
  cur.tests[0].sourceRef = 'sheet:further maths ht2 test'; cur.tests[0].date = '2026-11-13'
  const p3 = I.buildImportPlan(parsedFixture(), cur, TODAY)
  assert.ok(p3.clashes.includes('FM HT2: date — app Fri 13 Nov, sheet Thu 12 Nov → kept the app’s'))
})

test('plan: a missing subject is added (or brought back from the archive) and its topics go in it', () => {
  const cur = fixtureCurrent()
  cur.subjects = cur.subjects.filter((s) => s.name !== 'Physics')
  let plan = I.buildImportPlan(parsedFixture(), cur, TODAY)
  assert.deepEqual(plan.subjects, [{ name: 'Physics', restoreId: null, categoryId: IDS.cat }])
  assert.equal(plan.topics.create.find((x) => x.code === 'P1.3').row.subject_id, null, 'filled in once the subject is saved')
  cur.subjects.push({ id: 'old-phys', name: 'physics', categoryId: IDS.cat, archived: true })
  plan = I.buildImportPlan(parsedFixture(), cur, TODAY)
  assert.deepEqual(plan.subjects, [{ name: 'Physics', restoreId: 'old-phys', categoryId: IDS.cat }])
  assert.equal(plan.topics.create.find((x) => x.code === 'P1.3').row.subject_id, 'old-phys')
})

test('plan: a later import keeps his edits (app wins, clash listed) and moves progress forward', () => {
  const parsed = parsedFixture()
  const after = simulateApply(fixtureCurrent(), I.buildImportPlan(parsed, fixtureCurrent(), TODAY))
  const proof = after.topics.find((t) => t.code === 'Y1-01')
  proof.teacher = 'Teacher Z'; proof.name = 'Proof (my name)'; proof.step = 2
  const p13 = after.topics.find((t) => t.code === 'P1.3')
  p13.pmt = 'done'
  const p71 = after.topics.find((t) => t.code === 'P7.1')
  const sheet = structuredClone(parsed)
  sheet.topics.find((t) => t.code === 'P7.1').taught = 'yes'           // school moved on
  sheet.topics.find((t) => t.code === 'Y1-01').step = 4
  const plan = I.buildImportPlan(sheet, after, TODAY)
  assert.ok(plan.clashes.includes('Y1-01 Proof: name — app “Proof (my name)”, sheet “Proof” → kept the app’s'))
  assert.ok(plan.clashes.includes('Y1-01 Proof: teacher — app “Teacher Z”, sheet “Teacher A” → kept the app’s'))
  assert.ok(plan.clashes.includes('Y1-01 Proof: step — app Textbook exercise, sheet Bicen exam Qs → kept the app’s'))
  assert.deepEqual(plan.topics.update.map((u) => [u.id, u.patch]), [[p71.id, { taught: 'yes' }]], 'P1.3’s PMT stays ✅ (the sheet’s ⏳ is behind it); only P7.1 moves on')
})

// ---------------------------------------------------------------------------
// The real spreadsheet (only on Nat's PC; never committed)
// ---------------------------------------------------------------------------

test('the real tracker: 60 Maths+FM + 32 Physics topics, 4 tests with their dates, 28 STEP items; a seeded app matches 59 topics; idempotent', { skip: existsSync(REAL) ? false : 'the spreadsheet isn’t on this PC' }, () => {
  const p = I.parseTracker(readXlsx(readFileSync(REAL)), TODAY)
  assert.deepEqual(p.warnings, [])
  assert.equal(p.topics.filter((t) => t.subject !== 'Physics').length, 60)
  assert.equal(p.topics.filter((t) => t.subject === 'Physics').length, 32)
  assert.deepEqual(p.tests.map((t) => [t.date, t.kind, t.subject]), [
    ['2026-11-12', 'test', 'Further Maths'], ['2026-11-02', 'consolidation', 'Further Maths'], ['2026-11-10', 'test', 'Physics'], ['2026-11-12', 'test', 'Physics'],
  ])
  assert.deepEqual([p.tests[1].minutesPerDay, p.tests[1].minutesMax], [30, 60])
  assert.equal(p.tests[0].topicCodes.length, 6); assert.equal(p.tests[2].topicCodes.length, 9); assert.equal(p.tests[3].topicCodes.length, 7)
  assert.match(p.tests[2].limits ?? '', /no momentum/)
  assert.equal(p.programmes[0].items.length, 28)
  assert.equal(p.mistakes.length, 1, 'the example mistake on row 5')
  assert.equal(Object.keys(p.links).length >= 6, true)
  // against the textbook seed (lib/maths.ts SEED) in Maths and Further Maths, Physics empty
  let k = 0
  const cur = fixtureCurrent()
  cur.topics = [['Maths', IDS.maths], ['Further Maths', IDS.fm]].flatMap(([sub, id]) => seedRows(sub).map((r) => ({ ...fixtureCurrent().topics[0], id: `seed${k++}`, subjectId: id, name: r.name, specRef: r.spec_ref, sortOrder: r.sort_order })))
  cur.mistakes = []; cur.planning = {}
  const plan = I.buildImportPlan(p, cur, TODAY)
  assert.deepEqual([plan.counts.topicsNew, plan.counts.topicsUpdated, plan.counts.topicsReordered, plan.counts.duplicatesArchived, plan.counts.testsNew, plan.counts.programmeItemsNew, plan.counts.mistakesNew], [33, 59, 21, 0, 4, 28, 1])
  assert.deepEqual(plan.clashes, [])
  const again = I.buildImportPlan(p, simulateApply(cur, plan), TODAY)
  assert.deepEqual(I.planSummary(again), [], 'the second import changes nothing')
})

test('the real tracker’s header rows are the ones the parser and the export use', { skip: existsSync(REAL) ? false : 'the spreadsheet isn’t on this PC' }, () => {
  const wb = readXlsx(readFileSync(REAL))
  assert.deepEqual(wb.sheets.find((s) => s.name === 'Maths+FM').rows[3], MATHS_HEAD)
  assert.deepEqual(wb.sheets.find((s) => s.name === 'Physics').rows[3], PHYSICS_HEAD)
})
