// ACT by chat (queue item 2), on the local TEST database with a fake Telegram and a scripted AI. Run: npm run test:chat
// Every change is a ✅ card first (nothing saved before), applied after ✅, and ↩️ Undo archives / puts back (never
// deletes). Fast paths need no AI; anything else goes through the brain (scripted here).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useChat, CHAT } from './support/chat.mjs'
import { brain } from './support/fakes.mjs'

const chat = useChat()
const skip = chat.skip
const nat = (...a) => chat.nat(...a), q = (...a) => chat.q(...a)
const sent = () => chat.tg.sent().filter((m) => !m.text.startsWith('📌'))
const last = () => sent().at(-1)
const tap = async (label) => {
  const m = sent().filter((x) => chat.button(x, label)).at(-1)
  assert.ok(m, `no “${label}” button`)
  await chat.tap(chat.button(m, label), m.message_id)
}
const act = (o) => ({ op: 'act_score', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const today = () => chat.time.todayISO()
const P = () => import('../lib/act/parse.ts')
/** "Sat 12 Dec" for the next 12 Dec (the weekday depends on the year the tests run in) */
const label = async (words) => { const d = (await P()).parseDate(words, today()).date; return `${chat.time.dowShort(d)} ${chat.time.shortDate(d)}` }

async function setUp() {
  await nat('set up ACT')
  assert.match(last().text, /ACT set-up/)
  await tap('Apply')
  assert.match(last().text, /✅ <b>Done<\/b>/)
}

test('set-up card: one ✅ makes the ACT subject, 5 books + flashcards, the last real score; again = nothing; undo archives', { skip }, async () => {
  await nat('set up ACT')
  const card = last().text
  assert.match(card, /🎯 <b>ACT set-up<\/b> \(goal 36\)/)
  assert.match(card, /📚 ACT subject \(new\)/)
  assert.match(card, /Complete Guide to ACT English \(Meltzer\): 16 chapters <i>\(a guess\)<\/i>/)
  assert.match(card, /College Panda ACT Math \+ workbook: 30 chapters <i>\(a guess\)<\/i> · chapter TEST first; only the chapters where you drop marks/)
  assert.match(card, /The Critical Reader \(5th ed\).*only if your reading stalls/)
  assert.match(card, /Grammar flashcards \(Anki\)/)
  assert.match(card, /Last real ACT: E34 M34 R35 S35 → composite 34/)
  assert.equal((await q(`select count(*)::int n from programmes`))[0].n, 0, 'nothing saved before ✅')
  assert.equal((await q(`select count(*)::int n from subjects where name = 'ACT'`))[0].n, 0)
  await tap('Apply')
  const done = last().text
  assert.match(done, /✅ <b>Done<\/b>/)
  assert.match(done, /Today: <b>ACT/, 'the Done message says what to do today')
  const progs = await q(`select name, mode, area, notes, (select count(*)::int from programme_items i where i.programme_id = p.id) items from programmes p order by sort_order`)
  assert.deepEqual(progs.map((p) => [p.name, p.mode, p.items]), [
    ['Complete Guide to ACT English (Meltzer)', 'in_order', 16], ['Complete Guide to ACT Reading (3rd ed)', 'in_order', 18], ['College Panda ACT Math + workbook', 'gaps_only', 30],
    ['Advanced ACT Math', 'in_order', 12], ['The Critical Reader (5th ed)', 'optional', 12], ['Grammar flashcards (Anki)', 'in_order', 0]])
  assert.ok(progs.every((p) => p.area === 'act' && /role=/.test(p.notes)))
  const subj = await q(`select id from subjects where name = 'ACT' and archived_at is null`)
  assert.equal(subj.length, 1)
  assert.equal((await q(`select count(*)::int n from programmes where subject_id = $1`, [subj[0].id]))[0].n, 6)
  assert.deepEqual(await q(`select kind, english, maths, reading, science, composite from act_scores`), [{ kind: 'real', english: 34, maths: 34, reading: 35, science: 35, composite: 34 }])
  // again: nothing changes (idempotent), no AI
  const before = sent().length
  await nat('set up ACT')
  assert.match(last().text, /ACT is already set up/)
  assert.equal(sent().length, before + 1)
  assert.equal((await q(`select count(*)::int n from programmes`))[0].n, 6)
  // undo: everything archived, nothing deleted
  await tap('Undo')
  assert.match(last().text, /↩️ <b>Undone<\/b>/)
  assert.equal((await q(`select count(*)::int n from programmes where archived_at is null`))[0].n, 0)
  assert.equal((await q(`select count(*)::int n from programmes`))[0].n, 6, 'kept, archived')
  assert.equal((await q(`select count(*)::int n from act_scores where archived_at is null`))[0].n, 0)
  assert.equal((await q(`select count(*)::int n from subjects where name = 'ACT' and archived_at is not null`))[0].n, 1)
  chat.noSurprises()
})

test('/act before set-up: one tap → the set-up card; an archived ACT subject is brought back, not duplicated', { skip }, async () => {
  const cat = (await q(`select id from categories where user_id = $1`, [chat.users.owner]))[0]
  await chat.add('subjects', { name: 'ACT', category_id: cat.id, archived_at: new Date().toISOString() })
  await nat('/act')
  assert.match(last().text, /ACT<\/b> isn’t set up yet/)
  await tap('Set up ACT')
  assert.match(last().text, /📚 ACT subject \(brought back from the archive\)/)
  await tap('Apply')
  assert.deepEqual(await q(`select archived_at from subjects where name = 'ACT'`), [{ archived_at: null }])
  await nat('/act')
  const v = last().text
  assert.match(v, /Steady \(no retake date\): holidays 75 min a day \+ a full test on Wednesdays · school weeks 30 min × 3 \(Tue, Thu, Sat\)/)
  assert.match(v, /📘 Meltzer: ch 1 \(0\/16 done\)/)
  assert.match(v, /📐 College Panda: ch 1 chapter test · 0\/30 tested/)
  assert.match(v, /Advanced ACT Math: after the College Panda gaps/)
  assert.match(v, /Critical Reader: only if your reading stalls/)
  chat.noSurprises()
})

test('scores with typos → composite + the weakest section; ✅ logs it; the focus line; undo archives it', { skip }, async () => {
  await setUp()
  await nat('ACT pratice: E 33, M35 r34')
  assert.match(last().text, /📝 ACT practice test: E33 M35 R34 → <b>composite 34<\/b> · weakest now: English 33 vs 36/)
  assert.equal((await q(`select count(*)::int n from act_scores where kind = 'practice'`))[0].n, 0, 'nothing before ✅')
  await tap('Apply')
  assert.match(last().text, /Focus now: <b>English<\/b> \(33 vs 36\): it gets the most ACT days/)
  const [row] = await q(`select kind, english, maths, reading, science, composite, taken_on::text d from act_scores where kind = 'practice'`)
  assert.deepEqual(row, { kind: 'practice', english: 33, maths: 35, reading: 34, science: null, composite: 34, d: today() })
  await nat('english section 30')
  assert.match(last().text, /📝 ACT timed section: E30 · weakest now: English 30 vs 36/)
  await tap('Apply')
  await tap('Undo')
  assert.match(last().text, /↩️ <b>Undone<\/b>/)
  const rows = await q(`select kind, archived_at from act_scores where kind = 'section'`)
  assert.equal(rows.length, 1, 'kept')
  assert.ok(rows[0].archived_at, 'archived, not deleted')
  chat.noSurprises()
})

test('"ACT retake is 12 Dec" → countdown mode; /act shows it; "no ACT retake" clears it (archived)', { skip }, async () => {
  await setUp()
  const want = (await P()).parseDate('12 Dec', today()).date
  await nat('ACT retake is 12 Dec')
  assert.match(last().text, new RegExp(`🎯 ACT retake: <b>${await label('12 Dec')}</b> \\(\\d+ days\\) → countdown mode`))
  assert.equal((await q(`select count(*)::int n from goals`))[0].n, 0, 'nothing before ✅')
  await tap('Apply')
  assert.match(last().text, new RegExp(`🔥 Countdown: retake <b>${await label('12 Dec')}</b>`))
  assert.match(last().text, /Holidays: 4 h a day, full timed tests Tuesday \+ Thursday \(reviewed straight after\)\. School weeks: daily timed English \+ every miss against its rule · Reading \/ Maths alternate · mock on Tuesdays · light day before/)
  const [g] = await q(`select title, kind, test_kind, target_date::text d, subject_id is not null as on_act from goals`)
  assert.deepEqual(g, { title: 'ACT retake', kind: 'test', test_kind: 'act', d: want, on_act: true })
  await nat('/act')
  assert.match(last().text, new RegExp(`🔥 Countdown: retake <b>${await label('12 Dec')}</b>`))
  assert.match(last().text, /Today: <b>ACT(?: countdown: timed English| mock: full timed test|: timed English| full timed test)/, 'school week or holiday (half-term) shape')
  // moved
  await nat('ACT retake moved to 13 Feb')
  assert.match(last().text, new RegExp(`🎯 ACT retake: ${await label('12 Dec')} → <b>${await label('13 Feb')}</b>`))
  await tap('Apply')
  assert.equal((await q(`select count(*)::int n from goals where archived_at is null`))[0].n, 1, 'the same goal moved')
  await nat('no ACT retake')
  assert.match(last().text, new RegExp(`🎯 ACT retake ${await label('13 Feb')}: → <b>cleared</b>`))
  await tap('Apply')
  assert.match(last().text, /Back to steady mode/)
  assert.ok((await q(`select archived_at from goals`))[0].archived_at, 'archived, not deleted')
  chat.noSurprises()
})

test('a retake mentioned without a date → it asks; the bare date answer is the date', { skip }, async () => {
  await nat("I'm retaking the ACT")
  assert.match(last().text, /📅 When is your ACT retake\?/)
  assert.equal(chat.ai.requests.length, 0, 'no AI')
  await nat('the 12th of December')
  assert.match(last().text, new RegExp(`🎯 ACT retake: <b>${await label('12 Dec')}</b>`))
  await tap('Apply')
  assert.equal((await q(`select count(*)::int n from goals where test_kind = 'act' and archived_at is null`))[0].n, 1)
  // asked again with a date already set: it says when
  await nat('retaking the ACT')
  assert.match(last().text, /Your ACT retake is <b>12 Dec<\/b>/)
  chat.noSurprises()
})

test('a miss with its rule → a mistakes row on ACT (redo in 3 days); "redid ACT Q12" moves it on; undo', { skip }, async () => {
  await setUp()
  await nat('ACT miss: english Q12 comma splice — joined two sentences with a comma')
  const T = chat.time
  const redo = T.addDays(today(), 3)
  assert.match(last().text, new RegExp(`❌ ACT English miss Q12: rule <b>comma splice</b> — joined two sentences with a comma · redo ${T.dowShort(redo)} ${T.shortDate(redo)}`))
  await tap('Apply')
  const [m] = await q(`select body, rule, question, source, redo_stage, review_on::text r, s.name subject from mistakes m join subjects s on s.id = m.subject_id`)
  assert.deepEqual(m, { body: 'joined two sentences with a comma', rule: 'comma splice', question: 'Q12', source: 'ACT English', redo_stage: 0, r: redo, subject: 'ACT' })
  assert.match(last().text, /1 ACT miss open/)
  await nat('redid ACT Q12')
  assert.match(last().text, /🔁 ACT English miss Q12 \(comma splice\): redo 1 done → next redo/)
  await tap('Apply')
  const [after] = await q(`select redo_stage, review_on::text r from mistakes`)
  assert.deepEqual(after, { redo_stage: 1, r: T.addDays(today(), 7) })
  await tap('Undo')
  assert.deepEqual(await q(`select redo_stage, review_on::text r from mistakes`), [{ redo_stage: 0, r: redo }])
  chat.noSurprises()
})

test('a book chapter done → "Next: …"; College Panda chapter tests: dropped marks = do it, full marks = skip it', { skip }, async () => {
  await setUp()
  await nat('finished Meltzer chapter 1')
  assert.match(last().text, /📘 Meltzer ch 1: to do → <b>done ✓<\/b>/)
  await tap('Apply')
  assert.match(last().text, /Next: 📘 Meltzer: ch 2 \(1\/16 done\)/)
  const items = await q(`select i.title, i.status, i.done_on::text d from programme_items i join programmes p on p.id = i.programme_id where p.name like '%Meltzer%' order by position limit 2`)
  assert.deepEqual(items, [{ title: 'Chapter 1', status: 'done', d: today() }, { title: 'Chapter 2', status: 'todo', d: null }])
  await nat('College Panda ch 1 test 12/15')
  assert.match(last().text, /College Panda ch 1: chapter test 12\/15 → <b>do the chapter<\/b> \(dropped 3 marks\)/)
  await tap('Apply')
  assert.match(last().text, /Next: 📐 College Panda: ch 1: do the chapter \(chapter test 12\/15\)/)
  await nat('CP ch 2 test 15/15')
  assert.match(last().text, /chapter test 15\/15 → full marks: <b>chapter skipped<\/b>/)
  await tap('Apply')
  const cp = await q(`select i.status, i.score::int s, i.out_of::int o, i.result from programme_items i join programmes p on p.id = i.programme_id where p.mode = 'gaps_only' order by position limit 2`)
  assert.deepEqual(cp, [{ status: 'doing', s: 12, o: 15, result: 'chapter test 12/15 · do the chapter' }, { status: 'skipped', s: 15, o: 15, result: 'chapter test 15/15 · full marks, chapter skipped' }])
  // the chapter count is a guess: "Meltzer has 18 chapters" adds two
  await nat('Meltzer has 18 chapters')
  assert.match(last().text, /📘 Meltzer: 16 → <b>18 chapters<\/b> \(adds ch 17, ch 18\)/)
  await tap('Apply')
  assert.equal((await q(`select count(*)::int n from programme_items i join programmes p on p.id = i.programme_id where p.name like '%Meltzer%' and i.archived_at is null`))[0].n, 18)
  await tap('Undo')
  assert.equal((await q(`select count(*)::int n from programme_items i join programmes p on p.id = i.programme_id where p.name like '%Meltzer%' and i.archived_at is null`))[0].n, 16, 'the two new ones archived')
  chat.noSurprises()
})

test('change via ✏️: the corrected score replaces the card (the brain reads the correction)', { skip }, async () => {
  await setUp()
  await nat('ACT practice: E33 M35 R34')
  await tap('Change')
  assert.match(last().text, /What should be different/)
  chat.ai.script(CHAT, brain({ intent: 'instruction', reply: 'English 32, then.', actions: [act({ value: 'kind=practice; e=32; m=35; r=34' })] }))
  await nat('english was 32 not 33')
  assert.match(last().text, /✏️ <b>Corrected<\/b>/)
  assert.match(last().text, /E32 M35 R34 → <b>composite 34<\/b>/)
  await tap('Apply')
  assert.deepEqual(await q(`select english from act_scores where kind = 'practice'`), [{ english: 32 }])
  // the brain saw the ACT section of the snapshot
  assert.match(chat.lastBrainText(), /## ACT \(goal 36 composite/)
  assert.match(chat.lastBrainText(), /AC1 \| Complete Guide to ACT English \(Meltzer\) \| Meltzer: ch 1 \(0\/16 done\)/)
  chat.noSurprises()
})

test('cancel: ✖ on a retake card changes nothing', { skip }, async () => {
  await nat('ACT retake is 12 Dec')
  await tap('Cancel')
  assert.match(last().text, /Cancelled\. Nothing changed\./)
  assert.equal((await q(`select count(*)::int n from goals`))[0].n, 0)
  chat.noSurprises()
})

test('undo only if unchanged: a set-up whose books were used since is left alone', { skip }, async () => {
  await setUp()
  const setupCard = sent().filter((x) => chat.button(x, 'Undo')).at(-1)
  await nat('finished Meltzer chapter 1')
  await tap('Apply')
  await chat.tap(chat.button(setupCard, 'Undo'), setupCard.message_id)
  assert.match(last().text, /Left as it is \(changed since\): ACT set-up/)
  assert.equal((await q(`select count(*)::int n from programmes where archived_at is null`))[0].n, 6)
  chat.noSurprises()
})

test('the brain path: a book change by its ref (AC…), checked like a fast one', { skip }, async () => {
  await setUp()
  chat.ai.script(CHAT, (body) => {
    const text = body.messages[0].content.map((x) => x.text).join('\n')
    const ref = text.match(/(AC\d+) \| College Panda ACT Math/)[1]
    return brain({ intent: 'instruction', reply: 'Skipping chapter 2.', actions: [act({ op: 'act_book', ref, value: 'item=ch 2; do=skip' })] })
  })
  await nat('i know the second college panda chapter already, skip it')
  assert.match(last().text, /📐 College Panda ch 2: to do → <b>skipped<\/b>/)
  await tap('Apply')
  assert.deepEqual(await q(`select i.status from programme_items i join programmes p on p.id = i.programme_id where p.mode = 'gaps_only' and i.title = 'Chapter 2'`), [{ status: 'skipped' }])
  chat.noSurprises()
})

test('something it can’t do yet → one line + saved to App ideas', { skip }, async () => {
  await setUp()
  chat.ai.script(CHAT, brain({ intent: 'app_idea', idea: 'Sync the Anki grammar deck with the ACT plan' }))
  await nat('can you sync my anki deck so you know which cards I did')
  assert.match(last().text, /I can’t do that yet — it needs adding in Claude Code/)
  assert.deepEqual(await q(`select request, status from app_ideas`), [{ request: 'Sync the Anki grammar deck with the ACT plan', status: 'open' }])
  chat.noSurprises()
})

test('"how is my ACT going?" answers from his data (no AI); a miss before set-up still logs (by its ACT source)', { skip }, async () => {
  await nat('ACT miss: reading Q5 misread the question — answered from memory, not the text')
  await tap('Apply')
  assert.deepEqual(await q(`select subject_id, source from mistakes`), [{ subject_id: null, source: 'ACT Reading' }])
  await setUp()
  await nat('how is my ACT going?')
  const v = last().text
  assert.match(v, /🎯 <b>ACT<\/b> · goal 36/)
  assert.match(v, /📈 .*real 34 \(E34 M34 R35 S35\)/)
  assert.match(v, /Weakest: <b>English<\/b> 34 vs 36/)
  assert.match(v, /❌ Misses: 1 open/)
  assert.equal(chat.ai.requests.length, 0)
  chat.noSurprises()
})

test('loadActWorld for Today (as Nat, row level security): empty before set-up; a ticked ACT block = done today; markActPickDone moves due misses on', { skip }, async () => {
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const { loadActWorld, markActPickDone } = await import('../lib/act/data.ts')
  const { actPicks } = await import('../lib/act/engine.ts')
  const sb = await openOwnerSession()
  const T = chat.time, d = today()
  const ctx = { date: d, dow: T.isoDow(d), mode: 'half_term', studyMinutes: 0 }
  const empty = await loadActWorld(sb, d)
  assert.deepEqual([empty.retake, empty.books, empty.scores, empty.misses, empty.goal], [null, [], [], [], 36])
  assert.deepEqual(actPicks(empty, ctx), [], 'nothing set up: no ACT')
  await setUp()
  // a stranger's ACT book never shows (RLS)
  await chat.db.query(`insert into programmes (user_id, name, area) values ($1, 'Stranger ACT book', 'act')`, [chat.users.stranger])
  const subj = (await q(`select id from subjects where name = 'ACT' and user_id = $1`, [chat.users.owner]))[0].id
  await chat.add('mistakes', { subject_id: subj, body: 'joined two sentences', rule: 'comma splice', question: 'Q12', source: 'ACT English', logged_on: T.addDays(d, -4), review_on: T.addDays(d, -1) })
  const w = await loadActWorld(sb, d)
  assert.equal(w.books.length, 6)
  assert.ok(!w.books.some((b) => b.name === 'Stranger ACT book'))
  assert.equal(w.misses.length, 1)
  assert.equal(w.subjectId, subj)
  const [p] = actPicks(w, ctx)
  assert.ok(p && p.subject === 'ACT' && p.minutes > 0)
  // Today ticks it: the plan block is done → nothing more today
  await chat.add('plan_blocks', { plan_id: '00000000-0000-0000-0000-000000000001', on_date: d, start_time: '10:00', end_time: '11:15', title: p.title, status: 'done', pick_key: p.key })
  const after = await loadActWorld(sb, d)
  assert.ok(after.doneToday.includes(p.key), 'each ticked pick by its key (a holiday countdown day has two)')
  assert.deepEqual(actPicks(after, ctx), [])
  // the due miss moves on a stage (+7 days), like a redo by chat
  // probe 7: only a pick that had the redo step moves misses on (its key ends ':redo')
  assert.equal(await markActPickDone(sb, 'act:english:book', d), 0, 'no redo step: nothing moves')
  const moved = await markActPickDone(sb, 'act:english:book:redo', d)
  assert.equal(moved, 1)
  assert.deepEqual(await q(`select redo_stage, review_on::text r from mistakes`), [{ redo_stage: 1, r: T.addDays(d, 7) }])
  assert.equal(await markActPickDone(sb, 'topic:x:ahead', d), 0)
  chat.noSurprises()
})

test('understood but impossible → the reason at once (no AI): a chapter already done, a score sent twice, no such miss', { skip }, async () => {
  await setUp()
  await nat('finished Meltzer chapter 1')
  await tap('Apply')
  await nat('done meltzer ch 1')
  assert.equal(last().text, '🎯 Meltzer ch 1 is already done.')
  await nat('ACT practice: E33 M35 R34')
  await tap('Apply')
  await nat('ACT practice: E33 M35 R34')
  assert.match(last().text, /That practice score \(E33 M35 R34\) is already logged/)
  await nat('redid ACT Q40')
  assert.equal(last().text, '🎯 No open ACT miss Q40.')
  await nat('Meltzer has 16 chapters')
  assert.equal(last().text, '🎯 Meltzer already has 16 chapters.')
  assert.equal(chat.ai.requests.length, 0, 'none of this needed the AI')
  chat.noSurprises()
})

test('a retake date before the books are set up: countdown works; /act offers the set-up', { skip }, async () => {
  await nat('act retake 12/12')
  await tap('Apply')
  await nat('/act')
  assert.match(last().text, new RegExp(`🔥 Countdown: retake <b>${await label('12 Dec')}</b>`))
  assert.match(last().text, /Your ACT books aren’t set up yet/)
  assert.match(last().text, /Today: <b>ACT( countdown| mock|: timed| full timed test)/)
  assert.ok(chat.button(last(), 'Set up ACT'))
  await tap('Set up ACT')
  await tap('Apply')
  assert.equal((await q(`select count(*)::int n from programmes where archived_at is null`))[0].n, 6)
  chat.noSurprises()
})

test('probe 1: two set-up cards never duplicate: a new one replaces the waiting one; an old card applied later makes nothing twice', { skip }, async () => {
  await nat('/act')
  await tap('Set up ACT')
  const first = sent().filter((x) => chat.button(x, 'Apply')).at(-1)
  await nat('set up ACT')
  assert.equal((await q(`select count(*)::int n from telegram_pending where kind = 'action' and status in ('open', 'editing')`))[0].n, 1, 'the first card was replaced')
  await chat.tap(chat.button(first, 'Apply'), first.message_id)
  assert.equal((await q(`select count(*)::int n from programmes`))[0].n, 0, 'the replaced card does nothing')
  assert.match(chat.tg.of('answerCallbackQuery').at(-1).body.text ?? '', /Already handled/)
  await tap('Apply')
  // a stale card (made before the other was applied) re-checks what exists at ✅
  const [card] = await q(`select payload from telegram_pending where kind = 'action' and status = 'saved'`)
  const { applyActions } = await import('../lib/telegram/actions.ts')
  const { openOwnerSession } = await import('../lib/telegram/owner-session.ts')
  const res = await applyActions(await openOwnerSession(), card.payload.actions)
  assert.match(res.error ?? '', /already set up/)
  assert.equal((await q(`select count(*)::int n from programmes where archived_at is null`))[0].n, 6)
  assert.equal((await q(`select count(*)::int n from act_scores where kind = 'real' and archived_at is null`))[0].n, 1)
  chat.noSurprises()
})

test('probe 9: the set-up real score is dated before his earliest score, so later-entered older practice is not "newer"', { skip }, async () => {
  const T = chat.time
  await chat.add('act_scores', { kind: 'practice', taken_on: T.addDays(today(), -30), english: 33, maths: 35, reading: 34, composite: 34 })
  await setUp()
  const [r] = await q(`select taken_on::text d, notes from act_scores where kind = 'real'`)
  assert.equal(r.d, T.addDays(today(), -31))
  assert.match(r.notes, /dated the day before your earliest score/)
  chat.noSurprises()
})

test('probe 10: a test called "Act 2 essay" is not the ACT (no countdown)', { skip }, async () => {
  await chat.add('goals', { title: 'Act 2 essay', kind: 'test', target_date: chat.time.addDays(today(), 5) })
  await setUp()
  await nat('/act')
  assert.match(last().text, /Steady \(no retake date\)/)
  assert.doesNotMatch(last().text, /Countdown/)
  chat.noSurprises()
})
