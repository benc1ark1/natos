// Programmes (plans/contracts.md §3.5), plain tests (no database): ordered items, the weekly target, its days
// (weekend-only STEP), pause until a date (and auto-resume after it), end date, stop, gaps_only (College Panda: the
// chapter test first, only the chapters where marks were dropped), optional (only when boosted / asked).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-programmes-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRunning, doneThisWeek, nextItem, nextStep, isDueToday, dayAllowed, parseDays, itemFinished, leftThisWeek, programmeLine } from '../lib/tracker/programmes.ts'
import { programme, item, stepProgramme } from './fixtures/tracker-world.mjs'

const SAT = '2026-10-24', SUN = '2026-10-25', MON = '2026-10-19', WED = '2026-10-21'

test('STEP: 28 items in order, the next one is the first not done', () => {
  const p = stepProgramme()
  assert.equal(p.items.length, 28)
  assert.equal(nextItem(p).title, 'STEP Support – Assignment 3')
  assert.equal(nextStep(p).action, 'do')
  const shuffled = { ...p, items: [...p.items].reverse() }
  assert.equal(nextItem(shuffled).title, 'STEP Support – Assignment 3', 'position order, not list order')
  const skipped = { ...p, items: p.items.map((i) => (i.position === 3 ? { ...i, status: 'skipped' } : i)) }
  assert.equal(nextItem(skipped).title, 'STEP Support – Assignment 4')
  const all = { ...p, items: p.items.map((i) => ({ ...i, status: 'done' })) }
  assert.equal(nextItem(all), null)
  assert.equal(isDueToday(all, SAT, 6), false, 'nothing left → not due')
})

test('weekend-only STEP, once a week: due Sat; done Sat → not Sun; not done Sat → Sun; never on weekdays', () => {
  const p = stepProgramme()
  assert.equal(isDueToday(p, MON, 1), false)
  assert.equal(isDueToday(p, WED, 3), false)
  assert.equal(isDueToday(p, SAT, 6), true)
  assert.equal(isDueToday(p, SUN, 7), true, 'Saturday missed → Sunday')
  const doneSat = { ...p, items: p.items.map((i) => (i.position === 3 ? { ...i, status: 'done', doneOn: SAT } : i)) }
  assert.equal(doneThisWeek(doneSat, SUN), 1)
  assert.equal(isDueToday(doneSat, SUN, 7), false, 'weekly target met')
  assert.equal(isDueToday(doneSat, '2026-10-31', 6), true, 'next weekend again')
})

test('weekly target counts Mon–Sun; nothing more the same day once one is done', () => {
  const p = programme({ id: 'p', name: 'Daily drill', perWeek: 3, items: [1, 2, 3, 4, 5].map((n) => item('p', n)) })
  assert.equal(isDueToday(p, MON, 1), true)
  const one = { ...p, items: p.items.map((i) => (i.position === 1 ? { ...i, status: 'done', doneOn: MON } : i)) }
  assert.equal(isDueToday(one, MON, 1), false, 'one done today already')
  assert.equal(isDueToday(one, '2026-10-20', 2), true)
  assert.equal(leftThisWeek(one, '2026-10-20'), 2)
  const three = { ...p, items: p.items.map((i) => (i.position <= 3 ? { ...i, status: 'done', doneOn: i.position === 1 ? MON : i.position === 2 ? '2026-10-20' : WED } : i)) }
  assert.equal(isDueToday(three, '2026-10-22', 4), false, '3 this week → target met')
  assert.equal(isDueToday(three, '2026-10-26', 1), true, 'a new week')
  const lastWeek = { ...p, items: p.items.map((i) => (i.position === 1 ? { ...i, status: 'done', doneOn: '2026-10-18' } : i)) }
  assert.equal(doneThisWeek(lastWeek, MON), 0, 'Sunday 18 Oct is last week')
})

test('pause until a date: paused through that day, back the day after (also when its status says paused)', () => {
  const p = stepProgramme({ pausedUntil: '2026-10-25' })
  assert.equal(isRunning(p, SAT), false)
  assert.equal(isRunning(p, SUN), false)
  assert.equal(isRunning(p, '2026-10-26'), true)
  assert.equal(isDueToday(p, SAT, 6), false)
  assert.equal(isDueToday(p, '2026-10-31', 6), true)
  const status = stepProgramme({ status: 'paused', pausedUntil: '2026-10-25' })
  assert.equal(isRunning(status, SUN), false)
  assert.equal(isRunning(status, '2026-10-31'), true, 'auto-resumes after the date')
  assert.equal(isRunning(stepProgramme({ status: 'paused' }), '2027-01-01'), false, 'paused with no date: until he resumes it')
})

test('start and end dates; stopped and done never run', () => {
  assert.equal(isRunning(stepProgramme({ endsOn: '2026-10-24' }), SAT), true)
  assert.equal(isRunning(stepProgramme({ endsOn: '2026-10-24' }), SUN), false)
  assert.equal(isDueToday(stepProgramme({ endsOn: '2026-10-24' }), SUN, 7), false)
  assert.equal(isRunning(stepProgramme({ startsOn: '2026-10-25' }), SAT), false)
  assert.equal(isRunning(stepProgramme({ startsOn: '2026-10-25' }), SUN), true)
  assert.equal(isRunning(stepProgramme({ status: 'stopped' }), SAT), false)
  assert.equal(isRunning(stepProgramme({ status: 'done' }), SAT), false)
})

