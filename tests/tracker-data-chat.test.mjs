// The study tracker against the TEST database, as Nat under row level security (plans/contracts.md §3.3):
// the import (preview saves nothing → confirm saves exactly the preview → importing again changes nothing; duplicates
// archived, never deleted, their mistakes moved), loadStudyWorld (everything the planner needs), the Subjects page's
// colour change + Undo, the export, and a stranger who can neither see nor change any of it. Made-up data only
// (tests/tracker-import-fixture.mjs); the real spreadsheet is imported only if it's on this PC (local test DB only).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/tracker-data-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { useChat } from './support/chat.mjs'
import { testEnv, OWNER_EMAIL, STRANGER_EMAIL } from './support/testdb.mjs'
import { xlsx, fixtureSheets } from './tracker-import-fixture.mjs'
import { seedRows } from '../lib/maths.ts'

const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a)
const TODAY = '2026-10-19'
const REAL = 'C:/Users/Nat/natos/assets/Nat-Study-Tracker-FINAL.xlsx'

const noStore = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
/** A signed-in client for one of the test users (anon key + their session: row level security applies). */
async function signIn(email) {
  const { env } = testEnv()
  const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SECRET_KEY, noStore)
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const sb = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_ANON_KEY, noStore)
  const { error: e2 } = await sb.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
  if (e2) throw e2
  return sb
}
const lib = async () => ({
  run: await import('../app/api/tracker/import/run.ts'),
  data: await import('../lib/tracker/data.ts'),
  csv: await import('../lib/tracker/csv.ts'),
})
const subject = async (name, uid = chat.users.owner) => (await q(`select id from subjects where name = $1 and user_id = $2`, [name, uid]))[0].id

/** His data before the import: a few textbook topics, a "Matrices" he added by chat (🟡, with a mistake), a mistake on PC1-03. */
async function seedSmall() {
  const m = await subject('Maths'), f = await subject('Further Maths')
  const t = async (subject_id, name, spec_ref, sort_order, more = {}) => (await chat.add('topics', { subject_id, name, spec_ref, sort_order, ...more })).id
  const ids = {
    proof: await t(m, 'Proof & mathematical communication', 'Book 1 · 1', 0),
    diff: await t(m, 'Differentiation', 'Book 1 · 13', 12, { status: 'not_secure', status_at: '2026-10-01T10:00:00Z', weak_notes: 'my own note' }),
    rad: await t(m, 'Radian measure', 'Book 2 · 7', 28),
    mat: await t(f, 'Matrices', 'Pure Core 1 · 1', 0, { notes_url: 'https://example.org/goodnotes/matrices' }),
    dup: await t(f, 'Matrices', null, 40, { status: 'understand', status_at: '2026-10-05T10:00:00Z', last_done: '2026-10-05' }),
    app: await t(f, 'Applications of matrices', 'Pure Core 1 · 3', 2),
    hyp: await t(f, 'Hyperbolic functions', 'Pure Core 2 · 6', 11),
  }
  const mk = async (topic_id, body, more = {}) => (await chat.add('mistakes', { subject_id: f, topic_id, body, review_on: '2026-10-22', ...more })).id
  ids.dupMistake = await mk(ids.dup, 'det sign wrong')
  ids.chatMistake = await mk(ids.app, 'assumed through origin', { code: 'PC1-03', question: 'Q3b' })
  // the stranger's own Matrices topic, which nothing here may touch
  const sf = await subject('Further Maths', chat.users.stranger)
  ids.theirs = (await q(`insert into topics (user_id, subject_id, name, spec_ref, sort_order) values ($1, $2, 'Matrices', 'Pure Core 1 · 1', 0) returning id`, [chat.users.stranger, sf]))[0].id
  return ids
}
const counts = async () => (await q(`select
  (select count(*)::int from topics where user_id = $1) topics, (select count(*)::int from topics where user_id = $1 and code is not null) coded,
  (select count(*)::int from goals where user_id = $1) goals, (select count(*)::int from test_attempts where user_id = $1) attempts,
  (select count(*)::int from mistakes where user_id = $1) mistakes, (select count(*)::int from programmes where user_id = $1) programmes,
  (select count(*)::int from programme_items where user_id = $1) items`, [chat.users.owner]))[0]

