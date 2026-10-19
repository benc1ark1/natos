// Queue item 3, the ideas inbox (Nat's brief C), on the TEST database: anything the bot can't do yet → one line + saved to
// App ideas with his exact words and what's needed; /ideas sends one ready-to-paste block for Claude Code; Undo and
// "/ideas done|drop" mark ideas (never deleted). Run:
// node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/speed-ideas-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, ROUTE } from './support/chat.mjs'
import { brain, routed } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const ideas = () => q(`select request, source_text, needs, status from app_ideas order by created_at`)
const ONE_LINE = /^I can’t do that yet — it needs adding in Claude Code\. 💡 Saved to your App ideas \(\/ideas\)\.$/

test('can’t do → one line, saved with his exact words and what’s needed; /ideas is one block with them and the date', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'app_idea', idea: 'Rename a calendar event from Telegram', needs: 'A change that renames an event, on the usual ✅ card' }))
  await nat('rename CS tutor to Computing tutor')
  assert.match(last().text, ONE_LINE)
  assert.ok(chat.button(last(), 'Undo'), 'with ↩️ Undo')
  assert.deepEqual(await ideas(), [{ request: 'Rename a calendar event from Telegram', source_text: 'rename CS tutor to Computing tutor', needs: 'A change that renames an event, on the usual ✅ card', status: 'open' }])

  await nat('/ideas')
  const m = last().text
  const day = `${+chat.time.todayISO().slice(8, 10)} ${chat.time.shortDate(chat.time.todayISO()).split(' ')[1]}`
  assert.match(m, /^💡 <b>App ideas<\/b> \(1\): tap the block to copy it, then paste it into Claude Code\.\n<pre>/)
  assert.equal((m.match(/<pre>/g) ?? []).length, 1, 'one block')
  assert.match(m, /<pre>Nat OS: App ideas from my Telegram bot \(1 open, /)
  assert.ok(m.includes(`1. "rename CS tutor to Computing tutor" (${day})\n   Needs: A change that renames an event, on the usual ✅ card`), m)
  assert.match(m, /Build these one at a time, in this order: propose a plan for the first one and wait for my "go"\./)
  assert.match(m, /<\/pre>\n<i>Built one\? “\/ideas done 1”\. Not wanted\? “\/ideas drop 1”\.<\/i>$/)
  chat.noSurprises()
})

test('/ideas with several: oldest first, numbered, his words escaped safely; none open → says so', { skip }, async () => {
  await nat('/ideas')
  assert.match(last().text, /No App ideas yet/)
  await chat.add('app_ideas', { request: 'Connect Strava', source_text: 'cn u sync my strava pls', needs: 'A Strava connection', created_at: '2026-10-17T09:00:00Z' })
  await chat.add('app_ideas', { request: 'Show <b>bold</b> notes', source_text: 'show my notes in <b>bold</b> & big', created_at: '2026-10-18T09:00:00Z' })
  await chat.add('app_ideas', { request: 'Old one', source_text: 'old', status: 'done', created_at: '2026-10-16T09:00:00Z' })
  await nat('/ideas')
  const m = last().text
  assert.match(m, /App ideas<\/b> \(2\)/, 'only the open ones')
  assert.ok(m.indexOf('1. "cn u sync my strava pls" (17 Oct)') < m.indexOf('2. "show my notes in &lt;b&gt;bold&lt;/b&gt; &amp; big" (18 Oct)'), m)
  assert.match(m, /2\. .*\n {3}Needs: Show &lt;b&gt;bold&lt;\/b&gt; notes/, 'no "needs" yet: the short title says what he wanted')
  assert.doesNotMatch(m, /"old"/, "done ones are left out")
  chat.noSurprises()
})

