// Fix round part A (21 Oct 2026): the training planner on his real autumn (tests/support/nat-real.mjs), no database.
// THIS week (19 Oct, ACT retake Sun 25 Oct), NEXT week (26 Oct, half-term) and the first SCHOOL week (2 Nov, FM HT2 Wed).
// Item 2: no training on a test day, light only the day before · 3: holidays turn off everything school-linked and use
// the holiday Owen day · 4: "upper 3× until 1 Nov" ends by itself (2× from 2 Nov) · 5: never two of the same session in
// a day, a typed week merges · 12: 1️⃣ on a clash with the typed week never sends "week:1" to the database · 15: the
// "Owen's days may need updating" card only when it's genuinely better, worked out on a school week.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/fixround-a-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holidayChanges } from '../lib/today/holidays.ts'
import { expandEvents } from '../lib/events.ts'
import { planTraining, optWorldOf } from '../lib/week.ts'
import { planningSettings } from '../lib/freetime.ts'
import { moreSettings } from '../lib/settings.ts'
import { planningEvents, shapesFor, fixedDaysFor } from '../lib/setup.ts'
import { upperWeek } from '../lib/setup-edit.ts'
import { mentalDays } from '../lib/mental.ts'
import { DEFAULT_RULES, DEFAULT_TYPES } from '../lib/training.ts'
import { addDays, isoDow } from '../lib/time.ts'
import { weekEvents, weekNoteWithout, isWeekRow, itemsWithout } from '../lib/telegram/weekread.ts'
import { clashOptions } from '../lib/telegram/ripple.ts'
import { typicalFrom, typicalOwen, owenUpdate } from '../lib/telegram/owen.ts'
import { EVENTS, PLANNING, GOALS, THIS, NEXT, SCHOOL, TODAY, ACT_DAY, HALF_TERM, day, ev, at } from './support/nat-real.mjs'

const HT2 = '2026-11-04'
/** The bot's week world (lib/telegram/ripple.ts loadWorld, without the database) for the week starting `mon`. */
function world(mon, { planning = PLANNING, events = EVENTS, today = TODAY, goals = GOALS, extra = [] } = {}) {
  const from = today > mon ? today : mon, to = addDays(mon, 6)
  const all = [...events, ...extra]
  const ch = holidayChanges(all, [], planning, addDays(from, -1), addDays(to, 1))
  const evs = planningEvents(all, ch, planning, addDays(mon, -7), addDays(mon, 13), goals.map((g) => g.target_date))
  const shapes = shapesFor(planning, evs, ch, goals, addDays(from, -1), addDays(to, 1))
  const settings = { ...planningSettings(planning), dayBounds: (x) => { const s = shapes.get(x); return s ? { start: s.morningEnd, end: s.nightStart } : null } }
  const mental = mentalDays({ from: addDays(from, -1), to, planning, events: evs, changes: ch, goals, tasks: [], blocks: [] })
  return { today, nowMin: 9 * 60, from, to, settings, events: evs, changes: ch, targets: [], logs: [], weekCounts: [], rules: DEFAULT_RULES,
    energy: new Map(), planned: [], travel: null, types: DEFAULT_TYPES, trainingFrom: '15:00', costs: [], load: moreSettings(planning), planning, mental, done: [] }
}
const on = (p, date) => p.placed.filter((s) => s.date === date)
const uppers = (p) => p.placed.filter((s) => s.type === 'upper')
const lines = (p) => p.placed.map((s) => `${s.date} ${s.start} ${s.title} ${s.intensity}`).join('\n')

// ---------------------------------------------------------------------------
// Item 2: test days
// ---------------------------------------------------------------------------

test('item 2 · THIS week: nothing on the ACT day (Sun 25 Oct), only light on Sat 24; the upper shortfall says why', () => {
  const p = planTraining(world(THIS))
  assert.deepEqual(on(p, ACT_DAY), [], `no gym, no training on the ACT day:\n${lines(p)}`)
  const sat = on(p, day(THIS, 5))
  assert.ok(sat.every((s) => s.intensity === 'light'), `Sat 24 Oct (the day before) light only:\n${lines(p)}`)
  // upper is 3× this week by his rule, but its days are Wed–Fri now (Sun is the test, Sat is light only)
  assert.ok(uppers(p).every((s) => s.date < day(THIS, 5)), lines(p))
  assert.equal(p.upper.count, uppers(p).length)
  assert.match(p.upper.reason, /you asked for 3×\): no training on Sun \(ACT retake\) and only light the day before/)
  const ow = optWorldOf(world(THIS))
  assert.ok(!ow.rooms.some((r) => r.date === ACT_DAY), 'the test day has no training room at all')
  assert.match(ow.lightOnly.get(day(THIS, 5)), /the day before ACT retake/)
})

