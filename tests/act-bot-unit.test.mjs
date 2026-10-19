// The ACT bot's checks (queue item 2, plans/contracts.md §2): every change is checked before the ✅ card (real record,
// his words for dates, sane values), with an HTML-escaped "before → after" line. Pure: rows are made up here.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const B = await import('../lib/act/bot.ts')
const { BOOKS, bookNotes } = await import('../lib/act/books.ts')
const { DEFAULT_ACT_SETTINGS } = await import('../lib/act/config.ts')
const { composite } = await import('../lib/act/engine.ts')

const TODAY = '2026-10-19'
function book(role, statuses = {}, over = {}) {
  const def = BOOKS.find((b) => b.role === role)
  const pid = `prog-${role}`
  return {
    id: pid, name: def.name, area: 'act', subjectId: 'S', perWeek: def.perWeek, minutes: def.minutes, days: null, startsOn: null, endsOn: null, status: 'active', pausedUntil: null,
    mode: def.mode, notes: bookNotes(def),
    items: def.items.map((it, k) => ({ id: `${role}-${k + 1}`, programmeId: pid, position: (k + 1) * 10, title: it.title, details: it.details, url: null, minutes: it.minutes,
      status: statuses[k + 1] ?? 'todo', doneOn: null, result: null, score: null, outOf: null })),
    ...over,
  }
}
const real = { id: 'r1', takenOn: '2026-10-01', kind: 'real', english: 34, maths: 34, reading: 35, science: 35, composite: 34, createdOn: '2026-10-01' }
function rows(o = {}) {
  const books = o.books ?? BOOKS.map((b) => book(b.role))
  const scores = o.scores ?? [real]
  const misses = o.misses ?? []
  const goals = o.goals ?? []
  const upcoming = goals.filter((g) => g.target_date >= TODAY)[0]
  return {
    missing: o.missing ?? [], planning: null, subject: o.subject === undefined ? { id: 'S', name: 'ACT', archived_at: null, category_id: 'C' } : o.subject,
    categories: [{ id: 'C', name: 'Study' }], goals, scores, books, positions: o.positions ?? Object.fromEntries(books.map((b) => [b.id, b.items.map((i) => i.position)])),
    misses, hasTestKind: o.hasTestKind ?? true,
    world: { today: TODAY, retake: upcoming ? { goalId: upcoming.id, date: upcoming.target_date } : null, goal: 36, scores, books, misses, doneToday: [], settings: DEFAULT_ACT_SETTINGS, subjectId: 'S' },
  }
}
const env = (said, extra = {}) => ({ today: TODAY, said, grounded: (w) => w.length >= 3 && said.toLowerCase().includes(w.toLowerCase()), ref: undefined, others: [], ...extra })
const raw = (op, value, o = {}) => ({ op, ref: '', value, date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const check = (op, value, o = {}, r = rows(), said = 'his words') => B.checkAct(op, raw(op, value, o), r, env(said))

test('act_score: 1–36 only, at least one section, no duplicates, his words for another date', () => {
  assert.match(check('act_score', 'e=40').problem, /1 to 36/)
  assert.match(check('act_score', 'kind=practice').problem, /which scores/)
  const ok = check('act_score', 'kind=practice; e=33; m=35; r=34', {}, rows(), 'ACT practice: E33 M35 R34')
  assert.equal(ok.action.line, '📝 ACT practice test: E33 M35 R34 → <b>composite 34</b> · weakest now: English 33 vs 36')
  assert.deepEqual({ ...ok.action.patch, source_text: undefined }, { taken_on: TODAY, kind: 'practice', english: 33, maths: 35, reading: 34, science: null, composite: 34, source_text: undefined })
  assert.equal(ok.action.patch.source_text, 'ACT practice: E33 M35 R34')
  const dup = rows({ scores: [real, { ...real, id: 'p', kind: 'practice', takenOn: TODAY, english: 33, maths: 35, reading: 34, science: null, composite: 34 }] })
  assert.match(check('act_score', 'kind=practice; e=33; m=35; r=34', {}, dup).problem, /already logged/)
  assert.equal(check('act_score', 'e=30').action.patch.kind, 'section', 'one section = a timed section')
  assert.equal(check('act_score', 'e=30').action.patch.composite, null)
  assert.match(check('act_score', 'kind=practice; e=33; m=35; r=34', { date: '2026-10-17', words: 'on saturday' }, rows(), 'ACT practice: E33 M35 R34').problem, /wasn’t in your words/)
  assert.match(check('act_score', 'kind=practice; e=33; m=35; r=34', { date: '2026-10-18', words: 'yesterday' }, rows(), 'yesterday ACT practice E33 M35 R34').action.line, /\(Sun 18 Oct\)/)
  assert.match(check('act_score', 'e=33', { date: '2026-10-25', words: 'sunday' }, rows(), 'sunday').problem, /doesn’t look right/)
  assert.match(check('act_score', 'e=33', {}, rows({ missing: ['supabase/act.sql'] })).problem, /run supabase\/act\.sql in Supabase first/)
  assert.equal(check('act_score', 'kind=real; e=36; m=36; r=36; s=36').action.line, '📝 ACT real test: E36 M36 R36 S36 → <b>composite 36</b> · all sections at 36 ✓')
})

test('act_date: a future date in his words; moving keeps the same goal; clear archives it', () => {
  const said = 'ACT retake is 12 Dec'
  const n = check('act_date', 'set', { date: '2026-12-12', words: '12 Dec' }, rows(), said)
  assert.equal(n.action.line, '🎯 ACT retake: <b>Sat 12 Dec</b> (54 days) → countdown mode')
  assert.equal(n.action.id, null)
  assert.deepEqual({ ...n.action.patch, source_text: null }, { title: 'ACT retake', kind: 'test', target_date: '2026-12-12', subject_id: 'S', priority: 'high', test_kind: 'act', source: 'chat', source_text: null })
  assert.ok(!('test_kind' in check('act_date', 'set', { date: '2026-12-12', words: '12 Dec' }, rows({ hasTestKind: false }), said).action.patch), 'before tracker.sql: no test_kind column')
  assert.match(check('act_date', 'set', { date: '2026-10-01', words: '1 Oct' }, rows(), 'ACT retake is 1 Oct').problem, /has passed/)
  assert.match(check('act_date', 'set', { date: '2026-12-12', words: 'next month' }, rows(), said).problem, /wasn’t in your words/)
  assert.match(check('act_date', 'set', {}, rows(), said).problem, /when is the ACT retake/)
  const g = rows({ goals: [{ id: 'G', title: 'ACT retake', target_date: '2026-12-12', subject_id: 'S', test_kind: 'act' }] })
  assert.match(check('act_date', 'set', { date: '2026-12-12', words: '12 Dec' }, g, said).problem, /already Sat 12 Dec/)
  const mv = check('act_date', 'set', { date: '2027-02-13', words: '13 Feb' }, g, 'ACT retake moved to 13 Feb')
  assert.equal(mv.action.line, '🎯 ACT retake: Sat 12 Dec → <b>Sat 13 Feb</b> (117 days)')
  assert.deepEqual(mv.action.patch, { target_date: '2027-02-13' })
  const old = rows({ goals: [{ id: 'G0', title: 'ACT', target_date: '2026-12-12', subject_id: 'S', test_kind: null }] })
  assert.deepEqual(check('act_date', 'set', { date: '2027-02-13', words: '13 Feb' }, old, 'ACT retake moved to 13 Feb').action.patch, { target_date: '2027-02-13', test_kind: 'act' }, 'his own ACT test goal is kept and marked')
  assert.equal(check('act_date', 'clear', {}, g).action.line, '🎯 ACT retake Sat 12 Dec: → <b>cleared</b> <i>(back to steady mode; kept in your archive)</i>')
  assert.match(check('act_date', 'clear').problem, /no ACT retake date to clear/)
})

const miss = (o = {}) => ({ id: 'm1', goalId: null, topicId: null, subjectId: 'S', code: null, question: 'Q12', body: 'joined two sentences', kind: null, rule: 'comma splice',
  source: 'ACT English', loggedOn: '2026-10-10', reviewOn: '2026-10-13', redoStage: 0, reviewedAt: null, ...o })

test('act_miss: a section and a rule or what went wrong; redo +3 days; redos move on a stage', () => {
  assert.match(check('act_miss', 'rule=comma splice').problem, /which section/)
  assert.match(check('act_miss', 'section=english').problem, /what went wrong/)
  const ok = check('act_miss', 'section=e; question=12; rule=comma splice; what=<joined> two sentences; kind=slip')
  assert.equal(ok.action.line, '❌ ACT English miss Q12: rule <b>comma splice</b> — &lt;joined&gt; two sentences <i>(careless)</i> · redo Thu 22 Oct')
  assert.deepEqual({ ...ok.action.patch, source_text: null }, { subject_id: 'S', body: '<joined> two sentences', rule: 'comma splice', question: 'Q12', kind: 'careless', source: 'ACT English', logged_on: TODAY, review_on: '2026-10-22', redo_stage: 0, source_text: null })
  assert.match(check('act_miss', 'section=english; rule=x', {}, rows({ missing: ['supabase/tracker.sql'] })).problem, /run supabase\/tracker\.sql/)
  const r = rows({ misses: [miss(), miss({ id: 'm2', question: 'Q3', rule: 'who vs whom', redoStage: 1, reviewOn: '2026-10-19' }), miss({ id: 'm3', question: 'Q9', reviewOn: '2026-10-25' })] })
  const one = check('act_miss', 'do=redo; question=q12', {}, r)
  assert.equal(one.action.line, '🔁 ACT English miss Q12 (comma splice): redo 1 done → next redo <b>Mon 26 Oct</b>')
  assert.deepEqual(one.action.patch.redo, [{ id: 'm1', from: { redo_stage: 0, review_on: '2026-10-13' }, to: { redo_stage: 1, review_on: '2026-10-26' } }])
  const second = check('act_miss', 'do=redo; question=Q3', {}, r)
  assert.match(second.action.line, /redo 2 done → <b>done ✓<\/b>/)
  const due = check('act_miss', 'do=redo', {}, r)
  assert.equal(due.action.patch.redo.length, 2, 'all the due ones (Q9 is not due yet)')
  assert.match(check('act_miss', 'do=redo; question=Q40', {}, r).problem, /no open ACT miss Q40/)
})

test('act_book: done / skip / chapter-test scores (gaps_only) / renames / counts / the optional book', () => {
  assert.match(check('act_book', 'book=english; item=ch 1; do=done', {}, rows({ books: [] })).problem, /aren’t set up yet/)
  assert.match(check('act_book', 'book=physics; item=ch 1; do=done').problem, /which ACT book/)
  assert.equal(check('act_book', 'book=english; item=ch 3; do=done').action.line, '📘 Meltzer ch 3: to do → <b>done ✓</b>')
  assert.deepEqual(check('act_book', 'book=english; item=ch 3; do=done').action.patch.items, [{ id: 'english-3', set: { status: 'done', done_on: TODAY } }])
  assert.match(check('act_book', 'book=english; item=ch 1; do=done', {}, rows({ books: [book('english', { 1: 'done' })] })).problem, /already done/)
  assert.match(check('act_book', 'book=english; item=ch 40; do=done').problem, /Meltzer has no ch 40/)
  // College Panda: the chapter test decides
  const full = check('act_book', 'book=college panda; item=ch 4; do=score; score=15; out_of=15')
  assert.equal(full.action.line, '📐 College Panda ch 4: chapter test 15/15 → full marks: <b>chapter skipped</b>')
  assert.deepEqual(full.action.patch.items[0].set, { status: 'skipped', done_on: TODAY, score: 15, out_of: 15, result: 'chapter test 15/15 · full marks, chapter skipped' })
  const drop = check('act_book', 'book=cp; item=4; do=score; score=12; out_of=15')
  assert.equal(drop.action.line, '📐 College Panda ch 4: chapter test 12/15 → <b>do the chapter</b> (dropped 3 marks)')
  assert.equal(drop.action.patch.items[0].set.status, 'doing')
  const doing = book('maths_gaps', { 4: 'doing' }); doing.items[3].result = 'chapter test 12/15 · do the chapter'
  assert.equal(check('act_book', 'book=maths; item=ch 4; do=score; score=15; out_of=15', {}, rows({ books: [doing] })).action.patch.items[0].set.result, 'chapter test 12/15 · after: 15/15')
  assert.match(check('act_book', 'book=maths; item=ch 4; do=score; score=16; out_of=15').problem, /doesn’t look right/)
  assert.equal(check('act_book', 'book=english; item=ch 2; do=score; score=18; out_of=20').action.patch.items[0].set.result, '18/20', 'an in-order book: done with its score')
  assert.equal(check('act_book', 'book=english; item=ch 2; do=skip').action.line, '📘 Meltzer ch 2: to do → <b>skipped</b>')
  // rename keeps the chapter number; HTML escaped
  assert.equal(check('act_book', 'book=english; item=ch 3; do=rename; title=Commas & <dashes>').action.line, '📘 Meltzer: “Chapter 3” → “<b>Chapter 3: Commas &amp; &lt;dashes&gt;</b>”')
  // counts: up adds numbered chapters; down only drops untouched ones
  const up = check('act_book', 'book=english; do=count; count=18')
  assert.equal(up.action.line, '📘 Meltzer: 16 → <b>18 chapters</b> (adds ch 17, ch 18)')
  assert.deepEqual(up.action.patch.add.map((x) => [x.title, x.position]), [['Chapter 17', 170], ['Chapter 18', 180]])
  assert.deepEqual(check('act_book', 'book=english; do=count; count=14').action.patch.archive, ['english-15', 'english-16'])
  assert.match(check('act_book', 'book=english; do=count; count=14', {}, rows({ books: [book('english', { 16: 'done' })] })).problem, /ch 16 has progress/)
  assert.match(check('act_book', 'book=english; do=count; count=16').problem, /already has 16 chapters/)
  // the Reading guide: new method chapters go before the passage sets (positions between)
  const rd = check('act_book', 'book=reading; do=add; count=2; kind=chapter')
  assert.deepEqual(rd.action.patch.add.map((x) => [x.title, x.position]), [['Chapter 11', 101], ['Chapter 12', 102]])
  assert.deepEqual(check('act_book', 'book=reading; do=add; kind=passage').action.patch.add.map((x) => [x.title, x.position]), [['Timed passage set 9', 190]])
  // the optional Critical Reader: on / off
  assert.equal(check('act_book', 'book=critical; do=start').action.line, '📕 Critical Reader: only if reading stalls → <b>in your plan now</b> (on Reading days)')
  assert.deepEqual(check('act_book', 'book=critical; do=start').action.patch.programme.set, { mode: 'in_order' })
  assert.match(check('act_book', 'book=english; do=start').problem, /already in your plan/)
  assert.match(check('act_book', 'book=critical; do=stop').problem, /already/)
  // pause until a date in his words
  const p = B.checkAct('act_book', raw('act_book', 'book=flashcards; do=pause', { date: '2026-10-25', words: 'until Sunday' }), rows(), env('pause the flashcards until Sunday'))
  assert.deepEqual(p.action.patch.programme.set, { status: 'active', paused_until: '2026-10-25' })
})

test('act_setup: only what is missing; nothing to do = no card; SQL not run = says which file', () => {
  const all = check('act_setup', '', {}, rows({ subject: null, books: [], scores: [] }))
  assert.deepEqual(all.action.patch, { subject: 'new', subjectId: null, categoryId: 'C', roles: ['english', 'reading', 'maths_gaps', 'maths_hard', 'reading_extra', 'flashcards'], real: true })
  assert.match(all.action.line, /Last real ACT: E34 M34 R35 S35 → composite 34/)
  assert.match(check('act_setup', '').problem, /already set up/)
  const some = check('act_setup', '', {}, rows({ books: [book('english')] }))
  assert.deepEqual(some.action.patch.roles, ['reading', 'maths_gaps', 'maths_hard', 'reading_extra', 'flashcards'])
  assert.equal(some.action.patch.real, false, 'a real score is already there')
  assert.equal(check('act_setup', '', {}, rows({ subject: { id: 'S', name: 'ACT', archived_at: '2026-01-01', category_id: 'C' } })).action.patch.subject, 'restore')
  assert.match(check('act_setup', '', {}, rows({ missing: ['supabase/tracker.sql', 'supabase/act.sql'] })).problem, /run supabase\/tracker\.sql and supabase\/act\.sql/)
})

test('helpers: findItem by number / passage / name; kvOf keeps "=" in values; guessDay reads a holidays setting', () => {
  const r = book('reading')
  assert.equal(B.findItem(r, 'ch 3').id, 'reading-3')
  assert.equal(B.findItem(r, '3').id, 'reading-3')
  assert.equal(B.findItem(r, 'passage 2').title, 'Timed passage set 2')
  assert.equal(B.findItem(r, 'passage set 8').title, 'Timed passage set 8')
  const e = book('english'); e.items[2].title = 'Chapter 3: Commas'
  assert.equal(B.findItem(e, 'commas').id, 'english-3')
  assert.equal(B.findItem(e, 'chapter 3').id, 'english-3')
  assert.deepEqual(B.kvOf('rule=a = b; what=x'), { rule: 'a = b', what: 'x' })
  assert.equal(B.guessDay({ holidays: '2026-10-24..2026-11-01' }, '2026-10-26').mode, 'half_term')
  assert.equal(B.guessDay({ holidays: [{ from: '2026-12-19', to: '2027-01-03' }] }, '2026-11-10').mode, 'school')   // (item 5: an odd value means the default holidays, a guess for 17 Oct – 1 Nov)
  assert.equal(B.guessDay(null, TODAY).dow, 1)
  assert.equal(composite(B.LAST_REAL.english, B.LAST_REAL.maths, B.LAST_REAL.reading), 34)
})

test('probe 6: act_book with no chapter named: done / skip / score mean the next one; others ask which', () => {
  const r = rows({ books: [book('english', { 1: 'done', 2: 'done' })] })
  assert.deepEqual(check('act_book', 'book=english; do=done', {}, r).action.patch.items, [{ id: 'english-3', set: { status: 'done', done_on: TODAY } }], 'not Chapter 1')
  assert.equal(B.findItem(book('english'), ''), null)
  assert.match(check('act_book', 'book=english; do=rename; title=Commas').problem, /which Meltzer chapter/)
  assert.match(check('act_book', 'book=english; do=remove').problem, /which Meltzer chapter/)
  const all = rows({ books: [book('english', Object.fromEntries(Array.from({ length: 16 }, (_, i) => [i + 1, 'done'])))] })
  assert.match(check('act_book', 'book=english; do=done', {}, all).problem, /nothing left to do/)
})

test('probe 10: only test_kind act or the ACT subject make a goal the ACT (never the title)', async () => {
  const { isActGoal } = await import('../lib/act/data.ts')
  assert.equal(isActGoal({ id: 'g', title: 'Act 2 essay', target_date: TODAY, subject_id: 'X', test_kind: 'test' }, 'S'), false)
  assert.equal(isActGoal({ id: 'g', title: 'ACT', target_date: TODAY, subject_id: null, test_kind: null }, 'S'), false)
  assert.equal(isActGoal({ id: 'g', title: 'Retake', target_date: TODAY, subject_id: 'S', test_kind: null }, 'S'), true)
  assert.equal(isActGoal({ id: 'g', title: 'x', target_date: TODAY, subject_id: null, test_kind: 'act' }, null), true)
})
