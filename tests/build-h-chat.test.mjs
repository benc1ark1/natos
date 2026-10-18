// Build 2, phase H on the TEST database: what used to be fixed in code is his to change, by chat (and on the
// Settings page, which saves the same profiles.planning keys). One test per change.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/build-h-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT, OWNER_TG } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const act = (o) => ({ op: 'setting', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
async function ask(text, changes) {
  chat.ai.script(CHAT, () => brain({ intent: 'instruction', reply: 'Okay.', actions: changes.map(act) }))
  await nat(text)
}
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const planning = async () => (await q(`select planning from profiles where user_id = $1`, [chat.users.owner]))[0].planning ?? {}
const tick = async (hhmm) => {
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  return runTick(await openOwnerSession(), OWNER_TG, new Date(chat.time.zonedToUTC(chat.time.todayISO(), hhmm)))
}

test('settings: the brief time is his (by chat, with Undo); the tick follows it', { skip }, async () => {
  await ask('send the brief at 7:30', [{ value: 'briefAt=7:30am' }])
  assert.match(last().text, /⚙️ Morning brief: 07:00 → <b>07:30<\/b>/)
  await tap('Apply')
  assert.equal((await planning()).briefAt, '07:30')
  assert.equal((await tick('07:10')).sent.some((k) => k.startsWith('brief:')), false, 'not at the old time')
  assert.ok((await tick('07:35')).sent.some((k) => k.startsWith('brief:')), 'at his time')
  await tap('Undo')
  assert.equal((await planning()).briefAt, undefined, 'back to the default')
})

test('the AI reads who he is and his settings from his data, not from fixed text in its instructions', { skip }, async () => {
  const { BRAIN_PROMPT } = await import('../lib/telegram/brain.ts')
  const { PLAN_PROMPT } = await import('../lib/telegram/planner.ts')
  const ask = await import('../lib/ask/server.ts')
  const capture = await import('../lib/capture/server.ts')
  for (const [name, text] of Object.entries({ BRAIN_PROMPT, PLAN_PROMPT, ask: ask.SYSTEM_PROMPT, week: ask.weekPrompt('2026-10-12', '2026-10-18'), capture: capture.SYSTEM_PROMPT })) {
    assert.doesNotMatch(text, /sixth-form|21:30|2–3 hours|10-minute buffers|Further Maths, SMC, Physics|Vlad|tutor_cs/, `${name} has no fixed facts or settings`)
  }
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, { about: 'Year 13 student, A-levels in Maths and Physics; plays rugby.', hardSubjects: 'Physics', pushBackAfter: 4 }])
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))
  await nat('hello')
  const seen = chat.lastBrainText()
  assert.match(seen, /## About Nat[^\n]*\nYear 13 student, A-levels in Maths and Physics; plays rugby\./)
  assert.match(seen, /hardSubjects = Physics/)
  assert.match(seen, /pushBackAfter = 4/)
  assert.match(seen, /## Training types[\s\S]*- Upper \(key upper\): hard/)
  assert.match(seen, /## Task sources[\s\S]*- Maths\/physics tutor \(Vlad\)/)
})

test('task sources: a new one by chat; capture and the card use it; the database accepts it', { skip }, async () => {
  await ask('my new physics tutor Sam sets homework now', [{ op: 'list_edit', value: 'list=sources; item=Physics tutor (Sam)' }])
  assert.match(last().text, /📥 New task source: <b>Physics tutor \(Sam\)<\/b>/)
  await tap('Apply')
  const src = (await planning()).sources
  assert.deepEqual(src.at(-1), { key: 'physics_tutor_sam', label: 'Physics tutor (Sam)' })

  const fri = chat.next(5)
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'Physics homework from Sam due Friday' }))
  chat.ai.script(SORT, sorted({ kind: 'task', title: 'Physics homework', subject: 'Physics', importance: 'must', due_date: fri, date_words: 'due Friday', origin: 'physics_tutor_sam' }))
  await nat('Physics homework from Sam due Friday')
  assert.match(JSON.stringify(chat.ai.byModel(SORT).at(-1).body), /physics_tutor_sam = Physics tutor \(Sam\)/, 'the sorter is told his sources')
  assert.match(last().text, /from Physics tutor \(Sam\)/)
  await tap('Save')
  assert.deepEqual(await q(`select title, origin from tasks`), [{ title: 'Physics homework', origin: 'physics_tutor_sam' }])

  // archive it: kept (old tasks still show it), not offered for new ones
  await ask('Sam stopped tutoring me', [{ op: 'list_edit', value: 'list=sources; item=Physics tutor (Sam); archive=yes' }])
  await tap('Apply')
  assert.equal((await planning()).sources.find((x) => x.key === 'physics_tutor_sam').archived, true)
})