test('item 2 · SCHOOL week: a class test on a school day (FM HT2, Wed 4 Nov) is a normal day, like the study planner; Owen’s speed stays Tue 18:30', async () => {
  const { testDaysOf } = await import('../lib/week.ts')
  const w = world(SCHOOL)
  const t = testDaysOf(w)
  assert.ok(!t.on.has(HT2) && !t.eve.has(day(SCHOOL, 1)), 'HT2 on a school day doesn’t take the day')
  const p = planTraining(w)
  const speed = p.placed.find((s) => s.key.startsWith('speed#'))
  assert.deepEqual([speed.date, speed.start], [day(SCHOOL, 1), '18:30'], lines(p))
  assert.ok(p.placed.some((s) => s.date === HT2), `training is allowed on a school-day test:
${lines(p)}`)
  // the ACT on Sun 25 Oct (no school) still takes the day
  assert.ok(testDaysOf(world(THIS)).on.has(ACT_DAY))
})

// ---------------------------------------------------------------------------
// Item 3: holidays
// ---------------------------------------------------------------------------

test('item 3 · half-term: school, school football and the school gym are off; Owen’s speed is its holiday version (Wed 11:00)', () => {
  const p = planTraining(world(NEXT))
  const titles = (d) => expandEvents(world(NEXT).events, d, d, world(NEXT).changes).filter((o) => !o.cancelled).map((o) => o.event.title)
  assert.ok(!titles(day(NEXT, 1)).includes('School football'), 'Tue 27 Oct: no school football')
  assert.ok(!titles(day(NEXT, 1)).includes('School'))
  assert.ok(!p.placed.some((s) => s.place === 'school_gym'), 'no school gym in the holidays')
  const speed = p.placed.find((s) => s.key.startsWith('speed#'))
  assert.equal(speed.date, day(NEXT, 2))
  assert.equal(speed.start, '11:00')
  // back at school: the term version (Tue 18:30 after school football)
  const s2 = planTraining(world(SCHOOL)).placed.find((s) => s.key.startsWith('speed#'))
  assert.deepEqual([s2.date, s2.start], [day(SCHOOL, 1), '18:30'])
  assert.ok(expandEvents(world(SCHOOL).events, day(SCHOOL, 1), day(SCHOOL, 1), world(SCHOOL).changes).some((o) => o.event.title === 'School football' && !o.cancelled))
})

test('item 3 · a Google copy of “School football” (no school flag) is off in half-term too; back on 3 Nov', () => {
  const copies = [day(NEXT, 1), day(SCHOOL, 1)].map((d) => ev({ id: `g:sf:${d}`, title: 'School football', starts_at: at(d, '16:20'), ends_at: at(d, '17:30'), external_source: 'google', training_type: 'football', load: 'hard' }))
  const events = [...EVENTS.filter((e) => e.id !== 'school-football'), ...copies]
  const ch = holidayChanges(events, [], PLANNING, NEXT, addDays(SCHOOL, 6))
  const live = (d) => expandEvents(events, d, d, ch).filter((o) => !o.cancelled && o.event.title === 'School football').length
  assert.equal(live(day(NEXT, 1)), 0, 'half-term: off')
  assert.equal(live(day(SCHOOL, 1)), 1, 'school week: on')
})

test('item 3 · a session that can only happen at school (school gym only) is off in half-term, not “not placed”', () => {
  const planning = { ...PLANNING, sessionTypes: [
    { key: 'bench', name: 'Bench', type: 'upper', intensity: 'moderate', minutes: 40, perWeek: 1, places: ['school_gym'] },
    { key: 'core', name: 'Core', type: 'core', intensity: 'light', minutes: 20, perWeek: 1, places: ['home'] },
  ], owenDays: null, upperWeeks: {} }
  const half = planTraining(world(NEXT, { planning }))
  assert.ok(!half.placed.some((s) => s.title === 'Bench') && !half.tbc.some((t) => t.title === 'Bench'), JSON.stringify(half.tbc))
  const term = planTraining(world(SCHOOL, { planning }))
  assert.ok(term.placed.some((s) => s.title === 'Bench' && s.place === 'school_gym'), lines(term))
})

