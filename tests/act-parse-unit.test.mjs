// ACT messages read without the AI (queue item 2, plans/contracts.md §2 fast paths): scores (with typos), the retake
// date, a retake without a date, misses with their rule, redos, book progress and edits, the set-up. Strict: other
// areas' phrases ("matrices 🟢", "HT2 practice 38/45", "bench 80x5x3", "mistake: PC1-03 …") are never taken. Pure.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const P = await import('../lib/act/parse.ts')
const T = '2026-10-19'
const score = (e, m, r, s = null, kind = 'practice', yesterday = false) => ({ kind, english: e, maths: m, reading: r, science: s, yesterday })

test('scores: his shapes, typos and spacing; real vs practice vs one section', () => {
  const cases = [
    ['ACT practice: E33 M35 R34', score(33, 35, 34)],
    ['act 33 35 34', score(33, 35, 34)],
    ['practice test E33 M35 R34 S32', score(33, 35, 34, 32)],
    ['ACT practise E33 M35 R 34', score(33, 35, 34)],
    ['act prac: e33 m35 r34', score(33, 35, 34)],
    ['ACT pratice E 33, M 35, R 34', score(33, 35, 34)],
    ['ACT practice 34: E33 M35 R34', score(33, 35, 34)],
    ['I got E33 M35 R34 on my ACT practice today', score(33, 35, 34)],
    ['ACT: english 33 maths 35 reading 34', score(33, 35, 34)],
    ['act practice 33/35/34', score(33, 35, 34)],
    ['E33 M35 R34', score(33, 35, 34)],
    ['real ACT: E35 M36 R35 S34', score(35, 36, 35, 34, 'real')],
    ['ACT practice yesterday: E33 M35 R34 S30', score(33, 35, 34, 30, 'practice', true)],
    ['english section 30', score(30, null, null, null, 'section')],
    ['maths section 31', score(null, 31, null, null, 'section')],
    ['reading section 31/36', score(null, null, 31, null, 'section')],
    ['act english 30', score(30, null, null, null, 'section')],
  ]
  for (const [msg, want] of cases) assert.deepEqual(P.parseScore(msg), want, msg)
})

test('scores: unsure = null (the brain reads it)', () => {
  for (const msg of ['e 5', 'act 33 35', 'ACT practice: E33 M35 R34 R30', 'ACT practice: E40 M35 R34', 'ACT practice 34', 'matrices green', 'HT2 practice 38/45',
    'bench 80x5x3', 'squat 100 5x5', 'football Wed 7:45', 'family dinner Sat 7', 'did Bicen matrices set 8/10', 'ACT top priority this week', 'act 33 35 34 and maths homework']) {
    assert.equal(P.parseScore(msg), null, msg)
  }
})

test('dates: "12 Dec", "12th of December", "Dec 12", "12/12" (UK), next one from today', () => {
  assert.deepEqual(P.parseDate('ACT retake is 12 Dec', T), { date: '2026-12-12', words: '12 dec' })
  assert.equal(P.parseDate('the 12th of December', T).date, '2026-12-12')
  assert.equal(P.parseDate('Dec 12th', T).date, '2026-12-12')
  assert.equal(P.parseDate('12/12', T).date, '2026-12-12')
  assert.equal(P.parseDate('13 Feb', T).date, '2027-02-13', 'no year: the next one')
  assert.equal(P.parseDate('Saturday 12 December 2026', T).date, '2026-12-12')
  assert.equal(P.parseDate('31 Feb', T), null)
})

test('the retake: set, ask for the date when there is none, clear, when', () => {
  const set = (msg, date) => assert.deepEqual(P.parseRetake(msg, T)?.kind === 'set' ? P.parseRetake(msg, T).date : P.parseRetake(msg, T), date, msg)
  set('ACT retake is 12 Dec', '2026-12-12')
  set('my ACT retake is on 12 December', '2026-12-12')
  set('ACT retake moved to 13 Feb', '2027-02-13')
  set('the ACT is on Saturday 12 December 2026', '2026-12-12')
  set('booked the ACT for 12 Dec', '2026-12-12')
  set("I'm doing the ACT again on 12th Dec", '2026-12-12')
  set('act retake 12/12', '2026-12-12')
  for (const msg of ["I'm retaking the ACT", 'retaking the ACT', 'I booked an ACT retake', 'ACT retake', "i'm doing the act again"]) assert.deepEqual(P.parseRetake(msg, T), { kind: 'ask' }, msg)
  for (const msg of ['no ACT retake', 'ACT retake cancelled', "I'm not retaking the ACT", 'cancel my ACT retake']) assert.deepEqual(P.parseRetake(msg, T), { kind: 'clear' }, msg)
  assert.deepEqual(P.parseRetake('when is my ACT?', T), { kind: 'when' })
  for (const msg of ['ACT retake is 12 Dec and maths test is 13 Dec', 'not 12 Dec, the ACT retake moved to 13 Feb', 'ACT top priority this week', 'pause getting ahead until 25 Oct']) assert.equal(P.parseRetake(msg, T), null, msg)
  assert.deepEqual(P.parseBareDate("it's the 12th of December", T), { date: '2026-12-12', words: 'the 12th of december' })
  assert.equal(P.parseBareDate('12 Dec', T).date, '2026-12-12')
  assert.equal(P.parseBareDate('dentist 12 Dec', T), null)
})

