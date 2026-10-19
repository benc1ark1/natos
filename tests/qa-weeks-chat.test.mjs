// Final QA (queue "TESTING"): a simulated HALF-TERM week and a simulated SCHOOL week with realistic data, every day run
// through the real 07:30 / holiday-wake morning tick (= Today), ticked like he would, and the 21:00 evening tick.
// Realistic data: school + club football + school football events, Classroom-like homework, 2–4 tests (one within 3
// weeks), tracker topics in several colours, mistakes due, the STEP programme, ACT on a countdown (set up and dated by
// chat), Owen's fixed days, upper 2×, a game (Saturday in the school week), a family dinner and a day out.
// Each day's plan is checked against every rule: homework first · ACT countdown every day · Owen's days · upper 2× and
// ≥ 48 h apart · no heavy lower / plyo the day before a game · 3–5 items (his setting) · nothing inside an event ·
// holiday wake time on half-term days · a tick moves it forward · what isn't ticked rolls on.
// No AI anywhere (c.noSurprises()). SHOW=1 prints every morning message.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/qa-weeks-chat.test.mjs
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, OWNER_TG } from './support/chat.mjs'

const chat = useChat()
const skip = chat.skip
const q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const T = () => chat.time
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const sent = () => chat.tg.sent()
const lastOf = (re) => sent().filter((m) => re.test(m.text)).at(-1)
const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const setAt = async (date, hhmm) => { const { setClock } = await import('./support/clock.mjs'); setClock(T().zonedToUTC(date, hhmm)) }
const session = async () => (await import('../lib/telegram/owner-session.ts')).openOwnerSession()
const tick = async () => (await import('../lib/telegram/tick.ts')).runTick(await session(), OWNER_TG, new Date())
const tapOn = async (m, label) => { const b = chat.button(m, label); assert.ok(b, `no button “${label}” on: ${m?.text?.slice(0, 90)}`); await chat.tap(b, m.message_id) }
const subject = async (name) => (await q(`select id from subjects where user_id = $1 and name = $2`, [chat.users.owner, name]))[0].id
const show = (label, m, plan) => { if (process.env.SHOW) console.log(`
---- ${label}
${m.text}
keys: ${plan.items.map((x) => `${x.key.replace(/[0-9a-f-]{36}/, '…')} [${x.title} · ${x.why}]`).join(' | ')}
hidden: ${plan.hidden.map((x) => x.key.replace(/[0-9a-f-]{36}/, '…')).join(' | ')}`) }
/** The planner's tier for a Today item, from its key (plans/contracts.md §3.1). */
const tierOf = (key) => key.startsWith('task:') ? 1 : key === 'act:flashcards:daily' ? 7 : key.startsWith('test:') || key.startsWith('act:') ? 2 : key.startsWith('mistakes:') && key.endsWith(':tests') ? 2 : key.startsWith('mistakes:') || key.endsWith(':review') ? 3 : key.endsWith(':fix') ? 4 : key.endsWith(':ahead') ? 5 : key.endsWith(':stretch') ? 6 : 7
let checks = 0
const check = (ok, msg) => { checks++; assert.ok(ok, msg) }
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null); if (process.env.SHOW) console.log(`\n${checks} rule checks`) })

/**
 * His world for a week starting `mon` (a Monday in the past). `half`: a half-term week (holidays cover it).
 * Returns what the checks need.
 */
