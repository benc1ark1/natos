// Fix round part D (views), on his real autumn (tests/support/nat-real.mjs): THIS week (19 Oct, ACT Sun 25 Oct),
// NEXT week (26 Oct, half-term: Vlad + FM + physics, Owen's speed Wed 11:00) and SCHOOL (2 Nov).
// 18: Today is an ordered list with minutes; only fixed things show a clock time (school and events on the fixed line,
//     a training session at his set time); study, tasks and sessions the planner placed show their minutes only.
// 19: /week shows the planned study and training blocks (plan_blocks) among the bookings, not only the bookings.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/fixround-d-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EVENTS, GOALS, NEXT, PLANNING, SCHOOL, TASKS, THIS, TODAY, day } from './support/nat-real.mjs'
import { todayFromSaved } from '../lib/today/build.ts'
import { clockOf, eveningHtml, todayButtons, todayHtml } from '../lib/today/message.ts'
import { holidayChanges } from '../lib/today/holidays.ts'
import { dayItems } from '../lib/day.ts'
import { renderToday, renderWeek } from '../lib/telegram/views.ts'
import { planningSettings } from '../lib/freetime.ts'
import { addDays } from '../lib/time.ts'
import { isFixedSession } from '../lib/today/fixed.ts'

const ch = (from, to) => holidayChanges(EVENTS, [], PLANNING, from, to)
/** The fixed line's input, as lib/today/load.ts makes it (school and events only). */
const fixedOn = (date) => dayItems({ date, events: EVENTS, changes: ch(addDays(date, -1), addDays(date, 1)), travel: null, shape: null, blocks: [], planning: PLANNING, bufferMin: 10 })
  .filter((it) => it.kind === 'school' || it.kind === 'event').map((it) => ({ at: it.at || null, end: it.end, title: it.title, icon: it.icon, school: it.kind === 'school' }))
const blk = (id, start, end, title, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, start_time: `${start}:00`, end_time: `${end}:00`, title, kind: 'focus', status: 'planned',
  task_id: null, goal_id: null, target_id: null, source: 'auto', ...extra })
/** As lib/today/load.ts does it: a training block is fixed when it's at his set time (lib/today/fixed.ts). */
const today = (date, blocks, opts = {}) => todayFromSaved({ date, mode: date < SCHOOL ? 'half_term' : 'school', blocks, picks: [], fixed: fixedOn(date), max: 5, source: 'auto',
  trainingFixed: (b) => isFixedSession(PLANNING, date, b.title, b.start_time), ...opts })
const itemLinesOf = (html) => html.split('\n').filter((l) => /^(\d\.|✅)/.test(l))

// ---------------------------------------------------------------------------
// 18. Today
// ---------------------------------------------------------------------------

test('18 · THIS week, Wed 21 Oct (ACT focus): an ordered list with minutes, no clock time on study; football keeps its time on the fixed line', () => {
  const plan = today(TODAY, [
    blk(1, '10:00', '10:40', 'ACT reading passage set', { task_id: 't-act-read' }),
    blk(2, '11:00', '11:30', 'ACT grammar: punctuation drill'),
    blk(3, '14:00', '14:45', 'ACT maths: timed section', { status: 'done' }),
  ])
  const html = todayHtml(plan)
  assert.match(html, /^📌 <b>Today · Wednesday, 21 October<\/b> · <i>half-term<\/i>\n<i>⚽ Football training 19:00<\/i>\n\n/, 'the fixed line keeps its clock time')
  assert.deepEqual(itemLinesOf(html), [
    '1. 📌 ACT reading passage set <i>· 40m</i>',
    '2. 📚 ACT grammar: punctuation drill <i>· 30m</i>',
    '✅ <s>3. 📚 ACT maths: timed section · 45m</s>',
  ])
  assert.doesNotMatch(html.split('\n').slice(3).join('\n'), /\d\d:\d\d/, 'no clock time on any study item')
  assert.deepEqual(todayButtons(plan).map((r) => r[0].text), ['☐ ACT reading passage set', '☐ ACT grammar: punctuation drill', '✅ ACT maths: timed section'])
})

