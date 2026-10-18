// Jarvis phase A, plain tests (free, no database, no AI). Run: npm run test:unit
// The meta-message guard, the checks on the brain's decision, the cost meter, the memory text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeMeta, looksLikePartialEdit, checkDecision, splitNow, brainMessage, BRAIN_PROMPT, DECISION_SCHEMA } from '../lib/telegram/brain.ts'
import { costOf, CHAT_MODEL, PLAN_MODEL, SORT_MODEL } from '../lib/ai/models.ts'
import { transcript, plain } from '../lib/telegram/turns.ts'

// ---------------------------------------------------------------- the meta-message guard

test('the two real bug messages are never new items', () => {
  assert.equal(looksLikeMeta('That okay maybe'), true)
  assert.equal(looksLikeMeta('Can you move it as a real task'), true)
})

test('meta-messages: acknowledgements and requests about "it"', () => {
  for (const m of ['ok', 'Okay', 'ok thanks', 'thanks!', 'Thank you', 'cheers mate', 'that’s fine', "that's okay", 'it’s fine',
    'maybe', 'hmm', 'Hmmmm', 'lol', 'yes', 'no', 'nope', 'cool', 'nice', 'sounds good', 'got it', 'fair enough', '👍', '...',
    'could you change that to Thursday', 'can you do it tomorrow', 'please move it to this week', 'make it a task',
    'Move that one to Friday', 'can u put it in someday']) {
    assert.equal(looksLikeMeta(m), true, m)
  }
})

test('real new items are not blocked', () => {
  for (const m of ['Physics homework due Friday', 'okay physics homework due friday', 'no football Wednesday',
    'Can you remind me to bring PE kit Friday', 'can you remind me about it tomorrow', 'can you add physics past paper due Monday',
    'can you add that physics homework', 'did football today', 'remind me to text Sam', 'SMC paper this weekend',
    'look up that philosophy book', 'Make a revision timetable for physics']) {
    assert.equal(looksLikeMeta(m), false, m)
  }
})

test('partial edits are told apart from a whole new version', () => {
  for (const m of ['make it Thursday', "it's a task", 'its for Vlad', 'actually Monday', 'due Thursday', 'no, Thursday']) assert.equal(looksLikePartialEdit(m), true, m)
  for (const m of ['Physics homework due Thursday', 'Revise vectors for the test']) assert.equal(looksLikePartialEdit(m), false, m)
})

// ---------------------------------------------------------------- checks on the brain's decision

const ctx = {
  today: '2026-10-10', weekStart: '2026-10-05',
  snapshot: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London). Weeks run Mon–Sun.\n\n## Open tasks\nT1 | Physics homework | must',
  refs: new Map([['T1', { kind: 'task', id: '11111111-1111-4111-8111-111111111111', title: 'Physics homework', status: 'this_week', deadline: '2026-10-16' }]]),
}
const raw = (o) => ({ intent: 'chat', reply: '', item_text: '', item_kind: '', plan: [], unsure: '', fact_to_save: '', ...o })
const input = (o = {}) => ({ now: 'Now: …', transcript: '', card: null, cardEditing: false, message: 'hi', ...o })

test('a new item keeps the cleaned words and the kind is dropped unless it is a real kind', () => {
  const d = checkDecision(raw({ intent: 'new', item_text: 'Physics homework due Friday', item_kind: 'banana' }), ctx, input({ message: 'can you add Physics homework due Friday' }))
  assert.equal(d.intent, 'new')
  assert.equal(d.itemText, 'Physics homework due Friday')
  assert.equal(d.itemKind, null)
})

test('backstop: the brain calling a meta-message "new" is overruled, nothing gets saved', () => {
  const d = checkDecision(raw({ intent: 'new', item_text: 'Move it as a real task' }), ctx, input({ message: 'Can you move it as a real task' }))
  assert.equal(d.intent, 'unclear')
  assert.equal(d.itemText, null)
  assert.match(d.reply, /What would you like me to do/)
  const withCard = checkDecision(raw({ intent: 'new', item_text: 'That okay maybe' }), ctx, input({ message: 'That okay maybe', card: 'Idea: x' }))
  assert.equal(withCard.intent, 'unclear')
  assert.match(withCard.reply, /change the card/)
})

test('while a card is being edited, "new" becomes the correction (the Edit bug)', () => {
  const d = checkDecision(raw({ intent: 'new', item_text: 'Physics homework due Thursday' }), ctx, input({ message: 'Physics homework due Thursday', card: 'Task: Physics homework', cardEditing: true }))
  assert.equal(d.intent, 'correction')
  assert.equal(d.itemText, 'Physics homework due Thursday')
})

test('a correction with no open card asks which item instead', () => {
  const d = checkDecision(raw({ intent: 'correction', item_text: 'x due Thursday' }), ctx, input({ message: 'make it Thursday' }))
  assert.equal(d.intent, 'unclear')
  assert.ok(d.reply.length > 0)
})

