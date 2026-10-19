// ACT planner (queue item 2, plans/contracts.md §5): steady mode (holidays 75 min/day rotating E/R/M + a weekly full
// test and its review; school weeks 30 min × 3), countdown mode (daily timed English + review, Reading/Maths alternate,
// mid-week mock, light day before; tier 2 in the last 21 days), weakest-section focus, the books (College Panda
// gaps_only, Advanced ACT Math only once the gaps are closed, the Critical Reader only if reading stalls), the
// flashcards folded into the one ACT line, and the composite maths. Pure: no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const E = await import('../lib/act/engine.ts')
const { BOOKS, bookNotes, roleOf, itemShort } = await import('../lib/act/books.ts')
const { actSettings, DEFAULT_ACT_SETTINGS } = await import('../lib/act/config.ts')
const { TIER } = await import('../lib/plan-items.ts')
const { isoDow, addDays } = await import('../lib/time.ts')

let n = 0
const uid = () => `id-${++n}`
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
const allBooks = (over = {}) => BOOKS.map((b) => over[b.role] ?? book(b.role))
const sc = (kind, e, m, r, s = null, takenOn = '2026-10-10') => ({ id: uid(), takenOn, kind, english: e, maths: m, reading: r, science: s, composite: E.composite(e, m, r) })
const REAL = sc('real', 34, 34, 35, 35, '2026-10-01')
// (the school-week countdown shape with its mock on Wednesdays; his half-term week is in halfterm-week-unit.test.mjs)
const world = (o = {}) => ({ today: '2026-10-19', retake: null, goal: 36, scores: [REAL], books: allBooks(), misses: [], doneToday: [], settings: { ...DEFAULT_ACT_SETTINGS, mockDows: [3] }, subjectId: 'S', ...o })
const ctx = (date, mode = 'school', studyMinutes = 0) => ({ date, dow: isoDow(date), mode, studyMinutes })
// one ACT line a day; a holiday in the countdown has two blocks (4 h)
const pick = (w, d) => { const p = E.actPicks(w, d); assert.ok(p.length <= (w.retake && d.mode === 'half_term' ? 2 : 1), 'one ACT line a day at most'); return p[0] ?? null }
const week = (mon) => Array.from({ length: 7 }, (_, i) => addDays(mon, i))
const HALF = '2026-10-26'   // Mon of half-term
const SCHOOL = '2026-10-19' // Mon of a school week
/** The date in the holiday week whose ACT line is that section's. */
const dayOf = (w, section, mon = HALF) => week(mon).find((d) => pick(w, ctx(d, 'half_term'))?.key.split(':')[1] === section)
const miss = (o = {}) => ({ id: uid(), goalId: null, topicId: null, subjectId: 'S', code: null, question: 'Q12', body: 'joined two sentences with a comma', kind: null, rule: 'comma splice',
  source: 'ACT English', loggedOn: '2026-10-15', reviewOn: '2026-10-18', redoStage: 0, reviewedAt: null, ...o })

test('composite: round(mean of English, Maths, Reading); Science separate; needs all three', () => {
  assert.equal(E.composite(34, 34, 35), 34)       // his last real test: 34
  assert.equal(E.composite(33, 35, 34), 34)
  assert.equal(E.composite(34, 35, 35), 35)       // 34.67 → 35
  assert.equal(E.composite(35, 36, 35), 35)       // 35.33 → 35
  assert.equal(E.composite(36, 36, 36), 36)
  assert.equal(E.composite(33, null, 34), null)
  assert.equal(E.scoreText({ english: 33, maths: 35, reading: 34, science: null }), 'E33 M35 R34')
})

test('weakest section vs the goal: latest score per section; ties go English, Reading, Maths', () => {
  assert.deepEqual(E.weakest([REAL], 36), { section: 'english', score: 34, gap: 2 })   // E34 = M34: English first
  const after = [REAL, sc('practice', 33, 35, 34, null, '2026-10-12')]
  assert.deepEqual(E.weakest(after, 36), { section: 'english', score: 33, gap: 3 })
  assert.deepEqual(E.weakest([REAL, sc('section', null, 30, null, null, '2026-10-13')], 36), { section: 'maths', score: 30, gap: 6 })
  assert.equal(E.weakest([], 36), null)
  assert.deepEqual(E.byNeed(after, 36), ['english', 'reading', 'maths'])
})

