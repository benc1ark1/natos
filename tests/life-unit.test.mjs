// Queue item 4: events and life by chat, the plain-code parts (no database, no AI): the casual-words parser, which of
// his events his words mean, routines and the week's priorities, and where a moved session goes.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/life-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'

const P = () => import('../lib/life/parse.ts')
const FRI = '2026-10-23', SUN = '2026-10-25', MON = '2026-10-19'

/** [his words, today, minutes now (null = start of the day), what it should read as: [title, date, start, end, guessed minutes] or null] */
const NEW = [
  // the queue's examples
  ['out with friends tomorrow 2–9pm', MON, null, ['Out with friends', '2026-10-20', '14:00', '21:00', null]],
  ['family dinner Sat 7', MON, null, ['Family dinner', '2026-10-24', '19:00', '21:00', 120]],
  ['football Wed 7:45', MON, null, ['Football', '2026-10-21', '19:45', '21:15', 90]],
  ['dentist Thursday 3:30', MON, null, ['Dentist', '2026-10-22', '15:30', '16:30', 60]],
  ['cinema with Sam Friday 8-11', MON, null, ['Cinema with Sam', '2026-10-23', '20:00', '23:00', null]],
  ['revision session at school Tue 4-5:30', MON, null, ['Revision session at school', '2026-10-20', '16:00', '17:30', null]],
  // typos and short forms
  ['football tmrw 7', MON, null, ['Football', '2026-10-20', '19:00', '20:30', 90]],
  ['dinner tomoz 8pm', MON, null, ['Dinner', '2026-10-20', '20:00', '22:00', 120]],
  ['party 2moro 9', MON, null, ['Party', '2026-10-20', '21:00', '23:59', 180]],
  ['footy weds 6', MON, null, ['Footy', '2026-10-21', '18:00', '19:30', 90]],
  ['dentist thrusday 4pm', MON, null, ['Dentist', '2026-10-22', '16:00', '17:00', 60]],
  ['gym thurs 7pm', MON, null, ['Gym', '2026-10-22', '19:00', '20:00', 60]],
  ['out with friends tomorrow 2-9', MON, null, ['Out with friends', '2026-10-20', '14:00', '21:00', null]],
  // times said casually
  ['dinner Sat half 7', MON, null, ['Dinner', '2026-10-24', '19:30', '21:30', 120]],
  ['dinner Sat half past 6', MON, null, ['Dinner', '2026-10-24', '18:30', '20:30', 120]],
  ['party Fri quarter to 8', MON, null, ['Party', '2026-10-23', '19:45', '22:45', 180]],
  ['football Wed quarter past 7', MON, null, ['Football', '2026-10-21', '19:15', '20:45', 90]],
  ['lunch with gran Sunday noon', MON, null, ['Lunch with gran', '2026-10-25', '12:00', '14:00', 120]],
  ['lunch with gran Sunday at midday', MON, null, ['Lunch with gran', '2026-10-25', '12:00', '14:00', 120]],
  ['cinema Sat 7.30pm', MON, null, ['Cinema', '2026-10-24', '19:30', '22:00', 150]],
  ['driving lesson Sat 07:30', MON, null, ['Driving lesson', '2026-10-24', '07:30', '08:30', 60]],
  ['party Sat 19:30', MON, null, ['Party', '2026-10-24', '19:30', '22:30', 180]],
  ['dentist Thu 9', MON, null, ['Dentist', '2026-10-22', '09:00', '10:00', 60]],
  ['meeting Sat 10', MON, null, ['Meeting', '2026-10-24', '10:00', '11:00', 60]],
  ['gym Sat morning 9', MON, null, ['Gym', '2026-10-24', '09:00', '10:00', 60]],
  ['dinner tonight 8', MON, null, ['Dinner', MON, '20:00', '22:00', 120]],
  ['Sam’s birthday drinks tomorrow evening 7', MON, null, ["Sam's birthday drinks", '2026-10-20', '19:00', '20:00', 60]],
  ['brunch Sun 11', MON, null, ['Brunch', '2026-10-25', '11:00', '13:00', 120]],
  ['maths club after school Wed 3:45', MON, null, ['Maths club', '2026-10-21', '15:45', '16:45', 60]],
  ['football after school Thu 8', MON, null, ['Football', '2026-10-22', '20:00', '21:30', 90]],
  ['meeting Sat 10-2pm', MON, null, ['Meeting', '2026-10-24', '10:00', '14:00', null]],
  ['lunch with Sam Sat 11-1', MON, null, ['Lunch with Sam', '2026-10-24', '11:00', '13:00', null]],
  ['party Sat 7pm-11', MON, null, ['Party', '2026-10-24', '19:00', '23:00', null]],
  ['party Sat 8 till midnight', MON, null, ['Party', '2026-10-24', '20:00', '23:59', null]],
  ['football Wed 7:45 for 2 hours', MON, null, ['Football', '2026-10-21', '19:45', '21:45', null]],
  ['driving lesson Sat 10am for an hour and a half', MON, null, ['Driving lesson', '2026-10-24', '10:00', '11:30', null]],
  // his words around it
  ['I’ve got football Wed at 7:45', MON, null, ['Football', '2026-10-21', '19:45', '21:15', 90]],
  ['I’m going to the cinema with Sam on Friday at 8', MON, null, ['Cinema with Sam', '2026-10-23', '20:00', '22:30', 150]],
  ['add dentist Thursday 3:30 to my calendar', MON, null, ['Dentist', '2026-10-22', '15:30', '16:30', 60]],
  ['dentist at 3:30 on Thursday', MON, null, ['Dentist', '2026-10-22', '15:30', '16:30', 60]],
  ['tomorrow 2-9pm out with friends', MON, null, ['Out with friends', '2026-10-20', '14:00', '21:00', null]],
  // dates
  ['family dinner Sat 24th 7pm', MON, null, ['Family dinner', '2026-10-24', '19:00', '21:00', 120]],
  ['dentist 24 Oct 3pm', MON, null, ['Dentist', '2026-10-24', '15:00', '16:00', 60]],
  ['dentist Oct 24th 3pm', MON, null, ['Dentist', '2026-10-24', '15:00', '16:00', 60]],
  ['party on the 31st 8-11', MON, null, ['Party', '2026-10-31', '20:00', '23:00', null]],
  ['dentist 3/11 9am', MON, null, ['Dentist', '2026-11-03', '09:00', '10:00', 60]],
  ['dentist on the 5th 4pm', MON, null, ['Dentist', '2026-11-05', '16:00', '17:00', 60]],      // the 5th has passed this month: next month's
  ['concert 10 Jan 7pm', MON, null, ['Concert', '2027-01-10', '19:00', '22:00', 180]],          // January has passed this year: next year's
  ['school trip Thu all day', MON, null, ['School trip', '2026-10-22', '08:00', '22:00', null]],
  // relative days across a week boundary (Friday and Sunday)
  ['football Mon 7:45', FRI, null, ['Football', '2026-10-26', '19:45', '21:15', 90]],
  ['football next Mon 7:45', FRI, null, ['Football', '2026-10-26', '19:45', '21:15', 90]],   // already next week: no extra week
  ['dinner next Fri 7', FRI, null, ['Dinner', '2026-10-30', '19:00', '21:00', 120]],         // "next Fri" on a Friday: a week on
  ['dinner Sun 7', FRI, null, ['Dinner', SUN, '19:00', '21:00', 120]],
  ['football tomorrow 10am', SUN, null, ['Football', '2026-10-26', '10:00', '11:30', 90]],
  ['party Sat 8', SUN, null, ['Party', '2026-10-31', '20:00', '23:00', 180]],
  // a time today that has passed (Friday 20:00): a weekday name means next week's; "today" is left to the brain
  ['football Fri 7', FRI, 20 * 60, ['Football', '2026-10-30', '19:00', '20:30', 90]],
  ['dinner tonight 9', FRI, 20 * 60, ['Dinner', FRI, '21:00', '23:00', 120]],
  ['dinner today 7', FRI, 20 * 60, null],
  // unsure or something else: null (the brain reads it)
  ['dentist Thu 7', MON, null, null],                         // 7am or 7pm?
  ['what’s on Sat 7?', MON, null, null],
  ['did football Wed 7', MON, null, null],
  ['maths test Thu 9am', MON, null, null],
  ['physics homework due Fri 5pm', MON, null, null],
  ['remind me Sat 10am to call gran', MON, null, null],
  ['move football to Thu 8', MON, null, null],
  ['football Wed', MON, null, null],                          // no time
  ['football 7:45', MON, null, null],                         // no day
  ['5-a-side Wed 7', MON, null, null],                        // two numbers
  ['football Wed 7:45 and Thu 8', MON, null, null],           // two days
  ['dinner Fri 24th 7', MON, null, null],                     // the 24th isn't a Friday
  ['dentist 31 Nov 3pm', MON, null, null],
  ['party Sat 8-1', MON, null, null],                         // past midnight
  ['football every other Wed 7', MON, null, null],            // can't repeat fortnightly (→ App ideas, in the plug-in)
]

