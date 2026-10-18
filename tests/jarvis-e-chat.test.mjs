// Jarvis phase E: places and travel on the TEST database, with fake TfL and postcodes.io servers.
// Run: npm run test:chat
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { useChat, CHAT, OWNER_TG } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const T = () => chat.time
const D = (n) => T().addDays(T().todayISO(), n)
const act = (o) => ({ op: 'travel_set', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const refIn = (body, name) => body.messages[0].content[0].text.match(new RegExp(`(E\\d+) \\| ${name} \\|`))?.[1] ?? 'E99'
async function ask(text, changes) {
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Okay.', actions: changes.map((c) => act({ ...c, ref: c.ref ? refIn(body, c.ref) : '' })) }))
  await nat(text)
}
const tap = async (label) => { const m = chat.tg.sent().filter((x) => chat.button(x, label)).at(-1); await chat.tap(chat.button(m, label), m.message_id) }

// fake TfL + postcodes.io
let maps, mapCalls = []
before(async () => {
  maps = http.createServer((req, res) => {
    mapCalls.push(req.url)
    res.setHeader('content-type', 'application/json')
    if (req.url.startsWith('/postcodes/')) {
      const pc = decodeURIComponent(req.url.split('/')[2])
      const known = { E95PF: [51.5524, -0.0228], N16AA: [51.5300, -0.1100] }[pc]
      res.end(JSON.stringify(known ? { status: 200, result: { latitude: known[0], longitude: known[1] } } : { status: 404, error: 'Invalid postcode' }))
    } else if (req.url.startsWith('/Journey/JourneyResults/')) {
      res.end(JSON.stringify({ journeys: [{ duration: 38 }, { duration: 33 }, { duration: 41 }] }))
    } else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise((r) => maps.listen(0, '127.0.0.1', r))
  process.env.TFL_API_BASE = process.env.POSTCODES_API_BASE = `http://127.0.0.1:${maps.address().port}`
})
after(() => maps?.close())

test('"school to football is 25 min by bus": the places are made, the journey saved; Undo archives them all', { skip }, async () => {
  await ask('school to football is 25 min by bus', [{ value: 'from=School; to=Football ground; minutes=25; mode=bus' }])
  assert.match(last().text, /🚌 <b>School → Football ground<\/b>: 25 min by bus <i>\(new places: School, Football ground\)/)
  await tap('Apply')
  assert.deepEqual((await q(`select name from places order by name`)).map((r) => r.name), ['Football ground', 'School'])
  assert.deepEqual(await q(`select mode, minutes, source from travel_times`), [{ mode: 'bus', minutes: 25, source: 'manual' }])
  await tap('Undo')
  assert.equal((await q(`select count(*)::int n from places where archived_at is null`))[0].n, 0, 'the places it made are archived')
  assert.equal((await q(`select count(*)::int n from places`))[0].n, 2, 'not deleted')
  assert.equal((await q(`select count(*)::int n from travel_times where archived_at is null`))[0].n, 0)
})

test('"football is at Hackney Marshes": the event gets a place; Undo puts it back', { skip }, async () => {
  const f = await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30' })
  await ask('football is at Hackney Marshes', [{ op: 'event_place', ref: 'Football', value: 'Hackney Marshes' }])
  assert.match(last().text, /📍 <b>Football<\/b>: no place → Hackney Marshes \(new place\)/)
  await tap('Apply')
  const [p] = await q(`select id from places where name = 'Hackney Marshes'`)
  assert.equal((await q(`select place_id from events where id = $1`, [f.id]))[0].place_id, p.id)
  await tap('Undo')
  assert.equal((await q(`select place_id from events where id = $1`, [f.id]))[0].place_id, null)
})

test('travel comes from where he’ll be: after school, 25 min by bus (not the event’s old 40 min)', { skip }, async () => {
  const school = await add('places', { name: 'School' }), ground = await add('places', { name: 'Football ground' })
  await add('places', { name: 'Home', is_home: true })
  await add('events', { title: 'Lessons', repeat_days: [T().isoDow(D(1))], start_time: '08:45', end_time: '16:00', place_id: school.id })
  await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30', place_id: ground.id, travel_minutes: 40 })
  await add('travel_times', { from_place_id: school.id, to_place_id: ground.id, mode: 'bus', minutes: 25 })
  await nat(`/free ${T().dowShort(D(1))}`)
  assert.match(last().text, /–17:25/, 'free until 17:25 (18:00 − 25 min bus − 10 min buffer)')
  assert.match(last().text, /Football 18:00–19:30 \+25 min there by bus/)
})

test('once a day the tick gets tube/bus times from TfL (postcodes -> positions first); Uber vs tube/bus decides', { skip }, async () => {
  const home = await add('places', { name: 'Home', is_home: true, address: '1 Some Street, N1 6AA' })
  const ground = await add('places', { name: 'Hackney Marshes', address: 'Homerton Rd, London E9 5PF' })
  await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30', place_id: ground.id })
  await add('travel_times', { from_place_id: home.id, to_place_id: ground.id, mode: 'uber', minutes: 20 })   // "20 min by Uber"
  mapCalls = []
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const sb = await openOwnerSession()
  await runTick(sb, OWNER_TG, new Date(T().zonedToUTC(T().todayISO(), '06:00')))
  assert.ok(mapCalls.some((u) => u.startsWith('/postcodes/N16AA')) && mapCalls.some((u) => u.startsWith('/postcodes/E95PF')))
  assert.ok(mapCalls.some((u) => /\/Journey\/JourneyResults\/51\.53,-0\.11\/to\/51\.5524,-0\.0228\?.*time=1700/.test(u)), mapCalls.join(' '))
  const rows = await q(`select mode, minutes, source, depart_hour from travel_times where source = 'tfl' order by from_place_id = $1 desc`, [home.id])
  assert.deepEqual(rows[0], { mode: 'transit', minutes: 33, source: 'tfl', depart_hour: 17 }, 'the quickest journey is kept')
  // a second tick the same day doesn't ask again
  mapCalls = []
  await runTick(sb, OWNER_TG, new Date(T().zonedToUTC(T().todayISO(), '06:05')))
  assert.equal(mapCalls.length, 0)
  // tube/bus 33 vs Uber 20 + 5 pickup = 25: within 10 minutes, so tube/bus is recommended
  await nat(`/free ${T().dowShort(D(1))}`)
  assert.match(last().text, /Football 18:00–19:30 \+33 min there by tube\/bus/)
})

test('a journey he has told us is never asked about', { skip }, async () => {
  const home = await add('places', { name: 'Home', is_home: true, address: 'N1 6AA' })
  const ground = await add('places', { name: 'Ground', address: 'E9 5PF' })
  await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30', place_id: ground.id })
  await add('travel_times', { from_place_id: home.id, to_place_id: ground.id, mode: 'bus', minutes: 30 })
  mapCalls = []
  const { runTick } = await import('../lib/telegram/tick.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  await runTick(await openOwnerSession(), OWNER_TG, new Date(T().zonedToUTC(T().todayISO(), '06:00')))
  assert.equal(mapCalls.filter((u) => u.startsWith('/Journey')).length, 0)
})

test('"football is at Hackney Marshes, E9 5PF": a new place and the event’s place in one card make one place', { skip }, async () => {
  const f = await add('events', { title: 'Football', repeat_days: [T().isoDow(D(1))], start_time: '18:00', end_time: '19:30' })
  await ask('football is at Hackney Marshes, E9 5PF', [
    { op: 'event_place', ref: 'Football', value: 'Hackney Marshes' }, { op: 'place_new', value: 'name=Hackney Marshes; address=E9 5PF' }])
  assert.doesNotMatch(last().text, /\(new place\)/, 'the place is made in the same card')
  await tap('Apply')
  assert.match(last().text, /✅ <b>Done/)
  const places = await q(`select id, address from places`)
  assert.equal(places.length, 1)
  assert.equal((await q(`select place_id from events where id = $1`, [f.id]))[0].place_id, places[0].id)
})

test('"an Uber from home to the match is 20 min": the new place "Match" becomes the Match event’s place; Undo unlinks', { skip }, async () => {
  await add('places', { name: 'Home', is_home: true })
  const m = await add('events', { title: 'Match', starts_at: T().zonedToUTC(D(2), '10:00'), ends_at: T().zonedToUTC(D(2), '11:30') })
  await ask('an Uber from home to the match is 20 min', [{ value: 'from=Home; to=Match; minutes=20; mode=uber' }])
  assert.match(last().text, /new place: Match; Match is there/)
  await tap('Apply')
  const [p] = await q(`select id from places where name = 'Match'`)
  assert.equal((await q(`select place_id from events where id = $1`, [m.id]))[0].place_id, p.id)
  await tap('Undo')
  assert.equal((await q(`select place_id from events where id = $1`, [m.id]))[0].place_id, null)
})