test('18 · NEXT week, Wed 28 Oct (half-term): Owen’s speed at his set time 11:00 shows it; FM, Vlad and physics are numbered in order with minutes', () => {
  const plan = today(day(NEXT, 2), [
    blk(4, '09:30', '10:30', 'Vlad: mechanics questions', { task_id: 't-vlad' }),
    blk(5, '11:00', '12:00', 'Speed @ Owen', { kind: 'training' }),
    blk(6, '13:00', '14:00', 'FM homework: complex numbers ex 2B', { task_id: 't-fm' }),
    blk(7, '14:30', '15:15', 'Physics: SHM booklet', { task_id: 't-phys' }),
  ])
  const html = todayHtml(plan)
  assert.deepEqual(itemLinesOf(html), [
    '1. 📌 Vlad: mechanics questions <i>· 1h</i>',
    '2. <b>11:00</b> 🏋️ Speed @ Owen <i>· 1h</i>',
    '3. 📌 FM homework: complex numbers ex 2B <i>· 1h</i>',
    '4. 📌 Physics: SHM booklet <i>· 45m</i>',
  ])
  assert.match(html, /\n<i>⚽ Football training 19:00<\/i>\n/)
  assert.deepEqual(todayButtons(plan).map((r) => r[0].text), ['☐ Vlad: mechanics questions', '☐ 11:00 Speed @ Owen', '☐ FM homework: complex numbers ex 2B', '☐ Physics: SHM booklet'])
  assert.equal(clockOf(plan.items[1]), '11:00')
  assert.equal(clockOf(plan.items[0]), null)
})

test('18 · SCHOOL week, Mon 2 Nov: school and football keep their times on the fixed line; HT2 revision has minutes only', () => {
  const plan = today(SCHOOL, [blk(8, '17:00', '17:45', 'FM HT2 revision', { task_id: 't-ht2' }), blk(9, '17:55', '18:25', 'Physics: SHM booklet corrections', { kind: 'light' })])
  const html = todayHtml(plan)
  assert.match(html, /^📌 <b>Today · Monday, 2 November<\/b>\n<i>🏫 School 08:45–16:15 · ⚽ Football training 19:00<\/i>\n\n/)
  assert.deepEqual(itemLinesOf(html), ['1. 📌 FM HT2 revision <i>· 45m</i>', '2. 📚 Physics: SHM booklet corrections <i>· 30m</i>'])
  // the evening message never had clock times: unchanged
  assert.match(eveningHtml(plan), /^🌙 <b>Tap what you did today<\/b> <i>\(0\/2 so far\)<\/i>\n☐ FM HT2 revision\n☐ Physics: SHM booklet corrections/)
})

test('18 · "what’s on today?": the plan is a numbered list with minutes; a fixed session (speed Wed 11:00) keeps its time', () => {
  const d = viewData(day(NEXT, 2), { plan: [
    { id: 'p1', start_time: '09:30', end_time: '10:30', title: 'Vlad: mechanics questions', kind: 'focus', task_id: 't-vlad' },
    { id: 'p2', start_time: '11:00', end_time: '12:00', title: 'Speed @ Owen', kind: 'training', task_id: null },
    { id: 'p3', start_time: '13:00', end_time: '13:45', title: 'Physics: SHM booklet', kind: 'focus', task_id: 't-phys' },
  ], now: new Date('2026-10-28T08:00:00Z') })
  const html = renderToday(d).html
  assert.match(html, /🗓 <b>Plan<\/b>\n1\. 📚 Vlad: mechanics questions <i>· 1h<\/i>\n2\. 🏋️ 11:00–12:00 Speed @ Owen\n3\. 📚 Physics: SHM booklet <i>· 45m<\/i>/)
})

// Item 18 (follow-up): only FIXED things show a time. A session the planner placed itself ("Upper @ PureGym" 12:30)
// shows its minutes like study, with no leave-by line; his set times (Owen's speed: Wed 11:00 in half-term, Tue 18:30
// in term) keep theirs.

test('18 · fixed or not: his set times (half-term Wed 11:00, term Tue 18:30) are fixed; planner-placed and moved sessions are not', () => {
  assert.equal(isFixedSession(PLANNING, day(NEXT, 2), 'Speed + circuits @ Owen', '11:00:00'), true, 'half-term: speed Wed 11:00')
  assert.equal(isFixedSession(PLANNING, day(THIS, 2), 'Speed + circuits @ Owen', '11:00'), true, 'the ACT week is half-term too')
  assert.equal(isFixedSession(PLANNING, day(NEXT, 2), 'Speed + circuits @ Owen', '12:00'), false, 'moved off his set time')
  assert.equal(isFixedSession(PLANNING, day(SCHOOL, 1), 'Speed + circuits @ Owen', '18:30'), true, 'term: speed Tue 18:30')
  assert.equal(isFixedSession(PLANNING, day(NEXT, 1), 'Speed + circuits @ Owen', '18:30'), false, 'half-term: the term time does not count')
  assert.equal(isFixedSession(PLANNING, day(THIS, 4), 'Upper @ PureGym', '12:30'), false, 'upper has days but no set time: the planner chose 12:30')
  assert.equal(isFixedSession(PLANNING, day(SCHOOL, 1), 'Upper · PureGym', '17:00'), false)
})

