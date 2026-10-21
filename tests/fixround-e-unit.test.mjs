// Fix round, part E (homework and email), no database, on his real autumn (tests/support/nat-real.mjs):
// 20. Classroom homework: "Homework from 15/10" is named after the objective/topic, the teacher's questions are in the
//     notes (every assignment, not only tests); the real due time is the sync's (tests/fixround-e-chat.test.mjs).
// 21. Sam's (CS tutor) homework expires once his next lesson has passed: THIS week (ACT), NEXT (half-term, a lesson
//     cancelled), SCHOOL (due Thu: Monday's lesson doesn't count). Vlad's never does.
// 22. Emails where he's only CC'd, or between other people: read from To/Cc, filed as "worth a look".
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/fixround-e-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { THIS, NEXT, SCHOOL, TODAY, ACT_DAY, day, ev, at, TASKS } from './support/nat-real.mjs'
import { classroomDetails, classroomTitle, objectiveOf, plainHomeworkTitle } from '../lib/tracker/classroom.ts'
import { expiredHomework, isTutorHomework, tutorsOf } from '../lib/mail/expire.ts'
import { addressedTo, groupLike, listOnly, readIncoming } from '../lib/mail/rules.ts'
import { groupMailForHim, hideable } from '../lib/mail/watcher.ts'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { moreSettings } from '../lib/settings.ts'
import { DEFAULT_SOURCES } from '../lib/lists.ts'

// ---------------------------------------------------------------------------------------------------------------
// 20. Classroom homework
// ---------------------------------------------------------------------------------------------------------------

// what the Homework feed script writes (google-apps-script/homework-feed.gs): header lines, the teacher's text, the Ref
const feed = (text) => `Class: Maths Further Mf1a\nSubject: Further Maths\nClassroom: https://classroom.google.com/c/AAA/a/BBB/details\n\n${text}\n\nRef: 0123456789abcdef`
// NEXT week (half-term): FM set on Thu 15 Oct, due Fri 30 Oct
const FM = feed('Objective: To be able to sketch loci in the Argand diagram.\n\nQuestions: Ex 2B Q1–12 (odd numbers), then Ex 2C Q3, Q5.\nhttps://classroom.google.com/c/AAA/a/BBB/details')
// SCHOOL week: physics set in half-term, due Mon 2 Nov 08:30, no labels
const PHYS = feed('Hi all,\nSimple harmonic motion: read 4.1–4.3 and answer the end-of-chapter questions 1–8.\nDue before the lesson.')

test('20: "Homework from 15/10" and friends only say it’s homework; a real title is left alone', () => {
  for (const t of ['Homework from 15/10', 'Homework from 15.10.26', 'HW 19/10', 'Homework - Thursday 15th October', 'Week 7 homework', 'Homework', 'Homework (set 15 Oct)', 'Prep for Monday'])
    assert.ok(plainHomeworkTitle(t), t)
  for (const t of ['Integration sheet', 'Forces worksheet', 'FM HT2 Test', 'Complex numbers homework', 'SHM booklet'])
    assert.ok(!plainHomeworkTitle(t), t)
})

test('20: the title is the objective/topic (NEXT week’s FM, SCHOOL week’s physics), never "Homework from <date>"', () => {
  assert.equal(objectiveOf(FM), 'Sketch loci in the Argand diagram')
  assert.equal(classroomTitle('Homework from 15/10', FM, 'Further Maths'), 'Sketch loci in the Argand diagram')
  // no label: the first real line (greeting and "due …" lines skipped), first sentence only
  assert.equal(classroomTitle('Homework from 16.10', PHYS, 'Physics'), 'Simple harmonic motion: read 4.1–4.3 and answer the end-of-chapter questions 1–8')
  assert.equal(classroomTitle('Homework', feed('Topic:\nMatrices & vectors'), 'Further Maths'), 'Matrices & vectors', 'the topic on the next line')
  // nothing in the description: the subject's homework (still no date)
  assert.equal(classroomTitle('Homework from 19/10', feed(''), 'Physics'), 'Physics homework')
  assert.equal(classroomTitle('Homework from 19/10', null, null), 'School homework')
  // his teachers' real titles stay
  assert.equal(classroomTitle('Integration sheet', FM, 'Further Maths'), 'Integration sheet')
})

