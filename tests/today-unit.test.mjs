// Queue item 5 (plans/contracts.md §8): Today's list (≤ 5, homework first, placed in real free time, training as one
// item, no free time → 1–2), holidays (half-term mode, school skipped, the holiday wake time), the 07:30 / holiday
// morning time, roll-forward, "done" already reported (no double counting), and the Telegram messages. Pure code.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/today-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildToday, candidates, clampItems, fixedLine, matchPick, todayFromSaved, trainingItem } from '../lib/today/build.ts'
import { dayMode, holidayChanges, isHoliday, morningAt, parseHolidays } from '../lib/today/holidays.ts'
import { eveningHtml, tapData, todayButtons, todayHtml } from '../lib/today/message.ts'
import { effectDone, taskPicks } from '../lib/today/load.ts'
import { DEFAULT_PLANNING } from '../lib/freetime.ts'
import { planProblems } from '../lib/plan.ts'
import { moreSettings, parseSetting, setting } from '../lib/settings.ts'
import { expandEvents } from '../lib/events.ts'
import { minutesOf } from '../lib/time.ts'

const DATE = '2026-11-04'   // a Wednesday in a school week
const S = { ...DEFAULT_PLANNING }   // nothing heavy after 21:30, 10-min buffers
const slot = (start, end) => ({ start, end, minutes: minutesOf(end) - minutesOf(start), heavyMinutes: Math.max(0, Math.min(minutesOf(end), minutesOf(S.heavyUntil)) - minutesOf(start)) })
let n = 0
const pick = (tier, kind, minutes, extra = {}) => {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const done = kind === 'homework' ? { kind: 'task', taskId: id } : kind === 'review' || kind === 'fix' || kind === 'ahead' ? { kind: 'topic', topicId: id, step: 3 } : { kind: 'block' }
  return { key: `${kind}:${id}`, kind, tier, subject: 'Maths', title: `${kind} ${n}`, open: `open ${kind} ${n}`, minutes, why: `why ${n}`, done, ...(done.kind === 'task' ? { taskId: id } : {}), ...extra }
}
const input = (over = {}) => ({ date: DATE, mode: 'school', slots: [slot('16:10', '19:30'), slot('20:00', '22:30')], settings: S, budget: null, energy: 'normal', picks: [], tasks: [], training: [], fixed: [], max: 5, rolled: [], ...over })

test('at most 5 (his setting, 3–5), homework first, then the planner’s order; shown in time order', () => {
  const hw = pick(1, 'homework', 45), review = pick(3, 'review', 25), fix = pick(4, 'fix', 40), ahead = pick(5, 'ahead', 60), old = pick(7, 'old', 30), stretch = pick(6, 'stretch', 30)
  // the planner's order has homework first already; a must-do task due today comes straight after homework
  const task = { ...pick(1, 'task', 20), done: { kind: 'task', taskId: 'tsk' }, taskId: 'tsk', key: 'task:tsk', title: 'Email the trip form' }
  const plan = buildToday(input({ picks: [hw, review, fix, ahead, stretch, old], tasks: [task] }))
  assert.equal(plan.items.length, 5)
  assert.deepEqual(plan.items.map((i) => i.key), [hw.key, task.key, review.key, fix.key, ahead.key], 'homework, the due task, then the planner’s order')
  assert.deepEqual(plan.items.map((i) => i.at), [...plan.items.map((i) => i.at)].sort(), 'time order')
  assert.equal(plan.items[0].at, '16:10', 'homework while fresh, first thing after school')
  assert.equal(plan.more, 2)
  assert.deepEqual(plan.hidden.map((h) => h.key), [stretch.key, old.key])
  assert.equal(plan.items[0].open, hw.open, 'each item says exactly what to open')
  // his setting: 3 → 3 items; out of range → kept to 3–5
  assert.equal(buildToday(input({ picks: [hw, review, fix, ahead], max: 3 })).items.length, 3)
  assert.equal(clampItems(9), 5); assert.equal(clampItems(1), 3); assert.equal(clampItems('x'), 5)
  // candidates(): the planner's homework, then due tasks, then the rest, then tasks merely on his Today column
  const later = { ...pick(7, 'task', 15), done: { kind: 'task', taskId: 'later' }, taskId: 'later', key: 'task:later' }
  assert.deepEqual(candidates([hw, review], [later, task]).map((p) => p.key), [hw.key, task.key, review.key, later.key])
  // the same task from both sources counts once
  assert.equal(candidates([hw], [{ ...task, key: `task:${hw.taskId}`, taskId: hw.taskId, done: { kind: 'task', taskId: hw.taskId } }]).length, 1)
})

