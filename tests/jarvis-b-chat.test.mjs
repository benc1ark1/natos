// Jarvis phase B: simulated Telegram conversations for "see everything". Run: npm run test:chat
// Instant lists must come straight from the database with NO AI call; other questions go to the brain with
// the app's own free-time numbers. Skips itself if the test database isn't set up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), last = () => chat.last(), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const noAI = () => assert.equal(chat.ai.requests.length, 0, 'answered without any AI call')

/** A small made-up week: school, football on `footDay` (25 min travel), a project, a test, four tasks. */
async function seedWeek() {
  const { todayISO, addDays, isoDow } = chat.time
  const today = todayISO()
  const footDay = addDays(today, 3)
  const project = await add('projects', { name: 'Football comeback' })
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00' })
  await add('events', { title: 'Football', repeat_days: [isoDow(footDay)], start_time: '18:00', end_time: '19:30', travel_minutes: 25 })
  await add('goals', { title: 'Physics test', kind: 'test', target_date: addDays(today, 4) })
  await add('tasks', { title: 'SMC past paper', status: 'this_week', importance: 'must', due_at: `${addDays(today, 2)}T12:00:00Z`, postpone_count: 3, duration_minutes: 90 })
  await add('tasks', { title: 'Look up vectors video', status: 'inbox' })
  await add('tasks', { title: 'Book physio', status: 'this_week', importance: 'must', project_id: project.id, due_at: `${addDays(today, 1)}T12:00:00Z` })
  await add('tasks', { title: 'Learn guitar', status: 'someday' })
  return { today, footDay, project }
}

// ---------------------------------------------------------------- instant lists: no AI

test('"What\'s in my inbox?": exactly the Inbox, no AI', { skip }, async () => {
  await seedWeek()
  await nat('What’s in my inbox?')
  assert.match(last().text, /📥 <b>Inbox<\/b> \(1\)\n• Look up vectors video/)
  assert.match(last().text, /1 in Someday/)
  noAI()
})

test('/week and "show my week": the next 7 days, football on its day, no AI', { skip }, async () => {
  const { footDay } = await seedWeek()
  await nat('/week')
  const label = `${chat.time.dowShort(footDay)} ${chat.time.shortDate(footDay)}`
  assert.match(last().text, new RegExp(`<b>${label}</b>\\n  (🏫 School 08:45–16:00\\n  )?18:00–19:30 Football`))
  await nat('show my week')
  assert.equal(chat.tg.sent().length, 2)
  noAI()
})

test('"when am I free" on football day: travel and buffers taken off, no AI', { skip }, async () => {
  const { footDay } = await seedWeek()
  await nat(`/free ${chat.time.dowShort(footDay)}`)
  const t = last().text
  assert.match(t, /–17:25/, 'free until 17:25 (18:00 − 25 min travel − 10 min buffer)')
  assert.match(t, /• 20:05–/, 'free again from 20:05 (19:30 + 25 + 10)')
  assert.match(t, /Football 18:00–19:30 \+25 min travel each way/)
  noAI()
})

test('"What have I been postponing?": the push-back, no AI', { skip }, async () => {
  await seedWeek()
  await nat('What have I been postponing?')
  assert.match(last().text, /“SMC past paper” has been put off 3 times: do it tonight, or drop it\?/)
  noAI()
})

test('"What\'s next on Football comeback?": its most urgent open task; unknown project lists them', { skip }, async () => {
  await seedWeek()
  await nat("What's next on Football comeback?")
  assert.match(last().text, /<b>Football comeback<\/b>: next step\n• <b>Book physio<\/b>/)
  await nat('/next piano')
  assert.match(last().text, /No project called “piano”\. Your projects: Football comeback/)
  noAI()
})

