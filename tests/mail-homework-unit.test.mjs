// Homework emails, no database: the deadline in an email's words (lib/mail/deadline.ts), and the title, notes and
// "always homework" senders (lib/mail/homework.ts). The bug this fixes: Sam's "Computer Science Homework - Due 20th
// October 2026" (sent Thu 15 Oct) got due Thu 15 Oct, the day it was sent.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/mail-homework-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findDeadline, deadlinesIn } from '../lib/mail/deadline.ts'
import { homeworkNotes, homeworkSender, homeworkSenders, homeworkTitle, schoolDomain, HOMEWORK_WORDS } from '../lib/mail/homework.ts'
import { readIncoming } from '../lib/mail/rules.ts'

const THU = '2026-10-15T15:05:00Z'   // Thu 15 Oct 2026, 16:05 in London (BST)
const due = (subject, body, sentAt = THU) => {
  const d = findDeadline({ subject, body, sentAt })
  return [d.date, d.time, d.from, d.guess]
}

// Sam's email (his address is left out: the repo is public)
const SAM_SUBJECT = 'Computer Science Homework - Due 20th October 2026'
const SAM_BODY = `Hi Nat,

Please do the following problems before Monday evening at 8pm:

1. Binary search: write it iteratively and recursively
2. Big-O of bubble sort vs merge sort, with a table
3. Exercise 4.3 questions 1–6 from the textbook

Send me your code as a zip.

Thanks,
Sam`

test('Sam’s email: “Due 20th October” in the subject, “before Monday evening at 8pm” in the body → the earlier one, Mon 19 Oct 20:00', () => {
  assert.deepEqual(due(SAM_SUBJECT, SAM_BODY), ['2026-10-19', '20:00', 'body', false])
  assert.equal(findDeadline({ subject: SAM_SUBJECT, body: SAM_BODY, sentAt: THU }).words, 'before Monday evening at 8pm')
  // only the subject: Tue 20 Oct (no time); never the day it was sent
  assert.deepEqual(due(SAM_SUBJECT, ''), ['2026-10-20', null, 'subject', false])
  // the subject earlier than the body: the subject wins
  assert.deepEqual(due('Physics worksheet - due Friday', 'Hand it in by next Wednesday at the latest'), ['2026-10-16', null, 'subject', false])
})

test('other ways of saying the deadline', () => {
  const cases = [
    ['by Friday', '2026-10-16', null],
    ['due tomorrow at 9am', '2026-10-16', '09:00'],
    ['due tmrw 8.30am', '2026-10-16', '08:30'],
    ['please have it done by 8pm on Monday', '2026-10-19', '20:00'],
    ['before Monday 8pm', '2026-10-19', '20:00'],
    ['before Wednesday', '2026-10-20', null],                 // "before Wednesday" with no time = by the end of Tuesday
    ['for Thursday', '2026-10-22', null],                     // sent on a Thursday: the next Thursday after it
    ['Deadline: 3/11', '2026-11-03', null],                   // UK order: day/month
    ['due 3/11/2026', '2026-11-03', null],
    ['due Oct 22nd', '2026-10-22', null],
    ['hand in on 22nd October by 5pm', '2026-10-22', '17:00'],
    ['submit by Tuesday 27th October', '2026-10-27', null],   // the date wins over the weekday
    ['due by midnight on Sunday', '2026-10-18', '23:59'],
    ['due Monday at noon', '2026-10-19', '12:00'],
    ['due today', '2026-10-15', null],
    ['finish by next Monday', '2026-10-19', null],
    ['Due 23:00 Sunday', '2026-10-18', '23:00'],
  ]
  for (const [text, date, time] of cases) assert.deepEqual(due('', text).slice(0, 2), [date, time], text)
})

test('no deadline in the words → the day it was sent, marked as a guess; dates that aren’t deadlines don’t count', () => {
  assert.deepEqual(due('CS homework', 'Have a go at the questions below.'), ['2026-10-15', null, 'sent', true])
  assert.deepEqual(due('Lesson moved', 'Our lesson on Monday at 5pm is now online'), ['2026-10-15', null, 'sent', true], 'no deadline word')
  assert.deepEqual(due('Trip', 'See you on 20th October'), ['2026-10-15', null, 'sent', true])
  assert.deepEqual(due('', 'spend 30 minutes on it, for 2 days'), ['2026-10-15', null, 'sent', true], '“for” needs a day')
  assert.deepEqual(due('', 'due 31st February'), ['2026-10-15', null, 'sent', true], 'not a real date')
  assert.equal(findDeadline({ subject: 'x', body: '', sentAt: THU }).words, '')
})

