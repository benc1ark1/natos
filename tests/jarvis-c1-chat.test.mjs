// Jarvis phase C1: changing saved records from Telegram, on the TEST database. Run: npm run test:chat
// Every change: a card first (nothing changes), ✅ Apply (the database must show it), ↩️ Undo (the database
// must show it back exactly). Plus: all-or-nothing, double taps, "changed since", a stranger's records,
// and nothing ever deleted (drop = archive; undoing a new project archives it).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT, SORT } from './support/chat.mjs'
import { brain, sorted } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
// the bot's last reply (the pinned "Today" message, which a ✅ also updates, doesn't count)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const button = (m, l) => chat.button(m, l)
const act = (o) => ({ op: 'move', ref: '', value: '', date: '', time: '', number: 0, words: '', ...o })
/** The ref the bot gave a record in the snapshot it sent the AI ("T3 | Physics homework" -> "T3"). */
const refIn = (body, name) => {
  const snap = body.messages[0].content[0].text
  const m = snap.match(new RegExp(`([TMPWG]\\d+) \\| (?:TEST: |goal: )?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  assert.ok(m, `no ref for ${name} in the snapshot`)
  return m[1]
}
/** Nat says something; the scripted brain answers with these changes (refs looked up by name). */
async function say(text, reply, changes) {
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply, actions: changes.map((c) => act({ ...c, ref: c.ref ? refIn(body, c.ref) : '', value: c.value?.startsWith?.('@') ? refIn(body, c.value.slice(1)) : c.value ?? '' })) }))
  await nat(text)
}
const tap = async (label) => { const m = chat.tg.sent().filter((x) => button(x, label)).at(-1); await chat.tap(button(m, label), m.message_id) }
const row = async (table, id) => (await q(`select * from ${table} where id = $1`, [id]))[0]
const strip = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k] instanceof Date ? r[k].toISOString() : r[k]]))
const TASK_COLS = ['title', 'status', 'due_at', 'window_end', 'window_label', 'is_key', 'duration_minutes', 'importance', 'project_id', 'archived_at', 'archive_reason', 'completed_at', 'postpone_count', 'last_postponed_at']

/** Apply, check the change, Undo, check it's exactly as before. */
async function roundTrip(table, id, changed) {
  const before = strip(await row(table, id), Object.keys(await row(table, id)))
  assert.deepEqual(strip(await row(table, id), Object.keys(before)), before, 'nothing changes before ✅')
  await tap('Apply')
  assert.match(last().text, /✅ <b>Done<\/b>/)
  assert.ok(button(last(), 'Undo'))
  changed(await row(table, id))
  await tap('Undo')
  assert.match(last().text, /↩️ <b>Undone<\/b>/)
  const after = strip(await row(table, id), Object.keys(before))
  delete after.updated_at; delete before.updated_at
  assert.deepEqual(after, before, 'Undo put it back exactly')
}

// ---------------------------------------------------------------- tasks

test('"Move physics homework to tomorrow": card, apply, undo (date, column and postpone count back)', { skip }, async () => {
  const today = chat.time.todayISO(), tomorrow = chat.time.addDays(today, 1)
  const t = await add('tasks', { title: 'Physics homework', status: 'this_month', importance: 'must', due_at: `${chat.time.addDays(today, 9)}T12:00:00Z` })
  await say('Move physics homework to tomorrow', 'Moving Physics homework to tomorrow.', [{ op: 'due', ref: 'Physics homework', date: tomorrow, words: 'tomorrow' }])
  assert.match(last().text, /🔧 <b>Change<\/b>\n• <b>Physics homework<\/b>: Due .* → due /)
  assert.match(last().text, /Nothing changes until you tap ✅ Apply/)
  await roundTrip('tasks', t.id, (r) => {
    assert.equal(r.due_at.toISOString(), `${tomorrow}T12:00:00.000Z`)
    assert.equal(r.status, 'this_week', 'the column follows the new date')
  })
  chat.noSurprises()
})

test('"Done with the SMC paper", "Drop the guitar idea": completed / dropped into Archive (never deleted), undone', { skip }, async () => {
  const smc = await add('tasks', { title: 'SMC past paper', status: 'today' })
  await say('Done with the SMC paper', 'Marking it done.', [{ op: 'complete', ref: 'SMC past paper' }])
  await roundTrip('tasks', smc.id, (r) => { assert.equal(r.status, 'completed'); assert.equal(r.archive_reason, 'done'); assert.ok(r.archived_at) })
  const guitar = await add('tasks', { title: 'Learn guitar', status: 'someday' })
  await say('Drop the guitar idea', 'Dropping it.', [{ op: 'drop', ref: 'Learn guitar' }])
  await roundTrip('tasks', guitar.id, (r) => { assert.equal(r.archive_reason, 'dropped'); assert.ok(r.archived_at); assert.equal(r.status, 'someday') })
  assert.equal((await q(`select count(*)::int n from tasks`))[0].n, 2, 'nothing deleted')
})

test('"Star it" (from memory), "Make it 45 min", "Add this to Football comeback": applied and undone', { skip }, async () => {
  const t = await add('tasks', { title: 'Book physio', status: 'this_week' })
  await add('projects', { name: 'Football comeback' })
  await say('Star it', 'Starring Book physio.', [{ op: 'star', ref: 'Book physio' }])
  await roundTrip('tasks', t.id, (r) => assert.equal(r.is_key, true))
  await say('Make it 45 min', 'Setting 45 min.', [{ op: 'minutes', ref: 'Book physio', number: 45 }])
  assert.match(chat.lastBrainText(), /Nat: Star it/, 'the brain remembered the conversation')
  await roundTrip('tasks', t.id, (r) => assert.equal(r.duration_minutes, 45))
  await say('Add this to Football comeback', 'Adding it.', [{ op: 'project', ref: 'Book physio', value: '@Football comeback' }])
  await roundTrip('tasks', t.id, (r) => assert.ok(r.project_id))
})

test('"New project: learn music production" plus a task in it: undo archives the project (never deleted)', { skip }, async () => {
  const t = await add('tasks', { title: 'Buy a MIDI keyboard', status: 'inbox' })
  await say('New project: learn music production, and put the MIDI keyboard in it', 'New project, with the keyboard in it.', [
    { op: 'project', ref: 'Buy a MIDI keyboard', value: 'Learn music production' }, { op: 'project_new', value: 'Learn music production' }])
  assert.match(last().text, /2 changes<\/b>\n• New project: <b>Learn music production<\/b>\n• <b>Buy a MIDI keyboard<\/b>: no project → project Learn music production \(new\)/)
  await tap('Apply')
  const [p] = await q(`select * from projects where name = 'Learn music production'`)
  assert.equal((await row('tasks', t.id)).project_id, p.id)
  await tap('Undo')
  assert.equal((await row('tasks', t.id)).project_id, null)
  const [still] = await q(`select archived_at from projects where id = $1`, [p.id])
  assert.ok(still.archived_at, 'the project is archived, not deleted')
})

// ---------------------------------------------------------------- reminders and targets

test('"PE kit reminder Thursday not Friday" and "Tick the Sam reminder": applied and undone', { skip }, async () => {
  const thu = chat.next(4)
  const pe = await add('reminders', { body: 'Bring PE kit', kind: 'day', remind_on: chat.time.addDays(thu, 1) })
  const sam = await add('reminders', { body: 'Give Sam his charger', kind: 'person', person: 'Sam' })
  await say('PE kit reminder Thursday not Friday', 'Moving it to Thursday.', [{ op: 'reminder_when', ref: 'Bring PE kit', date: thu, words: 'Thursday' }])
  await roundTrip('reminders', pe.id, (r) => assert.equal(chat.time.dateISOOf(r.remind_on.toISOString?.() ?? r.remind_on), thu))
  await say('Tick the Sam reminder', 'Ticking it.', [{ op: 'reminder_done', ref: 'Give Sam his charger' }])
  await roundTrip('reminders', sam.id, (r) => assert.ok(r.done_at))
})

test('"Coach set 3 lower this week": this week only, shown in the week; undo puts the usual number back', { skip }, async () => {
  const t = await add('weekly_targets', { name: 'Lower', target_count: 2 })
  await say('Coach set 3 lower this week', 'Lower is 3 this week.', [{ op: 'target_week', ref: 'Lower', number: 3 }])
  assert.match(last().text, /Lower this week: 2 → <b>3<\/b>/)
  await tap('Apply')
  const week = chat.time.weekStartISO(chat.time.todayISO())
  assert.deepEqual(await q(`select target_count from target_weeks where target_id = $1 and week_start = $2`, [t.id, week]), [{ target_count: 3 }])
  assert.equal((await row('weekly_targets', t.id)).target_count, 2, 'the usual number is unchanged')
  await nat('/week')
  assert.match(last().text, /Lower 0\/3/)
  await tap('Undo')
  await nat('/week')
  assert.match(last().text, /Lower 0\/2/)
})

test('"Did football" (a log) can be undone too: just that log goes, like the dashboard', { skip }, async () => {
  const t = await add('weekly_targets', { name: 'Football', target_count: 2 })
  chat.ai.script(CHAT, brain({ intent: 'new', item_text: 'did football today' }))
  chat.ai.script(SORT, sorted({ kind: 'goal_progress', title: 'Football', target: 'Football', amount: 1, done_on: chat.time.todayISO(), date_words: 'today' }))
  await nat('did football today')
  await tap('Save')
  assert.equal((await q(`select count(*)::int n from target_logs where target_id = $1`, [t.id]))[0].n, 1)
  await tap('Undo')
  assert.equal((await q(`select count(*)::int n from target_logs where target_id = $1`, [t.id]))[0].n, 0)
  assert.match(last().text, /Undone/)
})

// ---------------------------------------------------------------- safety

test('a date that isn’t in his words is left out; if nothing is left there is no card', { skip }, async () => {
  await add('tasks', { title: 'Physics homework', status: 'this_week' })
  await say('push physics back a bit', 'Moving it to Sunday.', [{ op: 'due', ref: 'Physics homework', date: chat.time.addDays(chat.time.todayISO(), 1), words: 'sunday' }])
  assert.match(last().text, /Nothing to change: the date for “Physics homework” wasn’t in your words/)
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action'`))[0].n, 0)
})

