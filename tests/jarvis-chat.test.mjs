// Jarvis phase A: simulated Telegram conversations. Run: npm run test:chat
// The real bot code, a fake Telegram, a scripted AI (fake, free) and the TEST database (row level security on).
// Each test is a conversation: messages and taps in -> replies and database rows checked.
// Skips itself if the test database isn't set up (.env.testdb.local).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), tap = (...a) => chat.tap(...a), last = () => chat.last(), button = (m, l) => chat.button(m, l)
const q = (...a) => chat.q(...a), next = (d) => chat.next(d), lastBrainText = () => chat.lastBrainText(), noSurprises = () => chat.noSurprises()
const tasks = () => q(`select title, status, user_id from tasks where user_id = $1 order by created_at`, [chat.users.owner])
const cards = () => q(`select id, text, status, payload from telegram_pending where user_id = $1 order by created_at`, [chat.users.owner])

// ---------------------------------------------------------------- the two real bugs

test('bug 1, word for word: ✏️ Edit, then "That okay maybe" is not saved as a new Inbox idea', { skip }, async () => {
  const fri = next(5)
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Physics homework due Friday' }))
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Physics homework', subject: 'Physics', importance: 'must', due_date: fri, date_words: 'due Friday' }))
  await nat('Physics homework due Friday')
  const card = last()
  assert.match(card.text, /<b>Task<\/b>: Physics homework/)
  assert.match(card.text, /Nothing is saved until you tap ✅ Save/)

  await tap(button(card, 'Edit'), card.message_id)
  assert.equal((await cards())[0].status, 'editing', 'Edit keeps the card waiting (it used to cancel it)')
  assert.match(last().text, /What should I change/)
  assert.ok(button(last(), 'Save as is'), 'the card can still be saved as it is')

  // What a good brain does with it: chat, about the card being edited.
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Fine: keep it as it is?' }))
  await nat('That okay maybe')
  assert.match(lastBrainText(), /being edited/, 'the brain is told the card is being edited')
  assert.match(lastBrainText(), /Physics homework due Friday/, 'and remembers the conversation')
  assert.equal(last().text, 'Fine: keep it as it is?')
  assert.ok(button(last(), 'Save as is'), 'the reply offers the card back')
  assert.deepEqual(await tasks(), [], 'nothing saved')
  assert.equal((await cards()).length, 1, 'no new card for a meta-message')

  // ✅ Save as is → saved once, as the task (not an idea)
  await tap(button(last(), 'Save as is'), last().message_id)
  const t = await tasks()
  assert.equal(t.length, 1)
  assert.equal(t[0].title, 'Physics homework')
  assert.notEqual(t[0].status, 'inbox')
  noSurprises()
})

test('bug 1 backstop: even if the AI calls "That okay maybe" new, nothing is sorted or saved', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'That okay maybe' }))
  await nat('That okay maybe')
  assert.match(last().text, /What would you like me to do/)
  assert.equal(chat.ai.byModel(SORT).length, 0, 'never sent to the sorter')
  assert.deepEqual(await tasks(), [])
  assert.deepEqual(await cards(), [])
  noSurprises()
})

test('bug 2, word for word: "Can you move it as a real task" turns the card into a task, not a task called "Move it…"', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Look up the vectors video' }))
  chat.ai.script(SORT, sorted({ kind: 'idea', title: 'Look up the vectors video' }))
  await nat('Look up the vectors video')
  const first = last()
  assert.match(first.text, /<b>Idea<\/b>/)

  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Look up the vectors video', item_kind: 'task' }))
  // the sorter disagrees and says idea again: Nat's word wins
  chat.ai.script(SORT, sorted({ kind: 'idea', title: 'Look up the vectors video' }))
  await nat('Can you move it as a real task')
  assert.match(lastBrainText(), /<open_card state="waiting for his tap">/)
  assert.match(JSON.stringify(chat.ai.byModel(SORT).at(-1).body), /use kind \\"task\\"/, 'the sorter was told it is a task')
  const card = last()
  assert.match(card.text, /Corrected/)
  assert.match(card.text, /<b>Task<\/b>: Look up the vectors video/)
  assert.ok(!/Move it/i.test(card.text))

  const all = await cards()
  assert.deepEqual(all.map((c) => c.status), ['replaced', 'open'])
  assert.ok(chat.tg.calls.some((c) => c.method === 'editMessageReplyMarkup' && c.body.message_id === first.message_id), 'the old card lost its buttons')
  assert.deepEqual(await tasks(), [], 'still nothing saved before ✅')

  await tap(button(card, 'Save'), card.message_id)
  const t = await tasks()
  assert.equal(t.length, 1)
  assert.equal(t[0].title, 'Look up the vectors video')
  assert.equal(t[0].status, 'this_month', 'a real task in Later, not an Inbox idea (Inbox is for unsorted captures and dateless ideas)')
  noSurprises()
})