test('placed into real free time by lib/plan.ts’s rules: in a free slot, a buffer between, nothing heavy after 21:30', () => {
  const picks = [pick(1, 'homework', 45), pick(2, 'test_topic', 40), pick(3, 'review', 25), pick(4, 'fix', 40), pick(7, 'flashcards', 10, { heavy: false })]
  const slots = [slot('16:10', '17:30'), slot('20:30', '22:30')]
  const plan = buildToday(input({ picks, slots }))
  const blocks = plan.items.map((i) => ({ start: i.at, end: i.end, title: i.title, kind: i.heavy ? 'focus' : 'light' }))
  assert.deepEqual(planProblems(blocks, slots, S, null), [])
  for (let i = 1; i < plan.items.length; i++) assert.ok(minutesOf(plan.items[i].at) >= minutesOf(plan.items[i - 1].end) + S.bufferMin || plan.items[i].at >= '20:30', 'a break between blocks')
  // the light 10-minute flashcards may go after 21:30; nothing heavy does
  for (const it of plan.items.filter((i) => i.heavy)) assert.ok(it.end <= '21:30', `${it.title} ends ${it.end}`)
})

test('a school night’s focus limit: heavy work stops at the limit; light things still fit', () => {
  const picks = [pick(3, 'review', 30), pick(4, 'fix', 40), pick(5, 'ahead', 60), pick(7, 'flashcards', 10, { heavy: false })]
  const plan = buildToday(input({ picks, budget: 75 }))
  const focus = plan.items.filter((i) => i.heavy).reduce((a, i) => a + i.minutes, 0)
  assert.ok(focus <= 75, `${focus} min of focused work`)
  assert.ok(plan.items.some((i) => i.key.startsWith('flashcards')))
})

test('training counts as one item (two sessions → one), study goes around it and its travel', () => {
  const training = [
    { title: 'Upper @ PureGym', start: '16:40', end: '18:00', blockIds: ['b1'], targetId: 't1', open: 'leave school 16:15 (25 min)', done: false, cutFrom: '16:15', cutTo: '18:25' },
    { title: 'Core', start: '18:00', end: '18:20', blockIds: ['b2'], targetId: null, open: '', done: false },
  ]
  const picks = [pick(1, 'homework', 45), pick(3, 'review', 25), pick(4, 'fix', 40), pick(5, 'ahead', 60), pick(7, 'old', 30)]
  const plan = buildToday(input({ picks, training }))
  assert.ok(plan.items.length <= 5 && plan.items.length >= 3, 'training + study, at most 5')
  const t = plan.items.filter((i) => i.kind === 'training')
  assert.equal(t.length, 1)
  assert.equal(t[0].title, 'Upper + Core')
  assert.equal(t[0].open, 'Upper @ PureGym (leave school 16:15 (25 min)) · Core')
  assert.deepEqual([t[0].at, t[0].end, t[0].minutes], ['16:40', '18:20', 100])
  assert.deepEqual(t[0].blockIds, ['b1', 'b2'])
  for (const it of plan.items.filter((i) => i.kind !== 'training')) {
    const overlaps = minutesOf(it.at) < minutesOf('18:25') + S.bufferMin && minutesOf(it.end) > minutesOf('16:15') - S.bufferMin
    assert.ok(!overlaps, `${it.title} ${it.at}–${it.end} is clear of training and its travel`)
  }
  assert.equal(trainingItem(DATE, []), null)
})