test('import: the preview saves nothing; Confirm saves exactly what was previewed; duplicates are archived with their mistakes; again = no change', { skip }, async () => {
  const { run } = await lib()
  const ids = await seedSmall()
  const nat = await signIn(OWNER_EMAIL)
  const bytes = xlsx(fixtureSheets())
  const before = await counts()

  const pre = await run.runImport(nat, bytes, 'preview', null, TODAY)
  assert.equal(pre.status, 200)
  assert.equal(pre.body.ready, true)
  assert.equal(pre.body.empty, false)
  assert.deepEqual(pre.body.found, { tabs: ['Maths+FM', 'Physics', 'Tests & papers', 'Mistakes – practice', 'STEP', 'Start here'], topics: 12, tests: 3, mistakes: 4, items: 3 })
  const c = pre.body.counts
  assert.deepEqual([c.topicsNew, c.topicsUpdated, c.topicsReordered, c.duplicatesArchived, c.mistakesMoved, c.testsNew, c.attemptsNew, c.mistakesNew, c.programmesNew, c.programmeItemsNew, c.settings], [7, 5, 1, 1, 1, 3, 1, 3, 1, 3, 4])
  assert.deepEqual(pre.body.clashes, ['Y1-13 Differentiation: colour — app 🔴, sheet 🟡 → kept the app’s', 'Y1-13 Differentiation: notes — app has its own, sheet differs → kept the app’s', 'PC1-01 Matrices: colour — app 🟡, sheet 🟢 → kept the app’s'])
  assert.deepEqual(await counts(), before, 'the preview saved nothing')

  const wrong = await run.runImport(nat, bytes, 'confirm', 'not-the-preview', TODAY)
  assert.equal(wrong.status, 409)
  assert.match(wrong.body.error, /changed since that preview/)
  assert.equal(wrong.body.preview.fingerprint, pre.body.fingerprint)
  assert.deepEqual(await counts(), before, 'a confirm that doesn’t match the preview saves nothing')

  const done = await run.runImport(nat, bytes, 'confirm', pre.body.fingerprint, TODAY)
  assert.equal(done.status, 200, JSON.stringify(done.body))
  const s = done.body.saved
  assert.deepEqual([s.topicsNew, s.topicsUpdated, s.topicsReordered, s.duplicatesArchived, s.mistakesMoved, s.testsNew, s.attemptsNew, s.mistakesNew, s.programmesNew, s.programmeItemsNew, s.settings], [7, 5, 1, 1, 1, 3, 1, 3, 1, 3, 4])
  assert.deepEqual(done.body.lines, ['7 new topics', '5 topics updated', '1 topic put in school order', '1 duplicate archived', '1 mistake moved to the kept topic', '3 new tests', '1 test score', '3 mistakes to redo', '1 programme', '3 programme items', '4 settings'])

  // what's in the database now
  const after = await counts()
  assert.equal(after.topics, before.topics + 7, 'nothing deleted: the duplicate is still there, archived')
  const [dup] = await q(`select archived_at from topics where id = $1`, [ids.dup])
  assert.ok(dup.archived_at, 'the duplicate is archived')
  assert.deepEqual(await q(`select topic_id from mistakes where id = $1`, [ids.dupMistake]), [{ topic_id: ids.mat }], 'its mistake moved to the kept topic')
  const [mat] = await q(`select code, name, status, last_done::text, sort_order, notes_url, teacher, step from topics where id = $1`, [ids.mat])
  assert.deepEqual(mat, { code: 'PC1-01', name: 'Matrices', status: 'understand', last_done: '2026-10-05', sort_order: 3, notes_url: 'https://example.org/goodnotes/matrices', teacher: 'Teacher A', step: 0 })
  const [diff] = await q(`select code, status, weak_notes, step, fresh_pct, last_done::text, taught_from::text from topics where id = $1`, [ids.diff])
  assert.deepEqual(diff, { code: 'Y1-13', status: 'not_secure', weak_notes: 'my own note', step: 3, fresh_pct: 70, last_done: '2026-10-10', taught_from: '2026-09-14' })
  assert.deepEqual(await q(`select name from topics where id = $1`, [ids.proof]), [{ name: 'Proof' }])
  assert.deepEqual(await q(`select sort_order, strand from topics where id = $1`, [ids.hyp]), [{ sort_order: 1011, strand: 'Further Pure' }])
  const phys = await q(`select code, taught, booklet, status from topics t join subjects s on s.id = t.subject_id where s.name = 'Physics' and t.user_id = $1 order by t.sort_order`, [chat.users.owner])
  assert.deepEqual(phys.map((r) => r.code), ['P1.3', 'P3.1', 'P7.1', 'P9.1'])
  assert.deepEqual(phys[1], { code: 'P3.1', taught: 'yes', booklet: 'doing', status: 'not_secure' })
  const tests = await q(`select title, target_date::text d, test_kind, topic_codes, minutes_per_day, minutes_max, limits, length_min, marks, source from goals where user_id = $1 order by target_date`, [chat.users.owner])
  assert.deepEqual(tests.map((t) => [t.title, t.d, t.test_kind]), [['Further Maths HT1 Consolidation', '2026-11-02', 'consolidation'], ['Physics – mechanics test', '2026-11-10', 'test'], ['Further Maths HT2 test', '2026-11-12', 'test']])
  assert.deepEqual([tests[0].minutes_per_day, tests[0].minutes_max], [30, 60])
  assert.deepEqual(tests[2].topic_codes, ['PC1-01', 'PC1-03', 'Y1-13'])
  assert.equal(tests[1].limits, "P3.1: Newton's laws only – no momentum")
  const [att] = await q(`select a.done_on::text d, a.what, a.score::float, a.out_of::float, g.title from test_attempts a join goals g on g.id = a.goal_id`)
  assert.deepEqual(att, { d: '2026-10-15', what: 'timed', score: 30, out_of: 45, title: 'Further Maths HT2 test' })
  const ms = await q(`select m.code, m.question, m.kind, m.redo_stage, m.review_on::text r, g.title, t.code tcode from mistakes m left join goals g on g.id = m.goal_id left join topics t on t.id = m.topic_id where m.goal_id is not null order by m.question`)
  assert.deepEqual(ms, [
    { code: 'PC1-03', question: 'Q3b', kind: 'knowledge', redo_stage: 0, r: '2026-10-18', title: 'Further Maths HT2 test', tcode: 'PC1-03' },
    { code: 'PC1-01', question: 'Q4', kind: 'knowledge', redo_stage: 0, r: '2026-10-20', title: 'Further Maths HT1 Consolidation', tcode: 'PC1-01' },
    { code: 'Y1-13', question: 'Q5', kind: 'careless', redo_stage: 1, r: '2026-10-25', title: 'Further Maths HT2 test', tcode: 'Y1-13' },
  ])
  const items = await q(`select i.position, i.title, i.status, i.result from programme_items i join programmes p on p.id = i.programme_id where p.name = 'STEP' order by position`)
  assert.equal(items.length, 3)
  assert.deepEqual(items[0], { position: 1, title: 'STEP Support – Assignment 1', status: 'done', result: 'solved: with hints · idea: factor theorem trick' })
  const [prof] = await q(`select planning from profiles where user_id = $1`, [chat.users.owner])
  assert.equal(prof.planning.linkMadas, 'https://example.org/madas'); assert.equal(prof.planning.reviewRedDays, 2); assert.equal(prof.planning.linkBicenStats, 'https://example.org/bicen/stats')

  // the stranger's data is untouched
  assert.deepEqual(await q(`select code, archived_at from topics where id = $1`, [ids.theirs]), [{ code: null, archived_at: null }])
  assert.deepEqual(await q(`select count(*)::int n from goals where user_id = $1`, [chat.users.stranger]), [{ n: 0 }])

  // again: nothing changes
  const again = await run.runImport(nat, bytes, 'preview', null, TODAY)
  assert.equal(again.body.empty, true, JSON.stringify(again.body.summary))
  assert.deepEqual(again.body.summary, [])
  const snapshot = await counts()
  const again2 = await run.runImport(nat, bytes, 'confirm', again.body.fingerprint, TODAY)
  assert.equal(again2.status, 200)
  assert.deepEqual(again2.body.lines, [])
  assert.deepEqual(await counts(), snapshot)
})