test('bug 2 backstop: if the AI calls "Can you move it as a real task" new, it is not saved', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Move it as a real task' }))
  await nat('Can you move it as a real task')
  assert.equal(chat.ai.byModel(SORT).length, 0)
  assert.deepEqual(await cards(), [])
  assert.deepEqual(await tasks(), [])
  noSurprises()
})

test('an instruction the brain can’t turn into a change says so, changes nothing, and keeps it as an App idea', { skip }, async () => {
  await q(`insert into tasks (user_id, title, status) values ($1, 'Look up the vectors video', 'inbox')`, [chat.users.owner])
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Tests can’t be moved from here yet.' }))
  await nat('move my physics test to Monday')
  assert.match(last().text, /I can’t do that yet — it needs adding in Claude Code/)
  assert.deepEqual((await tasks()).map((t) => t.status), ['inbox'])
  assert.deepEqual((await cards()).map((c) => c.status), ['saved'], 'only the App idea’s Undo handle')
  assert.deepEqual(await q(`select request, status from app_ideas`), [{ request: 'move my physics test to Monday', status: 'open' }])
  noSurprises()
})

// ---------------------------------------------------------------- corrections and Edit

test('a correction without tapping Edit replaces the card ("make it Thursday")', { skip }, async () => {
  const fri = next(5), thu = next(4)
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Physics homework due Friday' }))
  chat.ai.script(SORT, sorted({ title: 'Physics homework', subject: 'Physics', importance: 'must', due_date: fri, date_words: 'due Friday' }))
  await nat('Physics homework due Friday')
  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Physics homework due Thursday' }))
  chat.ai.script(SORT, sorted({ title: 'Physics homework', subject: 'Physics', importance: 'must', due_date: thu, date_words: 'due Thursday' }))
  await nat('make it Thursday')
  assert.match(lastBrainText(), /Physics homework due Friday/, 'the brain saw the open card')
  assert.match(last().text, new RegExp(`due ${chat.time.dowShort(thu)}`))
  const all = await cards()
  assert.deepEqual(all.map((c) => c.status), ['replaced', 'open'])
  assert.equal(all[1].payload.replaces, all[0].id)
  assert.equal(all[1].text, 'Physics homework due Thursday')
  noSurprises()
})

test('after ✏️ Edit, a whole new version is the correction even if the AI calls it new', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'SMC paper' }))
  chat.ai.script(SORT, sorted({ title: 'SMC paper' }))
  await nat('SMC paper')
  await tap(button(last(), 'Edit'), last().message_id)
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'SMC past paper 2024, 90 min' }))
  chat.ai.script(SORT, sorted({ title: 'SMC past paper 2024', duration_minutes: 90 }))
  await nat('SMC past paper 2024, 90 min')
  assert.match(last().text, /Corrected/)
  assert.deepEqual((await cards()).map((c) => c.status), ['replaced', 'open'])
  noSurprises()
})

test('a failed correction leaves the card exactly as it was', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Read chapter 3' }))
  chat.ai.script(SORT, sorted({ title: 'Read chapter 3' }))
  await nat('Read chapter 3')
  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Read chapter 4' }))
  chat.ai.script(SORT, { status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } } })
  await nat('chapter 4 actually')
  assert.match(last().text, /Couldn’t sort the correction/)
  assert.deepEqual((await cards()).map((c) => c.status), ['open'])
  assert.deepEqual(await tasks(), [], 'and nothing went to Inbox')
  noSurprises()
})

test('/cancel drops the open card and removes its buttons', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Buy a calculator' }))
  chat.ai.script(SORT, sorted({ title: 'Buy a calculator' }))
  await nat('Buy a calculator')
  const card = last()
  await nat('/cancel')
  assert.match(last().text, /Cancelled “Buy a calculator”/)
  assert.deepEqual((await cards()).map((c) => c.status), ['cancelled'])
  assert.ok(chat.tg.calls.some((c) => c.method === 'editMessageReplyMarkup' && c.body.message_id === card.message_id))
  await tap(button(card, 'Save'), card.message_id)
  assert.deepEqual(await tasks(), [], 'its old ✅ does nothing')
  noSurprises()
})