test(`the parser reads ${NEW.length} casual phrasings as he means them (or gives up)`, async () => {
  const { parseNewEvent } = await P()
  for (const [text, today, now, want] of NEW) {
    const got = parseNewEvent(text, today, now)
    if (want === null) { assert.equal(got, null, `“${text}” should be left to the brain, got ${JSON.stringify(got)}`); continue }
    assert.ok(got, `“${text}” wasn’t read`)
    assert.deepEqual([got.title, got.date, got.start, got.end, got.lengthGuess], want, `“${text}”`)
    assert.equal(got.weekly, null)
    assert.ok(text.toLowerCase().includes(got.dateWords.toLowerCase()), `“${text}”: the day words are his (${got.dateWords})`)
  }
})

test('weekly only when he says every / weekly; the day words are kept for the built-in event_weekly', async () => {
  const { parseNewEvent } = await P()
  const w = (t) => { const r = parseNewEvent(t, MON); return r && [r.title, r.weekly?.words, r.weekly?.days, r.start, r.end] }
  assert.deepEqual(w('football every Wed 7:45'), ['Football', 'every Wed', [3], '19:45', '21:15'])
  assert.deepEqual(w('football every Monday and Wednesday 6-7:30'), ['Football', 'every Monday and Wednesday', [1, 3], '18:00', '19:30'])
  assert.deepEqual(w('gym every weekday 7am'), ['Gym', 'every weekday', [1, 2, 3, 4, 5], '07:00', '08:00'])
  assert.equal(w('Owen training every Tuesday at 6pm'), null, 'Owen’s days are his set-up (owen_days): the brain')
  assert.deepEqual(w('swimming every Tuesday at 6pm'), ['Swimming', 'every Tuesday', [2], '18:00', '19:00'])
  assert.deepEqual(w('swimming weekly on Thursdays 5-6'), ['Swimming', 'Thursdays', [4], '17:00', '18:00'].map((x, i) => (i === 1 ? 'weekly on Thursdays' : x)))
  assert.equal(w('football Wednesdays 7:45'), null, 'plural days without every: the brain decides')
  assert.equal(w('football every week 7:45'), null, 'every week, but which day?')
})