test('import: signed-in only checks are the route’s; bad files are refused with a clear message and nothing saved', { skip }, async () => {
  const { run } = await lib()
  const nat = await signIn(OWNER_EMAIL)
  const before = await counts()
  const r1 = await run.runImport(nat, Buffer.from('hello, not a spreadsheet'), 'preview', null, TODAY)
  assert.equal(r1.status, 400); assert.match(r1.body.error, /isn’t an \.xlsx/)
  const r2 = await run.runImport(nat, new Uint8Array(), 'preview', null, TODAY)
  assert.equal(r2.status, 400); assert.match(r2.body.error, /empty/)
  const r3 = await run.runImport(nat, xlsx([{ name: 'Budget', rows: [['Item', 'Cost'], ['Boots', 60]] }]), 'confirm', 'x', TODAY)
  assert.equal(r3.status, 400); assert.match(r3.body.error, /Nothing to import/)
  assert.deepEqual(await counts(), before)
})

test('loadStudyWorld as Nat: topics, tests + attempts, open mistakes, programmes, rules, homework, done picks, links; the stranger sees none of it', { skip }, async () => {
  const { run, data } = await lib()
  await seedSmall()
  const nat = await signIn(OWNER_EMAIL)
  const bytes = xlsx(fixtureSheets())
  const pre = await run.runImport(nat, bytes, 'preview', null, TODAY)
  assert.equal((await run.runImport(nat, bytes, 'confirm', pre.body.fingerprint, TODAY)).status, 200)
  const f = await subject('Further Maths'), p = await subject('Physics')
  // homework: a Classroom assignment and a tutor's sheet count; his own errand, a prep session and Someday don't
  for (const t of [
    { title: 'Matrices worksheet', origin: 'school', source: 'import', external_id: 'classroom:abc', subject_id: f, status: 'this_week', due_at: '2026-10-22T12:00:00Z', importance: 'must' },
    { title: 'Kinematics questions', origin: 'tutor_maths_physics', subject_id: p, status: 'today', due_at: '2026-10-20T12:00:00Z', duration_minutes: 30 },
    { title: 'Buy boots', origin: 'own', status: 'today' },
    { title: 'Test prep 1', origin: 'school', subject_id: f, status: 'today', is_system: true },
    { title: 'Read ahead homework', origin: 'own', status: 'someday' },
  ]) await chat.add('tasks', t)
  await chat.add('plan_rules', { words: 'pause getting ahead until 25 Oct', kind: 'pause', target: 'ahead', starts_on: '2026-10-19', ends_on: '2026-10-25' })
  await chat.add('plan_blocks', { plan_id: '00000000-0000-0000-0000-000000000001', on_date: TODAY, start_time: '16:00', end_time: '17:00', title: 'Matrices exam Qs', status: 'done', pick_key: 'topic:x:review' })
  await chat.add('plan_blocks', { plan_id: '00000000-0000-0000-0000-000000000001', on_date: TODAY, start_time: '17:00', end_time: '18:00', title: 'Later', status: 'planned', pick_key: 'topic:y:ahead' })

  await chat.add('programmes', { name: 'Complete Guide to ACT English', area: 'act', per_week: 3, minutes: 30 })
  const w = await data.loadStudyWorld(nat, TODAY)
  assert.equal(w.today, TODAY)
  assert.ok(!w.programmes.some((x) => x.area === 'act'), 'ACT books are left to lib/act')
  assert.equal((await data.loadTrackerData(nat, TODAY)).allProgrammes.length, 2, 'the export still has them')
  const codes = w.topics.map((t) => t.code)
  for (const c of ['Y1-01', 'Y1-13', 'PC1-01', 'PC1-03', 'Y2-07a', 'PC1-06', 'Y2-07', 'FS-02', 'P1.3', 'P3.1', 'P7.1', 'P9.1']) assert.ok(codes.includes(c), c)
  assert.equal(w.topics.filter((t) => t.name === 'Matrices').length, 1, 'the archived duplicate is gone from the world')
  const diff = w.topics.find((t) => t.code === 'Y1-13')
  assert.deepEqual([diff.subject, diff.status, diff.step, diff.freshPct, diff.lastDone, diff.taughtFrom, diff.strand, diff.teacher, diff.halfTerm, diff.bookRef, diff.order],
    ['Maths', 'not_secure', 3, 70, '2026-10-10', '2026-09-14', 'Pure', 'Teacher B', 'HT1', 'Y1 red · 13', 2])
  const p31 = w.topics.find((t) => t.code === 'P3.1')
  assert.deepEqual([p31.subject, p31.taught, p31.booklet, p31.concepts, p31.pmtRef], ['Physics', 'yes', 'doing', 'resultant force vs net', 'PMT topic 3'])
  const ht2 = w.tests.find((t) => t.title === 'Further Maths HT2 test')
  assert.deepEqual([ht2.date, ht2.kind, ht2.subject, ht2.topicCodes, ht2.lengthMin, ht2.marks], ['2026-11-12', 'test', 'Further Maths', ['PC1-01', 'PC1-03', 'Y1-13'], 50, 45])
  assert.deepEqual(ht2.attempts.map((a) => [a.doneOn, a.what, a.score, a.outOf, a.label]), [['2026-10-15', 'timed', 30, 45, 'Timed practice']])
  assert.equal(w.tests.find((t) => t.kind === 'consolidation').minutesPerDay, 30)
  assert.deepEqual(w.mistakes.map((m) => [m.code, m.question, m.redoStage]).sort(), [['PC1-01', null, 0], ['PC1-01', 'Q4', 0], ['PC1-03', 'Q3b', 0], ['PC1-03', 'Q3b', 0], ['Y1-13', 'Q5', 1]].sort(),
    'the moved duplicate mistake (now under PC1-01), his chat one, the two from the HT2 test and the HT1 one')
  const ht1 = w.tests.find((t) => t.kind === 'consolidation')
  assert.deepEqual(ht1.topicCodes, ['PC1-01'])
  assert.equal(w.mistakes.find((m) => m.question === 'Q4').goalId, ht1.id, 'the planner finds a consolidation’s mistakes by goal')
  assert.equal(w.mistakes.find((m) => m.question === 'Q5').goalId, ht2.id)
  assert.deepEqual(w.programmes.map((x) => [x.name, x.perWeek, x.minutes, x.days, x.status, x.mode, x.items.map((i) => i.position)]), [['STEP', 1, 90, 'weekend', 'active', 'in_order', [1, 2, 3]]])
  assert.deepEqual(w.rules.map((r) => [r.kind, r.target, r.startsOn, r.endsOn]), [['pause', 'ahead', '2026-10-19', '2026-10-25']])
  assert.deepEqual(w.homework.map((h) => [h.title, h.subject, h.minutes]), [['Kinematics questions', 'Physics', 30], ['Matrices worksheet', 'Further Maths', null]], 'earliest first')
  assert.deepEqual(w.doneToday, ['topic:x:review'])
  assert.equal(w.links.madas, 'https://example.org/madas'); assert.equal(w.links.bicenPure, '')
  assert.deepEqual(w.reviewDays, { not_secure: 2, understand: 3, exam_ready: 14, not_started: 7 })

  // the stranger: none of Nat's rows, only their own topic
  const them = await signIn(STRANGER_EMAIL)
  const tw = await data.loadStudyWorld(them, TODAY)
  assert.deepEqual(tw.topics.map((t) => [t.name, t.code]), [['Matrices', null]])
  assert.deepEqual([tw.tests, tw.mistakes, tw.programmes, tw.rules, tw.homework, tw.doneToday], [[], [], [], [], [], []])
})

