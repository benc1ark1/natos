// Queue item 3, plain tests (free, no database, no AI): which messages may take the quick path and which go straight to
// the full brain (triage), the checks on the quick router's answer (checkRoute), the meter's prices for the router's
// model, the /ideas block, and the background writes. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { triage, checkRoute, botAsked, routeMessage, ROUTE_SCHEMA, ROUTE_PROMPT, QUICK_VIEWS, DECISION_SCHEMA, checkDecision } from '../lib/telegram/brain.ts'
import { costOf, ROUTE_MODEL, ROUTE_EFFORT } from '../lib/ai/models.ts'
import { ideasBlock } from '../lib/telegram/ideas.ts'
import { soon, flushWrites, runTimed, markPath, markReply, timingOf } from '../lib/telegram/speed.ts'

const TODAY = '2026-10-19'   // a Monday

// ---------------------------------------------------------------- triage: router or straight to the brain

test('simple messages may go to the quick router: thanks, greetings, list questions, obvious new items', () => {
  for (const m of ['thanks', 'ok cool', 'cheers mate', 'hi', 'good morning', 'lol', '👍',
    'what’s due this week?', 'whats coming up', 'any deadlines soon?', 'show me my inbox pls',
    'physics homework due Fri', 'maths homework due friday', 'maths test next thursday', 'email Mr Khan about the trip',
    'remind me to call grandma sunday', 'remind me to call grandma at 6pm', 'can you add physics homework due fri',
    'idea: a revision playlist', 'https://example.com/vectors', 'phyiscs hw due fri']) {
    assert.equal(triage(m, { cardOpen: false }), 'router', m)
  }
})

test('changes, events, advice, feelings, training, scores and colours go straight to the brain (no router call)', () => {
  for (const m of ['always flag emails from @ucs.org.uk teachers', 'move physics homework to tomorrow', 'done with the SMC paper', 'did upper', 'finished Bicen chapter 3',
    'cancel football wed', 'no football wednesday', 'rename CS tutor to Computing tutor', 'make it thursday',
    'dentist tuesday 3pm', 'football wed 7:45', 'out with friends tomorrow 2-9pm', 'family dinner sat 7pm',
    'what should I do tonight?', 'why is lower on thursday?', 'am I behind?', 'do I have time for the SMC paper?',
    'how many sessions this week', 'I’m wrecked', 'feeling ill today', 'plan my evening',
    'matrices 🟢', 'PC1-01 green 🟢', 'did Bicen matrices set 8/10', 'HT2 practice 38/45', 'bench 80x5x3', 'squat 100 5x5',
    'ACT practice: E33 M35 R34', 'mistake: PC1-03 Q3b assumed through origin – knowledge', 'nothing after 10pm',
    'pause getting ahead until 25 Oct', 'connect strava', 'sync my calendar']) {
    assert.equal(triage(m, { cardOpen: false }), 'brain', m)
  }
})

test('never the router while a card waits (his message may change it), for /ask, or for long and multi-line messages', () => {
  assert.equal(triage('thanks', { cardOpen: true }), 'brain')
  assert.equal(triage('physics homework due Fri', { cardOpen: true }), 'brain')
  assert.equal(triage('what’s due this week?', { cardOpen: false, forceQuestion: true }), 'brain')
  assert.equal(triage('/ask what is due', { cardOpen: false }), 'brain')
  assert.equal(triage('physics homework due Fri\nmaths homework due Mon', { cardOpen: false }), 'brain')
  assert.equal(triage(`physics homework ${'very '.repeat(40)}long`, { cardOpen: false }), 'brain')
  assert.equal(triage('', { cardOpen: false }), 'brain')
})

// ---------------------------------------------------------------- checkRoute: the router's answer, checked in plain code

const check = (raw, message) => checkRoute({ route: 'brain', reply: '', show: '', show_arg: '', item_text: '', what: '', ...raw }, { message, today: TODAY })

