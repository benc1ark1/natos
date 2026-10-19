// Jarvis phase D1, plain tests: placing a plan into free time, the rules, and checking the planner's picks.
// Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeItems, planProblems, focusBudget } from '../lib/plan.ts'
import { freeSlots, DEFAULT_PLANNING } from '../lib/freetime.ts'
import { expandEvents } from '../lib/events.ts'
import { checkPlan } from '../lib/telegram/planner.ts'
import { planText } from '../lib/telegram/dayplan.ts'

const S = DEFAULT_PLANNING
const ev = (o) => ({
  id: o.title, title: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null,
  start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, ...o,
})
const SCHOOL = ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00' })
const FOOTBALL = ev({ title: 'Football', repeat_days: [4], start_time: '18:00', end_time: '19:30', travel_minutes: 25 })
const slotsOn = (date, events = [SCHOOL, FOOTBALL]) => freeSlots(expandEvents(events, date, date), date, S)
const THU = '2026-10-15'   // slots: 07:00–08:35, 16:10–17:25, 20:05–22:30 (heavy until 21:30)
const it = (title, minutes, kind = 'focus') => ({ title, minutes, kind, ref: null })

test('items go into the earliest gap with room, a break after each, heavy work never after 21:30', () => {
  const slots = slotsOn(THU).filter((s) => s.start >= '16:00')
  const { blocks, unplaced } = placeItems([it('SMC paper', 90), it('Physics homework', 45), it('Email Mr Khan', 15, 'light'), it('Upper body', 60, 'training'), it('Tidy desk', 20, 'light')], slots, S, { budget: null, energy: 'normal' })
  assert.deepEqual(blocks.map((b) => `${b.start}-${b.end} ${b.title}`), [
    '16:10-16:55 Physics homework', '17:05-17:20 Email Mr Khan', '20:05-21:05 Upper body', '21:15-21:35 Tidy desk',
  ])
  assert.deepEqual(unplaced.map((u) => `${u.title}: ${u.reason}`), ['SMC paper: only fits after 21:30, too late for it'])
  assert.deepEqual(planProblems(blocks, slots, S, null), [])
})

test('school-night focus limit; tired = less focus and no extra training; ill = only light things and rest', () => {
  assert.equal(focusBudget(true, S, 'normal'), 150)
  assert.equal(focusBudget(false, S, 'normal'), null)
  assert.equal(focusBudget(true, S, 'tired'), 90)
  assert.equal(focusBudget(false, S, 'ill'), 0)
  const day = slotsOn('2026-10-11', [])   // a free Sunday
  const items = [it('A', 60), it('B', 60), it('C', 60), it('Gym', 60, 'training'), it('Emails', 20, 'light'), it('Early night', 30, 'rest')]
  const school = placeItems(items, day, S, { budget: 150, energy: 'normal' })
  assert.equal(school.focusMinutes, 120)
  assert.match(school.unplaced.find((u) => u.title === 'C').reason, /over today’s 150 min/)
  const tired = placeItems(items, day, S, { budget: focusBudget(true, S, 'tired'), energy: 'tired' })
  assert.equal(tired.focusMinutes, 60)
  assert.match(tired.unplaced.find((u) => u.title === 'Gym').reason, /tired: no extra training/)
  const ill = placeItems(items, day, S, { budget: 0, energy: 'ill' })
  assert.deepEqual(ill.blocks.map((b) => b.title), ['Emails', 'Early night'])
})

test('rest ("early night") goes at the end of the day, never the morning', () => {
  const day = slotsOn('2026-10-11', [])   // 07:00–22:30 free
  const { blocks } = placeItems([it('Early night', 30, 'rest'), it('Revision', 60), it('Emails', 20, 'light')], day, S, { budget: null, energy: 'normal' })
  assert.deepEqual(blocks.map((b) => `${b.start}-${b.end} ${b.title}`), ['07:00-08:00 Revision', '08:10-08:30 Emails', '22:00-22:30 Early night'])
})

test('"I\'ve got 2 hours": nothing past the end of the window', () => {
  const day = slotsOn('2026-10-11', [])
  const { blocks } = placeItems([it('A', 60), it('B', 45), it('C', 30)], day.map((s) => ({ ...s, start: '16:00', end: '18:00' })), S, { budget: null, energy: 'normal', until: '18:00' })
  assert.ok(blocks.every((b) => b.end <= '18:00'), JSON.stringify(blocks))
  assert.equal(blocks.length, 2)
})

