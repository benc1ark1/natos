// Jarvis follow-ups (G) on the TEST database: journey ranges, App ideas, training type questions.
// Run: npm run test:chat (or just this file: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/jarvis-g-chat.test.mjs)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, OWNER_TG } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { withTravel, leaveBy, travelSettings } from '../lib/travel.ts'
import { expandEvents } from '../lib/events.ts'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const act = (o) => ({ op: 'travel_set', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
async function ask(text, changes) {
  chat.ai.script(CHAT, () => brain({ intent: 'instruction', reply: 'Okay.', actions: changes.map(act) }))
  await nat(text)
}
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }

test('fix 1: Uber times as ranges, per weekday; leave-by uses the slow end (drive max + wait max)', { skip }, async () => {
  const home = await add('places', { name: 'Home', is_home: true }), ground = await add('places', { name: 'Football ground' })
  const ev = await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '18:00', end_time: '19:30', place_id: ground.id })
  await ask('an Uber to Wednesday training is 15-20 min plus 0-8 min wait', [{ value: 'from=Home; to=Football ground; minutes=15-20; wait=0-8; mode=uber; day=wed' }])
  assert.match(last().text, /🚕 <b>Home → Football ground<\/b> \(Wednesdays\): 15–20 min by Uber \+ 0–8 min wait/)
  await tap('Apply')
  await ask('Monday training is 10-15 plus 0-8', [{ value: 'from=Home; to=Football ground; minutes=10–15; wait=0–8; mode=uber; day=monday' }])
  await tap('Apply')
  assert.deepEqual(await q(`select weekday, minutes_low, minutes, wait_low, wait_high from travel_times where archived_at is null order by weekday`),
    [{ weekday: 1, minutes_low: 10, minutes: 15, wait_low: 0, wait_high: 8 }, { weekday: 3, minutes_low: 15, minutes: 20, wait_low: 0, wait_high: 8 }])

  // leave-by from what's saved: Wed 18:00 − (20 + 8) = 17:32; Mon 18:00 − (15 + 8) = 17:37
  const leave = async (dow) => {
    const date = chat.next(dow)
    const world = { places: [home, ground], times: await q(`select * from travel_times where archived_at is null`), eventPlace: new Map([[ev.id, ground.id]]), settings: travelSettings({}) }
    return leaveBy(withTravel(expandEvents([ev], date, date), world)[0])
  }
  assert.deepEqual(await leave(3), { at: '17:32', words: '28 min by Uber from Home (15–20 min + 0–8 min wait)' })
  assert.deepEqual(await leave(1), { at: '17:37', words: '23 min by Uber from Home (10–15 min + 0–8 min wait)' })

  await tap('Undo')   // the Monday one: archived, never deleted; Wednesday's stays
  assert.deepEqual(await q(`select weekday from travel_times where archived_at is null`), [{ weekday: 3 }])
  assert.equal((await q(`select count(*)::int n from travel_times`))[0].n, 2)
})

test('fix 2: what the bot can’t do is said plainly and kept in App ideas; recurring events and settings it can do', { skip }, async () => {
  // can't do: "I can't do that yet", saved to App ideas, /ideas lists it, Undo marks it dropped (never deleted)
  chat.ai.script(CHAT, brain({ intent: 'app_idea', idea: 'Rename a calendar event from Telegram' }))
  await nat('rename CS tutor to Computing tutor')
  assert.match(last().text, /^I can’t do that yet — it needs adding in Claude Code\. 💡 Saved to your App ideas \(\/ideas\)\.$/)
  assert.deepEqual(await q(`select request, source_text, status from app_ideas`), [{ request: 'Rename a calendar event from Telegram', source_text: 'rename CS tutor to Computing tutor', status: 'open' }])
  await nat('/ideas')
  assert.match(last().text, /App ideas<\/b> \(1\)[\s\S]*<pre>[\s\S]*1\. "rename CS tutor to Computing tutor"[\s\S]*Needs: Rename a calendar event from Telegram/)
  await tap('Undo')
  assert.deepEqual(await q(`select status from app_ideas`), [{ status: 'dropped' }])

  // a recurring event: the days come from his words
  // (item 4: the life plug-in reads this shape itself, no AI)
  await nat('football training every Monday and Wednesday 6 to 7:30')
  assert.match(last().text, /📅 New: <b>Football training<\/b> every Mon \+ Wed 18:00–19:30/)
  await tap('Apply')
  assert.deepEqual(await q(`select title, repeat_days, start_time, end_time from events where archived_at is null`), [{ title: 'Football training', repeat_days: [1, 3], start_time: '18:00:00', end_time: '19:30:00' }])

  // a setting: changed by chat, Undo goes back to the default
  await ask('nothing planned after 10pm', [{ op: 'setting', value: 'dayEnd=22:00' }])
  assert.match(last().text, /⚙️ Nothing planned after: 22:30 → <b>22:00<\/b>/)
  await tap('Apply')
  const dayEnd = async () => (await q(`select planning->>'dayEnd' v from profiles where user_id = $1`, [chat.users.owner]))[0].v
  assert.equal(await dayEnd(), '22:00')
  await tap('Undo')
  assert.equal(await dayEnd(), null)
})

