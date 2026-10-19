// The study tracker's fast paths (lib/tracker/bot-fast.ts): every phrase in Nat's brief becomes the right trk_ change
// with no AI, typos included; vague "make it green" uses the last topic talked about; anything unsure is null so the
// brain reads it instead. Fixed today: Mon 19 Oct 2026. Pure: no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { world } from './support/tracker-bot.mjs'

const { parseFast, mightBeTracker, recentTopic } = await import('../lib/tracker/bot-fast.ts')
const { kv } = await import('../lib/tracker/bot-parse.ts')
const TODAY = '2026-10-19'
const W = world(TODAY)
const id = (code) => W.topics.find((t) => t.code === code).id
const one = (msg, ctx) => {
  const r = parseFast(msg, W, TODAY, ctx)
  assert.equal(r?.kind, 'actions', `“${msg}” → ${JSON.stringify(r)}`)
  assert.equal(r.actions.length, 1)
  const a = r.actions[0]
  return { op: a.op, ref: a.ref, v: kv(a.value), date: a.date, words: a.words }
}
const none = (msg, ctx) => assert.equal(parseFast(msg, W, TODAY, ctx), null, `“${msg}” should go to the brain`)

test('colours: "matrices 🟢", "matrices green", "PC1-01 green", "set trig yellow", typos, several topics', () => {
  assert.deepEqual(one('matrices 🟢'), { op: 'trk_colour', ref: 'PC1-01', v: { colour: 'green' }, date: '', words: '' })
  assert.equal(one('matrices green').ref, 'PC1-01')
  assert.equal(one('PC1-01 green').v.colour, 'green')
  assert.deepEqual([one('set trig yellow').ref, one('set trig yellow').v.colour], ['Y1-10', 'yellow'])
  assert.deepEqual([one('matrics grean').ref, one('matrics grean').v.colour], ['PC1-01', 'green'])
  assert.equal(one('Mark polynomials as red').v.colour, 'red')
  assert.equal(one('kinematics is now 🟡').ref, 'P1.1')
  const two = parseFast('matrices and vectors 🟢', W, TODAY)
  assert.deepEqual(two.actions.map((a) => a.ref), ['PC1-01', 'Y1-12'])
})

test('vague "make it green": the one topic the last messages were about; never while a card is waiting', () => {
  const recent = ['✅ Done\n• PC1-01 Matrices: 🔴 → 🟡 · review Thu 22 Oct', 'PC1-01 yellow']
  assert.equal(one('make it green', { recent, cardOpen: false }).ref, 'PC1-01')
  assert.equal(one("it's 🟢 now", { recent, cardOpen: false }).ref, 'PC1-01')
  none('make it green', { recent, cardOpen: true })
  none('make it green', { recent: [], cardOpen: false })
  none('make it green', { recent: ['/maths list: PC1-01 PC1-02 PC1-03'], cardOpen: false })
  assert.equal(recentTopic(W, ['how is Applications of matrices going?']).code, 'PC1-03', 'names count too (the longest one)')
})

test('work done: "did Bicen matrices set 8/10", "finished textbook exercise on logs", scores, notes, physics', () => {
  assert.deepEqual(one('did Bicen matrices set 8/10'), { op: 'trk_log', ref: 'PC1-01', v: { what: 'bicen', score: '8', out_of: '10' }, date: '', words: '' })
  assert.deepEqual(one('finished textbook exercise on logs').v, { what: 'exercise' })
  assert.equal(one('finished textbook exercise on logs').ref, 'Y1-07')
  assert.deepEqual(one('integral assessment on matrices 90%').v, { what: 'integral', pct: '90' })
  assert.deepEqual(one('did the mixed exercise on vectors with notes 7/10').v, { what: 'mixed', score: '7', out_of: '10', notes: 'yes' })
  assert.deepEqual(one('reviewed polynomials 4/4').v, { what: 'review', score: '4', out_of: '4' })
  assert.deepEqual(one('kinematics booklet done'), { op: 'trk_log', ref: 'P1.1', v: { what: 'booklet' }, date: '', words: '' })
  assert.deepEqual(one('pmt stationary waves 7/10').v, { what: 'pmt', score: '7', out_of: '10' })
  assert.equal(one('read the textbook section on trig').v.what, 'textbook')
  assert.equal(one('did bicen matrics 6/10').ref, 'PC1-01', 'typo in the topic')
  none('matrices 8/10')            // no idea what it was: the brain asks
  none('did bicen 8/10')           // no topic
  none('bicen is great')           // not a report
})