test('fuzz: random days and wishes never break a rule (no overlap, inside free time, cut-offs, limits)', () => {
  let seed = 7
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n }
  const kinds = ['focus', 'light', 'training', 'rest']
  for (let round = 0; round < 300; round++) {
    const events = Array.from({ length: rnd(5) }, (_, i) => {
      const start = 7 * 60 + rnd(14 * 60)
      const len = 30 + rnd(180)
      const hm = (m) => `${String(Math.floor(Math.min(m, 1439) / 60)).padStart(2, '0')}:${String(Math.min(m, 1439) % 60).padStart(2, '0')}`
      return ev({ title: `E${i}`, repeat_days: [3], start_time: hm(start), end_time: hm(start + len), travel_minutes: rnd(3) * 15 })
    })
    const slots = slotsOn('2026-10-14', events)
    const items = Array.from({ length: 1 + rnd(9) }, (_, i) => it(`T${i}`, 10 + rnd(150), kinds[rnd(4)]))
    const energy = ['normal', 'tired', 'ill'][rnd(3)]
    const budget = focusBudget(rnd(2) === 1, S, energy)
    const { blocks } = placeItems(items, slots, S, { budget, energy })
    assert.deepEqual(planProblems(blocks, slots, S, budget), [], `round ${round}`)
    if (energy === 'ill') assert.ok(blocks.every((b) => b.kind === 'light' || b.kind === 'rest'))
  }
})

test('clock-change day (25 Oct, BST -> GMT): blocks still sit in free time', () => {
  const back = ev({ title: 'Back', starts_at: '2026-10-25T17:00:00Z', ends_at: '2026-10-25T18:00:00Z' })   // 17:00 London
  const slots = slotsOn('2026-10-25', [back])
  const { blocks } = placeItems([it('Long revision', 240), it('More', 120)], slots, S, { budget: null, energy: 'normal' })
  assert.deepEqual(planProblems(blocks, slots, S, null), [])
  assert.ok(blocks.every((b) => b.end <= '16:50' || b.start >= '18:10'))
})

test('the planner’s picks: real records only (or rest), no duplicates, sane minutes', () => {
  const refs = new Map([['T1', { kind: 'task', id: 't1', title: 'Physics homework' }], ['W1', { kind: 'target', id: 'w1', title: 'Upper body' }], ['M1', { kind: 'reminder', id: 'm1', title: 'PE kit' }]])
  const r = checkPlan({ items: [
    { ref: 'T1', title: '', minutes: 45, kind: 'focus', focus: 'Q1–8', why: 'due Fri' },
    { ref: 'T1', title: '', minutes: 30, kind: 'focus', focus: '', why: '' },
    { ref: 'T99', title: 'Invented', minutes: 30, kind: 'focus', focus: '', why: '' },
    { ref: 'M1', title: '', minutes: 5, kind: 'light', focus: '', why: '' },
    { ref: '', title: 'Early night', minutes: 30, kind: 'rest', focus: '', why: '' },
    { ref: 'W1', title: '', minutes: 999, kind: 'training', focus: '', why: '' },
  ], note: 'ok', push_back: '' }, { refs })
  assert.deepEqual(r.items.map((x) => `${x.title}|${x.minutes}|${x.kind}`), ['Physics homework · Q1–8|45|focus', 'Early night|30|rest', 'Upper body|240|training'])
  assert.equal(r.dropped, 3, 'the repeat, the invented task and the reminder')
})

test('the card: a timeline, what didn’t fit, and what ✅ will also do', () => {
  const p = { date: '2026-10-10', energy: 'tired', energyGiven: true, note: 'SMC first.', pushBack: 'Put off 3 times: tonight it is.',
    blocks: [{ start: '16:10', end: '17:40', title: 'SMC <past> paper', kind: 'focus', ref: { kind: 'task', id: 't2' } }, { start: '17:50', end: '18:05', title: 'Email', kind: 'light', ref: null }],
    unplaced: [{ title: 'Upper body', minutes: 60, reason: 'you’re tired: no extra training' }] }
  const t = planText(p, true, { tasks: [{ id: 't2', status: 'this_week', archived_at: null }] })
  assert.match(t, /^🗓 <b>Plan · today<\/b> <i>\(tired: a lighter day\)<\/i>\n16:10–17:40 <b>SMC &lt;past&gt; paper<\/b> <i>· focus<\/i>\n17:50–18:05 Email <i>· light<\/i>/)
  assert.match(t, /Didn’t fit: Upper body \(you’re tired: no extra training\)/)
  assert.match(t, /🤔 Put off 3 times/)
  assert.match(t, /✅ also moves 1 task to Today and notes you’re tired today/)
})

test('the database accepts every message type and card kind the bot uses (latest SQL wins)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { INTENTS } = await import('../lib/telegram/brain.ts')
  const { fileURLToPath } = await import('node:url')
  const dir = fileURLToPath(new URL('../supabase/', import.meta.url))
  const files = readdirSync(dir).filter((f) => /^jarvis-.*\.sql$/.test(f)).sort()
  const lastList = (name) => {
    let found = null
    for (const f of files) for (const m of readFileSync(dir + f, 'utf8').matchAll(new RegExp(`${name}\\s+check \\((?:\\w+) in \\(([^)]*)\\)\\)`, 'g'))) found = m[1]
    return (found ?? '').split(',').map((x) => x.trim().replace(/'/g, ''))
  }
  const intents = lastList('telegram_turns_intent_check')
  for (const i of [...INTENTS, 'command', 'tap', 'failed']) assert.ok(intents.includes(i), `telegram_turns allows intent "${i}"`)
  const kinds = lastList('telegram_pending_kind_check')
  for (const k of ['capture', 'fact', 'action', 'plan']) assert.ok(kinds.includes(k), `telegram_pending allows kind "${k}"`)
})