test('steady, holidays: ~75 min a day rotating E/R/M weighted to the weakest; full test Wed + review Thu', () => {
  const w = world({ scores: [sc('real', 34, 34, 33, 35, '2026-10-01'), sc('practice', 33, 35, 34, null, '2026-10-12')] })
  const days = week(HALF).map((d) => pick(w, ctx(d, 'half_term')))
  assert.deepEqual(days.map((p) => p.key), ['act:english:book', 'act:reading:book', 'act:full:test', 'act:review:full', 'act:english:book', 'act:reading:book', 'act:maths:test'])
  // E33 (gap 3), R34 (2), M35 (1) → English 2 days, Reading 2, Maths 1 (every section at least once)
  for (const i of [0, 1, 3, 4, 5, 6]) assert.equal(days[i].minutes, 75, `${days[i].title}: 75 min incl. the flashcards`)
  assert.equal(days[2].minutes, 10 + 35 + 50 + 40 + 40, 'the full test: E35 M50 R40 S40 + flashcards')
  assert.equal(days[2].heavy, true)
  assert.match(days[2].open, /official ACT practice test, timed in one sitting: English 35 · Maths 50 · Reading 40 · Science 40/)
  assert.match(days[3].open, /Yesterday’s full test: every miss → its rule/)
  assert.ok(days.every((p) => p.tier === TIER.leftover && p.subject === 'ACT'), 'steady = tier 7 (leftover)')
  assert.equal(days[0].why, 'weakest: English 33 vs 36')
  assert.equal(days[1].why, 'Reading 34 vs 36 · rotation')
  // without Science, the full test is 2 h 05
  const noSci = pick({ ...w, settings: { ...DEFAULT_ACT_SETTINGS, science: false } }, ctx(addDays(HALF, 2), 'half_term'))
  assert.equal(noSci.minutes, 10 + 125)
})

test('steady, school weeks: 30 min × 3 (Tue, Thu, Sat; weakest first) + the flashcards; other days just the 10-min flashcards', () => {
  const w = world()
  const days = week(SCHOOL).map((d) => pick(w, ctx(d, 'school')))
  // E34 M34 R35: English and Maths are 2 below the goal, Reading 1 → English, Maths, Reading
  assert.deepEqual(days.map((p) => p.key), ['act:flashcards:daily', 'act:english:part', 'act:flashcards:daily', 'act:maths:test', 'act:flashcards:daily', 'act:reading:part', 'act:flashcards:daily'])
  // probe 4: a 30-min session on a 45-min chapter only ticks the block (the chapter is done when he says so)
  assert.deepEqual(days[1].done, { kind: 'block' })
  assert.equal(days[1].programmeItemId, null)
  assert.match(days[1].open, /done → “finished Meltzer ch 1”/)
  for (const i of [1, 3, 5]) assert.equal(days[i].minutes, 40, '30-min session + 10-min flashcards')
  for (const i of [0, 2, 4, 6]) {
    assert.equal(days[i].kind, 'flashcards')
    assert.equal(days[i].minutes, 10)
    assert.deepEqual(days[i].done, { kind: 'act', section: 'flashcards' })
  }
  assert.match(days[1].steps.at(-1).what, /finish it next session/, 'a 45-min chapter in a 30-min session says so')
  // his own days
  const mine = { ...w, settings: { ...DEFAULT_ACT_SETTINGS, schoolDays: [1, 3, 5] } }
  assert.deepEqual(week(SCHOOL).map((d) => pick(mine, ctx(d))?.kind), ['act', 'flashcards', 'act', 'flashcards', 'act', 'flashcards', 'flashcards'])
})

test('the flashcards are folded into the ACT line as its first step; paused / 0 min = none', () => {
  const w = world()
  const p = pick(w, ctx(HALF, 'half_term'))
  assert.equal(p.steps[0].minutes, 10)
  assert.match(p.steps[0].what, /grammar flashcards \(Anki\)/)
  assert.equal(p.minutes, p.steps.reduce((a, s) => a + s.minutes, 0))
  const paused = world({ books: allBooks({ flashcards: book('flashcards', {}, { status: 'paused' }) }) })
  const q = pick(paused, ctx(HALF, 'half_term'))
  assert.ok(!q.steps.some((s) => /flashcards/.test(s.what)))
  assert.equal(pick(paused, ctx(SCHOOL)), null, 'no session and no flashcards: nothing')
  assert.equal(pick({ ...w, settings: { ...DEFAULT_ACT_SETTINGS, flashMin: 0 } }, ctx(SCHOOL)), null)
})

