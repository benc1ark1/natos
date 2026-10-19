// The study tracker bot's word-reading (lib/tracker/bot-parse.ts): colours (emoji, words, typos), topics (codes first,
// then names, aliases, plurals, typos, ambiguity), scores, dates and rule end dates relative to a fixed today
// (Mon 19 Oct 2026), key=value lists, question numbers and mistake types. Pure: no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { world } from './support/tracker-bot.mjs'

const P = await import('../lib/tracker/bot-parse.ts')
const TODAY = '2026-10-19'   // a Monday
const W = world(TODAY)
const hit = (said) => { const m = P.findTopic(W.topics, said, TODAY); return m && 'hit' in m ? m.hit.code : m && 'options' in m ? m.options.map((t) => t.code) : null }

test('colours: emoji, words, small typos; "red" must be exact; anything else is null', () => {
  for (const [w, c] of [['🟢', 'exam_ready'], ['🟡', 'understand'], ['🔴', 'not_secure'], ['⚪', 'not_started'], ['⚪️', 'not_started'], ['green', 'exam_ready'], ['GREEN', 'exam_ready'],
    ['yellow', 'understand'], ['amber', 'understand'], ['red', 'not_secure'], ['white', 'not_started'], ['exam ready', 'exam_ready'], ['not secure', 'not_secure'],
    ['grean', 'exam_ready'], ['gren', 'exam_ready'], ['yelow', 'understand'], ['yello', 'understand'], ['yellw', 'understand'], ['green!', 'exam_ready']]) assert.equal(P.colourOf(w), c, w)
  for (const w of ['rd', 'reds', 'great', 'blue', 'go', 'gr', 'done', '✅', 'greenish matrices']) assert.equal(P.colourOf(w), null, w)
})

test('splitColour: the colour at the end and the words before it', () => {
  assert.deepEqual(P.splitColour('matrices 🟢'), { rest: 'matrices', colour: 'exam_ready' })
  assert.deepEqual(P.splitColour('PC1-01 green'), { rest: 'PC1-01', colour: 'exam_ready' })
  assert.deepEqual(P.splitColour('set trig yellow'), { rest: 'set trig', colour: 'understand' })
  assert.deepEqual(P.splitColour('matrics grean'), { rest: 'matrics', colour: 'exam_ready' })
  assert.deepEqual(P.splitColour('vectors is now red.'), { rest: 'vectors', colour: 'not_secure' })
  assert.deepEqual(P.splitColour("it's green now"), { rest: "it's", colour: 'exam_ready' })
  assert.deepEqual(P.splitColour('matrices → 🟡'), { rest: 'matrices', colour: 'understand' })
  assert.equal(P.splitColour('green'), null, 'a colour alone names no topic')
  assert.equal(P.splitColour('buy milk'), null)
})

test('topics: codes first (any case), then names, aliases ("logs", "trig"), plurals and small typos', () => {
  assert.equal(hit('PC1-01'), 'PC1-01')
  assert.equal(hit('pc1-01'), 'PC1-01')
  assert.equal(hit('p1.1'), 'P1.1')
  assert.equal(hit('PC9-99'), null, 'an unknown code is not guessed')
  assert.equal(hit('matrices'), 'PC1-01', '“Matrices” starts with it; “Applications of matrices” does not')
  assert.equal(hit('the matrices'), 'PC1-01')
  assert.equal(hit('logs'), 'Y1-07')
  assert.equal(hit('trig'), 'Y1-10')
  assert.equal(hit('polynomial'), 'Y1-04')
  assert.equal(hit('vectors'), 'Y1-12')
  assert.equal(hit('kinematics'), 'P1.1')
  assert.equal(hit('stationary waves'), 'P7.3')
  assert.equal(hit('matrics'), 'PC1-01', 'one letter missing')
  assert.equal(hit('polynomals'), 'Y1-04')
  assert.equal(hit('diferentiation'), 'Y1-13', 'a typo: the topic called exactly that wins over “Applications of …”')
  assert.equal(hit('fm vectors'), 'PC1-02', 'a subject word narrows it down')
  assert.equal(hit('physics momentum'), 'P3.1')
  assert.equal(hit('xyz'), null)
  assert.equal(hit('it'), null, 'too short to guess')
})

