// Fix round, part C (the bot conversation), plain tests on Nat's real autumn (tests/support/nat-real.mjs): half-term
// 17 Oct – 1 Nov, ACT Sun 25 Oct, school back Mon 2 Nov; today Wed 21 Oct. Weeks THIS (19 Oct) / NEXT (26 Oct) / SCHOOL (2 Nov).
// 10: a message while a plan card waits is its own message unless it changes that plan · 13: an event change keeps the
// date he gave · 14: clean event titles. (11, a tap that arrives late, is in tests/fixround-c-chat.test.mjs.)
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/fixround-c-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editsPlan, namesRecordChange, otherWeek } from '../lib/telegram/converse.ts'
import { checkProposal, dateInWords, namedDates, nullify } from '../lib/capture/server.ts'
import { checkC2, eventDetails, shortPlace, timeInWords } from '../lib/telegram/actions-c2.ts'
import { DEFAULT_PLACES } from '../lib/setup.ts'
import { checkActions } from '../lib/telegram/actions.ts'
import { EVENTS, GOALS, NEXT, PLANNING, SCHOOL, TASKS, THIS, TODAY, day, ev } from './support/nat-real.mjs'

// ---------------------------------------------------------------------------
// 10: a message while a Your week card waits
// ---------------------------------------------------------------------------

/** A Your week card for the week of `mon` (from today in the week he's in, like the real card). */
const weekCard = (mon) => ({ payload: {
  week: { from: mon === THIS ? TODAY : mon, to: day(mon, 6) },
  yourWeek: {},
  blocks: [
    { title: 'Upper @ PureGym Swiss Cottage', kind: 'training', date: day(mon, 3) },
    { title: 'Speed + circuits', kind: 'training', date: day(mon, 2) },
    { title: 'FM homework: complex numbers ex 2B', kind: 'focus', date: day(mon, 1) },
  ],
} })
const decision = (intent, o = {}) => ({ intent, actions: [], asks: [], ...o })
const move = { op: 'event_move', ref: 'E1', value: '', date: '', date_to: day(NEXT, 2), time: '11:00', time_to: '', number: 0, words: 'Wed 28 Oct 11:00' }

test('10: a calendar change with a day (Owen Wed 28 Oct 11:00) while this week’s card waits is its own change card, not a re-plan of the card', () => {
  for (const mon of [THIS, NEXT, SCHOOL]) {
    assert.equal(editsPlan('Owen speed is Wed 28 Oct 11:00 next week', decision('instruction', { actions: [move] }), weekCard(mon), TODAY), false, mon)
    // a 'done' report, a new item or a question never changes the card either
    assert.equal(editsPlan('FM homework is done', decision('correction'), weekCard(mon), TODAY), false)
    assert.equal(editsPlan('Physics test on Thursday 5 Nov', decision('new'), weekCard(mon), TODAY), false)
    assert.equal(editsPlan('what’s my load on Sunday?', decision('question'), weekCard(mon), TODAY), false)
  }
})

test('10: a "correction" the AI reads into the week card is its own message unless it talks about the plan', () => {
  const card = weekCard(THIS)
  // (the AI called these corrections of the waiting week card on 21 Oct)
  assert.equal(editsPlan('Vlad’s mechanics questions need emailing to him by Wed 28 Oct', decision('correction'), card, TODAY), false)
  assert.equal(editsPlan('Chemistry corrections are due Friday', decision('correction'), card, TODAY), false)
  // real changes to the plan still re-plan it
  for (const m of ['no physics tonight', 'lighter on Saturday', 'start at 12', 'upper Sat at PureGym', 'upper on Friday instead'])
    assert.equal(editsPlan(m, decision('correction'), card, TODAY), true, m)
  assert.equal(editsPlan('lower light on Fri', decision('plan'), card, TODAY), true)
  // an instruction with no change it could make (it was about the card) re-plans it as before
  assert.equal(editsPlan('put upper on Sat', decision('instruction'), card, TODAY), true)
})

