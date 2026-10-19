// The study tracker's changes by chat (plans/contracts.md §3.7): each trk_ op's check, from what the brain or a fast
// path sent (value = "key=value; …") to one card line "before → after" (HTML-escaped) and the row steps that apply it.
// Steps are generic (update one row / insert one row), so apply and undo (lib/tracker/bot-apply.ts) are the same for
// every op: an update is put back only if nothing changed it since; a new row is archived, never deleted.
// Uses the tracker's rules (lib/tracker/rules.ts) for colours, reviews, steps and redos. Pure: no database, no clock.
import { addDays, daysBetween, dowShort, shortDate, weekStartISO } from '../time'
import type { CheckEnv, PluginAction, PluginRawAction, PluginRef } from '../telegram/plugin-types'
import { CODE_RE, UNTIL_I_SAY_DAYS, editDistance, findTopic, kv, norm } from './bot-parse'
import type { Subject, TrackerData } from './bot-data'
import { afterRedo, colourFromPct, firstRedo, nextReview, parseMistakeKind, pctOf, stepAfter } from './rules'
import type { AttemptWhat, Colour, PlanRule, Programme, ProgrammeItem, TestKind, TrackerMistake, TrackerTest, TrackerTopic } from './types'
import { COLOUR_DOT, STEPS } from './types'
import { targetLabel } from './rulesets'
import { nextItem } from './programmes'

export const TRK_OPS = ['trk_colour', 'trk_log', 'trk_mistake', 'trk_redo', 'trk_attempt', 'trk_test', 'trk_topic', 'trk_programme', 'trk_item', 'trk_rule'] as const
export type TrkOp = (typeof TRK_OPS)[number]

export const NOW = '__now__'
/** One row change: update a row (put back on undo if unchanged since) or insert one (archived on undo). `$0` in a value =
 *  the id of the row inserted by step 0 (a programme's items). */
export type Step = { kind: 'update'; table: string; id: string; set: Record<string, unknown> } | { kind: 'insert'; table: string; row: Record<string, unknown> }
export type TrkPatch = { steps: Step[]; next?: NextHint }
/** What the "Next: …" line after ✅ is about. */
export type NextHint = { topicId?: string; programmeId?: string; mistakeId?: string; testId?: string; rule?: string }

type Rows = TrackerData & { tasks?: { id: string; title: string; archived_at: string | null; status: string; archive_reason: string | null }[] }
type Result = { action?: PluginAction; problem?: string }

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
export const dot = (c: Colour) => COLOUR_DOT[c]
export const label = (t: Pick<TrackerTopic, 'code' | 'name'>) => `${t.code ? `${t.code} ` : ''}${t.name}`
export const isMathsTopic = (t: Pick<TrackerTopic, 'subject'>) => /^(further )?maths$/i.test(t.subject)
export const stepName = (n: number) => STEPS[Math.max(0, Math.min(STEPS.length - 1, n))]
const ISO = /^\d{4}-\d{2}-\d{2}$/
const validISO = (s: string) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

// ---------------------------------------------------------------------------
// Refs: the snapshot's order (TS1, MK1, PG1, RL1, TP1) and the fast paths' own ("topic:<id>", "test:<id>", a code)
// ---------------------------------------------------------------------------

export const snapTests = (d: TrackerData) => [...d.tests].sort((a, b) => (a.date ?? '9').localeCompare(b.date ?? '9')).slice(0, 15)
export const snapMistakes = (d: TrackerData) => [...d.mistakes].sort((a, b) => a.reviewOn.localeCompare(b.reviewOn)).slice(0, 20)
/** Study programmes (STEP…): ACT's books (area 'act') are the act plug-in's, with its own refs and act_book. */
export const studyProgrammes = (d: Pick<TrackerData, 'programmes'>) => d.programmes.filter((p) => p.area !== 'act')
export const snapProgrammes = (d: TrackerData) => studyProgrammes(d).slice(0, 12)
export const snapRules = (d: TrackerData) => d.rules.filter((r) => r.endsOn >= d.today).sort((a, b) => a.endsOn.localeCompare(b.endsOn)).slice(0, 12)
export const snapCodeless = (d: TrackerData) => d.topics.filter((t) => !t.code)

const byPrefix = <T,>(ref: string, prefix: string, list: T[]): T | null => {
  const m = ref.match(new RegExp(`^${prefix}(\\d{1,3})$`, 'i'))
  return m ? list[Number(m[1]) - 1] ?? null : null
}
const byId = <T extends { id: string },>(ref: string, prefix: string, list: T[]): T | null => {
  const m = ref.match(new RegExp(`^${prefix}:([0-9a-f-]{36})$`, 'i'))
  return m ? list.find((x) => x.id === m[1]) ?? null : null
}
const refId = (env: CheckEnv, kinds: string[]) => (env.ref && kinds.includes(env.ref.kind) ? env.ref.id : null)

export function topicFor(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): TrackerTopic | null {
  const id = refId(env, ['trk_topic', 'topic'])
  if (id) return d.topics.find((t) => t.id === id) ?? null
  const ref = (raw.ref ?? '').trim()
  const words = ref || k.topic || k.code || ''
  if (!words) return null
  const hit = byId(words, 'topic', d.topics) ?? byPrefix(words, 'TP', snapCodeless(d))
  if (hit) return hit
  const m = findTopic(d.topics, words, d.today)
  return m && 'hit' in m ? m.hit : null
}

/** "HT2", "FM HT2 test", "the mechanics test" → the one live test whose name has his distinctive words. */
export function findTest(tests: TrackerTest[], words: string): TrackerTest | null {
  const GENERIC = new Set(['test', 'tests', 'the', 'my', 'a', 'on', 'for', 'in', 'of', 'practice', 'paper', 'exam', 'real', 'actual', 'result', 'score', 'mock', 'timed', 'diagnostic', 'booklet', 'maths', 'math', 'further', 'physics'])
  const toks = (s: string) => norm(s.replace(/further maths?/gi, 'fm')).split(' ').filter(Boolean)
  const said = toks(words).filter((w) => !GENERIC.has(w))
  const subj = toks(words).filter((w) => w === 'fm' || w === 'physics' || w === 'maths' || w === 'math')
  if (!said.length) return null
  const scored = tests.map((t) => {
    const title = new Set([...toks(t.title), ...(t.subject ? toks(t.subject) : [])])
    const hits = said.filter((w) => title.has(w) || [...title].some((x) => x.length >= 5 && w.length >= 5 && editDistance(x, w, 1) <= 1)).length
    const subjOk = subj.every((w) => title.has(w === 'math' ? 'maths' : w) || (w === 'maths' && title.has('fm')))
    return { t, hits, subjOk }
  }).filter((x) => x.hits === said.length && x.subjOk)
  return scored.length === 1 ? scored[0].t : null
}

function testFor(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): TrackerTest | null {
  const id = refId(env, ['trk_test', 'goal'])
  if (id) return d.tests.find((t) => t.id === id) ?? null
  const ref = (raw.ref ?? '').trim() || k.test || ''
  if (!ref) return null
  return byId(ref, 'test', d.tests) ?? byPrefix(ref, 'TS', snapTests(d)) ?? findTest(d.tests, ref)
}

