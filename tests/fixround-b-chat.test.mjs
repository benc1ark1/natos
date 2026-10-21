// Fix round, part B, on the TEST database with Nat's real autumn (tests/support/nat-real.mjs; clock: Wed 21 Oct 18:00):
// "plan my week" in the ACT week (only ACT until Sun 25 Oct, the retake that day, nothing for FM/physics/Vlad/HT2 before
// Mon 26 Oct, ACT free time, no AI needed), "plan next week" on a Wednesday (half-term week 2: Vlad + FM + physics, no
// Later, no App ideas), a small change re-fitted without the AI (one block per task a day), ⚠️ Slipped without archived
// tasks, Today in the focus, and the bot setting "don't start before …" and "until … only ACT".
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test --test-concurrency=1 tests/fixround-b-chat.test.mjs
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'
import { ACT_DAY, NEXT, PLANNING, SCHOOL, TASKS, THIS, TODAY, day } from './support/nat-real.mjs'

const PLAN = 'claude-opus-5-5'
const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a), add = (t, v) => chat.add(t, v)
const last = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌')).at(-1)
const act = (o) => ({ op: 'move', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const show = (m) => { if (process.env.SHOW) console.log(`\n----\n${m.text}`) }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const refIn = (body, name) => body.messages[0].content.map((c) => c.text).join('\n').match(new RegExp(`(T\\d+) \\| ${esc(name)}`))?.[1]

before(async () => {
  if (skip) return
  const { setClock } = await import('./support/clock.mjs')
  const { zonedToUTC } = await import('../lib/time.ts')
  setClock(zonedToUTC(TODAY, '18:00'))
})
after(async () => { const { setClock } = await import('./support/clock.mjs'); setClock(null) })

const dayOf = (text, label) => {
  const start = text.indexOf(`<b>${label}</b>`)
  assert.ok(start >= 0, `no ${label} on the card`)
  const next = text.slice(start + 1).search(/\n<b>(Today|Mon|Tue|Wed|Thu|Fri|Sat|Sun)<\/b>/)
  return next < 0 ? text.slice(start) : text.slice(start, start + 1 + next)
}
/** The study lines of a day on the card (📚 / •), without training. */
const study = (text, label) => [...dayOf(text, label).matchAll(/\n {2,}\d\d:\d\d (?:📚|•) (.+?) <i>\d+m<\/i>/g)].map((m) => m[1])

/** His real autumn in the test database: subjects, the ACT retake + HT2, his tasks (ids → rows), settings, a few events. */
async function world() {
  const subj = {}
  // (the test database starts with some of his subjects)
  for (const [k, name] of [['subj-act', 'ACT'], ['subj-fm', 'Further Maths'], ['subj-phys', 'Physics']]) subj[k] = (await q(`select id from subjects where name = $1`, [name]))[0]?.id ?? (await add('subjects', { name })).id
  await add('goals', { title: 'ACT retake', kind: 'test', test_kind: 'act', target_date: ACT_DAY, subject_id: subj['subj-act'] })
  await add('goals', { title: 'FM HT2 test', kind: 'test', target_date: '2026-11-04', subject_id: subj['subj-fm'] })
  const ids = {}
  for (const t of TASKS) {
    const row = await add('tasks', { title: t.title, status: t.status, importance: t.importance, due_at: t.due_at, window_start: t.window_start, duration_minutes: t.duration_minutes,
      subject_id: t.subject_id ? subj[t.subject_id] : null, archived_at: t.archived_at, archive_reason: t.archive_reason, postpone_count: t.postpone_count })
    ids[t.id] = row
  }
  await q(`update profiles set planning = $2 where user_id = $1`, [chat.users.owner, JSON.stringify({ ...PLANNING, noTrainingDays: 'monday, tuesday, wednesday, thursday, friday, saturday, sunday' })])
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15', repeat_from: '2026-09-01', is_school: true })
  await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', repeat_from: '2026-09-01', training_type: 'football', load: 'hard' })
  return { subj, ids }
}

test('1 + 2 + 8 + 16: “plan my week” on Wed 21 Oct: only ACT until the retake (free time → ACT), nothing else on Sun 25, Sat light; no FM/physics/Vlad/HT2; no AI planner; Slipped without archived', { skip }, async () => {
  const { ids } = await world()
  // last week: a block for the chemistry corrections (open) and one for the essay plan he has since archived
  const plan = '00000000-0000-4000-8000-000000000001'
  await add('plan_blocks', { plan_id: plan, on_date: '2026-10-15', start_time: '17:00', end_time: '17:30', title: 'Chemistry corrections', kind: 'focus', task_id: ids['t-overdue'].id })
  await add('plan_blocks', { plan_id: plan, on_date: '2026-10-16', start_time: '17:00', end_time: '17:45', title: 'Old essay plan', kind: 'focus', task_id: ids['t-archived'].id })
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning your week.', plan_week: true }))
  // (no PLAN reply scripted: every day is ACT-only or the test, so the planner AI isn't asked)
  await nat('plan my week')
  const card = last()
  show(card)
  assert.match(card.text, /🗓 <b>Your week<\/b> · Wed 21 Oct – Sun 25 Oct/)
  const plain = card.text.replace(/\n⏳ [^\n]*/, '')
  assert.doesNotMatch(plain, /FM homework|SHM booklet|Vlad: mechanics|HT2 revision|UCAS/, 'nothing for them before Mon 26 Oct (not even “didn’t fit”)')
  assert.doesNotMatch(card.text, /Didn’t fit:[^\n]*ACT (reading|grammar|maths):/, 'ACT free time is only there if there’s room')
  assert.match(card.text, /🎯 Focus: only ACT until Sun 25 Oct/)
  assert.match(card.text, /⏳ From Mon 26 Oct: FM homework: complex numbers ex 2B, Physics: SHM booklet, Vlad: mechanics questions \(\+1 more\)/)
  // the retake takes Sunday; Saturday is light
  assert.deepEqual(study(card.text, 'Sun'), ['ACT retake today 🍀'])
  assert.deepEqual(study(card.text, 'Sat'), ['ACT eve: rules + misses, early night'])
  // ACT free time on the focus days: reading, grammar and ACT maths, once each a day; every study line is ACT
  for (const d of ['Today', 'Thu', 'Fri']) {
    const s = study(card.text, d)
    assert.ok(s.length && s.every((x) => /\bACT\b/.test(x)), `${d}: ${s.join(' | ')}`)
    assert.ok(s.includes('ACT grammar: rules + English questions'), `${d}: ${s.join(' | ')}`)
    assert.equal(new Set(s).size, s.length, `${d}: one block each`)
  }
  assert.match(card.text, /⚠️ <b>Slipped<\/b>: Chemistry corrections \(Thu\)\n/, 'said once')
  assert.doesNotMatch(card.text, /Old essay plan/, 'an archived task never slipped')
  chat.noSurprises()
})

test('9 + 1 + 7 + 5 + 17: “plan next week” on a Wednesday: Mon 26 Oct – Sun 1 Nov with Vlad + FM + physics, no Later, no App idea; “move physics to Thursday” re-fits without the AI (one physics block)', { skip }, async () => {
  const { ids } = await world()
  const idea = await add('tasks', { title: 'Show focus periods in Settings', status: 'this_week', importance: 'must', source_text: 'can settings show my focus period' })
  await add('app_ideas', { request: 'Show focus periods in Settings', source_text: 'can settings show my focus period' })
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Planning next week.', plan_week: true }))
  chat.ai.script(PLAN, (body) => {
    const text = body.messages[0].content.map((c) => c.text).join('\n')
    assert.match(text, /<day date="2026-10-26">/, 'next week’s days')
    assert.doesNotMatch(text, /<day date="2026-10-2[1-5]">/, 'not this week’s')
    assert.match(text, /Tasks in Later: only if due by Sun 1 Nov/)
    const r = (name) => refIn(body, name)
    const item = (name, minutes) => ({ ref: r(name), title: name, minutes, kind: 'focus', focus: '', why: 'due soon' })
    return { days: [
      { date: day(NEXT, 0), items: [item('Vlad: mechanics questions', 60), item('Sort out UCAS notes', 30), item('Show focus periods in Settings', 30)] },
      { date: day(NEXT, 1), items: [item('Physics: SHM booklet', 45)] },
      { date: day(NEXT, 3), items: [item('Physics: SHM booklet', 45)] },
    ], note: '', push_back: '' }
  })
  await nat('plan next week please')
  const card = last()
  show(card)
  assert.match(card.text, /🗓 <b>Your week<\/b> · Mon 26 Oct – Sun 1 Nov/)
  assert.ok(study(card.text, 'Mon').includes('Vlad: mechanics questions'), study(card.text, 'Mon').join(' | '))
  assert.doesNotMatch(card.text, /UCAS|Show focus periods/, 'Later and an App idea are never planned')
  assert.ok(study(card.text, 'Tue').includes('Physics: SHM booklet'))
  assert.doesNotMatch(card.text, /🎯 Focus/, 'the focus ended on Sun 25 Oct')
  void idea; void ids
  // a small change: re-fitted by code, no new AI plan; physics once on Thursday (it was there already)
  chat.ai.script(CHAT, brain({ intent: 'plan', reply: 'Moving it.', plan_week: true }))
  await nat('move physics to Thursday')
  const again = last()
  show(again)
  assert.match(again.text, /✏️ <b>Changed<\/b>: Physics: SHM booklet → Thu/)
  assert.ok(!study(again.text, 'Tue').includes('Physics: SHM booklet'))
  assert.deepEqual(study(again.text, 'Thu').filter((x) => x === 'Physics: SHM booklet'), ['Physics: SHM booklet'], 'one block per task a day')
  assert.match(again.text, /🗓 <b>Your week<\/b> · Mon 26 Oct – Sun 1 Nov/, 'still next week')
  assert.equal(chat.ai.byModel(PLAN).length, 1, 'the planner AI ran once (the fresh plan), not for the change')
  chat.noSurprises()
})

test('6: Today on Wed 21 Oct (the ACT focus): no Vlad/FM/physics, no overdue chemistry on top; Mon 26 Oct: FM and the chemistry are back', { skip }, async () => {
  await world()
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const { loadToday } = await import('../lib/today/load.ts')
  const { zonedToUTC } = await import('../lib/time.ts')
  const sb = await openOwnerSession()
  const wed = await loadToday(sb, { now: new Date(zonedToUTC(TODAY, '18:00')) })
  const titles = [...wed.plan.items, ...wed.plan.hidden].map((i) => i.title)
  assert.ok(!titles.some((t) => /Vlad|FM homework|SHM|HT2|Chemistry/.test(t)), titles.join(' | '))
  assert.ok(wed.plan.items.length && wed.plan.items.every((i) => /\bACT\b/.test(i.title) || i.kind === 'training'), titles.join(' | '))
  // the retake day: the retake, nothing else; the day before: light only
  const sun = await loadToday(sb, { now: new Date(zonedToUTC(ACT_DAY, '07:30')) })
  assert.deepEqual(sun.plan.items.filter((i) => i.kind !== 'training').map((i) => i.title), ['ACT retake today 🍀'])
  assert.deepEqual(sun.plan.hidden.map((i) => i.title), [], 'nothing waiting behind it either')
  const sat = await loadToday(sb, { now: new Date(zonedToUTC(day(THIS, 5), '09:00')) })
  assert.ok(sat.plan.items.filter((i) => i.kind !== 'training').every((i) => !i.heavy), sat.plan.items.map((i) => `${i.title} ${i.heavy}`).join(' | '))
  const mon = await loadToday(sb, { now: new Date(zonedToUTC(NEXT, '10:00')) })
  const later = [...mon.plan.items, ...mon.plan.hidden].map((i) => i.title).join(' | ')
  assert.match(later, /FM homework: complex numbers ex 2B/)
  assert.match(later, /Chemistry corrections/, 'the overdue one is back once the focus ends')
  // the first school week (Mon 2 Nov): no focus, nothing waiting; HT2 (Wed 4 Nov, a school day) is ordinary prep
  const sch = await loadToday(sb, { now: new Date(zonedToUTC(SCHOOL, '17:00')) })
  const s = [...sch.plan.items, ...sch.plan.hidden].map((i) => i.title).join(' | ')
  assert.match(s, /FM HT2/)
  assert.doesNotMatch(s, /ACT (reading|grammar|maths):/, 'no ACT free time after the focus')
  chat.noSurprises()
})

test('1 (bot): “don’t start physics before Mon 26 Oct” sets its start date; “until 25 Oct only ACT” sets the focus; both on a ✅ card', { skip }, async () => {
  const { ids } = await world()
  await q(`update tasks set window_start = null where id = $1`, [ids['t-phys'].id])
  await q(`update profiles set planning = planning - 'focusPeriods' where user_id = $1`, [chat.users.owner])
  chat.ai.script(CHAT, (body) => brain({ intent: 'instruction', reply: 'Physics waits until Monday.',
    actions: [act({ op: 'not_before', ref: refIn(body, 'Physics: SHM booklet') ?? '', date: NEXT, words: 'Mon 26 Oct' })] }))
  await nat('don’t start physics SHM before Mon 26 Oct')
  let card = last()
  assert.match(card.text, /Physics: SHM booklet<\/b>: any day → <b>not before Mon 26 Oct<\/b>/)
  assert.equal((await q(`select window_start from tasks where id = $1`, [ids['t-phys'].id]))[0].window_start, null, 'nothing changes before ✅')
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  const ws = (await q(`select to_char(window_start, 'YYYY-MM-DD') d from tasks where id = $1`, [ids['t-phys'].id]))[0].d
  assert.equal(ws, NEXT)
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'Only ACT until the retake.', actions: [act({ op: 'focus_period', value: 'until=2026-10-25; only=ACT', words: '25 Oct' })] }))
  await nat('until 25 Oct only ACT')
  card = last()
  assert.match(card.text, /🎯 Focus: <b>only ACT until Sun 25 Oct<\/b>/)
  await chat.tap(chat.button(card, 'Apply'), card.message_id)
  const p = (await q(`select planning from profiles where user_id = $1`, [chat.users.owner]))[0].planning
  assert.deepEqual(p.focusPeriods, [{ from: TODAY, until: ACT_DAY, only: 'ACT' }])
  void THIS
})