test('10: "plan next week" while this week’s card waits is a plan for next week (THIS → NEXT), not a change to this card; "this week" the other way', () => {
  assert.equal(otherWeek('plan next week', weekCard(THIS), TODAY), true)
  assert.equal(editsPlan('plan next week: Vlad, FM and physics', decision('plan'), weekCard(THIS), TODAY), false)
  assert.equal(otherWeek('plan next week', weekCard(NEXT), TODAY), false, 'the card waiting is next week’s already')
  assert.equal(otherWeek('plan this week again', weekCard(NEXT), TODAY), true)
  assert.equal(otherWeek('plan this week again', weekCard(THIS), TODAY), false)
  // on Sun 1 Nov (end of half-term) "next week" is the first school week: a card for it is the same week
  assert.equal(otherWeek('plan next week', weekCard(SCHOOL), day(NEXT, 6)), false)
  assert.equal(editsPlan('plan my week', decision('plan'), weekCard(THIS), TODAY), true)
})

// ---------------------------------------------------------------------------
// 13: an event change keeps the date he gave
// ---------------------------------------------------------------------------

// his Owen speed session (term: Tue 18:30); the sorter's answer for an event change, with date words in its own wording
const OWEN = ev({ id: 'owen-speed', title: 'Owen speed', repeat_days: [2], start_time: '18:30', end_time: '19:30', training_type: 'sprint' })
// his saved records' titles (open tasks, events, tests), as the bot reads them while a card waits; an Upper gym event too
const RECORDS = [...TASKS.filter((t) => !t.archived_at).map((t) => t.title), ...[...EVENTS, OWEN].map((e) => e.title), ...GOALS.map((x) => x.title), 'Upper · PureGym']
const capCtx = {
  today: TODAY, now: '18:00', subjects: [], projects: [], targets: [], events: [...EVENTS, OWEN], changes: [], tests: [], facts: [],
  openTasks: [], reminders: [], resources: [], loggedToday: [], planning: PLANNING, study: { stages: [], topics: [], progress: [] },
}
const sorted = (o) => nullify({
  kind: 'event_change', title: 'Owen speed', subject: '', importance: 'nice', due_date: '', window_label: '', window_end: '', duration_minutes: 0,
  origin: '', project: '', hand_in: '', someday: false, test_date: '', topics: '', priority: 'normal', reminder_kind: 'day', remind_date: '',
  remind_time: '', person: '', target: '', amount: 0, done_on: '', event: 'Owen speed', event_scope: 'week', new_date: '', new_start: '',
  new_end: '', cancel: false, url: '', resource_kind: 'link', fact: '', topic: '', stage: '', date_words: '', reasoning: '', ...o,
})

test('13: "Owen speed Wed 28 Oct 11:00" keeps Wed 28 Oct (NEXT, half-term), even when the AI words the date differently; no "removed a date"', () => {
  const p = checkProposal(sorted({ new_date: day(NEXT, 2), new_start: '11:00', date_words: 'Wednesday 28 October' }), 'Owen speed is Wed 28 Oct 11:00 this time', capCtx)
  assert.equal(p.new_date, '2026-10-28', 'the day he gave (it became Tue 27 Oct)')
  assert.equal(p.event_on_date, '2026-10-27', 'the session it changes: that week’s (normally Tue)')
  assert.equal(p.new_start, '11:00')
  assert.equal(p.new_end, '12:00', 'the session’s length kept')
  assert.ok(!p.notes.some((n) => /Removed a date/.test(n)), p.notes.join(' | '))
})

test('13: a date in the first school week (SCHOOL, Wed 4 Nov) changes that week’s session, not the next one (Tue 27 Oct)', () => {
  const p = checkProposal(sorted({ new_date: day(SCHOOL, 2), new_start: '17:00', date_words: '4 November' }), 'Owen speed moved to Wed 4 Nov 5pm', capCtx)
  assert.equal(p.new_date, '2026-11-04')
  assert.equal(p.event_on_date, '2026-11-03', 'the Tue 3 Nov session moves')
  assert.ok(!p.notes.some((n) => /Removed a date|same Mon–Sun week/.test(n)), p.notes.join(' | '))
})

test('13: a weekday alone in THIS week (“Fri”) grounds Fri 23 Oct; a date he never said is still removed', () => {
  assert.equal(dateInWords(day(THIS, 4), 'Owen speed Fri 11am', TODAY), true)
  assert.equal(dateInWords(day(NEXT, 4), 'Owen speed Fri 11am', TODAY), false, 'next week’s Friday is more than 7 days away')
  for (const words of ['Wed 28 Oct', '28th October', 'Oct 28', '28/10', 'on the 28th of October', '2026-10-28']) assert.equal(dateInWords('2026-10-28', words, TODAY), true, words)
  for (const words of ['Wed 4 Nov', '28 Nov', 'tomorrow', 'every month']) assert.equal(dateInWords('2026-10-28', words, TODAY), false, words)
  const p = checkProposal(sorted({ new_date: day(NEXT, 3), new_start: '11:00', date_words: 'Thursday' }), 'Owen speed at 11 this time', capCtx)
  assert.equal(p.new_date, null)
  assert.ok(p.notes.some((n) => /Removed a date/.test(n)))
})

