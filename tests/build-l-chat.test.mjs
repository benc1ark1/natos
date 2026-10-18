// Build 2, phase L on the TEST database: the guides. A question about a guide goes to the AI with that guide's text;
// "coach set 3x5 squats this week" is a card that adds to Athletic & Lower's weekly log; a line can be added to a guide.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/build-l-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }
const act = (o) => ({ op: 'guide_log', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })

test('“what’s my recovery-night skincare?” is answered with the Skincare guide in front of the AI', { skip }, async () => {
  await add('guides', { title: 'Skincare & Grooming', body: '## Recovery night\n1. Gentle cleanser\n2. Retinol (pea-sized)\n3. Moisturiser' })
  await add('guides', { title: 'Sleep', body: 'Lights out 22:30.' })
  chat.ai.script(CHAT, brain({ intent: 'question', reply: 'From Skincare & Grooming: gentle cleanser, a pea-sized retinol, then moisturiser.' }))
  await chat.nat('what’s my recovery-night skincare?')
  const seen = chat.lastBrainText()
  assert.match(seen, /<guides>\n<guide title="Skincare & Grooming">\n## Recovery night\n1\. Gentle cleanser/)
  assert.doesNotMatch(seen, /<guide title="Sleep">/, 'only the guide it’s about')
  assert.match(seen, /## Guides \(his how-to pages[^\n]*\n- Skincare & Grooming\n- Sleep/)
  assert.match(last().text, /pea-sized retinol/)
})

test('the weekly log: “coach set 3x5 squats this week” adds to Athletic & Lower’s log (card, Undo archives); a line added to a guide', { skip }, async () => {
  const ath = await add('guides', { title: 'Athletic & Lower', body: 'Fixed: warm up 10 min.', has_log: true })
  const sleep = await add('guides', { title: 'Sleep', body: 'Lights out 22:30.' })
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'guide=Athletic & Lower; text=Coach set 3x5 back squats and box jumps 4x3' })] }))
  await chat.nat('coach set 3x5 back squats and box jumps 4x3 this week')
  assert.match(last().text, /📒 <b>Athletic &amp; Lower<\/b> log, week of Mon \d+ \w+: \+ Coach set 3x5 back squats/)
  await tap('Apply')
  const week = chat.time.weekStartISO(chat.time.todayISO())
  assert.deepEqual(await q(`select guide_id, week_start::text, body, archived_at from guide_logs`), [{ guide_id: ath.id, week_start: week, body: 'Coach set 3x5 back squats and box jumps 4x3', archived_at: null }])
  await tap('Undo')
  assert.ok((await q(`select archived_at from guide_logs`))[0].archived_at, 'archived, not deleted')

  // a guide without a log says so; a line can be added to any guide (Undo puts the text back)
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'guide=Sleep; text=late one' })] }))
  await chat.nat('log a late night in sleep')
  assert.match(last().text, /“Sleep” has no weekly log/)
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ op: 'guide_note', value: 'guide=sleep; text=Magnesium 30 min before bed.' })] }))
  await chat.nat('add magnesium 30 min before bed to my sleep guide')
  await tap('Apply')
  assert.equal((await q(`select body from guides where id = $1`, [sleep.id]))[0].body, 'Lights out 22:30.\n\nMagnesium 30 min before bed.')
  await tap('Undo')
  assert.equal((await q(`select body from guides where id = $1`, [sleep.id]))[0].body, 'Lights out 22:30.')
})