test('repeats the app can’t do yet are spotted for App ideas', async () => {
  const { unsupportedRepeat } = await P()
  assert.match(unsupportedRepeat('football every other Wed 7'), /every other week/)
  assert.match(unsupportedRepeat('fortnightly guitar lesson Sat 10'), /every other week/)
  assert.match(unsupportedRepeat('book club monthly Thu 7'), /every month/)
  assert.match(unsupportedRepeat('first Saturday of the month 10am parkrun'), /every month/)
  assert.equal(unsupportedRepeat('football every Wed 7:45'), null)
})

test('casual times: am/pm and 24h say exactly; part of day; 1–6 = afternoon; 7–11 by what it is; near = when it is now', async () => {
  const { resolveTime, timeAtom, kindOf } = await P()
  const t = (s, ctx = {}) => { const r = resolveTime(timeAtom(s), { part: null, kind: null, ...ctx }); return r === null ? null : `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}` }
  assert.equal(t('7pm'), '19:00'); assert.equal(t('7am'), '07:00'); assert.equal(t('12pm'), '12:00'); assert.equal(t('12am'), '00:00')
  assert.equal(t('19:45'), '19:45'); assert.equal(t('07:30'), '07:30'); assert.equal(t('noon'), '12:00'); assert.equal(t('midday'), '12:00')
  assert.equal(t('half 7', { kind: 'evening' }), '19:30'); assert.equal(t('quarter to 8', { kind: 'evening' }), '19:45'); assert.equal(t('quarter past 9'), '09:15')
  assert.equal(t('3'), '15:00'); assert.equal(t('6:30'), '18:30')
  assert.equal(t('8', { kind: 'evening' }), '20:00'); assert.equal(t('8', { kind: 'morning' }), '08:00'); assert.equal(t('8'), null); assert.equal(t('10'), '10:00')
  assert.equal(t('9', { kind: 'appointment' }), '09:00'); assert.equal(t('7', { kind: 'appointment' }), null)
  assert.equal(t('9', { part: 'evening' }), '21:00'); assert.equal(t('9', { part: 'morning' }), '09:00'); assert.equal(t('2', { part: 'afternoon' }), '14:00')
  assert.equal(t('7', { near: 6 * 60 }), '07:00', 'Owen at 06:00 → 7 means 07:00'); assert.equal(t('8', { near: 19 * 60 + 45 }), '20:00')
  assert.equal(t('9', { near: 15 * 60 + 30, kind: 'appointment' }), '09:00', 'a dentist at 9 is the morning, even moved from the afternoon')
  assert.equal(kindOf('family dinner'), 'evening'); assert.equal(kindOf('dentist'), 'appointment'); assert.equal(kindOf('breakfast with Sam'), 'morning'); assert.equal(kindOf('trip'), null)
  assert.equal(timeAtom('25:00'), null); assert.equal(timeAtom('7:75'), null); assert.equal(timeAtom('13pm'), null)
})