test('20: the questions are in the notes for every assignment (not only tests); the header lines and link line go', () => {
  assert.equal(classroomDetails('Maths Further Mf1a · Due 08:30', 'Homework from 15/10', FM),
    'Maths Further Mf1a · Due 08:30\n\nObjective: To be able to sketch loci in the Argand diagram.\n\nQuestions: Ex 2B Q1–12 (odd numbers), then Ex 2C Q3, Q5.')
  assert.equal(classroomDetails(null, 'Homework from 16.10', PHYS), 'Hi all,\nSimple harmonic motion: read 4.1–4.3 and answer the end-of-chapter questions 1–8.\nDue before the lesson.')
  assert.equal(classroomDetails('Mf1a', 'Integration sheet', feed('')), 'Mf1a', 'nothing to add')
})

// ---------------------------------------------------------------------------------------------------------------
// 21. Sam's homework expires after his next lesson
// ---------------------------------------------------------------------------------------------------------------

// Sam is his CS tutor: lessons Mon + Thu 17:00–18:00 (his calendar, not code). In half-term (NEXT) Mon 26 Oct is off.
const SAM = ev({ id: 'cs-tutor', title: 'CS tutor', repeat_days: [1, 4], start_time: '17:00', end_time: '18:00' })
const VLAD = ev({ id: 'vlad', title: 'Maths tutor (Vlad)', repeat_days: [3], start_time: '17:00', end_time: '18:00' })
const OFF = [{ id: 'x1', event_id: 'cs-tutor', on_date: day(NEXT, 0), cancelled: true, new_date: null, new_start: null, new_end: null, missed: false }]
const SOURCES = [...DEFAULT_SOURCES.filter((s) => s.key !== 'tutor_cs'), { key: 'tutor_cs', label: 'CS tutor (Sam)' }]
const hw = (o) => ({ title: 'Binary search exercises', details: null, source_text: null, origin: 'tutor_cs', due_at: null, is_system: false, ...o })
const vlad = { ...TASKS.find((t) => t.id === 't-vlad'), origin: 'tutor_maths_physics', created_at: at(day(THIS, 0), '19:00') }
const tutors = tutorsOf(String(moreSettings({}).homeworkUntilLesson), SOURCES)
const gone = (tasks, now, changes = []) => expiredHomework(tasks, tutors, [SAM, VLAD], changes, new Date(now)).map((x) => x.id)

test('21: whose homework: his setting (default "CS tutor") with his sources; Sam’s by source, by his email, or by name', () => {
  assert.deepEqual(tutors, [{ item: 'CS tutor', keys: ['tutor_cs'], names: ['CS tutor', 'Sam'] }])
  const [t] = tutors
  assert.ok(isTutorHomework(hw({ id: 'a' }), t))
  assert.ok(isTutorHomework(hw({ id: 'b', origin: 'own', details: 'Do 1–6.\n\nFrom Sam’s email: “CS homework”.' }), t))
  assert.ok(isTutorHomework(hw({ id: 'c', origin: 'own', title: 'Sam’s CS homework' }), t))
  assert.ok(!isTutorHomework(hw({ id: 'd', origin: 'own', title: 'Give Sam his charger' }), t), 'not homework')
  assert.ok(!isTutorHomework(vlad, t), 'Vlad’s homework is not Sam’s')
  assert.deepEqual(tutorsOf('none', SOURCES), [])
})

test('21 THIS week (ACT): set after Monday’s lesson → expires once Thursday’s lesson has ended, not before', () => {
  const t = hw({ id: 'sam-this', created_at: at(day(THIS, 0), '20:30') })   // Mon 19 Oct, after the 17:00 lesson
  assert.deepEqual(gone([t], at(TODAY, '12:00')), [], 'Wed 21 Oct: Thursday’s lesson is still to come')
  assert.deepEqual(gone([t], at(day(THIS, 3), '17:30')), [], 'during the lesson')
  assert.deepEqual(gone([t], at(day(THIS, 3), '18:00')), ['sam-this'], 'Thu 22 Oct 18:00: the lesson has passed')
  assert.deepEqual(gone([t], at(ACT_DAY, '12:00')), ['sam-this'])
})