test('no free time: it says so and shows only the most important 1–2', () => {
  const picks = [pick(1, 'homework', 45), pick(2, 'test_timed', 50), pick(3, 'review', 25)]
  const plan = buildToday(input({ picks, slots: [slot('21:00', '21:10')] }))
  assert.equal(plan.noTime, true)
  assert.ok(plan.items.length >= 1 && plan.items.length <= 2)
  assert.deepEqual(plan.items.map((i) => i.key), [picks[0].key, picks[1].key])
  assert.ok(plan.items.every((i) => i.at === null))
  assert.match(plan.note, /No free time today/)
  assert.equal(plan.more, 1)
  // with training today, one study thing besides it
  const withTraining = buildToday(input({ picks, slots: [], training: [{ title: 'Upper', start: '17:00', end: '18:00', blockIds: ['x'], targetId: null, open: '', done: false }] }))
  assert.deepEqual(withTraining.items.map((i) => i.kind), ['training', 'task'])
})

test('homework is never dropped for time; a long session is shortened (≥ half) rather than dropped', () => {
  const hw = pick(1, 'homework', 200)
  const ahead = pick(5, 'ahead', 90)
  const plan = buildToday(input({ picks: [hw, ahead], slots: [slot('16:10', '17:15')] }))
  const h = plan.items.find((i) => i.key === hw.key)
  assert.equal(h.at, null, 'shown without a time')
  assert.match(h.why, /no free slot long enough/)
  const a = plan.items.find((i) => i.key === ahead.key)
  assert.ok(a && a.shortened && a.minutes >= 45 && a.minutes < 90, `ahead shortened to ${a?.minutes}`)
  assert.match(a.why, /cut to fit today’s free time$/)
})

test('roll forward: something not done yesterday that the planner picks again is marked rolled_from', () => {
  const review = pick(3, 'review', 25)
  const plan = buildToday(input({ picks: [review, pick(4, 'fix', 40)], rolled: [{ key: review.key, title: review.title, from: '2026-11-03' }, { key: 'gone:1', title: 'Not picked', from: '2026-11-03' }] }))
  const it = plan.items.find((i) => i.key === review.key)
  assert.equal(it.rolledFrom, '2026-11-03')
  assert.match(it.why, /^from yesterday · /)
  assert.equal(plan.items.filter((i) => i.rolledFrom).length, 1, 'only what the planner picked again rolls on')
  // before today.sql: matched by title
  const byTitle = buildToday(input({ picks: [review], rolled: [{ key: null, title: review.title, from: '2026-11-01' }] }))
  assert.match(byTitle.items[0].why, /^from Sun · /)
})

test('the fixed line: school as a range, other commitments as a start time, at most 5', () => {
  assert.equal(fixedLine([{ at: '19:45', end: '21:00', title: 'Football', icon: '⚽' }, { at: '08:45', end: '16:00', title: 'School', icon: '🏫', school: true }]), '🏫 School 08:45–16:00 · ⚽ Football 19:45')
  assert.equal(fixedLine([]), '')
  const many = Array.from({ length: 7 }, (_, i) => ({ at: `1${i}:00`, end: null, title: `E${i}`, icon: '📅' }))
  assert.match(fixedLine(many), /E3 13:00 · \+3$/)
})

