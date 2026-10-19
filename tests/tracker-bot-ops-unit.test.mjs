// The study tracker's changes (lib/tracker/bot-ops.ts): each trk_ op's check gives one escaped "before → after" line
// and the row steps to apply it, using the tracker's rules (colour from fresh-Q %, notes cap at 🟡, review +1/+3/+14/+7,
// steps only move forward, redo +3 then +7, "this week" = Sunday). Dates from the AI must be in his words.
// Fixed today: Mon 19 Oct 2026. Pure: no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { world, env } from './support/tracker-bot.mjs'

const { checkTrk, findTest, ruleLabel, snapshotRefs, perDay } = await import('../lib/tracker/bot-ops.ts')
const TODAY = '2026-10-19'
const W = world(TODAY)
const raw = (op, ref, value, date = '', words = '') => ({ op, ref, value, date, date_to: '', time: '', time_to: '', number: 0, words })
const ok = (op, ref, value, said = '', date = '', words = '', rows = W) => {
  const r = checkTrk(op, raw(op, ref, value, date, words), rows, env(TODAY, said))
  assert.ok(r.action, `expected a change, got: ${r.problem}`)
  return r.action
}
const no = (op, ref, value, said = '', date = '', words = '') => {
  const r = checkTrk(op, raw(op, ref, value, date, words), W, env(TODAY, said))
  assert.ok(!r.action, `expected a problem, got: ${r.action?.line}`)
  return r.problem
}
const topic = (code) => W.topics.find((t) => t.code === code)

test('trk_colour: before → after, last done today, review from the new colour; same colour is a problem', () => {
  const a = ok('trk_colour', 'PC1-01', 'colour=yellow')
  assert.equal(a.line, '<b>PC1-01 Matrices</b>: 🔴 → <b>🟡</b> · review Thu 22 Oct')
  assert.deepEqual(a.patch.steps, [{ kind: 'update', table: 'topics', id: topic('PC1-01').id, set: { status: 'understand', status_at: '__now__', last_done: TODAY } }])
  assert.equal(ok('trk_colour', 'PC1-01', 'colour=green').line.endsWith('review Mon 2 Nov'), true, '🟢 → +14 days')
  assert.match(ok('trk_colour', 'Y1-07', 'colour=red').line, /review Tue 20 Oct/, '🔴 → +1 day')
  assert.match(no('trk_colour', 'PC1-01', 'colour=red'), /already 🔴/)
  assert.match(no('trk_colour', 'NOPE-1', 'colour=red'), /which topic/)
  assert.match(no('trk_colour', 'PC1-01', 'colour=purple'), /which colour/)
  // a brain ref (a snapshot ref) and his words for a topic both work
  assert.equal(checkTrk('trk_colour', raw('trk_colour', 'XX', 'colour=green'), W, { ...env(TODAY), ref: { kind: 'trk_topic', id: topic('Y1-04').id, title: '', status: null, deadline: null } }).action.title, 'Y1-04 Polynomials')
  assert.equal(ok('trk_colour', 'polynomials', 'colour=green').title, 'Y1-04 Polynomials')
  assert.equal(ok('trk_colour', 'TP1', 'colour=green', '', '', '', { ...W, topics: [...W.topics, { ...topic('Y1-04'), id: 'no-code', code: null, name: 'Old topic' }] }).title, 'Old topic')
})

test('trk_log: Bicen 8/10 on a 🔴 topic → 🟡, step 3 → 4, review +3; notes cap at 🟡; textbook moves the step only', () => {
  const a = ok('trk_log', 'PC1-01', 'what=bicen; score=8; out_of=10')
  assert.equal(a.line, '<b>PC1-01 Matrices</b>: Bicen set 8/10 = 80% · 🔴 → <b>🟡</b> · step 3 → <b>4</b> (Bicen exam Qs) · review Thu 22 Oct')
  assert.deepEqual(a.patch.steps[0].set, { last_done: TODAY, fresh_pct: 80, status: 'understand', status_at: '__now__', step: 4 })
  const notes = ok('trk_log', 'PC1-01', 'what=bicen; score=10; out_of=10; notes=yes')
  assert.match(notes.line, /🔴 → <b>🟡<\/b>/, '100% with notes is still only 🟡')
  const tb = ok('trk_log', 'Y1-07', 'what=exercise')
  assert.equal(tb.line, '<b>Y1-07 Logarithms</b>: textbook exercise · stays ⚪ · step 0 → <b>2</b> (Textbook exercise) · review Mon 26 Oct')
  assert.deepEqual(tb.patch.steps[0].set, { last_done: TODAY, step: 2 })
  const tbScore = ok('trk_log', 'Y1-07', 'what=textbook; score=9; out_of=10')
  assert.match(tbScore.line, /stays ⚪/, 'textbook practice isn’t fresh questions: no colour from it')
})

