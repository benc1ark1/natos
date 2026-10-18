// Classroom → "Homework feed" Apps Script (google-apps-script/homework-feed.gs), run here against a fake CalendarApp.
// Run: node --experimental-strip-types --no-warnings --test tests/homework-feed-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import vm from 'node:vm'

const DAY = 86_400_000
const FEED = 'c_8025b5881d60c98f20d3fe87ec7b8c09a47b02e0118018a303270cc6acca6dec@group.calendar.google.com'
const FM = 'c_classroom905c39bf@group.calendar.google.com', PH = 'c_classroomcd065d26@group.calendar.google.com'

/** A fake Google Calendar (just what the script uses), counting writes per calendar. */
function fakeCalendarApp() {
  const cals = new Map(), writes = []
  let seq = 0
  const event = (cal, e) => {
    const ev = {
      ...e, tags: {}, reminders: true, deleted: false,
      getId: () => ev.id, getTitle: () => ev.title, getDescription: () => ev.description ?? '',
      getStartTime: () => new Date(ev.start), getEndTime: () => new Date(ev.end), isAllDayEvent: () => !!ev.allDay,
      getAllDayStartDate: () => new Date(ev.start),
      getTag: (k) => ev.tags[k] ?? null,
      setTag: (k, v) => { writes.push(cal.id); ev.tags[k] = v },
      setTitle: (t) => { writes.push(cal.id); ev.title = t },
      setDescription: (d) => { writes.push(cal.id); ev.description = d },
      setTime: (s, en) => { writes.push(cal.id); Object.assign(ev, { start: s.getTime(), end: en.getTime(), allDay: false }) },
      setAllDayDate: (d) => { writes.push(cal.id); Object.assign(ev, { start: d.getTime(), end: d.getTime() + DAY, allDay: true }) },
      removeAllReminders: () => { writes.push(cal.id); ev.reminders = false },
      deleteEvent: () => { writes.push(cal.id); ev.deleted = true },
    }
    return ev
  }
  const calendar = (id, name) => {
    const cal = { id, name, events: [] }
    Object.assign(cal, {
      getName: () => name,
      getEvents: (s, e) => cal.events.filter((x) => !x.deleted && x.end >= s.getTime() && x.start < e.getTime()),
      createEvent: (title, s, e, o) => { const ev = event(cal, { id: `copy${++seq}`, title, start: s.getTime(), end: e.getTime(), description: o.description }); cal.events.push(ev); writes.push(id); return ev },
      createAllDayEvent: (title, d, o) => { const ev = event(cal, { id: `copy${++seq}`, title, start: d.getTime(), end: d.getTime() + DAY, allDay: true, description: o.description }); cal.events.push(ev); writes.push(id); return ev },
      add: (e) => { const ev = event(cal, e); cal.events.push(ev); return ev },
    })
    cals.set(id, cal)
    return cal
  }
  const app = { getCalendarById: (id) => cals.get(id) ?? null }
  return { app, calendar, writes, live: (id) => cals.get(id).events.filter((e) => !e.deleted) }
}

function loadScript(fake) {
  const Utilities = {
    DigestAlgorithm: { MD5: 'md5' }, Charset: { UTF_8: 'utf8' }, sleep: () => {},
    computeDigest: (alg, text) => [...new Int8Array(createHash(alg).update(text, 'utf8').digest())],
  }
  const ctx = vm.createContext({ CalendarApp: fake.app, Utilities, LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) }, console: { log: () => {} } })
  vm.runInContext(readFileSync(new URL('../google-apps-script/homework-feed.gs', import.meta.url), 'utf8'), ctx)
  return () => vm.runInContext('syncHomework()', ctx)
}