test('all or nothing: if one change fails, the ones before it are put back', { skip }, async () => {
  const a = await add('tasks', { title: 'First', status: 'this_week' })
  const before = await row('tasks', a.id)
  // a card whose second change points at a record that doesn't exist
  const [card] = await q(`insert into telegram_pending (user_id, kind, text, payload) values ($1, 'action', 'two things', $2) returning id`, [chat.users.owner, {
    actions: [
      { op: 'star', table: 'tasks', id: a.id, title: 'First', line: 'x', patch: { is_key: true } },
      { op: 'star', table: 'tasks', id: '00000000-0000-4000-8000-000000000001', title: 'Ghost', line: 'y', patch: { is_key: true } },
    ],
  }])
  await chat.tap(`a:${card.id}`)
  assert.match(last().text, /Nothing changed/)
  assert.equal((await row('tasks', a.id)).is_key, before.is_key, 'the first change was put back')
  assert.equal((await row('telegram_pending', card.id)).status, 'open', 'the card can be tried again')
})

test('another person’s task can’t be changed, even by a card that names it (row level security)', { skip }, async () => {
  const [theirs] = await q(`insert into tasks (user_id, title, status) values ($1, 'Their task', 'today') returning id`, [chat.users.stranger])
  const [card] = await q(`insert into telegram_pending (user_id, kind, text, payload) values ($1, 'action', 'sneaky', $2) returning id`, [chat.users.owner, {
    actions: [{ op: 'complete', table: 'tasks', id: theirs.id, title: 'Their task', line: 'x', patch: { status: 'completed', completed_at: '__now__', archived_at: '__now__', archive_reason: 'done' } }],
  }])
  await chat.tap(`a:${card.id}`)
  assert.match(last().text, /Nothing changed/)
  assert.deepEqual(await q(`select status, archived_at from tasks where id = $1`, [theirs.id]), [{ status: 'today', archived_at: null }])
})