test('weakest-section focus: a big Maths gap gets most of the holiday days', () => {
  const w = world({ scores: [REAL, sc('practice', 36, 30, 36, null, '2026-10-12')] })
  const keys = week(HALF).map((d) => pick(w, ctx(d, 'half_term')).key.split(':')[1])
  assert.deepEqual(keys, ['maths', 'english', 'full', 'review', 'maths', 'reading', 'maths'])
  assert.equal(pick(w, ctx(HALF, 'half_term')).why, 'weakest: Maths 30 vs 36')
  assert.deepEqual(E.rotation(['english', 'reading', 'maths'], [], 36, 3), ['english', 'reading', 'maths'], 'no scores: plain rotation')
})

test('College Panda is gaps_only: chapter test first; dropped marks = do the chapter; full marks = skip it', () => {
  const sunday = dayOf(world(), 'maths')   // a Maths day in the holidays
  const first = pick(world(), ctx(sunday, 'half_term'))
  assert.equal(first.title, 'ACT Maths · College Panda ch 1 test')
  assert.match(first.open, /chapter test first \(timed, ~15 min\)\. Full marks = skip the chapter; dropped marks = the chapter \+ its workbook questions/)
  // probe 3: one tap asks for the chapter-test score (full marks = skip the chapter), never marks it done blind
  assert.deepEqual(first.done, { kind: 'programme_item', itemId: 'maths_gaps-1', score: true })
  assert.equal(first.programmeItemId, 'maths_gaps-1')
  // ch 1 full marks (skipped), ch 2 dropped marks (doing): the chapter, then ch 3's test
  const cp = book('maths_gaps', { 1: 'skipped', 2: 'doing' })
  cp.items[1].result = 'chapter test 12/15 · do the chapter'
  const second = pick(world({ books: allBooks({ maths_gaps: cp }) }), ctx(sunday, 'half_term'))
  assert.equal(second.title, 'ACT Maths · College Panda ch 2')
  assert.match(second.open, /the chapter \+ its workbook questions \(chapter test 12\/15\)/)
  assert.ok(second.steps.some((s) => /then the ch 3 chapter test/.test(s.what)))
  assert.equal(E.nextBookItem(cp).id, 'maths_gaps-2', 'a dropped-marks chapter comes before the next test')
})

test('Advanced ACT Math only once the College Panda gaps are closed', () => {
  const sunday = dayOf(world(), 'maths')
  const all = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [i + 1, i % 2 ? 'done' : 'skipped']))
  const oneLeft = { ...all, 30: 'doing' }
  const open = world({ books: allBooks({ maths_gaps: book('maths_gaps', oneLeft) }) })
  assert.equal(E.gapsClosed(open), false)
  assert.match(pick(open, ctx(sunday, 'half_term')).title, /College Panda ch 30/)
  assert.match(E.bookLine(open, open.books.find((b) => roleOf(b) === 'maths_hard')), /after the College Panda gaps/)
  const closed = world({ books: allBooks({ maths_gaps: book('maths_gaps', all) }) })
  assert.equal(E.gapsClosed(closed), true)
  const p = pick(closed, ctx(sunday, 'half_term'))
  assert.equal(p.title, 'ACT Maths · Advanced ACT Math ch 1')
  assert.equal(p.why, 'College Panda gaps closed: the hard questions now')
  // both finished: a timed Maths section from an official practice test
  const adv = book('maths_hard', Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 'done'])))
  const t = pick(world({ books: allBooks({ maths_gaps: book('maths_gaps', all), maths_hard: adv }) }), ctx(sunday, 'half_term'))
  assert.equal(t.key, 'act:maths:timed')
  assert.match(t.open, /the Maths section, timed \(50 min\)/)
  assert.deepEqual(t.done, { kind: 'act', section: 'maths' })
})