test('trk_log: Integral ≥ 85% → 🟢 and step 5; below 85% it stops at step 4; steps never go back; colours can', () => {
  assert.match(ok('trk_log', 'PC1-01', 'what=integral; pct=90').line, /🔴 → <b>🟢<\/b> · step 3 → <b>5<\/b>/)
  const low = ok('trk_log', 'PC1-01', 'what=integral; score=24; out_of=30')
  assert.match(low.line, /80% · 🔴 → <b>🟡<\/b> · step 3 → <b>4<\/b>.*Integral needs ≥ 85% for 🟢/)
  const back = ok('trk_log', 'Y1-01', 'what=review; score=2; out_of=4')
  assert.match(back.line, /🟢 → <b>🔴<\/b>/, 'a 🟢 topic can drop back')
  assert.equal(back.patch.steps[0].set.step, undefined, 'its step stays at 5')
  assert.match(no('trk_log', 'PC1-01', 'what=bicen; score=11; out_of=10'), /isn’t a score/)
  assert.match(no('trk_log', 'PC1-01', 'what=bicen; score=8'), /out of how many/)
  assert.match(no('trk_log', 'PC1-01', 'what=football'), /what did you do/)
})

test('trk_log: physics booklet / PMT are marked done; physics topics have no maths steps', () => {
  const b = ok('trk_log', 'P1.1', 'what=booklet')
  assert.equal(b.line, '<b>P1.1 Kinematics</b>: booklet Qs · stays 🟡 · booklet todo → <b>done</b> · review Thu 22 Oct')
  assert.deepEqual(b.patch.steps[0].set, { last_done: TODAY, booklet: 'done' })
  const p = ok('trk_log', 'P1.1', 'what=pmt; score=9; out_of=10')
  assert.deepEqual(p.patch.steps[0].set, { last_done: TODAY, fresh_pct: 90, status: 'exam_ready', status_at: '__now__', pmt: 'done' })
})

test('trk_mistake: a new row with the redo in 3 days; the topic code, question, type and rule; unknown code is a problem', () => {
  const a = ok('trk_mistake', 'PC1-03', 'question=Q3b; what=assumed through origin; kind=knowledge', 'mistake: PC1-03 Q3b assumed through origin – knowledge')
  assert.equal(a.line, '📝 Mistake <b>PC1-03 Applications of matrices Q3b</b>: “assumed through origin” · Knowledge · redo Thu 22 Oct')
  const row = a.patch.steps[0].row
  assert.deepEqual([row.topic_id, row.code, row.question, row.body, row.kind, row.review_on, row.redo_stage, row.logged_on], [topic('PC1-03').id, 'PC1-03', 'Q3b', 'assumed through origin', 'knowledge', '2026-10-22', 0, TODAY])
  assert.equal(a.patch.steps[0].kind, 'insert')
  const t = ok('trk_mistake', '', 'question=Q7; what=ran out of time; kind=time; test=FM HT2 test; rule=do Q7 last')
  assert.equal(t.patch.steps[0].row.goal_id, W.tests[0].id)
  assert.match(t.line, /\(FM HT2 test\).*rule: do Q7 last/)
  assert.match(no('trk_mistake', 'XX9-99', 'what=oops'), /no topic/)
  assert.match(no('trk_mistake', 'PC1-03', 'what=oops; kind=vibes'), /isn’t a mistake type/)
  assert.match(no('trk_mistake', 'PC1-03', 'question=Q1'), /what went wrong/)
  assert.match(ok('trk_mistake', 'PC1-03', 'what=<script>').line, /&lt;script&gt;/, 'his words are escaped')
})

