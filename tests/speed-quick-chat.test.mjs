// Queue item 3 on the TEST database: the quick path (plain-code triage → a small router model) for thanks, exact lists and
// obvious new items; the full brain for everything else (and whenever the router isn't sure or is down); "typing…" first;
// reply times logged per message and shown by /speed; the brain's context reused within one run unless something changed;
// the same ✅ / ✏️ / ❌ buttons everywhere. Run:
// node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/speed-quick-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT, ROUTE } from './support/chat.mjs'
import { brain, routed, sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const labels = (m) => m.reply_markup.inline_keyboard.map((r) => r.map((b) => b.text))
const turns = () => q(`select text, path, ms_total, ms_first from telegram_turns where role = 'nat' order by id`)

async function seed() {
  const subj = Object.fromEntries((await q(`select id, name from subjects where user_id = $1`, [chat.users.owner])).map((s) => [s.name, s.id]))
  await chat.add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: `${chat.time.addDays(chat.time.todayISO(), 2)}T16:00:00Z`, subject_id: subj.Physics })
}

test('“thanks”: the quick router answers (small prompt, no thinking), no brain; the turn is logged as quick', { skip }, async () => {
  chat.ai.script(ROUTE, routed({ route: 'chat', reply: 'Any time.' }))
  await nat('thanks')
  assert.equal(last().text, 'Any time.')
  assert.equal(chat.ai.byModel(CHAT).length, 0, 'the brain was never called')
  const req = chat.ai.byModel(ROUTE)[0].body
  const { ROUTE_PROMPT } = await import('../lib/telegram/brain.ts')
  assert.equal(req.system[0].text, ROUTE_PROMPT)
  assert.deepEqual(req.thinking, { type: 'disabled' })
  assert.equal(req.output_config.effort, 'low')
  assert.match(req.messages[0].content, /<message>thanks<\/message>$/)
  assert.ok(req.messages[0].content.length < 1500, 'a small prompt: no snapshot')
  const [t] = await turns()
  assert.equal(t.path, 'quick')
  assert.ok(t.ms_first >= 0 && t.ms_total >= t.ms_first, JSON.stringify(t))
  assert.deepEqual(await q(`select feature, model from ai_usage`), [{ feature: 'chat', model: 'claude-haiku-5-5' }], 'the router’s cost is on the meter')
  chat.noSurprises()
})

test('a list question in his own words: the exact list, no brain', { skip }, async () => {
  await seed()
  chat.ai.script(ROUTE, routed({ route: 'list', show: 'week' }), routed({ route: 'list', show: 'free', show_arg: chat.time.addDays(chat.time.todayISO(), 1) }))
  await nat('what’s due this week?')
  assert.match(last().text, /🗓 <b>Your week<\/b>[\s\S]*📌 due: <b>Physics homework<\/b>/)
  await nat('am i free tmrw')
  assert.match(last().text, /^🕒 <b>Free tomorrow<\/b>/)
  assert.equal(chat.ai.byModel(CHAT).length, 0)
  chat.noSurprises()
})

test('an obvious new item: the router hands it to the sorter: the usual card, nothing saved before ✅', { skip }, async () => {
  chat.ai.script(ROUTE, routed({ route: 'new', item_text: 'maths homework due Fri', what: 'homework' }))
  chat.ai.script(SORT, sorted({ title: 'Maths homework', subject: 'Maths', importance: 'must', due_date: chat.next(5), date_words: 'Fri' }))
  await nat('can you add maths homework due Fri')
  const card = last()
  assert.match(card.text, /<b>Task<\/b>: Maths homework/)
  assert.deepEqual(labels(card), [['✅ Save', '✏️ Change', '❌ Cancel'], ['📥 Inbox instead']], 'the same buttons as every card')
  assert.equal(chat.ai.byModel(SORT)[0].body.messages[0].content.includes('maths homework due Fri'), true)
  assert.equal(chat.ai.byModel(CHAT).length, 0)
  assert.deepEqual(await q(`select title from tasks`), [], 'nothing saved before ✅')
  await chat.tap(chat.button(card, 'Save'), card.message_id)
  assert.deepEqual(await q(`select title from tasks`), [{ title: 'Maths homework' }])
  assert.equal((await turns())[0].path, 'quick')
  chat.noSurprises()
})

test('the router not sure → the brain reads it (both asked); the turn is logged as brain', { skip }, async () => {
  chat.ai.script(ROUTE, routed({ route: 'brain' }))
  chat.ai.script(CHAT, brain({ intent: 'question', reply: 'Physics homework first, then the SMC paper.' }))
  await nat('whats the plan')
  assert.equal(last().text, 'Physics homework first, then the SMC paper.')
  assert.equal(chat.ai.byModel(ROUTE).length, 1)
  assert.equal(chat.ai.byModel(CHAT).length, 1)
  assert.equal((await turns())[0].path, 'brain')
  chat.noSurprises()
})

