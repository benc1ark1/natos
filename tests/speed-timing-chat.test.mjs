// Queue item 3: how fast the bot answers, on the real bot code with simulated network times (tests/support/timing.mjs:
// Supabase 40 ms a call, Telegram 100 ms, Haiku 0.8 s, Sonnet 4 s, Opus 8 s). One test per kind of message; each
// records when the first "typing…" and the first reply reached Telegram, the total, the DB calls and waves, and the
// AI calls. The table is printed (and written to $SPEED_OUT if set); the targets below make a slow-down fail.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/speed-timing-chat.test.mjs
// SPEED_BEFORE=1 only measures (for the "before" column of plans/speed-report.md, on the old code).
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { useChat, CHAT, SORT, ROUTE } from './support/chat.mjs'
import { brain, sorted, routed } from './support/fakes.mjs'
import { stopwatch, table } from './support/timing.mjs'

const chat = useChat()
const skip = chat.skip
const measuring = process.env.SPEED_BEFORE === '1'
const rows = []
let sw = null

// Targets (simulated): the first "typing…" within 0.3 s of the message arriving; simple replies within 3 s; a message
// that needs the full brain within its 4 s + 1.5 s; a ✅ tap within 1.5 s. Times depend a little on how busy this PC is,
// so each message also checks what can't wobble: which AI models it used, and that Nat waits for fewer DB waves than
// before this build (each limit is today's count + 1; the old code needed 10 · 7 · 7 · 10 · 15 · 14 · 8 · 6).
const TARGET = { typing: 300, simple: 3000, brain: 5500, tap: 1500 }

// set up on first use (after useChat's own set-up has started the fakes)
async function ready() {
  if (sw) return
  sw = stopwatch({ db: process.env.NEXT_PUBLIC_SUPABASE_URL, tg: chat.tg.url, ai: chat.ai.url })
  // a warm instance: the owner session is already open (a cold start adds three auth calls once)
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  await openOwnerSession()
  // a plug-in fast path (lib/telegram/plugins): answers without any AI
  const { PLUGINS } = await import('../lib/telegram/plugins/index.ts')
  PLUGINS.push({ name: 'speedtest', fast: async (m) => (m === 'speedtest ping' ? { kind: 'answer', html: 'pong' } : null) })
}
after(async () => {
  if (skip) return
  sw?.restore()
  const { PLUGINS } = await import('../lib/telegram/plugins/index.ts')
  const i = PLUGINS.findIndex((p) => p.name === 'speedtest')
  if (i >= 0) PLUGINS.splice(i, 1)
  const md = table(rows)
  console.log(`\n${md}\n`)
  if (process.env.SPEED_OUT) writeFileSync(process.env.SPEED_OUT, `${md}\n`)
})

const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)

/** A small realistic starting point: open homework, an Inbox item, weekly football, an upper target. */
async function seed() {
  await ready()
  const today = chat.time.todayISO()
  const subj = Object.fromEntries((await chat.q(`select id, name from subjects where user_id = $1`, [chat.users.owner])).map((s) => [s.name, s.id]))
  await chat.add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: `${chat.time.addDays(today, 3)}T16:00:00Z`, subject_id: subj.Physics })
  await chat.add('tasks', { title: 'Look up the vectors video', status: 'inbox' })
  await chat.add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '18:00', end_time: '19:30' })
  await chat.add('weekly_targets', { name: 'Upper', target_count: 2, training_type: 'upper' })
  // the queue's row exists after his very first message ever (lib/telegram/turns.ts takeLock)
  await chat.q(`insert into telegram_state (user_id) values ($1) on conflict do nothing`, [chat.users.owner])
}

/** The path the bot logged for its last message (telegram_turns.path, after supabase/speed.sql), if any. */
async function loggedPath() {
  try { return (await chat.q(`select path from telegram_turns where role = 'nat' order by id desc limit 1`))[0]?.path ?? null } catch { return null }
}

