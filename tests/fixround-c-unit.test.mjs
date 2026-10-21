// Fix round, part C (the bot conversation), plain tests on Nat's real autumn (tests/support/nat-real.mjs): half-term
// 17 Oct – 1 Nov, ACT Sun 25 Oct, school back Mon 2 Nov; today Wed 21 Oct. Weeks THIS (19 Oct) / NEXT (26 Oct) / SCHOOL (2 Nov).
// 10: a message while a plan card waits is its own message unless it changes that plan · 13: an event change keeps the
// date he gave · 14: clean event titles. (11, a tap that arrives late, is in tests/fixround-c-chat.test.mjs.)
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/fixround-c-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { editsPlan, otherWeek } from '../lib/telegram/converse.ts'
import { checkProposal, dateInWords, nullify } from '../lib/capture/server.ts'
import { checkC2, eventDetails, shortPlace } from '../lib/telegram/actions-c2.ts'
import { DEFAULT_PLACES } from '../lib/setup.ts'
import { EVENTS, NEXT, PLANNING, SCHOOL, THIS, TODAY, day, ev } from './support/nat-real.mjs'

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
  assert.deepEqual(eventDetails('Upper (PureGym Swiss Cottage; type=upper)'), { name: 'Upper', kv: { name: 'Upper', place: 'PureGym Swiss Cottage', type: 'upper' }, inName: true })
  assert.equal(eventDetails('Owen training').name, 'Owen training')
  assert.equal(shortPlace('PureGym Swiss Cottage', DEFAULT_PLACES), 'PureGym')
  assert.equal(shortPlace('School gym', DEFAULT_PLACES), 'School gym')
  assert.equal(shortPlace('Christchurch Finchley College', []), 'Christchurch Finchley College')
})
