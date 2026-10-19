// Queue item 1c on the TEST database, with a fake Google (tests/support/fake-google.mjs): a Google Classroom assignment
// that looks like a test is read once by the quick model (date, topics, limits, length, marks) and the bot asks ONCE
// "📝 Test on <day> – plan revision? ✅"; ✅ saves the test (its homework copy archived, kept). Never in quiet hours (it
// waits for the next allowed tick). Over the AI cap it still asks with what plain code found. Not a test → never asked.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/tracker-classroom-chat.test.mjs
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, OWNER_TG, SORT } from './support/chat.mjs'
import { fakeGoogle } from './support/fake-google.mjs'
import { seed } from './support/tracker-bot.mjs'

const chat = useChat()
const skip = chat.skip
let g
before(async () => {
  if (skip) return
  g = await fakeGoogle()
  Object.assign(process.env, g.env, { TOKEN_KEY: '5a'.repeat(32) })
})
after(() => g?.close())
beforeEach(() => g?.reset())

const q = (...a) => chat.q(...a)
const T = () => chat.time
const today = () => T().todayISO()
const day = (iso) => `${T().dowShort(iso)} ${T().shortDate(iso)}`
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const connect = async () => (await import('../lib/google/oauth.ts')).finishConnect(await session(), { code: 'good-code', state: 'st', error: null, cookie: 'st.verifier', origin: 'http://localhost:3000' })
const tick = async (hhmm) => (await import('../lib/telegram/tick.ts')).runTick(await session(), OWNER_TG, new Date(T().zonedToUTC(today(), hhmm)))
const cards = () => chat.tg.sent().filter((m) => /plan revision\? ✅/.test(m.text))
const assignment = (id, title, due, description) => ({ id, summary: `Assignment: ${title}`, start: { date: due }, end: { date: T().addDays(due, 1) }, description })
const feed = (text, ref) => `Class: Maths Further Mf1a\nSubject: Further Maths\nClassroom: https://classroom.google.com/c/A/a/B/details\n\n${text}\n\nRef: ${ref}`

test('a Classroom test: the AI reads it once, one card; ✅ saves the test and archives its homework copy; never asked again', { skip }, async () => {
  await seed(chat)
  await connect()
  const due = T().addDays(today(), 30)
  g.addCalendar('feed@x', 'Homework feed', [assignment('f1', 'FM HT3 Test', due, feed(`Test on ${T().shortDate(due)}: matrices and further vectors. 50 minutes, 45 marks, calculator. No momentum.`, '0123456789abcdef'))])
  chat.ai.script(SORT, (body) => {
    assert.match(body.system, /Google Classroom assignment/)
    const text = body.messages[0].content
    assert.match(text, /<assignment>\nTitle: FM HT3 Test\nMaths Further Mf1a\n\nTest on [^\n]*No momentum\.\n<\/assignment>/, 'the class and the description, without the feed’s header lines')
    assert.match(text, /Tracker topics \(code name\): PC1-01 Matrices; PC1-02 Further vectors/, 'only his Further Maths topics')
    assert.doesNotMatch(text, /Ref: |classroom\.google\.com/)
    return { is_test: true, title: 'FM HT3 test', kind: 'test', date: due, codes: ['PC1-01', 'PC1-02'], topics: '', limits: 'no momentum', length_min: 50, marks: 45, minutes_per_day: 0, minutes_max: 0, info: 'calculator' }
  })
  await tick('12:00')
  assert.match(chat.tg.sent().map((m) => m.text).join('\n'), /📚 <b>New homework from Google Classroom<\/b>\n• Further Maths: FM HT3 Test/, 'the homework copy, as before')
  const [card] = cards()
  assert.ok(card, 'one question')
  assert.match(card.text, new RegExp(`^📝 <b>Test on ${day(due)}</b> – plan revision\\? ✅\\n<i>From Google Classroom: “FM HT3 Test”</i>\\n• 📝 New test: <b>FM HT3 test</b> · ${day(due)} \\(in 30 days\\) · Further Maths · topics PC1-01, PC1-02 · no momentum · 50 min · 45 marks`))
  assert.match(card.text, /its homework copy “FM HT3 Test” is archived/)
  assert.equal((await q(`select count(*)::int n from goals where title = 'FM HT3 test'`))[0].n, 0, 'nothing saved before ✅')
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  const [goal] = await q(`select kind, test_kind, target_date::text d, topic_codes, limits, length_min, marks, info, source, source_ref from goals where title = 'FM HT3 test'`)
  assert.deepEqual([goal.kind, goal.test_kind, goal.d, goal.topic_codes, goal.limits, goal.length_min, goal.marks, goal.info, goal.source], ['test', 'test', due, ['PC1-01', 'PC1-02'], 'no momentum', 50, 45, 'calculator', 'classroom'])
  assert.match(goal.source_ref, /^classroom:[0-9a-f]{24}$/)
  const [hw] = await q(`select archived_at, archive_reason from tasks where title = 'FM HT3 Test'`)
  assert.ok(hw.archived_at, 'the homework copy is archived (kept, not deleted)')
  assert.equal(hw.archive_reason, 'dropped')
  await tick('12:05')
  await tick('12:10')
  assert.equal(cards().length, 1, 'asked once')
  // Undo puts the homework back and archives the test
  const done = chat.tg.sent().filter((m) => chat.button(m, 'Undo')).at(-1)
  await chat.tap(chat.button(done, 'Undo'), done.message_id)
  assert.equal((await q(`select archived_at from tasks where title = 'FM HT3 Test'`))[0].archived_at, null)
  assert.ok((await q(`select archived_at from goals where title = 'FM HT3 test'`))[0].archived_at)
  chat.noSurprises()
})