test('holidays: date ranges, half-term mode, the 07:30 morning and the holiday wake time', () => {
  assert.deepEqual(parseHolidays('2026-10-17..2026-11-01, 2026-12-21, junk, 2026-12-30..2026-12-01'), [{ from: '2026-10-17', to: '2026-11-01' }, { from: '2026-12-21', to: '2026-12-21' }])
  assert.deepEqual(parseHolidays('none'), [])
  const p = { holidays: '2026-10-24..2026-11-01' }
  assert.equal(isHoliday(p, '2026-10-26'), true)
  assert.equal(isHoliday(p, '2026-11-02'), false)
  assert.equal(dayMode(p, '2026-10-26'), 'half_term')
  assert.equal(dayMode(p, '2026-11-02'), 'school')
  // the default is this half-term (a guess, marked so on Settings)
  assert.equal(setting({}, 'holidays'), '2026-10-17..2026-11-01')
  assert.equal(dayMode({}, '2026-10-20'), 'half_term')
  // the morning message: 07:30 (the brief's new default); on a holiday not before his holiday wake time (09:00)
  assert.equal(moreSettings({}).briefAt, '07:30')
  assert.equal(morningAt(p, '2026-11-02'), '07:30')
  assert.equal(morningAt(p, '2026-10-26'), '09:00')
  assert.equal(morningAt({ ...p, holidayWakeAt: '08:15' }, '2026-10-26'), '08:15')
  assert.equal(morningAt({ ...p, holidayWakeAt: '06:00' }, '2026-10-26'), '07:30', 'never before his brief time')
  assert.equal(morningAt({ ...p, briefAt: '07:00' }, '2026-11-02'), '07:00')
  // settings by chat
  assert.equal(parseSetting('holidays', '2026-10-24..2026-11-01, 2026-12-19..2027-01-03', {}), '2026-10-24..2026-11-01, 2026-12-19..2027-01-03')
  assert.equal(parseSetting('holidayWakeAt', '9:30', {}), '09:30')
  assert.equal(parseSetting('todayItems', '4', {}), 4)
  assert.equal(parseSetting('todayItems', '7', {}), null, 'at most 5')
  assert.equal(setting({}, 'todayItems'), 5)
})