test('topics: ambiguous words prefer what is taught; otherwise all the options come back', () => {
  assert.equal(hit('proof'), 'Y1-01', 'Y2 “Proof” is far off; the taught one wins')
  const w2 = world(TODAY)
  w2.topics.find((t) => t.code === 'Y2-01').taughtFrom = '2026-10-01'
  const m = P.findTopic(w2.topics, 'proof', TODAY)
  assert.equal(m.hit.code, 'Y2-01', 'both taught: the one called exactly that')
  w2.topics.push({ ...w2.topics.find((t) => t.code === 'PC1-03'), id: 'x', code: 'PC2-09', name: 'Applications of matrices 2' })
  const many = P.findTopic(w2.topics, 'applications of matrices', TODAY)
  assert.ok('hit' in many, 'an exact name still wins')
  const opts = P.findTopic(w2.topics, 'applications', TODAY)
  assert.deepEqual(opts.options.map((t) => t.code), ['PC1-03', 'PC2-09'], 'the taught ones (not the one far off)')
})

test('several topics at once; one that does not fit makes the whole list null', () => {
  assert.deepEqual(P.findTopics(W.topics, 'matrices and vectors', TODAY).map((t) => t.code), ['PC1-01', 'Y1-12'])
  assert.deepEqual(P.findTopics(W.topics, 'PC1-01, PC1-02 & logs', TODAY).map((t) => t.code), ['PC1-01', 'PC1-02', 'Y1-07'])
  assert.equal(P.findTopics(W.topics, 'matrices and football', TODAY), null)
  assert.deepEqual(P.codesIn(W.topics, 'mistake on PC1-03 and pc1-01 (not XY9-01)').map((t) => t.code), ['PC1-03', 'PC1-01'])
})

test('scores: 8/10, 38 out of 45, 80%; impossible ones are null', () => {
  assert.deepEqual(P.findScore('did bicen 8/10'), { score: 8, outOf: 10, pct: 80, text: '8/10' })
  assert.deepEqual(P.findScore('got 38 out of 45'), { score: 38, outOf: 45, pct: 84, text: '38 out of 45' })
  assert.deepEqual(P.findScore('integral 90%'), { score: 90, outOf: 100, pct: 90, text: '90%' })
  assert.equal(P.findScore('11/10 wow'), null)
  assert.equal(P.findScore('150%'), null)
  assert.equal(P.findScore('no score here'), null)
  assert.equal(P.findScore('8 / 10').score, 8)
})

test('dates from his words, on or after today (Mon 19 Oct 2026)', () => {
  const d = (w) => P.dateFromWords(w, TODAY)
  assert.equal(d('25 Oct'), '2026-10-25')
  assert.equal(d('25th October'), '2026-10-25')
  assert.equal(d('Oct 25'), '2026-10-25')
  assert.equal(d('25/10'), '2026-10-25')
  assert.equal(d('1 Nov'), '2026-11-01')
  assert.equal(d('5 jan'), '2027-01-05', 'a date already past this year is next year')
  assert.equal(d('the 25th'), '2026-10-25')
  assert.equal(d('the 5th'), '2026-11-05', 'past this month: next month')
  assert.equal(d('sunday'), '2026-10-25')
  assert.equal(d('Fri'), '2026-10-23')
  assert.equal(d('next sunday'), '2026-11-01')
  assert.equal(d('monday'), '2026-10-19', 'today counts')
  assert.equal(d('tomorrow'), '2026-10-20')
  assert.equal(d('today'), '2026-10-19')
  assert.equal(d('31 Feb'), null)
  assert.equal(d('christmas'), null)
  assert.equal(d('25 days'), null)
})