test('Undo marks the idea dropped (never deleted); "/ideas done 1" and "/ideas drop 1" mark the others', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'app_idea', idea: 'Connect Strava', needs: 'A Strava connection on the Settings page' }))
  await nat('cn u sync my strava pls')
  await chat.tap(chat.button(last(), 'Undo'), last().message_id)
  assert.match(last().text, /Taken off your App ideas \(kept as dropped, not deleted\)/)
  assert.deepEqual((await ideas()).map((i) => i.status), ['dropped'])

  await chat.add('app_ideas', { request: 'Dark mode', source_text: 'dark mode pls' })
  await chat.add('app_ideas', { request: 'Voice notes', source_text: 'can you read voice notes' })
  await nat('/ideas done 1')
  assert.equal(last().text, '✅ Marked built: “Dark mode”.\n<b>Still open</b> (new numbers):\n1. Voice notes\n<i>Wrong one? “/ideas undo” reopens it.</i>', 'the new numbers, so an old number can’t close the wrong one')
  await nat('/ideas undo')
  assert.equal(last().text, '↩️ Reopened: “Dark mode” (/ideas lists it again).')
  await nat('/ideas done 1')
  await nat('/ideas drop 1')
  assert.match(last().text, /^Dropped: “Voice notes” \(kept, not deleted\)\.\n<i>No open App ideas left\.<\/i>/)
  await nat('/ideas done 3')
  assert.equal(last().text, 'You have no open App ideas.')
  await nat('/ideas finish it')
  assert.match(last().text, /“\/ideas done 2” when number 2 is built/)
  assert.deepEqual((await ideas()).map((i) => `${i.request}:${i.status}`), ['Connect Strava:dropped', 'Dark mode:done', 'Voice notes:dropped'], 'all three kept')
  chat.noSurprises()
})

test('a vague request is asked about, not saved as an idea', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'unclear', reply: 'What should it do: change your plan, or add something?' }))
  await nat('can you make it do the thing with my stuff')
  assert.equal(last().text, 'What should it do: change your plan, or add something?')
  assert.deepEqual(await ideas(), [])
  chat.noSurprises()
})

test('typos and a new feature the quick router hands on: the brain saves it with his exact words', { skip }, async () => {
  // "add dark mode to the app" looks simple enough for the quick router, which hands it to the brain (an app request)
  chat.ai.script(ROUTE, routed({ route: 'brain' }))
  chat.ai.script(CHAT, brain({ intent: 'app_idea', idea: 'Add a dark mode to the app', needs: 'A dark colour theme for the dashboard, with a switch in Settings' }))
  await nat('add darkmode to teh app plz')
  assert.match(last().text, ONE_LINE)
  assert.deepEqual(await ideas(), [{ request: 'Add a dark mode to the app', source_text: 'add darkmode to teh app plz', needs: 'A dark colour theme for the dashboard, with a switch in Settings', status: 'open' }])
  assert.equal(chat.ai.byModel(ROUTE).length, 1)
  chat.noSurprises()
})

test('a change the brain has no way to make is saved with what it said is missing', { skip }, async () => {
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Moving a test’s exam room isn’t something I can change yet.' }))
  await nat('move my physics test to room 12')
  assert.match(last().text, ONE_LINE)
  assert.deepEqual(await ideas(), [{ request: 'move my physics test to room 12', source_text: 'move my physics test to room 12', needs: 'Moving a test’s exam room isn’t something I can change yet.', status: 'open' }])
  chat.noSurprises()
})

test('a plug-in fast path can send a request to App ideas (no AI)', { skip }, async () => {
  const { PLUGINS } = await import('../lib/telegram/plugins/index.ts')
  const p = { name: 'ideas-test', fast: async (m) => (m === 'zz test-only plug-in phrase' ? { kind: 'idea', request: 'Export the tracker as an Excel file' } : null) }
  PLUGINS.push(p)
  try {
    await nat('zz test-only plug-in phrase')
    assert.match(last().text, ONE_LINE)
    assert.deepEqual(await ideas(), [{ request: 'Export the tracker as an Excel file', source_text: 'zz test-only plug-in phrase', needs: null, status: 'open' }])
    assert.equal(chat.ai.requests.length, 0, 'no AI')
  } finally {
    PLUGINS.splice(PLUGINS.indexOf(p), 1)
  }
  chat.noSurprises()
})
