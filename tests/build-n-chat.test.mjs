// Build 2 phase N on the TEST database: the load-based training planner, his week, load costs and weighed rules.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/build-n-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const T = () => chat.time
const tapOn = async (m, label) => { const b = chat.button(m, label); assert.ok(b, `no button “${label}”`); await chat.tap(b, m.message_id) }
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await tapOn(m, label) }
const act = (o) => ({ op: 'load_set', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })

async function week() {
  const { checkinRange } = await import('../lib/ask/week.ts')
  const { from } = checkinRange(T().todayISO())
  const mon = T().isoDow(from) === 1 ? from : T().addDays(from, 8 - T().isoDow(from))
  await add('weekly_targets', { name: 'Upper', target_count: 3 })
  await add('weekly_targets', { name: 'Lower + plyo', target_count: 2 })
  await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '18:00', end_time: '19:30', repeat_from: T().addDays(mon, -7), training_type: 'football', load: 'hard' })
  const sat = T().addDays(mon, 5)
  await add('events', { title: 'Match', starts_at: T().zonedToUTC(sat, '10:00'), ends_at: T().zonedToUTC(sat, '11:30'), training_type: 'match', load: 'hard' })
  return { mon, sat }
}

test('N: “when’s best for upper body and Owen lower/plyo?” → placed by load with a reason each and a load view; 🔁 moves one; ✅ saves them; Undo', { skip }, async () => {
  const { sat } = await week()
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Looking at your week.', plan_week: true, plan_training: 'upper body, Owen lower/plyo' }))
  await nat('when’s best for upper body and Owen lower/plyo?')
  const card = last()
  if (process.env.SHOW) console.log(card.text, JSON.stringify(card.reply_markup))
  assert.match(card.text, /🏋️ <b>Training plan<\/b>/)
  // Build O: the sessions come from his set-up (upper 2× or 3×, decided and explained; one heavy lower), each with a place
  const uppers = Number(card.text.match(/💪 <i>Upper (\d)× /)?.[1])
  assert.ok([2, 3].includes(uppers), 'upper 2× or 3×, with the reason')
  assert.equal((card.text.match(/ Upper @ [^·]+ · /g) ?? []).length, uppers, 'that many Upper sessions, each with a place')
  assert.equal((card.text.match(/ Heavy lower @ (School gym|PureGym Swiss Cottage) · /g) ?? []).length, 1, 'one heavy lower, where the barbell and rack are')
  assert.doesNotMatch(card.text, /Stretching/, 'only the sessions he asked about')
  assert.ok((card.text.match(/↳ /g) ?? []).length >= uppers + 1, 'a reason for each')
  assert.match(card.text, /<b>Load<\/b>/)
  assert.match(card.text, /🔴 Sat <b>high<\/b> \d+ · Match/)
  assert.match(card.text, /Counted as games: Match \(Sat\)/)
  // no heavy legs the day before the match
  const friday = T().dowShort(T().addDays(sat, -1))
  assert.doesNotMatch(card.text, new RegExp(`<b>${friday} [^<]*</b> Heavy lower [^·]*· heavy`))

  // 🔁 the first session: where else could it go? pick the first option
  const first = card.reply_markup.inline_keyboard[1][0]
  assert.match(first.text, /^🔁 /)
  await chat.tap(first.callback_data, card.message_id)
  const options = last()
  if (process.env.SHOW) console.log(options.text, JSON.stringify(options.reply_markup))
  assert.match(options.text, /Where instead\?/)
  const pick = options.reply_markup.inline_keyboard[0][0]
  await chat.tap(pick.callback_data, options.message_id)
  const moved = last()
  assert.match(moved.text, /✏️ <b>.+<\/b> → /)
  assert.match(moved.text, /🏋️ <b>Training plan<\/b>/)

  await tapOn(moved, '✅ Apply')
  const n = (moved.text.match(/↳ /g) ?? []).length
  assert.match(last().text, new RegExp(`Training plan saved<\\/b>: ${n} sessions`))
  const rows = await q(`select title, kind, status from plan_blocks where status = 'planned'`)
  assert.equal(rows.length, n)
  assert.ok(rows.every((r) => / @ /.test(r.title)), 'each block says where')
  assert.ok(rows.every((r) => r.kind === 'training'))
  await tap('Undo')
  assert.equal((await q(`select count(*)::int n from plan_blocks where status = 'planned'`))[0].n, 0)
})

