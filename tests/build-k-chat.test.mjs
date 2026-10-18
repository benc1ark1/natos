// Build 2, phase K on the TEST database: study pipelines by chat. "Finished the Bicen video on matrices" moves the
// topic on (card, ✅, Undo); a mistake comes back for review; pipelines and topics change by chat, keeping progress.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/build-k-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const act = (o) => ({ op: 'stage_set', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const fm = async () => (await q(`select id from subjects where user_id = $1 and name = 'Further Maths'`, [chat.users.owner]))[0].id
async function pipeline() {
  const subject_id = await fm()
  const stages = []
  for (const [i, name] of ['Bicen video', 'GoodNotes notes', 'Textbook questions', 'Exam questions'].entries()) stages.push(await add('pipeline_stages', { subject_id, name, sort_order: i }))
  const topics = []
  for (const [i, name] of ['Complex numbers', 'Matrices'].entries()) topics.push(await add('topics', { subject_id, name, sort_order: i }))
  return { subject_id, stages, topics }
}

test('"finished the Bicen video on matrices" moves Matrices on one stage (card, ✅, Undo), from Telegram', { skip }, async () => {
  const { topics } = await pipeline()
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'finished the Bicen video on matrices' }))
  chat.ai.script(SORT, sorted({ kind: 'study', title: 'Bicen video on matrices', subject: 'Further Maths', topic: 'matrices', stage: 'Bicen video' }))
  await chat.nat('finished the Bicen video on matrices')
  assert.match(JSON.stringify(chat.ai.byModel(SORT).at(-1).body), /Further Maths \(stages: Bicen video → GoodNotes notes → Textbook questions → Exam questions\): Complex numbers \(next: Bicen video\); Matrices \(next: Bicen video\)/, 'the sorter sees the pipelines')
  assert.match(last().text, /<b>Study progress<\/b>[\s\S]*Further Maths · Matrices: Bicen video ✓/)
  assert.equal((await q(`select count(*)::int n from topic_progress`))[0].n, 0, 'nothing before ✅')
  await tap('Save')
  assert.match(last().text, /✅ Matrices: “Bicen video” done/)
  const next = async () => {
    const { loadStudy } = await import('../lib/study-data.ts')
    const { topicState } = await import('../lib/study.ts')
    const sb = await (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
    const s = await loadStudy(sb)
    return topicState(s.topics.find((t) => t.id === topics[1].id), s.stages, s.progress).next.name
  }
  assert.equal(await next(), 'GoodNotes notes')
  await tap('Undo')
  assert.equal(await next(), 'Bicen video', 'undone (the row stays, marked undone)')
  assert.equal((await q(`select count(*)::int n from topic_progress where undone_at is not null`))[0].n, 1)
})

test('a logged mistake comes back for review after his days; reviewing it by chat is a card with Undo', { skip }, async () => {
  const { topics } = await pipeline()
  await q(`update profiles set planning = '{"mistakeReviewDays": 2}' where user_id = $1`, [chat.users.owner])
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Q5 wrong on matrices: sign error' }))
  chat.ai.script(SORT, sorted({ kind: 'mistake', title: 'Q5 wrong: sign error', subject: 'Further Maths', topic: 'Matrices' }))
  await chat.nat('Q5 wrong on matrices: sign error')
  await tap('Save')
  const [m] = await q(`select body, topic_id, review_on::text from mistakes`)
  assert.deepEqual(m, { body: 'Q5 wrong: sign error', topic_id: topics[1].id, review_on: chat.time.addDays(chat.time.todayISO(), 2) })
  // when it's due, the AI sees it with a ref, and "done reviewing it" is a change card
  await q(`update mistakes set review_on = current_date`)
  chat.ai.script(CHAT, (body) => {
    const ref = body.messages[0].content[0].text.match(/(X\d+) \| Further Maths · Matrices: Q5 wrong: sign error \| review now/)[1]
    return brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'mistake_done', ref })] })
  })
  await chat.nat('I went over the Q5 matrices mistake')
  assert.match(last().text, /🧠 Q5 wrong: sign error: → reviewed/)
  await tap('Apply')
  assert.ok((await q(`select reviewed_at from mistakes`))[0].reviewed_at)
  await tap('Undo')
  assert.equal((await q(`select reviewed_at from mistakes`))[0].reviewed_at, null)
})

test('pipelines and topics by chat: a renamed stage keeps its progress, Undo puts the pipeline back; topics and a notes link', { skip }, async () => {
  const { stages, topics } = await pipeline()
  await add('topic_progress', { topic_id: topics[0].id, stage_id: stages[1].id })
  await chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'subject=Further Maths; stages=Bicen video, Notes in GoodNotes, Exam questions, Textbook questions' })] }))
  await chat.nat('rename the notes stage to Notes in GoodNotes and do exam questions before textbook')
  assert.match(last().text, /📚 <b>Further Maths<\/b> pipeline: Bicen video → GoodNotes notes → Textbook questions → Exam questions → <b>Bicen video → Notes in GoodNotes → Exam questions → Textbook questions<\/b>/)
  await tap('Apply')
  const live = async () => (await q(`select id, name from pipeline_stages where archived_at is null order by sort_order`))
  assert.deepEqual((await live()).map((s) => s.name), ['Bicen video', 'Notes in GoodNotes', 'Exam questions', 'Textbook questions'])
  assert.equal((await live())[1].id, stages[1].id, 'renamed in place: the same stage, so its progress stays')
  await tap('Undo')
  assert.deepEqual((await live()).map((s) => s.name), ['Bicen video', 'GoodNotes notes', 'Textbook questions', 'Exam questions'])

  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'topic_new', value: 'subject=Further Maths; topics=Matrices, Proof by induction, Series' })] }))
  await chat.nat('add proof by induction and series to further maths')
  assert.match(last().text, /📚 <b>Further Maths<\/b>: \+ 2 topics \(Proof by induction, Series\)/, 'Matrices is already there')
  await tap('Apply')
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'topic_set', value: 'subject=Further Maths; topic=Series; notes=https://drive.google.com/file/d/abc/view?usp=sharing' })] }))
  await chat.nat('my series notes are https://drive.google.com/file/d/abc/view?usp=sharing')
  await tap('Apply')
  assert.equal((await q(`select notes_url from topics where name = 'Series'`))[0].notes_url, 'https://drive.google.com/file/d/abc/view?usp=sharing')

  // the AI sees the next actions (up to 2 per subject) with refs
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))
  await chat.nat('hi')
  assert.match(chat.lastBrainText(), /## Study: next action per topic[^\n]*\nST1 \| Further Maths: Complex numbers — Textbook questions \(stage 3\/4\)\nST2 \| Further Maths: Matrices — Bicen video \(stage 1\/4\)/)
})