test('the Critical Reader only if reading stalls (3 reading scores below goal, no better) after the method chapters; the guide stays main', () => {
  const r = (v, d) => sc('section', null, null, v, null, d)
  // probe 5: real R35 + one practice R35 is no stall (the Reading guide, not the Critical Reader)
  const one = world({ scores: [REAL, r(35, '2026-10-12')] })
  assert.equal(E.readingStalled(one.scores, 36), null)
  assert.equal(pick(one, ctx(dayOf(one, 'reading'), 'half_term')).title, 'ACT Reading · Reading guide ch 1')
  // three below goal, no better: stalled, but only in play once the method chapters are done
  const three = [REAL, r(34, '2026-10-12'), r(35, '2026-10-14')]
  assert.deepEqual(E.readingStalled(three, 36), { from: 35, to: 35 })
  const early = world({ scores: three })
  assert.equal(pick(early, ctx(dayOf(early, 'reading'), 'half_term')).title, 'ACT Reading · Reading guide ch 1', 'method chapters first')
  const methods = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 'done']))
  const stalled = world({ scores: three, books: allBooks({ reading: book('reading', methods) }) })
  const p = pick(stalled, ctx(dayOf(stalled, 'reading'), 'half_term'))
  assert.equal(p.title, 'ACT Reading · Critical Reader ch 1')
  assert.equal(p.why, 'reading stalled (35 → 35): a Critical Reader chapter')
  // the guide stays the main book: after one CR chapter, two passage sets come before the next
  const after1 = world({ scores: three, books: allBooks({ reading: book('reading', methods), reading_extra: book('reading_extra', { 1: 'done' }) }) })
  assert.equal(pick(after1, ctx(dayOf(after1, 'reading'), 'half_term')).title, 'ACT Reading · Reading guide timed passage set 1')
  const after2 = world({ scores: three, books: allBooks({ reading: book('reading', { ...methods, 11: 'done', 12: 'done' }), reading_extra: book('reading_extra', { 1: 'done' }) }) })
  assert.equal(pick(after2, ctx(dayOf(after2, 'reading'), 'half_term')).title, 'ACT Reading · Critical Reader ch 2')
  const better = world({ scores: [r(33, '2026-10-01'), r(33, '2026-10-05'), r(35, '2026-10-12')] })
  assert.equal(E.readingStalled(better.scores, 36), null)
  // he switches it on: in play straight away (still one CR chapter per two guide items)
  const on = world({ books: allBooks({ reading_extra: book('reading_extra', {}, { mode: 'in_order' }) }) })
  assert.equal(pick(on, ctx(dayOf(on, 'reading'), 'half_term')).title, 'ACT Reading · Critical Reader ch 1')
})

test('the Reading guide: method chapters first, then the timed passage sets', () => {
  const r = book('reading', Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, 'done'])))
  const w = world({ books: allBooks({ reading: r }) })
  const p = pick(w, ctx(dayOf(w, 'reading'), 'half_term'))
  assert.equal(p.title, 'ACT Reading · Reading guide timed passage set 1')
  assert.match(p.open, /3 passages, ~9 min each, timed; then every wrong answer back to the text/)
})

test('countdown: daily timed English + review, Reading/Maths alternate (weaker more), mock Wed, review Thu', () => {
  const w = world({ retake: { goalId: 'G', date: '2026-12-12' }, scores: [REAL, sc('practice', 33, 35, 34, null, '2026-10-12')] })
  const days = week(SCHOOL).map((d) => pick(w, ctx(d)))
  assert.deepEqual(days.map((p) => p.title), [
    'ACT countdown: timed English + Reading', 'ACT countdown: timed English + Maths', 'ACT mock: full timed test', 'ACT countdown: timed English + mock review',
    'ACT countdown: timed English + Reading', 'ACT countdown: timed English + Maths', 'ACT countdown: timed English + Reading'])
  for (const p of days.filter((x) => x.key === 'act:english:timed')) {
    assert.ok(p.steps.some((s) => /timed English section \(35 min\)/.test(s.what)), 'timed English every day')
    assert.ok(p.steps.some((s) => /every miss against its rule/.test(s.what)), 'every miss reviewed against its rule')
    assert.equal(p.goalId, 'G')
  }
  assert.equal(days[0].minutes, 10 + 35 + 15 + 40 + 15)
  assert.equal(days[1].minutes, 10 + 35 + 15 + 50 + 15)
  assert.equal(days[2].minutes, 10 + 165)
  assert.ok(days.every((p) => p.tier === TIER.leftover), '54 days away: tier 7')
  assert.equal(days[0].why, 'retake in 54 days · weakest: English 33 vs 36')
})