test('double tap on ✅ saves once', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Email Mr Khan' }))
  chat.ai.script(SORT, sorted({ title: 'Email Mr Khan' }))
  await nat('Email Mr Khan')
  const data = button(last(), 'Save')
  await Promise.all([tap(data), tap(data)])
  assert.equal((await tasks()).length, 1)
  assert.ok(chat.tg.calls.some((c) => c.method === 'answerCallbackQuery' && c.body.text === 'Already handled.'))
})

// ---------------------------------------------------------------- memory, order, duplicates

test('memory: the brain gets the last turns (oldest first), never older than 30 minutes', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Morning!' }), brain({ intent: 'chat', reply: 'Sure.' }))
  await nat('morning')
  await nat('thanks')
  const text = lastBrainText()
  assert.match(text, /Nat: morning\n.*You: Morning!/s)
  // age everything by 31 minutes: forgotten
  await q(`update telegram_turns set created_at = created_at - interval '31 minutes'`)
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))
  await nat('hi')
  assert.match(lastBrainText(), /nothing in the last 30 minutes/)
  noSurprises()
})

test('a card older than 30 minutes is no longer "the card"', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Tidy desk' }))
  chat.ai.script(SORT, sorted({ title: 'Tidy desk' }))
  await nat('Tidy desk')
  await q(`alter table telegram_pending disable trigger telegram_pending_set_updated_at`)
  await q(`update telegram_pending set updated_at = now() - interval '31 minutes'`)
  await q(`alter table telegram_pending enable trigger telegram_pending_set_updated_at`)
  chat.ai.script(CHAT, brain({ intent: 'unclear', reply: 'Which item?' }))
  await nat('make it tomorrow')
  assert.match(lastBrainText(), /<open_card>\(none\)<\/open_card>/)
  noSurprises()
})

test('two quick messages are handled in order: the second sees the card the first made', { skip }, async () => {
  const slow = (reply, ms) => async () => { await new Promise((r) => setTimeout(r, ms)); return reply }
  chat.ai.script(CHAT, slow(brain({ intent: 'new', item_text: 'Chemistry notes due Friday' }), 1500))
  chat.ai.script(SORT, sorted({ title: 'Chemistry notes' }))
  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Chemistry notes due Friday, 30 min' }))
  chat.ai.script(SORT, sorted({ title: 'Chemistry notes', duration_minutes: 30 }))
  await Promise.all([nat('Chemistry notes due Friday'), new Promise((r) => setTimeout(r, 200)).then(() => nat('30 min'))])
  const second = chat.ai.byModel(CHAT)[1].body.messages[0].content.map((c) => c.text).join('\n')
  assert.match(second, /Chemistry notes/, 'the second message saw the first one’s card')
  assert.match(second, /<message>30 min<\/message>/)
  const texts = chat.tg.sent().map((m) => m.text)
  assert.ok(texts.findIndex((t) => /Corrected/.test(t)) > texts.findIndex((t) => /<b>Task<\/b>: Chemistry notes/.test(t)))
  assert.deepEqual((await cards()).map((c) => c.status), ['replaced', 'open'])
  assert.deepEqual((await q(`select status from telegram_turns where role = 'nat'`)).map((r) => r.status), ['done', 'done'])
  assert.deepEqual(await q(`select busy_until from telegram_state`), [{ busy_until: null }], 'the queue is free again')
  noSurprises()
})

test('Telegram sending the same message twice: handled once', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hello.' }))
  await nat('hello', { messageId: 555 })
  await nat('hello', { messageId: 555 })
  assert.equal(chat.tg.sent().length, 1)
  noSurprises()
})

// ---------------------------------------------------------------- questions

test('a question is answered from real records only, and a fact is offered, never auto-saved', { skip }, async () => {
  await q(`insert into tasks (user_id, title, status, importance) values ($1, 'Maths homework', 'today', 'must')`, [chat.users.owner])
  chat.ai.script(CHAT, (body) => {
    const snap = body.messages[0].content[0].text
    const ref = snap.match(/(T\d+) \| Maths homework/)[1]
    return brain({ intent: 'question', reply: `Start with ${ref}.`, plan: [{ ref, minutes: 40, focus: 'Q1–8', why: 'due today' }, { ref: 'T99', minutes: 10, focus: '', why: '' }], fact_to_save: 'Match is Saturday at 10.' })
  })
  await nat('what should I do now? btw my match is Saturday at 10')
  const m = last()
  assert.match(m.text, /Start with Maths homework\./, 'the ref became the title')
  assert.match(m.text, /1\. <b>Maths homework<\/b> · Q1–8 — 40 min/)
  assert.match(m.text, /Left out 1 suggestion/)
  assert.equal((await q(`select count(*)::int n from context_facts`))[0].n, 0, 'fact not saved yet')
  await tap(button(m, 'Save fact'), m.message_id)
  assert.deepEqual((await q(`select fact from context_facts where user_id = $1`, [chat.users.owner])).map((r) => r.fact), ['Match is Saturday at 10.'])
  noSurprises()
})