test('the stranger can’t change Nat’s tracker: an import plan naming his rows saves nothing of his', { skip }, async () => {
  const { run, data } = await lib()
  await seedSmall()
  const nat = await signIn(OWNER_EMAIL)
  const them = await signIn(STRANGER_EMAIL)
  const bytes = xlsx(fixtureSheets())
  // Nat's plan (his topic ids), saved with the stranger's session
  const { buildImportPlan, parseTracker } = await import('../lib/tracker/import.ts')
  const { readXlsx } = await import('../lib/tracker/xlsx.ts')
  const plan = buildImportPlan(parseTracker(readXlsx(bytes), TODAY), await data.loadImportCurrent(nat), TODAY)
  const before = await counts()
  const r = await data.applyImport(them, plan, true)
  assert.equal(r.ok, false)
  assert.match(r.error, /Stopped while saving/)
  assert.equal(r.saved.duplicatesArchived + r.saved.topicsUpdated + r.saved.mistakesMoved, 0, 'row level security hid all of his rows')
  assert.deepEqual(await counts(), before, 'nothing of Nat’s changed')
  assert.deepEqual(await q(`select count(*)::int n from topics where user_id = $1 and archived_at is not null`, [chat.users.owner]), [{ n: 0 }])
  // and the stranger's own import only ever writes the stranger's rows
  const pre = await run.runImport(them, bytes, 'preview', null, TODAY)
  const done = await run.runImport(them, bytes, 'confirm', pre.body.fingerprint, TODAY)
  assert.equal(done.status, 200, JSON.stringify(done.body))
  assert.deepEqual(await counts(), before, 'Nat’s counts are the same')
  assert.ok((await q(`select count(*)::int n from topics where user_id = $1 and code is not null`, [chat.users.stranger]))[0].n >= 12)
})

