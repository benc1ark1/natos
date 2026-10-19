// Email watcher, no database: the Gmail Apps Script (google-apps-script/mail-watcher.gs) run against fakes, and the
// plain rules the app sorts with (lib/mail/rules.ts).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/mail-watcher-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const HOUR = 3_600_000
const FEED = 'feed@group.calendar.google.com'
const src = readFileSync(new URL('../google-apps-script/mail-watcher.gs', import.meta.url), 'utf8')

/** A fake Gmail account (what the Gmail API returns for format "metadata"), UrlFetchApp, properties and a calendar. */
function fakes({ blocked = false, status = 200, reply = '{}' } = {}) {
  const now = Date.now()
  const msgs = [
    { id: 'm1', threadId: 't1', internalDate: String(now - 30 * 60_000), snippet: 'Hi Nat, please do the binary search exercises for Thursday', labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL'], headers: { From: 'Sam Smith <sam@tutor.com>', Subject: 'CS homework' }, body: 'THE WHOLE EMAIL BODY' },
    { id: 'm2', threadId: 't2', internalDate: String(now - 50 * 60_000), snippet: '50% off everything', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], headers: { From: 'Shop <deals@shop.com>', Subject: 'Sale', 'List-Unsubscribe': '<mailto:x>' }, body: 'BODY' },
    { id: 'old', threadId: 't3', internalDate: String(now - 20 * HOUR), snippet: 'old', labelIds: ['INBOX'], headers: { From: 'a@b.com', Subject: 'Too old' }, body: 'BODY' },
  ]
  const calls = { list: [], get: [], posts: [] }
  const props = new Map()
  const events = []
  let n = 0
  const Gmail = { Users: {
    getProfile: () => ({ emailAddress: 'nat@school.org' }),
    Messages: {
      list: (_me, o) => {
        calls.list.push(o.q)
        const after = Number(o.q.match(/after:(\d+)/)[1]) * 1000
        return { messages: msgs.filter((m) => Number(m.internalDate) > after).sort((a, b) => b.internalDate - a.internalDate).map((m) => ({ id: m.id })) }
      },
      get: (_me, id, o) => {
        calls.get.push({ ...o, id })
        const m = msgs.find((x) => x.id === id)
        // format "full": the parts, base64url like Gmail (an HTML part only when the email has no plain one)
        if (o.format === 'full') {
          const part = (mimeType, text) => ({ mimeType, body: { data: Buffer.from(text, 'utf8').toString('base64url') } })
          return { id: m.id, payload: { mimeType: 'multipart/alternative', parts: m.html ? [part('text/html', m.html)] : [part('text/plain', m.body), part('text/html', `<p>${m.body}</p>`)] } }
        }
        return { id: m.id, threadId: m.threadId, internalDate: m.internalDate, snippet: m.snippet, labelIds: m.labelIds,
          payload: { headers: Object.entries(m.headers).filter(([k]) => o.metadataHeaders.includes(k)).map(([name, value]) => ({ name, value })) } }
      },
    },
  } }
  const UrlFetchApp = { fetch: (url, o) => {
    if (blocked) throw new Error('You do not have permission to call UrlFetchApp.fetch')
    calls.posts.push({ url, auth: o.headers.Authorization, body: JSON.parse(o.payload) })
    return { getResponseCode: () => status, getContentText: () => reply }
  } }
  const event = (title, at, o) => {
    const ev = { id: `ev${++n}`, title, at, description: o.description, tags: {}, deleted: false,
      getId: () => ev.id, removeAllReminders: () => {}, setTag: (k, v) => { ev.tags[k] = v }, getTag: (k) => ev.tags[k] ?? null,
      setTime: (s) => { ev.at = s }, setDescription: (d) => { ev.description = d }, deleteEvent: () => { ev.deleted = true } }
    events.push(ev)
    return ev
  }
  const cal = { createEvent: (t, s, _e, o) => event(t, s, o), getEventById: (id) => events.find((e) => e.id === id && !e.deleted) ?? null,
    getEvents: (s, e) => events.filter((x) => !x.deleted && x.at >= s && x.at < e) }
  const ctx = vm.createContext({
    Gmail, UrlFetchApp, console: { log: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    CalendarApp: { getCalendarById: (id) => (id === FEED ? cal : null) },
    Utilities: {
      sleep: () => {},
      base64DecodeWebSafe: (s) => [...Buffer.from(s, 'base64url')],
      newBlob: (bytes) => ({ getDataAsString: () => Buffer.from(bytes).toString('utf8') }),
    },
  })
  return { msgs, calls, props, events, ctx, now }
}
const load = (f, account, fallback = '') => {
  vm.runInContext(src.replace('__ACCOUNT__', account).replace('__MAIL_SECRET__', 'k'.repeat(64)).replace('__FALLBACK__', fallback), f.ctx)
  return (fn) => vm.runInContext(`${fn}()`, f.ctx)
}

test('the Gmail script: read-only permissions, the text only for likely homework, each email once, the school fallback when calls out are blocked', () => {
  // permissions: read-only Gmail (it can't send, delete or mark), calling the app; only the school one has a calendar
  for (const acc of ['school', 'personal']) {
    const m = JSON.parse(readFileSync(new URL(`../google-apps-script/mail-watcher-${acc}.appsscript.json`, import.meta.url), 'utf8'))
    assert.deepEqual(m.oauthScopes.filter((s) => /gmail|mail\.google/.test(s)), ['https://www.googleapis.com/auth/gmail.readonly'])
    assert.equal(m.oauthScopes.includes('https://www.googleapis.com/auth/calendar'), acc === 'school')
    assert.equal(m.dependencies.enabledAdvancedServices[0].serviceId, 'gmail')
  }
  assert.doesNotMatch(src, /\.(send|trash|delete|modify|batchModify|markRead|moveToTrash|insert|import)\w*\(\s*'me'/i, 'no Gmail write calls')
  assert.doesNotMatch(src, /GmailApp/, 'GmailApp would need full mail access')

  // first run: the last 12 hours, oldest first, with the key; the text only for the homework email (not the promo)
  let f = fakes({ reply: JSON.stringify({ ok: true, added: 2, bodyFrom: ['sam@tutor.com', '@school.org'] }) })
  let run = load(f, 'personal')
  run('checkMail')
  assert.equal(f.calls.posts.length, 1)
  const p = f.calls.posts[0]
  assert.match(p.url, /\/api\/mail\/incoming$/)
  assert.equal(p.auth, `Bearer ${'k'.repeat(64)}`)
  assert.equal(p.body.account, 'personal')
  assert.equal(p.body.address, 'nat@school.org')
  assert.deepEqual(p.body.messages.map((m) => m.id), ['m2', 'm1'], 'oldest first; the 20-hour-old one is before the first run')
  assert.deepEqual(f.calls.get.filter((o) => o.format === 'full').map((o) => o.id), ['m1'], 'the whole email only for likely homework')
  assert.equal(p.body.messages[1].body, 'THE WHOLE EMAIL BODY')
  assert.equal(p.body.messages[0].body, undefined, 'never the promo’s text')
  assert.deepEqual(JSON.parse(f.props.get('bodyFrom')), ['sam@tutor.com', '@school.org'], 'remembers whose emails set homework')
  assert.deepEqual(p.body.messages.map((m) => [m.from, m.automated, m.labels]), [['Shop <deals@shop.com>', true, ['CATEGORY_PROMOTIONS']], ['Sam Smith <sam@tutor.com>', false, ['CATEGORY_PERSONAL']]])
  assert.match(f.calls.list[0], /-from:me/)

  // next run: nothing new is sent again, but it still checks in
  run('checkMail')
  assert.equal(f.calls.posts.length, 2)
  assert.deepEqual(f.calls.posts[1].body.messages, [])
  f.msgs.push({ id: 'm3', threadId: 't4', internalDate: String(Date.now()), snippet: 'Are you free Tuesday?', labelIds: ['INBOX'], headers: { From: 'Ms Patel <patel@school.org>', Subject: 'Quick question' }, html: '<p>Hi Nat,</p><ul><li>Q1&nbsp;to Q5</li></ul>' })
  f.msgs.push({ id: 'm4', threadId: 't5', internalDate: String(Date.now() + 1000), snippet: 'Lovely photos!', labelIds: ['INBOX'], headers: { From: 'Alex <alex@x.com>', Subject: 'Trip' }, body: 'PRIVATE' })
  run('checkMail')
  const third = f.calls.posts[2].body.messages
  assert.deepEqual(third.map((m) => m.id), ['m3', 'm4'])
  // a sender Nat OS listed (his school's domain) goes with its text even without homework words; HTML turned into text
  assert.equal(third[0].body, 'Hi Nat,\n- Q1 to Q5')
  assert.equal(third[1].body, undefined, 'anyone else without homework words: metadata only')

  // Nat OS refuses (wrong key): an error, and nothing is marked as sent
  f = fakes({ status: 401 })
  run = load(f, 'personal')
  assert.throws(() => run('checkMail'), /didn’t accept the key/)
  assert.equal(f.props.get('since'), undefined)

  // the school blocks calls to outside addresses: each email goes into Homework feed as data, plus a check-in
  f = fakes({ blocked: true })
  run = load(f, 'school', FEED)
  run('checkMail')
  const mail = f.events.filter((e) => e.tags.natosMail === 'mail')
  assert.equal(mail.length, 2)
  const one = JSON.parse(mail[0].description.slice('natos-mail '.length))
  assert.equal(one.account, 'school')
  assert.equal(one.messages.length, 1)
  assert.equal(f.events.filter((e) => e.tags.natosMail === 'beat').length, 1)
  run('checkMail')
  assert.equal(f.events.filter((e) => e.tags.natosMail === 'beat' && !e.deleted).length, 1, 'one check-in event, moved each run')
  assert.equal(f.events.filter((e) => e.tags.natosMail === 'mail').length, 2, 'nothing twice')
  // …but the personal account has no fallback: an error (shown in Apps Script, and the app warns when it goes quiet)
  f = fakes({ blocked: true })
  run = load(f, 'personal')
  assert.throws(() => run('checkMail'), /permission/)
})

test('the app’s plain rules: what a script sends is checked, senders read, rules decide, robots are spotted', async () => {
  const { readIncoming, parseFrom, decidingRule, isAutomated, cleanPattern, ruleWords, gmailLink } = await import('../lib/mail/rules.ts')
  assert.equal(readIncoming({ account: 'work', messages: [] }), null, 'only school or personal')
  const r = readIncoming({ account: 'school', address: 'NAT@School.org', messages: [
    { id: 'ok1', thread: 't1', from: 'Sam <sam@x.com>', subject: 'Don&#39;t forget', snippet: 'x'.repeat(500), received: '2026-10-11T10:00:00Z', labels: ['CATEGORY_UPDATES', 'INBOX', 'evil'], automated: true },
    { id: 'bad id!', from: 'a', subject: 'b', snippet: '', received: '2026-10-11T10:00:00Z' },
    { id: 'nodate', from: 'a', subject: 'b', snippet: '', received: 'never' },
  ] })
  assert.equal(r.address, 'nat@school.org')
  assert.deepEqual(r.messages.map((m) => m.id), ['ok1'], 'malformed ones are dropped')
  assert.equal(r.messages[0].subject, 'Don\'t forget')
  assert.equal(r.messages[0].snippet.length, 300)
  assert.deepEqual(r.messages[0].labels, ['CATEGORY_UPDATES'])

  assert.deepEqual(parseFrom('"Smith, Sam" <Sam@Tutor.com>'), { name: 'Smith, Sam', email: 'sam@tutor.com' })
  assert.deepEqual(parseFrom('sam@tutor.com'), { name: null, email: 'sam@tutor.com' })

  assert.equal(cleanPattern('ucs.org.uk'), '@ucs.org.uk')
  assert.equal(cleanPattern(' Sam@Tutor.com '), 'sam@tutor.com')
  const rules = [
    { id: '1', pattern: '@ucs.org.uk', action: 'flag', label: 'teachers' },
    { id: '2', pattern: 'noreply@ucs.org.uk', action: 'ignore', label: null },
    { id: '3', pattern: 'Hudl', action: 'ignore', label: null },
  ]
  const e = (from_email, subject = '', from_name = null) => ({ from_email, from_name, subject })
  assert.equal(decidingRule(rules, e('patel@ucs.org.uk')).id, '1', 'the domain')
  assert.equal(decidingRule(rules, e('patel@mail.ucs.org.uk')).id, '1', 'subdomains too')
  assert.equal(decidingRule(rules, e('noreply@ucs.org.uk')).id, '2', 'an exact address beats the domain')
  assert.equal(decidingRule(rules, e('news@hudl.com', 'Your weekly Hudl digest')).id, '3', 'words in the subject')
  assert.equal(decidingRule(rules, e('someone@notucs.org.uk')), null)
  assert.equal(ruleWords(rules[0]), 'always flag emails from @ucs.org.uk (teachers)')

  assert.equal(isAutomated({ automated: false, labels: ['CATEGORY_PROMOTIONS'], from_email: 'a@b.com' }), true)
  assert.equal(isAutomated({ automated: false, labels: [], from_email: 'no-reply@classroom.google.com' }), true)
  assert.equal(isAutomated({ automated: false, labels: ['CATEGORY_PERSONAL'], from_email: 'sam@tutor.com' }), false)
  assert.equal(gmailLink('nat@school.org', 't1'), 'https://mail.google.com/mail/?authuser=nat%40school.org#all/t1')
})