test('double taps: Apply once, Undo once', { skip }, async () => {
  const t = await add('tasks', { title: 'Tidy desk', status: 'today', postpone_count: 0 })
  await say('move tidy desk to later', 'Moving it.', [{ op: 'move', ref: 'Tidy desk', value: 'later' }])
  const card = last()
  await Promise.all([chat.tap(button(card, 'Apply'), card.message_id), chat.tap(button(card, 'Apply'), card.message_id)])
  assert.equal(chat.tg.sent().filter((m) => /✅ <b>Done/.test(m.text)).length, 1)
  assert.equal((await row('tasks', t.id)).postpone_count, 1, 'moving later counts as a postponement (database rule)')
  const done = chat.tg.sent().find((m) => /✅ <b>Done/.test(m.text))
  await Promise.all([chat.tap(button(done, 'Undo'), done.message_id), chat.tap(button(done, 'Undo'), done.message_id)])
  assert.equal(chat.tg.sent().filter((m) => /Undone/.test(m.text)).length, 1)
  const r = await row('tasks', t.id)
  assert.equal(r.status, 'today')
  assert.equal(r.postpone_count, 0, 'undoing it doesn’t count as a postponement')
})

test('Undo leaves alone anything changed since (e.g. on the dashboard)', { skip }, async () => {
  const t = await add('tasks', { title: 'Revise vectors', status: 'this_week' })
  await say('star revise vectors', 'Starring it.', [{ op: 'star', ref: 'Revise vectors' }, { op: 'minutes', ref: 'Revise vectors', number: 30 }])
  await tap('Apply')
  await q(`update tasks set duration_minutes = 50 where id = $1`, [t.id])   // changed on the dashboard
  await tap('Undo')
  assert.match(last().text, /Left as it is \(changed since\): Revise vectors/)
  const r = await row('tasks', t.id)
  assert.equal(r.duration_minutes, 50, 'the newer change is kept')
  assert.equal(r.is_key, false, 'the star (unchanged since) is undone')
})