test('cancel and move phrasings: the name, the session’s day, the new day/time; null when unsure', async () => {
  const { parseChange } = await P()
  const c = (t) => { const r = parseChange(t, MON); return r && [r.kind, r.name, r.day?.date ?? null, r.scope] }
  assert.deepEqual(c('cancel family dinner'), ['cancel', 'family dinner', null, null])
  assert.deepEqual(c('dinner’s off'), ['cancel', 'dinner', null, null])
  assert.deepEqual(c('family dinner is cancelled'), ['cancel', 'family dinner', null, null])
  assert.deepEqual(c('not going out tomorrow anymore'), ['cancel', 'out', '2026-10-20', null])
  assert.deepEqual(c('football is cancelled tomorrow'), ['cancel', 'football', '2026-10-20', null])
  assert.deepEqual(c('no football Wednesday'), ['cancel', 'football', '2026-10-21', null])
  assert.deepEqual(c('CS tutor is off this week'), ['cancel', 'cs tutor', null, 'one'])
  assert.deepEqual(c('cancel football every week'), ['cancel', 'football', null, 'every'])
  assert.deepEqual(c('can’t make football Wed'), ['cancel', 'football', '2026-10-21', null])
  assert.deepEqual(c('match cancelled Thursday'), ['cancel', 'match', '2026-10-22', null])
  assert.deepEqual(c('drop football this week'), ['cancel', 'football', null, 'one'])
  const m = (t) => { const r = parseChange(t, MON); return r && r.kind === 'move' ? [r.name, r.day?.date ?? null, r.to.day?.date ?? null, r.to.time ? `${r.to.time.a.h}:${r.to.time.a.m}${r.to.time.a.ap ?? ''}` : null, r.to.nextWeek, r.to.shift, r.scope] : r }
  assert.deepEqual(m('move football to Thu 8'), ['football', null, '2026-10-22', '8:0', false, null, null])
  assert.deepEqual(m('family dinner is now 7:30'), ['family dinner', null, null, '7:30', false, null, null])
  assert.deepEqual(m('push the dentist to next week'), ['dentist', null, null, null, true, null, null])
  assert.deepEqual(m('football moved to Thu 8pm'), ['football', null, '2026-10-22', '8:0pm', false, null, null])
  assert.deepEqual(m('move football Wed to Thu 8 just this week'), ['football', '2026-10-21', '2026-10-22', '8:0', false, null, 'one'])
  assert.deepEqual(m('push dinner back an hour'), ['dinner', null, null, null, false, 60, null])
  assert.deepEqual(m('move the dentist 30 mins earlier'), ['dentist', null, null, null, false, -30, null])
  assert.deepEqual(m('dinner’s at 8 instead'), ['dinner', null, null, '8:0', false, null, null])
  assert.deepEqual(m('owen moved to Wed 6pm this week'), ['owen', null, '2026-10-21', '6:0pm', false, null, 'one'])
  for (const t of ['no worries', 'drop the guitar idea', 'Owen moved training to Wed 6pm this week', 'game moved to Saturday, leave 9 back 3', 'football is at Hackney Marshes',
    'CS tutor is now Sam', 'my morning routine is now weekdays only', 'cancel it', 'is football cancelled tomorrow?', 'not going']) {
    assert.equal(parseChange(t, MON), null, `“${t}” should be left to the brain`)
  }
})

test('which event his words mean: exact name first, all of his words in it, one typo; the session on his day, else the next', async () => {
  const { nameScore, matchEvents, closest, tokens } = await import('../lib/life/match.ts')
  assert.deepEqual(tokens("Sam's dinners with the family"), ['sam', 'dinner', 'family'])
  assert.equal(nameScore('family dinner', 'Family dinner'), 3)
  assert.equal(nameScore('dinner', 'Family dinner'), 1)
  assert.equal(nameScore('the dentist appointment', 'Dentist'), 2)
  assert.equal(nameScore('out', 'Out with friends'), 1)
  assert.equal(nameScore('footbal', 'Football'), 3, 'one typo')
  assert.equal(nameScore('footy', 'Football'), 3)
  assert.equal(nameScore('dinner with mum', 'Family dinner'), 0, 'a word of his that isn’t in it')
  assert.equal(nameScore('physics homework', 'Football'), 0)
  const ev = (o) => ({ id: o.id, title: o.title, category_id: null, subject_id: null, location: null, starts_at: o.starts_at ?? null, ends_at: o.ends_at ?? null, repeat_days: o.repeat_days ?? null, start_time: o.start_time ?? null, end_time: o.end_time ?? null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, external_source: o.src ?? 'manual' })
  const events = [
    ev({ id: 'f', title: 'Football', repeat_days: [3], start_time: '19:45', end_time: '21:15' }),
    ev({ id: 'ft', title: 'Football training', repeat_days: [1], start_time: '18:00', end_time: '19:30' }),
    ev({ id: 'd', title: 'Family dinner', starts_at: '2026-10-24T18:00:00Z', ends_at: '2026-10-24T20:00:00Z' }),
    ev({ id: 'l', title: 'Lessons', starts_at: '2026-10-20T08:00:00Z', ends_at: '2026-10-20T14:30:00Z', src: 'google' }),
    ev({ id: 'old', title: 'Dentist', starts_at: '2026-10-01T14:00:00Z', ends_at: '2026-10-01T15:00:00Z' }),
  ]
  const ids = (words, date = null) => matchEvents(words, events, [], MON, date).map((m) => `${m.event.id}@${m.session.date}`)
  assert.deepEqual(ids('football'), ['f@2026-10-21'], 'the exact name wins over Football training')
  assert.deepEqual(ids('football', '2026-10-26'), ['ft@2026-10-26'], 'on Monday only Football training fits')
  assert.deepEqual(ids('dinner'), ['d@2026-10-24'])
  assert.deepEqual(ids('dentist'), [], 'a past one-off has no session to change')
  const lessons = matchEvents('lessons', events, [], MON, null)
  assert.equal(lessons.length, 1); assert.equal(lessons[0].google, true); assert.equal(lessons[0].own, false)
  const cancelled = matchEvents('football', events, [{ id: 'x', event_id: 'f', on_date: '2026-10-21', cancelled: true, new_date: null, new_start: null, new_end: null, missed: false }], MON, null)
  assert.equal(cancelled[0].session.date, '2026-10-28', 'this week’s is cancelled: the next one')
  assert.deepEqual(closest('footbol club', events, [], MON).map((x) => x.title), ['Football', 'Football training'])
  assert.deepEqual(closest('zzz', events, [], MON).map((x) => x.title), ['Football training', 'Football', 'Family dinner'], 'nothing alike: what’s coming up')
})