test('gaps_only (College Panda): chapter test first; full marks → skip the chapter; dropped marks → do the chapter', () => {
  const p = programme({ id: 'cp', name: 'College Panda ACT Math', area: 'act', mode: 'gaps_only', perWeek: 3, items: [1, 2, 3].map((n) => item('cp', n, { title: `Chapter ${n}` })) })
  assert.deepEqual([nextStep(p).item.title, nextStep(p).action], ['Chapter 1', 'test'])
  const full = { ...p, items: p.items.map((i) => (i.position === 1 ? { ...i, score: 10, outOf: 10 } : i)) }
  assert.ok(itemFinished(full, full.items[0]), 'full marks → nothing to do there')
  assert.deepEqual([nextStep(full).item.title, nextStep(full).action], ['Chapter 2', 'test'])
  const dropped = { ...p, items: p.items.map((i) => (i.position === 1 ? { ...i, score: 7, outOf: 10, status: 'doing' } : i)) }
  assert.deepEqual([nextStep(dropped).item.title, nextStep(dropped).action], ['Chapter 1', 'do'], 'marks dropped → do the chapter')
  const fixed = { ...dropped, items: dropped.items.map((i) => (i.position === 1 ? { ...i, status: 'done', doneOn: MON } : i)) }
  assert.deepEqual([nextStep(fixed).item.title, nextStep(fixed).action], ['Chapter 2', 'test'])
  assert.equal(itemFinished({ ...p, mode: 'in_order' }, { ...p.items[0], score: 10, outOf: 10 }), false, 'in_order items need doing whatever the score')
})

test('optional (Critical Reader): never due on its own, only when boosted / asked', () => {
  const p = programme({ id: 'cr', name: 'The Critical Reader', area: 'act', mode: 'optional', items: [item('cr', 1)] })
  assert.equal(isDueToday(p, MON, 1), false)
  assert.equal(isDueToday(p, MON, 1, true), true)
})

test('days: weekend · weekdays · "mon, wed" · ranges · daily · any', () => {
  assert.ok(dayAllowed('weekend', 6) && dayAllowed('weekend', 7) && !dayAllowed('weekend', 5))
  assert.ok(dayAllowed('weekdays', 1) && dayAllowed('weekdays', 5) && !dayAllowed('weekdays', 6))
  assert.ok(dayAllowed('mon, wed', 1) && dayAllowed('mon, wed', 3) && !dayAllowed('mon, wed', 2))
  assert.ok(dayAllowed('Monday and Thursday', 4) && !dayAllowed('Monday and Thursday', 5))
  assert.ok(dayAllowed('mon-fri', 3) && !dayAllowed('mon-fri', 6))
  assert.ok(dayAllowed('fri-mon', 7) && dayAllowed('fri-mon', 1) && !dayAllowed('fri-mon', 3))
  assert.ok(dayAllowed(null, 2) && dayAllowed('', 2) && dayAllowed('daily', 2) && dayAllowed('any', 2))
})

test('one line for the bot / Subjects page', () => {
  assert.equal(programmeLine(stepProgramme(), MON), '1 a week · weekend · 2/28 done · next: STEP Support – Assignment 3')
  assert.equal(programmeLine(stepProgramme({ pausedUntil: '2026-10-25', endsOn: '2027-06-30' }), MON), '1 a week · weekend · 2/28 done · paused until 2026-10-25 · ends 2027-06-30 · next: STEP Support – Assignment 3')
  const cp = programme({ id: 'cp', name: 'College Panda', mode: 'gaps_only', perWeek: 3, items: [item('cp', 1, { title: 'Chapter 1' })] })
  assert.equal(programmeLine(cp, MON), '3 a week · 0/1 done · chapter tests first · next: Chapter 1 (chapter test)')
})

test('days in his words: weekend words anywhere, spaced ranges, nothing recognised = any day (and not understood)', () => {
  for (const w of ['weekends only', 'the weekend', 'at weekends', 'Weekend']) assert.ok(dayAllowed(w, 6) && dayAllowed(w, 7) && !dayAllowed(w, 3), w)
  for (const w of ['weekdays only', 'on weekdays']) assert.ok(dayAllowed(w, 1) && !dayAllowed(w, 6), w)
  for (const w of ['mon - fri', 'mon to fri', 'Monday to Friday', 'mon–fri']) assert.ok(dayAllowed(w, 1) && dayAllowed(w, 5) && !dayAllowed(w, 6) && !dayAllowed(w, 7), w)
  assert.ok(dayAllowed('weekends and wednesdays', 3) && dayAllowed('weekends and wednesdays', 7) && !dayAllowed('weekends and wednesdays', 2))
  assert.deepEqual(parseDays('whenever I feel like it'), { days: null, understood: false })
  assert.ok(dayAllowed('whenever I feel like it', 2), 'not understood → any day')
  assert.deepEqual(parseDays(null), { days: null, understood: true })
  assert.deepEqual([...parseDays('sat, sun').days].sort(), [6, 7])
})