test('the router down or slow → the brain answers as before, and Nat sees no error', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))   // the router is unscripted: it answers 529 (overloaded)
  await nat('hi')
  assert.equal(last().text, 'Hi.')
  assert.ok(!chat.tg.sent().some((m) => /⚠️/.test(m.text)))
  assert.equal(chat.ai.byModel(ROUTE).length, 1, 'it was tried once (no retries: the brain takes over at once)')
  chat.noSurprises()
})

test('the router says “new” but plain code sees it points back ("as well"): the brain reads it', { skip }, async () => {
  chat.ai.script(ROUTE, routed({ route: 'new', item_text: 'physics homework due fri', what: 'homework' }))
  chat.ai.script(CHAT, brain({ intent: 'unclear', reply: 'As well as what?' }))
  await nat('physics homework due fri as well')
  assert.equal(last().text, 'As well as what?')
  assert.equal(chat.ai.byModel(SORT).length, 0)
  chat.noSurprises()
})

test('a card is waiting: even “thanks” goes straight to the brain (it may be about the card); changes never use the router', { skip }, async () => {
  chat.ai.script(ROUTE, routed({ route: 'new', item_text: 'maths homework due Fri', what: 'homework' }))
  chat.ai.script(SORT, sorted({ title: 'Maths homework' }))
  await nat('maths homework due Fri')
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Tap ✅ Save when it looks right.' }))
  await nat('thanks')
  assert.equal(last().text, 'Tap ✅ Save when it looks right.')
  chat.ai.script(CHAT, brain({ intent: 'unclear', reply: 'Which homework?' }))
  await nat('move homework to tomorrow')
  assert.equal(chat.ai.byModel(ROUTE).length, 1, 'only the first message was routed')
  chat.noSurprises()
})

test('“typing…” is the very first thing Nat sees (before the queue and the session); not for /help or a quick tap', { skip }, async () => {
  chat.ai.script(ROUTE, routed({ route: 'chat', reply: 'Hey!' }))
  await nat('hey')
  assert.equal(chat.tg.calls[0].method, 'sendChatAction')
  assert.equal(chat.tg.calls[0].body.action, 'typing')
  chat.tg.clear()
  await nat('/help')
  assert.ok(!chat.tg.calls.some((c) => c.method === 'sendChatAction'), 'no typing for /help')
  chat.ai.script(ROUTE, routed({ route: 'new', item_text: 'maths homework', what: 'homework' }))
  chat.ai.script(SORT, sorted({ title: 'Maths homework' }))
  await nat('maths homework')
  const card = last()
  chat.tg.clear()
  await chat.tap(chat.button(card, 'Change'), card.message_id)   // answers at once: no typing
  assert.ok(!chat.tg.calls.some((c) => c.method === 'sendChatAction'))
  chat.tg.clear()
  await chat.tap(chat.button(card, 'Save'), card.message_id)    // saves: typing while it does
  assert.equal(chat.tg.calls[0].method, 'sendChatAction')
  chat.noSurprises()
})

test('/speed: the real reply times of his last messages, with the path that answered', { skip }, async () => {
  await nat('/speed')
  assert.match(last().text, /No reply times yet/)
  chat.ai.script(ROUTE, routed({ route: 'chat', reply: 'Any time.' }))
  await nat('thanks')
  await nat('/today')
  await nat('/speed')
  const m = last().text
  assert.match(m, /^⏱ <b>Reply times<\/b> \(your last 3 messages, newest first\)/)
  assert.match(m, /“\/today”: reply \d+\.\d s · done \d+\.\d s · command/)   // since item 5, Today’s own command
  assert.match(m, /“thanks”: reply \d+\.\d s · done \d+\.\d s · quick AI/)
  assert.match(m, /“\/speed”: reply \d+\.\d s · done \d+\.\d s · command/)
  assert.match(m, /<i>Typical first reply: .*quick AI \d+\.\d s/)
  chat.noSurprises()
})

// counts the brain-context reads (only loadPlannerContext reads habits)
function countReads(table) {
  const real = globalThis.fetch
  const counter = { n: 0, restore: () => { globalThis.fetch = real } }
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (url.includes(`/rest/v1/${table}?`) && (init?.method ?? 'GET') === 'GET') counter.n++
    return real(input, init)
  }
  return counter
}
const slow = (reply, ms, before) => async () => { await new Promise((r) => setTimeout(r, ms)); await before?.(); return reply }