test('a miss with its rule (and what went wrong, and the type)', () => {
  assert.deepEqual(P.parseMiss('ACT miss: english Q12 comma splice — joined two sentences with a comma'),
    { section: 'english', question: 'Q12', rule: 'comma splice', what: 'joined two sentences with a comma', kind: null })
  assert.deepEqual(P.parseMiss('ACT mistake: E Q12 comma splice - used a comma between two sentences – careless'),
    { section: 'english', question: 'Q12', rule: 'comma splice', what: 'used a comma between two sentences', kind: 'careless' })
  assert.deepEqual(P.parseMiss('missed ACT english Q14: rule = semicolons need two full sentences'),
    { section: 'english', question: 'Q14', rule: 'semicolons need two full sentences', what: '', kind: null })
  assert.deepEqual(P.parseMiss('ACT english miss Q3 who vs whom — used who as an object'), { section: 'english', question: 'Q3', rule: 'who vs whom', what: 'used who as an object', kind: null })
  assert.equal(P.parseMiss('act miss reading q5: misread the question').section, 'reading')
  for (const msg of ['mistake: PC1-03 Q3b assumed through origin – knowledge', 'ACT miss: Q12 comma', 'I missed the bus']) assert.equal(P.parseMiss(msg), null, msg)
  assert.deepEqual(P.parseRedo('redid ACT english Q12'), { section: 'english', question: 'Q12', all: false })
  assert.deepEqual(P.parseRedo('redid my ACT misses'), { section: null, question: null, all: true })
  assert.equal(P.parseRedo('redid PC1-03 Q3b'), null)
})

test('book progress: done, chapter test scores (gaps_only), skip, counts, renames, the Critical Reader on/off', () => {
  const b = (msg) => P.parseBook(msg)
  const ch = (n) => ({ kind: 'chapter', n })
  assert.deepEqual(b('finished Meltzer chapter 3'), { do: 'done', book: 'english', item: ch(3), score: null, outOf: null })
  for (const msg of ['done meltzer ch 3', 'did Meltzer ch3', 'meltzer chapter 3 done']) assert.equal(b(msg).do, 'done', msg)
  assert.deepEqual(b('College Panda ch 4 test 12/15'), { do: 'score', book: 'maths_gaps', item: ch(4), score: 12, outOf: 15, full: false })
  assert.equal(b('CP ch 4 test 15/15').full, true)
  assert.equal(b('college panda ch 4 full marks').full, true)
  assert.deepEqual(b('skip college panda ch 6'), { do: 'skip', book: 'maths_gaps', item: ch(6), score: null, outOf: null })
  assert.equal(b('Advanced ACT Math ch 2 done').book, 'maths_hard')
  assert.equal(b('critical reader ch 1 done').book, 'reading_extra')
  assert.equal(b('finished ACT reading chapter 2').book, 'reading')
  assert.deepEqual(b('did reading guide passage set 2').item, { kind: 'passage', n: 2 })
  assert.deepEqual(b('Meltzer has 18 chapters'), { do: 'count', book: 'english', kind: 'chapter', count: 18 })
  assert.deepEqual(b('rename Meltzer chapter 3 to Commas'), { do: 'rename', book: 'english', item: ch(3), title: 'Commas' })
  assert.deepEqual(b('start the Critical Reader'), { do: 'start', book: 'reading_extra' })
  assert.deepEqual(b('stop the critical reader'), { do: 'stop', book: 'reading_extra' })
  for (const msg of ['finished textbook exercise on logs', 'did Bicen matrices set 8/10', 'done STEP 3', 'finished the reading guide chapter 4 and loved it', 'College Panda ch 4 test 16/15']) assert.equal(b(msg), null, msg)
})

test('set-up and "how is my ACT?" phrases', () => {
  for (const msg of ['set up ACT', 'set up my ACT books', 'ACT setup', 'please set up the ACT', 'setup act please']) assert.ok(P.isSetup(msg), msg)
  for (const msg of ['set up my week', 'set up the maths tracker']) assert.ok(!P.isSetup(msg), msg)
  for (const msg of ['ACT?', 'how is my ACT going', 'act status', 'what act should I do today', 'whats next for act', "how's my act"]) assert.ok(P.isActQuestion(msg), msg)
  assert.ok(!P.isActQuestion('what should I do today?'))
})

test('probe 8: two section scores without ACT / practice wording are not ACT scores; E, M and R together are', () => {
  for (const msg of ['maths 23 english 30', 'got maths 23 english 30 on my mocks', 's3 e4', 'm 5 r 6', 'test: e 20 m 21', 'e 20 m 21 s 30']) assert.equal(P.parseScore(msg), null, msg)
  assert.deepEqual(P.parseScore('E33 M35 R34 S30'), { kind: 'practice', english: 33, maths: 35, reading: 34, science: 30, yesterday: false })
  assert.equal(P.parseScore('ACT e 20 m 21').kind, 'practice', 'with the word ACT, two sections are fine')
  assert.equal(P.parseScore('practice E33 M35').kind, 'practice')
})