test('N: his week typed out is read (AI) and kept for planning; a training plan then uses it', { skip }, async () => {
  const { mon } = await week()
  const wed = T().addDays(mon, 2)
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Got it.', plan_week: true, plan_training: 'note' }))
  chat.ai.script(CHAT, { items: [
    { date: mon, start: '20:00', end: '21:00', title: 'CS tutor', kind: 'tutor', training_type: '', intensity: '', travel_minutes: 0 },
    { date: wed, start: '17:00', end: '18:00', title: 'Maths tutor', kind: 'tutor', training_type: '', intensity: '', travel_minutes: 0 },
    { date: '2020-01-01', start: '10:00', end: '11:00', title: 'Not this week', kind: 'other', training_type: '', intensity: '', travel_minutes: 0 },
  ], note: '' })
  await nat('my week: Mon CS tutor 8-9pm, Wed maths tutor 5-6pm, Thu CS tutor 7-8pm')
  assert.match(last().text, /📅 <b>Your week<\/b>[\s\S]*CS tutor 20:00–21:00[\s\S]*Maths tutor 17:00–18:00/)
  assert.doesNotMatch(last().text, /Not this week/, 'dates outside the week are dropped')
  assert.equal((await q(`select count(*)::int n from week_notes where archived_at is null`))[0].n, 1)

  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'On it.', plan_week: true, plan_training: 'upper' }))
  await nat('when should I do upper?')
  assert.match(last().text, /From the week you sent: .*CS tutor 20:00–21:00/)
  // nothing is placed on top of the tutor
  assert.doesNotMatch(last().text, new RegExp(`<b>${T().dowShort(mon)} 20:[0-5]0</b>`))
})

test('N: costs and guidelines by chat: “games are max load”, “Wednesday training is high CNS”, “light lower is ok the day before a game”; Undo', { skip }, async () => {
  await week()
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'type=match; all=max' })] }))
  await nat('games are max load')
  assert.match(last().text, /⚖️ <b>Match \(heavy\)<\/b>: legs 10 · upper 3 · CNS 10 → <b>legs 10 · upper 10 · CNS 10<\/b>/)
  await tap('Apply')
  assert.deepEqual(await q(`select scope, type_key, legs, upper, cns from load_costs where archived_at is null`), [{ scope: 'type', type_key: 'match', legs: 10, upper: 10, cns: 10 }])
  await tap('Undo')
  assert.equal((await q(`select count(*)::int n from load_costs where archived_at is null`))[0].n, 0)

  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'session=football training; day=wed; cns=high' })] }))
  await nat('Wednesday training is high CNS')
  assert.match(last().text, /⚖️ <b>Football training on Wednesdays<\/b>: legs 7 · upper 1 · CNS 7 → <b>legs 7 · upper 1 · CNS 8<\/b>/)
  await tap('Apply')
  assert.deepEqual(await q(`select scope, title, weekday, cns from load_costs where archived_at is null`), [{ scope: 'session', title: 'Football training', weekday: 3, cns: 8 }])

  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'rule_set', value: 'what=lower, plyo; near=match; side=before; days=1; load=moderate; label=No moderate or heavy Lower/plyo the day before a match (light is fine)' })] }))
  await nat('light lower is ok the day before a game')
  await tap('Apply')
  const rule = (await q(`select params, label from training_rules order by sort_order desc limit 1`))[0]
  assert.equal(rule.params.minLoad, 'moderate')
  assert.match(rule.label, /light is fine/)
})

test('final polish: /help is the short guide (one phone screen); the tick puts the commands in Telegram’s “/” menu once', { skip }, async () => {
  await nat('/help')
  const help = chat.tg.sent().at(-1).text
  assert.match(help, /☀️ <b>Morning<\/b>[\s\S]*🗓 <b>Sunday<\/b>[\s\S]*Your week[\s\S]*which days should I give Owen/)
  assert.ok(help.replace(/<[^>]+>/g, '').length < 1400, 'short enough for one screen')
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const tick = async (hhmm) => runTick(await openOwnerSession(), Number((await import('./support/chat.mjs')).OWNER_TG), new Date(T().zonedToUTC(T().todayISO(), hhmm)))
  await tick('12:00'); await tick('12:05')
  const set = chat.tg.of('setMyCommands')
  assert.equal(set.length, 1)
  assert.ok(set[0].body.commands.some((c) => c.command === 'help'))
})

test('N: “Games isn’t a match” changes every Google copy of that session by name; Undo puts each back', { skip }, async () => {
  const d = T().addDays(T().todayISO(), 3)
  for (const n of [0, 1]) await add('events', { title: 'Games', starts_at: T().zonedToUTC(T().addDays(d, 7 * n), '14:20'), ends_at: T().zonedToUTC(T().addDays(d, 7 * n), '15:00'), external_source: 'google', external_id: `g-games-${n}` })
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'training_type', value: 'none', words: 'Games' })] }))
  await nat('Games isn’t a match, it’s school PE')
  assert.match(last().text, /🏃 <b>Games<\/b> \(every one in your calendar\): Match → not training/)
  await tap('Apply')
  assert.deepEqual(await q(`select distinct training_type from events where title = 'Games'`), [{ training_type: 'none' }])
  await tap('Undo')
  assert.deepEqual(await q(`select distinct training_type from events where title = 'Games'`), [{ training_type: null }])
})
