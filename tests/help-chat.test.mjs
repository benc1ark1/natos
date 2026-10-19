// Queue item 8 on the TEST database: /help through the real bot (fake Telegram, scripted AI). /help and /start send the
// one-screen guide with HIS times (no typing, no AI); "/help all" every command; "what can you do?" / "commands" in
// words get the same; every command the full list names is real (none falls through to the help reply); a card stays
// open after "help".
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/help-chat.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const sent = () => chat.tg.sent()
const act = (o) => ({ op: 'setting', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const setPlanning = (planning) => chat.q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, planning])
const visible = (html) => html.replace(/<[^>]+>/g, '')

test('H1: /help and /start → the one-screen guide with the default times; “/help all” → every command; no typing, no AI', { skip }, async () => {
  const { HELP } = await import('../lib/telegram/bot.ts')
  const { helpCommandsTelegram } = await import('../lib/help.ts')
  await chat.nat('/help')
  assert.equal(sent().length, 1)
  assert.equal(sent()[0].text, HELP)
  assert.equal(sent()[0].parse_mode, 'HTML')
  assert.ok(visible(HELP).length <= 1400)
  assert.match(HELP, /☀️ <b>07:30<\/b>[\s\S]*🌙 <b>21:00<\/b>[\s\S]*🗓 <b>Sunday 18:00<\/b>[\s\S]*All commands: \/help all$/)
  assert.ok(!chat.tg.calls.some((c) => c.method === 'sendChatAction'), 'no typing for /help')
  await chat.nat('/start')
  assert.equal(sent().at(-1).text, HELP)
  await chat.nat('/help all')
  assert.equal(sent().at(-1).text, helpCommandsTelegram())
  assert.match(sent().at(-1).text, /\/postponed[\s\S]*\/add[\s\S]*\/dashboard[\s\S]*\/ask[\s\S]*\/cap/)
  chat.noSurprises()
})

test('H2: his own times: /help and “help” show what he set, not the defaults', { skip }, async () => {
  await setPlanning({ briefAt: '07:05', endOfDayAt: '21:40', checkinDay: 'saturday', resetAt: '17:15' })
  await chat.nat('/help')
  const a = sent().at(-1).text
  assert.match(a, /☀️ <b>07:05<\/b>[\s\S]*🌙 <b>21:40<\/b>[\s\S]*🗓 <b>Saturday 17:15<\/b>/)
  assert.ok(!a.includes('07:30'))
  await chat.nat('help')
  assert.equal(sent().at(-1).text, a, 'the same in words')
  chat.noSurprises()
})

test('H3: “what can you do?”, “how do I use this”, “commands” → the guide / every command with no AI; “help me plan tonight” goes to the brain', { skip }, async () => {
  const { HELP } = await import('../lib/telegram/bot.ts')
  const { helpCommandsTelegram } = await import('../lib/help.ts')
  for (const m of ['what can you do?', 'How do I use this?']) {
    await chat.nat(m)
    assert.equal(sent().at(-1).text, HELP, m)
  }
  await chat.nat('show me the commands')
  assert.equal(sent().at(-1).text, helpCommandsTelegram())
  chat.noSurprises()
  chat.ai.script(CHAT, brain({ intent: 'question', reply: 'Sure: 17:00 maths, then physics.' }))
  await chat.nat('help me plan tonight')
  assert.notEqual(sent().at(-1).text, HELP)
  chat.noSurprises()
})

test('H4: every command the full list names is a real one (none falls back to the help reply)', { skip }, async () => {
  const { HELP } = await import('../lib/telegram/bot.ts')
  const { HELP_COMMANDS } = await import('../lib/help.ts')
  const cmds = HELP_COMMANDS.flatMap((g) => g.commands.map((c) => c.command)).filter((c) => !['help', 'start', 'ask'].includes(c))
  const answered = async (text) => {
    chat.tg.clear()
    await chat.nat(text)
    const out = sent()
    if (process.env.SHOW) console.log(`${text} →`, out.map((m) => m.text.slice(0, 90).replace(/\n/g, ' ⏎ ')).join(' ‖ '))
    assert.ok(out.length, `${text} answered`)
    assert.ok(out.every((m) => m.text !== HELP), `${text} fell through to the help reply: it isn’t a real command`)
  }
  for (const c of cmds) await answered(`/${c}`)
  // /ask goes to the brain as a question
  chat.ai.script(CHAT, brain({ intent: 'question', reply: 'Thursday after 16:00.' }))
  await answered('/ask when am I free Thursday?')
  chat.noSurprises()
})

test('H5: “help” while a card waits → the guide, and the card is still there to ✅', { skip }, async () => {
  const { HELP } = await import('../lib/telegram/bot.ts')
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Okay.', actions: [act({ value: 'endOfDayAt=21:30', words: 'evening message at 21:30' })] }))
  await chat.nat('evening message at 21:30 please')
  const card = sent().at(-1)
  const apply = chat.button(card, 'Apply')
  assert.ok(apply, 'a ✅ card')
  await chat.nat('help')
  assert.equal(sent().at(-1).text, HELP)
  await chat.tap(apply, card.message_id)
  const [{ planning }] = await chat.q(`select planning from profiles where user_id = $1`, [chat.users.owner])
  assert.equal(planning?.endOfDayAt, '21:30', 'the card still applied after the help reply')
  chat.noSurprises()
})
