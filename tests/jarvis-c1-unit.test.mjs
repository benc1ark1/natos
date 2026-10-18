// Jarvis phase C1, plain tests: checking the changes the brain proposes (free, no database, no AI).
// Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { checkActions } from '../lib/telegram/actions.ts'

const ROOT = new URL('..', import.meta.url).pathname
const TODAY = '2026-10-10'   // Saturday
const task = (o) => ({
  id: o.id, user_id: 'u', category_id: null, subject_id: null, details: null, priority: 'medium', status: 'this_week', due_at: null,
  is_key: false, source: 'test', source_text: null, completed_at: null, archived_at: null, created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-01T10:00:00Z', importance: 'nice', window_start: null, window_end: null, window_label: null, origin: 'own',
  duration_minutes: null, postpone_count: 0, last_postponed_at: null, target_id: null, goal_id: null, is_system: false, session_no: null,
  archive_reason: null, project_id: null, hand_in: null, hand_in_url: null, needs_sorting: false, ...o,
})
const tasks = [
  task({ id: 't1', title: 'Physics homework', importance: 'must', due_at: '2026-10-16T12:00:00Z' }),
  task({ id: 't2', title: 'SMC <past> paper', status: 'today' }),
  task({ id: 't3', title: 'Learn guitar', status: 'someday', is_key: true }),
  task({ id: 't4', title: 'Physics test prep 1', is_system: true, goal_id: 'g1' }),
  task({ id: 't5', title: 'Old thing', archived_at: '2026-10-01T10:00:00Z', archive_reason: 'done', status: 'completed' }),
]
const reminders = [
  { id: 'm1', body: 'Give Sam his charger', kind: 'person', person: 'Sam', remind_on: null, remind_at: null, done_at: null, created_at: '' },
  { id: 'm2', body: 'Bring PE kit', kind: 'day', person: null, remind_on: '2026-10-16', remind_at: null, done_at: null, created_at: '' },
]
const projects = [{ id: 'p1', name: 'Football comeback', category_id: null, notes: null, sort_order: 0, archived_at: null, created_at: '' }]
const targets = [
  { id: 'w1', name: 'Lower', target_count: 2, counts_from: 'logs' },
  { id: 'w2', name: 'Football', target_count: 2, counts_from: 'events' },
]
const refs = new Map([
  ...tasks.map((t, i) => [`T${i + 1}`, { kind: 'task', id: t.id, title: t.title, status: t.status, deadline: null }]),
  ['M1', { kind: 'reminder', id: 'm1', title: 'Give Sam his charger' }], ['M2', { kind: 'reminder', id: 'm2', title: 'Bring PE kit' }],
  ['P1', { kind: 'project', id: 'p1', title: 'Football comeback' }],
  ['W1', { kind: 'target', id: 'w1', title: 'Lower' }], ['W2', { kind: 'target', id: 'w2', title: 'Football' }],
  ['G1', { kind: 'goal', id: 'g1', title: 'Physics test' }],
])
const ctx = { today: TODAY, weekStart: '2026-10-05', snapshot: '', refs }
const rows = { tasks: new Map(tasks.map((t) => [t.id, t])), reminders: new Map(reminders.map((r) => [r.id, r])), projects: new Map(projects.map((p) => [p.id, p])), targets: new Map(targets.map((t) => [t.id, t])) }
const act = (o) => ({ op: 'move', ref: '', value: '', date: '', time: '', number: 0, words: '', ...o })
const check = (raw, said = 'move physics homework to tomorrow') => checkActions(raw, ctx, rows, said, TODAY)