test('trk_redo: redo 1 → next in a week; redo 2 → off the list; still wrong → again in 3 days', () => {
  const [first, second] = W.mistakes
  const a = ok('trk_redo', `mistake:${first.id}`, 'result=right')
  assert.equal(a.line, '🔁 <b>PC1-03 Q3b</b> (“assumed it went through the origin”): redo 1 of 2 ✓ → next redo Mon 26 Oct')
  assert.deepEqual(a.patch.steps[0].set, { redo_stage: 1, review_on: '2026-10-26' })
  const b = ok('trk_redo', `mistake:${second.id}`, '')
  assert.match(b.line, /redo 2 of 2 ✓ → <b>off the list<\/b>/)
  assert.deepEqual(b.patch.steps[0].set, { redo_stage: 2, reviewed_at: '__now__' })
  assert.deepEqual(ok('trk_redo', `mistake:${second.id}`, 'result=wrong').patch.steps[0].set, { redo_stage: 0, review_on: '2026-10-22' })
  assert.equal(ok('trk_redo', 'MK1', '').id, first.id, 'snapshot refs: MK1 is the earliest redo')
  assert.equal(ok('trk_redo', '', 'code=PC1-03; question=Q3b').id, first.id)
  assert.match(no('trk_redo', '', 'question=Q99'), /which mistake/)
})

test('trk_attempt: a try on a test (score, %, the topics to work on); out of = its marks; a past day must be his words', () => {
  const a = ok('trk_attempt', 'TS3', 'what=timed; score=38; out_of=45; label=HT2 practice')
  assert.equal(a.title, 'FM HT2 test')
  assert.equal(a.line, '📝 <b>FM HT2 test</b>: timed practice 38/45 = <b>84%</b> · today · work on: 🔴 PC1-01, 🟡 PC1-03 · <i>log each lost mark as a mistake</i>')
  assert.deepEqual(a.patch.steps[0].row, { goal_id: W.tests[0].id, done_on: TODAY, what: 'timed', label: 'HT2 practice', score: 38, out_of: 45 })
  assert.equal(ok('trk_attempt', `test:${W.tests[0].id}`, 'what=diagnostic; score=30').patch.steps[0].row.out_of, 45, 'out of its marks')
  const y = ok('trk_attempt', `test:${W.tests[0].id}`, 'score=30; out_of=45', 'diagnostic yesterday 30/45', '2026-10-18', 'yesterday')
  assert.equal(y.patch.steps[0].row.done_on, '2026-10-18')
  assert.match(no('trk_attempt', `test:${W.tests[0].id}`, 'score=30; out_of=45', 'diagnostic 30/45', '2026-10-18', 'last week'), /day of that try/, 'the AI’s date has to be his words')
  assert.match(no('trk_attempt', 'TS9', 'score=1; out_of=2'), /which test/)
  assert.match(no('trk_attempt', `test:${W.tests[1].id}`, 'score=30'), /isn’t a score/, 'no marks known and none given')
  assert.equal(findTest(W.tests, 'mechanics').title, 'Physics mechanics test')
  assert.equal(findTest(W.tests, 'further maths ht2').title, 'FM HT2 test')
  assert.equal(findTest(W.tests, 'fm'), null, 'too vague: two FM tests')
})