test('countdown tier: 2 in the last 21 days, else 7; the day before is light; the day itself', () => {
  const w = world({ retake: { goalId: 'G', date: '2026-11-07' }, misses: [miss(), miss({ id: 'm2', rule: 'who vs whom', question: 'Q3' })] })
  assert.equal(pick(w, ctx('2026-10-16')).tier, TIER.leftover, '22 days before: tier 7')
  assert.equal(pick(w, ctx('2026-10-17')).tier, TIER.test, '21 days before: tier 2')
  const eve = pick(w, ctx('2026-11-06'))
  assert.equal(eve.key, 'act:light:eve')
  assert.equal(eve.tier, TIER.test)
  assert.equal(eve.minutes, 10 + 20)
  assert.match(eve.open, /Light: read your rules list \(who vs whom, comma splice\) and your misses list \(2 open\)\. Nothing timed\. .*early night/)
  const dayOf = pick(w, ctx('2026-11-07'))
  assert.equal(dayOf.key, 'act:test:day')
  assert.equal(dayOf.minutes, 15)
  // after the date: back to steady
  assert.equal(pick(w, ctx('2026-11-09', 'half_term')).key, 'act:english:book:redo', 'its due misses are redone in it')
})

test('countdown on a short day: never more than the time he has (the alternating section goes first)', () => {
  const w = world({ retake: { goalId: 'G', date: '2026-11-07' } })
  const p = pick(w, ctx(SCHOOL, 'school', 60))
  assert.equal(p.title, 'ACT countdown: timed English')
  assert.equal(p.minutes, 60)
  assert.match(p.why, /no time for Maths today/, 'Maths (34) is the weaker of Reading / Maths, so it is Monday’s')
  const full = pick(w, ctx(SCHOOL, 'school', 240))
  assert.equal(full.title, 'ACT countdown: timed English + Maths')
  assert.equal(full.minutes, 10 + 35 + 15 + 50 + 15)
})

test('due misses: redone in the session (steady: its section; countdown: all), with their rules', () => {
  const w = world({ misses: [miss(), miss({ id: 'm2', source: 'ACT Maths', rule: 'units', reviewOn: '2026-10-30' })] })
  const p = pick(w, ctx(dayOf(w, 'english'), 'half_term'))
  const step = p.steps.find((s) => /^redo/.test(s.what))
  assert.match(step.what, /redo 1 due English miss without looking \(comma splice\)/)
  assert.equal(p.minutes, 75)
  const c = E.actPicks({ ...w, retake: { goalId: 'G', date: '2026-11-07' } }, ctx(HALF, 'half_term'))
  assert.match(c.at(-1).steps.at(-1).what, /redo 1 due miss without looking/)
})

test('nothing set up = no ACT; ACT done today = nothing more today', () => {
  assert.deepEqual(E.actPicks(world({ books: [] }), ctx(HALF, 'half_term')), [])
  assert.equal(pick(world({ books: [], retake: { goalId: 'G', date: '2026-12-12' } }), ctx(HALF)).key, 'act:english:timed', 'a retake date works without the books')
  assert.deepEqual(E.actPicks(world({ today: HALF, doneToday: ['act:day'] }), ctx(HALF, 'half_term')), [])
  assert.deepEqual(E.actPicks(world({ today: HALF, doneToday: ['act:english:book'] }), ctx(HALF, 'half_term')), [])
  assert.deepEqual(E.actPicks(world({ doneToday: ['act:flashcards:daily'] }), ctx(SCHOOL)), [])
  assert.equal(pick(world({ today: HALF, doneToday: ['act:day'] }), ctx(addDays(HALF, 1), 'half_term')).key, 'act:maths:test', 'done today never hides tomorrow')
})

test('every pick follows lib/plan-items: key, open, minutes = its steps, why, done; one line a day across 3 weeks', () => {
  const ws = [world(), world({ retake: { goalId: 'G', date: '2026-11-07' } })]
  for (const w of ws) for (const mode of ['school', 'half_term']) for (let i = 0; i < 21; i++) {
    const d = addDays(SCHOOL, i)
    const p = pick(w, ctx(d, mode))
    if (!p) continue
    assert.match(p.key, /^act:[a-z]+:[a-z]+(:redo)?$/)
    assert.equal(p.key.endsWith(':redo'), p.steps.some((x) => E.REDO_STEP.test(x.what)), 'the key says if it redoes misses')
    assert.ok(p.open.length > 10 && p.title && p.why !== undefined)
    assert.equal(p.minutes, p.steps.reduce((a, s) => a + s.minutes, 0), `${d} ${p.title}`)
    assert.ok(['act', 'programme_item', 'block'].includes(p.done.kind))
    if (p.done.kind === 'programme_item') assert.equal(p.programmeItemId, p.done.itemId)
  }
})

