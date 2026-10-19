// Server-only: the ACT changes the bot can make (plans/contracts.md §2, §5), each checked first (a short "before → after"
// line for the ✅ card), applied as Nat only after ✅, and undone only if nothing changed it since (new rows are archived,
// never deleted). Ops: act_score · act_date · act_miss · act_book · act_setup. Also the /act view, the brain's snapshot
// lines and the "Next: …" line after ✅. lib/telegram/plugins/act.ts wires these into the bot.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { DayContext } from '../plan-items'
import type { CheckEnv, PluginAction, PluginApplied, PluginRawAction, SnapshotPart } from '../telegram/plugin-types'
import { moreSettings } from '../settings'
import { addDays, daysBetween, dowShort, isoDow, shortDate } from '../time'
import { afterRedo, firstRedo, parseMistakeKind } from '../tracker/rules'
import type { Programme, ProgrammeItem } from '../tracker/types'
import { BOOKS, POSITION_STEP, bookDef, bookNotes, emojiOf, isPassage, itemShort, itemsOf, roleOf, shortName, type BookDef } from './books'
import { actMode, actPicks, bookLine, composite, dueMisses, missSection, nextBookItem, rulesOf, scoreText, weakest } from './engine'
import { findBook, sectionWord } from './parse'
import type { ActRows } from './data'
import { SECTION_LABEL, type ActScore, type ActSection, type BookRole } from './types'

export const ACT_OPS = ['act_score', 'act_date', 'act_miss', 'act_book', 'act_setup'] as const
type Op = (typeof ACT_OPS)[number]