test('21 NEXT week (half-term): Monday’s lesson is cancelled, so it lasts until Thursday’s', () => {
  const t = hw({ id: 'sam-next', created_at: at(day(THIS, 3), '19:00') })   // Thu 22 Oct, after that lesson
  assert.deepEqual(gone([t], at(day(NEXT, 0), '19:00'), OFF), [], 'Mon 26 Oct: no lesson that day')
  assert.deepEqual(gone([t], at(day(NEXT, 0), '19:00')), ['sam-next'], '(without the cancellation Monday’s would count)')
  assert.deepEqual(gone([t], at(day(NEXT, 3), '18:05'), OFF), ['sam-next'], 'Thu 29 Oct after the lesson')
})

test('21 SCHOOL week: due Thu 5 Nov, so Monday’s lesson doesn’t end it; Vlad’s homework never expires', () => {
  const t = hw({ id: 'sam-school', created_at: at(day(SCHOOL, 0), '08:00'), due_at: at(day(SCHOOL, 3), '23:59') })
  assert.deepEqual(gone([t, vlad], at(day(SCHOOL, 0), '19:00')), [], 'Mon 2 Nov evening: due Thursday')
  assert.deepEqual(gone([t, vlad], at(day(SCHOOL, 3), '18:30')), ['sam-school'], 'Thu 5 Nov after the lesson; Vlad’s stays')
  assert.deepEqual(gone([vlad], at(day(SCHOOL, 4), '20:00')), [], 'Vlad’s (catch-up work is a normal task) is never expired')
  // a prep session is never his homework
  assert.deepEqual(gone([hw({ id: 'sys', is_system: true, created_at: at(day(THIS, 0), '20:30') })], at(day(SCHOOL, 4), '20:00')), [])
})

// ---------------------------------------------------------------------------------------------------------------
// 22. Only CC'd, or between other people
// ---------------------------------------------------------------------------------------------------------------

const ME = ['babichn@ucs.org.uk']
test('22: who it was written to, from the To and Cc headers', () => {
  assert.equal(addressedTo({ to: 'Nat Babich <babichn@ucs.org.uk>', cc: '' }, ME), 'to')
  assert.equal(addressedTo({ to: 'Mum <mum@example.com>, babichn@ucs.org.uk', cc: 'Dad <dad@example.com>' }, ME), 'to')
  assert.equal(addressedTo({ to: 'Mum <mum@example.com>', cc: 'Nat <BabichN@ucs.org.uk>' }, ME), 'cc', 'only CC’d (any case)')
  assert.equal(addressedTo({ to: 'Mr Lee <lee@ucs.org.uk>', cc: 'Ms Hall <hall@ucs.org.uk>' }, ME), 'others', 'between other people')
  assert.equal(addressedTo({ to: 'undisclosed-recipients:;', cc: '' }, ME), 'to', 'Bcc to him')
  assert.equal(addressedTo({}, ME), null, 'an old script sends no To: sorted as before')
  assert.equal(addressedTo({ to: 'mum@example.com', cc: '' }, [null]), null, 'his address not known: sorted as before')
  // his personal Gmail: dots, +tags and googlemail are the same box; an alias counts
  assert.equal(addressedTo({ to: 'n.a.t+school@googlemail.com', cc: '' }, ['nat@gmail.com']), 'to')
  assert.equal(addressedTo({ to: 'mum@example.com', cc: 'nat.b@ucs.org.uk' }, ['babichn@ucs.org.uk', 'nat.b@ucs.org.uk']), 'cc')
})

test('22: the script’s To/Cc and aliases are read and checked', () => {
  const r = readIncoming({ account: 'school', address: 'babichn@ucs.org.uk', aliases: ['Nat.B@ucs.org.uk', 'not an address'],
    messages: [{ id: 'm1', from: 'Ms Hall <hall@ucs.org.uk>', subject: 'Trip', snippet: '', received: at(TODAY, '09:00'), to: 'mum@example.com', cc: 'babichn@ucs.org.uk' },
      { id: 'm2', from: 'x@y.com', subject: 'Old script', snippet: '', received: at(TODAY, '09:00') }] })
  assert.deepEqual(r.aliases, ['nat.b@ucs.org.uk'])
  assert.deepEqual([r.messages[0].to, r.messages[0].cc], ['mum@example.com', 'babichn@ucs.org.uk'])
  assert.ok(!('to' in r.messages[1]), 'no To from an old script')
})