test('roles survive a rename (notes carry role=…); generic names still work; items are generic, counts are guesses', () => {
  assert.equal(roleOf({ name: 'My grammar book', notes: 'ACT book · role=english', mode: 'in_order' }), 'english')
  assert.equal(roleOf({ name: 'College Panda', notes: null, mode: 'gaps_only' }), 'maths_gaps')
  assert.equal(roleOf({ name: 'The Critical Reader', notes: null, mode: 'optional' }), 'reading_extra')
  assert.equal(roleOf({ name: 'Grammar flashcards (Anki)', notes: null, mode: 'in_order' }), 'flashcards')
  for (const b of BOOKS) for (const it of b.items) assert.match(it.title, /^(Chapter|Timed passage set) \d+$/, 'never invented chapter titles')
  assert.deepEqual(BOOKS.map((b) => [b.role, b.items.length]), [['english', 16], ['reading', 18], ['maths_gaps', 30], ['maths_hard', 12], ['reading_extra', 12], ['flashcards', 0]])
  assert.equal(itemShort({ title: 'Chapter 4: Commas' }), 'ch 4: Commas')
})

test('ACT settings: defaults from his brief, his own values, odd ones ignored', () => {
  const d = actSettings({})
  assert.deepEqual(d, { goal: 36, ...DEFAULT_ACT_SETTINGS })
  const mine = actSettings({ actSchoolDays: 'monday, wednesday, friday', actHalfTermMin: 90, actTestDay: 'saturday', actScience: 'no', actGoal: 35 })
  assert.deepEqual([mine.schoolDays, mine.halfTermMin, mine.fullTestDow, mine.science, mine.goal], [[1, 3, 5], 90, 6, false, 35])
  assert.equal(actSettings({ actHalfTermMin: 5000, actGoal: 40 }).halfTermMin, 75)
  assert.equal(actSettings({ actGoal: 40 }).goal, 36)
})

test('probe 2: countdown on a short day shortens the reviews before dropping a section; Maths (tied weakest) is never starved', () => {
  // E34 M34 R35, retake 12 Dec, the school week of 23 Nov, 120 min free
  const w = world({ retake: { goalId: 'G', date: '2026-12-12' } })
  const days = week('2026-11-23').map((d) => pick(w, ctx(d, 'school', 120)))
  const second = days.map((p) => (p.title.match(/timed English \+ (Reading|Maths)$/) ?? [])[1] ?? null)
  assert.deepEqual(second, ['Maths', 'Reading', null, null, 'Maths', 'Reading', 'Maths'], 'mock Wed, mock review Thu')
  for (const p of days.filter((x) => x.key !== "act:full:mock")) assert.ok(p.minutes <= 120, `${p.title}: ${p.minutes} min`)   // (the weekly mock is the one fixed long day)
  assert.ok(!days.some((p) => /no time for/.test(p.why)))
  assert.ok(days[0].steps.some((x) => x.minutes === 5 && /Maths miss/.test(x.what)), 'its review shortened to 5 min')
  // only a really short day drops it (and says so)
  assert.match(pick(w, ctx('2026-11-23', 'school', 70)).why, /no time for Maths today/)
})

test('probe 7: the key ends ":redo" only when the pick redoes due misses', () => {
  const due = world({ today: HALF, misses: [miss()] })
  const eng = dayOf(due, 'english')
  assert.equal(pick(due, ctx(eng, 'half_term')).key, 'act:english:book:redo')
  const notDue = world({ today: HALF, misses: [miss({ reviewOn: '2026-12-01' })] })
  assert.equal(pick(notDue, ctx(eng, 'half_term')).key, 'act:english:book', 're-reading the rules is not a redo')
  assert.equal(pick(world({ today: HALF }), ctx(eng, 'half_term')).key, 'act:english:book')
})