function mistakeFor(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): TrackerMistake | TrackerMistake[] | null {
  const id = refId(env, ['trk_mistake', 'mistake'])
  if (id) return d.mistakes.find((m) => m.id === id) ?? null
  const ref = (raw.ref ?? '').trim()
  const hit = ref ? byId(ref, 'mistake', d.mistakes) ?? byPrefix(ref, 'MK', snapMistakes(d)) : null
  if (hit) return hit
  // by code / topic and question ("PC1-03 Q3b")
  const q = (k.question ?? '').replace(/\s+/g, '').toLowerCase()
  const topic = k.code || k.topic ? topicFor({ ...raw, ref: '' }, { ...env, ref: undefined }, d, k) : null
  const list = d.mistakes.filter((m) => (!q || (m.question ?? '').replace(/\s+/g, '').toLowerCase() === q)
    && (!topic || m.topicId === topic.id || (m.code ?? '').toUpperCase() === (topic.code ?? '#').toUpperCase())
    && (!(k.code && !topic) || (m.code ?? '').toUpperCase() === k.code.toUpperCase()))
  if (!q && !topic && !k.code) return null
  return list.length === 1 ? list[0] : list.length ? list : null
}

function programmeFor(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Programme | null {
  const id = refId(env, ['trk_prog'])
  if (id) return d.programmes.find((p) => p.id === id) ?? null
  const ref = (raw.ref ?? '').trim() || k.programme || k.name || ''
  if (!ref) return null
  const hit = byId(ref, 'prog', d.programmes) ?? byPrefix(ref, 'PG', snapProgrammes(d))
  if (hit) return hit
  return findProgramme(studyProgrammes(d), ref)
}

/** "STEP", "the step programme", "meltzer" → the one programme whose name starts with (or holds) his words. */
export function findProgramme(list: Programme[], words: string): Programme | null {
  const n = norm(words).replace(/^(the|my) /, '').replace(/ (programme|program|course|series)$/, '')
  if (!n) return null
  const starts = list.filter((p) => norm(p.name) === n || norm(p.name).startsWith(`${n} `) || norm(p.name).startsWith(n))
  if (starts.length === 1) return starts[0]
  const inside = list.filter((p) => n.length >= 4 && norm(p.name).split(' ').includes(n))
  return inside.length === 1 ? inside[0] : null
}

function ruleFor(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): PlanRule | null {
  const id = refId(env, ['trk_rule'])
  if (id) return d.rules.find((r) => r.id === id) ?? null
  const ref = (raw.ref ?? '').trim()
  const hit = ref ? byId(ref, 'rule', d.rules) ?? byPrefix(ref, 'RL', snapRules(d)) : null
  if (hit) return hit
  const live = d.rules.filter((r) => r.endsOn >= d.today)
  if (k.target) { const t = live.filter((r) => r.target.toLowerCase() === normTarget(k.target, d.subjects)?.toLowerCase() && (!k.kind || r.kind === k.kind)); if (t.length === 1) return t[0] }
  return null
}

// ---------------------------------------------------------------------------
// Words for rules, tests and steps
// ---------------------------------------------------------------------------

const MATHS = ['Maths', 'Further Maths']
/** "maths" → "Maths,Further Maths"; "physics" → "Physics"; a subject's name → itself; null if not a subject. */
export function subjectList(words: string, subjects: Subject[]): string[] | null {
  const parts = words.split(/\s*(?:,|\+|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean)
  const out: string[] = []
  for (const p of parts) {
    const n = norm(p)
    if (n === 'maths' || n === 'math') { out.push(...MATHS.filter((m) => subjects.some((s) => s.name === m))); continue }
    if (n === 'fm') { out.push('Further Maths'); continue }
    const s = subjects.find((x) => norm(x.name) === n)
    if (!s) return null
    out.push(s.name)
  }
  return out.length ? [...new Set(out)] : null
}

const TARGET_WORDS: Record<string, string> = {
  act: 'act', ahead: 'ahead', 'getting ahead': 'ahead', 'learning ahead': 'ahead', 'new topics': 'ahead', stretch: 'stretch', reviews: 'reviews', review: 'reviews', physics: 'physics',
  mistakes: 'mistakes', 'mistake redos': 'mistakes', redos: 'mistakes', tests: 'tests', 'test prep': 'tests', fix: 'fix', fixing: 'fix', current: 'current', 'current topics': 'current',
  old: 'old', 'old topics': 'old', programmes: 'programmes',
}
/** A rule's target in the contract's words (plans/contracts.md §3.6), or null if it isn't one. */
export function normTarget(raw: string, subjects: Subject[]): string | null {
  const t = raw.trim()
  const fixed = TARGET_WORDS[norm(t)]
  if (fixed) return fixed
  const m = t.match(/^(subject|subjects|programme|test|topic):\s*(.+)$/i)
  if (m) {
    const kind = m[1].toLowerCase()
    if (kind === 'programme' || kind === 'test' || kind === 'topic') return `${kind}:${m[2].trim()}`
    const list = subjectList(m[2], subjects)
    return list ? (list.length === 1 && kind === 'subject' ? `subject:${list[0]}` : `subjects:${list.join(',')}`) : null
  }
  const list = subjectList(t, subjects)
  return list ? (list.length === 1 ? `subject:${list[0]}` : `subjects:${list.join(',')}`) : null
}

/** "pause getting ahead", "ACT top priority", "Maths + Further Maths + Physics max 45 min/day" (targets in the planner's words). */
export function ruleLabel(r: Pick<PlanRule, 'kind' | 'target' | 'minutes' | 'words'>): string {
  const what = targetLabel(r.target)
  if (r.kind === 'pause') return `pause ${what}`
  if (r.kind === 'boost') return `${what} top priority`
  if (r.kind === 'cap') return `${what} max ${r.minutes ?? '?'} min/day`
  return clip(r.words, 80)
}
export const ruleSpan = (r: Pick<PlanRule, 'startsOn' | 'endsOn'>, today: string) =>
  r.startsOn > today ? `${day(r.startsOn)} – ${day(r.endsOn)}` : r.endsOn === today ? 'today only' : `until ${day(r.endsOn)}`

const WHAT_WORDS: Record<string, string> = { textbook: 'textbook section', exercise: 'textbook exercise', mixed: 'mixed exercise', bicen: 'Bicen set', integral: 'Integral assessment', stretch: 'stretch', booklet: 'booklet Qs', pmt: 'PMT Qs', review: 'review', diagnostic: 'diagnostic' }
export const LOG_WHATS = Object.keys(WHAT_WORDS)
/** Reports whose score is on fresh questions, so it sets the colour (textbook practice and stretch don't). */
const COLOUR_FROM = new Set(['mixed', 'bicen', 'integral', 'booklet', 'pmt', 'review', 'diagnostic'])

export function logWhat(w: string): string | null {
  const n = norm(w)
  if (!n) return null
  if (LOG_WHATS.includes(n)) return n
  if (/^(textbook exercise|exercise|ex|fluency|textbook qs|textbook questions)$/.test(n)) return 'exercise'
  if (/^(textbook|book|worked examples|learn|learnt|reading)$/.test(n)) return 'textbook'
  if (/^(mixed exercise|mixed|red blue|red and blue|chapter check)$/.test(n)) return 'mixed'
  if (/^(bicen set|bicen questions|bicen qs|exam questions|exam qs)$/.test(n)) return 'bicen'
  if (/^(integral assessment|integral test|topic assessment|integral further)$/.test(n)) return 'integral'
  if (/^(madas|step|hardest|bicen hardest|stretch questions)$/.test(n)) return 'stretch'
  if (/^(booklet|teacher booklet|school booklet)$/.test(n)) return 'booklet'
  if (/^(pmt|pmt questions|pmt qs|caie)$/.test(n)) return 'pmt'
  if (/^(retrieval|recap|revision)$/.test(n)) return 'review'
  return null
}

const ATTEMPTS: AttemptWhat[] = ['diagnostic', 'booklet', 'timed', 'paper', 'real', 'other']
export function attemptWhat(w: string): AttemptWhat | null {
  const n = norm(w)
  if (!n) return null
  if ((ATTEMPTS as string[]).includes(n)) return n as AttemptWhat
  if (/^(practice|timed practice|practice paper|practice test|timed paper)$/.test(n)) return 'timed'
  if (/^(past paper|mock|mock paper)$/.test(n)) return 'paper'
  if (/^(actual|the test|real test|result|results|mark|marks|got back)$/.test(n)) return 'real'
  if (/^(booklet|teacher booklet)$/.test(n)) return 'booklet'
  return null
}
const ATTEMPT_WORDS: Record<AttemptWhat, string> = { diagnostic: 'diagnostic', booklet: 'booklet', timed: 'timed practice', paper: 'past paper', real: 'the real test', other: 'score' }

const TEST_KINDS: TestKind[] = ['test', 'consolidation', 'paper', 'mock']
const testKindOf = (w: string): TestKind | null => { const n = norm(w); return (TEST_KINDS as string[]).includes(n) ? (n as TestKind) : n === 'past paper' ? 'paper' : n === 'exam' ? 'test' : null }

/** "30", "30-60", "30–60 min" → [30, 60] (5–240). */
export function perDay(w: string): [number, number | null] | null {
  const m = w.match(/^(\d{1,3})(?:\s*(?:-|–|to)\s*(\d{1,3}))?/)
  if (!m) return null
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : null
  if (a < 5 || a > 240 || (b !== null && (b < a || b > 240))) return null
  return [a, b]
}
const intIn = (w: string | undefined, lo: number, hi: number) => { if (!w) return null; const n = Number(w.replace(/[^\d.]/g, '')); return Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : null }

/** A date from the brain/fast path: a real date, in his words (for the AI's), and not in the past unless allowed. */
function dateOk(dateStr: string, env: CheckEnv, raw: PluginRawAction, opts: { past?: boolean } = {}): string | null {
  const s = (dateStr ?? '').trim()
  if (!validISO(s)) return null
  if (!opts.past && s < env.today) return null
  if (!env.grounded(raw.words ?? '')) return null
  return s
}

/** His words for this change: the value's words=, else the message he's sending now. */
const hisWords = (env: CheckEnv, k: Record<string, string>) => clip((k.words || env.said.split('\n').filter(Boolean).at(-1) || '').trim(), 300)

const act = (op: TrkOp, table: string, id: string | null, title: string, line: string, steps: Step[], next?: NextHint): Result =>
  ({ action: { op, table, id, title, line, patch: { steps, ...(next ? { next } : {}) } satisfies TrkPatch } })

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export function checkTrk(op: string, raw: PluginRawAction, rows: unknown, env: CheckEnv): Result {
  const d = rows as Rows | undefined
  if (!d) return { problem: 'couldn’t read your study tracker' }
  if (d.sqlMissing) return { problem: 'the study tracker isn’t set up yet (run supabase/tracker.sql in Supabase)' }
  const k = kv(raw.value ?? '')
  switch (op as TrkOp) {
    case 'trk_colour': return checkColour(raw, env, d, k)
    case 'trk_log': return checkLog(raw, env, d, k)
    case 'trk_mistake': return checkMistake(raw, env, d, k)
    case 'trk_redo': return checkRedo(raw, env, d, k)
    case 'trk_attempt': return checkAttempt(raw, env, d, k)
    case 'trk_test': return checkTest(raw, env, d, k)
    case 'trk_topic': return checkTopic(raw, env, d, k)
    case 'trk_programme': return checkProgramme(raw, env, d, k)
    case 'trk_item': return checkItem(raw, env, d, k)
    case 'trk_rule': return checkRule(raw, env, d, k)
  }
  return { problem: `unknown change “${op}”` }
}

const COLOUR_KEYS: Record<string, Colour> = { green: 'exam_ready', '🟢': 'exam_ready', exam_ready: 'exam_ready', yellow: 'understand', amber: 'understand', '🟡': 'understand', understand: 'understand', red: 'not_secure', '🔴': 'not_secure', not_secure: 'not_secure', white: 'not_started', grey: 'not_started', '⚪': 'not_started', not_started: 'not_started' }
const colourKey = (w: string | undefined) => (w ? COLOUR_KEYS[w.trim().toLowerCase().replace(/\s+/g, '_')] ?? null : null)

function checkColour(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const t = topicFor(raw, env, d, k)
  if (!t) return { problem: `which topic${raw.ref || k.topic ? ` (no topic “${raw.ref || k.topic}”)` : ''}?` }
  const c = colourKey(k.colour ?? k.status ?? k.value)
  if (!c) return { problem: `which colour for ${label(t)} (🔴 🟡 🟢 or ⚪)?` }
  if (c === t.status) return { problem: `${label(t)} is already ${dot(c)}` }
  const review = nextReview({ lastDone: env.today, status: c })
  return act('trk_colour', 'topics', t.id, label(t), `<b>${esc(label(t))}</b>: ${dot(t.status)} → <b>${dot(c)}</b>${review ? ` · review ${day(review)}` : ''}`,
    [{ kind: 'update', table: 'topics', id: t.id, set: { status: c, status_at: NOW, last_done: env.today } }], { topicId: t.id })
}

function checkLog(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const t = topicFor(raw, env, d, k)
  if (!t) return { problem: `which topic${raw.ref || k.topic ? ` (no topic “${raw.ref || k.topic}”)` : ''}?` }
  const what = logWhat(k.what ?? '')
  if (!what) return { problem: `what did you do on ${label(t)} (textbook, exercise, mixed, Bicen, Integral, booklet, PMT, review)?` }
  let score: number | null = null, outOf: number | null = null, pct: number | null = null
  if (k.pct !== undefined || /%$/.test(k.score ?? '')) pct = Number((k.pct ?? k.score).replace(/%$/, ''))
  else if (k.score !== undefined) {
    score = Number(k.score)
    outOf = k.out_of !== undefined ? Number(k.out_of) : null
    if (outOf === null) return { problem: `out of how many (${k.score}/?)?` }
    if (!Number.isFinite(score) || !Number.isFinite(outOf) || outOf <= 0 || score < 0 || score > outOf) return { problem: `${k.score}/${k.out_of} isn’t a score` }
    pct = pctOf(score, outOf)
  }
  if (pct !== null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) return { problem: `${k.pct ?? k.score} isn’t a score` }
  const notes = /^(yes|true|y)$/i.test(k.notes ?? '')
  const maths = isMathsTopic(t)
  const set: Record<string, unknown> = { last_done: env.today }
  const bits: string[] = [`${WHAT_WORDS[what]}${score !== null && outOf !== null ? ` ${fmt(score)}/${fmt(outOf)} = ${pct}%` : pct !== null ? ` ${pct}%` : ''}${notes ? ' (with notes)' : ''}`]
  let colour = t.status
  if (pct !== null && COLOUR_FROM.has(what)) {
    colour = colourFromPct(pct, notes)
    set.fresh_pct = pct
    if (colour !== t.status) { set.status = colour; set.status_at = NOW }
  }
  bits.push(colour !== t.status ? `${dot(t.status)} → <b>${dot(colour)}</b>` : `stays ${dot(colour)}`)
  if (maths) {
    const step = stepAfter(t.step, what, pct)
    if (step !== t.step) { set.step = step; bits.push(`step ${t.step} → <b>${step}</b> (${esc(stepName(step))})`) }
    if (what === 'integral' && pct !== null && pct < 85) bits.push('<i>Integral needs ≥ 85% for 🟢</i>')
  } else {
    if (what === 'booklet' && t.booklet !== 'done') { set.booklet = 'done'; bits.push(`booklet ${t.booklet ?? 'todo'} → <b>done</b>`) }
    if (what === 'pmt' && t.pmt !== 'done') { set.pmt = 'done'; bits.push(`PMT ${t.pmt ?? 'todo'} → <b>done</b>`) }
  }
  const review = nextReview({ lastDone: env.today, status: colour })
  if (review) bits.push(`review ${day(review)}`)
  return act('trk_log', 'topics', t.id, label(t), `<b>${esc(label(t))}</b>: ${bits.join(' · ')}`, [{ kind: 'update', table: 'topics', id: t.id, set }], { topicId: t.id })
}
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

function checkMistake(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const body = (k.what ?? k.body ?? k.wrong ?? '').trim()
  if (!body) return { problem: 'what went wrong?' }
  const code = (k.code ?? '').trim()
  const named = raw.ref || k.topic || code
  const t = named ? topicFor(raw, env, d, { ...k, topic: k.topic ?? code }) : null
  if (named && !t) return { problem: `no topic “${named}”` }
  const test = k.test ? testFor({ ...raw, ref: '' }, { ...env, ref: undefined }, d, k) : null
  if (k.test && !test) return { problem: `no test called “${k.test}”` }
  const kind = k.kind ? parseMistakeKind(k.kind) : null
  if (k.kind && !kind) return { problem: `“${k.kind}” isn’t a mistake type (Knowledge, Method, Algebra, Misread, Calculator, Time, Careless)` }
  const question = k.question ? clip(k.question.replace(/\s+/g, ''), 40) : null
  const redo = firstRedo(env.today)
  const row = {
    subject_id: t?.subjectId ?? test?.subjectId ?? null, topic_id: t?.id ?? null, body: clip(body, 500), source_text: clip(env.said.split('\n').filter(Boolean).at(-1) ?? body, 1000),
    logged_on: env.today, review_on: redo, goal_id: test?.id ?? null, question, code: t?.code ?? (code && CODE_RE.test(code) ? code.toUpperCase() : null),
    kind, rule: k.rule ? clip(k.rule, 300) : null, source: k.source ? clip(k.source, 200) : null, redo_stage: 0,
  }
  const where = [t ? label(t) : null, question].filter(Boolean).join(' ')
  const line = `📝 Mistake${where ? ` <b>${esc(where)}</b>` : ''}${test ? ` (${esc(test.title)})` : ''}: “${esc(clip(body, 120))}”${kind ? ` · ${kind[0].toUpperCase()}${kind.slice(1)}` : ''}${row.rule ? ` · rule: ${esc(clip(row.rule, 80))}` : ''} · redo ${day(redo)}`
  return act('trk_mistake', 'mistakes', null, where || clip(body, 60), line, [{ kind: 'insert', table: 'mistakes', row }], {})   // "Next": when to redo it (its id is added on apply)
}

function checkRedo(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const m = mistakeFor(raw, env, d, k)
  if (!m) return { problem: 'which mistake (its topic code and question, e.g. “PC1-03 Q3b”)?' }
  if (Array.isArray(m)) return { problem: `which one: ${m.slice(0, 3).map((x) => `${x.code ?? ''} ${x.question ?? ''} “${clip(x.body, 30)}”`.trim()).join(' or ')}?` }
  const wrong = /^(wrong|no|again|still wrong|x)$/i.test(k.result ?? '')
  const name = [m.code, m.question].filter(Boolean).join(' ') || clip(m.body, 40)
  if (wrong) {
    const again = firstRedo(env.today)
    return act('trk_redo', 'mistakes', m.id, name, `🔁 <b>${esc(name)}</b> (“${esc(clip(m.body, 60))}”): still wrong → redo again ${day(again)}`,
      [{ kind: 'update', table: 'mistakes', id: m.id, set: { redo_stage: 0, review_on: again } }], { mistakeId: m.id })
  }
  const r = afterRedo(m.redoStage, env.today)
  const set: Record<string, unknown> = { redo_stage: r.stage }
  if (r.reviewOn) set.review_on = r.reviewOn
  else set.reviewed_at = NOW
  return act('trk_redo', 'mistakes', m.id, name, `🔁 <b>${esc(name)}</b> (“${esc(clip(m.body, 60))}”): redo ${r.stage} of 2 ✓ → ${r.reviewOn ? `next redo ${day(r.reviewOn)}` : '<b>off the list</b>'}`,
    [{ kind: 'update', table: 'mistakes', id: m.id, set }], { mistakeId: m.id })
}

function checkAttempt(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const t = testFor(raw, env, d, k)
  if (!t) return { problem: `which test${raw.ref || k.test ? ` (no test “${raw.ref || k.test}”)` : ''}?` }
  const what = k.what ? attemptWhat(k.what) : 'other'
  if (!what) return { problem: `what kind of try was it (diagnostic, booklet, timed practice, past paper, the real test)?` }
  const score = k.score !== undefined ? Number(k.score) : null
  const outOf = k.out_of !== undefined ? Number(k.out_of) : score !== null ? t.marks : null
  if (score === null || !Number.isFinite(score)) return { problem: `what did you get on ${t.title}?` }
  if (outOf === null || !Number.isFinite(outOf) || outOf <= 0 || score < 0 || score > outOf) return { problem: `${k.score}/${k.out_of ?? '?'} isn’t a score` }
  let on = env.today
  if (raw.date) {
    const ok = dateOk(raw.date, env, raw, { past: true })
    if (!ok || ok > env.today) return { problem: `the day of that try wasn’t clear` }
    on = ok
  }
  const pct = pctOf(score, outOf)
  const lbl = clip((k.label ?? '').trim() || ATTEMPT_WORDS[what], 200)
  const bits = [`${esc(ATTEMPT_WORDS[what])} ${fmt(score)}/${fmt(outOf)} = <b>${pct}%</b>`, on === env.today ? 'today' : day(on)]
  if (['timed', 'paper', 'real'].includes(what)) {
    const topics = t.topicCodes.map((c) => d.topics.find((x) => x.code?.toUpperCase() === c.toUpperCase())).filter((x): x is TrackerTopic => !!x)
    const weak = topics.filter((x) => x.status === 'not_secure' || x.status === 'understand').sort((a, b) => (a.status === 'not_secure' ? 0 : 1) - (b.status === 'not_secure' ? 0 : 1))
    if (weak.length) bits.push(`work on: ${weak.slice(0, 5).map((x) => `${dot(x.status)} ${esc(x.code ?? x.name)}`).join(', ')}`)
    if (pct < 100) bits.push('<i>log each lost mark as a mistake</i>')
  }
  return act('trk_attempt', 'test_attempts', null, t.title, `📝 <b>${esc(t.title)}</b>: ${bits.join(' · ')}`,
    [{ kind: 'insert', table: 'test_attempts', row: { goal_id: t.id, done_on: on, what, label: lbl, score, out_of: outOf } }], { testId: t.id })
}

function checkTest(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const existing = raw.ref || k.test ? testFor(raw, env, d, k) : null
  if ((raw.ref || k.test) && !existing) return { problem: `no test “${raw.ref || k.test}”` }
  const set: Record<string, unknown> = {}
  const bits: string[] = []
  const was = existing
  // the date: his words (the brain's must be grounded); a Classroom card's comes from the assignment
  if (raw.date) {
    const ok = dateOk(raw.date, env, raw)
    if (!ok) return { problem: `the test date wasn’t clear (or it’s in the past)` }
    if (!was || ok !== was.date) { set.target_date = ok; if (was) bits.push(`${was.date ? day(was.date) : 'no date'} → <b>${day(ok)}</b>`) }
  }
  if (k.title) { const title = clip(k.title, 120); if (!was || title !== was.title) { set.title = title; if (was) bits.push(`“${esc(was.title)}” → “${esc(title)}”`) } }
  if (k.kind) {
    const kind = testKindOf(k.kind)
    if (!kind) return { problem: `“${k.kind}” isn’t a test kind (test, consolidation, paper, mock)` }
    if (!was || kind !== was.kind) { set.test_kind = kind; if (was) bits.push(`${was.kind} → <b>${kind}</b>`) }
  }
  let subject: Subject | null = null
  if (k.subject) {
    subject = d.subjects.find((s) => norm(s.name) === norm(k.subject) || (norm(k.subject) === 'fm' && s.name === 'Further Maths')) ?? null
    if (!subject) return { problem: `no subject called “${k.subject}”` }
    if (!was || subject.id !== was.subjectId) { set.subject_id = subject.id; if (was) bits.push(`subject → ${esc(subject.name)}`) }
  }
  if (k.topics !== undefined) {
    const words = k.topics.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean)
    // codes for the tracker; names too (the older maths planner reads goals.topics)
    const codes: string[] = [], names: string[] = []
    for (const w of words) {
      const m = findTopic(d.topics, w, env.today)
      if (!m || !('hit' in m)) return { problem: `no single topic “${w}” for the test` }
      if (m.hit.code && !codes.includes(m.hit.code)) codes.push(m.hit.code)
      if (!names.includes(m.hit.name)) names.push(m.hit.name)
    }
    const before = was?.topicCodes ?? []
    if (!was || JSON.stringify(codes) !== JSON.stringify(before)) {
      set.topic_codes = codes
      set.topics = clip(names.join(', '), 1000) || null
      if (was) bits.push(`topics ${esc(before.join(', ') || 'none')} → <b>${esc(codes.join(', ') || names.join(', ') || 'none')}</b>`)
    }
  }
  const text = (key: string, col: string, max: number, name: string) => {
    if (k[key] === undefined) return
    const v = /^(none|clear|-)$/i.test(k[key]) ? null : clip(k[key], max)
    const old = was ? (was as unknown as Record<string, unknown>)[name] as string | null : null
    if (!was || v !== old) { set[col] = v; if (was) bits.push(`${key} → ${v ? esc(clip(v, 60)) : 'none'}`) }
  }
  text('info', 'info', 2000, 'info')
  text('limits', 'limits', 300, 'limits')
  const len = intIn(k.length ?? k.length_min, 5, 600)
  if ((k.length ?? k.length_min) && len === null) return { problem: `“${k.length ?? k.length_min}” isn’t a test length in minutes` }
  if (len !== null && (!was || len !== was.lengthMin)) { set.length_min = len; if (was) bits.push(`${was.lengthMin ?? '?'} → <b>${len} min</b>`) }
  const marks = intIn(k.marks, 1, 1000)
  if (k.marks && marks === null) return { problem: `“${k.marks}” isn’t a number of marks` }
  if (marks !== null && (!was || marks !== was.marks)) { set.marks = marks; if (was) bits.push(`${was.marks ?? '?'} → <b>${marks} marks</b>`) }
  if (k.per_day) {
    const pd = perDay(k.per_day)
    if (!pd) return { problem: `“${k.per_day}” isn’t minutes a day (5–240)` }
    if (!was || pd[0] !== was.minutesPerDay || pd[1] !== was.minutesMax) { set.minutes_per_day = pd[0]; set.minutes_max = pd[1]; if (was) bits.push(`<b>${pd[0]}${pd[1] ? `–${pd[1]}` : ''} min/day</b>`) }
  }

  // a Classroom test was also added as homework: that copy is archived (kept), so it isn't planned twice
  const hw = k.homework ? d.tasks?.find((x) => x.id === k.homework && !x.archived_at && x.status !== 'completed') : null
  const hwStep: Step[] = hw ? [{ kind: 'update', table: 'tasks', id: hw.id, set: { archived_at: NOW, archive_reason: 'dropped' } }] : []
  const hwLine = hw ? `\n• <i>its homework copy “${esc(hw.title)}” is archived (the test plans its revision)</i>` : ''

  if (was) {
    if (!Object.keys(set).length) return { problem: `nothing to change on ${was.title}` }
    return act('trk_test', 'goals', was.id, was.title, `📝 <b>${esc(was.title)}</b>: ${bits.join(' · ')}${hwLine}`, [{ kind: 'update', table: 'goals', id: was.id, set }, ...hwStep], { testId: was.id })
  }

  // a new test
  const title = set.title as string | undefined
  const date = set.target_date as string | undefined
  if (!title) return { problem: 'what’s the test called?' }
  if (!date) return { problem: `when is ${title}?` }
  if (d.tests.some((t) => norm(t.title) === norm(title) && t.date === date)) return { problem: `you already have ${title} on ${day(date)}` }
  const sourceRef = k.source_ref ? clip(k.source_ref, 300) : null
  const source = ['sheet', 'classroom', 'chat', 'app'].includes(k.source ?? '') ? k.source : 'chat'
  const row = { title, kind: 'test', target_date: date, priority: 'high', test_kind: set.test_kind ?? 'test', subject_id: set.subject_id ?? null, topics: set.topics ?? null, topic_codes: set.topic_codes ?? [],
    info: set.info ?? null, limits: set.limits ?? null, length_min: set.length_min ?? null, marks: set.marks ?? null, minutes_per_day: set.minutes_per_day ?? null, minutes_max: set.minutes_max ?? null,
    source, source_ref: sourceRef }
  const subj = subject?.name ?? null
  const pd = row.minutes_per_day ? `${row.minutes_per_day}${row.minutes_max ? `–${row.minutes_max}` : ''} min/day` : ''
  const steps: Step[] = [{ kind: 'insert', table: 'goals', row }, ...hwStep]
  const lines = [`📝 New ${row.test_kind === 'test' ? 'test' : row.test_kind}: <b>${esc(title)}</b> · ${day(date)} (in ${daysBetween(env.today, date)} days)${subj ? ` · ${esc(subj)}` : ''}`
    + `${(row.topic_codes as string[]).length ? ` · topics ${esc((row.topic_codes as string[]).join(', '))}` : row.topics ? ` · topics ${esc(String(row.topics))}` : ''}${row.limits ? ` · ${esc(String(row.limits))}` : ''}`
    + `${row.length_min ? ` · ${row.length_min} min` : ''}${row.marks ? ` · ${row.marks} marks` : ''}${pd ? ` · ${pd}` : ''}`]
  return act('trk_test', 'goals', null, title, `${lines.join('')}${hwLine}`, steps)
}

function checkTopic(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const t = topicFor(raw, env, d, k)
  if (!t) return { problem: `which topic${raw.ref ? ` (no topic “${raw.ref}”)` : ''}?` }
  const set: Record<string, unknown> = {}
  const bits: string[] = []
  const field = (key: string, col: string, old: string | null, max: number, show = key) => {
    if (k[key] === undefined) return null
    const v = /^(none|clear|-)$/i.test(k[key]) ? null : clip(k[key], max)
    if (v !== old) { set[col] = v; bits.push(`${show} ${old ? esc(clip(old, 40)) : 'none'} → <b>${v ? esc(clip(v, 60)) : 'none'}</b>`) }
    return v
  }
  field('teacher', 'teacher', t.teacher, 60)
  field('strand', 'strand', t.strand, 60)
  field('notes', 'weak_notes', t.weakNotes, 1000, 'notes')
  field('concepts', 'concepts', t.concepts, 1000)
  field('bicen', 'bicen', t.bicen, 200, 'Bicen')
  field('pmt_ref', 'pmt_ref', t.pmtRef, 40, 'PMT ref')
  field('book_ref', 'book_ref', t.bookRef, 40, 'book')
  if (k.name !== undefined) { const v = clip(k.name, 120); if (v && v !== t.name) { set.name = v; bits.push(`“${esc(t.name)}” → “${esc(v)}”`) } }
  if (k.half_term !== undefined) {
    const v = k.half_term.toUpperCase().replace(/\s+/g, '')
    if (!/^HT[1-6]$/.test(v)) return { problem: `“${k.half_term}” isn’t a half-term (HT1–HT6)` }
    if (v !== t.halfTerm) { set.half_term = v; bits.push(`half-term ${t.halfTerm ?? 'none'} → <b>${v}</b>`) }
  }
  if (k.integral !== undefined) {
    if (!/^https?:\/\/\S+$/i.test(k.integral)) return { problem: 'the Integral link has to be a web address' }
    if (k.integral !== t.integralUrl) { set.integral_url = k.integral.slice(0, 500); bits.push(`Integral link → <b>set</b>`) }
  }
  for (const key of ['booklet', 'pmt'] as const) {
    if (k[key] === undefined) continue
    const v = k[key].toLowerCase()
    if (!['done', 'doing', 'todo'].includes(v)) return { problem: `${key} is done, doing or todo` }
    if (v !== t[key]) { set[key] = v; bits.push(`${key === 'pmt' ? 'PMT' : 'booklet'} ${t[key] ?? 'todo'} → <b>${v}</b>`) }
  }
  if (k.taught !== undefined) {
    const v = k.taught.toLowerCase().replace(/\s+/g, '_')
    const taught = v === 'yes' || v === 'taught' ? 'yes' : v === 'in_class' ? 'in_class' : v === 'not_yet' || v === 'no' ? 'not_yet' : null
    if (!taught) return { problem: 'taught is yes, in class or not yet' }
    if (taught !== t.taught) { set.taught = taught; bits.push(`taught ${t.taught?.replace('_', ' ') ?? '?'} → <b>${taught.replace('_', ' ')}</b>`) }
  }
  if (k.taught_from !== undefined || (raw.date && !Object.keys(set).length)) {
    const ok = dateOk(k.taught_from && validISO(k.taught_from) ? k.taught_from : raw.date, env, raw, { past: true })
    if (!ok) return { problem: 'the “taught from” date wasn’t clear' }
    if (ok !== t.taughtFrom) { set.taught_from = ok; bits.push(`taught from ${t.taughtFrom ? day(t.taughtFrom) : 'not set'} → <b>${day(ok)}</b>`) }
  }
  if (!Object.keys(set).length) return { problem: `nothing to change on ${label(t)}` }
  return act('trk_topic', 'topics', t.id, label(t), `<b>${esc(label(t))}</b>: ${bits.join(' · ')}`, [{ kind: 'update', table: 'topics', id: t.id, set }], { topicId: t.id })
}

const MODES = ['in_order', 'gaps_only', 'optional']
function checkProgramme(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const doing = (k.do ?? '').toLowerCase() || (raw.ref ? 'change' : 'new')
  if (doing === 'new') {
    const name = clip((k.name ?? '').trim(), 80)
    if (!name) return { problem: 'what’s the programme called?' }
    if (d.programmes.some((p) => norm(p.name) === norm(name) && p.status !== 'stopped')) return { problem: `you already have a programme called ${name}` }
    const items = (k.items ?? '').split(/\s*\|\s*|\n/).map((x) => clip(x.trim(), 200)).filter(Boolean).slice(0, 200)
    if (!items.length) return { problem: `what are ${name}’s items, in order?` }
    const perWeek = k.per_week ? intIn(k.per_week, 1, 14) : 1
    if (perWeek === null) return { problem: `“${k.per_week}” isn’t a number a week (1–14)` }
    const minutes = k.minutes ? intIn(k.minutes, 5, 300) : 60
    if (minutes === null) return { problem: `“${k.minutes}” isn’t minutes (5–300)` }
    const mode = k.mode ? k.mode.toLowerCase().replace(/[\s-]+/g, '_') : 'in_order'
    if (!MODES.includes(mode)) return { problem: 'the mode is in order, gaps only or optional' }
    let ends: string | null = null
    if (raw.date || k.ends) { ends = dateOk(raw.date || k.ends, env, raw); if (!ends) return { problem: 'the end date wasn’t clear' } }
    const subject = k.subject ? d.subjects.find((s) => norm(s.name) === norm(k.subject)) ?? null : null
    if (k.subject && !subject) return { problem: `no subject called “${k.subject}”` }
    const area = ['study', 'act', 'training', 'other'].includes(k.area ?? '') ? k.area : 'study'
    const days = k.days ? clip(k.days, 60) : null
    const steps: Step[] = [{ kind: 'insert', table: 'programmes', row: { name, area, subject_id: subject?.id ?? null, per_week: perWeek, minutes, days, ends_on: ends, mode, starts_on: env.today, status: 'active', sort_order: d.programmes.length } }]
    items.forEach((title, i) => steps.push({ kind: 'insert', table: 'programme_items', row: { programme_id: '$0', position: i + 1, title } }))
    return act('trk_programme', 'programmes', null, name,
      `📚 New programme: <b>${esc(name)}</b> · ${items.length} item${items.length === 1 ? '' : 's'} (first: ${esc(clip(items[0], 50))}) · ${perWeek} a week${days ? ` · ${esc(days)}` : ''} · ${minutes} min${ends ? ` · ends ${day(ends)}` : ''}${mode !== 'in_order' ? ` · ${mode.replace('_', ' ')}` : ''}`, steps)
  }
  const p = programmeFor(raw, env, d, k)
  if (!p) return { problem: `which programme${raw.ref || k.name ? ` (no programme “${raw.ref || k.name}”)` : ''}?` }
  const set: Record<string, unknown> = {}
  const bits: string[] = []
  const status = (s: Programme['status']) => (s === 'paused' ? '⏸ paused' : s === 'stopped' ? '⏹ stopped' : s === 'done' ? '✓ done' : '▶️ active')
  if (doing === 'pause') {
    let until: string | null = null
    if (raw.date || k.until) { until = dateOk(raw.date || k.until, env, raw); if (!until) return { problem: 'the date to pause it until wasn’t clear' } }
    if (p.status === 'paused' && p.pausedUntil === until) return { problem: `${p.name} is already paused` }
    set.status = 'paused'; set.paused_until = until
    bits.push(`${status(p.status)} → <b>⏸ paused${until ? ` until ${day(until)}` : ' (until you say “resume”)'}</b>`)
  } else if (doing === 'resume') {
    if (p.status === 'active' && !p.pausedUntil) return { problem: `${p.name} is already running` }
    set.status = 'active'; set.paused_until = null
    bits.push(`${status(p.status)} → <b>▶️ active</b>`)
  } else if (doing === 'stop') {
    if (p.status === 'stopped') return { problem: `${p.name} is already stopped` }
    set.status = 'stopped'
    bits.push(`${status(p.status)} → <b>⏹ stopped</b> <i>(kept, with its progress)</i>`)
  } else if (doing === 'add') {
    const items = (k.add ?? k.items ?? '').split(/\s*\|\s*|\n/).map((x) => clip(x.trim(), 200)).filter(Boolean).slice(0, 100)
    if (!items.length) return { problem: `what should I add to ${p.name}?` }
    const last = Math.max(0, ...p.items.map((i) => i.position))
    return act('trk_programme', 'programmes', p.id, p.name, `📚 <b>${esc(p.name)}</b>: +${items.length} item${items.length === 1 ? '' : 's'} (${esc(clip(items.join(', '), 80))}) → ${p.items.length + items.length} in all`,
      items.map((title, i): Step => ({ kind: 'insert', table: 'programme_items', row: { programme_id: p.id, position: last + i + 1, title } })), { programmeId: p.id })
  }
  if (k.per_week) {
    const n = intIn(k.per_week, 1, 14)
    if (n === null) return { problem: `“${k.per_week}” isn’t a number a week (1–14)` }
    if (n !== p.perWeek) { set.per_week = n; bits.push(`${p.perWeek} → <b>${n} a week</b>`) }
  }
  if (k.minutes) {
    const n = intIn(k.minutes, 5, 300)
    if (n === null) return { problem: `“${k.minutes}” isn’t minutes (5–300)` }
    if (n !== p.minutes) { set.minutes = n; bits.push(`${p.minutes} → <b>${n} min</b>`) }
  }
  if (k.days) { const v = /^(any|none|clear)$/i.test(k.days) ? null : clip(k.days, 60); if (v !== p.days) { set.days = v; bits.push(`days ${esc(p.days ?? 'any')} → <b>${esc(v ?? 'any')}</b>`) } }
  if (k.mode) {
    const v = k.mode.toLowerCase().replace(/[\s-]+/g, '_')
    if (!MODES.includes(v)) return { problem: 'the mode is in order, gaps only or optional' }
    if (v !== p.mode) { set.mode = v; bits.push(`${p.mode.replace('_', ' ')} → <b>${v.replace('_', ' ')}</b>`) }
  }
  if (doing === 'change' && (k.ends || (raw.date && !Object.keys(set).length))) {
    if (/^(none|clear)$/i.test(k.ends ?? '')) { if (p.endsOn) { set.ends_on = null; bits.push(`ends ${day(p.endsOn)} → <b>no end date</b>`) } }
    else {
      const ok = dateOk(validISO(k.ends ?? '') ? k.ends! : raw.date, env, raw)
      if (!ok) return { problem: 'the end date wasn’t clear' }
      if (ok !== p.endsOn) { set.ends_on = ok; bits.push(`ends ${p.endsOn ? day(p.endsOn) : 'never'} → <b>${day(ok)}</b>`) }
    }
  }
  if (!Object.keys(set).length) return { problem: `nothing to change on ${p.name}` }
  return act('trk_programme', 'programmes', p.id, p.name, `📚 <b>${esc(p.name)}</b>: ${bits.join(' · ')}`, [{ kind: 'update', table: 'programmes', id: p.id, set }], { programmeId: p.id })
}

/** The item his words point at: its number ("3"), words of its title, or the next one. */
export function itemFor(p: Programme, words: string | undefined): ProgrammeItem | null {
  const w = (words ?? '').trim()
  if (!w || /^next$/i.test(w)) return nextItem(p)   // the planner's next (a gaps_only chapter with full marks is finished)
  const n = w.match(/^#?(\d{1,3})$/)
  if (n) return p.items.find((i) => i.position === Number(n[1])) ?? null
  const nw = norm(w)
  const hits = p.items.filter((i) => norm(i.title).includes(nw))
  return hits.length === 1 ? hits[0] : null
}

function checkItem(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const p = programmeFor(raw, env, d, k)
  if (!p) return { problem: `which programme${raw.ref || k.programme ? ` (no programme “${raw.ref || k.programme}”)` : ''}?` }
  const it = itemFor(p, k.item)
  if (!it) return { problem: k.item ? `${p.name} has no item “${k.item}”` : `${p.name} has nothing left to do` }
  const doing = (k.do ?? 'done').toLowerCase()
  const result = k.result ? clip(k.result, 300) : null
  const score = k.score !== undefined ? Number(k.score) : null, outOf = k.out_of !== undefined ? Number(k.out_of) : null
  if (score !== null && (outOf === null || !(outOf > 0) || score < 0 || score > outOf)) return { problem: `${k.score}/${k.out_of ?? '?'} isn’t a score` }
  const name = `${p.name} #${it.position}`
  const head = `<b>${esc(p.name)}</b> #${it.position} ${esc(clip(it.title, 60))}`
  const set: Record<string, unknown> = {}
  const extra = [result ? esc(result) : '', score !== null ? `${fmt(score)}/${fmt(outOf!)}` : ''].filter(Boolean).join(' · ')
  if (score !== null) { set.score = score; set.out_of = outOf }
  // gaps_only (test the chapter first): the first score on an item is its chapter test — full marks skips the chapter
  const chapterTest = p.mode === 'gaps_only' && it.score == null && it.status !== 'done' && it.status !== 'skipped'
  if (doing === 'test' || (doing === 'done' && chapterTest)) {
    if (score === null) return { problem: `what did you get on the ${name} chapter test (e.g. 12/15)?` }
    const full = score >= outOf!
    if (full) Object.assign(set, { status: 'skipped', result: result ?? 'full marks on the chapter test' })
    return act('trk_item', 'programme_items', it.id, name, `📝 ${head}: chapter test ${fmt(score)}/${fmt(outOf!)}${full ? ' → full marks: <b>chapter skipped</b>' : ' → <b>do this chapter</b> (marks dropped)'}`,
      [{ kind: 'update', table: 'programme_items', id: it.id, set }], { programmeId: p.id })
  }
  if (doing === 'done') {
    if (it.status === 'done' && !result && score === null) return { problem: `${name} is already done` }
    Object.assign(set, { status: 'done', done_on: it.doneOn ?? env.today }, result ? { result } : {})
    const week = p.items.filter((i) => i.status === 'done' && i.doneOn && i.doneOn >= weekStartISO(env.today) && i.doneOn <= addDays(weekStartISO(env.today), 6) && i.id !== it.id).length + 1
    return act('trk_item', 'programme_items', it.id, name, `✅ ${head}: ${it.status} → <b>done</b>${extra ? ` (${extra})` : ''} · this week ${week}/${p.perWeek}`,
      [{ kind: 'update', table: 'programme_items', id: it.id, set }], { programmeId: p.id })
  }
  if (doing === 'skip') {
    if (it.status === 'skipped') return { problem: `${name} is already skipped` }
    set.status = 'skipped'
    return act('trk_item', 'programme_items', it.id, name, `⏭ ${head}: ${it.status} → <b>skipped</b>`, [{ kind: 'update', table: 'programme_items', id: it.id, set }], { programmeId: p.id })
  }
  if (doing === 'result') {
    if (!result && score === null) return { problem: `what was the result of ${name}?` }
    if (result) set.result = result
    return act('trk_item', 'programme_items', it.id, name, `📝 ${head}: result → <b>${extra}</b>`, [{ kind: 'update', table: 'programme_items', id: it.id, set }], { programmeId: p.id })
  }
  if (doing === 'todo' || doing === 'undo') {
    if (it.status === 'todo') return { problem: `${name} isn’t done` }
    return act('trk_item', 'programme_items', it.id, name, `↩️ ${head}: ${it.status} → <b>to do</b>`, [{ kind: 'update', table: 'programme_items', id: it.id, set: { status: 'todo', done_on: null } }], { programmeId: p.id })
  }
  return { problem: `“${doing}” isn’t done, skip, test or result` }
}

function checkRule(raw: PluginRawAction, env: CheckEnv, d: Rows, k: Record<string, string>): Result {
  const doing = (k.do ?? '').toLowerCase() || (raw.ref ? 'end' : 'add')
  if (doing === 'end') {
    const r = ruleFor(raw, env, d, k)
    if (!r) return { problem: 'which rule?' }
    if (r.endsOn < env.today) return { problem: `“${ruleLabel(r)}” has already ended` }
    const yesterday = addDays(env.today, -1)
    // ended from yesterday (it stops counting today); one that only started today is archived (kept, never deleted)
    const set = r.startsOn <= yesterday ? { ends_on: yesterday } : { archived_at: NOW }
    return act('trk_rule', 'plan_rules', r.id, ruleLabel(r), `📌 Rule <b>${esc(ruleLabel(r))}</b>: ${ruleSpan(r, env.today)} → <b>ended</b>`, [{ kind: 'update', table: 'plan_rules', id: r.id, set }], { rule: 'ended' })
  }
  if (doing !== 'add' && doing !== 'change') return { problem: `“${doing}” isn’t add or end` }
  const kind = (k.kind ?? '').toLowerCase() as PlanRule['kind']
  if (!['boost', 'pause', 'cap', 'note'].includes(kind)) return { problem: 'what kind of rule (top priority, pause, a time cap or a note)?' }
  let target = normTarget(k.target ?? (kind === 'note' ? 'note' : ''), d.subjects) ?? (kind === 'note' ? 'note' : null)
  if (!target) return { problem: `“${k.target ?? ''}” isn’t something a rule can be about (ACT, getting ahead, stretch, reviews, a subject, a programme)` }
  if (target.startsWith('programme:')) {
    const p = findProgramme(d.programmes, target.slice(10))
    if (!p) return { problem: `no programme called “${target.slice(10)}”` }
    target = `programme:${p.name}`.slice(0, 80)
  }
  // the planner boosts or pauses test prep as a whole (lib/tracker/rulesets.ts), so one test's rule is about test prep
  if (target.startsWith('test:')) {
    if (!findTest(d.tests, target.slice(5))) return { problem: `no test called “${target.slice(5)}”` }
    target = 'tests'
  }
  if (target.startsWith('topic:')) {
    const t = d.topics.find((x) => x.code && x.code.toUpperCase() === target!.slice(6).trim().toUpperCase())
    if (!t) return { problem: `no topic with the code “${target.slice(6)}”` }
    target = `topic:${t.code}`
  }
  if (kind === 'cap' && target === 'physics') target = 'subjects:Physics'
  if (kind === 'cap' && !target.startsWith('subject')) return { problem: 'a time cap is for subjects (e.g. maths + physics 45 min/day)' }
  const minutes = kind === 'cap' ? intIn(k.minutes, 5, 600) : null
  if (kind === 'cap' && minutes === null) return { problem: 'how many minutes a day?' }
  // the end: his words (the brain's must be his), or one of the quick-tap answers
  let ends: string | null = null
  const enumerated = (k.ends ?? '').toLowerCase()
  const sunday = addDays(weekStartISO(env.today), 6)
  if (enumerated === 'week' || enumerated === 'this_week') ends = sunday
  else if (enumerated === '2weeks' || enumerated === '2_weeks' || enumerated === 'two_weeks') ends = addDays(sunday, 7)
  else if (enumerated === 'until_i_say' || enumerated === 'i_say') ends = addDays(env.today, UNTIL_I_SAY_DAYS - 1)
  else if (raw.date || k.ends) { ends = dateOk(validISO(k.ends ?? '') ? k.ends! : raw.date, env, raw); if (!ends) return { problem: 'the end date wasn’t clear (or it’s in the past)' } }
  if (!ends) return { problem: 'when should it end (this week, 2 weeks, or until you say)?' }
  let starts = env.today
  if (k.starts && validISO(k.starts) && k.starts > env.today && k.starts <= ends) starts = k.starts
  if (ends < starts) return { problem: 'it would end before it starts' }
  const words = hisWords(env, k) || ruleLabel({ kind, target, minutes, words: '' })
  const r = { kind, target, minutes, words, startsOn: starts, endsOn: ends }
  // the same rule already running: it's a new end date for it
  const same = d.rules.find((x) => x.kind === kind && x.target.toLowerCase() === target!.toLowerCase() && x.endsOn >= env.today && (kind !== 'cap' || x.minutes === minutes))
  if (same) {
    if (same.endsOn === ends) return { problem: `“${ruleLabel(same)}” is already on ${ruleSpan(same, env.today)}` }
    return act('trk_rule', 'plan_rules', same.id, ruleLabel(same), `📌 Rule <b>${esc(ruleLabel(same))}</b>: until ${day(same.endsOn)} → <b>until ${day(ends)}</b>`,
      [{ kind: 'update', table: 'plan_rules', id: same.id, set: { ends_on: ends } }], { rule: 'changed' })
  }
  const capOther = kind === 'cap' ? d.rules.find((x) => x.kind === 'cap' && x.target.toLowerCase() === target!.toLowerCase() && x.endsOn >= env.today) : null
  const steps: Step[] = [{ kind: 'insert', table: 'plan_rules', row: { words, kind, target, minutes, starts_on: starts, ends_on: ends } }]
  if (capOther) steps.unshift({ kind: 'update', table: 'plan_rules', id: capOther.id, set: capOther.startsOn <= addDays(env.today, -1) ? { ends_on: addDays(env.today, -1) } : { archived_at: NOW } })
  return act('trk_rule', 'plan_rules', null, ruleLabel(r), `📌 New rule: <b>${esc(ruleLabel(r))}</b> · ${ruleSpan(r, env.today)}${capOther ? ` <i>(replaces ${capOther.minutes} min/day)</i>` : ''}`, steps, { rule: 'added' })
}

/** The refs the snapshot names, for the brain (plans/contracts.md §2: topic codes, TS, MK, PG, RL; TP for topics without a code). */
export function snapshotRefs(d: TrackerData): [string, PluginRef][] {
  const out: [string, PluginRef][] = []
  for (const t of d.topics) if (t.code) out.push([t.code.toUpperCase(), { kind: 'trk_topic', id: t.id, title: label(t), status: t.status, deadline: null }])
  snapCodeless(d).forEach((t, i) => out.push([`TP${i + 1}`, { kind: 'trk_topic', id: t.id, title: t.name, status: t.status, deadline: null }]))
  snapTests(d).forEach((t, i) => out.push([`TS${i + 1}`, { kind: 'trk_test', id: t.id, title: t.title, status: null, deadline: t.date }]))
  snapMistakes(d).forEach((m, i) => out.push([`MK${i + 1}`, { kind: 'trk_mistake', id: m.id, title: [m.code, m.question].filter(Boolean).join(' ') || clip(m.body, 40), status: null, deadline: m.reviewOn }]))
  snapProgrammes(d).forEach((p, i) => out.push([`PG${i + 1}`, { kind: 'trk_prog', id: p.id, title: p.name, status: p.status, deadline: p.endsOn }]))
  snapRules(d).forEach((r, i) => out.push([`RL${i + 1}`, { kind: 'trk_rule', id: r.id, title: ruleLabel(r), status: null, deadline: r.endsOn }]))
  return out
}
