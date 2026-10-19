// Build O, part 15: the whole system for a full, realistic week, end to end through the bot on the TEST database (a
// scripted AI, a fake Telegram, the clock moved to last week). Monday's first brief brings the gap questions (answered),
// the clean-up card, Owen's days and Your week (✅); then every day's 07:00 brief and pinned Today, ticks, a cancelled
// football session, new homework from Classroom, a teacher email, a low-Whoop morning, "game moved to Saturday", a time
// saving applied, the 21:00 wrap-ups, the Owen days question, and Sunday's reset card for the next week.
// After every step: nothing double-booked, load sensible, messages fit a phone, nothing broke.
// SIM_OUT=qa/WEEK-SIM-transcript.md writes the whole conversation out.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/build-o-weeksim-chat.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { useChat, CHAT, SORT, OWNER_TG } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const KEY = 's'.repeat(64)
before(() => { if (!skip) Object.assign(process.env, { MAIL_SECRET: KEY }) })
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const T = () => chat.time
const sent = () => chat.tg.sent()
const lastOf = (re) => sent().filter((m) => re.test(m.text)).at(-1)
const tapOn = async (m, label) => { const b = chat.button(m, label); assert.ok(b, `no button “${label}” on: ${m?.text?.slice(0, 90)}`); await chat.tap(b, m.message_id) }

// ---- the transcript and the checks after every step
const log = []
let seen = 0
const plainText = (h) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
function collect(when) {
  if (!chat.tg) return
  const all = sent()
  for (const m of all.slice(seen)) {
    const buttons = (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => `[${b.text}]`).join(' ')
    log.push({ when, text: m.text, buttons })
    // reads well on a phone: fits one message, no code leaking into words, no errors
    assert.ok(m.text.length <= 4000, `${when}: a message is too long (${m.text.length})`)
    assert.doesNotMatch(plainText(m.text), /\bundefined\b|\bNaN\b|\[object |\bnull\b/, `${when}: something leaked into a message:\n${m.text}`)
    assert.doesNotMatch(m.text, /⚠️ (?:Something went wrong|Couldn’t|Not saved|Nothing changed|The AI|That didn’t work)|is already|isn’t there any more/, `${when}: an error:\n${m.text}`)
  }
  seen = all.length
}

/** The plan as saved: no two blocks overlap, none sits on a busy event (with its buffer), no day over its load limit. */
async function noDoubleBooking(when) {
  const { loadViewData } = await import('../lib/telegram/views.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const { expandEvents } = await import('../lib/events.ts')
  const { dayLevel } = await import('../lib/day.ts')
  const { moreSettings } = await import('../lib/settings.ts')
  const sb = await openOwnerSession()
  const rows = await q(`select on_date::text d, start_time::text s, end_time::text e, title, kind, status from plan_blocks where status in ('planned','done') order by on_date, start_time`)
  const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  for (const d of [...new Set(rows.map((r) => r.d))]) {
    const day = rows.filter((r) => r.d === d)
    for (let i = 1; i < day.length; i++) assert.ok(m(day[i].s) >= m(day[i - 1].e), `${when}: ${day[i - 1].title} and ${day[i].title} overlap on ${d}`)
    const v = await loadViewData(sb, d)
    for (const o of expandEvents(v.events, d, d, v.changes).filter((o) => o.date === d && !o.cancelled && o.event.is_busy && o.start && o.end)) {
      for (const b of day) assert.ok(m(b.e) <= m(o.start) || m(b.s) >= m(o.end), `${when}: ${b.title} ${b.s} sits on ${o.event.title} ${o.start}–${o.end} (${d})`)
    }
    const lv = dayLevel({ date: d, planning: v.planning, events: v.events, changes: v.changes, goals: v.goalsLite, tasks: v.tasks, blocks: day.map((b, i) => ({ id: String(i), start_time: b.s.slice(0, 5), end_time: b.e.slice(0, 5), title: b.title, kind: b.kind, task_id: null, status: b.status })), costs: v.costs })
    assert.ok(lv.physicalTotal <= moreSettings(v.planning).dayMaxLoad * 1.2, `${when}: ${d} load ${lv.physicalTotal} is far over the day limit`)
  }
}

const setAt = async (date, hhmm) => { const { setClock } = await import('./support/clock.mjs'); setClock(T().zonedToUTC(date, hhmm)) }
const tick = async (label) => {
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  await runTick(await openOwnerSession(), OWNER_TG, new Date())
  collect(label)
}
const refIn = (body, re) => { const t = body.messages[0].content.map((x) => x.text).join('\n'); const m = t.match(re); assert.ok(m, `no ref ${re} in the snapshot`); return m[1] }
const act = (o) => ({ op: 'setting', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })

after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })

test('O15: a whole week through the bot, Monday’s first brief to Sunday’s reset', { skip, timeout: 900_000 }, async () => {
  const today = T().todayISO()
  const mon = T().addDays(T().weekStartISO(today), -7)   // last week: the clock only goes back
  const D = (i) => T().addDays(mon, i)
  const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // ---- his real week shape (11 Oct): own school + tutors, Google sessions, targets, homework, a mock on Thursday
  const from = T().addDays(mon, -21)
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', repeat_from: from, is_school: true })
  await add('events', { title: 'CS tutor', repeat_days: [1, 4], start_time: '17:30', end_time: '18:30', repeat_from: from })
  await add('events', { title: 'Maths tutor', repeat_days: [3], start_time: '17:00', end_time: '18:00', repeat_from: from })
  const g = (title, i, s, e, w, id, o = {}) => add('events', { title, starts_at: T().zonedToUTC(T().addDays(D(i), 7 * w), s), ends_at: T().zonedToUTC(T().addDays(D(i), 7 * w), e), external_source: 'google', external_id: `${id}-${w}`, calendar_id: 'cal1', ...o })
  for (const w of [-2, -1, 0, 1]) {
    await g('EFA training', 6, '08:30', '10:00', w, 'efa')
    await g('EFA football', 1, '17:30', '19:00', w, 'efaf')
    await g('Market Road football', 4, '18:30', '20:00', w, 'mrf')
    await g('Games', 2, '14:20', '15:55', w, 'games')
  }
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 3 })
  await add('weekly_targets', { name: 'Lower + plyo', target_count: 2 })
  const phys = (await q(`select id from subjects where user_id = $1 and name = 'Physics'`, [chat.users.owner]))[0].id
  const hw = await add('tasks', { title: 'Physics homework', status: 'this_week', importance: 'must', due_at: `${D(2)}T12:00:00Z`, duration_minutes: 45, subject_id: phys })
  const smc = await add('tasks', { title: 'SMC past paper', status: 'this_week', importance: 'must', due_at: `${D(4)}T12:00:00Z`, duration_minutes: 60 })
  await add('goals', { title: 'Physics mock', kind: 'test', target_date: D(3), subject_id: phys, priority: 'high' })
  await q(`delete from telegram_sent where key like 'onboard:%' or key = 'gaps:paused'`)

  // =============== Monday 07:00: the first brief, then the questions, the clean-up, Owen, Your week
  await setAt(D(0), '07:00')
  chat.ai.script(PLAN, (body) => ({ days: [
    { date: D(0), items: [{ ref: refIn(body, /(T\d+) \| Physics homework/), title: '', minutes: 45, kind: 'focus', focus: '', why: 'due Wed' }] },
    { date: D(1), items: [{ ref: refIn(body, /(T\d+) \| SMC past paper/), title: '', minutes: 60, kind: 'focus', focus: '', why: 'due Fri' }] },
    { date: D(2), items: [{ ref: refIn(body, /(G\d+) \| TEST: Physics mock/), title: '', minutes: 40, kind: 'focus', focus: 'forces', why: 'mock Thu' }] },
  ], note: 'Homework first, mock prep Wednesday.', push_back: '' }))
  await tick('Mon 07:00')
  await setAt(D(0), '07:05')
  await tick('Mon 07:05')   // the week card comes on its own tick
  const brief = sent().find((m) => m.text.startsWith('☀️'))
  assert.match(brief.text, /📋 <b>Your day<\/b>/)
  assert.ok(lastOf(/🧹 <b>Calendar clean-up<\/b>/) && lastOf(/🗓 <b>Days to give Owen<\/b>/) && lastOf(/🗓 <b>Your week<\/b>/), 'the morning queue')
  chat.noSurprises()

  // the gap questions: tap or type each, the next follows by itself
  const answer = async (re, how) => {
    const m = lastOf(re)
    assert.ok(m, `no question ${re}`)
    if (how.tap) await tapOn(m, how.tap)
    else await nat(how.type)
    collect(`Mon 07:0x answer ${re}`)
  }
  await answer(/Your game this week: Sun as usual/, { tap: '✓ Sun as usual' })
  await answer(/Football training on Mon and Wed: what time\?/, { tap: '19:00–20:30' })
  await answer(/What is “Games”/, { tap: 'Light (PE, a kickabout)' })
  await answer(/What time do you wake up on school days\?/, { type: '6:50' })
  await answer(/Bedtime on school nights\?/, { tap: '22:30' })
  const p0 = (await q(`select planning from profiles where user_id = $1`, [chat.users.owner]))[0].planning
  assert.equal(p0.wakeAt, '06:50')
  assert.equal(p0.bedAt, '22:30')
  assert.ok((await q(`select 1 from events where title = 'Football training' and archived_at is null`)).length, 'football is in Life OS now')
  // after the round: the week again, re-planned with his answers
  const replanned = lastOf(/🔄 <b>Your week, re-planned with your answers<\/b>/)
  assert.ok(replanned, 'the week card again after the questions')
  assert.match(replanned.text, /19:00 Football training/)
  // and Owen's days again (football Mon + Wed changes them); the first card's buttons are gone
  const owenAgain = lastOf(/🔄 <b>Days to give Owen, with your answers<\/b>/)
  assert.ok(owenAgain, 'the Owen days card again after the questions')
  assert.match(owenAgain.text, /Football training Mon/)
  assert.equal((await q(`select count(*)::int n from telegram_pending where text = 'Owen’s days' and status = 'open'`))[0].n, 1, 'one Owen card waiting')
  chat.noSurprises()

  // the clean-up: EFA training pre-set to Archive; Owen's days; Your week ✅
  await tapOn(lastOf(/🧹 <b>Calendar clean-up<\/b>/), '✅ Apply')
  collect('Mon 07:10 clean-up')
  await tapOn(lastOf(/Days to give Owen/), '✅ Use these days')
  collect('Mon 07:11 Owen')
  // Owen's days changed the open week card: the newest one is the one to apply
  await tapOn(lastOf(/🗓 <b>Your week<\/b>/), '✅ Apply')
  collect('Mon 07:12 apply the week')
  assert.match(lastOf(/Your week is set/).text, /training sessions? and \d+ study blocks?/)
  await noDoubleBooking('after applying the week')
  const p1 = (await q(`select planning from profiles where user_id = $1`, [chat.users.owner]))[0].planning
  assert.deepEqual(p1.ignoredSessions, ['EFA training'])
  assert.ok(p1.owenDays?.speed?.length, 'Owen’s days saved')

  // =============== each day: brief, ticks, the day's event, 21:00 wrap-up
  const blocksOn = (d) => q(`select id, title, kind, start_time::text s, status from plan_blocks where on_date = $1 and status in ('planned','done') order by start_time`, [d])
  const tickDone = async (d, filter) => {
    const pin = sent().filter((m) => m.text.startsWith('📌')).at(-1)
    for (const b of (await blocksOn(d)).filter((x) => x.status === 'planned').filter(filter)) {
      await chat.tap(`k:${b.id}`, pin?.message_id ?? 1)
    }
    collect(`${d} ticks`)
  }
  let lowDone = false
  for (let i = 0; i < 7; i++) {
    const d = D(i)
    // a low-Whoop morning: the first day from Thursday that has hard training planned
    let low = false
    if (i >= 3 && !lowDone && (await blocksOn(d)).some((b) => b.kind === 'training' && b.status === 'planned' && !/· light|Stretching|Core/.test(b.title))) {
      await add('whoop_days', { on_date: d, recovery: 25, sleep_minutes: 380 })
      low = lowDone = true
    }
    if (i > 0) { await setAt(d, '07:00'); await tick(`${day[i]} 07:00`) }
    if (low) {
      assert.match(sent().filter((m) => m.text.startsWith('☀️')).at(-1).text, /🔴 .*25%[\s\S]*Low recovery: lighter training today/)
      const card = lastOf(/↪️ <b>Re-planned for your 25% recovery<\/b>/)
      assert.ok(card, `${day[i]}: a card to move today’s hard session`)
      await tapOn(card, '✅ Move')
      collect(`${day[i]} 07:01 low Whoop`)
      await noDoubleBooking('after the low-Whoop move')
    }
    const b = sent().filter((m) => m.text.startsWith('☀️')).at(-1)
    assert.match(b.text, new RegExp(`☀️ <b>${T().longDate(d)}</b>`), `${day[i]}: the brief`)

    if (i === 1) {
      // Tuesday: football cancelled tomorrow (his own session now), and new homework from Classroom
      await setAt(d, '12:30')
      // (item 4: the life plug-in reads this one itself, no AI: "football" → Football training, tomorrow's session)
      await nat('football is cancelled tomorrow')
      collect('Tue 12:30 cancel football')
      await tapOn(lastOf(/Football training<\/b>.*→ cancelled/), '✅ Apply')
      collect('Tue 12:31 apply')
      await setAt(d, '16:20')
      const hw2 = await add('tasks', { title: 'Maths sheet', status: 'this_week', importance: 'must', due_at: `${D(3)}T12:00:00Z`, duration_minutes: 30, source: 'import' })
      const { offerSlot } = await import('../lib/telegram/dayplan.ts')
      const { loadViewData } = await import('../lib/telegram/views.ts')
      const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
      const sb = await openOwnerSession()
      const t = (await q(`select * from tasks where id = $1`, [hw2.id]))[0]
      await offerSlot(sb, OWNER_TG, { ...t, due_at: t.due_at.toISOString(), created_at: t.created_at.toISOString() }, await loadViewData(sb, d))
      collect('Tue 16:20 new homework')
      const offer = lastOf(/➕ Fit <b>Maths sheet<\/b>/)
      assert.ok(offer, 'a slot offered before Thursday')
      await tapOn(offer, '✅ Add')
      collect('Tue 16:21 add')
    }
    if (i === 2) {
      // Wednesday: a teacher emails homework
      await setAt(d, '16:30')
      const { receiveMail } = await import('../lib/mail/incoming.ts')
      await receiveMail(`Bearer ${KEY}`, JSON.stringify({ account: 'school', address: 'nat@ucs.org.uk', messages: [{ id: 'm1', thread: 't-m1', from: 'Ms Patel <patel@ucs.org.uk>', subject: 'Reading for Friday', snippet: 'Please read chapter 5 of the textbook before Friday’s lesson', received: new Date(Date.now() - 600_000).toISOString(), labels: ['CATEGORY_PERSONAL'], automated: false }] }))
      chat.ai.script(SORT, { emails: [{ n: 1, kind: 'homework', summary: 'Read chapter 5 before Friday', event_title: '', event_date: '', event_start: '', event_end: '', date_words: '' }] })
      chat.ai.script(SORT, sorted({ kind: 'task', title: 'Read chapter 5', subject: 'Physics', importance: 'must', due_date: D(4), date_words: 'Friday', duration_minutes: 30, origin: 'school' }))
      const { processMail } = await import('../lib/mail/watcher.ts')
      const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
      await processMail(await openOwnerSession(), OWNER_TG)
      collect('Wed 16:30 email')
      await tapOn(lastOf(/📧 <b>Ms Patel<\/b>/), '✅ Save')
      collect('Wed 16:31 save')
      const fit = lastOf(/➕ Fit <b>Read chapter 5<\/b>/)
      if (fit) { await tapOn(fit, '✅ Add'); collect('Wed 16:32 add') }
      chat.noSurprises()
    }
    if (i === 3) {
      // Thursday: "game moved to Saturday"
      await setAt(d, '12:30')
      chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Game on Saturday this week.', actions: [act({ op: 'game_week', value: `date=${D(5)}; leave=09:00; back=15:00`, words: 'Saturday' })] }))
      await nat('game moved to Saturday, leave 9 back 3')
      collect('Thu 12:30 game moved')
      await tapOn(lastOf(/⚽ Game, week of/), '✅ Apply')
      collect('Thu 12:31 apply')
      const moved = lastOf(/↪️ <b>Re-planned with that change<\/b>/)
      if (moved && chat.button(moved, '✅ Move')) { await tapOn(moved, '✅ Move'); collect('Thu 12:32 moved') }
      await noDoubleBooking('after the game moved')
    }
    if (i === 4) {
      // Friday: a time saving applied; the Owen days question
      await setAt(d, '16:40')
      await nat('where can I save time?')
      collect('Fri 16:40 savings')
      const s = lastOf(/⏱ <b>Where you can save time this week<\/b>/)
      if (chat.button(s, '✅ Apply 1')) { await tapOn(s, '✅ Apply 1'); collect('Fri 16:41 applied') }
      await nat('which days should I give Owen?')
      collect('Fri 16:42 Owen')
      assert.match(lastOf(/Days to give Owen/).text, /<code>Hi Owen, /)
      chat.noSurprises()
    }
    // the day: tick the training, leave the study (it rolls over at 21:00)
    await setAt(d, '20:00')
    await tickDone(d, (x) => x.kind === 'training')
    await setAt(d, '21:05')
    await tick(`${day[i]} 21:05`)
    const wrap = lastOf(/🌙 <b>Today, wrapped up<\/b>/)
    if (wrap && log.at(-1)?.text === wrap.text && chat.button(wrap, '✅ Move')) { await tapOn(wrap, '✅ Move'); collect(`${day[i]} 21:06 move`) }
    await noDoubleBooking(`${day[i]} night`)
  }

  assert.ok(lowDone, 'a low-Whoop morning happened')

  // =============== Sunday 18:00: the reset card for the coming week
  chat.ai.script(PLAN, () => ({ days: [], note: 'Light week of study.', push_back: '' }))
  await setAt(D(6), '18:05')
  await tick('Sun 18:05')
  const reset = lastOf(/🗓 <b>Your week<\/b> · Mon/)
  assert.ok(reset, 'Sunday’s card')
  assert.match(reset.text, /✅ <b>Last week<\/b>: \d+\/\d+ sessions done/, 'starts with how last week went')
  assert.match(reset.text, new RegExp(`Your week</b> · Mon ${+T().addDays(mon, 7).slice(8)} `), 'for the coming week')
  await tapOn(reset, '✅ Apply')
  collect('Sun 18:06 apply next week')
  chat.noSurprises()

})

after(() => {
  // the conversation, written out even if a step failed (to see where)
  collect('end')
  if (process.env.SIM_OUT) writeFileSync(process.env.SIM_OUT, ['# Whole-week simulation: the transcript', '', 'Generated by tests/build-o-weeksim-chat.test.mjs: every message the bot sent, in order, as plain text (buttons in brackets).', '',
    ...log.map((x) => `### ${x.when}\n\n\`\`\`\n${plainText(x.text)}${x.buttons ? `\n${x.buttons}` : ''}\n\`\`\`\n`)].join('\n'))
})