test('trk_test: a new test needs a name and a date in his words; topics become codes; edits list only what changes', () => {
  const said = 'FM test on 12 Nov: matrices, further vectors, no momentum, 50 min'
  const a = ok('trk_test', '', 'title=FM HT3 test; subject=Further Maths; topics=matrices, further vectors; limits=no momentum; length=50; marks=45; per_day=30-60', said, '2026-11-12', '12 Nov')
  assert.equal(a.line, '📝 New test: <b>FM HT3 test</b> · Thu 12 Nov (in 24 days) · Further Maths · topics PC1-01, PC1-02 · no momentum · 50 min · 45 marks · 30–60 min/day')
  const row = a.patch.steps[0].row
  assert.deepEqual([row.kind, row.test_kind, row.topic_codes, row.topics, row.minutes_per_day, row.minutes_max, row.source], ['test', 'test', ['PC1-01', 'PC1-02'], 'Matrices, Further vectors', 30, 60, 'chat'])
  assert.match(no('trk_test', '', 'title=FM HT3 test', said, '2026-11-12', 'next month'), /date wasn’t clear/, 'the AI’s date words must be his')
  assert.match(no('trk_test', '', 'title=FM HT3 test', 'test 12 Nov', '2026-10-01', '12 Nov'), /past/)
  assert.match(no('trk_test', '', 'subject=Physics', 'test 12 Nov', '2026-11-12', '12 Nov'), /called/)
  assert.match(no('trk_test', '', 'title=FM HT2 test', 'on 12 Nov', '2026-11-12', '12 Nov'), /already have/)
  const e = ok('trk_test', 'TS3', 'limits=no hyperbolics', 'HT2 moved to 13 Nov, no hyperbolics', '2026-11-13', '13 Nov')
  assert.equal(e.line, '📝 <b>FM HT2 test</b>: Thu 12 Nov → <b>Fri 13 Nov</b> · limits → no hyperbolics')
  assert.deepEqual(e.patch.steps[0].set, { target_date: '2026-11-13', limits: 'no hyperbolics' })
  assert.match(no('trk_test', 'TS3', 'marks=45'), /nothing to change/)
  // a Classroom test archives its homework copy in the same ✅
  const hw = { ...W, tasks: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', title: 'FM HT3 Test', archived_at: null, status: 'this_week', archive_reason: null }] }
  const c = checkTrk('trk_test', raw('trk_test', '', 'title=FM HT3 test; source=classroom; source_ref=classroom:abc; homework=aaaaaaaa-0000-4000-8000-000000000001', '2026-11-12'), hw, { ...env(TODAY), grounded: () => true }).action
  assert.deepEqual(c.patch.steps.map((s) => [s.kind, s.table]), [['insert', 'goals'], ['update', 'tasks']])
  assert.deepEqual(c.patch.steps[1].set, { archived_at: '__now__', archive_reason: 'dropped' })
  assert.match(c.line, /its homework copy “FM HT3 Test” is archived/)
  assert.deepEqual([c.patch.steps[0].row.source, c.patch.steps[0].row.source_ref], ['classroom', 'classroom:abc'])
  assert.deepEqual(perDay('30–60 min'), [30, 60])
  assert.equal(perDay('300'), null)
})

test('trk_topic: edit fields (booklet, taught, teacher, notes, Integral link, taught from in his words)', () => {
  assert.equal(ok('trk_topic', 'P1.1', 'booklet=done').line, '<b>P1.1 Kinematics</b>: booklet todo → <b>done</b>')
  assert.equal(ok('trk_topic', 'P3.1', 'taught=yes').line, '<b>P3.1 Momentum</b>: taught not yet → <b>yes</b>')
  const many = ok('trk_topic', 'PC1-01', 'teacher=Ms X; notes=det sign')
  assert.deepEqual(many.patch.steps[0].set, { teacher: 'Ms X', weak_notes: 'det sign' })
  assert.match(ok('trk_topic', 'Y1-10', '', 'trig is taught from 9 Nov', '2026-11-09', '9 Nov').line, /taught from Mon 2 Nov → <b>Mon 9 Nov<\/b>/)
  assert.match(no('trk_topic', 'PC1-01', 'integral=not a link'), /web address/)
  assert.match(no('trk_topic', 'PC1-01', 'booklet=maybe'), /done, doing or todo/)
  assert.match(no('trk_topic', 'PC1-01', ''), /nothing to change/)
})

test('trk_programme: new (items, per week, days, end), pause until / resume / stop, per week, add items', () => {
  const n = ok('trk_programme', '', 'do=new; name=MadAs booklets; items=Algebra | Calculus | Vectors; per_week=2; days=weekend; minutes=45')
  assert.equal(n.line, '📚 New programme: <b>MadAs booklets</b> · 3 items (first: Algebra) · 2 a week · weekend · 45 min')
  assert.deepEqual(n.patch.steps.map((s) => s.table), ['programmes', 'programme_items', 'programme_items', 'programme_items'])
  assert.equal(n.patch.steps[1].row.programme_id, '$0', 'the items point at the new programme')
  assert.match(no('trk_programme', '', 'do=new; name=STEP; items=x'), /already have/)
  assert.match(no('trk_programme', '', 'do=new; name=Empty'), /items/)
  const p = W.programmes[0]
  assert.equal(ok('trk_programme', `prog:${p.id}`, 'do=pause', 'pause STEP until 1 Nov', '2026-11-01', 'until 1 nov').line, '📚 <b>STEP</b>: ▶️ active → <b>⏸ paused until Sun 1 Nov</b>')
  assert.match(ok('trk_programme', 'PG1', 'do=pause').line, /until you say “resume”/)
  assert.match(no('trk_programme', 'PG1', 'do=resume'), /already running/)
  assert.match(ok('trk_programme', 'STEP', 'do=stop').line, /⏹ stopped<\/b> <i>\(kept, with its progress\)/)
  assert.equal(ok('trk_programme', 'PG1', 'do=change; per_week=2').line, '📚 <b>STEP</b>: 1 → <b>2 a week</b>')
  const add = ok('trk_programme', 'PG1', 'do=add; add=STEP II paper 1 | STEP II paper 2')
  assert.deepEqual(add.patch.steps.map((s) => s.row.position), [29, 30])
})

test('trk_item: done (with a result) / skip / result; "this week x/y"; an item already done is a problem', () => {
  const p = W.programmes[0]
  const a = ok('trk_item', `prog:${p.id}`, 'do=done; item=3; result=solved with hints · idea: symmetry')
  assert.equal(a.line, '✅ <b>STEP</b> #3 STEP Support – Assignment 3: todo → <b>done</b> (solved with hints · idea: symmetry) · this week 1/1')
  assert.deepEqual(a.patch.steps[0].set, { status: 'done', done_on: TODAY, result: 'solved with hints · idea: symmetry' })
  assert.equal(ok('trk_item', 'PG1', 'do=done').title, 'STEP #3', 'no number: the next one')
  assert.match(no('trk_item', 'PG1', 'do=done; item=1'), /already done/)
  assert.match(ok('trk_item', 'PG1', 'do=skip; item=4').line, /todo → <b>skipped<\/b>/)
  assert.match(ok('trk_item', 'PG1', 'do=result; item=1; score=7; out_of=10').line, /result → <b>7\/10<\/b>/)
  assert.match(no('trk_item', 'PG1', 'do=done; item=99'), /no item/)
})

test('trk_item on a gaps_only programme: the first score is the chapter test; full marks skips the chapter, else it stays to do', () => {
  const w = world(TODAY)
  w.programmes[0].mode = 'gaps_only'
  const chk = (value) => checkTrk('trk_item', raw('trk_item', 'PG1', value), w, env(TODAY))
  const full = chk('do=done; item=3; score=15; out_of=15').action
  assert.equal(full.line, '📝 <b>STEP</b> #3 STEP Support – Assignment 3: chapter test 15/15 → full marks: <b>chapter skipped</b>')
  assert.deepEqual(full.patch.steps[0].set, { score: 15, out_of: 15, status: 'skipped', result: 'full marks on the chapter test' })
  const gap = chk('do=done; item=3; score=12; out_of=15').action
  assert.match(gap.line, /chapter test 12\/15 → <b>do this chapter<\/b> \(marks dropped\)/)
  assert.deepEqual(gap.patch.steps[0].set, { score: 12, out_of: 15 }, 'it stays to do')
  assert.match(chk('do=done; item=3').problem, /what did you get on the STEP #3 chapter test/)
  w.programmes[0].items[2].score = 12
  w.programmes[0].items[2].outOf = 15
  assert.match(chk('do=done; item=3').action.line, /todo → <b>done<\/b>/, 'once tested, “done” is the chapter itself')
})

test('trk_rule: add with an end (his words, or a quick-tap answer); no end is a problem; a running rule gets a new end; end one', () => {
  const said = 'pause getting ahead until 25 Oct'
  const a = ok('trk_rule', '', `do=add; kind=pause; target=ahead; words=${said}`, said, '2026-10-25', 'until 25 oct')
  assert.equal(a.line, '📌 New rule: <b>pause getting ahead</b> · until Sun 25 Oct')
  assert.deepEqual(a.patch.steps[0].row, { words: said, kind: 'pause', target: 'ahead', minutes: null, starts_on: TODAY, ends_on: '2026-10-25' })
  assert.match(no('trk_rule', '', 'do=add; kind=pause; target=ahead', 'pause ahead'), /when should it end/)
  assert.match(no('trk_rule', '', 'do=add; kind=pause; target=ahead', 'pause ahead', '2026-10-25', 'sunday'), /end date wasn’t clear/, 'not his words')
  assert.equal(ok('trk_rule', '', 'do=add; kind=boost; target=act; ends=week').patch.steps[0].row.ends_on, '2026-10-25')
  assert.equal(ok('trk_rule', '', 'do=add; kind=boost; target=act; ends=2weeks').patch.steps[0].row.ends_on, '2026-11-01')
  assert.equal(ok('trk_rule', '', 'do=add; kind=boost; target=act; ends=until_i_say').patch.steps[0].row.ends_on, '2026-12-13')
  const cap = ok('trk_rule', '', 'do=add; kind=cap; target=maths, physics; minutes=45; ends=week')
  assert.equal(cap.line, '📌 New rule: <b>Maths + Further Maths + Physics max 45 min/day</b> · until Sun 25 Oct')
  assert.equal(cap.patch.steps[0].row.target, 'subjects:Maths,Further Maths,Physics')
  assert.match(no('trk_rule', '', 'do=add; kind=cap; target=maths; ends=week'), /how many minutes/)
  assert.match(no('trk_rule', '', 'do=add; kind=boost; target=football; ends=week'), /isn’t something a rule can be about/)
  assert.equal(ok('trk_rule', '', 'do=add; kind=pause; target=programme:step; ends=week').patch.steps[0].row.target, 'programme:STEP')
  // the same rule running already: a new end date for it
  const again = ok('trk_rule', '', 'do=add; kind=pause; target=reviews; ends=2weeks')
  assert.equal(again.line, '📌 Rule <b>pause reviews</b>: until Sun 25 Oct → <b>until Sun 1 Nov</b>')
  assert.equal(again.patch.steps[0].kind, 'update')
  assert.match(no('trk_rule', '', 'do=add; kind=pause; target=reviews; ends=week'), /already on until Sun 25 Oct/)
  const end = ok('trk_rule', 'RL1', 'do=end')
  assert.equal(end.line, '📌 Rule <b>pause reviews</b>: until Sun 25 Oct → <b>ended</b>')
  assert.deepEqual(end.patch.steps[0].set, { ends_on: '2026-10-18' }, 'started before today: it ends yesterday')
  const fresh = { ...W, rules: [{ ...W.rules[1], startsOn: TODAY }] }
  assert.deepEqual(checkTrk('trk_rule', raw('trk_rule', `rule:${W.rules[1].id}`, 'do=end'), fresh, env(TODAY)).action.patch.steps[0].set, { archived_at: '__now__' }, 'started today: archived (kept)')
  assert.match(no('trk_rule', `rule:${W.rules[0].id}`, 'do=end'), /already ended/)
  assert.equal(ruleLabel({ kind: 'boost', target: 'act', minutes: null, words: '' }), 'ACT top priority')
})

test('before tracker.sql every change says how to set it up; snapshot refs: codes, TS, MK, PG, RL', () => {
  assert.match(checkTrk('trk_colour', raw('trk_colour', 'PC1-01', 'colour=green'), { ...W, sqlMissing: true }, env(TODAY)).problem, /run supabase\/tracker\.sql/)
  const refs = new Map(snapshotRefs(W))
  assert.equal(refs.get('PC1-01').id, topic('PC1-01').id)
  assert.equal(refs.get('TS1').title, 'FM HT1 consolidation', 'tests by date')
  assert.equal(refs.get('MK1').title, 'PC1-03 Q3b')
  assert.equal(refs.get('PG1').title, 'STEP')
  assert.equal(refs.get('RL1').title, 'pause reviews', 'only rules not yet ended')
  assert.equal(refs.has('RL2'), false)
})