test('chat: a short reply to plain chat; anything that looks like a request goes to the brain', () => {
  assert.deepEqual(check({ route: 'chat', reply: 'Any time.' }, 'thanks'), { route: 'chat', reply: 'Any time.' })
  assert.deepEqual(check({ route: 'chat', reply: 'Morning!' }, 'good morning'), { route: 'chat', reply: 'Morning!' })
  assert.equal(check({ route: 'chat', reply: '' }, 'thanks').route, 'brain', 'no reply')
  assert.equal(check({ route: 'chat', reply: 'x'.repeat(201) }, 'thanks').route, 'brain', 'too long')
  assert.equal(check({ route: 'chat', reply: 'Sure.' }, 'what is my plan for today then').route, 'brain', 'not chat')
  assert.equal(check({ route: 'chat', reply: 'Sure.' }, 'ok 2 more things').route, 'brain', 'numbers: not chat')
})

test('list: only the exact lists; a day for "free" (a bad or past date is today); "project" needs the brain', () => {
  assert.deepEqual(check({ route: 'list', show: 'week' }, 'what’s due this week?'), { route: 'list', show: { view: 'week', arg: null } })
  assert.deepEqual(check({ route: 'list', show: 'free', show_arg: '2026-10-20' }, 'am i free tmrw'), { route: 'list', show: { view: 'free', arg: '2026-10-20' } })
  assert.deepEqual(check({ route: 'list', show: 'free', show_arg: 'tomorrow' }, 'free time tmrw').show, { view: 'free', arg: TODAY })
  assert.deepEqual(check({ route: 'list', show: 'free', show_arg: '2026-10-01' }, 'free time').show, { view: 'free', arg: TODAY })
  assert.equal(check({ route: 'list', show: 'project' }, 'next on the website').route, 'brain')
  assert.equal(check({ route: 'list', show: '' }, 'what’s due').route, 'brain')
  assert.ok(!QUICK_VIEWS.includes('project'))
})

test('new: an obvious new item; anything pointing back, a question, a change or an event goes to the brain', () => {
  assert.deepEqual(check({ route: 'new', item_text: 'Physics homework due Fri', what: 'homework' }, 'physics homework due Fri'),
    { route: 'new', itemText: 'Physics homework due Fri' })
  assert.equal(check({ route: 'new', item_text: 'Physics homework due Fri', what: '' }, 'physics homework due Fri').route, 'brain', 'no kind')
  assert.equal(check({ route: 'new', item_text: '', what: 'task' }, 'physics homework due Fri').route, 'brain', 'no text')
  assert.equal(check({ route: 'new', item_text: 'Add that too', what: 'task' }, 'add that too').route, 'brain', 'points back')
  assert.equal(check({ route: 'new', item_text: 'Maths homework', what: 'homework' }, 'maths homework as well').route, 'brain', 'as well')
  assert.equal(check({ route: 'new', item_text: 'Physics homework', what: 'homework' }, 'is physics homework due fri?').route, 'brain', 'a question')
  assert.equal(check({ route: 'new', item_text: 'Dentist Tuesday 3pm', what: 'task' }, 'dentist tuesday 3pm').route, 'brain', 'an event')
  assert.equal(check({ route: 'new', item_text: 'ok', what: 'task' }, 'ok thanks').route, 'brain', 'meta')
  assert.equal(check({ route: 'new', item_text: 'Move physics homework', what: 'task' }, 'move physics homework to tomorrow').route, 'brain', 'a change')
})