// ---------------------------------------------------------------------------
// Item 4: "upper 3× until 1 Nov" ends by itself
// ---------------------------------------------------------------------------

test('item 4 · upper 3× in half-term, back to 2× (his set-up) from Mon 2 Nov; holiday days only in holiday weeks', () => {
  assert.equal(upperWeek(PLANNING, NEXT), 3)
  assert.equal(upperWeek(PLANNING, SCHOOL), null, 'the rule has ended')
  const next = planTraining(world(NEXT))
  assert.equal(uppers(next).length, 3, lines(next))
  assert.equal(next.upper.reason, '3× (your choice)')
  const school = planTraining(world(SCHOOL))
  assert.equal(uppers(school).length, 2, `back to normal: 2 uppers\n${lines(school)}`)
  assert.equal(school.upper.reason, '2× (your set-up)')
  assert.ok(uppers(school).some((s) => isoDow(s.date) === 6), 'Saturday as usual')
  assert.deepEqual(fixedDaysFor(PLANNING, true).days.speed, [3], 'half-term: speed Wed')
  assert.deepEqual(fixedDaysFor(PLANNING, false).days.speed, [2], 'term: speed Tue')
  // the reason always says the number that is planned (it said “2× (your choice)” with 3 on the card)
  const p = planTraining(world(THIS))
  assert.match(p.upper.reason, new RegExp(`^${uppers(p).length}×`))
})

// ---------------------------------------------------------------------------
// Item 5: one of each session a day; a typed week merges
// ---------------------------------------------------------------------------

test('item 5 · never two uppers on one day (it put upper Fri 12:30 AND 15:00)', () => {
  const fri = day(NEXT, 4)
  const pins = new Map([['upper#1', { date: fri, start: '12:30' }], ['upper#x1', { date: fri, start: '15:00' }]])
  const p = planTraining({ ...world(NEXT), pins }, { pins })
  assert.equal(uppers(p).filter((s) => s.date === fri).length, 1, lines(p))
  for (const d of new Set(p.placed.map((s) => s.date))) {
    const types = on(p, d).filter((s) => s.type !== 'mobility').map((s) => s.type)
    assert.equal(new Set(types).size, types.length, `${d}: ${types.join(', ')}`)
  }
})

test('item 5 · a typed “Gym Sat 10:00” or “Owen Wed 11:00” is that day’s session: nothing of the same kind on top', () => {
  const note = (title, d, s, e, type) => ({ ...ev({ id: `week:${title}`, title, starts_at: at(d, s), ends_at: at(d, e), external_source: 'week' }), training_type: type, load: null })
  const sat = day(NEXT, 5), wed = day(NEXT, 2)
  // Saturday is his usual upper day: the typed gym session that morning is it (it used to add a second one at 15:00)
  const p = planTraining(world(NEXT, { extra: [note('Gym', sat, '10:00', '11:30', null), note('Owen', wed, '11:00', '12:00', null)] }))
  assert.ok(!uppers(p).some((s) => s.date === sat), `no upper on top of the typed gym session:\n${lines(p)}`)
  assert.ok(!p.placed.some((s) => s.type === 'sprint'), 'his typed Owen session is this week’s speed: not planned twice')
})

// ---------------------------------------------------------------------------
// Item 12: 1️⃣ on a clash with the typed week
// ---------------------------------------------------------------------------