test('dates without a year: the next one from the day it was sent (into next year in December); the London day', () => {
  assert.deepEqual(due('Mock prep', 'due 2nd January', '2026-12-18T10:00:00Z').slice(0, 2), ['2027-01-02', null])
  assert.deepEqual(due('', 'due 12th October', THU).slice(0, 2), ['2026-10-12', null], 'a few days ago still counts as this year (overdue)')
  // sent 00:30 on Fri 16 Oct in London (23:30 Thu in UTC): "by Friday" is the NEXT Friday after the London day
  assert.deepEqual(due('', 'by Friday', '2026-10-15T23:30:00Z').slice(0, 2), ['2026-10-23', null])
  // across the clock change (Sun 25 Oct): Monday 8pm is still Mon 26 Oct 20:00
  assert.deepEqual(due('', 'before Monday 8pm', '2026-10-24T09:00:00Z').slice(0, 2), ['2026-10-26', '20:00'])
  assert.equal(deadlinesIn('due Friday and the second part by Monday', '2026-10-15').length, 2)
})

test('the task: a clear title from the subject; the notes are what to do (no greeting, sign-off, signature or older emails)', () => {
  assert.equal(homeworkTitle(SAM_SUBJECT, 'Sam'), 'Computer Science homework')
  assert.equal(homeworkTitle('RE: Fwd: Physics worksheet (due Friday)', 'Ms Patel'), 'Physics worksheet')
  assert.equal(homeworkTitle('Homework', 'Sam Smith'), 'Homework from Sam')
  assert.equal(homeworkTitle('', null), 'Homework')
  const notes = homeworkNotes(SAM_BODY)
  assert.equal(notes.split('\n')[0], 'Please do the following problems before Monday evening at 8pm:')
  assert.match(notes, /1\. Binary search: write it iteratively and recursively\n2\. Big-O of bubble sort vs merge sort, with a table\n3\. Exercise 4\.3 questions 1–6 from the textbook/)
  assert.match(notes, /Send me your code as a zip\.$/)
  assert.doesNotMatch(notes, /Hi Nat|Thanks|Sam$/)
  const reply = `Thanks, here's part 2:\n- Q7 to Q9\n\nOn Thu, 15 Oct 2026 at 16:05, Sam wrote:\n> Please do Q1 to Q6\n> Cheers`
  assert.equal(homeworkNotes(reply), 'Thanks, here\'s part 2:\n- Q7 to Q9', 'the quoted older email is left out')
  assert.equal(homeworkNotes('Do Q1–Q3\n--\nSam Tutor\n07123 456789'), 'Do Q1–Q3', 'the signature is left out')
  assert.equal(homeworkNotes('x'.repeat(2000)).length, 1500)
  assert.ok(HOMEWORK_WORDS.test(SAM_SUBJECT))
})

test('always homework: his “Homework senders” setting and his school’s own domain', () => {
  const listed = homeworkSenders('sam.tutor@example.com, @Tutoring.co.uk; nonsense, none-of-this')
  assert.deepEqual(listed, ['sam.tutor@example.com', '@tutoring.co.uk'])
  assert.deepEqual(homeworkSenders('none'), [])
  assert.deepEqual(homeworkSenders(undefined), [])
  const o = { listed, school: schoolDomain('nat@ucs.org.uk') }
  const from = (email, name = null) => homeworkSender({ from_email: email, from_name: name, subject: 'x' }, o)
  assert.equal(from('Sam.Tutor@example.com', 'Sam'), 'listed', 'any case')
  assert.equal(from('vlad@tutoring.co.uk'), 'listed')
  assert.equal(from('patel@ucs.org.uk'), 'school')
  assert.equal(from('office@mail.ucs.org.uk'), 'school', 'a subdomain of the school')
  assert.equal(from('alex@gmail.com'), null)
  assert.equal(from(null, 'Sam'), null)
  assert.equal(schoolDomain('nat@gmail.com'), null, 'a Gmail school account doesn’t make every Gmail user a teacher')
  assert.equal(schoolDomain(null), null)
})

test('the script’s email text is read (and cut to size); emails without it still work', () => {
  const base = { id: 'a1', from: 'Sam <s@x.com>', subject: 'CS', snippet: 'hi', received: THU }
  const one = readIncoming({ account: 'personal', messages: [{ ...base, body: 'Line 1\r\nLine 2\u0007' }, { ...base, id: 'a2' }, { ...base, id: 'a3', body: 'y'.repeat(9000) }] })
  assert.equal(one.messages[0].body, 'Line 1\nLine 2')
  assert.equal(one.messages[1].body, undefined)
  assert.equal(one.messages[2].body.length, 4000)
})