test('mistakes: "mistake: PC1-03 Q3b assumed through origin – knowledge" and friends', () => {
  assert.deepEqual(one('mistake: PC1-03 Q3b assumed through origin – knowledge'),
    { op: 'trk_mistake', ref: 'PC1-03', v: { question: 'Q3b', what: 'assumed through origin', kind: 'knowledge' }, date: '', words: '' })
  assert.deepEqual(one('Mistake - matrices Q4 sign error (careless), rule: check every sign').v, { question: 'Q4', what: 'sign error', kind: 'careless', rule: 'check every sign' })
  assert.equal(one('mistake: matrices Q4 sign error').ref, 'PC1-01')
  assert.deepEqual(one('mistake: PC1-01 forgot to transpose').v, { what: 'forgot to transpose' })
  const t = one('mistake: HT2 Q7 ran out of time - time')
  assert.deepEqual([t.ref, t.v.test, t.v.kind], ['', 'FM HT2 test', 'time'])
  none('mistake: something went wrong')   // no topic, no question: the brain asks
  none('mistake:')
})

test('redos: "redid PC1-03 Q3b" (right or still wrong); unclear ones go to the brain', () => {
  const pc = W.mistakes.find((m) => m.code === 'PC1-03').id
  assert.deepEqual(one('redid PC1-03 Q3b'), { op: 'trk_redo', ref: `mistake:${pc}`, v: { result: 'right' }, date: '', words: '' })
  assert.deepEqual(one('redid PC1-03 Q3b - still wrong').v, { result: 'wrong' })
  assert.equal(one('redid the polynomials Q5 one').ref, `mistake:${W.mistakes.find((m) => m.code === 'Y1-04').id}`)
  assert.equal(one('redid Q3b').ref, `mistake:${pc}`, 'the only open mistake with that question')
  none('redid Q9')
  none('redid matrices')   // no open mistake on matrices
})

test('test scores: "HT2 practice 38/45", "got 31/45 on the HT1 consolidation", "mechanics test diagnostic 12/20 yesterday"', () => {
  const ht2 = W.tests.find((t) => t.title === 'FM HT2 test').id
  assert.deepEqual(one('HT2 practice 38/45'), { op: 'trk_attempt', ref: `test:${ht2}`, v: { what: 'timed', score: '38', out_of: '45', label: 'HT2 practice' }, date: '', words: '' })
  assert.equal(one('got 31/45 on the HT1 consolidation').ref, `test:${W.tests.find((t) => t.title === 'FM HT1 consolidation').id}`)
  const y = one('mechanics test diagnostic 12/20 yesterday')
  assert.deepEqual([y.v.what, y.date, y.words], ['diagnostic', '2026-10-18', 'yesterday'])
  assert.equal(one('HT2 real test 40/45').v.what, 'real')
  none('HT3 practice 38/45')      // no such test
  none('HT2 38')                  // no score shape
})

test('temporary rules: pause / top priority / time cap, with end dates; no end → a quick-tap ask', () => {
  assert.deepEqual(one('pause getting ahead until 25 Oct'),
    { op: 'trk_rule', ref: '', v: { do: 'add', kind: 'pause', target: 'ahead', words: 'pause getting ahead until 25 Oct' }, date: '2026-10-25', words: 'until 25 oct' })
  assert.deepEqual(one('ACT top priority this week'), { op: 'trk_rule', ref: '', v: { do: 'add', kind: 'boost', target: 'act', words: 'ACT top priority this week' }, date: '2026-10-25', words: 'this week' })
  const cap = one('maths + physics 45 min/day this week')
  assert.deepEqual([cap.v.kind, cap.v.target, cap.v.minutes, cap.date], ['cap', 'subjects:Maths,Further Maths,Physics', '45', '2026-10-25'])
  assert.equal(one('physics max 30 mins a day for 2 weeks').date, '2026-11-01')
  assert.equal(one('no stretch this week').v.target, 'stretch')
  assert.equal(one('skip mistake redos today').v.target, 'mistakes')
  assert.equal(one('pause old topics this week').v.target, 'old')
  assert.equal(one('prioritise the HT2 test until Friday').v.target, 'tests', 'the planner boosts test prep as a whole')
  assert.equal(one('matrices top priority this week').v.target, 'topic:PC1-01')
  const forever = one('pause reviews until I say')
  assert.deepEqual([forever.v.ends, forever.date], ['until_i_say', ''])
  const next = one('ACT top priority next week')
  assert.deepEqual([next.v.starts, next.date], ['2026-10-26', '2026-11-01'])
  const ask = parseFast('pause getting ahead', W, TODAY)
  assert.equal(ask.kind, 'ask')
  assert.deepEqual(ask.options.map((o) => [o.label, kv(o.action.value).ends]), [['This week', 'week'], ['2 weeks', '2weeks'], ['Until I say', 'until_i_say']])
  none('pause getting ahead until christmas')   // a date it can't read: the brain
  assert.equal(one('no physics tonight').date, TODAY)
  none('no physics tonight', { recent: [], cardOpen: true })   // with a card waiting (a day plan?) it may be a change to it
  none('football top priority')                 // not something a rule can be about
})