test('two messages back to back: the second reuses the brain’s context (nothing changed in between)', { skip }, async () => {
  const reads = countReads('context_facts')
  try {
    chat.ai.script(CHAT, slow(brain({ intent: 'question', reply: 'Because of Saturday’s game.' }), 600), brain({ intent: 'question', reply: 'Monday is your PureGym day.' }))
    await Promise.all([nat('why is lower on thursday?'), new Promise((r) => setTimeout(r, 150)).then(() => nat('why is upper on monday?'))])
    assert.deepEqual(chat.tg.sent().map((m) => m.text), ['Because of Saturday’s game.', 'Monday is your PureGym day.'], 'in order')
    assert.equal(reads.n, 1, 'his context was read once for both')
  } finally { reads.restore() }
  chat.noSurprises()
})

test('…but not when a card was saved meanwhile (a tap anywhere): then the second reads everything fresh', { skip }, async () => {
  const reads = countReads('context_facts')
  const saveACard = () => q(`insert into telegram_pending (user_id, kind, text, status, payload) values ($1, 'capture', 'x', 'saved', '{}')`, [chat.users.owner])
  try {
    chat.ai.script(CHAT, slow(brain({ intent: 'question', reply: 'One.' }), 600, saveACard), brain({ intent: 'question', reply: 'Two.' }))
    await Promise.all([nat('why is lower on thursday?'), new Promise((r) => setTimeout(r, 150)).then(() => nat('why is upper on monday?'))])
    assert.deepEqual(chat.tg.sent().map((m) => m.text), ['One.', 'Two.'])
    assert.equal(reads.n, 2, 'read again after the change')
  } finally { reads.restore() }
  chat.noSurprises()
})

test('the change card and the edit prompt use the same buttons: ✅ Apply · ✏️ Change · ❌ Cancel', { skip }, async () => {
  await seed()
  const tomorrow = chat.time.addDays(chat.time.todayISO(), 1)
  chat.ai.script(CHAT, (body) => {
    const ref = body.messages[0].content.map((c) => c.text).join('\n').match(/(T\d+) \| Physics homework/)[1]
    return brain({ intent: 'instruction', reply: 'Okay.', actions: [{ op: 'due', ref, value: '', date: tomorrow, date_to: '', time: '', time_to: '', number: 0, words: 'tomorrow' }] })
  })
  await nat('move physics homework to tomorrow')
  const card = last()
  assert.deepEqual(labels(card), [['✅ Apply', '✏️ Change', '❌ Cancel']])
  await chat.tap(chat.button(card, 'Change'), card.message_id)
  assert.deepEqual(labels(last()), [['✅ Apply as is', '❌ Cancel']])
  await chat.tap(chat.button(last(), 'Cancel'), last().message_id)
  assert.equal(last().text, 'Cancelled. Nothing changed.')
  chat.noSurprises()
})

test('a plug-in fast path can name records for built-in ops (refs) and say what a handled message was', { skip }, async () => {
  const ev = await chat.add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '18:00', end_time: '19:30' })
  const { PLUGINS } = await import('../lib/telegram/plugins/index.ts')
  const p = {
    name: 'refs-test',
    fast: async (m, env) => {
      if (m === 'football is over for good') {
        return { kind: 'actions', actions: [{ op: 'event_cancel', ref: 'E1', value: 'every', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }],
          refs: [['e1', { kind: 'event', id: ev.id, title: ev.title, status: null, deadline: null }]] }
      }
      if (m === 'handled here') {
        const { say } = await import('../lib/telegram/turns.ts')
        await say(env.sb, env.chatId, 'Done by the plug-in.')
        return { kind: 'handled', intent: 'instruction' }
      }
      return null
    },
  }
  PLUGINS.push(p)
  try {
    await nat('football is over for good')
    const card = last()
    assert.match(card.text, /<b>Football training<\/b>: → cancelled every week/)
    assert.deepEqual(labels(card), [['✅ Apply', '✏️ Change', '❌ Cancel']])
    await chat.tap(chat.button(card, 'Apply'), card.message_id)
    assert.ok((await q(`select archived_at from events where id = $1`, [ev.id]))[0].archived_at, 'archived (never deleted)')
    await nat('handled here')
    assert.equal(last().text, 'Done by the plug-in.')
    assert.deepEqual((await q(`select text, intent, path from telegram_turns where role = 'nat' and intent <> 'tap' order by id`)).map((t) => `${t.text}:${t.intent}:${t.path}`),
      ['football is over for good:instruction:fast', 'handled here:instruction:fast'])
    assert.equal(chat.ai.requests.length, 0, 'no AI for either')
  } finally {
    PLUGINS.splice(PLUGINS.indexOf(p), 1)
  }
  chat.noSurprises()
})