test('where a moved session goes: "8" for football is 20:00, Owen at 06:00 "to 7" is 07:00, back an hour, next week; past → null', async () => {
  const { moveTo } = await import('../lib/telegram/plugins/life.ts')
  const { parseChange } = await P()
  const ev = (title, rep) => ({ title, repeat_days: rep ? [3] : null, start_time: rep ? '19:45' : null })
  const mv = (text, title, date, start, end, rep = false, now = 10 * 60) => { const c = parseChange(text, MON); return moveTo({ event: ev(title, rep), session: { date, usualDate: date, start, end } }, c.to, MON, now) }
  assert.deepEqual(mv('move football to Thu 8', 'Football', '2026-10-21', '19:45', '21:15', true), { date: '2026-10-22', start: '20:00', end: '21:30' })
  assert.deepEqual(mv('move owen to 7', 'Owen training', '2026-10-21', '06:00', '06:45'), { date: '2026-10-21', start: '07:00', end: '07:45' })
  assert.deepEqual(mv('move the dentist to 9', 'Dentist', '2026-10-22', '15:30', '16:30'), { date: '2026-10-22', start: '09:00', end: '10:00' })
  assert.deepEqual(mv('push dinner back an hour', 'Family dinner', '2026-10-24', '19:00', '21:00'), { date: '2026-10-24', start: '20:00', end: '22:00' })
  assert.deepEqual(mv('push the dentist to next week', 'Dentist', '2026-10-22', '15:30', '16:30'), { date: '2026-10-29', start: '15:30', end: '16:30' })
  assert.deepEqual(mv('move dinner to 6-8', 'Family dinner', '2026-10-24', '19:00', '21:00'), { date: '2026-10-24', start: '18:00', end: '20:00' })
  assert.equal(mv('push football to next week', 'Football', '2026-10-21', '19:45', '21:15', true), null, 'a weekly session: next week already has one')
  assert.equal(mv('move dinner to 9am', 'Family dinner', MON, '19:00', '21:00', false, 11 * 60), null, 'that time has passed today')
  assert.equal(mv('push dinner back 5 hours', 'Family dinner', '2026-10-24', '19:00', '21:00'), null, 'past midnight')
})

// ---------------------------------------------------------------------------
// Routines
// ---------------------------------------------------------------------------

const world = (o = {}) => ({
  routines: [{ id: 'm', name: 'Morning', is_active: true, sort_order: 1, days_of_week: [1, 2, 3, 4, 5, 6, 7] }, { id: 'n', name: 'Night routine', is_active: true, sort_order: 2, days_of_week: [1, 2, 3, 4, 5] }, { id: 'old', name: 'Old morning', is_active: false, sort_order: 3, days_of_week: [1] }],
  blocks: [
    { id: 'w', habit_id: 'm', name: 'Wake', sort_order: 1, days_of_week: null }, { id: 'b', habit_id: 'm', name: 'Breakfast', sort_order: 2, days_of_week: null },
    { id: 'c', habit_id: 'm', name: 'Cold shower', sort_order: 3, days_of_week: null }, { id: 't', habit_id: 'm', name: 'Teeth', sort_order: 4, days_of_week: null },
    { id: 'gone', habit_id: 'm', name: 'Yoga', sort_order: 5, days_of_week: null, archived_at: '2026-10-01T00:00:00Z' },
    { id: 'nt', habit_id: 'n', name: 'Teeth', sort_order: 1, days_of_week: null }, { id: 'ns', habit_id: 'n', name: 'Skincare', sort_order: 2, days_of_week: null },
  ],
  steps: [{ id: 's1', habit_item_id: 't', title: 'Brush', sort_order: 1 }],
  canArchiveBlocks: true, canArchiveSteps: true, ...o,
})