test('review fixes: a request riding on a greeting, an answer to the assistant’s question, one word or a wordy question are the brain’s', () => {
  for (const m of ['hey buy milk later', 'morning grab my charger', 'yo text mum back', 'hi pick up parcel'])
    assert.equal(check({ route: 'chat', reply: '👍' }, m).route, 'brain', m)
  for (const m of ['hi mate', 'thanks so much', 'morning', 'cheers mate']) assert.equal(check({ route: 'chat', reply: '👍' }, m).route, 'chat', m)
  for (const m of ['thursday', 'homework', 'what’s due next week', 'whats on friday'])
    assert.equal(check({ route: 'new', item_text: m, what: 'task' }, m).route, 'brain', m)
  assert.equal(check({ route: 'list', show: 'week' }, 'what’s due next week').route, 'brain', 'the week list is the next 7 days, not next week')
  assert.equal(check({ route: 'list', show: 'coming' }, 'anything due this term').route, 'brain')
  assert.equal(check({ route: 'list', show: 'week' }, 'anything on this weekend').route, 'list', 'this weekend is in the next 7 days')
  // after the assistant asked something, "yes" / "the physics one" go straight to the brain (no router call)
  const asked = [{ role: 'nat', text: 'move football' }, { role: 'bot', text: 'There’s no football on Wednesday: it’s Thursday 18:00. Did you mean that one?', intent: 'question' }]
  assert.equal(botAsked(asked), true)
  assert.equal(botAsked([{ role: 'bot', text: 'Which one: <b>A</b> or <b>B</b>', intent: 'unclear' }]), true)
  assert.equal(botAsked([{ role: 'bot', text: 'Any time.', intent: 'chat' }]), false)
  assert.equal(botAsked([...asked, { role: 'nat', text: 'yes' }]), false, 'only the message straight after')
  assert.equal(triage('yes', { cardOpen: false, botAsked: true }), 'brain')
  assert.equal(triage('the physics one', { cardOpen: false, botAsked: true }), 'brain')
  assert.equal(triage('thanks', { cardOpen: false, botAsked: false }), 'router')
})

test('brain and unknown routes go to the brain, with the reason', () => {
  assert.deepEqual(check({ route: 'brain' }, 'hmm'), { route: 'brain', why: 'the router chose the brain' })
  assert.equal(check({ route: 'banana' }, 'hmm').route, 'brain')
})

test('the router: a small prompt and schema, today and the next 7 dates, the last messages', () => {
  const m = routeMessage({ message: 'am i free thursday', transcript: '[16:05] Nat: hi', today: TODAY, now: new Date('2026-10-19T15:05:00Z') })
  assert.match(m, /^Today: Mon 19 Oct = 2026-10-19, 16:05 \(Europe\/London\)\. Next days: Tue 20 Oct = 2026-10-20;.*Mon 26 Oct = 2026-10-26\./)
  assert.match(m, /<conversation>\n\[16:05\] Nat: hi\n<\/conversation>/)
  assert.match(m, /<message>am i free thursday<\/message>$/)
  assert.ok(ROUTE_PROMPT.length < 6000, 'the router prompt stays small (a few hundred tokens, cacheable)')
  assert.doesNotMatch(ROUTE_PROMPT, /sixth-form|21:30|Further Maths, SMC, Physics|Vlad|tutor_cs|Owen|PureGym/, 'no facts about him in the prompt (they are his data)')
  assert.deepEqual(ROUTE_SCHEMA.required.sort(), Object.keys(ROUTE_SCHEMA.properties).sort())
  assert.equal(ROUTE_MODEL, 'claude-haiku-5-5')
  assert.equal(ROUTE_EFFORT, 'low')
})

// ---------------------------------------------------------------- the brain's App idea: what's needed

test('the brain says what an App idea needs; checkDecision keeps it only for app_idea', () => {
  assert.ok(DECISION_SCHEMA.required.includes('needs'))
  const ctx = { today: TODAY, weekStart: TODAY, snapshot: 'Now: x', refs: new Map() }
  const base = { reply: '', item_text: '', item_kind: '', plan: [], unsure: '', fact_to_save: '' }
  const d = checkDecision({ ...base, intent: 'app_idea', idea: 'Connect Strava', needs: 'A Strava connection that counts runs' }, ctx, { message: 'connect strava', today: TODAY })
  assert.equal(d.idea, 'Connect Strava')
  assert.equal(d.needs, 'A Strava connection that counts runs')
  assert.equal(checkDecision({ ...base, intent: 'chat', reply: 'Hi', needs: 'x' }, ctx, { message: 'hi', today: TODAY }).needs, null)
  assert.equal(checkDecision({ ...base, intent: 'app_idea', idea: 'X' }, ctx, { message: 'x', today: TODAY }).needs, null, 'none given (old scripted replies)')
})

// ---------------------------------------------------------------- the meter: Haiku 5.5's two rate cards