// ---------------------------------------------------------------------------------------------------------------
// 22 (follow-up). Never hide an email he needs
// ---------------------------------------------------------------------------------------------------------------

test('22: a class/year Google Group or list he’s in is for him, never "between other people"', () => {
  // NEXT week (half-term): Ms Hall writes to Year 13 about the trip; SCHOOL week: his FM set
  for (const to of ['Year 13 <year13@ucs.org.uk>', 'y13@ucs.org.uk', 'Year 12 parents <y12parents@ucs.org.uk>', 'all-students@ucs.org.uk',
    'fm-set2@ucs.org.uk', 'maths.set1@ucs.org.uk', 'class13b@ucs.org.uk', 'cs-group@ucs.org.uk', 'sixthform-list@ucs.org.uk', 'staff@ucs.org.uk',
    'hall+trip@ucs.org.uk', '2027@ucs.org.uk', 'all@ucs.org.uk', 'all.y13@ucs.org.uk'])
    assert.equal(addressedTo({ to, cc: '' }, ME), 'to', to)
  // the group in Cc, or a list header (List-Id / Precedence: list)
  assert.equal(addressedTo({ to: 'Mr Lee <lee@ucs.org.uk>', cc: 'year13@ucs.org.uk' }, ME), 'to')
  assert.equal(addressedTo({ to: 'Mr Lee <lee@ucs.org.uk>', cc: '', list: true }, ME), 'to', 'sent through a list')
  // a group in To with him in Cc: he may be in the group, so it's for him
  assert.equal(addressedTo({ to: 'year13@ucs.org.uk', cc: 'babichn@ucs.org.uk' }, ME), 'to')
  // people's own addresses stay people (Ms Hall, Seth, Callum, Allen)
  for (const a of ['hall@ucs.org.uk', 'seth.b@ucs.org.uk', 'callum@example.com', 'allen@example.com', 'marshall@example.com'])
    assert.ok(!groupLike(a), a)
  assert.equal(addressedTo({ to: 'Seth <seth.b@ucs.org.uk>', cc: 'Callum <callum@example.com>' }, ME), 'others')
  assert.equal(addressedTo({ to: '', cc: 'mum@example.com' }, ME), 'to', 'nobody in To: Bcc to him')
})

test('22: a long class list keeps his address (the script and the app both keep 4,000 characters)', () => {
  const pupils = Array.from({ length: 70 }, (_, i) => `Pupil ${i + 1} <pupil.${i + 1}.surname@ucs.org.uk>`).join(', ')
  assert.ok(pupils.length > 2000 && pupils.length < 3900, String(pupils.length))
  const r = readIncoming({ account: 'school', address: 'babichn@ucs.org.uk', messages: [{ id: 'long1', from: 'Ms Hall <hall@ucs.org.uk>', subject: 'Trip money',
    snippet: '', received: at(TODAY, '09:00'), to: `${pupils}, Nat Babich <babichn@ucs.org.uk>`, cc: '' }] })
  assert.equal(addressedTo(r.messages[0], ME), 'to', 'his address at the end of a 70-name To')
  // cut short anyway (an even longer list): unsure, so it's for him
  const huge = Array.from({ length: 160 }, (_, i) => `pupil.${i + 1}.surname@ucs.org.uk`).join(', ')
  const r2 = readIncoming({ account: 'school', messages: [{ id: 'long2', from: 'hall@ucs.org.uk', subject: 'Trip', snippet: '', received: at(TODAY, '09:00'), to: huge, cc: '' }] })
  assert.equal(r2.messages[0].to.length, 4000)
  assert.equal(addressedTo(r2.messages[0], ME), 'to')
  // the list header is read
  const r3 = readIncoming({ account: 'school', messages: [{ id: 'l3', from: 'hall@ucs.org.uk', subject: 'Trip', snippet: '', received: at(TODAY, '09:00'), to: 'lee@ucs.org.uk', list: true }] })
  assert.equal(r3.messages[0].list, true)
})