test('routines: add (end / start / after), move, rename, remove (archived), days; problems in plain words', async () => {
  const { checkRoutine } = await import('../lib/life/routines.ts')
  const ok = (v, w = world()) => { const r = checkRoutine(v, null, w); assert.ok(r.change, `${v}: ${r.problem}`); return r.change }
  const no = (v, w = world()) => { const r = checkRoutine(v, null, w); assert.ok(!r.change, `${v} should be refused`); return r.problem }
  let c = ok('routine=morning; do=add; block=stretch 10 min')
  assert.equal(c.patch.name, 'Stretch (10 min)'); assert.equal(c.patch.sort_order, 5); assert.match(c.line, /at the end/)
  c = ok('routine=Morning; do=add; block=Water; at=start')
  assert.equal(c.patch.sort_order, 1); assert.deepEqual(c.patch.orders, { w: 2, b: 3, c: 4, t: 5 })
  c = ok('routine=morning; do=add; block=Stretch; after=breakfast')
  assert.equal(c.patch.sort_order, 3); assert.match(c.line, /after Breakfast/)
  c = ok('do=move; block=cold shower; before=breakfast')   // no routine named: the one that has both
  assert.deepEqual(c.patch.orders, { w: 1, c: 2, b: 3, t: 4 })
  c = ok('routine=night; do=rename; block=teeth; name=teeth + floss')
  assert.equal(c.patch.id, 'nt'); assert.equal(c.patch.name, 'Teeth + floss')
  c = ok('routine=night; do=rename; name=Evening')
  assert.equal(c.patch.kind, 'rename_routine')
  c = ok('routine=night; do=remove; block=skincare')
  assert.deepEqual(c.patch, { kind: 'archive_block', id: 'ns' }); assert.match(c.line, /archived, can be restored/)
  c = ok('routine=night; do=days; days=every day')
  assert.deepEqual(c.patch.days, [1, 2, 3, 4, 5, 6, 7]); assert.match(c.line, /Mon–Fri → <b>every day/)
  c = ok('routine=morning; do=days; block=cold shower; days=mon, wed and fri')
  assert.deepEqual(c.patch, { kind: 'block_days', id: 'c', days: [1, 3, 5] })
  c = ok('routine=morning; do=add; block=teeth; step=floss')
  assert.deepEqual(c.patch, { kind: 'add_step', item_id: 't', title: 'Floss', sort_order: 2 })
  assert.match(no('routine=morning; do=remove; block=yoga'), /“yoga” isn’t in your Morning routine \(Wake, Breakfast, Cold shower, Teeth\)/, 'an archived block is gone')
  assert.match(no('routine=evening; do=add; block=x'), /no routine called “evening”; yours: Morning, Night routine/)
  assert.match(no('do=move; block=teeth; at=start'), /which routine/, 'Teeth is in both')
  assert.equal(ok('do=move; block=teeth; after=wake').patch.habit_id, 'm', 'only Morning has Wake')
  assert.match(no('routine=morning; do=add; block=Teeth'), /already has Teeth/)
  assert.match(no('routine=morning; do=days; days=every day'), /already every day/)
  assert.match(no('routine=morning; do=move; block=wake; at=start'), /already there/)
  assert.match(no('routine=night; do=remove; block=skincare', world({ canArchiveBlocks: false })), /run supabase\/life\.sql first/)
  assert.match(no('routine=morning; do=add; block=Stretch', world({ canArchiveBlocks: false })), /run supabase\/life\.sql first/)
})

test('routine phrasings → the change; other messages are left alone', async () => {
  const { parseRoutine, parseBlockDays, blockName, daysFrom } = await import('../lib/life/routines.ts')
  assert.equal(parseRoutine('add stretch 10 min to my morning routine'), 'routine=morning; do=add; block=stretch 10 min')
  assert.equal(parseRoutine('add water to the start of my morning routine'), 'routine=morning; do=add; block=water; at=start')
  assert.equal(parseRoutine('add stretch after breakfast in my morning routine'), 'routine=morning; do=add; block=stretch; after=breakfast')
  assert.equal(parseRoutine('add floss to teeth in my night routine'), 'routine=night; do=add; step=floss; block=teeth')
  assert.equal(parseRoutine('remove skincare from my night routine'), 'routine=night; do=remove; block=skincare')
  assert.equal(parseRoutine('take reading out of the night routine'), 'routine=night; do=remove; block=reading')
  assert.equal(parseRoutine('rename teeth to teeth + floss in my night routine'), 'routine=night; do=rename; block=teeth; name=teeth + floss')
  assert.equal(parseRoutine('cold shower after breakfast'), 'do=move; block=cold shower; after=breakfast')
  assert.equal(parseRoutine('move teeth to the end of my morning routine'), 'routine=morning; do=move; block=teeth; at=end')
  assert.equal(parseRoutine('night routine every day'), 'routine=night; do=days; days=every day')
  assert.equal(parseRoutine('morning routine on weekdays only'), 'routine=morning; do=days; days=weekdays')
  assert.equal(parseRoutine('only do my morning routine on weekdays'), 'routine=morning; do=days; days=weekdays')
  assert.equal(parseRoutine('football after school Tue 4'), null, 'times: an event, not a routine')
  assert.equal(parseRoutine('light lower is ok the day before a game'), null, 'a sentence, not two block names')
  assert.equal(parseRoutine('what’s in my morning routine?'), null)
  assert.deepEqual(parseBlockDays('shave on mon, wed and fri only'), { block: 'shave', days: 'mon, wed and fri' })
  assert.equal(parseBlockDays('football every Wed'), null)
  assert.equal(blockName('stretch 10 min'), 'Stretch (10 min)'); assert.equal(blockName('10 mins of reading'), 'Reading (10 min)'); assert.equal(blockName('cold shower'), 'Cold shower')
  assert.deepEqual(daysFrom('weekends'), [6, 7]); assert.deepEqual(daysFrom('every day'), [1, 2, 3, 4, 5, 6, 7]); assert.equal(daysFrom('sometimes'), null)
})