test('the router’s model is costed at $0.10 / $0.50 per million tokens (prompts over 100K: $0.50 / $2.50)', () => {
  const u = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 }
  assert.ok(Math.abs(costOf('claude-haiku-5-5', u) - (1000 * 0.1 + 200 * 0.5 + 500 * 0.01) / 1e6) < 1e-12)
  const big = { input_tokens: 150_000, output_tokens: 1000 }
  assert.ok(Math.abs(costOf('claude-haiku-5-5', big) - (150_000 * 0.5 + 1000 * 2.5) / 1e6) < 1e-12)
  assert.ok(Math.abs(costOf('claude-sonnet-5-5', big) - (150_000 * 2 + 1000 * 10) / 1e6) < 1e-12, 'one rate card for the others')
})

// ---------------------------------------------------------------- /ideas: one block for Claude Code

test('the /ideas block: a header, each idea numbered with his words, what’s needed and the date, then how to build them', () => {
  const ideas = [
    { id: 'a', request: 'Connect Strava', source_text: 'cn u sync my strava pls', needs: 'A Strava connection that counts runs toward targets', created_at: '2026-10-18T10:00:00Z' },
    { id: 'b', request: 'Rename a calendar event from Telegram', source_text: 'rename CS tutor to Computing tutor', created_at: '2026-10-19T08:00:00Z' },
    { id: 'c', request: 'Do the thing', source_text: 'Do the thing', created_at: '2026-10-19T09:00:00Z' },
  ]
  const { text, shown } = ideasBlock(ideas, TODAY)
  assert.equal(shown, 3)
  assert.equal(text, [
    'Nat OS: App ideas from my Telegram bot (3 open, Mon 19 Oct)',
    '',
    '1. "cn u sync my strava pls" (18 Oct)\n   Needs: A Strava connection that counts runs toward targets',
    '',
    '2. "rename CS tutor to Computing tutor" (19 Oct)\n   Needs: Rename a calendar event from Telegram',
    '',
    '3. "Do the thing" (19 Oct)\n   Needs: not worked out yet: ask me what I meant',
    '',
    'Build these one at a time, in this order: propose a plan for the first one and wait for my "go". When it is built and tested, tell me to send "/ideas done <number>".',
  ].join('\n'))
})

test('the /ideas block fits in one Telegram message (the oldest ideas first, the rest left for later)', () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), request: `Idea ${i}`, source_text: `please make the app do thing number ${i} `.repeat(4), needs: 'Something quite long to build '.repeat(4), created_at: '2026-10-19T08:00:00Z' }))
  const { text, shown } = ideasBlock(many, TODAY)
  assert.ok(shown > 3 && shown < 40, `${shown} shown`)
  assert.ok(text.length <= 3500, `${text.length} characters`)
  assert.match(text, /^Nat OS: App ideas from my Telegram bot \(40 open/)
  assert.match(text, /Build these one at a time/)
})

// ---------------------------------------------------------------- background writes and the turn clock

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('background writes: in order, the reply doesn’t wait for them, flushWrites waits for all; outside a turn they are awaited', async () => {
  const log = []
  const { done } = runTimed(Date.now(), async () => {
    await soon(async () => { await wait(30); log.push('memory 1') })
    await soon(async () => { log.push('memory 2') })
    await soon(async () => { log.push('message number') }, { inOrder: false })
    log.push('reply sent')
  })
  await done
  assert.ok(log.includes('reply sent') && !log.includes('memory 1') && !log.includes('memory 2'), 'the reply didn’t wait for the memory')
  await flushWrites()
  assert.deepEqual(log.filter((x) => x.startsWith('memory')), ['memory 1', 'memory 2'], 'in order')
  assert.ok(log.includes('message number'), 'the order-free one ran too')
  // outside a turn (the 5-minute tick): awaited as before
  await soon(async () => { await wait(10); log.push('tick memory') })
  assert.equal(log.at(-1), 'tick memory')
  // a failing write never throws
  await soon(async () => { throw new Error('db down') })
})

test('the turn clock: first reply and path, as ms since the message arrived', async () => {
  const start = Date.now() - 1000
  const { clock, done } = runTimed(start, async () => {
    markPath('quick')
    await wait(5)
    markReply()
    markReply()   // only the first counts
    markPath('brain')   // the router handed over: the last path wins
  })
  await done
  const t = timingOf(clock)
  assert.equal(t.path, 'brain')
  assert.ok(t.ms_first >= 1000 && t.ms_first <= t.ms_total, JSON.stringify(t))
  markReply()   // outside a turn: nothing to mark, no error
})