test('a correction keeps the kind Nat asked for', () => {
  const d = checkDecision(raw({ intent: 'correction', item_text: 'Look up vectors video', item_kind: 'task' }), ctx, input({ message: 'can you make it a real task', card: 'Idea: Look up vectors video' }))
  assert.equal(d.intent, 'correction')
  assert.equal(d.itemKind, 'task')
})

test('questions: plan items must be real records, refs never leak into the text', () => {
  const d = checkDecision(raw({ intent: 'question', reply: 'Do T1 first.', plan: [{ ref: 'T1', minutes: 40, focus: '', why: 'due Fri' }, { ref: 'T9', minutes: 10, focus: '', why: '' }] }), ctx, input({ message: 'what now?' }))
  assert.equal(d.intent, 'question')
  assert.equal(d.reply, 'Do Physics homework first.')
  assert.equal(d.answer.plan.length, 1)
  assert.equal(d.answer.plan[0].title, 'Physics homework')
  assert.match(d.answer.notes.join(' '), /Left out 1/)
})

test('/ask always answers as a question; unknown intents become a question back', () => {
  assert.equal(checkDecision(raw({ intent: 'new', item_text: 'x' }), ctx, input({ forceQuestion: true })).intent, 'question')
  const d = checkDecision(raw({ intent: 'delete_everything', reply: '' }), ctx, input())
  assert.equal(d.intent, 'unclear')
  assert.ok(d.reply)
})

test('chat never carries an item; empty replies get a fallback', () => {
  const d = checkDecision(raw({ intent: 'chat', item_text: 'should be ignored' }), ctx, input({ message: 'thanks' }))
  assert.equal(d.itemText, null)
  assert.equal(d.reply, '👍')
})

// ---------------------------------------------------------------- the request

test('the request is cache-friendly: the time is outside the cached part', () => {
  const { now, rest } = splitNow(ctx.snapshot)
  assert.match(now, /^Now: /)
  assert.doesNotMatch(rest, /Now:/)
  const content = brainMessage(input({ now, message: 'hi', card: 'Task: x', cardEditing: true }), rest)
  assert.equal(content.length, 2)
  assert.deepEqual(content[0].cache_control, { type: 'ephemeral' })
  assert.doesNotMatch(content[0].text, /16:05/)
  assert.match(content[1].text, /being edited/)
  assert.match(content[1].text, /<message>hi<\/message>/)
  assert.doesNotMatch(BRAIN_PROMPT, /\$\{/, 'the prompt has no unfilled placeholders')
  assert.deepEqual(DECISION_SCHEMA.required.sort(), Object.keys(DECISION_SCHEMA.properties).sort())
})

// ---------------------------------------------------------------- cost meter

test('costs: the models are one-line settings and the meter prices them', () => {
  assert.equal(CHAT_MODEL, 'claude-sonnet-5-5')
  assert.equal(PLAN_MODEL, 'claude-opus-5-5')
  assert.equal(SORT_MODEL, 'claude-haiku-4-5')
  // Sonnet: 1M in = $2, 1M out = $10, 1M cache reads = $0.20, 1M cache writes = $2.50
  assert.equal(costOf('claude-sonnet-5-5', { input_tokens: 1e6 }), 2)
  assert.equal(costOf('claude-sonnet-5-5', { output_tokens: 1e6 }), 10)
  assert.ok(Math.abs(costOf('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }) - 0.2) < 1e-9)
  assert.equal(costOf('claude-sonnet-5-5', { cache_creation_input_tokens: 1e6 }), 2.5)
  assert.equal(costOf('claude-haiku-4-5-20251001', { input_tokens: 1e6 }), 1, 'dated model names price like the base name')
  assert.equal(costOf('some-new-model', { input_tokens: 1e6 }), 10, 'unknown models are priced high, never free')
  assert.equal(costOf('claude-opus-5-5', { input_tokens: null, output_tokens: undefined }), 0)
})

// ---------------------------------------------------------------- memory text

test('memory: oldest first, London times, cards as plain words', () => {
  const t = transcript([
    { id: 1, role: 'nat', text: 'Physics homework due Friday', created_at: '2026-10-10T15:02:00Z' },
    { id: 2, role: 'bot', text: plain('<b>Task</b>: Physics homework\nPhysics · must · due Fri 16 Oct\n\nNothing is saved until you tap ✅ Save.'), created_at: '2026-10-10T15:02:05Z' },
  ])
  assert.equal(t.split('\n').length, 2)
  assert.match(t, /^\[16:02\] Nat: Physics homework due Friday/)
  assert.match(t, /\[16:02\] You: Task: Physics homework \/ Physics · must/)
  assert.equal(plain('a &lt;b&gt; &amp; <i>c</i>'), 'a <b> & c')
})