test('/coming and /today, no AI', { skip }, async () => {
  await seedWeek()
  await nat('/coming')
  assert.match(last().text, /Physics test<\/b>/)
  assert.match(last().text, /<b>SMC past paper<\/b>/)
  // (item 5: /today is the Today list with a tap each; the whole rest of the day is "today" in words)
  await nat('/today')
  assert.match(last().text, /^📌 <b>Today · /)
  await nat('what is on today')
  assert.match(last().text, /📍 <b>Today<\/b>/)
  assert.match(last().text, /🕒 <b>Free<\/b>:/)
  noAI()
})

test('free time follows the settings saved on the profile', { skip }, async () => {
  const { footDay } = await seedWeek()
  await q(`update profiles set planning = '{"dayEnd":"21:00","bufferMin":0}' where user_id = $1`, [chat.users.owner])
  await nat(`/free ${chat.time.dowShort(footDay)}`)
  assert.match(last().text, /–17:35/, 'no buffer: 18:00 − 25 min travel')
  assert.match(last().text, /19:55–21:00/, 'ends at 21:00')
  noAI()
})

test('instant lists still work past the daily AI limit', { skip }, async () => {
  await seedWeek()
  await q(`insert into ai_usage (user_id, feature, model, cost_usd) values ($1, 'chat', 'claude-sonnet-5-5', 5)`, [chat.users.owner])
  await nat('/inbox')
  assert.match(last().text, /Look up vectors video/)
  assert.equal(chat.tg.sent().length, 1, 'no limit notice for a free answer')
  noAI()
})

// ---------------------------------------------------------------- the brain path

test('other wording goes to the brain, which gets 7 days of free time and can ask for an exact list', { skip }, async () => {
  const { footDay } = await seedWeek()
  chat.ai.script(CHAT, brain({ intent: 'question', reply: 'Busy midweek: football and the Physics test.', show: 'week' }))
  await nat('anything big this week?')
  const sent = chat.lastBrainText()
  assert.match(sent, /<free_time>/)
  assert.match(sent, /- Today from \d\d:\d\d: /)
  const free = sent.slice(sent.indexOf('<free_time>'), sent.indexOf('</free_time>'))
  assert.equal(free.split('\n').filter((l) => /^- (Today from|Tomorrow|[A-Z][a-z]{2} \d)/.test(l)).length, 7)
  assert.match(sent, new RegExp(`- ${chat.time.dowShort(footDay)} \\d+ \\w+: .*–17:25`), 'the brain sees football day with travel taken off')
  assert.match(sent, /## Projects\nP1 \| Football comeback/, 'and the projects')
  const m = last().text
  assert.match(m, /^Busy midweek: football and the Physics test\.\n\n🗓 <b>Your week<\/b>/)
  chat.noSurprises()
})

test('a bad date from the brain for free time falls back to today', { skip }, async () => {
  await seedWeek()
  chat.ai.script(CHAT, brain({ intent: 'question', reply: 'Here you go.', show: 'free', show_arg: 'next tuesday' }))
  await nat('got any gaps?')
  assert.match(last().text, /Free today<\/b>/)
  chat.noSurprises()
})

test('while a card is waiting, "today" is a change to the card, not the Today list', { skip }, async () => {
  await seedWeek()
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Tidy desk' }))
  chat.ai.script(SORT, sorted({ title: 'Tidy desk' }))
  await nat('Tidy desk')
  chat.ai.script(CHAT, brain({ intent: 'correction', item_text: 'Tidy desk today' }))
  chat.ai.script(SORT, sorted({ title: 'Tidy desk', due_date: chat.time.todayISO(), date_words: 'today' }))
  await nat('today')
  assert.match(last().text, /Corrected/)
  chat.noSurprises()
})

test('the morning brief has one push-back line', { skip }, async () => {
  await seedWeek()
  await nat('/brief full')   // (item 5: the whole-day brief; the morning message is Today)
  assert.match(last().text, /🤔 “SMC past paper” has been put off 3 times: do it today, or drop it\?/)
  assert.equal((last().text.match(/🤔/g) ?? []).length, 1)
  noAI()
})
