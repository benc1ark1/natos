/**
 * Nat OS: Google Classroom homework → "Homework feed" calendar.
 * Runs in Google Apps Script on the SCHOOL account (babichn@ucs.org.uk), every hour.
 *
 * It copies the "Assignment: …" events for the next 30 days from the Classroom calendars below into Homework feed.
 * Homework feed is shared with your personal Google account, where Nat OS reads it and makes each one a must-do
 * homework task.
 *  - Each copy keeps the title, the due time (or the all-day date) and the description with the Classroom link.
 *    The class name, subject and Classroom link are added at the top of the description.
 *  - Never a duplicate: each copy carries a "Ref" of the assignment it came from.
 *  - The teacher changes one → the copy changes. The teacher deletes one → the copy is removed. Past ones stay.
 *  - It only ever writes to Homework feed. The Classroom calendars are only read.
 *
 * Next school year: change CLASSES below (calendar ID + subject). A calendar's ID is in Google Calendar:
 * ⋮ next to the calendar → Settings and sharing → Integrate calendar → Calendar ID.
 */

// The calendar the copies go into.
const FEED_ID = 'c_8025b5881d60c98f20d3fe87ec7b8c09a47b02e0118018a303270cc6acca6dec@group.calendar.google.com';

// How many days ahead to copy.
const DAYS_AHEAD = 30;

// Your Classroom calendars: [calendar ID, subject in Nat OS]. The class name is read from the calendar itself.
const CLASSES = [
  ['c_classroom1f4c2c2f@group.calendar.google.com', 'Further Maths'], // 2026-28 A Level Further Maths
  ['c_classroom5748ea3f@group.calendar.google.com', 'Maths'],         // 2026-28 A Level Single Maths
  ['c_classroom905c39bf@group.calendar.google.com', 'Further Maths'], // Maths Further Mf1a
  ['c_classroomde15dd96@group.calendar.google.com', 'Further Maths'], // Maths Further Mf1b
  ['c_classroom7d89bbb9@group.calendar.google.com', 'Further Maths'], // Maths Further Mf1c
  ['c_classroom12c795da@group.calendar.google.com', 'Further Maths'], // Maths Further Mf1d
  ['c_classroomcd065d26@group.calendar.google.com', 'Physics'],       // Physics Ph1a
  ['c_classroom72d23e30@group.calendar.google.com', 'Physics'],       // Physics Ph1b
];

// ---------------------------------------------------------------------------------------------------------------
// Nothing below needs changing.
// ---------------------------------------------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;
const ASSIGNMENT = /^\s*assignment\s*:/i;
const LINK = /https:\/\/classroom\.google\.com\/[^\s<>"')\]]+/;
const REF_TAG = 'natosRef';   // hidden tags on each copy: which assignment it is, and what was last copied
const SIG_TAG = 'natosSig';

/** The hourly job (and what you run by hand). */
function syncHomework() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;   // a run is already going
  try {
    const feed = CalendarApp.getCalendarById(FEED_ID);
    if (!feed) throw new Error('Can’t open the Homework feed calendar. Check FEED_ID at the top of the script.');
    const now = new Date();
    const until = new Date(now.getTime() + DAYS_AHEAD * DAY);

    // 1. What Homework feed should hold: one copy per assignment.
    const want = new Map();
    const missing = [];
    for (const [id, subject] of CLASSES) {
      const cal = CalendarApp.getCalendarById(id);
      if (!cal) { missing.push(id); continue; }
      const className = cal.getName();
      for (const ev of cal.getEvents(now, until)) {
        const title = ev.getTitle() || '';
        if (!ASSIGNMENT.test(title)) continue;
        let ref = refOf(id + '|' + ev.getId());
        if (want.has(ref)) ref = refOf(id + '|' + ev.getId() + '|' + ev.getStartTime().getTime());   // a repeating one
        want.set(ref, copyOf(ev, title, className, subject, ref));
      }
    }

    // 2. The copies already there (looking 60 days back too, so one the teacher moves is updated, not copied twice).
    const have = new Map();
    let removed = 0;
    for (const ev of feed.getEvents(new Date(now.getTime() - 60 * DAY), new Date(until.getTime() + 60 * DAY))) {
      const ref = ev.getTag(REF_TAG);
      if (!ref) continue;                                          // something you added yourself: left alone
      if (have.has(ref)) { ev.deleteEvent(); removed++; pause(); continue; }   // a stray second copy
      have.set(ref, ev);
    }

    // 3. Add what's new, change what the teacher changed, remove what the teacher deleted.
    let added = 0, changed = 0;
    for (const [ref, c] of want) {
      const ev = have.get(ref);
      if (!ev) {
        const made = c.allDay
          ? feed.createAllDayEvent(c.title, c.start, { description: c.description })
          : feed.createEvent(c.title, c.start, c.end, { description: c.description });
        made.removeAllReminders();   // Nat OS does the reminding
        made.setTag(REF_TAG, ref);
        made.setTag(SIG_TAG, c.sig);
        added++;
        pause();
      } else if (ev.getTag(SIG_TAG) !== c.sig) {
        ev.setTitle(c.title);
        ev.setDescription(c.description);
        if (c.allDay) ev.setAllDayDate(c.start);
        else ev.setTime(c.start, c.end);
        ev.setTag(SIG_TAG, c.sig);
        changed++;
        pause();
      }
    }
    for (const [ref, ev] of have) {
      if (want.has(ref) || ev.getEndTime().getTime() <= now.getTime()) continue;   // still there, or already past
      ev.deleteEvent();
      removed++;
      pause();
    }

    console.log('Homework feed: ' + want.size + ' assignments in the next ' + DAYS_AHEAD + ' days. '
      + added + ' added, ' + changed + ' changed, ' + removed + ' removed.');
    if (missing.length) {
      throw new Error('Couldn’t open ' + missing.length + ' Classroom calendar(s): ' + missing.join(', ')
        + '. Check the IDs in CLASSES (the rest were copied).');
    }
  } finally {
    lock.releaseLock();
  }
}

/** One Classroom event → what its copy in Homework feed should be. */
function copyOf(ev, title, className, subject, ref) {
  const allDay = ev.isAllDayEvent();
  const start = allDay ? ev.getAllDayStartDate() : ev.getStartTime();
  const end = allDay ? start : ev.getEndTime();
  const original = (ev.getDescription() || '').trim();
  const link = (original.match(LINK) || [])[0] || '';
  const description = [
    'Class: ' + className,
    'Subject: ' + subject,
    'Classroom: ' + (link || '(no link in the Classroom event)'),
    original ? '\n' + original.slice(0, 3000) : '',
    '\nRef: ' + ref,
  ].filter(Boolean).join('\n');
  const sig = refOf(JSON.stringify([title, allDay, start.getTime(), end.getTime(), description]));
  return { title: title, allDay: allDay, start: start, end: end, description: description, sig: sig };
}

/** A short fingerprint (16 hex characters). */
function refOf(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8);
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Google limits how fast events can be written. */
function pause() {
  Utilities.sleep(200);
}