test('✏️ Change: the next message corrects the list of changes (old card replaced)', { skip }, async () => {
  await add('tasks', { title: 'Physics homework', status: 'this_week' })
  await add('tasks', { title: 'Maths homework', status: 'this_week' })
  await say('star the physics one', 'Starring Physics homework.', [{ op: 'star', ref: 'Physics homework' }])
  await tap('Change')
  assert.match(last().text, /What should be different/)
  assert.ok(button(last(), 'Apply as is'))
  await say('no, the maths one', 'Starring Maths homework instead.', [{ op: 'star', ref: 'Maths homework' }])
  assert.match(chat.lastBrainText(), /A list of changes to saved records, not applied yet/)
  assert.match(last().text, /Corrected<\/b>\n🔧 <b>Change<\/b>\n• <b>Maths homework<\/b>/)
  assert.deepEqual((await q(`select status from telegram_pending where kind = 'action' order by created_at`)).map((r) => r.status), ['replaced', 'open'])
  await tap('Apply')
  assert.deepEqual((await q(`select title from tasks where is_key`)).map((r) => r.title), ['Maths homework'])
})

test('Apply updates the pinned Today message', { skip }, async () => {
  await add('tasks', { title: 'Physics homework', status: 'this_week' })
  await say('move physics homework to today', 'Moving it to Today.', [{ op: 'move', ref: 'Physics homework', value: 'today' }])
  await tap('Apply')
  const pinned = chat.tg.sent().find((m) => m.text.startsWith('📌'))
  assert.match(pinned.text, /Physics homework/)
})

test('if a failed card can’t be fully put back, the bot says exactly what (never "nothing changed")', { skip }, async () => {
  const a = await add('tasks', { title: 'First', status: 'this_week' })
  // test database only: a temporary rule that refuses un-starring, so the put-back fails
  await q(`create or replace function test_meta.no_unstar() returns trigger language plpgsql as $$ begin
    if old.is_key and not new.is_key then raise exception 'blocked for the test'; end if; return new; end $$`)
  await q(`create trigger test_no_unstar before update on public.tasks for each row execute function test_meta.no_unstar()`)
  try {
    const [card] = await q(`insert into telegram_pending (user_id, kind, text, payload) values ($1, 'action', 'two things', $2) returning id`, [chat.users.owner, {
      actions: [
        { op: 'star', table: 'tasks', id: a.id, title: 'First', line: 'x', patch: { is_key: true } },
        { op: 'star', table: 'tasks', id: '00000000-0000-4000-8000-000000000001', title: 'Ghost', line: 'y', patch: { is_key: true } },
      ],
    }])
    await chat.tap(`a:${card.id}`)
    assert.match(last().text, /didn’t fully work .* couldn’t put back: <b>First<\/b>\. Check it on the dashboard/)
    assert.doesNotMatch(last().text, /Nothing changed/)
  } finally {
    await q(`drop trigger if exists test_no_unstar on public.tasks`)
  }
})