test('fix 3: a new or renamed session/target is asked its training type once; the name’s guess is only a suggestion', { skip }, async () => {
  await q(`delete from telegram_sent where key = 'onboard:gaps'`)   // Build O: the older type question runs until the first gap round
  // (item 5: the morning message's window — which starts the first gap round — ends before these 10:00 ticks)
  await q(`update profiles set planning = '{"holidays": "none", "briefAt": "07:00"}' where user_id = $1`, [chat.users.owner])
  const tick = async (hhmm) => {
    const { runTick } = await import('../lib/telegram/tick.ts')
    const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
    return runTick(await openOwnerSession(), OWNER_TG, new Date(chat.time.zonedToUTC(chat.time.todayISO(), hhmm)))
  }
  const tapIn = async (m, label) => chat.tap(chat.button(m, label), m.message_id)

  // added by the bot: asked straight after ✅ Apply, the guess first but only as a suggestion
  await ask('Owen training every Tuesday at 6pm', [{ op: 'event_weekly', value: 'Owen training', words: 'every Tuesday', time: '18:00', time_to: '19:30' }])
  await tap('Apply')
  const question = last()
  assert.match(question.text, /What type of training is the calendar session <b>Owen training<\/b>\?[\s\S]*only a guess/)
  assert.equal(question.reply_markup.inline_keyboard[0][0].text, '✓ Sprint (my guess)')
  const type = async () => (await q(`select training_type, load from events where title = 'Owen training'`))[0]
  assert.deepEqual(await type(), { training_type: null, load: null }, 'nothing stored before he answers')
  await tapIn(question, 'Football')   // not the guess: his answer wins
  assert.deepEqual(await type(), { training_type: 'football', load: 'hard' })
  assert.match(last().text, /Owen training<\/b>: Football \(hard\)\. Saved/)
  await tap('Undo')
  assert.deepEqual(await type(), { training_type: null, load: null })

  // asked once: not again, even though it has no type now
  assert.equal((await tick('10:00')).sent.includes('type'), false)

  // added on the dashboard: the tick asks (daytime only, one at a time); "Not training" is stored and never asked again
  const t = await add('weekly_targets', { name: 'Lower + plyo', target_count: 2 })
  assert.equal((await tick('22:00')).sent.includes('type'), false, 'not at night')
  assert.ok((await tick('10:05')).sent.includes('type'))
  assert.match(last().text, /the weekly target <b>Lower \+ plyo<\/b>/)
  await tapIn(last(), 'Not training')
  assert.equal((await q(`select training_type from weekly_targets where id = $1`, [t.id]))[0].training_type, 'none')
  assert.equal((await tick('10:10')).sent.includes('type'), false)

  // renamed on the dashboard (the form clears the type): asked again, under the new name
  await q(`update weekly_targets set name = 'Lower', training_type = null where id = $1`, [t.id])
  assert.ok((await tick('10:15')).sent.includes('type'))
  assert.match(last().text, /the weekly target <b>Lower<\/b>/)
})

test('final polish: Google copies of one session are asked about once by name; the answer covers every copy, and new copies inherit it', { skip }, async () => {
  await q(`delete from telegram_sent where key = 'onboard:gaps'`)   // Build O: the older type question runs until the first gap round
  // (item 5: the morning message's window — which starts the first gap round — ends before these 10:00 ticks)
  await q(`update profiles set planning = '{"holidays": "none", "briefAt": "07:00"}' where user_id = $1`, [chat.users.owner])
  const tick = async (hhmm) => {
    const { runTick } = await import('../lib/telegram/tick.ts')
    const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
    return runTick(await openOwnerSession(), OWNER_TG, new Date(chat.time.zonedToUTC(chat.time.todayISO(), hhmm)))
  }
  const copy = (n) => add('events', { title: 'Games', starts_at: `${chat.next(3)}T13:${20 + n}:00Z`, ends_at: `${chat.next(3)}T14:${20 + n}:00Z`, external_source: 'google', external_id: `g-games-${n}` })
  await copy(0); await copy(1); await copy(2)
  assert.ok((await tick('10:00')).sent.includes('type'))
  const question = last()
  assert.match(question.text, /calendar session <b>Games<\/b>/)
  for (const t of ['10:05', '10:10', '10:15']) assert.equal((await tick(t)).sent.includes('type'), false, 'not asked again for the other copies')
  await chat.tap(chat.button(question, 'Football'), question.message_id)
  assert.match(last().text, /Games<\/b>: Football \(hard\), all 3 in your calendar\. Saved/)
  assert.deepEqual(await q(`select distinct training_type from events where title = 'Games'`), [{ training_type: 'football' }])
  await copy(3)   // next week's copy arrives from Google
  assert.equal((await tick('10:20')).sent.includes('type'), false)
  assert.equal((await q(`select count(*)::int n from events where title = 'Games' and training_type = 'football'`))[0].n, 4)
})