test('item 12 · rows of the typed week are items[N]; 1️⃣ leaves that item out of the week note (no “week:1” id)', () => {
  const wed = day(THIS, 2), thu = day(THIS, 3)
  const items = [
    { date: wed, start: '19:00', end: '20:30', title: 'Football training', kind: 'training', training_type: 'football', intensity: '', travel_minutes: 0 },   // already in his calendar: left out
    { date: thu, start: '11:00', end: '12:00', title: 'Dentist', kind: 'other', training_type: '', intensity: '', travel_minutes: 0 },
    { date: thu, start: '17:00', end: '18:00', title: 'Owen', kind: 'training', training_type: 'sprint', intensity: '', travel_minutes: 0 },
  ]
  const raw = items.map((x) => ({ ...x }))
  const sent = items.map((x, i) => ({ ...x, note: { id: '6f1c2a40-0000-4000-8000-000000000001', i, items: raw } }))
  // the first item is already in his calendar (left out): the others keep their own index (they used to be renumbered)
  const w0 = world(THIS)
  const rows = weekEvents(sent, w0.events, w0.changes)
  assert.deepEqual(rows.map((r) => [r.id, r.title]), [['week:1', 'Dentist'], ['week:2', 'Owen']])
  assert.ok(rows.every((r) => isWeekRow(r.id)))
  assert.deepEqual(weekNoteWithout('week:1', sent), { id: '6f1c2a40-0000-4000-8000-000000000001', items: [raw[0], raw[2]], item: raw[1] })
  assert.equal(weekNoteWithout('week:9', sent), null)

  // his own weekly "Owen training" (Tue 18:30) moved to Thu 11:00: on top of the typed Dentist
  const owen = ev({ id: '0e0e0e0e-0000-4000-8000-000000000002', title: 'Owen training', repeat_days: [2], start_time: '18:30', end_time: '19:30', training_type: 'sprint', load: 'hard' })
  const w = { ...w0, events: [...w0.events, owen, ...rows], sent }
  const move = (start, end) => ({ op: 'event_move', table: 'event_exceptions', id: owen.id, title: owen.title, usualDate: day(THIS, 1), line: `Owen training → Thu ${start}–${end}`,
    patch: { cancelled: false, new_date: thu, new_start: start, new_end: end } })
  const c = clashOptions(w, [move('11:00', '12:00')])
  assert.ok(c, 'a clash with the typed Dentist')
  const cancel = c.options[0].actions.at(-1)
  assert.equal(cancel.table, 'week_notes')
  assert.equal(cancel.id, '6f1c2a40-0000-4000-8000-000000000001', 'the week note’s own id')
  assert.deepEqual(cancel.patch, { drop_item: raw[1] }, 'the item itself, taken out of the note as it is when tapped (not a copy of the whole list)')
  assert.ok(!JSON.stringify(c.options).includes('"week:'), 'no week:N id in any option')
  assert.match(cancel.line, /Dentist<\/b> that day: → left out of the week you sent/)

  // onto the typed "Owen" at 17:00: the same session, not a clash
  assert.equal(clashOptions(w, [move('17:00', '18:00')]), null)
})

test('item 12 · two items left out of the same week note (one card or two) both stay out', () => {
  const thu = day(THIS, 3), fri = day(THIS, 4)
  const items = [
    { date: thu, start: '11:00', end: '12:00', title: 'Dentist', kind: 'other', training_type: '', intensity: '', travel_minutes: 0 },
    { date: fri, start: '15:00', end: '16:00', title: 'Haircut', kind: 'other', training_type: '', intensity: '', travel_minutes: 0 },
    { date: thu, start: '17:00', end: '18:00', title: 'Owen', kind: 'training', training_type: 'sprint', intensity: '', travel_minutes: 0 },
  ]
  const sent = items.map((x, i) => ({ ...x, note: { id: 'n1', i, items } }))
  const w0 = world(THIS)
  const rows = weekEvents(sent, w0.events, w0.changes)
  const owen = ev({ id: '0e0e0e0e-0000-4000-8000-000000000002', title: 'Owen training', repeat_days: [2], start_time: '18:30', end_time: '19:30', training_type: 'sprint', load: 'hard' })
  const upper = ev({ id: '0e0e0e0e-0000-4000-8000-000000000003', title: 'Upper', repeat_days: [5], start_time: '12:00', end_time: '13:00', training_type: 'upper', load: 'hard' })
  const w = { ...w0, events: [...w0.events, owen, upper, ...rows], sent }
  const move = (e, usual, date, start, end) => ({ op: 'event_move', table: 'event_exceptions', id: e.id, title: e.title, usualDate: usual, line: `${e.title} → ${start}–${end}`,
    patch: { cancelled: false, new_date: date, new_start: start, new_end: end } })
  // both cards built from the same note: Owen onto the dentist, upper onto the haircut
  const a = clashOptions(w, [move(owen, day(THIS, 1), thu, '11:00', '12:00')]).options[0].actions.at(-1)
  const b = clashOptions(w, [move(upper, day(THIS, 4), fri, '15:00', '16:00')]).options[0].actions.at(-1)
  assert.deepEqual([a.id, b.id], ['n1', 'n1'])
  // tapped in turn, each applies to the note as it is then: both stay out (it used to put the first one back)
  // (the database hands the items back with their fields in its own order)
  const shuffled = (xs) => xs.map((x) => Object.fromEntries(Object.entries(x).reverse()))
  const once = itemsWithout(shuffled(items), a.patch.drop_item)
  assert.deepEqual(once.map((x) => x.title), ['Haircut', 'Owen'])
  const twice = itemsWithout(shuffled(once), b.patch.drop_item)
  assert.deepEqual(twice.map((x) => x.title), ['Owen'])
  // an item already gone: nothing else is taken out
  assert.deepEqual(itemsWithout(twice, a.patch.drop_item).map((x) => x.title), ['Owen'])
  assert.deepEqual(itemsWithout(null, a.patch.drop_item), [])
})