test('22: both his accounts are him: school mail forwarded to his personal Gmail is still To him', () => {
  // the personal watcher sees To: his school address; the school account's address (and his Google account) count
  const fwd = { to: 'Nat Babich <babichn@ucs.org.uk>', cc: '' }
  assert.equal(addressedTo(fwd, ['nat.babich@gmail.com', 'babichn@ucs.org.uk']), 'to')
  assert.equal(addressedTo({ to: 'mum@example.com', cc: 'NatBabich@gmail.com' }, ['babichn@ucs.org.uk', 'nat.babich@gmail.com']), 'cc')
})

test('22: homework, a deadline, a flagged or homework sender is never filed away, whatever the headers', () => {
  const e = (o) => ({ subject: 'Lift on Saturday', snippet: 'Can you take the boys to the match?', received_at: at(TODAY, '09:00'), flagged: false, body: null, ...o })
  assert.equal(hideable(e({}), null), true, 'a plain CC: worth a look')
  assert.equal(hideable(e({}), 'school'), true, 'a teacher’s note about something else: worth a look')
  assert.equal(hideable(e({ subject: 'Half-term homework' }), null), false, 'homework words')
  assert.equal(hideable(e({ snippet: 'Please hand in the forms by Friday' }), null), false, 'a deadline')
  assert.equal(hideable(e({ subject: 'Trip', snippet: 'Hi all', body: 'Reply slips due Thu 29 Oct.' }), 'school'), false, 'a deadline in the text')
  assert.equal(hideable(e({ flagged: true }), null), false, 'his rules flag the sender')
  assert.equal(hideable(e({}), 'listed'), false, 'one of his homework senders')
})

test('21: only homework expires: a reminder from Sam’s source with no due date never does', () => {
  const [t] = tutors
  assert.ok(!isTutorHomework(hw({ id: 'pay', title: 'Pay Sam for lessons' }), t), 'a reminder')
  assert.ok(!isTutorHomework(hw({ id: 'pay2', origin: 'own', title: 'Pay Sam', details: 'From Sam’s email: “Invoice for October”.' }), t))
  assert.deepEqual(gone([hw({ id: 'pay', title: 'Pay Sam for lessons', created_at: at(day(THIS, 0), '20:30') })], at(day(SCHOOL, 4), '20:00')), [])
  // with a due date, or homework-like, it's homework (THIS week's exercises, a sheet, a write-up)
  assert.ok(isTutorHomework(hw({ id: 'due', title: 'Arrays', due_at: at(day(THIS, 3), '17:00') }), t))
  assert.ok(isTutorHomework(hw({ id: 'sheet', title: 'Recursion sheet' }), t))
  assert.ok(isTutorHomework(hw({ id: 'w', title: 'Merge sort write-up' }), t))
})

// ---------------------------------------------------------------------------------------------------------------
// 22 (round 2). An email he needs is never hidden or dropped
// ---------------------------------------------------------------------------------------------------------------

test('22: any name with a digit, a form, sixth form, upper/lower school, department, house or subject list is a group', () => {
  // SCHOOL week: his Upper Sixth form, his physics set, the maths department
  for (const a of ['sixthform@ucs.org.uk', 'upper6@ucs.org.uk', 'u6@ucs.org.uk', '13b@ucs.org.uk', 'form13@ucs.org.uk', 'physics@ucs.org.uk',
    'maths-dept@ucs.org.uk', 'mathsdept@ucs.org.uk', 'lower6@ucs.org.uk', 'lower-school@ucs.org.uk', 'house.blue@ucs.org.uk', 'cs.teachers@ucs.org.uk',
    'fm@ucs.org.uk', 'nbabich6@gmail.com', 'ph1a@ucs.org.uk'])
    assert.ok(groupLike(a), a)
  for (const a of ['hall@ucs.org.uk', 'flowers@ucs.org.uk', 'seth.b@ucs.org.uk', 'lee@ucs.org.uk', 'callum@example.com', 'mum@example.com'])
    assert.ok(!groupLike(a), a)
  // so a teacher's email to his form, with him not named: for him (a normal card), never "between other people"
  assert.equal(addressedTo({ to: 'Upper Sixth <upper6@ucs.org.uk>', cc: '' }, ME), 'to')
  assert.equal(addressedTo({ to: 'Mr Lee <lee@ucs.org.uk>', cc: 'Physics <physics@ucs.org.uk>' }, ME), 'to')
})