test('rule end dates: this week = Sunday; until <date>; for 2 weeks; next week; until I say = 8 weeks', () => {
  const e = (w, today = TODAY) => P.endFromWords(w, today)
  assert.deepEqual(e('this week'), { ends: '2026-10-25', words: 'this week' })
  assert.deepEqual(e('for the rest of this week'), { ends: '2026-10-25', words: 'for the rest of this week' })
  assert.deepEqual(e('until 25 Oct'), { ends: '2026-10-25', words: 'until 25 oct' })
  assert.deepEqual(e('till Friday'), { ends: '2026-10-23', words: 'till friday' })
  assert.deepEqual(e('until the end of the week'), { ends: '2026-10-25', words: 'until the end of the week' })
  assert.deepEqual(e('for 2 weeks'), { ends: '2026-11-01', words: 'for 2 weeks' })
  assert.deepEqual(e('for a fortnight'), { ends: '2026-11-01', words: 'for a fortnight' })
  assert.deepEqual(e('for three days'), { ends: '2026-10-21', words: 'for three days' })
  assert.deepEqual(e('next week'), { starts: '2026-10-26', ends: '2026-11-01', words: 'next week' })
  assert.deepEqual(e('today'), { ends: '2026-10-19', words: 'today' })
  assert.deepEqual(e('tomorrow'), { starts: '2026-10-20', ends: '2026-10-20', words: 'tomorrow' })
  assert.deepEqual(e('until I say'), { ends: '2026-12-13', words: 'until i say', untilISay: true })
  assert.equal(e('for now').untilISay, true)
  assert.deepEqual(e('this week', '2026-10-25'), { ends: '2026-10-25', words: 'this week' }, 'on a Sunday, this week is today')
  assert.equal(e('until christmas'), null)
  assert.equal(e('for 200 days'), null)
  assert.equal(e('soonish'), null)
})

test('key=value lists, both ways (a ";" inside a value is kept as ",")', () => {
  assert.deepEqual(P.kv('what=bicen; score=8; out_of=10'), { what: 'bicen', score: '8', out_of: '10' })
  assert.deepEqual(P.kv('Per Week=2;days= weekend ;empty=;noequals'), { per_week: '2', days: 'weekend' })
  assert.deepEqual(P.kv('items=A | B | C; url=https://x.org/a=b'), { items: 'A | B | C', url: 'https://x.org/a=b' })
  assert.equal(P.kvText({ what: 'bicen', score: 8, notes: true, gone: null, no: false, blank: '' }), 'what=bicen; score=8; notes=yes')
  assert.equal(P.kvText({ what: 'a; b' }), 'what=a, b')
  assert.deepEqual(P.kv(P.kvText({ rule: 'check signs', kind: 'careless' })), { rule: 'check signs', kind: 'careless' })
})

test('question numbers and the mistake type at the end', () => {
  assert.equal(P.questionOf('PC1-03 Q3b assumed through origin'), 'Q3b')
  assert.equal(P.questionOf('q 4 forgot'), 'Q4')
  assert.equal(P.questionOf('Q12(a)(ii) sign'), 'Q12(a)(ii)')
  assert.equal(P.questionOf('question 7 was hard'), 'Q7')
  assert.equal(P.questionOf('quality time'), null)
  assert.deepEqual(P.trailingKind('PC1-03 Q3b assumed through origin – knowledge'), { rest: 'PC1-03 Q3b assumed through origin', kind: 'knowledge' })
  assert.deepEqual(P.trailingKind('sign error, careless'), { rest: 'sign error', kind: 'careless' })
  assert.deepEqual(P.trailingKind('forgot the chain rule (method)'), { rest: 'forgot the chain rule', kind: 'method' })
  assert.deepEqual(P.trailingKind('through-origin - Knowledge mistake'), { rest: 'through-origin', kind: 'knowledge' })
  assert.deepEqual(P.trailingKind('ran out of time - timing'), { rest: 'ran out of time', kind: 'time' })
  assert.deepEqual(P.trailingKind('PC1-03 Q3b: wrong sign'), { rest: 'PC1-03 Q3b: wrong sign', kind: null }, '“wrong sign” is not a type')
  assert.deepEqual(P.trailingKind('just words'), { rest: 'just words', kind: null })
})

test('edit distance stops early and typo allowance grows with the word', () => {
  assert.equal(P.editDistance('matrics', 'matrices'), 1)
  assert.equal(P.editDistance('kitten', 'sitting'), 3)
  assert.ok(P.editDistance('abcdefgh', 'zzzzzzzz', 2) > 2)
  assert.deepEqual([3, 4, 6, 7, 12].map(P.typoAllowance), [0, 1, 1, 2, 2])
})