test('holidays: his school is skipped on holiday days (football and one-off events are not)', () => {
  const ev = (id, title, extra) => ({ id, title, is_busy: true, archived_at: null, external_source: 'manual', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', repeat_from: '2026-09-01', repeat_until: null, starts_at: null, ends_at: null, ...extra })
  const school = ev('s', 'School', { is_school: true })
  const football = ev('f', 'Football', { repeat_days: [1, 3], start_time: '19:45', end_time: '21:00', training_type: 'football' })
  const mock = ev('m', 'Mock exam', { is_school: true, repeat_days: null, start_time: null, end_time: null, starts_at: '2026-10-27T09:00:00Z', ends_at: '2026-10-27T11:00:00Z' })
  const p = { holidays: '2026-10-24..2026-11-01' }
  const ch = holidayChanges([school, football, mock], [], p, '2026-10-23', '2026-11-02')
  const occ = expandEvents([school, football, mock], '2026-10-23', '2026-11-02', ch).filter((o) => !o.cancelled)
  const on = (d) => occ.filter((o) => o.date === d).map((o) => o.event.title).sort()
  assert.deepEqual(on('2026-10-23'), ['School'], 'the Friday before: school')
  assert.deepEqual(on('2026-10-26'), ['Football'], 'half-term Monday: football, no school')
  assert.deepEqual(on('2026-10-27'), ['Mock exam'], 'a one-off school event still happens')
  assert.deepEqual(on('2026-11-02'), ['Football', 'School'], 'back to school')
  assert.deepEqual(holidayChanges([school], [], { holidays: 'none' }, '2026-10-26', '2026-10-26'), [])
})

const block = (id, start, end, extra = {}) => ({ id, start_time: start, end_time: end, title: `Block ${id}`, kind: 'focus', status: 'planned', task_id: null, goal_id: null, target_id: null, ...extra })

test('a saved list shows as saved; his own plan is kept; training merges; the rest is "+N more"', () => {
  const p1 = pick(3, 'review', 25), p2 = pick(4, 'fix', 40), p3 = pick(5, 'ahead', 60)
  const blocks = [
    block('a', '17:00', '17:25', { pick_key: p1.key, open_text: 'Bicen CP1 Q1–4', why: 'due review', done_hint: p1.done, source: 'auto', status: 'done' }),
    block('b', '16:10', '16:50', { pick_key: p2.key, source: 'auto' }),
    block('t', '18:00', '19:30', { kind: 'training', title: 'Upper @ PureGym', target_id: 'tg', source: 'week' }),
    block('x', '20:00', '20:30', { status: 'replaced' }),
  ]
  const plan = todayFromSaved({ date: DATE, mode: 'school', blocks, picks: [p1, p2, p3], fixed: [], max: 5, source: 'auto', trainingOpen: () => 'leave 17:40' })
  assert.deepEqual(plan.items.map((i) => i.title), ['Block b', 'Block a', 'Upper @ PureGym'])
  assert.equal(plan.items[1].open, 'Bicen CP1 Q1–4', 'saved: exactly what to open')
  assert.equal(plan.items[0].open, p2.open, 'no saved text: its pick’s')
  assert.equal(plan.items[1].isDone, true)
  assert.equal(plan.items[2].kind, 'training')
  assert.equal(plan.items[2].open, 'leave 17:40')
  assert.deepEqual(plan.hidden.map((h) => h.key), [p3.key], 'the planner’s other picks are “+N more”')
  assert.equal(plan.source, 'auto')
  // capped at his setting, in time order
  const many = Array.from({ length: 7 }, (_, i) => block(`m${i}`, `1${i}:00`, `1${i}:30`))
  const capped = todayFromSaved({ date: DATE, mode: 'school', blocks: many, picks: [], fixed: [], max: 4, source: 'his' })
  assert.equal(capped.items.length, 4)
  assert.equal(capped.more, 3)
  // matching a saved block to its pick: key, then task, then title
  assert.equal(matchPick(block('z', '10:00', '10:30', { pick_key: p3.key }), [p1, p3]), p3)
  assert.equal(matchPick(block('z', '10:00', '10:30', { title: p1.title }), [p1, p3]), p1)
})

test('no double counting: something he already reported by message shows as done (and its tap only ticks it)', () => {
  const topic = { id: 'T1', lastDone: DATE }
  const world = { today: DATE, topics: [topic], tests: [{ id: 'G1', attempts: [{ doneOn: DATE, what: 'diagnostic' }] }], mistakes: [{ id: 'M1', reviewOn: '2026-11-11' }, { id: 'M2', reviewOn: DATE }],
    programmes: [{ items: [{ id: 'I1', status: 'done' }, { id: 'I2', status: 'todo' }] }], rules: [], homework: [], doneToday: ['act:english:timed'] }
  const act = { doneToday: [] }
  const x = { date: DATE, tasks: [{ id: 'open-task' }], world, act }
  const it = (done, key = 'k') => ({ key, done })
  assert.equal(effectDone(it({ kind: 'topic', topicId: 'T1' }), x), true, 'topic done today (reported)')
  assert.equal(effectDone(it({ kind: 'topic', topicId: 'T2' }), x), false)
  assert.equal(effectDone(it({ kind: 'task', taskId: 'gone' }), x), true, 'the task is no longer open')
  assert.equal(effectDone(it({ kind: 'task', taskId: 'open-task' }), x), false)
  assert.equal(effectDone(it({ kind: 'mistakes', mistakeIds: ['M1'] }), x), true, 'redo already moved on')
  assert.equal(effectDone(it({ kind: 'mistakes', mistakeIds: ['M1', 'M2'] }), x), false)
  assert.equal(effectDone(it({ kind: 'mistakes', mistakeIds: ['nope'] }), x), false, 'unknown = not done')
  assert.equal(effectDone(it({ kind: 'programme_item', itemId: 'I1' }), x), true)
  assert.equal(effectDone(it({ kind: 'programme_item', itemId: 'I2' }), x), false)
  assert.equal(effectDone(it({ kind: 'attempt', goalId: 'G1', what: 'diagnostic' }), x), true)
  assert.equal(effectDone(it({ kind: 'attempt', goalId: 'G1', what: 'timed' }), x), false)
  assert.equal(effectDone(it({ kind: 'act', section: 'english' }, 'act:english:timed'), x), true, 'the planner’s done-today key')
  // on a saved list it shows ✅
  const plan = todayFromSaved({ date: DATE, mode: 'school', blocks: [block('a', '17:00', '17:30', { pick_key: 'topic:T1:fix', done_hint: { kind: 'topic', topicId: 'T1' }, source: 'auto' })], picks: [], fixed: [], max: 5, source: 'auto', effectDone: (i) => effectDone(i, x) })
  assert.equal(plan.items[0].isDone, true)
  assert.match(todayButtons(plan)[0][0].text, /^✅/)
})

test('his must-do tasks: due by tomorrow first (homework tier), then his Today column / starred; never Someday or prep sessions', () => {
  const t = (id, extra) => ({ id, title: id, status: 'this_week', importance: 'must', due_at: null, window_end: null, is_key: false, is_system: false, archived_at: null, duration_minutes: null, details: null, ...extra })
  const tasks = [
    t('later', { due_at: '2026-11-10T12:00:00Z' }),
    t('tomorrow', { due_at: '2026-11-05T12:00:00Z', details: 'Worksheet 3\nmore' }),
    t('overdue', { due_at: '2026-11-01T12:00:00Z', duration_minutes: 20 }),
    t('nice-today', { importance: 'nice', status: 'today' }),
    t('starred', { importance: 'nice', is_key: true }),
    t('someday', { status: 'someday', is_key: true }),
    t('prep', { is_system: true, due_at: '2026-11-04T12:00:00Z' }),
  ]
  const out = taskPicks(tasks, DATE)
  assert.deepEqual(out.map((p) => p.key), ['task:overdue', 'task:tomorrow', 'task:nice-today', 'task:starred'])
  assert.deepEqual(out.map((p) => p.tier), [1, 1, 7, 7])
  assert.equal(out[1].open, 'Worksheet 3')
  assert.equal(out[0].minutes, 20)
  assert.equal(out[1].minutes, 30)
  assert.deepEqual(out[0].done, { kind: 'task', taskId: 'overdue' })
})

test('the morning message: the date, the fixed line, each item with its time, what to open and a tap; “+N more”; nothing else', () => {
  const hw = pick(1, 'homework', 45, { title: 'Physics homework <waves>' })
  const plan = buildToday(input({ picks: [hw, pick(3, 'review', 25), pick(4, 'fix', 40), pick(5, 'ahead', 60), pick(6, 'stretch', 30), pick(7, 'old', 30)],
    fixed: [{ at: '08:45', end: '16:00', title: 'School', icon: '🏫', school: true }, { at: '19:45', end: '21:00', title: 'Football', icon: '⚽' }] }))
  plan.items.forEach((it, i) => it.blockIds.push(`00000000-0000-4000-8000-00000000000${i}`))
  plan.items[1].isDone = true
  const html = todayHtml(plan)
  assert.match(html, /^📌 <b>Today · Wednesday, 4 November<\/b>\n<i>🏫 School 08:45–16:00 · ⚽ Football 19:45<\/i>\n\n/)
  assert.match(html, /<b>16:10<\/b> 📌 Physics homework &lt;waves&gt; <i>· 45m<\/i>\n {5}↳ open homework \d+/)
  assert.match(html, /✅ <s>\d\d:\d\d 📚 review \d+ · 25m<\/s>/, 'done: struck through, no "open" line')
  assert.match(html, /<i>\+1 more · \/today all<\/i>$/)
  assert.doesNotMatch(html, /Don’t forget|Targets|Remember|Your day/, 'nothing else')
  const buttons = todayButtons(plan)
  assert.equal(buttons.length, 5)
  assert.ok(buttons.every((r) => r.length === 1 && Buffer.byteLength(r[0].callback_data) <= 64))
  assert.equal(buttons[0][0].callback_data, 'tdy:mb1:00000000-0000-4000-8000-000000000000')
  assert.match(buttons[0][0].text, /^☐ 16:10 Physics homework/)
  assert.match(buttons[1][0].text, /^✅/)
  // /today all lists the hidden ones too
  assert.match(todayHtml(plan, { all: true }), /<b>Also on the list<\/b> \(1\)\n• old \d+/)
  // an item not saved as a block (no time today) is ticked by its task; one with neither has no tap
  assert.equal(tapData('e', { blockIds: [], taskId: 'T9' }), 'tdy:et1:T9')
  assert.equal(tapData('m', { blockIds: [], taskId: null }), null)
  // half-term shows on the date line; an empty day says so
  assert.match(todayHtml({ ...plan, mode: 'half_term', items: [], more: 0, fixed: '' }), /· <i>half-term<\/i>\n\n<i>Nothing planned today/)
})

test('the evening message: a tap per item; what isn’t ticked moves on by itself (no ✅ card)', () => {
  const items = [{ key: 'a', title: 'Physics homework', isDone: true, kind: 'task', blockIds: ['00000000-0000-4000-8000-000000000001'], taskId: null },
    { key: 'b', title: 'Matrices exam Qs', isDone: false, kind: 'study', blockIds: ['00000000-0000-4000-8000-000000000002'], taskId: null }]
  const html = eveningHtml({ items })
  assert.match(html, /^🌙 <b>Tap what you did today<\/b> <i>\(1\/2 so far\)<\/i>\n✅ Physics homework\n☐ Matrices exam Qs\n\n<i>Anything not ticked moves to tomorrow by itself\.<\/i>$/)
  assert.equal(todayButtons({ items }, 'e')[1][0].callback_data, 'tdy:eb1:00000000-0000-4000-8000-000000000002')
  assert.match(eveningHtml({ items: items.map((i) => ({ ...i, isDone: true })) }), /^🌙 <b>All 2 done today\.<\/b> 👏/)
  assert.match(eveningHtml({ items: [{ ...items[1], kind: 'training', title: 'Upper' }] }), /Training not ticked stays with your week plan/)
  assert.equal(eveningHtml({ items: [] }), null)
})

test('with the real study planner: a half-term day and a school day give ≤ 5 things, homework first, all in free time', async () => {
  const { planStudyDay } = await import('../lib/tracker/engine.ts')
  const { realWorld, dayOf } = await import('./fixtures/tracker-world.mjs')
  // half-term Monday: free 09:30–19:35 and 21:10–22:30 (football 19:45–21:00 with buffers)
  const half = realWorld()
  const slotsH = [slot('09:30', '19:35'), slot('21:10', '22:30')]
  const picksH = planStudyDay(half, dayOf('2026-10-19', 'half_term', 360), []).picks
  const h = buildToday(input({ date: '2026-10-19', mode: 'half_term', slots: slotsH, picks: picksH }))
  assert.ok(h.items.length >= 3 && h.items.length <= 5, `${h.items.length} items`)
  assert.equal(h.items.find((i) => i.at === h.items[0].at).title, picksH[0].title, 'the first thing in the day is the top pick')
  assert.match(picksH[0].title, /Kinematics worksheet/, 'homework first')
  assert.deepEqual(planProblems(h.items.map((i) => ({ start: i.at, end: i.end, title: i.title, kind: i.heavy ? 'focus' : 'light' })), slotsH, S, null), [])
  assert.ok(h.items.every((i) => i.open), 'each says exactly what to open')
  assert.equal(h.more, Math.max(0, picksH.length - h.items.length))
  // a school Wednesday: after school only, a school night's focus limit
  const school = realWorld({ today: '2026-11-04' })
  const slotsS = [slot('16:10', '19:35'), slot('21:10', '22:30')]
  const picksS = planStudyDay(school, dayOf('2026-11-04', 'school', 150), []).picks
  const s = buildToday(input({ picks: picksS, slots: slotsS, budget: 150 }))
  assert.ok(s.items.length >= 1 && s.items.length <= 5)
  assert.ok(s.items.filter((i) => i.heavy && i.at).reduce((a, i) => a + i.minutes, 0) <= 150, 'within the school-night focus limit')
  assert.ok(s.items.every((i) => i.at === null || i.at >= '16:10'))
})

// ---- review fixes (pr/5) ----

test('fix 1: homework that had no free slot when the list was saved stays on it (no time), and can be ticked by its task', () => {
  const hw = pick(1, 'homework', 120)
  const other = pick(3, 'review', 25)
  const blocks = [block('a', '17:00', '17:25', { pick_key: other.key, source: 'auto' })]
  const plan = todayFromSaved({ date: DATE, mode: 'school', blocks, picks: [hw, other], fixed: [], max: 5, source: 'auto' })
  const h = plan.items.find((i) => i.key === hw.key)
  assert.ok(h, 'still on the list')
  assert.equal(h.at, null)
  assert.match(h.why, /no free slot long enough today/)
  assert.equal(tapData('m', h), `tdy:mt1:${hw.taskId}`)
  assert.ok(!plan.hidden.some((x) => x.key === hw.key), 'not hidden in "+N more"')
  // already on the list as a block (by its task): not twice
  const twice = todayFromSaved({ date: DATE, mode: 'school', blocks: [block('b', '16:10', '17:00', { task_id: hw.taskId, source: 'auto' })], picks: [hw], fixed: [], max: 5, source: 'auto' })
  assert.equal(twice.items.length, 1)
})

test('fix 5: what wasn’t ticked yesterday comes back straight after homework, even if the planner didn’t pick it again', () => {
  const hw = pick(1, 'homework', 45)
  const rolled = { ...pick(3, 'review', 30), key: 'topic:R1:review', title: 'Y1-07 Logarithms: review', tier: 1.5 }
  const planner = [hw, pick(2, 'test_topic', 40), pick(4, 'fix', 40), pick(5, 'ahead', 60), pick(6, 'stretch', 30)]
  assert.deepEqual(candidates(planner, [], [rolled]).map((p) => p.key).slice(0, 2), [hw.key, rolled.key])
  // the planner's fresher version wins when it picked the same key
  const fresh = { ...rolled, open: 'fresh open', tier: 3 }
  assert.equal(candidates([fresh], [], [rolled])[0].open, 'fresh open')
  const plan = buildToday(input({ picks: planner, rolledPicks: [rolled], rolled: [{ key: rolled.key, title: rolled.title, from: '2026-11-03' }] }))
  const it = plan.items.find((i) => i.key === rolled.key)
  assert.ok(it, 'on today’s list')
  assert.equal(it.rolledFrom, '2026-11-03')
  assert.match(it.why, /^from yesterday/)
})

test('fix 6: his own plan shows what’s still to come first, and a block with no resource gets the planner’s for its subject', () => {
  const maths = { ...pick(4, 'fix', 40), subject: 'Maths', open: 'Bicen Pure → AS: Logarithms', title: 'Y1-07 Logarithms' }
  const fm = { ...pick(4, 'fix', 40), subject: 'Further Maths', open: 'Bicen Core Pure → CP1: Matrices', title: 'PC1-01 Matrices' }
  const mine = (id, start, end, title, extra = {}) => block(id, start, end, { title, ...extra })
  const blocks = [
    mine('1', '07:00', '07:30', 'Reading', { status: 'done' }), mine('2', '08:00', '08:30', 'Flashcards'), mine('3', '12:00', '12:30', 'Lunch reading'),
    mine('4', '16:30', '17:30', 'Further Maths: exam questions'), mine('5', '18:00', '18:45', 'Maths: practice'), mine('6', '19:00', '19:30', 'Physics notes'), mine('7', '20:00', '20:30', 'Review'),
  ]
  const plan = todayFromSaved({ date: DATE, mode: 'school', blocks, picks: [maths, fm], fixed: [], max: 5, source: 'his', now: '16:40' })
  assert.deepEqual(plan.items.map((i) => i.title), ['Reading', 'Further Maths: exam questions', 'Maths: practice', 'Physics notes', 'Review'],
    'still to come first (one running now included), then done; past and not done drop to "+N more"; in time order')
  assert.equal(plan.items.find((i) => i.title === 'Maths: practice').open, maths.open)
  assert.equal(plan.items.find((i) => i.title === 'Further Maths: exam questions').open, fm.open, 'the longest subject name wins')
  assert.equal(plan.items.find((i) => i.title === 'Physics notes').open, '')
  assert.ok(plan.items.find((i) => i.title === 'Maths: practice').done.kind === 'block', 'his block: only ticked, the subject pick’s done hint isn’t used')
  assert.deepEqual(plan.hidden.slice(0, 2).map((h) => h.title), ['Flashcards', 'Lunch reading'])
})

test('fix 9: "things on Today" is todayItems; the To do card’s own limit says so', async () => {
  const { SETTINGS } = await import('../lib/settings.ts')
  assert.equal(SETTINGS.todayMax.label, 'Most tasks on the To do card')
  assert.match(SETTINGS.todayItems.label, /^Things on Today/)
})