// people's own addresses (no digits: a digit makes an address a group): "ab.jones@example.com"
const ABC = 'abcdefghijklmnopqrstuvwxyz'
const people = (n) => Array.from({ length: n }, (_, i) => `Mr ${ABC[i % 26]} <${ABC[i % 26]}${ABC[Math.floor(i / 26) % 26]}.jones@example.com>`).join(', ')
const msg = (o) => ({ id: 'c1', from: 'Ms Hall <hall@ucs.org.uk>', subject: 'Trip money', snippet: '', received: at(TODAY, '09:00'), ...o })

test('22: a header the script cut short is unsure (for him), even after trimming; an old script’s 1,000-character cut too', () => {
  // the script cut To at 4,000 characters, mid-list, ending in ", " (trimmed here to under 4,000): it says so
  const cut = people(200).slice(0, 3998) + ', '
  const r = readIncoming({ account: 'school', messages: [msg({ to: cut, cc: '', toCut: true, ccCut: false })] })
  assert.ok(r.messages[0].to.length < 4000, 'trimmed')
  assert.equal(r.messages[0].toCut, true)
  assert.equal(addressedTo(r.messages[0], ME), 'to', 'cut: his address may be in what was cut off')
  // a whole list of other people (the script says not cut): between other people
  const r2 = readIncoming({ account: 'school', messages: [msg({ to: people(20), cc: '', toCut: false, ccCut: false })] })
  assert.equal(r2.messages[0].toCut, undefined)
  assert.equal(addressedTo(r2.messages[0], ME), 'others')
  // a cut Cc
  const r3 = readIncoming({ account: 'school', messages: [msg({ to: 'Mr Lee <lee@ucs.org.uk>', cc: people(10), toCut: false, ccCut: true })] })
  assert.equal(addressedTo(r3.messages[0], ME), 'to')
  // the old script (no flag) cut at 1,000: a header that long is unsure; a shorter one is read as before
  const old = people(60).slice(0, 1000).trimEnd()
  assert.ok(old.length > 980 && old.length <= 1000, String(old.length))
  const r4 = readIncoming({ account: 'school', messages: [msg({ to: old, cc: '' })] })
  assert.equal(addressedTo(r4.messages[0], ME), 'to', 'the old script may have cut it')
  const r5 = readIncoming({ account: 'school', messages: [msg({ to: people(5), cc: '' })] })
  assert.equal(addressedTo(r5.messages[0], ME), 'others')
})

test('22: group mail (List-Id) is for him when it’s from his school or a homework sender, or sets work; newsletters and robots stay ignored', () => {
  // what the script sends: a Google Group email (new script: not a newsletter), an old script's (no flags), a newsletter, a robot
  const read = (o) => readIncoming({ account: 'school', messages: [msg({ automated: true, list: true, ...o })] }).messages[0]
  assert.equal(listOnly(read({ newsletter: false, bulk: false })), true, 'a Google Group')
  assert.equal(listOnly(read({})), true, 'an old script: unsure, so it may be group mail')
  assert.equal(listOnly(read({ newsletter: true })), false, 'its own unsubscribe link: a newsletter')
  assert.equal(listOnly(read({ bulk: true })), false, 'Precedence: bulk or Auto-Submitted')
  assert.equal(listOnly(read({ list: false })), false, 'automated without a list header: a robot')

  const e = (o) => ({ subject: 'Assembly moved', snippet: 'Assembly is in the hall this week.', received_at: at(TODAY, '09:00'), labels: [], from_email: 'lee@ucs.org.uk', details: { list: true }, body: null, ...o })
  assert.equal(groupMailForHim(e({}), 'school'), true, 'a teacher to year13@ (no homework words): sorted as usual')
  assert.equal(groupMailForHim(e({ from_email: 'coach@club.example.com', subject: 'Kit order', snippet: 'Sizes in by Friday please' }), null), true, 'a deadline')
  assert.equal(groupMailForHim(e({ from_email: 'coach@club.example.com', subject: 'Half-term homework' }), null), true, 'homework words')
  assert.equal(groupMailForHim(e({ from_email: 'coach@club.example.com' }), null), false, 'other group chatter: still ignored')
  assert.equal(groupMailForHim(e({ details: {} }), 'school'), false, 'a newsletter from school (not list-only): still ignored')
  assert.equal(groupMailForHim(e({ from_email: 'noreply@ucs.org.uk', subject: 'Homework due' }), 'school'), false, 'a no-reply robot')
  assert.equal(groupMailForHim(e({ labels: ['CATEGORY_PROMOTIONS'] }), 'school'), false, 'a promotion')
  assert.equal(groupMailForHim(e({ labels: ['CATEGORY_FORUMS'] }), 'school'), true, 'Gmail’s Forums tab is where group mail goes')
})