test('a new due date must come from his words, today or later; the column follows the date', () => {
  const { actions, problems } = check([act({ op: 'due', ref: 'T1', date: '2026-10-11', words: 'tomorrow' })])
  assert.deepEqual(problems, [])
  assert.equal(actions[0].line, '<b>Physics homework</b>: Due Fri → due Sun 11 Oct')
  assert.equal(actions[0].patch.due_at, '2026-10-11T12:00:00Z')
  assert.equal(actions[0].patch.status, 'this_week')
  assert.equal(actions[0].patch.window_end, null)
  assert.match(check([act({ op: 'due', ref: 'T1', date: '2026-10-11', words: 'sunday' })]).problems[0], /wasn’t in your words/)
  assert.match(check([act({ op: 'due', ref: 'T1', date: '2026-10-01', words: 'tomorrow' })]).problems[0], /no clear new date/)
  assert.match(check([act({ op: 'due', ref: 'T1', date: 'soon', words: 'tomorrow' })]).problems[0], /no clear new date/)
  // the date words may be in something he said a minute ago
  assert.equal(check([act({ op: 'due', ref: 'T1', date: '2026-10-11', words: 'tomorrow' })], 'physics homework is now due tomorrow\nyes do that').actions.length, 1)
})

test('move: real columns only, not the one it is already in', () => {
  assert.equal(check([act({ op: 'move', ref: 'T1', value: 'later' })]).actions[0].patch.status, 'this_month')
  assert.equal(check([act({ op: 'move', ref: 'T1', value: 'this week' })]).problems[0], '“Physics homework” is already in This week')
  assert.match(check([act({ op: 'move', ref: 'T1', value: 'the bin' })]).problems[0], /no column/)
})

test('complete and drop: drop archives (never deletes), not for prep sessions; nothing else happens to a finished task', () => {
  const done = check([act({ op: 'complete', ref: 'T2' }), act({ op: 'move', ref: 'T2', value: 'later' })])
  assert.equal(done.actions.length, 1)
  assert.deepEqual(done.actions[0].patch, { status: 'completed', completed_at: '__now__', archived_at: '__now__', archive_reason: 'done' })
  const drop = check([act({ op: 'drop', ref: 'T3' })])
  assert.deepEqual(drop.actions[0].patch, { archived_at: '__now__', archive_reason: 'dropped' })
  assert.match(drop.actions[0].line, /kept in Archive/)
  assert.match(check([act({ op: 'drop', ref: 'T4' })]).problems[0], /prep session/)
  assert.match(check([act({ op: 'complete', ref: 'T5' })]).problems[0], /isn’t open any more/)
})

test('star, minutes, importance, rename: sane values only', () => {
  assert.match(check([act({ op: 'star', ref: 'T3' })]).problems[0], /already starred/)
  assert.deepEqual(check([act({ op: 'star', ref: 'T1' })]).actions[0].patch, { is_key: true })
  assert.deepEqual(check([act({ op: 'minutes', ref: 'T1', number: 45 })]).actions[0].patch, { duration_minutes: 45 })
  assert.match(check([act({ op: 'minutes', ref: 'T1', number: 0 })]).problems[0], /no clear time/)
  assert.match(check([act({ op: 'importance', ref: 'T1', value: 'urgent' })]).problems[0], /isn’t must or nice/)
  assert.match(check([act({ op: 'importance', ref: 'T1', value: 'must' })]).problems[0], /already must/)
  assert.equal(check([act({ op: 'rename', ref: 'T2', value: 'SMC 2023 paper' })]).actions[0].line, '“SMC &lt;past&gt; paper” → “SMC 2023 paper”', 'names are escaped')
})

test('projects: existing by ref or name, a new one made first in the same card, unknown refused', () => {
  assert.deepEqual(check([act({ op: 'project', ref: 'T1', value: 'P1' })]).actions[0].patch, { project_id: 'p1' })
  assert.deepEqual(check([act({ op: 'project', ref: 'T1', value: 'football comeback' })]).actions[0].patch, { project_id: 'p1' })
  const both = check([act({ op: 'project', ref: 'T2', value: 'Learn music production' }), act({ op: 'project_new', value: 'Learn music production' })])
  assert.deepEqual(both.actions.map((a) => a.op), ['project_new', 'project'], 'the new project is made first')
  assert.equal(both.actions[1].name, 'Learn music production')
  assert.match(check([act({ op: 'project', ref: 'T1', value: 'Piano' })]).problems[0], /no project called/)
  assert.match(check([act({ op: 'project_new', value: 'Football Comeback' })]).problems[0], /already have a project/)
})