test('ending a rule early: "end the reviews rule", "resume reviews"', () => {
  const live = W.rules.find((r) => r.target === 'reviews').id
  assert.deepEqual(one('end the reviews rule'), { op: 'trk_rule', ref: `rule:${live}`, v: { do: 'end' }, date: '', words: '' })
  assert.equal(one('resume reviews').ref, `rule:${live}`)
  assert.equal(one('cancel the reviews pause').ref, `rule:${live}`)
  none('end the ACT rule')   // there isn't one
})

test('programmes: "done STEP 3" (+ result), "skip STEP 4", "done STEP", "pause STEP until 1 Nov", "STEP twice a week"', () => {
  const step = W.programmes[0].id
  assert.deepEqual(one('done STEP 3'), { op: 'trk_item', ref: `prog:${step}`, v: { do: 'done', item: '3' }, date: '', words: '' })
  assert.deepEqual(one('done STEP 3, solved with hints, idea: Look for symmetry').v, { do: 'done', item: '3', result: 'solved with hints · idea: Look for symmetry' })
  assert.deepEqual(one('finished STEP assignment 4 on my own').v, { do: 'done', item: '4', result: 'solved without help' })
  assert.deepEqual(one('STEP 3 done').v, { do: 'done', item: '3' })
  assert.deepEqual(one('done STEP').v, { do: 'done', item: '3' }, 'the next item')
  assert.deepEqual(one('skip STEP 4').v, { do: 'skip', item: '4' })
  assert.deepEqual(one('pause STEP until 1 Nov'), { op: 'trk_programme', ref: `prog:${step}`, v: { do: 'pause' }, date: '2026-11-01', words: 'until 1 nov' })
  assert.deepEqual(one('resume STEP').v, { do: 'resume' })
  assert.deepEqual(one('STEP twice a week').v, { do: 'change', per_week: '2' })
  none('done STEP 99')
  none('done physics homework')
})

test('ACT’s books (programmes with area act) are the act plug-in’s: never read, listed or given refs here', async () => {
  const act = world(TODAY)
  act.programmes.push({ ...act.programmes[0], id: '30000000-0000-4000-8000-000000000099', name: 'Complete Guide to ACT English', area: 'act' })
  assert.equal(parseFast('done Complete Guide to ACT English 3', act, TODAY), null)
  assert.equal(parseFast('pause complete guide to act english until 1 Nov', act, TODAY), null)
  const { snapshotRefs } = await import('../lib/tracker/bot-ops.ts')
  const { programmesView } = await import('../lib/tracker/bot-views.ts')
  assert.ok(!snapshotRefs(act).some(([, r]) => r.title.includes('ACT English')))
  assert.doesNotMatch(programmesView(act), /ACT English/)
})

test('export, ideas, "what next?"', () => {
  for (const m of ['export my tracker', 'Export my tracker please', 'send me my tracker as a csv', 'backup my study tracker', 'export tracker csv']) assert.deepEqual(parseFast(m, W, TODAY), { kind: 'export' }, m)
  assert.equal(parseFast('sync my tracker to google sheets every day', W, TODAY).kind, 'idea')
  for (const m of ['what next?', 'What should I do now?', 'what shall i study', 'what next', 'next study']) assert.deepEqual(parseFast(m, W, TODAY), { kind: 'next' }, m)
  none('what should I do about the party?')
})

test('everything else is left for the brain (and most messages skip the database entirely)', () => {
  for (const m of ['buy milk', 'football at 7', 'I did football', 'physics homework due Friday', 'matrices', 'green', 'what is for dinner', 'can you move it to tomorrow', 'Liverpool red', 'remind me to call Sam']) none(m)
  assert.equal(mightBeTracker('buy milk'), false)
  assert.equal(mightBeTracker('physics homework due Friday'), false)
  assert.equal(mightBeTracker('matrics grean'), true)
  assert.equal(mightBeTracker('HT2 practice 38/45'), true)
  assert.equal(mightBeTracker('/maths'), false)
  assert.equal(id('PC1-01').length, 36)
})