// ---------------------------------------------------------------------------
// Item 15: "Owen's days may need updating"
// ---------------------------------------------------------------------------

test('item 15 · the typical week is a school week: on Wed 21 Oct that’s 2 Nov (not the half-term week)', () => {
  assert.equal(typicalFrom(TODAY, PLANNING), SCHOOL)
  assert.equal(typicalFrom(TODAY, { holidays: 'none' }), NEXT)
  assert.equal(typicalFrom('2026-11-04', PLANNING), '2026-11-09')
  // planned on a half-term week's data, the typical week still has school and no holiday Owen day
  const t = typicalOwen({ ...world(NEXT), from: NEXT })
  assert.ok(!t.plan.placed.some((s) => s.key.startsWith('speed#') && s.start === '11:00'), 'not the half-term Wed 11:00')
})

test('item 15 · his saved days on his real week: no “may need updating” card (nothing clearly better, every session placed)', () => {
  const t = typicalOwen(world(SCHOOL))
  assert.equal(owenUpdate(t, PLANNING.owenDays, PLANNING), false)
  // ✅ never wipes a day: a session with no better day keeps the one it has, and his own fixed days (upper) stay
  for (const k of ['speed', 'heavy_lower']) assert.ok(t.days[k]?.length, `${k}: ${JSON.stringify(t.days)}`)
})

test('item 15 · only sessions he gave Owen count, and only a genuinely better week', () => {
  const t = typicalOwen(world(SCHOOL))
  // injury/core days differ from nothing he saved: not a reason for a card (it used to suggest “injury Mon”)
  assert.equal(owenUpdate({ ...t, days: { ...t.days, injury: [1], core: [6] } }, { speed: t.days.speed, heavy_lower: t.days.heavy_lower }, PLANNING), false)
  // a suggestion that leaves Owen’s speed out (“no room for speed”) is never sent
  assert.equal(owenUpdate({ ...t, days: { ...t.days, speed: [4] }, plan: { ...t.plan, tbc: [{ key: 'speed#1', title: 'Speed + circuits', reason: 'no room' }] } }, { speed: [2] }, PLANNING), false)
  // a day that really doesn't work (heavy lower on Sunday, the game day) → yes, when the new week places everything
  const light = EVENTS.filter((e) => e.id !== 'club-football')
  const planning = { ...PLANNING, owenDays: { speed: [2], heavy_lower: [7] } }
  const bad = typicalOwen(world(SCHOOL, { planning, events: light }))
  assert.ok(!bad.days.heavy_lower.includes(7), JSON.stringify(bad.days))
  assert.equal(owenUpdate(bad, planning.owenDays, planning), true)
})

test('item 15 · a better-looking week that makes one of Owen’s sessions lighter is never suggested, even when his days don’t work', () => {
  const light = EVENTS.filter((e) => e.id !== 'club-football')
  const planning = { ...PLANNING, owenDays: { speed: [2], heavy_lower: [7] } }
  const bad = typicalOwen(world(SCHOOL, { planning, events: light }))
  assert.equal(owenUpdate(bad, planning.owenDays, planning), true)
  const lighter = { ...bad, plan: { ...bad.plan, placed: bad.plan.placed.map((x) => (bad.plan.sessionOf[x.key] === 'speed' ? { ...x, intensity: 'light' } : x)), cost: bad.plan.cost - 1000 } }
  assert.equal(owenUpdate(lighter, planning.owenDays, planning), false)
  assert.equal(owenUpdate({ ...bad, kept: null }, planning.owenDays, planning), false, 'no saved-days plan to compare with: no card')
})

test('real data sanity: half-term runs 17 Oct – 1 Nov', () => {
  assert.deepEqual(HALF_TERM, { from: '2026-10-17', to: '2026-11-01' })
})