// ---------------------------------------------------------------------------
// The week's priorities
// ---------------------------------------------------------------------------

test('priorities: top / set / add / drop / clear (at most 3); the week; "ACT top priority this week" is not one', async () => {
  const { parsePriority, checkPriority, priorityWeek } = await import('../lib/life/priorities.ts')
  assert.equal(parsePriority('top priority this week is FM HT2'), 'do=first; text=FM HT2; week=this')
  assert.equal(parsePriority('my 3 priorities: HT2, ACT, gym'), 'do=set; list=HT2, ACT, gym')
  assert.equal(parsePriority('priorities next week are ACT and sleep'), 'do=set; list=ACT, sleep; week=next')
  assert.equal(parsePriority('add gym to my priorities'), 'do=add; text=gym')
  assert.equal(parsePriority('drop the ACT priority'), 'do=drop; text=ACT')
  assert.equal(parsePriority('remove gym from my priorities'), 'do=drop; text=gym')
  assert.equal(parsePriority('clear my priorities'), 'do=clear')
  for (const t of ['ACT top priority this week', 'make ACT my top priority this week', 'what are my priorities?', 'priority']) assert.equal(parsePriority(t), null, t)
  assert.equal(priorityWeek(MON, undefined), MON); assert.equal(priorityWeek(SUN, undefined), '2026-10-26', 'the Sunday check-in is about next week')
  assert.equal(priorityWeek(SUN, 'this'), MON); assert.equal(priorityWeek(FRI, 'next'), '2026-10-26')
  const now = (list) => () => list
  let c = checkPriority('do=first; text=FM HT2', now(['ACT', 'gym', 'sleep']), MON).change
  assert.deepEqual(c.after, ['FM HT2', 'ACT', 'gym']); assert.deepEqual(c.dropped, ['sleep']); assert.match(c.line, /sleep drops off: 3 at most/)
  c = checkPriority('do=first; text=gym', now(['ACT', 'gym']), MON).change
  assert.deepEqual(c.after, ['gym', 'ACT'], 'already there: moves to the top')
  assert.deepEqual(checkPriority('do=set; list=HT2, ACT, gym', now([]), MON).change.after, ['HT2', 'ACT', 'gym'])
  assert.match(checkPriority('do=set; list=a, b, c, d', now([]), MON).problem, /at most 3/)
  assert.match(checkPriority('do=add; text=sleep', now(['a', 'b', 'c']), MON).problem, /already have 3 priorities/)
  assert.deepEqual(checkPriority('do=drop; text=the ACT', now(['HT2', 'ACT practice', 'gym']), MON).change.after, ['HT2', 'gym'], 'his words point at “ACT practice”')
  assert.match(checkPriority('do=drop; text=chess', now(['HT2']), MON).problem, /isn’t one of that week’s priorities \(HT2\)/)
  assert.deepEqual(checkPriority('do=clear', now(['HT2']), MON).change.after, [])
  assert.match(checkPriority('do=clear', now([]), MON).problem, /no priorities/)
})

// ---------------------------------------------------------------------------
// Review probes (a fast path is conservative: when unsure, null and the brain reads it)
// ---------------------------------------------------------------------------