test('Homework feed script: copies assignments once (class, subject, link, ref), follows changes and deletions, never writes to Classroom', () => {
  const f = fakeCalendarApp()
  const feed = f.calendar(FEED, 'Homework feed')
  const fm = f.calendar(FM, 'Maths Further Mf1a'), ph = f.calendar(PH, 'Physics Ph1a')
  const now = Date.now(), in3 = now + 3 * DAY
  fm.add({ id: 'a1@google.com', title: 'Assignment: Integration sheet', start: in3, end: in3, description: 'Q1–10. <a href="https://classroom.google.com/c/AAA/a/BBB/details">Open</a>' })
  fm.add({ id: 'l1@google.com', title: 'Lesson', start: in3, end: in3 + 3_600_000 })
  fm.add({ id: 'a2@google.com', title: 'Assignment: Too far ahead', start: now + 40 * DAY, end: now + 40 * DAY })
  ph.add({ id: 'p1@google.com', title: 'Assignment: Forces worksheet', start: now + 2 * DAY, end: now + 3 * DAY, allDay: true })
  feed.add({ id: 'mine', title: 'My own note', start: in3, end: in3 + 60_000 })                  // his own: left alone
  feed.add({ id: 'past', title: 'Assignment: Old', start: now - 5 * DAY, end: now - 5 * DAY }).tags.natosRef = 'gone-but-past'
  const run = loadScript(f)

  // 6 of the 8 calendars don't exist here: the run copies what it can, then says which it couldn't open
  assert.throws(run, /Couldn’t open 6 Classroom calendar\(s\)/)
  const copies = () => f.live(FEED).filter((e) => e.tags.natosRef && e.id !== 'past')
  assert.deepEqual(copies().map((e) => e.title).sort(), ['Assignment: Forces worksheet', 'Assignment: Integration sheet'])
  const sheet = copies().find((e) => /Integration/.test(e.title))
  assert.equal(sheet.start, in3, 'the due time is kept')
  assert.match(sheet.description, /^Class: Maths Further Mf1a\nSubject: Further Maths\nClassroom: https:\/\/classroom\.google\.com\/c\/AAA\/a\/BBB\/details\n/)
  assert.match(sheet.description, /Q1–10/, 'the teacher’s description is kept')
  assert.match(sheet.description, /\nRef: [0-9a-f]{16}$/)
  assert.equal(sheet.reminders, false, 'no Google pop-ups: Nat OS reminds him')
  const forces = copies().find((e) => /Forces/.test(e.title))
  assert.equal(forces.allDay, true)
  assert.match(forces.description, /Subject: Physics/)
  assert.deepEqual(f.writes.filter((id) => id !== FEED), [], 'Classroom calendars are only read')

  // the rest of the IDs exist: no error; nothing changed → nothing written
  for (const id of ['c_classroom1f4c2c2f', 'c_classroom5748ea3f', 'c_classroomde15dd96', 'c_classroom7d89bbb9', 'c_classroom12c795da', 'c_classroom72d23e30']) f.calendar(`${id}@group.calendar.google.com`, id)
  const before = f.writes.length
  run()
  assert.equal(f.writes.length, before, 'no duplicates, no needless writes')

  // the teacher moves the date and renames it: the same copy changes
  Object.assign(fm.events.find((e) => e.id === 'a1@google.com'), { start: now + 5 * DAY, end: now + 5 * DAY, title: 'Assignment: Integration sheet (extended)' })
  // and deletes the Physics one
  ph.events.find((e) => e.id === 'p1@google.com').deleted = true
  run()
  assert.equal(copies().length, 1)
  assert.equal(copies()[0].id, sheet.id, 'changed in place, not copied again')
  assert.equal(copies()[0].start, now + 5 * DAY)
  assert.equal(copies()[0].title, 'Assignment: Integration sheet (extended)')
  assert.ok(f.live(FEED).some((e) => e.id === 'past'), 'past copies stay')
  assert.ok(f.live(FEED).some((e) => e.id === 'mine'), 'his own events stay')
  assert.deepEqual(f.writes.filter((id) => id !== FEED), [])
})
