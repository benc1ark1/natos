// Build 2, phase K (study pipelines): plain checks, no database. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextActions, parseTopicLines, topicState, matchName } from '../lib/study.ts'

const st = (id, name, sort_order, extra = {}) => ({ id, subject_id: 'fm', name, sort_order, archived_at: null, ...extra })
const tp = (id, name, sort_order) => ({ id, subject_id: 'fm', name, spec_ref: null, notes_url: null, sort_order, archived_at: null })
const done = (topic_id, stage_id) => ({ id: `${topic_id}${stage_id}`, topic_id, stage_id, done_at: 'x', undone_at: null })

test('the next stage comes after the furthest one done; reordering, adding or archiving stages never loses progress', () => {
  const stages = [st('v', 'Bicen video', 0), st('n', 'GoodNotes notes', 1), st('q', 'Textbook questions', 2)]
  const m = tp('mat', 'Matrices', 0)
  assert.equal(topicState(m, stages, []).next.name, 'Bicen video', 'not started: the first stage')
  assert.equal(topicState(m, stages, [done('mat', 'v')]).next.name, 'GoodNotes notes')
  // a stage added before his furthest one doesn't send him back
  const more = [...stages, st('w', 'Warm-up worksheet', -1)]
  assert.equal(topicState(m, more, [done('mat', 'n')]).next.name, 'Textbook questions')
  // reordered: progress belongs to the stage, wherever it goes
  const moved = [st('v', 'Bicen video', 0), st('q', 'Textbook questions', 1), st('n', 'GoodNotes notes', 2)]
  assert.equal(topicState(m, moved, [done('mat', 'v'), done('mat', 'n')]).finished, true)
  // archived stage: skipped
  const arch = [st('v', 'Bicen video', 0), st('n', 'GoodNotes notes', 1, { archived_at: 'x' }), st('q', 'Textbook questions', 2)]
  assert.equal(topicState(m, arch, [done('mat', 'v')]).next.name, 'Textbook questions')
  // undone doesn't count
  assert.equal(topicState(m, stages, [{ ...done('mat', 'v'), undone_at: 'y' }]).next.name, 'Bicen video')
})

test('Home shows one or two next actions per subject: started topics first, then the next new one', () => {
  const stages = [st('v', 'Video', 0), st('q', 'Questions', 1)]
  const topics = [tp('a', 'Complex numbers', 0), tp('b', 'Matrices', 1), tp('c', 'Proof', 2), tp('d', 'Series', 3)]
  const out = nextActions([{ id: 'fm', name: 'Further Maths' }], stages, topics, [done('c', 'v'), done('a', 'v'), done('a', 'q')], 2)
  assert.deepEqual(out.map((x) => [x.topic.name, x.stage.name, x.stageNo, x.total]), [['Proof', 'Questions', 2, 2], ['Matrices', 'Video', 1, 2]])
})

test('pasted topic lists: numbering kept as the spec reference, bullets and duplicates dropped', () => {
  assert.deepEqual(parseTopicLines('1.1 Complex numbers\n- Matrices\n• Matrices\n\n4.2) Moments\nProof by induction'), [
    { name: 'Complex numbers', spec_ref: '1.1' }, { name: 'Matrices', spec_ref: null }, { name: 'Moments', spec_ref: '4.2' }, { name: 'Proof by induction', spec_ref: null },
  ])
  const list = [{ name: 'Complex numbers' }, { name: 'Matrices' }, { name: 'Maths proof' }]
  assert.equal(matchName(list, 'matrices').name, 'Matrices')
  assert.equal(matchName(list, 'complex').name, 'Complex numbers')
  assert.equal(matchName(list, 'ma'), null, 'unclear: no guess')
})