test('Subjects page: a colour change is saved with last done = today, and Undo puts it back; the export reads the database', { skip }, async () => {
  const { run, data, csv } = await lib()
  const ids = await seedSmall()
  const nat = await signIn(OWNER_EMAIL)
  const bytes = xlsx(fixtureSheets())
  const pre = await run.runImport(nat, bytes, 'preview', null, TODAY)
  await run.runImport(nat, bytes, 'confirm', pre.body.fingerprint, TODAY)
  const r = await data.setTopicColour(nat, ids.app, 'understand', TODAY)
  assert.equal(r.error, undefined)
  assert.deepEqual(await q(`select status, last_done::text d from topics where id = $1`, [ids.app]), [{ status: 'understand', d: TODAY }])
  assert.equal(await data.restoreTopicColour(nat, r.before, 'understand'), null)
  assert.deepEqual(await q(`select status, last_done from topics where id = $1`, [ids.app]), [{ status: 'not_started', last_done: null }])
  // Undo only puts it back while it's still the colour that was set: changed since (by the bot, say) → skipped
  const r2 = await data.setTopicColour(nat, ids.app, 'not_secure', TODAY)
  await q(`update topics set status = 'exam_ready' where id = $1`, [ids.app])
  assert.match(await data.restoreTopicColour(nat, r2.before, 'not_secure'), /Undo skipped/)
  assert.deepEqual(await q(`select status from topics where id = $1`, [ids.app]), [{ status: 'exam_ready' }], 'the newer colour stays')
  const them = await signIn(STRANGER_EMAIL)
  const theirs = await data.setTopicColour(them, ids.app, 'exam_ready', TODAY)
  assert.match(theirs.error, /isn’t there/, 'the stranger can’t see it, so can’t change it')

  const files = csv.trackerCsvFiles(await data.loadTrackerData(nat, TODAY))
  const maths = files.find((x) => x.tab === 'Maths+FM').csv
  assert.match(maths, /\r\nPC1-01,FM,Further Pure,Teacher A,HT1,2026-09-07,✅ Taught,PC1 blue · 1,Matrices,🟡,0 Not started,Bicen Core Pure → CP1: Matrices,,,2026-10-05,2026-10-08,DUE,Further Maths HT1 Consolidation \+ Further Maths HT2 test,\r\n/)
  const tests = files.find((x) => x.tab === 'Tests & papers').csv
  assert.match(tests, /FURTHER MATHS HT2 TEST,,,,,2026-11-12,24 days left/)
  assert.match(tests, /2026-10-15,Timed practice,30,45,,67%/)
  assert.ok(files.some((x) => x.tab === 'STEP' && x.rows === 3))
})