/** His last real test (his brief, 19 Oct 2026): the set-up card saves it once. */
export const LAST_REAL = { english: 34, maths: 34, reading: 35, science: 35 }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const DOW_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
/** "kind=practice; e=33" → { kind: 'practice', e: '33' } (keys lower case; a value may contain '=') */
export const kvOf = (v: string) => Object.fromEntries((v ?? '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? null : [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()] })
  .filter((x): x is [string, string] => !!x && !!x[0] && !!x[1]))
/** Free text inside a "key=value; …" value: no ';' (it would split it). */
export const kvText = (s: string) => s.replace(/;/g, ',').replace(/\s+/g, ' ').trim()

const sqlHint = (files: string[]) => `run ${files.join(' and ')} in Supabase first (SQL Editor → New query → paste → Run)`
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

type Check = { action?: PluginAction; problem?: string }
const action = (op: Op, table: string, id: string | null, title: string, line: string, patch: Record<string, unknown>): Check => ({ action: { op, table, id, title, line, patch } })

// ---------------------------------------------------------------------------
// Checking (no database: everything comes from the rows read first)
// ---------------------------------------------------------------------------

export function checkAct(op: string, raw: PluginRawAction, rows: ActRows | undefined, env: CheckEnv): Check {
  if (!rows) return { problem: 'couldn’t read your ACT records' }
  const today = env.today
  switch (op as Op) {
    case 'act_score': return checkScore(raw, rows, env)
    case 'act_date': return checkDate(raw, rows, env)
    case 'act_miss': return checkMiss(raw, rows, today, env)
    case 'act_book': return checkBook(raw, rows, today, env)
    case 'act_setup': return checkSetup(rows)
    default: return { problem: `unknown ACT change “${op}”` }
  }
}

const SCORE_KEYS: [ActSection, string[]][] = [['english', ['e', 'english', 'eng']], ['maths', ['m', 'maths', 'math']], ['reading', ['r', 'reading', 'read']], ['science', ['s', 'science', 'sci']]]

function checkScore(raw: PluginRawAction, rows: ActRows, env: CheckEnv): Check {
  if (rows.missing.includes('supabase/act.sql')) return { problem: sqlHint(['supabase/act.sql']) }
  const kv = kvOf(raw.value)
  const vals: Record<ActSection, number | null> = { english: null, maths: null, reading: null, science: null }
  for (const [s, keys] of SCORE_KEYS) {
    const v = keys.map((k) => kv[k]).find((x) => x != null)
    if (v == null) continue
    const n = Number(v)
    if (!Number.isInteger(n) || n < 1 || n > 36) return { problem: 'ACT section scores go from 1 to 36' }
    vals[s] = n
  }
  const given = Object.values(vals).filter((v) => v != null).length
  if (!given) return { problem: 'which scores? e.g. “ACT practice: E33 M35 R34”' }
  const k = (kv.kind ?? '').toLowerCase()
  const kind: ActScore['kind'] = k === 'real' ? 'real' : k === 'section' || (given === 1 && k !== 'practice') ? 'section' : 'practice'
  let date = env.today
  if (raw.date && raw.date !== env.today) {
    if (!isDate(raw.date) || raw.date > env.today || raw.date < addDays(env.today, -400)) return { problem: 'that date for the score doesn’t look right' }
    if (!env.grounded(raw.words)) return { problem: 'the date for the score wasn’t in your words' }
    date = raw.date
  }
  if (rows.scores.some((s) => s.kind === kind && s.takenOn === date && s.english === vals.english && s.maths === vals.maths && s.reading === vals.reading && s.science === vals.science)) {
    return { problem: `that ${kind === 'real' ? 'real' : kind} score (${scoreText(vals)}) is already logged` }
  }
  const comp = composite(vals.english, vals.maths, vals.reading)
  const goal = rows.world.goal
  const after = [...rows.world.scores, { id: 'new', takenOn: date, kind, ...vals, composite: comp }]
  const w = weakest(after, goal)
  const label = kind === 'real' ? 'real test' : kind === 'practice' ? 'practice test' : 'timed section'
  const focus = w && w.gap > 0 ? `weakest now: ${SECTION_LABEL[w.section]} ${w.score} vs ${goal}` : w ? `all sections at ${goal} ✓` : ''
  const line = `📝 ACT ${label}${date !== env.today ? ` <i>(${day(date)})</i>` : ''}: ${scoreText(vals)}${comp != null ? ` → <b>composite ${comp}</b>` : ''}${focus ? ` · ${focus}` : ''}`
  return action('act_score', 'act_scores', null, `ACT ${label} ${scoreText(vals)}`, line,
    { taken_on: date, kind, ...vals, composite: comp, source_text: env.said.split('\n').at(-1)?.slice(0, 1000) ?? null })
}

function checkDate(raw: PluginRawAction, rows: ActRows, env: CheckEnv): Check {
  const today = env.today
  const v = (raw.value ?? '').trim().toLowerCase()
  const upcoming = rows.goals.filter((g) => g.target_date >= today).sort((a, b) => a.target_date.localeCompare(b.target_date))[0] ?? null
  if (v === 'clear' || v === 'none' || v === 'off') {
    if (!upcoming) return { problem: 'there’s no ACT retake date to clear' }
    return action('act_date', 'goals', upcoming.id, upcoming.title, `🎯 ACT retake ${day(upcoming.target_date)}: → <b>cleared</b> <i>(back to steady mode; kept in your archive)</i>`,
      { archived_at: '__now__', status: 'archived' })
  }
  if (!isDate(raw.date)) return { problem: 'when is the ACT retake? (e.g. “ACT retake is 12 Dec”)' }
  if (raw.date < today) return { problem: `${day(raw.date)} has passed: when is the retake?` }
  if (raw.date > addDays(today, 500)) return { problem: 'that retake date is more than a year away' }
  if (!env.grounded(raw.words)) return { problem: 'the retake date wasn’t in your words' }
  const n = daysBetween(today, raw.date)
  const left = n === 0 ? 'today' : n === 1 ? 'tomorrow' : `${n} days`
  if (upcoming) {
    if (upcoming.target_date === raw.date) return { problem: `your ACT retake is already ${day(raw.date)}` }
    return action('act_date', 'goals', upcoming.id, upcoming.title, `🎯 ACT retake: ${day(upcoming.target_date)} → <b>${day(raw.date)}</b> (${left})`,
      { target_date: raw.date, ...(rows.hasTestKind && upcoming.test_kind !== 'act' ? { test_kind: 'act' } : {}) })
  }
  const subjectId = rows.subject && !rows.subject.archived_at ? rows.subject.id : null
  return action('act_date', 'goals', null, 'ACT retake', `🎯 ACT retake: <b>${day(raw.date)}</b> (${left}) → countdown mode`, {
    title: 'ACT retake', kind: 'test', target_date: raw.date, subject_id: subjectId, priority: 'high',
    ...(rows.hasTestKind ? { test_kind: 'act', source: 'chat' } : {}), source_text: env.said.split('\n').at(-1)?.slice(0, 1000) ?? null,
  })
}

const normQ = (q: string) => { const m = q.trim().match(/^(?:q(?:uestion)?\s*)?(\d{1,2}[a-z]?)$/i); return m ? `Q${m[1].toUpperCase()}` : q.trim().slice(0, 40) || null }

function checkMiss(raw: PluginRawAction, rows: ActRows, today: string, env: CheckEnv): Check {
  if (rows.missing.includes('supabase/tracker.sql')) return { problem: sqlHint(['supabase/tracker.sql']) }
  const kv = kvOf(raw.value)
  const section = kv.section ? sectionWord(kv.section) : null
  if ((kv.do ?? '').toLowerCase() === 'redo') {
    const q = kv.question ? normQ(kv.question) : null
    const rule = (kv.rule ?? '').toLowerCase()
    let pick = rows.misses.filter((m) => (!section || missSection(m) === section))
    if (q) pick = pick.filter((m) => (m.question ?? '').toUpperCase() === q.toUpperCase())
    else if (rule) pick = pick.filter((m) => (m.rule ?? '').toLowerCase().includes(rule))
    else pick = dueMisses(rows.world, today, section ?? undefined)
    if (!pick.length) return { problem: q ? `no open ACT miss ${q}${section ? ` in ${SECTION_LABEL[section]}` : ''}` : 'no ACT misses are due for a redo' }
    const items = pick.slice(0, 30).map((m) => {
      const next = afterRedo(m.redoStage, today)
      return { id: m.id, from: { redo_stage: m.redoStage, review_on: m.reviewOn }, to: next.stage >= 2 ? { redo_stage: 2 } : { redo_stage: next.stage, review_on: next.reviewOn } }
    })
    const one = pick.length === 1 ? pick[0] : null
    const next = one ? afterRedo(one.redoStage, today) : null
    const line = one
      ? `🔁 ACT ${SECTION_LABEL[missSection(one) ?? 'english']} miss${one.question ? ` ${esc(one.question)}` : ''}${one.rule ? ` (${esc(one.rule)})` : ''}: redo ${one.redoStage + 1} done → ${next!.stage >= 2 ? '<b>done ✓</b>' : `next redo <b>${day(next!.reviewOn!)}</b>`}`
      : `🔁 ${pick.length} ACT misses redone → the next redo for each in a week (second redos: done ✓)`
    return action('act_miss', 'mistakes', pick[0].id, one?.question ?? 'ACT misses', line, { redo: items })
  }
  if (!section) return { problem: 'which section was the miss in (English, Maths, Reading or Science)?' }
  const rule = (kv.rule ?? '').slice(0, 300).trim()
  const what = (kv.what ?? kv.body ?? '').slice(0, 500).trim()
  if (!rule && !what) return { problem: 'what went wrong (and its rule)?' }
  const question = kv.question ? normQ(kv.question) : null
  const kind = kv.kind ? parseMistakeKind(kv.kind) : null
  const where = (kv.source ?? kv.where ?? '').slice(0, 150).trim()
  const review = firstRedo(today)
  const label = SECTION_LABEL[section]
  const line = `❌ ACT ${label} miss${question ? ` ${esc(question)}` : ''}: ${rule ? `rule <b>${esc(rule)}</b>` : ''}${rule && what ? ' — ' : ''}${what ? esc(what) : ''}${kind ? ` <i>(${kind})</i>` : ''} · redo ${day(review)}`
  return action('act_miss', 'mistakes', null, `ACT ${label} miss${question ? ` ${question}` : ''}`, line, {
    subject_id: rows.world.subjectId ?? null, body: what || rule, rule: rule || null, question, kind, source: `ACT ${label}${where ? ` · ${where}` : ''}`.slice(0, 200),
    logged_on: today, review_on: review, redo_stage: 0, source_text: env.said.split('\n').at(-1)?.slice(0, 1000) ?? null,
  })
}

const BOOK_WORDS: Record<string, BookRole> = {
  english: 'english', meltzer: 'english', reading: 'reading', maths: 'maths_gaps', math: 'maths_gaps', cp: 'maths_gaps', 'college panda': 'maths_gaps', maths_gaps: 'maths_gaps',
  advanced: 'maths_hard', maths_hard: 'maths_hard', critical: 'reading_extra', 'critical reader': 'reading_extra', reading_extra: 'reading_extra', flashcards: 'flashcards', anki: 'flashcards',
}

/** "ch 3" / "chapter 3" / "3" / "passage set 2" / "passage 2" → the live item. */
export function findItem(b: Programme, words: string): ProgrammeItem | null {
  const w = (words ?? '').toLowerCase().trim()
  if (!w) return null
  const items = itemsOf(b)
  const m = w.match(/^(?:(passage(?:\s+set)?|set|timed passage set)\s*)?(?:(?:chapter|chap|ch)\.?\s*)?(\d{1,3})$/)
  if (!m) return items.find((i) => i.title.toLowerCase() === w || i.title.toLowerCase().includes(w)) ?? null
  const n = Number(m[2])
  if (m[1]) return items.filter(isPassage)[n - 1] ?? null
  const chapters = items.filter((i) => !isPassage(i))
  return chapters.find((i) => new RegExp(`^chapter\\s+${n}\\b`, 'i').test(i.title)) ?? chapters[n - 1] ?? null
}

const STATUS_WORD: Record<ProgrammeItem['status'], string> = { todo: 'to do', doing: 'doing', done: 'done', skipped: 'skipped' }

function checkBook(raw: PluginRawAction, rows: ActRows, today: string, env: CheckEnv): Check {
  if (rows.missing.includes('supabase/tracker.sql')) return { problem: sqlHint(['supabase/tracker.sql']) }
  if (!rows.books.length) return { problem: 'your ACT books aren’t set up yet: say “set up ACT”' }
  const kv = kvOf(raw.value)
  const bw = (kv.book ?? '').toLowerCase()
  const role = BOOK_WORDS[bw] ?? (findBook(bw)?.book as BookRole | undefined) ?? null
  const b = env.ref?.kind === 'act_book' ? rows.books.find((x) => x.id === env.ref!.id) ?? null : role ? rows.books.find((x) => roleOf(x) === role) ?? null : null
  if (!b) return { problem: `which ACT book${kv.book ? ` (none called “${kv.book}”)` : ''}?` }
  const name = shortName(b), nameH = esc(name), emoji = emojiOf(b)
  const what = (kv.do ?? '').toLowerCase()
  const progPatch = (set: Record<string, unknown>, line: string) => action('act_book', 'programmes', b.id, b.name, line, { programmeId: b.id, programme: { id: b.id, set } })

  if (what === 'start') {
    if (b.mode !== 'optional') return { problem: `${name} is already in your plan` }
    return progPatch({ mode: 'in_order' }, `${emoji} ${nameH}: only if reading stalls → <b>in your plan now</b> (on Reading days)`)
  }
  if (what === 'stop') {
    if (roleOf(b) === 'reading_extra') {
      if (b.mode === 'optional') return { problem: `${name} is only used if your reading stalls already` }
      return progPatch({ mode: 'optional' }, `${emoji} ${nameH}: in your plan → <b>only if reading stalls</b>`)
    }
    if (b.status === 'stopped') return { problem: `${name} is already stopped` }
    return progPatch({ status: 'stopped', paused_until: null }, `${emoji} ${nameH}: → <b>stopped</b> <i>(say “resume ${nameH}” to bring it back)</i>`)
  }
  if (what === 'pause') {
    const until = raw.date && isDate(raw.date) && raw.date >= today && env.grounded(raw.words) ? raw.date : null
    if (b.status !== 'active' && !until) return { problem: `${name} is already ${b.status}` }
    return progPatch(until ? { status: 'active', paused_until: until } : { status: 'paused', paused_until: null }, `${emoji} ${nameH}: → <b>paused${until ? ` until ${day(until)}` : ''}</b>`)
  }
  if (what === 'resume') {
    if (b.status === 'active' && !(b.pausedUntil && b.pausedUntil >= today)) return { problem: `${name} is already on` }
    return progPatch({ status: 'active', paused_until: null }, `${emoji} ${nameH}: ${b.status === 'active' ? 'paused' : b.status} → <b>on again</b>`)
  }
  if (what === 'count' || what === 'add') {
    const kind = /passage|set/i.test(kv.kind ?? '') ? 'passage' : 'chapter'
    const same = itemsOf(b).filter((i) => (kind === 'passage') === isPassage(i))
    const n = Number(kv.count ?? (what === 'add' ? '1' : ''))
    if (!Number.isInteger(n) || n < 1 || n > 200) return { problem: `how many ${kind === 'passage' ? 'passage sets' : 'chapters'}?` }
    const target = what === 'add' ? same.length + n : n
    if (target === same.length) return { problem: `${name} already has ${plural(target, kind === 'passage' ? 'passage set' : 'chapter')}` }
    if (target > same.length) {
      if (target - same.length > 60) return { problem: 'that’s a lot of new chapters at once: add at most 60' }
      const add = newItems(b, rows, kind, target - same.length)
      if (!add) return { problem: `no room for more ${kind === 'passage' ? 'passage sets' : 'chapters'} in ${name}` }
      return action('act_book', 'programmes', b.id, b.name, `${emoji} ${nameH}: ${same.length} → <b>${plural(target, kind === 'passage' ? 'passage set' : 'chapter')}</b> (adds ${esc(add.map((x) => itemShort(x)).join(', '))})`, { programmeId: b.id, add })
    }
    const drop = same.slice(target)
    const busy = drop.find((i) => i.status !== 'todo' || i.result)
    if (busy) return { problem: `${name} ${itemShort(busy)} has progress, so it can’t go` }
    return action('act_book', 'programmes', b.id, b.name, `${emoji} ${nameH}: ${same.length} → <b>${plural(target, kind === 'passage' ? 'passage set' : 'chapter')}</b> (drops ${esc(drop.map((x) => itemShort(x)).join(', '))}; archived)`, { programmeId: b.id, archive: drop.map((i) => i.id) })
  }

  // no chapter named: done / skip / a score mean the book's next one; anything else needs to know which
  const words = kv.item ?? (raw.number ? String(raw.number) : '')
  const item = words ? findItem(b, words) : ['done', 'skip', 'score'].includes(what) ? nextBookItem(b) : null
  if (!item) return { problem: words ? `${name} has no ${words}` : ['done', 'skip', 'score'].includes(what) ? `${name} has nothing left to do` : `which ${name} chapter?` }
  const it = `${emoji} ${nameH} ${esc(itemShort(item))}`
  const itemPatch = (set: Record<string, unknown>, line: string) => action('act_book', 'programme_items', item.id, `${name} ${itemShort(item)}`, line, { programmeId: b.id, items: [{ id: item.id, set }] })
  const sc = kv.score != null ? Number(kv.score) : null, oo = kv.out_of != null ? Number(kv.out_of) : kv.outof != null ? Number(kv.outof) : null
  const full = /^(yes|true)$/i.test(kv.full ?? '')
  if ((sc != null || oo != null) && !(Number.isInteger(sc) && Number.isInteger(oo) && sc! >= 0 && oo! >= 1 && sc! <= oo! && oo! <= 500)) return { problem: 'that score doesn’t look right (e.g. 12/15)' }
  const scoreBits = sc != null ? { score: sc, out_of: oo } : {}

  switch (what) {
    case 'done': {
      if (item.status === 'done') return { problem: `${name} ${itemShort(item)} is already done` }
      return itemPatch({ status: 'done', done_on: today, ...scoreBits, ...(sc != null ? { result: `${sc}/${oo}` } : {}) },
        `${it}: ${STATUS_WORD[item.status]} → <b>done ✓</b>${sc != null ? ` (${sc}/${oo})` : ''}`)
    }
    case 'skip': {
      if (item.status === 'done' || item.status === 'skipped') return { problem: `${name} ${itemShort(item)} is already ${item.status}` }
      return itemPatch({ status: 'skipped', done_on: today, result: item.result ?? 'skipped' }, `${it}: ${STATUS_WORD[item.status]} → <b>skipped</b>`)
    }
    case 'reopen': {
      if (item.status === 'todo') return { problem: `${name} ${itemShort(item)} is still to do` }
      return itemPatch({ status: 'todo', done_on: null }, `${it}: ${STATUS_WORD[item.status]} → <b>to do again</b>`)
    }
    case 'score': {
      if (sc == null && !full) return { problem: 'what was the score? (e.g. 12/15)' }
      if (item.status === 'done' || item.status === 'skipped') return { problem: `${name} ${itemShort(item)} is already ${item.status}` }
      const s = sc != null ? `${sc}/${oo}` : 'full marks'
      if (b.mode === 'gaps_only' && item.status === 'todo') {
        if (full || sc === oo) return itemPatch({ status: 'skipped', done_on: today, ...scoreBits, result: `chapter test ${s} · full marks, chapter skipped` }, `${it}: chapter test ${s} → full marks: <b>chapter skipped</b>`)
        const dropped = oo! - sc!
        return itemPatch({ status: 'doing', done_on: null, ...scoreBits, result: `chapter test ${s} · do the chapter` }, `${it}: chapter test ${s} → <b>do the chapter</b> (dropped ${plural(dropped, 'mark')})`)
      }
      const result = item.status === 'doing' && item.result ? `${item.result.replace(/\s*·\s*do the chapter$/, '')} · after: ${s}` : s
      return itemPatch({ status: 'done', done_on: today, ...scoreBits, result: result.slice(0, 300) }, `${it}: ${STATUS_WORD[item.status]} → <b>done ✓</b> (${s})`)
    }
    case 'rename': {
      const title = (kv.title ?? '').trim().slice(0, 150)
      if (!title) return { problem: 'what should it be called?' }
      const num = item.title.match(/^(chapter|timed passage set)\s+(\d+)/i)
      const next = num && !new RegExp(`\\b${num[2]}\\b`).test(title) ? `${num[1][0].toUpperCase()}${num[1].slice(1).toLowerCase()} ${num[2]}: ${title}` : title
      if (next === item.title) return { problem: `it’s already called “${title}”` }
      return itemPatch({ title: next }, `${emoji} ${nameH}: “${esc(item.title)}” → “<b>${esc(next)}</b>”`)
    }
    case 'remove': {
      return action('act_book', 'programme_items', item.id, `${name} ${itemShort(item)}`, `${it}: → <b>removed</b> <i>(archived)</i>`, { programmeId: b.id, archive: [item.id] })
    }
    default:
      return { problem: `what about ${name} ${itemShort(item)}: done, skipped or a score?` }
  }
}

/** New items for a book: numbered on from its last chapter (or passage set), placed after it (positions are unique). */
function newItems(b: Programme, rows: ActRows, kind: 'chapter' | 'passage', n: number): { title: string; details: string | null; minutes: number | null; position: number }[] | null {
  const items = itemsOf(b)
  const same = items.filter((i) => (kind === 'passage') === isPassage(i))
  const used = new Set(rows.positions[b.id] ?? items.map((i) => i.position))
  const lastNo = Math.max(0, ...same.map((i) => Number(i.title.match(/(\d+)/)?.[1] ?? 0)))
  const tmpl = same.at(-1) ?? null
  const prefix = kind === 'passage' ? 'Timed passage set' : 'Chapter'
  const after = (tmpl ?? (kind === 'chapter' ? null : items.at(-1)))?.position ?? 0
  // chapters go before the first passage set (the Reading guide: method chapters first); everything else at the end
  const nextOther = kind === 'chapter' ? items.filter((i) => isPassage(i) && i.position > after).map((i) => i.position)[0] ?? null : null
  const out: { title: string; details: string | null; minutes: number | null; position: number }[] = []
  let pos = after
  for (let k = 1; k <= n; k++) {
    if (nextOther == null) { pos = Math.max(pos, ...used) + POSITION_STEP } else { pos++; while (used.has(pos)) pos++; if (pos >= nextOther) return null }
    used.add(pos)
    out.push({ title: `${prefix} ${lastNo + k}`, details: tmpl?.details ?? null, minutes: tmpl?.minutes ?? null, position: pos })
  }
  return out
}

/** Why the set-up card can't be made (already set up, SQL not run), or null. */
export const setupProblem = (rows: ActRows) => checkSetup(rows).problem ?? null

function checkSetup(rows: ActRows): Check {
  if (rows.missing.length) return { problem: sqlHint(rows.missing) }
  const subject = rows.subject
  const subjectMode = !subject ? 'new' : subject.archived_at ? 'restore' : 'ok'
  const category = rows.categories.find((c) => c.name.toLowerCase() === 'study') ?? rows.categories[0] ?? null
  if (subjectMode === 'new' && !category) return { problem: 'there’s no area (Study) to put the ACT subject in' }
  const roles = BOOKS.filter((def) => !rows.books.some((b) => roleOf(b) === def.role)).map((d) => d.role)
  const real = !rows.scores.some((s) => s.kind === 'real')
  if (subjectMode === 'ok' && !roles.length && !real) return { problem: 'ACT is already set up (/act shows it)' }
  const lines = [`🎯 <b>ACT set-up</b> (goal ${rows.world.goal})`]
  if (subjectMode !== 'ok') lines.push(`  📚 ACT subject${subjectMode === 'restore' ? ' (brought back from the archive)' : ' (new)'}`)
  for (const r of roles) {
    const d = bookDef(r)!
    lines.push(`  ${d.emoji} ${esc(d.name)}${d.guess ? `: ${esc(d.guess)} <i>(a guess)</i>` : ''} · ${esc(d.how)}`)
  }
  if (real) {
    const c = composite(LAST_REAL.english, LAST_REAL.maths, LAST_REAL.reading)
    lines.push(`  📝 Last real ACT: ${scoreText(LAST_REAL)} → composite ${c}`)
  }
  if (roles.some((r) => bookDef(r)!.guess)) lines.push('  <i>Chapter counts are guesses: fix them any time (“Meltzer has 18 chapters”).</i>')
  return action('act_setup', 'programmes', subject?.id ?? null, 'ACT set-up', lines.join('\n'), { subject: subjectMode, subjectId: subject?.id ?? null, categoryId: category?.id ?? null, roles, real })
}

// ---------------------------------------------------------------------------
// Applying (after ✅) and undoing (↩️): new rows are archived on undo, never deleted
// ---------------------------------------------------------------------------

const fill = (patch: Record<string, unknown>, now: string) => Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === '__now__' ? now : v]))
const pickKeys = (row: Record<string, unknown> | null, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row?.[k] ?? null]))
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