// ---------------------------------------------------------------------------------------------------------------
// 22 (round 2). The Gmail script: group mail, cut flags, and parts small enough for Nat OS
// ---------------------------------------------------------------------------------------------------------------

const GS = readFileSync(new URL('../google-apps-script/mail-watcher.gs', import.meta.url), 'utf8')
const FEED = 'feed@group.calendar.google.com'
/** The script against a fake Gmail (metadata + full), UrlFetchApp (answers by `status(post, n)`), properties and a calendar. */
function script(msgs, { status = () => 200, blocked = false } = {}) {
  const posts = [], props = new Map(), events = []
  const Gmail = { Users: {
    getProfile: () => ({ emailAddress: 'babichn@ucs.org.uk' }),
    Settings: { SendAs: { list: () => ({ sendAs: [] }) } },
    Messages: {
      list: (_me, o) => {
        const after = Number(o.q.match(/after:(\d+)/)[1]) * 1000
        return { messages: msgs.filter((m) => Number(m.internalDate) > after).sort((a, b) => b.internalDate - a.internalDate).map((m) => ({ id: m.id })) }
      },
      get: (_me, id, o) => {
        const m = msgs.find((x) => x.id === id)
        if (o.format === 'full') return { payload: { mimeType: 'text/plain', body: { data: Buffer.from(m.body ?? '', 'utf8').toString('base64url') } } }
        return { id, threadId: `t-${id}`, internalDate: m.internalDate, snippet: m.snippet, labelIds: m.labelIds ?? ['INBOX'],
          payload: { headers: Object.entries(m.headers).filter(([k]) => o.metadataHeaders.includes(k)).map(([name, value]) => ({ name, value })) } }
      },
    },
  } }
  const UrlFetchApp = { fetch: (_url, o) => {
    if (blocked) throw new Error('You do not have permission to call UrlFetchApp.fetch')
    const p = { size: o.payload.length, body: JSON.parse(o.payload) }
    posts.push(p)
    const code = status(p, posts.length)
    return { getResponseCode: () => code, getContentText: () => (code === 200 ? '{"ok":true}' : '{"ok":false}') }
  } }
  const cal = {
    createEvent: (title, at, _e, o) => {
      const ev = { title, at, description: o.description, tags: {}, getId: () => 'e', removeAllReminders: () => {}, setTag: (k, v) => { ev.tags[k] = v }, getTag: (k) => ev.tags[k] }
      events.push(ev)
      return ev
    },
    getEventById: () => null, getEvents: () => [],
  }
  const ctx = vm.createContext({
    Gmail, UrlFetchApp, console: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CalendarApp: { getCalendarById: (id) => (id === FEED ? cal : null) },
    Utilities: { sleep: () => {}, base64DecodeWebSafe: (s) => [...Buffer.from(s, 'base64url')], newBlob: (b) => ({ getDataAsString: () => Buffer.from(b).toString('utf8') }) },
  })
  vm.runInContext(GS.replace('__ACCOUNT__', 'school').replace('__MAIL_SECRET__', 'k'.repeat(64)).replace('__FALLBACK__', blocked ? FEED : ''), ctx)
  return { posts, props, events, run: () => vm.runInContext('checkMail()', ctx) }
}
const NOW = Date.now()
const gmail = (id, minsAgo, headers, o = {}) => ({ id, internalDate: String(NOW - minsAgo * 60_000), snippet: o.snippet ?? '', headers: { From: 'Ms Hall <hall@ucs.org.uk>', Subject: 'Trip', ...headers }, ...o })