test('the real spreadsheet into a seeded app: 92 topics, 4 tests, 28 STEP items; importing it again changes nothing', { skip: skip || (existsSync(REAL) ? false : 'the spreadsheet isn’t on this PC') }, async () => {
  const { run, data } = await lib()
  for (const name of ['Maths', 'Further Maths']) {
    const sid = await subject(name)
    for (const r of seedRows(name)) await chat.add('topics', { subject_id: sid, ...r })
  }
  const nat = await signIn(OWNER_EMAIL)
  const bytes = readFileSync(REAL)
  const pre = await run.runImport(nat, bytes, 'preview', null, TODAY)
  assert.deepEqual([pre.body.counts.topicsNew, pre.body.counts.topicsUpdated, pre.body.counts.testsNew, pre.body.counts.programmeItemsNew], [33, 59, 4, 28])
  assert.deepEqual(pre.body.clashes, [])
  const done = await run.runImport(nat, bytes, 'confirm', pre.body.fingerprint, TODAY)
  assert.equal(done.status, 200, JSON.stringify(done.body))
  const w = await data.loadStudyWorld(nat, TODAY)
  assert.equal(w.topics.filter((t) => t.code).length, 92)
  assert.deepEqual(w.tests.map((t) => t.date).sort(), ['2026-11-02', '2026-11-10', '2026-11-12', '2026-11-12'])
  assert.equal(w.programmes[0].items.length, 28)
  const again = await run.runImport(nat, bytes, 'preview', null, TODAY)
  assert.deepEqual(again.body.summary, [])
})
