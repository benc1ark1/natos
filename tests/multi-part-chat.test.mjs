// A long, casual message about several sessions at once becomes ONE change card with every part in it, and the one
// unclear part (how long the Uber home takes) is a quick-tap question on that card, not left out. TEST database.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/multi-part-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a)
const cards = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌'))
const act = (o) => ({ op: 'travel_set', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const uber = (place, minutes) => ({ label: `${minutes.replace('-', '–')} min`, actions: [act({ value: `from=${place}; to=Home; minutes=${minutes}; mode=uber` })] })

const MESSAGE = 'I have training Monday for Club 360 Talent, 8 get there to 10 end at Christchurch Finchley College, Uber back; Wednesday same club 7:45 be there, ends 9:30 at 24 Tiverton Road, Uber back'
// what the brain is asked to send for it (the real model is checked in tests/ai/multi-part.ai.mjs)
const DECISION = brain({
  intent: 'instruction', reply: 'Two weekly Club 360 Talent sessions with their places, and the Ubers home.',
  actions: [
    act({ op: 'event_weekly', value: 'name=Club 360 Talent; place=Christchurch Finchley College; type=football; arrive=yes', words: 'Monday', time: '20:00', time_to: '22:00' }),
    act({ op: 'event_weekly', value: 'name=Club 360 Talent; place=24 Tiverton Road; type=football; arrive=yes', words: 'Wednesday', time: '19:45', time_to: '21:30' }),
  ],
  ask: [
    { question: 'How long is the Uber home from Christchurch Finchley College (Mon)?', options: [uber('Christchurch Finchley College', '10-15'), uber('Christchurch Finchley College', '15-20'), uber('Christchurch Finchley College', '20-30')] },
    { question: 'How long is the Uber home from 24 Tiverton Road (Wed)?', options: [uber('24 Tiverton Road', '10-15'), uber('24 Tiverton Road', '15-20'), uber('24 Tiverton Road', '20-30')] },
  ],
})
/** The card as it reads now: the last message sent, or the last edit of it. */
const cardNow = () => {
  const id = cards().at(-1).message_id
  const edit = chat.tg.of('editMessageText').filter((c) => c.body.message_id === id).at(-1)
  return edit ? { text: edit.body.text, reply_markup: edit.body.reply_markup, message_id: id } : cards().at(-1)
}
const tapOn = async (label) => { const m = cardNow(); const data = chat.button(m, label); assert.ok(data, `no “${label}” button`); await chat.tap(data, m.message_id) }

test('several sessions in one casual message: one card with every session, place, arrival time and type; the Uber question is quick-tap', { skip }, async () => {
  chat.ai.script(CHAT, DECISION)
  await chat.nat(MESSAGE)
  chat.noSurprises()

  // ONE card, with both sessions in full
  assert.equal(cards().length, 1, 'one message: the card')
  const card = cards()[0]
  assert.match(card.text, /📅 New: <b>Club 360 Talent<\/b> every Mon be there 20:00, ends 22:00 at Christchurch Finchley College \(new place\) · Football/)
  assert.match(card.text, /📅 New: <b>Club 360 Talent<\/b> every Wed be there 19:45, ends 21:30 at 24 Tiverton Road \(new place\) · Football/)
  assert.doesNotMatch(card.text, /Left out/)
  // the unclear part is asked on the same card, one question at a time, with quick-tap answers
  assert.match(card.text, /❓ <b>How long is the Uber home from Christchurch Finchley College \(Mon\)\?<\/b> <i>\(1 of 2\)<\/i>/)
  assert.deepEqual(card.reply_markup.inline_keyboard.map((r) => r.map((b) => b.text)),
    [['10–15 min', '15–20 min', '20–30 min'], ['✋ Skip this part'], ['✅ Apply', '✏️ Change', '✖ Cancel']])
  assert.equal((await q(`select count(*)::int n from events`))[0].n, 0, 'nothing saved before ✅')

  // answer both: each answer joins the same card (redrawn in place, no new message)
  await tapOn('15–20 min')
  let now = cardNow()
  assert.equal(cards().length, 1, 'answered in place')
  assert.match(now.text, /🚕 <b>Christchurch Finchley College → Home<\/b>: 15–20 min by Uber/)
  assert.doesNotMatch(now.text, /🚕[^\n]*new places?: [^)]*Christchurch/, 'the session’s place isn’t made twice')
  assert.match(now.text, /❓ <b>How long is the Uber home from 24 Tiverton Road \(Wed\)\?<\/b>/)
  await tapOn('10–15 min')
  now = cardNow()
  assert.match(now.text, /🔧 <b>4 changes<\/b>/)
  assert.match(now.text, /🚕 <b>24 Tiverton Road → Home<\/b>: 10–15 min by Uber/)
  assert.doesNotMatch(now.text, /❓/)
  assert.deepEqual(now.reply_markup.inline_keyboard.map((r) => r.map((b) => b.text)), [['✅ Apply', '✏️ Change', '✖ Cancel']])

  // ✅ Apply: every part saved
  await tapOn('Apply')
  assert.match(cards().at(-1).text, /^✅ <b>Done<\/b>/)
  assert.doesNotMatch(cards().at(-1).text, /Not saved/)
  assert.deepEqual(await q(`select e.title, e.repeat_days, e.start_time, e.end_time, e.training_type, e.load, p.name place
    from events e join places p on p.id = e.place_id where e.archived_at is null order by e.start_time desc`), [
    { title: 'Club 360 Talent', repeat_days: [1], start_time: '20:00:00', end_time: '22:00:00', training_type: 'football', load: 'hard', place: 'Christchurch Finchley College' },
    { title: 'Club 360 Talent', repeat_days: [3], start_time: '19:45:00', end_time: '21:30:00', training_type: 'football', load: 'hard', place: '24 Tiverton Road' },
  ])
  assert.deepEqual(await q(`select f.name "from", t.name "to", j.mode, j.minutes_low, j.minutes from travel_times j
    join places f on f.id = j.from_place_id join places t on t.id = j.to_place_id where j.archived_at is null order by j.minutes desc`), [
    { from: 'Christchurch Finchley College', to: 'Home', mode: 'uber', minutes_low: 15, minutes: 20 },
    { from: '24 Tiverton Road', to: 'Home', mode: 'uber', minutes_low: 10, minutes: 15 },
  ])
  assert.equal((await q(`select count(*)::int n from places where archived_at is null`))[0].n, 3, 'two session places + Home, each made once')
  // typed as football already: no "what type of training is it?" question afterwards
  assert.doesNotMatch(cards().at(-1).text, /What type of training/)

  // ↩️ Undo: sessions and the places they made archived, never deleted
  await chat.tap(chat.button(cards().at(-1), 'Undo'), cards().at(-1).message_id)
  assert.equal((await q(`select count(*)::int n from events where archived_at is null`))[0].n, 0)
  assert.equal((await q(`select count(*)::int n from places where archived_at is null and not is_home`))[0].n, 0)
  assert.equal((await q(`select count(*)::int n from events`))[0].n, 2, 'kept, archived')
})

test('an unanswered or skipped question never hides the rest: Apply saves the clear parts and says what wasn’t saved', { skip }, async () => {
  chat.ai.script(CHAT, DECISION)
  await chat.nat(MESSAGE)
  await tapOn('Skip this part')
  const now = cardNow()
  assert.match(now.text, /Left out: How long is the Uber home from Christchurch Finchley College \(Mon\) \(skipped\)/)
  assert.match(now.text, /❓ <b>How long is the Uber home from 24 Tiverton Road \(Wed\)\?<\/b>/)
  await tapOn('Apply')   // the second question left unanswered
  const done = cards().at(-1).text
  assert.match(done, /^✅ <b>Done<\/b>/)
  assert.match(done, /Not saved \(no answer\): How long is the Uber home from 24 Tiverton Road \(Wed\)\?/)
  assert.equal((await q(`select count(*)::int n from events where archived_at is null`))[0].n, 2, 'both sessions saved')
  assert.equal((await q(`select count(*)::int n from travel_times`))[0].n, 0)
})

test('card HTML is always valid (escaped, never cut mid-tag), and if Telegram still rejects it the card goes as plain text', { skip }, async () => {
  const { safeHtml } = await import('../lib/telegram/api.ts')
  // stray < > &, a closing tag with no opening one, a tag left open, a long message cut between tags
  assert.equal(safeHtml('<b>Club <360> & co</i> <i>open'), '<b>Club &lt;360&gt; &amp; co <i>open</i></b>')
  assert.equal(safeHtml('a</b> &amp; <b>x</b>'), 'a &amp; <b>x</b>')
  const cut = safeHtml(`<b>${'x'.repeat(5000)}</b><i>end</i>`)
  assert.ok(cut.length <= 4000 && cut.endsWith('…</b>'), 'cut inside the text, its tag closed')

  const message = 'Club 360 Talent training every Monday 20:00–22:00 at Christchurch Finchley College, Uber home'
  chat.ai.script(CHAT, brain({
    intent: 'instruction', reply: 'A weekly session and its Uber home.',
    actions: [act({ op: 'event_weekly', value: 'name=Club 360 Talent training; place=Christchurch Finchley College; type=football', words: 'every Monday', time: '20:00', time_to: '22:00' })],
    ask: [{ question: 'How long is the Uber home from <Christchurch Finchley College>?', options: [uber('Christchurch Finchley College', '10-15'), uber('Christchurch Finchley College', '15-20')] }],
  }))
  chat.tg.failNext('sendMessage', "Bad Request: can't parse entities: Unclosed end tag at byte offset 120")
  await chat.nat(message)
  chat.noSurprises()
  const tries = chat.tg.calls.filter((c) => c.method === 'sendMessage')
  assert.equal(tries.length, 2, 'rejected once, then sent again')
  assert.equal(tries[0].body.parse_mode, 'HTML')
  assert.match(tries[0].body.text, /How long is the Uber home from &lt;Christchurch Finchley College&gt;\?/, 'his words escaped')
  const sent = tries[1].body
  assert.equal(sent.parse_mode, undefined, 'plain text the second time')
  assert.match(sent.text, /📅 New: Club 360 Talent training every Mon 20:00–22:00 at Christchurch Finchley College \(new place\) · Football/)
  assert.doesNotMatch(sent.text, /<\/?[bi]>|sendMessage failed|can't parse/)
  assert.ok(chat.button(sent, '10–15 min'), 'buttons kept')
})
