/**
 * Nat OS: email watcher. One copy runs in each Google account (school and personal), every 15 minutes.
 *
 * It sends each new email's sender, subject and Gmail's short preview line to Nat OS, which sorts it (homework,
 * needs a reply, event, or ignore) and tells you on Telegram. It never sends the whole email.
 *  - Read-only: this project only has permission to READ Gmail (see appsscript.json), so it can't send, delete,
 *    archive or mark anything as read, even by mistake.
 *  - Never twice: it remembers what it has sent, and Nat OS ignores repeats anyway.
 *  - School only: if the school blocks calls to outside addresses, it falls back to putting each email (as data) into
 *    the Homework feed calendar, which Nat OS already reads. Those entries are removed after 2 days.
 *
 * Run checkConnection once first (it says which way your emails will go), then add the 15-minute trigger.
 * Made by Claude Code (google-apps-script/mail-watcher.gs; `scripts/mail-script.sh` fills in the three lines below).
 */

const ACCOUNT = '__ACCOUNT__';                 // 'school' or 'personal'
const SECRET = '__MAIL_SECRET__';              // the app's key for these scripts: don't share it
const FALLBACK_CALENDAR_ID = '__FALLBACK__';   // school: the Homework feed calendar; personal: none

const APP_URL = 'https://personal-os-roan-rho.vercel.app/api/mail/incoming';
const FIRST_RUN_HOURS = 12;   // the very first run looks this far back
const MAX_PER_RUN = 40;       // a busy inbox is sent in parts (the rest next run)

// ---------------------------------------------------------------------------------------------------------------
// Nothing below needs changing.
// ---------------------------------------------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
const MARK = 'natos-mail ';
const MAIL_TAG = 'natosMail';
const HEADERS = ['From', 'Subject', 'List-Unsubscribe', 'List-Id', 'Precedence', 'Auto-Submitted'];

/** Run this once by hand: checks Nat OS can be reached from this account, and says which way emails will go. */
function checkConnection() {
  const props = PropertiesService.getScriptProperties();
  const payload = { account: ACCOUNT, address: myAddress(props), sent: new Date().toISOString(), messages: [] };
  let res;
  try {
    res = post(payload);
  } catch (e) {
    console.log('❌ This account isn’t allowed to call outside addresses (' + e.message + ').');
    if (!FALLBACK_CALENDAR_ID) { console.log('Tell Claude Code: the personal account can’t reach Nat OS.'); return; }
    toCalendar(payload);
    console.log('➡️ Fallback on: emails will go through the Homework feed calendar instead. Carry on and add the trigger.');
    return;
  }
  const code = res.getResponseCode();
  if (code === 200) console.log('✅ Connected: Nat OS answered. Emails go straight to the app. Now add the trigger.');
  else if (code === 401) console.log('❌ Nat OS didn’t accept the key. Copy the script again (scripts/mail-script.sh) and paste it over this one.');
  else console.log('❌ Nat OS answered ' + code + ': ' + res.getContentText().slice(0, 200));
}

/** The 15-minute job. */
function checkMail() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) return;   // a run is already going
  try {
    const props = PropertiesService.getScriptProperties();
    const now = Date.now();
    const since = Number(props.getProperty('since')) || now - FIRST_RUN_HOURS * HOUR;
    const sentIds = JSON.parse(props.getProperty('sentIds') || '[]');
    const found = newMessages(since, sentIds);
    const way = deliver({ account: ACCOUNT, address: myAddress(props), sent: new Date(now).toISOString(), messages: found });
    // only once Nat OS (or the fallback calendar) has them: remember them, and move the starting point on
    props.setProperty('sentIds', JSON.stringify(sentIds.concat(found.map((m) => m.id)).slice(-300)));
    const newest = found.reduce((a, m) => Math.max(a, Date.parse(m.received)), since);
    props.setProperty('since', String(newest));
    console.log(found.length + ' new email(s) sent ' + (way === 'calendar' ? 'via the Homework feed calendar.' : 'to Nat OS.'));
  } finally {
    lock.releaseLock();
  }
}