// ---------------------------------------------------------------------------
// 14: clean event titles
// ---------------------------------------------------------------------------

const rows = { events: new Map(), changes: [], goals: new Map(), places: [], planning: PLANNING }
const newEvent = (value, date) => checkC2('event_new', { op: 'event_new', value, date, date_to: '', time: '15:00', time_to: '16:30', number: 0, words: 'Fri' }, undefined, rows, () => true, TODAY)

test('14: an extra upper in half-term (NEXT, Fri 30 Oct): “Upper · PureGym”, never “Upper (PureGym Swiss Cottage; type=upper)”; the type is its training type', () => {
  for (const value of ['Upper (PureGym Swiss Cottage; type=upper)', 'name=Upper; place=PureGym Swiss Cottage; type=upper', 'Upper; place=PureGym Swiss Cottage; type=upper']) {
    const a = newEvent(value, day(NEXT, 4)).action
    assert.ok(a, value)
    assert.equal(a.title, 'Upper · PureGym', value)
    assert.equal(a.patch.title, 'Upper · PureGym')
    assert.equal(a.patch.training_type, 'upper')
    assert.doesNotMatch(a.line, /type=|\(PureGym/)
  }
  // THIS week (Fri 23 Oct) and the first school week (Fri 6 Nov): the same
  assert.equal(newEvent('Upper (PureGym Swiss Cottage; type=upper)', day(THIS, 4)).action.title, 'Upper · PureGym')
  assert.equal(newEvent('Upper (PureGym Swiss Cottage; type=upper)', day(SCHOOL, 4)).action.title, 'Upper · PureGym')
  // plain names stay as they are (brackets with no details in them too)
  assert.equal(newEvent('Dentist', day(SCHOOL, 1)).action.title, 'Dentist')
  assert.equal(newEvent('Dentist (Dr Patel)', day(SCHOOL, 1)).action.title, 'Dentist (Dr Patel)')
  assert.equal(newEvent('title=At Gran’s', day(THIS, 5)).action.title, 'At Gran’s')
})

test('14: a weekly session with its details in the name, and a rename: clean too; the kv form is unchanged', () => {
  const weekly = (value) => checkC2('event_weekly', { op: 'event_weekly', value, date: '', date_to: '', time: '15:00', time_to: '16:30', number: 0, words: 'every Saturday' }, undefined, rows, () => true, TODAY).action
  const a = weekly('Upper (PureGym Swiss Cottage; type=upper)')
  assert.equal(a.title, 'Upper · PureGym')
  assert.equal(a.patch.training_type, 'upper')
  assert.equal(a.patch.new_place, 'PureGym Swiss Cottage', 'the place goes in its own field too')
  assert.equal(weekly('name=Club 360 Talent; place=Christchurch Finchley College; type=football').title, 'Club 360 Talent')
  const own = ev({ id: 'gym-sat', title: 'Upper (PureGym Swiss Cottage; type=upper)', repeat_days: [6], start_time: '15:00', end_time: '16:30' })
  const r = { ...rows, events: new Map([[own.id, own]]) }
  const rename = checkC2('event_set', { op: 'event_set', value: 'title=Upper (PureGym Swiss Cottage; type=upper)', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }, { kind: 'event', id: own.id }, r, () => true, TODAY)
  assert.equal(rename.action.patch.title, 'Upper · PureGym')
})

test('14: the pieces: details out of the name; a place’s short name leaves its area out', () => {
  assert.deepEqual(eventDetails('Upper (PureGym Swiss Cottage; type=upper)'), { name: 'Upper', kv: { name: 'Upper', place: 'PureGym Swiss Cottage', type: 'upper' }, inName: true, loosePlace: false })
  assert.equal(eventDetails('Owen training').name, 'Owen training')
  assert.equal(shortPlace('PureGym Swiss Cottage', DEFAULT_PLACES), 'PureGym')
  assert.equal(shortPlace('School gym', DEFAULT_PLACES), 'School gym')
  assert.equal(shortPlace('Christchurch Finchley College', []), 'Christchurch Finchley College')
})

// ---------------------------------------------------------------------------
// Second pass (review): the instruction path for 13, a record change the AI labels 'plan' (10), shortPlace (14)
// ---------------------------------------------------------------------------

/** checkC2 event_move for Owen speed (term: Tue 18:30) with what the AI sent and his own message (`said`), as the bot does. */
const owenMove = (said, o = {}) => checkC2('event_move',
  { op: 'event_move', ref: 'E1', value: '', date: '', date_to: '', time: '11:00', time_to: '', number: 0, words: 'Wednesday 28 October', said, ...o },
  { kind: 'event', id: OWEN.id }, { events: new Map([[OWEN.id, OWEN]]), changes: [], goals: new Map(), places: [], planning: PLANNING },
  (w) => w.length >= 3 && said.toLowerCase().includes(w.toLowerCase()), TODAY)

test('13 (instruction): "Owen moved to Wed 28 Oct 11:00" with date "" / the usual day and no date_to keeps Wed 28 Oct, not Tue 27 Oct; no “wasn’t in your words”', () => {
  for (const o of [{}, { date: day(NEXT, 1) }, { date_to: day(NEXT, 1) }, { date: day(NEXT, 2) }]) {
    const r = owenMove('Owen moved to Wed 28 Oct 11:00', o)
    assert.ok(r.action, `${JSON.stringify(o)}: ${r.problem}`)
    assert.equal(r.action.usualDate, '2026-10-27', 'the Tue 27 Oct session moves')
    assert.deepEqual(r.action.patch, { cancelled: false, new_date: '2026-10-28', new_start: '11:00', new_end: '12:00' }, JSON.stringify(o))
    assert.match(r.action.line, /Tue 27 Oct 18:30–19:30 → Wed 28 Oct 11:00–12:00/)
  }
  // his date in any common form, whatever the AI's words say
  for (const said of ['Owen moved to 28/10 at 11am', 'Owen is the 28th October 11:00 now', 'Owen speed Wednesday 28th 11:00', 'owen: oct 28, 11.00']) {
    const r = owenMove(said)
    assert.equal(r.action?.patch.new_date, '2026-10-28', `${said}: ${r.problem}`)
  }
  // a weekday alone: the AI's day stands when his words name it ("Wednesday" for Wed 28 Oct, 7 days on)
  assert.equal(owenMove('Owen moved to Wednesday 11:00', { date_to: day(NEXT, 2) }).action?.patch.new_date, '2026-10-28')
  // the first school week (SCHOOL): Wed 4 Nov moves the Tue 3 Nov session, not the next one
  const s = owenMove('Owen speed moved to Wed 4 Nov 5pm', { time: '17:00', words: 'Wednesday 4 November' })
  assert.equal(s.action?.usualDate, '2026-11-03', s.problem)
  assert.equal(s.action.patch.new_date, '2026-11-04')
  // THIS week: "Fri 23 Oct" (no session left this week) moves the next one to that Friday
  assert.equal(owenMove('Owen Fri 23 Oct 11:00', { words: 'Friday 23rd' }).action?.patch.new_date, '2026-10-23')
  // a day he never said is still refused
  assert.match(owenMove('Owen at 11 this time', { date_to: day(NEXT, 3), words: 'Thursday' }).problem, /wasn’t in your words/)
})

test('13: the pieces: dates named with a day number, and clock times in his words', () => {
  assert.deepEqual(namedDates('Owen moved to Wed 28 Oct 11:00', TODAY), ['2026-10-28'])
  assert.deepEqual(namedDates('Owen Wednesday 28th', TODAY), ['2026-10-28'])
  assert.deepEqual(namedDates('Owen Wed 11:00', TODAY), [], 'a clock time isn’t the 11th')
  assert.deepEqual(namedDates('upper on Friday', TODAY), [])
  assert.equal(dateInWords('2026-10-28', 'Owen speed Wednesday 28th', TODAY), true)
  for (const [t, w] of [['11:00', 'Wed 28 Oct 11:00'], ['11:00', 'at 11am'], ['11:00', 'at 11'], ['17:00', '5pm'], ['18:30', 'half 6'], ['18:30', '6.30']]) assert.equal(timeInWords(t, w), true, `${t} in ${w}`)
  for (const [t, w] of [['11:00', 'Wed 28 Oct'], ['17:00', '7pm'], ['18:30', 'half 7']]) assert.equal(timeInWords(t, w), false, `${t} in ${w}`)
})

test('10: a record change the AI labels “plan” while the week card waits is its own message; an edit OF the card still edits it', () => {
  for (const mon of [THIS, NEXT, SCHOOL]) {
    const card = weekCard(mon)
    assert.equal(editsPlan('Owen moved to Wed 28 Oct 11:00', decision('plan'), card, TODAY, RECORDS), false, mon)
    assert.equal(editsPlan('add physics homework due Friday', decision('plan'), card, TODAY, RECORDS), false, mon)
    assert.equal(editsPlan('add physics homework due Friday', decision('correction'), card, TODAY, RECORDS), false, '(it starts with “add”, but it’s a task)')
    for (const m of ['move upper on Friday to Saturday', 'less study Friday', 'redo', 'drop the FM block on Tuesday', 'swap Wednesday and Thursday'])
      assert.equal(editsPlan(m, decision('plan'), card, TODAY, RECORDS), true, m)
  }
  // (his saved records and the card waiting: a date / 'due' / 'moved' counts only for a record not on the card)
  const card = weekCard(THIS)
  assert.equal(namesRecordChange('Owen moved to Wed 28 Oct 11:00', TODAY, RECORDS, card), true)
  assert.equal(namesRecordChange('Owen speed Wed 28 Oct 11:00', TODAY, RECORDS, card), true, 'a date and a time: an event’s new day')
  assert.equal(namesRecordChange('physics homework is due Friday now', TODAY, RECORDS, card), true)
  assert.equal(namesRecordChange('nothing after 10pm from now on', TODAY), true)
  for (const m of ['move upper on Friday to Saturday', 'upper Sat at PureGym', 'less study Friday', 'start at 12', 'add the gym', 'redo']) assert.equal(namesRecordChange(m, TODAY, RECORDS, card), false, m)
})

test('14: “Upper · PureGym” whichever list has the place first (his places with another address, or no address), and whatever shape the AI sent', () => {
  const mine = [{ id: 'pl-pg', name: 'PureGym Swiss Cottage', address: 'Finchley Road, London NW3 6LU', lat: null, lng: null, is_home: false, archived_at: null }]
  // his places listed before his training places (the bug: only the first one's address was looked at)
  assert.equal(shortPlace('PureGym Swiss Cottage', [...mine, ...DEFAULT_PLACES]), 'PureGym')
  assert.equal(shortPlace('puregym swiss cottage', [{ ...mine[0], address: null }, ...DEFAULT_PLACES]), 'PureGym')
  // his own training places, the PureGym one with no address: its key still says the short name
  const onlyKey = [{ key: 'puregym', name: 'PureGym Swiss Cottage', address: null }]
  assert.equal(shortPlace('PureGym Swiss Cottage', [{ ...mine[0], address: null }, ...onlyKey]), 'PureGym')
  assert.equal(shortPlace('School gym', [...mine, ...DEFAULT_PLACES]), 'School gym')
  assert.equal(shortPlace('Home', [...mine, ...DEFAULT_PLACES]), 'Home')
  const r = { ...rows, places: mine }
  for (const value of ['Upper (PureGym Swiss Cottage; type=upper)', 'name=Upper; place=PureGym Swiss Cottage; type=upper', 'Upper (PureGym Swiss Cottage, type=upper)', 'Upper @ PureGym Swiss Cottage', 'Upper · PureGym Swiss Cottage']) {
    for (const mon of [THIS, NEXT, SCHOOL]) {
      const a = checkC2('event_new', { op: 'event_new', value, date: day(mon, 4), date_to: '', time: '15:00', time_to: '16:30', number: 0, words: 'Fri' }, undefined, r, () => true, TODAY).action
      assert.equal(a?.title, 'Upper · PureGym', `${value} (${mon})`)
      assert.doesNotMatch(a.line, /type=|\(PureGym|Swiss Cottage/)
      assert.equal(a.patch.place_id, 'pl-pg')
    }
  }
  const weekly = checkC2('event_weekly', { op: 'event_weekly', value: 'Upper (PureGym Swiss Cottage; type=upper)', date: '', date_to: '', time: '15:00', time_to: '16:30', number: 0, words: 'every Saturday' }, undefined, r, () => true, TODAY).action
  assert.equal(weekly.title, 'Upper · PureGym')
})

// ---------------------------------------------------------------------------
// Third pass: a date / 'due' / 'moved' is a record change only for a record not on the card (10); his message on its
// own for an event move (13); a place only from "X @ Y" (14)
// ---------------------------------------------------------------------------

/** Your week with his physics and English blocks on it too (the real card has his study blocks). */
const studyCard = (mon) => {
  const c = weekCard(mon)
  c.payload.blocks.push({ title: 'Physics: SHM booklet', kind: 'focus', date: day(mon, 2) }, { title: 'English essay: Macbeth', kind: 'focus', date: day(mon, 3) })
  return c
}
const RECORDS_EN = [...RECORDS, 'English essay: Macbeth']
const CARD_EDITS = ['move upper to Sat 31 Oct 3pm', 'put upper on Sat 31 Oct at 15:00', 'swap upper to 24 Oct 10am',
  'no physics tonight, it is not due till Friday', 'more English Thursday, essay due Friday', 'I moved upper to saturday']

test('10 (third pass): a session or block ON the card with a date+time / “due” / “moved” edits the waiting week card (no second week card)', () => {
  for (const mon of [THIS, NEXT, SCHOOL]) {
    const card = studyCard(mon)
    for (const m of CARD_EDITS) {
      assert.equal(namesRecordChange(m, TODAY, RECORDS_EN, card), false, `${m} (${mon})`)
      for (const intent of ['plan', 'correction']) assert.equal(editsPlan(m, decision(intent), card, TODAY, RECORDS_EN), true, `${m}: ${intent} (${mon})`)
    }
  }
})

test('10 (third pass): a saved record NOT on the card (Owen, the calendar event), or a new task, is still its own card', () => {
  for (const mon of [THIS, NEXT, SCHOOL]) {
    const card = studyCard(mon)
    for (const m of ['Owen moved to Wed 28 Oct 11:00', 'add physics homework due Friday']) {
      assert.equal(namesRecordChange(m, TODAY, RECORDS_EN, card), true, `${m} (${mon})`)
      for (const intent of ['plan', 'correction']) assert.equal(editsPlan(m, decision(intent), card, TODAY, RECORDS_EN), false, `${m}: ${intent} (${mon})`)
    }
    // the same words about a task that is NOT on this card: its own change
    assert.equal(namesRecordChange('Vlad mechanics questions are due Friday now', TODAY, RECORDS_EN, card), true)
    assert.equal(namesRecordChange('Chemistry corrections due Friday', TODAY, RECORDS_EN, card), true)
  }
  // "physics" alone is too common to name one record (his Physics lessons are every day): the AI's label decides
  assert.equal(namesRecordChange('physics is not due till Friday', TODAY, RECORDS, weekCard(THIS)), false)
})

test('13 (third pass): his message on more lines (“Owen moved to Wed 28 Oct”, a new line, “11:00”) keeps Wed 28 Oct; a date he said earlier isn’t used', () => {
  const rowsO = { events: new Map([[OWEN.id, OWEN]]), changes: [], goals: new Map(), places: [], planning: PLANNING }
  const ctxO = { today: TODAY, weekStart: THIS, snapshot: '', refs: new Map([['E1', { kind: 'event', id: OWEN.id, title: OWEN.title, status: null, deadline: null }]]) }
  const raw = { op: 'event_move', ref: 'E1', value: '', date: '', date_to: '', time: '11:00', time_to: '', number: 0, words: 'Wednesday 28 October' }
  for (const message of ['Owen moved to Wed 28 Oct\n11:00', 'Owen moved to\nWed 28 Oct\n11:00', 'Owen moved to\nWed 28 Oct 11:00', 'Owen moved to Wed 28 Oct 11:00\nthanks']) {
    // what converse sends: his last 30 minutes and this message, joined with new lines; and this message on its own
    const said = `what’s on Thursday?\n${message}`
    const r = checkActions([raw], ctxO, rowsO, said, TODAY, message)
    assert.equal(r.actions[0]?.patch.new_date, '2026-10-28', `${JSON.stringify(message)}: ${r.problems.join(' | ')}`)
    assert.equal(r.actions[0].usualDate, '2026-10-27')
    // checkC2 directly, with the message passed apart from `said`
    const c = owenMove(said, { message })
    assert.equal(c.action?.patch.new_date, '2026-10-28', `${JSON.stringify(message)}: ${c.problem}`)
  }
  // a date in something he said earlier (Thu 29 Oct) isn't this message's date
  const r = checkActions([{ ...raw, words: '' }], ctxO, rowsO, 'Owen Thu 29 Oct 11:00?\nOwen moved to Wed 28 Oct\n11:00', TODAY, 'Owen moved to Wed 28 Oct\n11:00')
  assert.equal(r.actions[0]?.patch.new_date, '2026-10-28', r.problems.join(' | '))
})

test('14 (third pass): “Dinner @ Nando’s” (a place he hasn’t saved) never makes or links a place; the title can stay “Dinner · Nando’s”', () => {
  const mine = [{ id: 'pl-pg', name: 'PureGym Swiss Cottage', address: 'Finchley Road, London NW3 6LU', lat: null, lng: null, is_home: false, archived_at: null },
    { id: 'pl-nandos-camden', name: 'Nando’s Camden', address: 'Camden High Street, London', lat: null, lng: null, is_home: false, archived_at: null }]
  const r = { ...rows, places: mine }
  for (const value of ['Dinner @ Nando\'s', 'Dinner · Nando\'s', 'Dinner @ Nando’s']) {
    for (const mon of [THIS, NEXT, SCHOOL]) {
      const one = checkC2('event_new', { op: 'event_new', value, date: day(mon, 4), date_to: '', time: '19:00', time_to: '', number: 0, words: 'Fri' }, undefined, r, () => true, TODAY).action
      assert.ok(one, value)
      assert.match(one.title, /^Dinner · Nando/)
      assert.equal(one.patch.place_id, undefined, `${value}: no place linked`)
      assert.equal(one.patch.new_place, undefined)
    }
    const weekly = checkC2('event_weekly', { op: 'event_weekly', value, date: '', date_to: '', time: '19:00', time_to: '', number: 0, words: 'every Friday' }, undefined, r, () => true, TODAY).action
    assert.ok(weekly, value)
    assert.match(weekly.title, /^Dinner · Nando/)
    assert.equal(weekly.patch.place_id, undefined, `${value}: no place linked`)
    assert.equal(weekly.patch.new_place, undefined, `${value}: no place made`)
    assert.doesNotMatch(weekly.line, /new place/)
  }
  assert.equal(eventDetails('Dinner @ Nando\'s').loosePlace, true)
  // a place he HAS saved still links ("Upper @ PureGym Swiss Cottage"); one he names as a place (place=…) is still made
  const gym = checkC2('event_weekly', { op: 'event_weekly', value: 'Upper @ PureGym Swiss Cottage', date: '', date_to: '', time: '15:00', time_to: '16:30', number: 0, words: 'every Saturday' }, undefined, r, () => true, TODAY).action
  assert.equal(gym.patch.place_id, 'pl-pg')
  assert.equal(gym.title, 'Upper · PureGym')
  const named = checkC2('event_weekly', { op: 'event_weekly', value: 'name=Dinner; place=Nando\'s Finchley', date: '', date_to: '', time: '19:00', time_to: '', number: 0, words: 'every Friday' }, undefined, r, () => true, TODAY).action
  assert.equal(named.patch.new_place, 'Nando\'s Finchley')
})

test('item 10 · his calendar’s everyday words (School, Maths, Physics, football) never make a card edit his own change; a distinctive name (Owen) does', async () => {
  const { namesRecordChange: change } = await import('../lib/telegram/converse.ts')
  const records = ['School', 'Maths', 'Physics', 'School football', 'Football training', 'Owen', 'Physics: SHM booklet']
  const card = { payload: { blocks: [{ title: 'Speed + circuits @ Owen', kind: 'training' }, { title: 'Upper @ PureGym', kind: 'training' }, { title: 'Physics: SHM booklet', kind: 'focus' }] } }
  for (const m of ['less physics Friday, move it to Sat 31 Oct 3pm', 'no maths after school on Thu 29 Oct at 5pm', 'football moved, so upper Sat 31 Oct 15:00',
    'no physics tonight, it is not due till Friday', 'more English Thursday, essay due Friday'])
    assert.equal(change(m, '2026-10-21', records, card), false, m)
  // "@ Owen" on the card is a place, not the session: his Owen event is still a record
  assert.equal(change('Owen moved to Wed 28 Oct 11:00', '2026-10-21', records, card), true)
  assert.equal(change('the SHM booklet is due Friday now', '2026-10-21', records, card), true)
})