test('18 · THIS week, Fri 23 Oct: the planner’s "Upper @ PureGym" 12:30 shows its minutes, no clock time and no leave-by line', () => {
  const plan = today(day(THIS, 4), [
    blk(10, '10:00', '10:40', 'ACT reading: timed passages'),
    blk(11, '12:30', '13:30', 'Upper @ PureGym', { kind: 'training' }),
    blk(12, '15:00', '15:30', 'ACT grammar: commas', { kind: 'light' }),
  ], { trainingOpen: (b) => (isFixedSession(PLANNING, day(THIS, 4), b.title, b.start_time) ? 'leave 12:00 (30 min)' : '') })
  const html = todayHtml(plan)
  assert.deepEqual(itemLinesOf(html), ['1. 📚 ACT reading: timed passages <i>· 40m</i>', '2. 🏋️ Upper @ PureGym <i>· 1h</i>', '3. 📚 ACT grammar: commas <i>· 30m</i>'])
  assert.doesNotMatch(html, /12:30|leave/)
  assert.deepEqual(todayButtons(plan).map((r) => r[0].text), ['☐ ACT reading: timed passages', '☐ Upper @ PureGym', '☐ ACT grammar: commas'])
  assert.equal(clockOf(plan.items[1]), null)
  assert.equal(plan.items[1].fixed, false)
})

test('18 · SCHOOL week, Tue 3 Nov: speed at his term time 18:30 keeps it (and its leave-by line); upper 17:00 the planner placed does not', () => {
  const tue = day(SCHOOL, 1)
  const speed = today(tue, [blk(13, '18:30', '19:30', 'Speed + circuits @ Owen', { kind: 'training' })], { trainingOpen: () => 'leave 18:00 (30 min, a guess)' })
  assert.deepEqual(itemLinesOf(todayHtml(speed)), ['1. <b>18:30</b> 🏋️ Speed + circuits @ Owen <i>· 1h</i>'])
  assert.match(todayHtml(speed), /↳ leave 18:00/)
  assert.deepEqual(todayButtons(speed).map((r) => r[0].text), ['☐ 18:30 Speed + circuits @ Owen'])
  const upper = today(tue, [blk(14, '17:00', '18:30', 'Upper @ PureGym', { kind: 'training' })])
  assert.deepEqual(itemLinesOf(todayHtml(upper)), ['1. 🏋️ Upper @ PureGym <i>· 1h 30m</i>'])
  assert.deepEqual(todayButtons(upper).map((r) => r[0].text), ['☐ Upper @ PureGym'])
})

test('18 · "what’s on today?" on Fri 23 Oct: the planner’s upper 12:30 is numbered with its minutes (no clock time)', () => {
  const fri = renderToday(viewData(day(THIS, 4), { plan: [
    { id: 'p4', start_time: '10:00', end_time: '10:40', title: 'ACT reading: timed passages', kind: 'focus', task_id: null },
    { id: 'p5', start_time: '12:30', end_time: '13:30', title: 'Upper @ PureGym', kind: 'training', task_id: null },
  ], now: new Date('2026-10-23T07:00:00Z') })).html
  assert.match(fri, /🗓 <b>Plan<\/b>\n1\. 📚 ACT reading: timed passages <i>· 40m<\/i>\n2\. 🏋️ Upper @ PureGym <i>· 1h<\/i>/)
  assert.doesNotMatch(fri, /12:30/)
})

// ---------------------------------------------------------------------------
// 19. /week shows the planned blocks
// ---------------------------------------------------------------------------

/** What loadViewData gives renderWeek: his real events, holiday changes, tasks and tests, and the next 7 days' blocks. */
function viewData(date, extra = {}) {
  return { today: date, events: EVENTS, changes: ch(addDays(date, -7), addDays(date, 14)), tasks: TASKS.filter((t) => !t.archived_at), goals: GOALS, targets: [], logs: [], weekCounts: [],
    settings: planningSettings(PLANNING), planning: PLANNING, reminders: [], projects: [], plan: [], travel: null, now: new Date(`${date}T07:00:00Z`), ...extra }
}
const wb = (on_date, start, end, title, extra = {}) => ({ id: `${on_date}-${start}`, on_date, start_time: start, end_time: end, title, kind: 'focus', status: 'planned', ...extra })
/** One day's part of the /week message. */
const dayPart = (html, label) => {
  const start = html.indexOf(`<b>${label}</b>`)
  assert.ok(start >= 0, `no ${label} in: ${html}`)
  const next = html.slice(start + 1).search(/\n(<b>|<i>Plus|🏃)/)
  return next < 0 ? html.slice(start) : html.slice(start, start + 1 + next)
}