test('training types: a new one by chat; the bot then asks about sessions named like it; the database accepts it', { skip }, async () => {
  await q(`delete from telegram_sent where key = 'onboard:gaps'`)   // Build O: the older type question runs until the first gap round
  await ask('add swimming as a training type, it is light and I can fit it in anywhere', [{ op: 'list_edit', value: 'list=types; item=Swim; words=swim, pool; load=light; placeable=yes' }])
  assert.match(last().text, /🏃 New training type: <b>Swim<\/b> \(light; the planner can fit it into free time; spotted from: swim, pool\)/)
  await tap('Apply')
  await add('events', { title: 'Pool session', repeat_days: [6], start_time: '09:00', end_time: '10:00' })
  assert.ok((await tick('10:00')).sent.includes('type'))
  const question = last()
  assert.match(question.text, /What type of training is the calendar session <b>Pool session<\/b>/)
  assert.equal(question.reply_markup.inline_keyboard[0][0].text, '✓ Swim (my guess)')
  await chat.tap(chat.button(question, 'Swim'), question.message_id)
  assert.deepEqual(await q(`select training_type, load from events where title = 'Pool session'`), [{ training_type: 'swim', load: 'light' }])
})

test('events and targets, for good: rename an event, say it isn’t school, change a session’s length (each with Undo)', { skip }, async () => {
  const ev = await add('events', { title: 'CS tutor', repeat_days: [1, 4], start_time: '17:00', end_time: '18:00' })
  const camp = await add('events', { title: 'Holiday camp', repeat_days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '15:00' })
  const w = await add('weekly_targets', { name: 'Upper', target_count: 3, training_type: 'upper' })
  // the brain refers to records by refs from the snapshot: find them the way it would
  chat.ai.script(CHAT, brain({ intent: 'chat', reply: 'Hi.' }))
  await nat('hi')
  const snap = chat.lastBrainText()
  const refOf = (title) => snap.match(new RegExp(`(E\\d+) \\| ${title}`))[1]
  const wRef = snap.match(/(W\d+) \| Upper/)[1]
  assert.match(snap, /Holiday camp \| every Mon \+ Tue \+ Wed \+ Thu \+ Fri 09:00–15:00 · school \(guessed\)/)

  await ask('rename CS tutor to Computing tutor', [{ op: 'event_set', ref: refOf('CS tutor'), value: 'title=Computing tutor' }])
  assert.match(last().text, /📅 <b>CS tutor<\/b> → <b>Computing tutor<\/b>/)
  await tap('Apply')
  assert.equal((await q(`select title from events where id = $1`, [ev.id]))[0].title, 'Computing tutor')
  assert.equal((await q(`select count(*)::int n from app_ideas`))[0].n, 0, 'no longer an App idea')
  await tap('Undo')
  assert.equal((await q(`select title from events where id = $1`, [ev.id]))[0].title, 'CS tutor')

  await ask('holiday camp is not school', [{ op: 'event_set', ref: refOf('Holiday camp'), value: 'school=no' }])
  assert.match(last().text, /🏫 <b>Holiday camp<\/b>: school \(guessed\) → <b>not school<\/b>/)
  await tap('Apply')
  assert.equal((await q(`select is_school from events where id = $1`, [camp.id]))[0].is_school, false)

  await ask('upper sessions are 75 minutes', [{ op: 'target_set', ref: wRef, value: 'minutes=75' }])
  assert.match(last().text, /🎯 <b>Upper<\/b> session: 60 min → <b>75 min<\/b>/)
  await tap('Apply')
  assert.equal((await q(`select session_minutes from weekly_targets where id = $1`, [w.id]))[0].session_minutes, 75)
})