async function measure(name, run, kind, expect = {}) {
  sw.start()
  await run()
  const r = sw.stop()
  if (process.env.SPEED_TRACE) {
    const lines = sw.calls.map((c) => `  ${String(Math.round(c.start)).padStart(5)}–${String(Math.round(c.end)).padStart(5)} ${c.kind} ${c.what}`)
    console.log(['', name, ...lines].join('\n'))
  }
  const path = kind === 'tap' ? 'tap' : (await loggedPath()) ?? '—'
  rows.push({ name, path, ...r })
  if (!measuring) {
    if (kind !== 'tap') assert.ok(r.typing != null && r.typing <= TARGET.typing, `${name}: first “typing…” after ${r.typing} ms (target ${TARGET.typing})`)
    const limit = TARGET[kind]
    assert.ok(r.reply != null && r.reply <= limit, `${name}: first reply after ${r.reply} ms (target ${limit})`)
    if (expect.models) assert.deepEqual(r.ai.map((a) => a.model), expect.models, `${name}: AI calls`)
    if (expect.waited != null) assert.ok(r.waited <= expect.waited, `${name}: Nat waits for ${r.waited} DB waves (at most ${expect.waited})`)
  }
  return r
}

test('a greeting: "thanks"', { skip }, async () => {
  await seed()
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Any time.' }))
  chat.ai.script(ROUTE, routed({ route: 'chat', reply: 'Any time.' }))
  await measure('“thanks”', () => chat.nat('thanks'), 'simple', { models: [ROUTE], waited: 6 })
  assert.equal(last().text, 'Any time.')
})

test('an instant list: /today', { skip }, async () => {
  await seed()
  await measure('/today', () => chat.nat('/today'), 'simple', { models: [], waited: 6 })
  assert.match(last().text, /📍 <b>Today<\/b>/)
})

test('an instant list in words: "what\'s in my inbox"', { skip }, async () => {
  await seed()
  await measure('“what’s in my inbox”', () => chat.nat('what’s in my inbox'), 'simple', { models: [], waited: 6 })
  assert.match(last().text, /📥 <b>Inbox<\/b> \(1\)/)
})

test('a question a list answers: "what\'s due this week?"', { skip }, async () => {
  await seed()
  chat.ai.script(CHAT, brain({ intent: 'question', reply: 'Physics homework, on Thursday.', show: 'week' }))
  chat.ai.script(ROUTE, routed({ route: 'list', show: 'week' }))
  await measure('“what’s due this week?”', () => chat.nat('what’s due this week?'), 'simple', { models: [ROUTE], waited: 6 })
  assert.match(last().text, /🗓 <b>Your week<\/b>[\s\S]*📌 due: <b>Physics homework<\/b>/)
})

test('a new item: "maths homework due Fri"', { skip }, async () => {
  await seed()
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'maths homework due Fri' }))
  chat.ai.script(ROUTE, routed({ route: 'new', item_text: 'maths homework due Fri', what: 'homework' }))
  chat.ai.script(SORT, sorted({ title: 'Maths homework', subject: 'Maths', importance: 'must', due_date: chat.next(5), date_words: 'Fri' }))
  await measure('“maths homework due Fri”', () => chat.nat('maths homework due Fri'), 'simple', { models: [ROUTE, SORT], waited: 9 })
  assert.match(last().text, /<b>Task<\/b>: Maths homework/)
})

test('an instruction, then ✅ Apply: "move physics homework to tomorrow"', { skip }, async () => {
  await seed()
  const tomorrow = chat.time.addDays(chat.time.todayISO(), 1)
  chat.ai.script(CHAT, (body) => {
    const snap = body.messages[0].content.map((c) => c.text).join('\n')
    const ref = snap.match(/(T\d+) \| Physics homework/)[1]
    return brain({ intent: 'instruction', reply: 'Physics homework moves to tomorrow.', actions: [{ op: 'due', ref, value: '', date: tomorrow, date_to: '', time: '', time_to: '', number: 0, words: 'tomorrow' }] })
  })
  chat.ai.script(ROUTE, routed({ route: 'brain' }))
  await measure('“move physics homework to tomorrow”', () => chat.nat('move physics homework to tomorrow'), 'brain', { models: [CHAT], waited: 11 })
  const card = last()
  assert.match(card.text, /Physics homework/)
  await measure('tap ✅ Apply', () => chat.tap(chat.button(card, 'Apply'), card.message_id), 'tap', { models: [], waited: 7 })
  assert.match(last().text, /✅ <b>Done<\/b>/)
  assert.equal((await chat.q(`select (due_at at time zone 'Europe/London')::date::text d from tasks where title = 'Physics homework'`))[0].d, tomorrow)
})

test('a plug-in fast path (no AI)', { skip }, async () => {
  await seed()
  await measure('plug-in fast path', () => chat.nat('speedtest ping'), 'simple', { models: [], waited: 4 })
  assert.equal(last().text, 'pong')
})