test('reminders: tick, a new day/time from his words, or a person', () => {
  assert.deepEqual(check([act({ op: 'reminder_done', ref: 'M1' })]).actions[0].patch, { done_at: '__now__' })
  const day = check([act({ op: 'reminder_when', ref: 'M2', date: '2026-10-15', words: 'thursday' })], 'PE kit reminder Thursday not Friday')
  assert.deepEqual(day.actions[0].patch, { kind: 'day', remind_on: '2026-10-15', remind_at: null, person: null })
  assert.equal(day.actions[0].line, '🔔 Bring PE kit: Fri 16 Oct → Thu 15 Oct')
  const time = check([act({ op: 'reminder_when', ref: 'M2', date: '2026-10-15', time: '07:30', words: 'thursday' })], 'PE kit reminder Thursday 7:30')
  assert.equal(time.actions[0].patch.remind_at, '2026-10-15T06:30:00.000Z', '07:30 London (BST) is 06:30 UTC')
  const person = check([act({ op: 'reminder_when', ref: 'M2', value: 'Coach' })])
  assert.deepEqual(person.actions[0].patch, { kind: 'person', remind_on: null, remind_at: null, person: 'Coach' })
  assert.match(check([act({ op: 'reminder_done', ref: 'T1' })]).problems[0], /couldn’t find that reminder/)
})

test('this week’s target number: logged targets only, 0–50, for this Monday’s week', () => {
  const a = check([act({ op: 'target_week', ref: 'W1', number: 3 })]).actions[0]
  assert.deepEqual(a.patch, { target_count: 3, week_start: '2026-10-05' })
  assert.match(a.line, /Lower this week: 2 → <b>3<\/b>/)
  assert.match(check([act({ op: 'target_week', ref: 'W2', number: 3 })]).problems[0], /comes from the calendar/)
  assert.match(check([act({ op: 'target_week', ref: 'W1', number: 99 })]).problems[0], /no clear number/)
})

test('only real refs of the right kind; at most 16 changes (a long message about several sessions); repeats ignored', () => {
  assert.match(check([act({ op: 'complete', ref: 'T99' })]).problems[0], /couldn’t find that task/)
  assert.match(check([act({ op: 'complete', ref: 'G1' })]).problems[0], /couldn’t find that task|isn’t open/, 'tests/goals are not tasks')
  assert.match(check([act({ op: 'explode', ref: 'T1' })]).problems[0], /unknown change/)
  const many = check(Array.from({ length: 20 }, (_, i) => act({ op: 'minutes', ref: 'T1', number: i + 1 })))
  assert.equal(many.actions.length, 16)
  assert.equal(check([act({ op: 'star', ref: 'T1' }), act({ op: 'star', ref: 'T1' })]).actions.length, 1)
})

test('no delete code in the bot, apart from the known exceptions', () => {
  const dir = join(ROOT, 'lib/telegram')
  const found = readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), 'utf8').split('\n').map((l, i) => [f, i + 1, l]))
    .filter(([, , l]) => /\.delete\(\)|deleteMessage|\bdrop table\b/i.test(l))   // a database delete is .delete() with nothing inside
    .map(([f, , l]) => `${f}: ${l.trim().slice(0, 200)}`)
  assert.deepEqual(found.map((x) => x.split(':')[0]).sort(), ['cards.ts', 'sent.ts', 'ticks.ts'], found.join('\n'))
  assert.ok(found.some((x) => x.startsWith('sent.ts') && x.includes("from('telegram_sent')")), 'sent.ts only clears "already sent" keys')
  assert.ok(found.some((x) => x.startsWith('cards.ts') && x.includes("from('target_logs')")), 'cards.ts only undoes a log, like the dashboard')
  // Build O: un-ticking a session on the pinned Today takes off the log its tick made (the same Undo)
  assert.ok(found.filter((x) => x.startsWith('ticks.ts')).every((x) => x.includes("from('target_logs')") && x.includes('block:')), 'ticks.ts only undoes its own tick’s log')
})