/** New emails since `since` (an hour's overlap, minus what was already sent), oldest first: metadata only. */
function newMessages(since, sentIds) {
  const seen = new Set(sentIds);
  const q = '-in:sent -in:drafts -in:chats -from:me after:' + Math.floor((since - HOUR) / 1000);
  const ids = [];
  let pageToken;
  do {
    const r = Gmail.Users.Messages.list('me', { q: q, maxResults: 100, pageToken: pageToken });
    (r.messages || []).forEach((m) => { if (!seen.has(m.id)) ids.push(m.id); });
    pageToken = r.nextPageToken;
  } while (pageToken && ids.length < 500);
  ids.reverse();   // Gmail lists newest first
  const out = [];
  for (const id of ids) {
    if (out.length >= MAX_PER_RUN) break;
    // format "metadata": the headers above and Gmail's preview line, never the body
    const m = Gmail.Users.Messages.get('me', id, { format: 'metadata', metadataHeaders: HEADERS });
    const h = {};
    ((m.payload && m.payload.headers) || []).forEach((x) => { h[x.name.toLowerCase()] = x.value; });
    const precedence = (h['precedence'] || '').toLowerCase();
    const auto = (h['auto-submitted'] || 'no').toLowerCase();
    out.push({
      id: m.id, thread: m.threadId, from: (h['from'] || '').slice(0, 400), subject: (h['subject'] || '').slice(0, 300),
      snippet: (m.snippet || '').slice(0, 300), received: new Date(Number(m.internalDate)).toISOString(),
      labels: (m.labelIds || []).filter((l) => l.indexOf('CATEGORY_') === 0),
      automated: !!(h['list-unsubscribe'] || h['list-id'] || ['bulk', 'list', 'junk'].indexOf(precedence) >= 0 || auto !== 'no'),
    });
  }
  return out.sort((a, b) => Date.parse(a.received) - Date.parse(b.received));
}

/** To Nat OS, or (school, when calls out are blocked) to the fallback calendar. Throws if neither worked. */
function deliver(payload) {
  let res;
  try {
    res = post(payload);
  } catch (e) {
    if (!FALLBACK_CALENDAR_ID) throw e;
    toCalendar(payload);
    return 'calendar';
  }
  const code = res.getResponseCode();
  if (code === 401) throw new Error('Nat OS didn’t accept the key. Copy the script again (scripts/mail-script.sh) and paste it over this one.');
  if (code !== 200) throw new Error('Nat OS answered ' + code + ': ' + res.getContentText().slice(0, 200));   // tried again next run
  return 'url';
}

function post(payload) {
  return UrlFetchApp.fetch(APP_URL, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + SECRET }, payload: JSON.stringify(payload),
  });
}

/** The fallback: one event per email in the Homework feed calendar ("natos-mail {…}"), one check-in event, and
 *  entries older than 2 days removed. Nat OS reads that calendar every 15 minutes. */
function toCalendar(payload) {
  const cal = CalendarApp.getCalendarById(FALLBACK_CALENDAR_ID);
  if (!cal) throw new Error('Can’t open the fallback calendar (FALLBACK_CALENDAR_ID).');
  const props = PropertiesService.getScriptProperties();
  for (const m of payload.messages) {
    const at = new Date(m.received);
    const one = { account: payload.account, address: payload.address, sent: payload.sent, messages: [m] };
    const ev = cal.createEvent('📧 Email for Nat OS', at, at, { description: MARK + JSON.stringify(one) });
    ev.removeAllReminders();
    ev.setTag(MAIL_TAG, 'mail');
    Utilities.sleep(200);
  }
  // the check-in: one event, moved to now each run, so Nat OS knows the watcher is alive
  const beat = { account: payload.account, address: payload.address, sent: payload.sent, messages: [] };
  const id = props.getProperty('beatId');
  let ev = id ? cal.getEventById(id) : null;
  const now = new Date();
  if (ev) { ev.setTime(now, now); ev.setDescription(MARK + JSON.stringify(beat)); }
  else {
    ev = cal.createEvent('📧 Nat OS email watcher (check-in)', now, now, { description: MARK + JSON.stringify(beat) });
    ev.removeAllReminders();
    ev.setTag(MAIL_TAG, 'beat');
    props.setProperty('beatId', ev.getId());
  }
  const old = new Date(now.getTime() - 48 * HOUR);
  cal.getEvents(new Date(now.getTime() - 30 * 24 * HOUR), old).forEach((e) => { if (e.getTag(MAIL_TAG) === 'mail') e.deleteEvent(); });
}

/** This account's address (for "Open in Gmail" links), asked once. */
function myAddress(props) {
  let a = props.getProperty('address');
  if (!a) { a = Gmail.Users.getProfile('me').emailAddress; props.setProperty('address', a); }
  return a;
}