async function readRow(sb: SupabaseClient, table: string, id: string): Promise<Record<string, unknown>> {
  const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle()
  if (error || !data) throw new Error(`Couldn’t find it any more (${error?.message ?? 'not found'})`)
  return data as Record<string, unknown>
}
async function insert(sb: SupabaseClient, table: string, row: Record<string, unknown>): Promise<string> {
  const { data, error } = await sb.from(table).insert(row).select('id').single()
  if (error || !data) throw new Error(`Not saved: ${error?.message ?? 'unknown error'}`)
  return String(data.id)
}
async function update(sb: SupabaseClient, table: string, id: string, patch: Record<string, unknown>) {
  const { data, error } = await sb.from(table).update(patch).eq('id', id).select('id').single()
  if (error || !data) throw new Error(`Not saved: ${error?.message ?? 'unknown error'}`)
}
async function archiveAll(sb: SupabaseClient, table: string, ids: string[], now: string) {
  if (!ids.length) return
  const { error } = await sb.from(table).update({ archived_at: now }).in('id', ids).select('id')
  if (error) throw new Error(`Couldn’t archive: ${error.message}`)
}

export async function applyAct(sb: SupabaseClient, a: PluginAction, now: string, today: string): Promise<PluginApplied> {
  const op = a.op as Op
  const done = (id: string, before: Record<string, unknown> | null, after: Record<string, unknown>): PluginApplied => ({ op, table: a.table, id, title: a.title, before, after })
  if (op === 'act_score' || (op === 'act_miss' && !a.patch.redo) || (op === 'act_date' && !a.id)) {
    const table = op === 'act_score' ? 'act_scores' : op === 'act_miss' ? 'mistakes' : 'goals'
    const id = await insert(sb, table, a.patch)
    return done(id, null, { archived_at: null })
  }
  if (op === 'act_date') {
    const patch = fill(a.patch, now)
    const keys = Object.keys(patch)
    const before = pickKeys(await readRow(sb, 'goals', a.id!), keys)
    await update(sb, 'goals', a.id!, patch)
    return done(a.id!, before, pickKeys(await readRow(sb, 'goals', a.id!), keys))
  }
  if (op === 'act_miss') {
    const items = a.patch.redo as { id: string; from: Record<string, unknown>; to: Record<string, unknown> }[]
    const moved: { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[] = []
    try {
      for (const it of items) {
        const set = Number(it.to.redo_stage) >= 2 ? { redo_stage: 2, reviewed_at: now } : it.to
        const keys = ['redo_stage', 'review_on', 'reviewed_at']
        const before = pickKeys(await readRow(sb, 'mistakes', it.id), keys)
        await update(sb, 'mistakes', it.id, set)
        moved.push({ id: it.id, before, after: pickKeys(await readRow(sb, 'mistakes', it.id), keys) })
      }
    } catch (e) {
      for (const m of moved.reverse()) await sb.from('mistakes').update(m.before).eq('id', m.id)
      throw e
    }
    return done(items[0].id, null, { redo: moved })
  }
  if (op === 'act_book') return applyBook(sb, a, now, done)
  if (op === 'act_setup') return applySetup(sb, a, now, today, done)
  throw new Error(`“${a.op}” can’t be saved yet.`)
}

type Done = (id: string, before: Record<string, unknown> | null, after: Record<string, unknown>) => PluginApplied
type RowChange = { table: string; id: string; before: Record<string, unknown>; after: Record<string, unknown> }

async function applyBook(sb: SupabaseClient, a: PluginAction, now: string, done: Done): Promise<PluginApplied> {
  const p = a.patch as { programmeId?: string; programme?: { id: string; set: Record<string, unknown> }; items?: { id: string; set: Record<string, unknown> }[]; add?: { title: string; details: string | null; minutes: number | null; position: number }[]; archive?: string[] }
  const changes: RowChange[] = []
  const added: string[] = []
  const archived: string[] = []
  const table = a.table === 'programme_items' ? 'programme_items' : 'programmes'
  try {
    const set = async (t: string, id: string, patch: Record<string, unknown>) => {
      const keys = Object.keys(patch)
      const before = pickKeys(await readRow(sb, t, id), keys)
      await update(sb, t, id, patch)
      changes.push({ table: t, id, before, after: pickKeys(await readRow(sb, t, id), keys) })
    }
    if (p.programme) await set('programmes', p.programme.id, p.programme.set)
    for (const it of p.items ?? []) await set('programme_items', it.id, it.set)
    for (const it of p.add ?? []) added.push(await insert(sb, 'programme_items', { programme_id: p.programmeId ?? a.id, position: it.position, title: it.title, details: it.details, minutes: it.minutes, status: 'todo' }))
    if (p.archive?.length) {
      const { data, error } = await sb.from('programme_items').update({ archived_at: now }).in('id', p.archive).is('archived_at', null).select('id')
      if (error) throw new Error(`Couldn’t archive: ${error.message}`)
      archived.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
    }
  } catch (e) {
    // all or nothing: put back what this change did so far
    for (const c of changes.reverse()) await sb.from(c.table).update(c.before).eq('id', c.id)
    if (added.length) await sb.from('programme_items').update({ archived_at: now }).in('id', added)
    if (archived.length) await sb.from('programme_items').update({ archived_at: null }).in('id', archived)
    throw e
  }
  return { ...done(a.id ?? '', null, { programmeId: p.programmeId ?? null, changes, added, archived }), table }
}

async function applySetup(sb: SupabaseClient, a: PluginAction, now: string, today: string, done: Done): Promise<PluginApplied> {
  const p = a.patch as { subject: 'new' | 'restore' | 'ok'; subjectId: string | null; categoryId: string | null; roles: BookRole[]; real: boolean }
  const made = { subject: null as string | null, restored: null as string | null, programmes: [] as string[], items: [] as string[], scores: [] as string[] }
  // what's there NOW (another set-up card may have been applied since this one was shown): only make what's missing
  const [live, scoreRows] = await Promise.all([
    sb.from('programmes').select('name,notes,mode').eq('area', 'act').is('archived_at', null),
    sb.from('act_scores').select('kind,taken_on').is('archived_at', null).order('taken_on').limit(500),
  ])
  if (live.error || scoreRows.error) throw new Error(`Couldn’t read your ACT records: ${(live.error ?? scoreRows.error)!.message}`)
  const have = new Set(((live.data ?? []) as { name: string; notes: string | null; mode: Programme['mode'] }[]).map((x) => roleOf(x)))
  const roles = p.roles.filter((r) => !have.has(r))
  const scoresNow = (scoreRows.data ?? []) as { kind: string; taken_on: string }[]
  const real = p.real && !scoresNow.some((x) => x.kind === 'real')
  const { data: subjNow } = await sb.from('subjects').select('id,archived_at').ilike('name', 'act').maybeSingle()
  if (!roles.length && !real && subjNow && !subjNow.archived_at) throw new Error('ACT is already set up (/act shows it)')
  try {
    let subjectId = p.subjectId
    if (p.subject === 'new') {
      // another change may have made it since the card was shown
      const { data: found } = await sb.from('subjects').select('id,archived_at').ilike('name', 'act').maybeSingle()
      if (found && !found.archived_at) subjectId = found.id
      else if (found) { await update(sb, 'subjects', found.id, { archived_at: null }); made.restored = found.id; subjectId = found.id }
      else { subjectId = await insert(sb, 'subjects', { name: 'ACT', category_id: p.categoryId, sort_order: 99 }); made.subject = subjectId }
    } else if (p.subject === 'restore' && subjectId) {
      await update(sb, 'subjects', subjectId, { archived_at: null }); made.restored = subjectId
    }
    for (const role of roles) {
      const d = bookDef(role) as BookDef
      const id = await insert(sb, 'programmes', { name: d.name, area: 'act', subject_id: subjectId, per_week: d.perWeek, minutes: d.minutes, mode: d.mode, status: 'active', notes: bookNotes(d), sort_order: 100 + BOOKS.indexOf(d) })
      made.programmes.push(id)
      if (d.items.length) {
        const { data, error } = await sb.from('programme_items').insert(d.items.map((it, k) => ({ programme_id: id, position: (k + 1) * POSITION_STEP, title: it.title, details: it.details, minutes: it.minutes, status: 'todo' }))).select('id')
        if (error) throw new Error(`Chapters not saved: ${error.message}`)
        made.items.push(...((data ?? []) as { id: string }[]).map((r) => r.id))
      }
    }
    if (real) {
      // its real date isn't known: the day before his earliest score (so it never looks newer than his practice), else today
      const earliest = scoresNow[0]?.taken_on ?? null
      const takenOn = earliest ? addDays(earliest, -1) : today
      made.scores.push(await insert(sb, 'act_scores', { taken_on: takenOn, kind: 'real', ...LAST_REAL, composite: composite(LAST_REAL.english, LAST_REAL.maths, LAST_REAL.reading),
        notes: earliest
          ? 'Your last real ACT (from your brief). Its date isn’t known, so it’s dated the day before your earliest score here.'
          : 'Your last real ACT (from your brief). Its date isn’t known, so it’s dated the day ACT was set up.',
        source_text: 'set up ACT' }))
    }
  } catch (e) {
    await archiveAll(sb, 'programme_items', made.items, now).catch(() => null)
    await archiveAll(sb, 'programmes', made.programmes, now).catch(() => null)
    await archiveAll(sb, 'act_scores', made.scores, now).catch(() => null)
    if (made.subject || made.restored) await sb.from('subjects').update({ archived_at: now }).eq('id', (made.subject ?? made.restored)!)
    throw e
  }
  return done(made.programmes[0] ?? made.subject ?? made.restored ?? p.subjectId ?? '', null, made)
}

export async function undoAct(sb: SupabaseClient, a: PluginApplied, _today: string): Promise<'undone' | 'skipped'> {
  const now = new Date().toISOString()
  const op = a.op as Op
  if (op === 'act_score' || (op === 'act_miss' && !a.after.redo) || (op === 'act_date' && !a.before)) {
    const table = op === 'act_score' ? 'act_scores' : op === 'act_miss' ? 'mistakes' : 'goals'
    const row = await readRow(sb, table, a.id)
    if (row.archived_at) return 'skipped'
    if (op === 'act_miss' && (Number(row.redo_stage ?? 0) !== 0 || row.reviewed_at)) return 'skipped'   // redone since
    await update(sb, table, a.id, op === 'act_date' ? { archived_at: now, status: 'archived' } : { archived_at: now })
    return 'undone'
  }
  if (op === 'act_date') {
    const row = await readRow(sb, 'goals', a.id)
    if (Object.keys(a.after).some((k) => !same(row[k], a.after[k]))) return 'skipped'
    await update(sb, 'goals', a.id, a.before ?? {})
    return 'undone'
  }
  if (op === 'act_miss') {
    const moved = a.after.redo as { id: string; before: Record<string, unknown>; after: Record<string, unknown> }[]
    const rows = await Promise.all(moved.map((m) => readRow(sb, 'mistakes', m.id)))
    if (moved.some((m, i) => Object.keys(m.after).some((k) => !same(rows[i][k], m.after[k])))) return 'skipped'
    for (const m of moved) await update(sb, 'mistakes', m.id, m.before)
    return 'undone'
  }
  if (op === 'act_book') {
    const { changes, added, archived } = a.after as { changes: RowChange[]; added: string[]; archived: string[] }
    const rows = await Promise.all(changes.map((c) => readRow(sb, c.table, c.id)))
    if (changes.some((c, i) => Object.keys(c.after).some((k) => !same(rows[i][k], c.after[k])))) return 'skipped'
    if (added.length) {
      const { data } = await sb.from('programme_items').select('id,status,result,archived_at').in('id', added)
      if (((data ?? []) as { status: string; result: string | null; archived_at: string | null }[]).some((r) => r.status !== 'todo' || r.result || r.archived_at)) return 'skipped'
    }
    for (const c of [...changes].reverse()) await update(sb, c.table, c.id, c.before)
    await archiveAll(sb, 'programme_items', added, now)
    if (archived.length) await sb.from('programme_items').update({ archived_at: null }).in('id', archived).select('id')
    return 'undone'
  }
  if (op === 'act_setup') {
    const m = a.after as { subject: string | null; restored: string | null; programmes: string[]; items: string[]; scores: string[] }
    // anything done in the books since (a chapter ticked) means it stays: undo it by hand
    if (m.items.length) {
      const { data } = await sb.from('programme_items').select('status,result').in('id', m.items)
      if (((data ?? []) as { status: string; result: string | null }[]).some((r) => r.status !== 'todo' || r.result)) return 'skipped'
    }
    if (m.programmes.length) {
      // …or a book paused, stopped or switched on since
      const { data } = await sb.from('programmes').select('name,notes,mode,status,paused_until,archived_at').in('id', m.programmes)
      const rowsNow = (data ?? []) as { name: string; notes: string | null; mode: Programme['mode']; status: string; paused_until: string | null; archived_at: string | null }[]
      if (rowsNow.some((p) => p.archived_at || p.status !== 'active' || p.paused_until || p.mode !== bookDef(roleOf(p))?.mode)) return 'skipped'
    }
    await archiveAll(sb, 'programme_items', m.items, now)
    await archiveAll(sb, 'programmes', m.programmes, now)
    await archiveAll(sb, 'act_scores', m.scores, now)
    const subj = m.subject ?? m.restored
    if (subj) await update(sb, 'subjects', subj, { archived_at: now })
    return 'undone'
  }
  return 'skipped'
}

// ---------------------------------------------------------------------------
// Views: /act, the brain's snapshot, "Next: …" after ✅
// ---------------------------------------------------------------------------

/**
 * Holidays or a school week, for the "today" line in /act and the brain: the `holidays` setting (item 5: "2026-10-17..2026-11-01,
 * …", its default once merged) if there is one, else a school week. Today (lib/today) passes its own DayContext to actPicks.
 */
export function guessDay(planning: unknown, today: string): DayContext {
  const fromSettings = (moreSettings(planning) as unknown as Record<string, unknown>).holidays
  const raw = fromSettings ?? (planning && typeof planning === 'object' ? (planning as Record<string, unknown>).holidays : null) ?? null
  const ranges: [string, string][] = []
  const add = (a: unknown, b: unknown) => { if (typeof a === 'string' && typeof b === 'string' && isDate(a) && isDate(b)) ranges.push([a, b]) }
  if (typeof raw === 'string') for (const m of raw.matchAll(/(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to|–|-)\s*(\d{4}-\d{2}-\d{2})/g)) add(m[1], m[2])
  else if (Array.isArray(raw)) for (const r of raw) if (r && typeof r === 'object') { const o = r as Record<string, unknown>; add(o.from ?? o.start, o.to ?? o.end) }
  const holiday = ranges.some(([a, b]) => a <= today && today <= b)
  return { date: today, dow: isoDow(today), mode: holiday ? 'half_term' : 'school', studyMinutes: 0 }
}

const dows = (d: number[]) => d.map((x) => DOW_NAMES[x - 1].slice(0, 3)).join(', ')

function modeLine(rows: ActRows, today: string): string {
  const w = rows.world, s = w.settings!
  const m = actMode(w)
  if (m.mode === 'countdown') {
    const top = m.daysLeft <= 21 ? 'top priority now' : `top priority from ${day(m.topFrom)}`
    return `🔥 Countdown: retake <b>${day(m.date)}</b> · ${m.daysLeft === 0 ? 'today' : m.daysLeft === 1 ? 'tomorrow' : `${m.daysLeft} days`} (${top}). Holidays: ${Math.round(s.countdownHolidayMin / 6) / 10} h a day, full timed tests ${s.mockDows.map((d) => DOW_NAMES[d - 1]).join(' + ')} (reviewed straight after). School weeks: daily timed English + every miss against its rule · Reading / Maths alternate · mock on ${DOW_NAMES[s.mockDows[0] - 1]}s · light day before`
  }
  // a retake that has passed with no real score logged since: ask for it (once it's logged, this goes)
  const past = rows.goals.filter((g) => g.target_date < today).sort((a, b) => a.target_date.localeCompare(b.target_date)).at(-1)
  const logged = past && rows.scores.some((x) => x.kind === 'real' && x.takenOn >= past.target_date)
  return `Steady (no retake date): holidays ${s.halfTermMin} min a day + a full test on ${DOW_NAMES[s.fullTestDow - 1]}s · school weeks ${s.schoolMin} min × ${s.schoolDays.length} (${dows(s.schoolDays)})${s.flashMin ? ` · flashcards ${s.flashMin} min daily` : ''}${past && !logged ? `\n<i>Your retake on ${day(past.target_date)} has passed: send the real scores (“real ACT: E.. M.. R.. S..”).</i>` : ''}`
}

const trend = (scores: ActScore[]) => scores.slice(-5).map((s) => `${shortDate(s.takenOn)} ${s.kind === 'section' ? 'section' : s.kind} ${s.composite != null ? `${s.composite} ` : ''}(${scoreText(s)})`).join(' → ')

/** /act: the mode, the score trend, today's ACT, the next item per book and the misses to review. */
export function actView(rows: ActRows, today: string): { html: string; setup: boolean } {
  const w = rows.world
  if (!rows.books.length && !w.retake) {
    return { setup: true, html: `🎯 <b>ACT</b> isn’t set up yet. One tap adds your 5 books (chapter counts are guesses you can fix), the daily ${w.settings?.flashMin ?? 10}-min grammar flashcards and your last real score (34: ${scoreText(LAST_REAL)}). Nothing is saved until you tap ✅.` }
  }
  const lines = [`🎯 <b>ACT</b> · goal ${w.goal}`, modeLine(rows, today)]
  if (!rows.books.length) lines.push('<i>Your ACT books aren’t set up yet: one tap below adds them (nothing is saved before ✅).</i>')
  if (w.scores.length) lines.push(`📈 ${esc(trend(w.scores))}`)
  const weak = weakest(w.scores, w.goal)
  if (weak && weak.gap > 0) lines.push(`Weakest: <b>${SECTION_LABEL[weak.section]}</b> ${weak.score} vs ${w.goal}`)
  const pick = actPicks(w, guessDay(rows.planning, today))[0]
  if (pick) lines.push(`Today: <b>${esc(pick.title)}</b> · ${pick.minutes} min`, `<i>${esc(pick.open)}</i>`)
  else if (w.doneToday.includes('act:day')) lines.push('Today: ACT done ✓')
  if (rows.books.length) lines.push('', '📚 <b>Next</b>', ...inOrder(rows.books).map((b) => `• ${emojiOf(b)} ${esc(bookLine(w, b))}`))
  if (w.misses.length) {
    const due = dueMisses(w, today)
    lines.push('', `❌ Misses: ${w.misses.length} open${due.length ? ` · ${due.length} due for a redo` : ''} (${esc(rulesOf(due.length ? due : w.misses).slice(0, 4).join(', '))})`)
  }
  lines.push('', '<i>“ACT practice: E33 M35 R34” · “ACT miss: english Q12 comma splice — …” · “finished Meltzer chapter 4” · “ACT retake is 12 Dec”</i>')
  return { setup: !rows.books.length, html: lines.join('\n') }
}

/** The brain's "ACT" section: compact, with refs AC1… for the books. */
export function actSnapshot(rows: ActRows, today: string): SnapshotPart {
  const w = rows.world
  const refs: SnapshotPart['refs'] = []
  const lines: string[] = []
  if (rows.missing.length) lines.push(`(not ready: ${sqlHint(rows.missing)})`)
  if (!rows.books.length && !w.retake) lines.push(`Not set up yet: act_setup makes the ACT subject, his 5 books, the daily flashcards and his last real score (${scoreText(LAST_REAL)} = 34).`)
  const m = actMode(w)
  lines.push(m.mode === 'countdown' ? `Mode: countdown, retake ${m.date} (${m.daysLeft} days left; tier 2 from ${m.topFrom})` : `Mode: steady (no retake date)`)
  if (w.scores.length) lines.push(`Scores (last 5, oldest first): ${w.scores.slice(-5).map((s) => `${s.takenOn} ${s.kind} ${scoreText(s)}${s.composite != null ? ` = ${s.composite}` : ''}`).join(' · ')}`)
  const weak = weakest(w.scores, w.goal)
  if (weak) lines.push(`Weakest: ${SECTION_LABEL[weak.section]} ${weak.score} vs goal ${w.goal}`)
  rows.books.forEach((b, i) => {
    const ref = `AC${i + 1}`
    refs.push([ref, { kind: 'act_book', id: b.id, title: b.name, status: b.status, deadline: null }])
    lines.push(`${ref} | ${b.name} | ${bookLine(w, b)}`)
  })
  if (w.misses.length) lines.push(`Misses: ${w.misses.length} open, ${dueMisses(w, today).length} due for a redo (rules: ${rulesOf(w.misses).slice(0, 6).join(', ')})`)
  const pick = actPicks(w, guessDay(rows.planning, today))[0]
  if (pick) lines.push(`Today's ACT: ${pick.title} (${pick.minutes} min): ${pick.open}`)
  else if (w.doneToday.includes('act:day')) lines.push("Today's ACT: done ✓")
  return { sections: [{ title: `ACT (goal ${w.goal} composite = mean of English, Maths, Reading; Science separate)`, lines }], refs }
}

/** After ✅: one "Next: …" line for what changed. */
export function actNext(rows: ActRows, applied: PluginApplied[], today: string): string | null {
  const w = rows.world
  const out: string[] = []
  for (const a of applied) {
    if (a.op === 'act_book') {
      const b = rows.books.find((x) => x.id === (a.after.programmeId ?? a.id))
      if (b) out.push(`Next: ${emojiOf(b)} ${esc(bookLine(w, b))}`)
    } else if (a.op === 'act_score') {
      const weak = weakest(w.scores, w.goal)
      if (weak && weak.gap > 0) out.push(`Focus now: <b>${SECTION_LABEL[weak.section]}</b> (${weak.score} vs ${w.goal}): it gets the most ACT days.`)
    } else if (a.op === 'act_date') {
      out.push(actMode(w).mode === 'countdown' ? modeLine(rows, today) : `Back to steady mode: ${modeLine(rows, today).replace(/^Steady \(no retake date\): /, '')}`)
    } else if (a.op === 'act_setup') {
      const pick = actPicks(w, guessDay(rows.planning, today))[0]
      out.push(pick ? `Today: <b>${esc(pick.title)}</b> · ${pick.minutes} min. /act shows the plan.` : '/act shows the plan.')
    } else if (a.op === 'act_miss' && !a.after.redo) {
      out.push(`${plural(w.misses.length, 'ACT miss')} open · each comes back in your ACT sessions until redone twice.`)
    }
  }
  return [...new Set(out)].join('\n') || null
}

/** The setup action for the fast path / the /act button. */
export const SETUP_RAW: PluginRawAction = { op: 'act_setup', ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }
export const raw = (op: Op, value: string, extra: Partial<PluginRawAction> = {}): PluginRawAction => ({ ...SETUP_RAW, op, value, ...extra })

/** Programmes in a book's role order (for /act). */
export const inOrder = (books: Programme[]) => [...books].sort((x, y) => BOOKS.findIndex((b) => b.role === roleOf(x)) - BOOKS.findIndex((b) => b.role === roleOf(y)))
