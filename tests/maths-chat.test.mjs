// The maths system in Telegram: "show my maths tracker" and "what maths should I do?" answered with no AI; "matrices
// green" and "Book 1 chapters 1–13 green" become one change card, saved only on ✅, and Undo puts the colours back.
// TEST database. Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/maths-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { seedRows } from '../lib/maths.ts'

const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a)
const noAI = () => assert.equal(chat.ai.requests.length, 0, 'answered without any AI call')
const act = (o) => ({ op: 'topic_status', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })

async function seed() {
  for (const name of ['Maths', 'Further Maths']) {
    const [s] = await q(`select id from subjects where name = $1 and user_id = $2`, [name, chat.users.owner])
    for (const r of seedRows(name)) await chat.add('topics', { subject_id: s.id, ...r })
  }
}
const colours = async (names) => Object.fromEntries((await q(`select name, status from topics where name = any($1)`, [names])).map((r) => [r.name, r.status]))

test('maths tracker and "what maths should I do?": instant, no AI, acceleration through the books', { skip }, async () => {
  await seed()
  await chat.nat('/maths')
  const tr = chat.last().text
  assert.match(tr, /📐 <b>Maths tracker<\/b>/)
  assert.match(tr, /<b>Maths<\/b> 0\/44 🟢/)
  assert.match(tr, /<b>Further Maths<\/b> 0\/36 🟢/)
  assert.match(tr, /Book 1: ⚪{22}/u)
  assert.match(tr, /🚀 Acceleration mode/)
  await chat.nat('what maths should I do?')
  assert.match(chat.last().text, /Next: <b>🚀 Maths: Proof &amp; mathematical communication — textbook \+ questions<\/b>, 60m/)
  noAI()
})

test('"matrices green" and "Book 1 chapters 1–13 green": one card, saved on ✅, Undo puts them back', { skip }, async () => {
  await seed()
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Matrices to green.', actions: [act({ value: 'topics=Matrices; status=green' })] }))
  await chat.nat('matrices green')
  chat.noSurprises()
  let card = chat.last()
  assert.match(card.text, /📐 ⚪ Matrices → <b>🟢 exam ready<\/b>/)
  assert.equal((await colours(['Matrices'])).Matrices, 'not_started', 'nothing saved before ✅')
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  assert.equal((await colours(['Matrices'])).Matrices, 'exam_ready')

  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Book 1 chapters 1–13 to green.', actions: [act({ value: 'subject=Maths; section=Book 1; chapters=1-13; status=green' })] }))
  await chat.nat('Book 1 chapters 1–13 green')
  card = chat.last()
  assert.match(card.text, /⚪ Proof &amp; mathematical communication, ⚪ Indices &amp; surds/)
  assert.match(card.text, /\+7 more → <b>🟢 exam ready<\/b>/)
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  const after = await colours(['Proof & mathematical communication', 'Differentiation', 'Applications of differentiation'])
  assert.deepEqual(after, { 'Proof & mathematical communication': 'exam_ready', Differentiation: 'exam_ready', 'Applications of differentiation': 'not_started' })
  const done = chat.last()
  await chat.tap(chat.button(done, 'Undo'), done.message_id)
  assert.equal((await colours(['Differentiation'])).Differentiation, 'not_started', 'Undo puts the colours back')
  assert.equal((await colours(['Matrices'])).Matrices, 'exam_ready', 'the earlier change stays')
})