test('quiet hours: no question at 22:30 (it waits); over the AI cap it still asks with what plain code found', { skip }, async () => {
  await seed(chat)
  await connect()
  const due = T().addDays(today(), 12)
  g.addCalendar('feed@x', 'Homework feed', [assignment('w1', 'Waves consolidation', due, feed('Revise stationary waves for the test: 30-60 minutes a day, 40 marks.', 'fedcba9876543210').replace('Further Maths', 'Physics'))])
  await tick('22:30')
  assert.equal(cards().length, 0, 'quiet hours: nothing asked')
  assert.equal(chat.ai.requests.length, 0, 'not even read yet')
  await q(`update profiles set ai_daily_cap_usd = 0 where user_id = $1`, [chat.users.owner])   // the AI limit is used up
  await tick('12:00')
  const [card] = cards()
  assert.ok(card, 'asked at the next allowed tick')
  assert.match(card.text, new RegExp(`📝 <b>Test on ${day(due)}</b> – plan revision\\? ✅[\\s\\S]*📝 New consolidation: <b>Waves consolidation</b> · ${day(due)} \\(in 12 days\\) · Physics · topics P7\\.3 · 40 marks · 30–60 min/day`))
  assert.equal(chat.ai.requests.length, 0, 'no AI over the cap: plain code read it')
  chat.noSurprises()
})

test('the AI says it is not a test ("Unit test corrections" homework): nothing is asked, ever', { skip }, async () => {
  await seed(chat)
  await connect()
  g.addCalendar('feed@x', 'Homework feed', [assignment('h1', 'Unit test corrections', T().addDays(today(), 3), feed('Redo the questions you got wrong in red pen.', 'aaaabbbbccccdddd'))])
  chat.ai.script(SORT, { is_test: false, title: '', kind: 'test', date: '', codes: [], topics: '', limits: '', length_min: 0, marks: 0, minutes_per_day: 0, minutes_max: 0, info: '' })
  await tick('12:00')
  await tick('12:05')
  assert.equal(cards().length, 0)
  assert.equal(chat.ai.byModel(SORT).length, 1, 'read once')
  assert.equal((await q(`select count(*)::int n from tasks where title = 'Unit test corrections' and archived_at is null`))[0].n, 1, 'it stays as homework')
  chat.noSurprises()
})
