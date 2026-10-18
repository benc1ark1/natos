// Jarvis phase E, plain tests: travel between places (free, no database, no network). Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bestLeg, withTravel, leaveBy, travelSettings, DEFAULT_TRAVEL } from '../lib/travel.ts'
import { freeSlots, DEFAULT_PLANNING } from '../lib/freetime.ts'
import { expandEvents } from '../lib/events.ts'
import { postcodeIn } from '../lib/telegram/maps.ts'

const place = (id, o = {}) => ({ id, name: o.name ?? id, address: null, lat: null, lng: null, is_home: false, archived_at: null, ...o })
const row = (from, to, minutes, mode, source = 'manual', hour = null) => ({ from_place_id: from, to_place_id: to, mode, minutes, source, depart_hour: hour, archived_at: null })
const places = [place('home', { name: 'Home', is_home: true }), place('school', { name: 'School' }), place('ground', { name: 'Football ground' })]
const world = (times, eventPlace = new Map()) => ({ places, times, eventPlace, settings: DEFAULT_TRAVEL })

test('how he says he goes wins; one direction told counts both ways', () => {
  const w = world([row('school', 'ground', 25, 'bus'), row('school', 'ground', 15, 'uber')])
  assert.deepEqual(bestLeg(w, 'school', 'ground', 17), { minutes: 25, mode: 'bus', other: null, from: 'School', to: 'Football ground' })
  assert.equal(bestLeg(w, 'ground', 'school', 17).minutes, 25, 'the way back')
  assert.equal(bestLeg(w, 'home', 'ground', 17), null, 'nothing known')
  assert.equal(bestLeg(w, 'home', 'home', 17).minutes, 0)
})

test('Uber (his estimate + 5 min pickup) vs tube/bus (TfL): tube/bus if it’s within 10 minutes', () => {
  const near = world([row('home', 'ground', 20, 'uber'), row('home', 'ground', 33, 'transit', 'tfl', 17)])
  assert.deepEqual(bestLeg(near, 'home', 'ground', 17), { minutes: 33, mode: 'transit', other: 'Uber 25 min', from: 'Home', to: 'Football ground' })
  const far = world([row('home', 'ground', 20, 'uber'), row('home', 'ground', 40, 'transit', 'tfl', 17)])
  assert.deepEqual(bestLeg(far, 'home', 'ground', 17), { minutes: 25, mode: 'uber', other: 'tube/bus 40 min', from: 'Home', to: 'Football ground' })
  const slack = { ...far, settings: { ...DEFAULT_TRAVEL, transitSlackMin: 15 } }
  assert.equal(bestLeg(slack, 'home', 'ground', 17).mode, 'transit', '"nearly as fast" is an editable setting')
  // TfL times are per hour of the day: the nearest cached hour is used
  const hours = world([row('home', 'ground', 50, 'transit', 'tfl', 8), row('home', 'ground', 30, 'transit', 'tfl', 17)])
  assert.equal(bestLeg(hours, 'home', 'ground', 16).minutes, 30)
  assert.deepEqual(travelSettings({ uberPickupMin: 8 }), { uberPickupMin: 8, transitSlackMin: 10, travelEnd: 'slow' })
})

const ev = (o) => ({ id: o.title, title: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null, start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, ...o })
const SCHOOL = ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00' })
const FOOTBALL = ev({ title: 'Football', repeat_days: [4], start_time: '18:00', end_time: '19:30', travel_minutes: 40 })
const THU = '2026-10-15'
const W = world([row('home', 'school', 15, 'walk'), row('school', 'ground', 25, 'bus'), row('ground', 'home', 30, 'bus')], new Map([['School', 'school'], ['Football', 'ground']]))

test('travel comes from where he’ll be: school -> football (25 by bus), football -> home (30 by bus)', () => {
  const occ = withTravel(expandEvents([SCHOOL, FOOTBALL], THU, THU), W)
  const f = occ.find((o) => o.event.title === 'Football')
  assert.equal(f.travelBefore, 25)
  assert.equal(f.travelAfter, 30)
  assert.equal(f.leg.from, 'School')
  const s = occ.find((o) => o.event.title === 'School')
  assert.equal(s.travelBefore, 15)
  assert.equal(s.travelAfter, 0, 'from school he goes on to football (counted there)')
})

test('free time uses the real journeys, not the event’s old flat 40 min each way', () => {
  const occ = withTravel(expandEvents([SCHOOL, FOOTBALL], THU, THU), W)
  const slots = freeSlots(occ, THU, DEFAULT_PLANNING).map((s) => `${s.start}-${s.end}`)
  assert.deepEqual(slots, ['07:00-08:20', '16:10-17:25', '20:10-22:30'])
})

test('without places, events keep their own travel minutes (nothing changes)', () => {
  const occ = withTravel(expandEvents([FOOTBALL], THU, THU), null)
  assert.equal(occ[0].travelBefore, undefined)
  assert.deepEqual(freeSlots(occ, THU, DEFAULT_PLANNING).map((s) => `${s.start}-${s.end}`), ['07:00-17:10', '20:20-22:30'])
})

test('leave-by: a fixed time with how and from where (and the other option)', () => {
  const occ = withTravel(expandEvents([SCHOOL, FOOTBALL], THU, THU), W)
  assert.deepEqual(leaveBy(occ.find((o) => o.event.title === 'Football')), { at: '17:35', words: '25 min by bus from School' })
  const w2 = { ...world([row('home', 'ground', 20, 'uber'), row('home', 'ground', 33, 'transit', 'tfl', 17)], new Map([['Football', 'ground']])) }
  const f = withTravel(expandEvents([FOOTBALL], THU, THU), w2)[0]
  assert.deepEqual(leaveBy(f), { at: '17:27', words: '33 min by tube/bus from Home; Uber 25 min' })
})

test('postcodes are found in an address', () => {
  assert.equal(postcodeIn('Hackney Marshes, Homerton Rd, London E9 5PF'), 'E9 5PF')
  assert.equal(postcodeIn('sw1a1aa'), 'SW1A 1AA')
  assert.equal(postcodeIn('the park'), null)
})