test('22: the script marks a Google Group email as group mail (its text sent for homework), a newsletter as a newsletter, and says when To/Cc were cut', () => {
  const GROUP = { 'List-Id': '<year13.ucs.org.uk>', Precedence: 'list', 'List-Unsubscribe': '<mailto:googlegroups-manage+123+unsubscribe@ucs.org.uk>, <https://groups.google.com/a/ucs.org.uk/group/year13/subscribe>' }
  const s = script([
    gmail('g1', 30, { ...GROUP, To: 'Year 13 <year13@ucs.org.uk>', Subject: 'Physics homework' }, { snippet: 'Questions 1–8 on SHM by Friday', body: 'Read 4.1–4.3 and answer questions 1–8.' }),
    gmail('n1', 20, { From: 'Study Tips <hello@studytips.example.com>', Subject: 'Revision tips', 'List-Id': '<tips.list-id.example.com>', 'List-Unsubscribe': '<https://studytips.example.com/unsub>', To: 'babichn@ucs.org.uk' }, { snippet: 'Our best revision tips', body: 'NEWSLETTER' }),
    gmail('l1', 10, { To: people(200), Cc: 'mum@example.com' }),
  ])
  s.run()
  const [g1, n1, l1] = s.posts[0].body.messages
  assert.deepEqual([g1.automated, g1.list, g1.newsletter, g1.bulk], [true, true, false, false], 'a Google Group: group mail')
  assert.equal(g1.body, 'Read 4.1–4.3 and answer questions 1–8.', 'its text goes, so the task has what to do')
  assert.deepEqual([n1.automated, n1.newsletter], [true, true])
  assert.equal(n1.body, undefined, 'never a newsletter’s text')
  assert.deepEqual([l1.to.length, l1.toCut, l1.ccCut], [4000, true, false])
})

test('22: a busy inbox is sent in parts under 150,000 characters (each remembered once delivered); a refused part is sent again next run, the others never twice', () => {
  // 40 emails to long class lists (4,000 characters of To and Cc each), with homework text: far over Nat OS’s 200,000 at once
  const msgs = Array.from({ length: 40 }, (_, i) => gmail(`m${String(i).padStart(2, '0')}`, 300 - i, { To: people(200), Cc: people(200), Subject: `Homework ${i}` }, { snippet: 'Questions 1–8', body: 'Q'.repeat(4000) }))
  let fail = 2   // Nat OS refuses the second part once (too big, or down)
  const s = script(msgs, { status: (_p, n) => (n === fail ? 413 : 200) })
  assert.throws(() => s.run(), /413/)
  assert.equal(s.posts.length, 2)
  for (const p of s.posts) assert.ok(p.size < 150_000, String(p.size))
  const first = s.posts[0].body.messages.map((m) => m.id)
  assert.ok(first.length > 0 && first.length < 40, String(first.length))
  assert.deepEqual(JSON.parse(s.props.get('sentIds')), first, 'the first part is remembered')
  assert.equal(Number(s.props.get('since')), Math.max(...s.posts[0].body.messages.map((m) => Date.parse(m.received))), 'the starting point moved on past it')
  // next run: the rest, in parts, never the first part again
  fail = -1
  s.run()
  const later = s.posts.slice(2).flatMap((p) => p.body.messages.map((m) => m.id))
  for (const p of s.posts) assert.ok(p.size < 150_000)
  assert.deepEqual([...first, ...later], msgs.map((m) => m.id), 'every email once, oldest first')
  assert.ok(s.posts.length - 2 >= 2, 'in parts')
  // nothing new: one check-in
  const n = s.posts.length
  s.run()
  assert.equal(s.posts.length, n + 1)
  assert.deepEqual(s.posts[n].body.messages, [])
})

test('22: the school fallback calendar keeps each entry small: To/Cc short and marked as cut (so the email counts as his)', () => {
  const s = script([gmail('f1', 30, { To: people(200), Cc: people(200) }, { snippet: 'Trip money by Friday' })], { blocked: true })
  s.run()
  const mail = s.events.filter((e) => e.tags.natosMail === 'mail')
  assert.equal(mail.length, 1)
  assert.ok(mail[0].description.length < 3000, String(mail[0].description.length))
  const payload = JSON.parse(mail[0].description.slice('natos-mail '.length))
  const one = payload.messages[0]
  assert.deepEqual([one.to.length <= 500, one.toCut, one.ccCut], [true, true, true])
  const r = readIncoming({ ...payload, via: 'calendar' })
  assert.equal(addressedTo(r.messages[0], ME), 'to', 'cut, so unsure: for him')
})