// ---------------------------------------------------------------- before supabase/speed.sql: everything still works

/** A stand-in Supabase client: every query is recorded and answered by `answer(table, ops)`. */
function fakeSb(answer) {
  const log = []
  const sb = {
    from(table) {
      const ops = []
      log.push({ table, ops })
      const b = new Proxy({}, {
        get(_, prop) {
          if (prop === 'then') return (ok, no) => Promise.resolve(answer(table, ops)).then(ok, no)
          return (...args) => { ops.push([prop, ...args]); return b }
        },
      })
      return b
    },
  }
  return { sb, log }
}
const MISSING = (col) => ({ data: null, error: { code: 'PGRST204', message: `Could not find the '${col}' column of 'x' in the schema cache` } })

test('before speed.sql: a message’s status is saved without the timing columns (and they aren’t tried again)', async () => {
  const { setStatus } = await import('../lib/telegram/turns.ts')
  const { sb, log } = fakeSb((table, ops) => (ops[0][1].ms_total !== undefined ? MISSING('ms_total') : { data: null, error: null }))
  await setStatus(sb, 1, 'done', 'chat', { ms_total: 900, ms_first: 800, path: 'quick' })
  assert.deepEqual(log.map((x) => Object.keys(x.ops[0][1]).sort()), [['intent', 'ms_first', 'ms_total', 'path', 'status'], ['intent', 'status']])
  await setStatus(sb, 2, 'done', 'chat', { ms_total: 900, ms_first: 800, path: 'quick' })
  assert.deepEqual(Object.keys(log.at(-1).ops[0][1]).sort(), ['intent', 'status'], 'remembered: one try')
  assert.equal(log.length, 3)
  // a real error is still an error
  const broken = fakeSb(() => ({ data: null, error: { code: '23514', message: 'violates check constraint' } }))
  await assert.rejects(setStatus(broken.sb, 3, 'done'), /Couldn’t update the queue/)
})

test('before speed.sql: /speed says to run it; App ideas are saved without "needs" and read without it', async () => {
  const { speedText } = await import('../lib/telegram/turns.ts')
  const { sb } = fakeSb(() => ({ data: null, error: { code: '42703', message: 'column telegram_turns.path does not exist' } }))
  assert.match(await speedText(sb), /run <code>supabase\/speed\.sql<\/code> in Supabase/)

  const { fakeTelegram } = await import('./support/fakes.mjs')
  const tg = await fakeTelegram()
  Object.assign(process.env, { TELEGRAM_BOT_TOKEN: 'test-bot-token', TELEGRAM_API_BASE: tg.url })
  try {
    const { saveIdea, ideasText } = await import('../lib/telegram/ideas.ts')
    const inserts = []
    const old = fakeSb((table, ops) => {
      const insert = ops.find((o) => o[0] === 'insert')?.[1]
      if (table === 'app_ideas' && insert) { inserts.push(insert); return insert.needs ? MISSING('needs') : { data: { id: 'idea-1' }, error: null } }
      if (table === 'app_ideas') return ops.some((o) => o[0] === 'select' && o[1].includes('needs')) ? MISSING('needs') : { data: [{ id: 'idea-1', request: 'Connect Strava', source_text: 'sync strava', created_at: '2026-10-19T08:00:00Z' }], error: null }
      if (table === 'telegram_pending') return { data: { id: 'card-1' }, error: null }
      return { data: null, error: null }
    })
    await saveIdea(old.sb, 7001, 'Connect Strava', 'sync strava', 'A Strava connection')
    assert.deepEqual(inserts, [{ request: 'Connect Strava', source_text: 'sync strava', needs: 'A Strava connection' }, { request: 'Connect Strava', source_text: 'sync strava' }])
    assert.equal(tg.sent().at(-1).text, 'I can’t do that yet — it needs adding in Claude Code. 💡 Saved to your App ideas (/ideas).')
    assert.match(await ideasText(old.sb), /1\. "sync strava" \(19 Oct\)\n {3}Needs: Connect Strava/)
  } finally {
    tg.close()
  }
})