test('19 · THIS week from Wed 21 Oct: the ACT blocks and training show on their days; ACT Sun 25 Oct; the 7 days only', () => {
  const html = renderWeek(viewData(TODAY, { weekBlocks: [
    wb(TODAY, '10:00', '10:40', 'ACT reading passage set', { status: 'done' }),
    wb(day(THIS, 3), '10:00', '10:40', 'ACT reading: timed passages'),
    wb(day(THIS, 3), '11:00', '11:30', 'ACT grammar: commas', { kind: 'light' }),
    wb(day(THIS, 4), '12:30', '13:30', 'Upper @ PureGym', { kind: 'training' }),
    wb(day(THIS, 4), '15:00', '15:30', 'Rest', { kind: 'rest' }),
    wb(day(NEXT, 2), '13:00', '14:00', 'FM homework: complex numbers ex 2B'),   // Wed 28 Oct: past the 7 days
  ] })).html
  assert.match(dayPart(html, 'Today'), /✅ 📚 ACT reading passage set <i>· 40m<\/i>/)
  assert.match(dayPart(html, 'Thu 22 Oct'), /<b>Thu 22 Oct<\/b>\n {2}📚 ACT reading: timed passages <i>· 40m<\/i>\n {2}📚 ACT grammar: commas <i>· 30m<\/i>/)
  assert.match(dayPart(html, 'Fri 23 Oct'), /🏋️ 12:30–13:30 Upper @ PureGym/)
  assert.doesNotMatch(html, /Rest/, 'rest blocks are not shown')
  assert.match(dayPart(html, 'Sun 25 Oct'), /📝 <b>ACT retake<\/b>/)
  assert.ok(!html.includes('📚 FM homework'), 'a block after the 7 days (Wed 28 Oct) is not shown')
})

test('19 · NEXT week from Mon 26 Oct (half-term): FM, Vlad and physics blocks, Owen’s speed Wed 11:00 before football at 19:00', () => {
  const html = renderWeek(viewData(NEXT, { weekBlocks: [
    wb(NEXT, '10:00', '11:00', 'FM homework: complex numbers ex 2B'),
    wb(day(NEXT, 1), '09:30', '10:30', 'Vlad: mechanics questions'),
    wb(day(NEXT, 2), '11:00', '12:00', 'Speed @ Owen', { kind: 'training' }),
    wb(day(NEXT, 2), '14:30', '15:15', 'Physics: SHM booklet'),
  ] })).html
  assert.ok(!/🏫 School/.test(html), 'half-term: no school line')
  assert.match(dayPart(html, 'Today'), /📚 FM homework: complex numbers ex 2B <i>· 1h<\/i>\n {2}19:00–20:30 Football training/)
  assert.match(dayPart(html, 'Tue 27 Oct'), /📚 Vlad: mechanics questions <i>· 1h<\/i>/)
  assert.match(dayPart(html, 'Wed 28 Oct'), /<b>Wed 28 Oct<\/b>\n {2}🏋️ 11:00–12:00 Speed @ Owen\n {2}📚 Physics: SHM booklet <i>· 45m<\/i>\n {2}19:00–20:30 Football training/)
})

test('19 · SCHOOL week from Mon 2 Nov: a block after school sits after the school line, before football', () => {
  const html = renderWeek(viewData(SCHOOL, { weekBlocks: [wb(SCHOOL, '17:00', '17:45', 'FM HT2 revision'), wb(day(SCHOOL, 1), '17:00', '18:00', 'Upper @ PureGym', { kind: 'training' })] })).html
  assert.match(dayPart(html, 'Today'), /🏫 School 08:45–16:15\n(?: {4}.*\n)* {2}📚 FM HT2 revision <i>· 45m<\/i>\n {2}19:00–20:30 Football training/)
  assert.match(dayPart(html, 'Tue 3 Nov'), /🏋️ 17:00–18:00 Upper @ PureGym/)
  // with no blocks loaded (an old caller): just the bookings, as before
  assert.doesNotMatch(renderWeek(viewData(SCHOOL)).html, /📚|🏋️/)
})