// ---------------------------------------------------------------- money

test('usage is logged per AI call and /usage shows it', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Gym bag' }))
  chat.ai.script(SORT, sorted({ title: 'Gym bag' }))
  await nat('Gym bag')
  const rows = await q(`select feature, model, cost_usd::float c from ai_usage where user_id = $1 order by id`, [chat.users.owner])
  // fake usage: 1000 in, 200 out, 500 cache reads
  assert.deepEqual(rows.map((r) => r.feature), ['chat', 'sort'])
  assert.ok(Math.abs(rows[0].c - (1000 * 2 + 200 * 10 + 500 * 0.2) / 1e6) < 1e-9)
  assert.ok(Math.abs(rows[1].c - (1000 * 1 + 200 * 5 + 500 * 0.1) / 1e6) < 1e-9)
  await nat('/usage')
  assert.match(last().text, /Today: \$0\.006 of your \$1\.50 daily limit \(2 calls\)/)
  noSurprises()
})

test('past the daily cap: no brain, one notice a day, capture still works, meta still never saved', { skip }, async () => {
  await q(`insert into ai_usage (user_id, feature, model, cost_usd) values ($1, 'chat', 'claude-sonnet-5-5', 1.60)`, [chat.users.owner])
  chat.ai.script(SORT, sorted({ title: 'Bring PE kit' }))
  await nat('Bring PE kit')
  const texts = chat.tg.sent().map((m) => m.text)
  assert.match(texts[0], /Today’s AI limit \(\$1\.50\) is used up/)
  assert.match(texts[1], /<b>Task<\/b>: Bring PE kit/)
  await nat('That okay maybe')
  assert.match(last().text, /Nothing saved/)
  await nat('what should I do now?')
  assert.match(last().text, /can’t answer questions right now/)
  assert.equal(chat.tg.sent().filter((m) => /AI limit .* is used up/.test(m.text)).length, 1, 'the notice comes once a day')
  assert.equal(chat.ai.byModel(CHAT).length, 0, 'the brain was never called')
  // raising the cap brings the brain back
  await nat('/cap 5')
  assert.match(last().text, /Daily AI limit set to \$5\.00/)
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Back.' }))
  await nat('hi')
  assert.equal(last().text, 'Back.')
  noSurprises()
})

test('if the AI is down: a new item is still sorted into a card (or kept in Inbox)', { skip }, async () => {
  chat.ai.script(CHAT, { status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } },
    { status: 529, json: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } })
  chat.ai.script(SORT, sorted({ title: 'Revise moments' }))
  await nat('Revise moments')
  const texts = chat.tg.sent().map((m) => m.text)
  assert.match(texts[0], /⚠️ AI error 529/)
  assert.match(texts[1], /<b>Task<\/b>: Revise moments/)
  noSurprises()
})

// ---------------------------------------------------------------- safety

test('another person’s card can never be touched (row level security)', { skip }, async () => {
  const [row] = await q(`insert into telegram_pending (user_id, kind, text, payload) values ($1, 'capture', 'stranger thing', '{}') returning id`, [chat.users.stranger])
  await tap(`s:${row.id}`)
  assert.ok(chat.tg.calls.some((c) => c.method === 'answerCallbackQuery' && c.body.text === 'Already handled.'))
  assert.deepEqual(await q(`select status from telegram_pending where id = $1`, [row.id]), [{ status: 'open' }])
  assert.deepEqual(await q(`select title from tasks where user_id = $1`, [chat.users.stranger]), [])
})

test('every new table has owner-only row level security', { skip }, async () => {
  const rows = await q(`select c.relname, c.relrowsecurity, (select count(*)::int from pg_policies p where p.tablename = c.relname and p.qual like '%auth.uid() = user_id%') pol
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('telegram_turns','telegram_state','ai_usage')`)
  assert.equal(rows.length, 3)
  for (const r of rows) assert.ok(r.relrowsecurity && r.pol === 1, r.relname)
})