async function world(mon, { half, game, upperFixed, todayItems }) {
  const D = (i) => T().addDays(mon, i)
  const from = T().addDays(mon, -28)
  const own = chat.users.owner
  const [maths, fm, phys] = [await subject('Maths'), await subject('Further Maths'), await subject('Physics')]
  // ---- the calendar (Life OS + school): school days, club football Mon/Wed, school football Tue, a dinner, a day out
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', repeat_from: from, is_school: true })
  await add('events', { title: 'Club football', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', repeat_from: from, training_type: 'football', load: 'hard' })
  await add('events', { title: 'School football', repeat_days: [2], start_time: '16:00', end_time: '17:00', repeat_from: from, training_type: 'football', load: 'moderate', is_school: true })
  const one = (title, i, s, e, o = {}) => add('events', { title, starts_at: T().zonedToUTC(D(i), s), ends_at: T().zonedToUTC(D(i), e), ...o })
  const events = [
    await one('Family dinner', 5, '19:00', '21:00'),
    ...(half ? [await one('Out with friends', 2, '14:00', '21:00')] : [await one('Dentist', 3, '16:30', '17:15')]),
  ]
  // ---- planning: holidays, wake times, his Today size, Owen's fixed days, upper, the game
  const owenDays = { speed: [2], heavy_lower: [4], injury: [5], core: [6], ...(upperFixed ? { upper: upperFixed } : {}) }
  const planning = {
    holidays: half ? `${T().addDays(mon, -2)}..${D(6)}` : 'none', holidayWakeAt: '09:00', todayItems,
    owenDays, ...(game ? { gameWeeks: { [mon]: { date: game.date, leave: game.leave, back: game.back } } } : {}),
  }
  await q(`update profiles set planning = $1 where user_id = $2`, [planning, own])
  await add('weekly_targets', { name: 'Upper', target_count: 2 })
  await add('weekly_targets', { name: 'Lower + plyo', target_count: 1 })

  // ---- tracker: topics in every colour, taught / next up / later, in school order
  const T0 = async (i, subj, code, name, o = {}) => (await add('topics', { subject_id: subj, name, code, sort_order: i, status: 'not_started', step: 0, ...o }))
  const topics = {
    proof: await T0(1, maths, 'Y1-01', 'Proof', { taught_from: D(-50), status: 'exam_ready', step: 5, last_done: D(-20) }),
    poly: await T0(2, maths, 'Y1-04', 'Polynomials', { taught_from: D(-35), status: 'understand', step: 3, last_done: D(-4) }),
    logs: await T0(3, maths, 'Y1-07', 'Logarithms', { taught_from: D(-10), status: 'not_secure', step: 2, last_done: D(-2) }),
    trig: await T0(4, maths, 'Y1-10', 'Trigonometric functions', { taught_from: D(9) }),
    diff: await T0(5, maths, 'Y1-13', 'Differentiation', { taught_from: D(40) }),
    matrices: await T0(6, fm, 'PC1-01', 'Matrices', { taught_from: D(-40), status: 'not_secure', step: 3, last_done: D(-3), bicen: 'Bicen Core Pure → CP1: Matrices' }),
    vectors: await T0(7, fm, 'PC1-02', 'Further vectors', { taught_from: D(-25), status: 'understand', step: 2, last_done: D(-6) }),
    roots: await T0(8, fm, 'PC1-03', 'Roots of polynomials', { taught_from: D(-12) }),
    counting: await T0(9, fm, 'FS-01', 'Counting principles', { taught_from: D(14) }),
    kin: await T0(10, phys, 'P1.1', 'Kinematics', { taught: 'yes', status: 'understand', booklet: 'todo', pmt: 'todo', last_done: D(-3) }),
    forces: await T0(11, phys, 'P1.2', 'Forces', { taught: 'yes', status: 'not_secure', booklet: 'doing', last_done: D(-5) }),
    waves: await T0(12, phys, 'P7.1', 'Progressive waves', { taught: 'in_class' }),
  }
  // ---- tests: one within 3 weeks, one just outside (comes in during the week), a consolidation with minutes a day
  const tests = {
    ht2: await add('goals', { title: 'FM HT2 test', kind: 'test', target_date: D(half ? 17 : 10), subject_id: fm, test_kind: 'test', topic_codes: ['PC1-01', 'PC1-02', 'PC1-03'], marks: 45, length_min: 50, info: '50 min · ~45 marks · calculator' }),
    mech: await add('goals', { title: 'Physics mechanics test', kind: 'test', target_date: D(half ? 30 : 25), subject_id: phys, test_kind: 'test', topic_codes: ['P1.1', 'P1.2'], limits: 'no momentum' }),
    cons: await add('goals', { title: 'FM HT1 consolidation', kind: 'test', target_date: D(half ? 21 : 13), subject_id: fm, test_kind: 'consolidation', topic_codes: ['PC1-01'], minutes_per_day: 30, minutes_max: 60 }),
  }
  // ---- mistakes due (one today, one later in the week)
  await add('mistakes', { topic_id: topics.roots.id, subject_id: fm, code: 'PC1-03', question: 'Q3b', body: 'assumed it went through the origin', kind: 'knowledge', logged_on: D(-3), review_on: D(0), redo_stage: 0 })
  await add('mistakes', { topic_id: topics.poly.id, subject_id: maths, code: 'Y1-04', question: 'Q5', body: 'sign error expanding', kind: 'careless', logged_on: D(-5), review_on: D(3), redo_stage: 1 })
  // ---- STEP: 28 items, 1 a week at the weekend, the first two done
  const step = await add('programmes', { name: 'STEP', per_week: 1, days: 'weekend', minutes: 75 })
  for (let i = 1; i <= 28; i++) await add('programme_items', { programme_id: step.id, position: i, title: i <= 25 ? `STEP Support – Assignment ${i}` : `Mixed STEP 1 questions ${i - 25}`, status: i <= 2 ? 'done' : 'todo', done_on: i <= 2 ? D(-14 + i * 7) : null })
  // ---- homework from Classroom (school, imported: the assignment's own name), and a tutor's sheet
  const hw = [
    await add('tasks', { title: 'Forces worksheet', status: 'this_week', importance: 'must', origin: 'school', source: 'import', external_id: 'classroom:hw1', subject_id: phys, due_at: T().zonedToUTC(D(2), '08:45'), duration_minutes: 45, details: 'Worksheet 4, Q1–10 · Physics 12B', hand_in: 'Google Classroom' }),
    await add('tasks', { title: 'Ex 3C logarithms', status: 'this_week', importance: 'must', origin: 'school', source: 'import', external_id: 'classroom:hw2', subject_id: maths, due_at: T().zonedToUTC(D(4), '08:45'), duration_minutes: 40, details: 'Book 1, Ex 3C every other question · Maths 12M', hand_in: 'Google Classroom' }),
    await add('tasks', { title: 'FM homework: matrices sheet', status: 'this_week', importance: 'must', origin: 'tutor', subject_id: fm, due_at: T().zonedToUTC(D(8), '17:00'), duration_minutes: 30 }),
  ]
  return { D, topics, tests, hw, events, step }
}

/** ACT by chat: "set up ACT" ✅, the last practice, "ACT retake is <date>" ✅ (countdown). */
async function actByChat(retake) {
  await chat.nat('set up ACT')
  await tapOn(lastOf(/ACT set-up/), 'Apply')
  assert.ok(lastOf(/✅ <b>Done<\/b>/), 'ACT set up')
  await chat.nat(`ACT retake is ${T().shortDate(retake)}`)
  await tapOn(lastOf(/ACT retake: <b>/), 'Apply')
  assert.ok(lastOf(/🔥 Countdown/), 'countdown on')
}

/** Every busy occurrence on a day (his events, school unless a holiday, the game), as minute ranges. */
async function busyOn(date) {
  const { loadViewData } = await import('../lib/telegram/views.ts')
  const { expandEvents } = await import('../lib/events.ts')
  const { holidayChanges } = await import('../lib/today/holidays.ts')
  const { planningEvents } = await import('../lib/setup.ts')
  const v = await loadViewData(await session(), date)
  const changes = holidayChanges(v.events, v.changes, v.planning, date, date)
  const evs = planningEvents(v.events, changes, v.planning, date, date)
  return expandEvents(evs, date, date, changes).filter((o) => o.date === date && !o.cancelled && o.event.is_busy && o.start && o.end)
    .map((o) => ({ title: o.event.title, s: mins(o.start), e: mins(o.end), school: !!o.event.is_school }))
}

/** ACT's picks for a day, as the planner gets them (lib/act/engine.ts actPicks). */
async function actPicksOn(date, mode) {
  const { loadActWorld } = await import('../lib/act/data.ts')
  const { actPicks } = await import('../lib/act/engine.ts')
  return actPicks(await loadActWorld(await session(), date), { date, dow: T().isoDow(date), mode, studyMinutes: 240 })
}

/** The day as Today shows it (the saved list, structured) and the morning message. */
async function todayOf(date) {
  const { loadToday } = await import('../lib/today/load.ts')
  return (await loadToday(await session(), { date })).plan
}

/**
 * One whole week: each morning's tick, the rule checks, ticks (the first study item + the training; the rest left), the
 * evening tick; the next morning checks that what was left rolled on.
 */
async function runWeek(w, o) {
  const { D } = w
  const training = []   // { date, title }
  let leftYesterday = []
  for (let i = 0; i < 7; i++) {
    const d = D(i)
    const holiday = o.half
    if (process.env.SHOW) {
      await setAt(d, '07:00')
      const { loadViewData } = await import('../lib/telegram/views.ts')
      const { loadWorld } = await import('../lib/telegram/ripple.ts')
      const { planTraining } = await import('../lib/week.ts')
      const { holidayChanges } = await import('../lib/today/holidays.ts')
      const sb = await session()
      const wv = await loadWorld(sb, await loadViewData(sb, d), { from: d, to: D(6) })
      const p = planTraining({ ...wv, changes: holidayChanges(wv.events, wv.changes, wv.planning, wv.from, wv.to) })
      console.log(`  week plan from ${d}: ${p.placed.map((x) => `${x.date.slice(5)} ${x.start} ${x.title} ${x.intensity}`).join(' | ')}
  tbc: ${JSON.stringify(p.tbc)} upper: ${JSON.stringify(p.upper)}`)
    }
    // ---- the morning: nothing before his time, then one message
    const before = sent().length
    await setAt(d, '07:30'); await tick()
    if (holiday) {
      check(sent().length === before, `${DAY[i]}: a half-term morning waits for his holiday wake time (nothing at 07:30)`)
      await setAt(d, '09:00'); await tick()
    }
    const m = sent().filter((x) => x.text.startsWith('📌 <b>Today')).at(-1)
    check(m && m.message_id > (sent()[before - 1]?.message_id ?? 0), `${DAY[i]}: the morning message came`)
    check(new RegExp(`📌 <b>Today · ${T().longDate(d)}</b>`).test(m.text), `${DAY[i]}: it is for today`)
    check(holiday ? /· <i>half-term<\/i>/.test(m.text) && !/🏫 School/.test(m.text) : (i < 5) === /🏫 School 08:45–16:00/.test(m.text), `${DAY[i]}: school on the fixed line only on school days`)

    const plan = await todayOf(d)
    show(`${DAY[i]} ${d}${holiday ? ' (half-term)' : ''}`, m, plan)
    const items = plan.items
    const study = items.filter((it) => it.kind !== 'training')
    const max = o.todayItems
    // ---- 3–5 items (his setting); one tap each
    check(items.length <= max, `${DAY[i]}: at most ${max} items (his setting), got ${items.length}`)
    // (a game day has only its evening: 2 is fine there)
    const gameDay = d === (o.game?.date ?? D(6))
    check(items.length >= (gameDay ? 2 : 3), `${DAY[i]}: at least ${gameDay ? 2 : 3} things on a day with this much to do, got ${items.length}`)
    check((m.reply_markup?.inline_keyboard ?? []).flat().length === items.length, `${DAY[i]}: one tap per item`)
    check(items.every((it) => it.kind === 'training' || it.open), `${DAY[i]}: every item says exactly what to open`)
    // ---- homework first: every homework due within 7 days is on Today (never dropped), and it gets the freshest time:
    // nothing at least as long is placed before it (a 10-min redo may use a short gap before it)
    const hwDue = (await q(`select id, title from tasks where archived_at is null and status <> 'completed' and due_at::date <= $1::date + 7 and (origin <> 'own' or title ilike '%homework%')`, [d]))
    for (const h of hwDue) {
      const it = items.find((x) => x.taskId === h.id)
      check(it, `${DAY[i]}: homework “${h.title}” is on Today`)
      if (!it?.at) continue
      // (on a school day: after school — a free half hour before school isn't "fresh")
      const fresh = (x) => holiday || i >= 5 || x.at >= '16:00'
      const earlier = study.filter((x) => x.at && fresh(x) && x.at < it.at && x.minutes >= it.minutes && !hwDue.some((y) => y.id === x.taskId))
      check(!earlier.length, `${DAY[i]}: homework “${h.title}” at ${it.at} comes first, not after ${earlier.map((x) => `${x.at} ${x.title}`)}`)
    }
    // the planner's ACT for the day, tier 2 in its last 21 days; on Today unless homework and other tests fill it.
    // Holidays (19 Oct 2026): 4 h as two blocks: Tue + Thu the full timed test then its review, other days every
    // section timed. School weeks: one session (timed English daily, the mock Tuesday and its review Wednesday).
    const actAll = (await actPicksOn(d, holiday ? 'half_term' : 'school')).filter((p) => p.key !== 'act:flashcards:daily')
    check(actAll.length === (holiday ? 2 : 1), `${DAY[i]}: the ACT countdown's ${holiday ? 'two blocks' : 'one session'} (${actAll.map((p) => p.key)})`)
    const ap = actAll[0]
    const left = T().daysBetween(d, o.retake)
    check(ap.tier === (left <= 21 ? 2 : 7), `${DAY[i]}: ACT ${left} days out is tier ${left <= 21 ? 2 : 7}, got ${ap.tier}`)
    const shape = holiday
      ? (i === 1 || i === 3 ? actAll.map((p) => p.key).join() === 'act:full:mock,act:review:mock' : ap.key.startsWith('act:english:timed'))
      : (i === 1 ? ap.key === 'act:full:mock' : i === 2 ? /mock review/.test(ap.title) : /^act:english:timed/.test(ap.key))
    check(shape, `${DAY[i]}: the countdown shape (${actAll.map((p) => `${p.key}: ${p.title}`).join(' · ')})`)
    const actIt = items.find((x) => x.key.startsWith('act:') && x.key !== 'act:flashcards:daily')
    if (left <= 21 && !actIt) for (const it of study) check(tierOf(it.key) <= 2, `${DAY[i]}: the ACT countdown (tier 2) is left off for “${it.title}” (${it.key})`)
    // ---- events respected: nothing on Today inside a busy event (school, football, the game, dinner, a day out)
    const busy = await busyOn(d)
    for (const it of items.filter((x) => x.at && x.end)) {
      for (const b of busy) check(mins(it.end) <= b.s || mins(it.at) >= b.e, `${DAY[i]}: ${it.title} ${it.at}–${it.end} sits inside ${b.title}`)
    }
    if (holiday) check(!busy.some((b) => b.school), `${DAY[i]}: no school on a half-term day`)
    // ---- the holiday wake time: nothing before wake + the morning routine
    if (holiday) for (const it of items.filter((x) => x.at)) check(mins(it.at) >= mins('09:30'), `${DAY[i]}: ${it.title} at ${it.at} is before his holiday wake time + routine`)
    // ---- yesterday's unticked study items roll on (marked), unless done another way
    for (const l of leftYesterday) {
      const same = (k) => k.replace(/^mistakes:\d{4}-\d{2}-\d{2}/, 'mistakes:')   // a redo pick's key carries its day
      const it = [...items, ...plan.hidden].find((x) => same(x.key) === same(l.key))
      check(it, `${DAY[i]}: yesterday's unticked “${l.title}” rolled on to today`)
      if (it?.rolledFrom !== undefined) check(it.rolledFrom === D(i - 1), `${DAY[i]}: “${l.title}” marked from yesterday`)
    }
    // ---- training today: kept for the week checks
    for (const it of items.filter((x) => x.kind === 'training')) {
      const rows = await q(`select title, start_time::text s from plan_blocks where id = any($1)`, [it.blockIds])
      for (const r of rows) training.push({ date: d, dow: i + 1, title: r.title, s: r.s })
    }

    // ---- the day: tick the first study item that moves something (a topic / task / programme) and the training
    const tickable = study.find((x) => ['topic', 'task', 'programme_item', 'mistakes'].includes(x.done.kind) && !x.isDone)
    if (tickable) {
      await setAt(d, '20:00')
      const before = tickable.done.kind === 'topic' ? (await q(`select last_done::text, step from topics where id = $1`, [tickable.done.topicId]))[0] : null
      await chat.tap(`tdy:mb1:${tickable.blockIds[0]}`, m.message_id)
      check((await q(`select status from plan_blocks where id = $1`, [tickable.blockIds[0]]))[0].status === 'done', `${DAY[i]}: the tick saved`)
      if (tickable.done.kind === 'topic') {
        const now = (await q(`select last_done::text, step from topics where id = $1`, [tickable.done.topicId]))[0]
        check(tickable.done.physics || now.last_done === d, `${DAY[i]}: ticking “${tickable.title}” moved the topic on (last done today)`)
        if (tickable.done.step != null) check(now.step >= Math.min(before.step, tickable.done.step), `${DAY[i]}: its step never goes back`)
      }
      if (tickable.done.kind === 'task') check((await q(`select archived_at from tasks where id = $1`, [tickable.done.taskId]))[0].archived_at, `${DAY[i]}: ticking homework archived it (never deleted)`)
      if (tickable.done.kind === 'programme_item') check((await q(`select status from programme_items where id = $1`, [tickable.done.itemId]))[0].status === 'done', `${DAY[i]}: STEP item done`)
    }
    for (const it of items.filter((x) => x.kind === 'training')) for (const id of it.blockIds) await chat.tap(`tdy:mb1:${id}`, m.message_id)
    // what's left for tomorrow: unticked study items that are about something still to do (not one-day things)
    leftYesterday = study.filter((x) => x !== tickable && !x.isDone && !/test_light|light/.test(x.key) && !x.key.startsWith('act:') && !x.key.startsWith('consolidation') && !/:consolidation$|:timed$|:diagnostic$/.test(x.key) && x.at)
    // ---- 21:00: the evening message, a tap per item
    await setAt(d, '21:05'); await tick()
    const e = lastOf(/^🌙 <b>(Tap what you did today|All \d+ done today)/)
    check(e && e.message_id > m.message_id, `${DAY[i]}: the evening message`)
    if (leftYesterday.length) check(/Anything not ticked moves to tomorrow by itself/.test(e.text), `${DAY[i]}: it says the rest moves on`)
  }
  // ---- the week's training: Owen's fixed days, upper 2× ≥ 48 h apart, nothing heavy for the legs the day before the game
  if (process.env.SHOW) console.log('training:', training.map((t) => `${DAY[t.dow - 1]} ${t.s.slice(0, 5)} ${t.title}`).join(' | '))
  const owen = { 'Speed + circuits': 2, 'Heavy lower': 4, 'Injury prevention': 5, Core: 6 }
  for (const t of training) for (const [name, dow] of Object.entries(owen)) {
    if (t.title.startsWith(name)) check(t.dow === dow, `Owen’s ${name} on ${DAY[dow - 1]} (his fixed day), not ${DAY[t.dow - 1]}`)
  }
  const uppers = training.filter((t) => /^Upper/.test(t.title))
  check(uppers.length >= 1 && uppers.length <= 2, `upper ${uppers.length}× this week (2× at most)`)
  for (let a = 1; a < uppers.length; a++) {
    const h = (Date.parse(T().zonedToUTC(uppers[a].date, uppers[a].s.slice(0, 5))) - Date.parse(T().zonedToUTC(uppers[a - 1].date, uppers[a - 1].s.slice(0, 5)))) / 3_600_000
    check(h >= 48, `two upper sessions ${h} h apart (≥ 48 h)`)
  }
  if (o.upperFixed) for (const u of uppers) check(o.upperFixed.includes(u.dow), `upper on his fixed days (${o.upperFixed.map((x) => DAY[x - 1])}), not ${DAY[u.dow - 1]}`)
  const gameDate = o.game?.date ?? D(6)
  const eve = T().addDays(gameDate, -1)
  for (const t of training.filter((x) => x.date === eve)) {
    check(!/^Heavy lower(?! · light)/.test(t.title) && !/plyo/i.test(t.title), `no heavy lower or plyo the day before the game: ${t.title} on ${DAY[T().isoDow(eve) - 1]}`)
  }
  for (const t of training.filter((x) => x.date === gameDate)) check(!/^(Heavy lower|Upper|Speed)/.test(t.title), `nothing hard on game day: ${t.title}`)
  return training
}

test('QA: a half-term week (holiday wake, no school, upper Mon + Sat, Sunday game, a day out, ACT countdown)', { skip, timeout: 900_000 }, async () => {
  const mon = T().addDays(T().weekStartISO(T().todayISO()), -14)
  await setAt(T().addDays(mon, -1), '18:00')
  const w = await world(mon, { half: true, upperFixed: [1, 6], todayItems: 5 })
  const retake = T().addDays(mon, 24)
  await actByChat(retake)
  await runWeek(w, { half: true, upperFixed: [1, 6], todayItems: 5, retake })
  chat.noSurprises()
})

test('QA: a school week (07:30, school + football, Saturday game, dinner, tests within 3 weeks, his Today = 4)', { skip, timeout: 900_000 }, async () => {
  const mon = T().addDays(T().weekStartISO(T().todayISO()), -7)
  const D = (i) => T().addDays(mon, i)
  await setAt(T().addDays(mon, -1), '18:00')
  const game = { date: D(5), leave: '09:00', back: '13:00' }
  const w = await world(mon, { half: false, game, todayItems: 4 })
  await actByChat(D(18))
  await runWeek(w, { half: false, game, todayItems: 4, retake: D(18) })
  chat.noSurprises()
})