test('review probes: "next week" / "Sat week" / "after next" move the day on; settings, study and sentences aren’t events', async () => {
  const { parseNewEvent } = await P()
  const rows = [
    ['dentist Thursday next week 3pm', ['Dentist', '2026-10-29', '15:00', '16:00']],
    ['next week Thursday dentist 3pm', ['Dentist', '2026-10-29', '15:00', '16:00']],
    ['dinner Sat 7 next week', ['Dinner', '2026-10-31', '19:00', '21:00']],
    ['dinner Sat week 7', ['Dinner', '2026-10-31', '19:00', '21:00']],
    ['party Sat after next 8', ['Party', '2026-10-31', '20:00', '23:00']],
    ['dinner Sat the week after next 7', ['Dinner', '2026-11-07', '19:00', '21:00']],
    ['revision session at school Tue 4-5:30', ['Revision session at school', '2026-10-20', '16:00', '17:30']],
    ['football Sun 10am', ['Football', '2026-10-25', '10:00', '11:30']],
    ['dinner tonight 10', ['Dinner', MON, '22:00', '23:59']],
    ['school Thu 8:40', ['School', '2026-10-22', '08:40', '09:40']],
    ['party Sat 8-12', ['Party', '2026-10-24', '20:00', '23:59']],
    ['film Sat 9-12', ['Film', '2026-10-24', '21:00', '23:59']],
    ['party Sat 8pm-12am', ['Party', '2026-10-24', '20:00', '23:59']],
    ['swimming every Tuesday at 6pm', ['Swimming', '2026-10-20', '18:00', '19:00']],
  ]
  for (const [text, want] of rows) {
    const r = parseNewEvent(text, MON, 600)
    assert.ok(r, `“${text}” wasn’t read`)
    assert.deepEqual([r.title, r.date, r.start, r.end], want, text)
  }
  for (const text of [
    'dinner tomorrow next week 7', 'dinner next Sat week 7',
    // settings, study, sentences
    'wake up at 6:30 tomorrow', 'day ends at 10 tonight', 'quiet hours from 10 tonight', 'free after 6 tomorrow', 'study until 9 tonight',
    'bed at 10:30 tonight', 'study 2 hours tomorrow', 'pause getting ahead until 25 Oct 5pm', 'football was good Wed 7', 'revise matrices tomorrow 4pm',
    'Bicen matrices tomorrow 5', 'revision tomorrow 5pm',
    // a change, not a new event
    'football is at 8 on Thursday', 'dinner is at 8 on Sat', "football's at 8 tomorrow",
    // 10 and 11 for evening things: a morning game or a late night? unsure
    'football Sun 10', 'football match Sun 10', 'training Sat 10', 'gym Sat 10', 'out with friends Sat 11',
    // weekly with dates it doesn't take
    'football every Wed 7:45 from next week', 'football every Wed 7:45 until Christmas', 'football every Wed 7:45 starting 4 Nov',
    // his set-up's sessions (game_week / owen_days)
    'game Sun 10', 'match Sun 10', 'Owen Tue 6',
    // "school" isn't morning unless it's the whole name
    'school play Thu 7',
    // repeats and other things
    'monthly mock Sat 9am', 'gym every other day 7am',
  ]) assert.equal(parseNewEvent(text, MON, 600), null, `“${text}” should be left to the brain`)
})

test('review probes: "X is at 8 on Thu" is a change; cancels with "on <day>" are cancels (not routine days); "can’t make it to …"', async () => {
  const { parseChange, unsupportedRepeat, looksLikeOther } = await P()
  const { parseBlockDays, parseRoutine } = await import('../lib/life/routines.ts')
  const m = (t) => { const r = parseChange(t, MON); return r && [r.kind, r.name, r.day?.date ?? null, r.kind === 'move' ? r.to.day?.date ?? null : null, r.kind === 'move' && r.to.time ? r.to.time.a.h : null] }
  assert.deepEqual(m('football is at 8 on Thursday'), ['move', 'football', null, '2026-10-22', 8])
  assert.deepEqual(m('dinner is at 8 on Sat'), ['move', 'dinner', null, '2026-10-24', 8])
  assert.deepEqual(m("football's at 8 tomorrow"), ['move', 'football', null, '2026-10-20', 8])
  assert.equal(parseChange('football is at Hackney Marshes', MON), null, 'a place, not a time')
  for (const t of ['cancel football on Wednesday', 'no football on Wednesday', 'football is off on Wed', 'not going to football on Wednesday', 'can’t make it to football Wed']) {
    assert.deepEqual(m(t), ['cancel', 'football', '2026-10-21', null, null], t)
    assert.equal(parseBlockDays(t), null, `${t}: not a routine block’s days`)
    assert.equal(parseRoutine(t), null, t)
  }
  assert.equal(parseBlockDays('skip football on Wed'), null)
  assert.equal(parseChange('can’t make it Wed', MON), null, 'no name')
  assert.deepEqual(parseBlockDays('shave on mon, wed and fri only'), { block: 'shave', days: 'mon, wed and fri' }, 'still a block’s days')
  assert.match(unsupportedRepeat('gym every other day 7am'), /every other day/)
  assert.match(unsupportedRepeat('football every other Wed 7'), /every other week/)
  assert.equal(looksLikeOther('monthly mock Sat 9am'), true, 'a test: not an App idea')
  assert.equal(looksLikeOther('football every other Wed 7'), false)
})
