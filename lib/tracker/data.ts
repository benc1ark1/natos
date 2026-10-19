// The study tracker's records, as Nat (row level security) (plans/contracts.md §3.3). Works with any signed-in client:
// the browser's (the Subjects page) or the server's (the bot, Today, the import route) — nothing here is secret.
// Before supabase/tracker.sql has run, everything still loads (topics without the new columns, no programmes, rules or
// attempts) and `ready` says so. Nothing is ever deleted: duplicates are archived, mistakes move, colours can be undone.
import type { SupabaseClient } from '@supabase/supabase-js'
import { findTopics, type MathsTopic } from '../maths'
import { moreSettings } from '../settings'
import { linksFrom, reviewDaysFrom } from './settings'
import { normName, TRACKER_SUBJECTS, type CurrentTopic, type ImportCounts, type ImportCurrent, type ImportPlan, type Row } from './import'
import type { Attempt, Colour, HomeworkTask, PlanRule, Programme, ProgrammeItem, StudyWorld, TestKind, TrackerMistake, TrackerTest, TrackerTopic } from './types'

export const EMPTY_LINKS: StudyWorld['links'] = { bicenPure: '', bicenStats: '', bicenMech: '', bicenCorePure: '', bicenMemorise: '', bicenSummaries: '', bicenHardest: '', integralFurther: '', integralAssessments: '', madas: '', step: '', pmtPhysics: '', isaac: '', amsp: '' }

/** What to tell him before supabase/tracker.sql has run. */
export const RUN_SQL = 'Run supabase/tracker.sql in Supabase (SQL Editor → New query → paste → Run) to turn on the study tracker.'

type Err = { message: string; code?: string } | null
/** A column or table that isn't there yet (its SQL file hasn't run). */
export const isMissing = (e: Err) => !!e && (['42703', '42P01', 'PGRST204', 'PGRST205'].includes(e.code ?? '') || /does not exist|could not find the (table|column)|schema cache/i.test(e.message))

const TOPIC_BASE = 'id,subject_id,name,spec_ref,notes_url,sort_order,archived_at'
const TOPIC_TRACKER = 'code,strand,teacher,half_term,taught_from,taught,step,bicen,integral_url,fresh_pct,last_done,weak_notes,concepts,booklet,pmt,pmt_ref,book_ref'
const GOAL_BASE = 'id,title,kind,subject_id,target_date,topics,archived_at'
const GOAL_TRACKER = 'info,test_kind,topic_codes,minutes_per_day,minutes_max,limits,length_min,marks,source,source_ref'
const MISTAKE_BASE = 'id,subject_id,topic_id,body,logged_on,review_on,reviewed_at,archived_at'
const MISTAKE_TRACKER = 'goal_id,question,code,kind,rule,source,redo_stage'

/** The database's own words go to the log only; he sees a fixed message naming the step. */
export function logged(stage: string, detail: unknown): string {
  console.error(`[tracker] ${stage}:`, detail instanceof Error ? detail.message : (detail as { message?: string } | null)?.message ?? detail)
  return stage
}
export const READ_FAILED = 'Couldn’t read your study tracker. Try again in a minute.'

type Q = PromiseLike<{ data: unknown; error: Err }>
/** Run the fullest select first; if a column/table is missing, the next one (and say it fell back). */
async function firstOf(...tries: (() => Q)[]): Promise<{ rows: Record<string, unknown>[]; level: number }> {
  for (let i = 0; i < tries.length; i++) {
    const r = await tries[i]()
    if (!r.error) return { rows: (r.data ?? []) as Record<string, unknown>[], level: i }
    if (!isMissing(r.error) || i === tries.length - 1) {
      if (isMissing(r.error)) return { rows: [], level: tries.length }
      logged('reading the study tracker', r.error)
      throw new Error(READ_FAILED)
    }
  }
  return { rows: [], level: tries.length }
}
/** A table that may not exist yet: its rows, or none. */
async function optional(q: () => Q): Promise<Record<string, unknown>[] | null> {
  const r = await q()
  if (r.error) { if (isMissing(r.error)) return null; logged('reading the study tracker', r.error); throw new Error(READ_FAILED) }
  return (r.data ?? []) as Record<string, unknown>[]
}

const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
const d = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : null)
const COLOURS: Colour[] = ['not_started', 'not_secure', 'understand', 'exam_ready']
const colour = (v: unknown): Colour => (COLOURS.includes(v as Colour) ? (v as Colour) : 'not_started')
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null)
const KINDS: TestKind[] = ['test', 'consolidation', 'paper', 'mock', 'act']

/** His subject named like one of the tracker's (any case) → the tracker's name for it. */
const trackerName = (name: string) => TRACKER_SUBJECTS.find((x) => normName(x) === normName(name)) ?? null
/** A subject's name as the planner compares it: the tracker's spelling for Maths / Further Maths / Physics, else his. */
const canonical = (name: string | null) => (name ? trackerName(name) ?? name : null)

function toTopic(r: Record<string, unknown>, subject: string): TrackerTopic {
  return {
    id: r.id as string, subjectId: r.subject_id as string, subject, code: s(r.code), name: r.name as string,
    strand: s(r.strand), teacher: s(r.teacher), halfTerm: s(r.half_term), taughtFrom: d(r.taught_from),
    taught: oneOf(r.taught, ['yes', 'in_class', 'not_yet'] as const), status: colour(r.status), step: n(r.step) ?? 0,
    bicen: s(r.bicen), integralUrl: s(r.integral_url), freshPct: n(r.fresh_pct), lastDone: d(r.last_done), weakNotes: s(r.weak_notes),
    concepts: s(r.concepts), booklet: oneOf(r.booklet, ['done', 'doing', 'todo'] as const), pmt: oneOf(r.pmt, ['done', 'doing', 'todo'] as const),
    pmtRef: s(r.pmt_ref), bookRef: s(r.book_ref), order: n(r.sort_order) ?? 0,
  }
}

/** Is this open task homework? From Classroom (school), a tutor, or anything titled homework. Never prep sessions or Someday. */
export function isHomework(t: { origin?: unknown; title?: unknown; subject_id?: unknown; source?: unknown; external_id?: unknown; status?: unknown; is_system?: unknown; archived_at?: unknown }): boolean {
  if (t.archived_at || t.is_system || t.status === 'completed' || t.status === 'someday') return false
  const title = typeof t.title === 'string' ? t.title : ''
  if (/\bhomework\b|\bhw\b/i.test(title)) return true
  const fromSomeone = typeof t.origin === 'string' && t.origin !== 'own' && t.origin !== ''
  return fromSomeone && (!!t.subject_id || t.source === 'import' || (typeof t.external_id === 'string' && t.external_id.startsWith('classroom:')) || /assignment|worksheet|exercise|questions|essay|past paper/i.test(title))
}

export type TrackerData = {
  world: StudyWorld
  ready: boolean                  // supabase/tracker.sql has run
  subjects: { id: string; name: string }[]   // Maths, Further Maths, Physics as he has them
  allMistakes: TrackerMistake[]   // every live mistake, redone ones too (the export)
  allProgrammes: Programme[]      // every live programme, ACT's too (the export)
  nextUpDays: number              // settings: ⏭ Next up window (21) and the test window (21)
  testWindowDays: number
}

/** Everything the study planner needs for `today`. */
export async function loadStudyWorld(sb: SupabaseClient, today: string): Promise<StudyWorld> {
  return (await loadTrackerData(sb, today)).world
}

/** The study world plus what the Subjects page and the export need. */
export async function loadTrackerData(sb: SupabaseClient, today: string): Promise<TrackerData> {
  const [subs, topics, goals, mistakes, attempts, progs, items, rules, tasks, prof, blocks] = await Promise.all([
    firstOf(() => sb.from('subjects').select('id,name').is('archived_at', null).order('sort_order')),
    firstOf(
      () => sb.from('topics').select(`${TOPIC_BASE},status,${TOPIC_TRACKER}`).is('archived_at', null).order('sort_order'),
      () => sb.from('topics').select(`${TOPIC_BASE},status`).is('archived_at', null).order('sort_order'),
      () => sb.from('topics').select(TOPIC_BASE).is('archived_at', null).order('sort_order'),
    ),
    firstOf(
      () => sb.from('goals').select(`${GOAL_BASE},${GOAL_TRACKER}`).eq('kind', 'test').is('archived_at', null).order('target_date'),
      () => sb.from('goals').select(GOAL_BASE).eq('kind', 'test').is('archived_at', null).order('target_date'),
    ),
    firstOf(
      () => sb.from('mistakes').select(`${MISTAKE_BASE},${MISTAKE_TRACKER}`).is('archived_at', null).order('review_on'),
      () => sb.from('mistakes').select(MISTAKE_BASE).is('archived_at', null).order('review_on'),
    ),
    optional(() => sb.from('test_attempts').select('id,goal_id,done_on,what,label,score,out_of').is('archived_at', null).order('done_on')),
    optional(() => sb.from('programmes').select('id,name,area,subject_id,per_week,minutes,days,starts_on,ends_on,status,paused_until,mode,notes,sort_order').is('archived_at', null).order('sort_order')),
    optional(() => sb.from('programme_items').select('id,programme_id,position,title,details,url,minutes,status,done_on,result,score,out_of').is('archived_at', null).order('position')),
    optional(() => sb.from('plan_rules').select('id,words,kind,target,minutes,starts_on,ends_on').is('archived_at', null).order('ends_on')),
    firstOf(() => sb.from('tasks').select('id,title,subject_id,due_at,duration_minutes,origin,source,external_id,status,is_system,archived_at').is('archived_at', null).neq('status', 'completed')),
    sb.from('profiles').select('planning').maybeSingle(),
    optional(() => sb.from('plan_blocks').select('pick_key').eq('on_date', today).eq('status', 'done').not('pick_key', 'is', null)),
  ])
  if (prof.error) { logged("reading your settings", prof.error); throw new Error(READ_FAILED) }

  const subjectName = new Map(subs.rows.map((r) => [r.id as string, r.name as string]))
  const tracked = subs.rows.filter((r) => trackerName(r.name as string)).map((r) => ({ id: r.id as string, name: trackerName(r.name as string)! }))
  const trackedName = new Map(tracked.map((x) => [x.id, x.name]))

  const topicList = topics.rows.filter((r) => trackedName.has(r.subject_id as string)).map((r) => toTopic(r, trackedName.get(r.subject_id as string)!))
  const topicById = new Map(topicList.map((t) => [t.id, t]))

  const attemptsByGoal = new Map<string, Attempt[]>()
  for (const r of attempts ?? []) {
    const a: Attempt = { id: r.id as string, goalId: r.goal_id as string, doneOn: d(r.done_on)!, what: (oneOf(r.what, ['diagnostic', 'booklet', 'timed', 'paper', 'real', 'other'] as const) ?? 'other'), label: s(r.label), score: n(r.score), outOf: n(r.out_of) }
    attemptsByGoal.set(a.goalId, [...(attemptsByGoal.get(a.goalId) ?? []), a])
  }
  const tests: TrackerTest[] = goals.rows.map((r) => {
    const kind = oneOf(r.test_kind, KINDS) ?? guessKind(r.title as string)
    const subject = r.subject_id ? subjectName.get(r.subject_id as string) ?? null : null
    let codes = Array.isArray(r.topic_codes) ? (r.topic_codes as string[]).filter((c) => typeof c === 'string' && c) : []
    // a test added the old way names its topics in words: find their codes
    if (!codes.length && typeof r.topics === 'string' && r.topics.trim()) codes = codesFromWords(r.topics, topicList, r.subject_id as string | null)
    return {
      id: r.id as string, title: r.title as string, date: d(r.target_date), kind, subjectId: s(r.subject_id), subject: canonical(subject),
      info: s(r.info), topicCodes: codes, minutesPerDay: n(r.minutes_per_day), minutesMax: n(r.minutes_max), limits: s(r.limits),
      lengthMin: n(r.length_min), marks: n(r.marks), attempts: attemptsByGoal.get(r.id as string) ?? [],
    }
  }).filter((t) => t.kind !== 'act')   // ACT reaches the planner through lib/act (extra picks)

  const allMistakes: TrackerMistake[] = mistakes.rows.map((r) => {
    const topic = r.topic_id ? topicById.get(r.topic_id as string) : undefined
    const reviewed = s(r.reviewed_at)
    const stage = n(r.redo_stage) ?? 0
    return {
      id: r.id as string, goalId: s(r.goal_id), topicId: s(r.topic_id), subjectId: s(r.subject_id) ?? topic?.subjectId ?? null,
      code: s(r.code) ?? topic?.code ?? null, question: s(r.question), body: r.body as string,
      kind: oneOf(r.kind, ['knowledge', 'method', 'algebra', 'misread', 'calculator', 'time', 'careless'] as const), rule: s(r.rule), source: s(r.source),
      // reviewed_at is set only when it's done (the 2nd redo, or ticked off on the subject page the old way)
      loggedOn: d(r.logged_on)!, reviewOn: d(r.review_on)!, redoStage: reviewed ? 2 : Math.min(2, Math.max(0, stage)), reviewedAt: reviewed,
    }
  })
  const open = allMistakes.filter((m) => m.redoStage < 2)

  const itemsByProg = new Map<string, ProgrammeItem[]>()
  for (const r of items ?? []) {
    const i: ProgrammeItem = {
      id: r.id as string, programmeId: r.programme_id as string, position: n(r.position) ?? 0, title: r.title as string, details: s(r.details), url: s(r.url),
      minutes: n(r.minutes), status: oneOf(r.status, ['todo', 'doing', 'done', 'skipped'] as const) ?? 'todo', doneOn: d(r.done_on), result: s(r.result),
      score: n(r.score), outOf: n(r.out_of),
    }
    itemsByProg.set(i.programmeId, [...(itemsByProg.get(i.programmeId) ?? []), i])
  }
  const programmes: Programme[] = (progs ?? []).map((r) => ({
    id: r.id as string, name: r.name as string, area: oneOf(r.area, ['study', 'act', 'training', 'other'] as const) ?? 'study', subjectId: s(r.subject_id),
    perWeek: n(r.per_week) ?? 1, minutes: n(r.minutes) ?? 60, days: s(r.days), startsOn: d(r.starts_on), endsOn: d(r.ends_on),
    status: oneOf(r.status, ['active', 'paused', 'stopped', 'done'] as const) ?? 'active', pausedUntil: d(r.paused_until),
    mode: oneOf(r.mode, ['in_order', 'gaps_only', 'optional'] as const) ?? 'in_order', notes: s(r.notes), items: itemsByProg.get(r.id as string) ?? [],
  }))

  const planRules: PlanRule[] = (rules ?? []).map((r) => ({
    id: r.id as string, words: r.words as string, kind: oneOf(r.kind, ['boost', 'pause', 'cap', 'note'] as const) ?? 'note', target: r.target as string,
    minutes: n(r.minutes), startsOn: d(r.starts_on)!, endsOn: d(r.ends_on)!,
  }))

  const homework: HomeworkTask[] = tasks.rows.filter(isHomework).map((r) => ({
    id: r.id as string, title: r.title as string, subjectId: s(r.subject_id), subject: r.subject_id ? canonical(subjectName.get(r.subject_id as string) ?? null) : null,
    dueAt: s(r.due_at), minutes: n(r.duration_minutes),
  })).sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))

  const values = moreSettings(prof.data?.planning ?? null) as unknown as Record<string, string | number>
  const world: StudyWorld = {
    // ACT books are programmes too, but lib/act plans them (extra picks): left out here so they aren't planned twice
    today, topics: topicList, tests, mistakes: open, programmes: programmes.filter((p) => p.area !== 'act'), rules: planRules, homework,
    links: linksFrom(values), reviewDays: reviewDaysFrom(values),
    doneToday: [...new Set((blocks ?? []).map((b) => b.pick_key as string).filter(Boolean))],
  }
  return {
    world, ready: topics.level === 0 && attempts !== null, subjects: tracked, allMistakes, allProgrammes: programmes,
    nextUpDays: Number(values.nextUpDays ?? 21), testWindowDays: Number(values.testWindowDays ?? 21),
  }
}

const guessKind = (title: string): TestKind => (/consolidation/i.test(title) ? 'consolidation' : /\bmock\b/i.test(title) ? 'mock' : /past paper|\bpaper\b/i.test(title) ? 'paper' : /\bact\b/i.test(title) ? 'act' : 'test')

/** "proof, vectors" → the codes of those topics (in the test's subject first). Topics without a code are left out. */
function codesFromWords(words: string, topics: TrackerTopic[], subjectId: string | null): string[] {
  const pool = (subjectId ? topics.filter((t) => t.subjectId === subjectId) : topics)
  const asMaths = pool.map((t) => ({ id: t.id, subject_id: t.subjectId, name: t.name, spec_ref: null, notes_url: null, sort_order: t.order, archived_at: null }) as MathsTopic)
  const out: string[] = []
  for (const said of words.split(/\s*[,;\n]\s*|\s+and\s+/).filter(Boolean)) {
    const hit = findTopics(asMaths, said)[0]
    const code = hit ? pool.find((t) => t.id === hit.id)?.code : null
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}

// ---------------------------------------------------------------------------
// The Subjects page: change a topic's colour (with Undo)
// ---------------------------------------------------------------------------

export type ColourBefore = { id: string; status: Colour; status_at: string | null; last_done: string | null }

/** Set a topic's colour; he just rated it on fresh questions, so last done = today. Returns what it was, for Undo. */
export async function setTopicColour(sb: SupabaseClient, id: string, to: Colour, today: string): Promise<{ before?: ColourBefore; error?: string }> {
  const r = await sb.from('topics').select('id,status,status_at,last_done').eq('id', id).maybeSingle()
  if (r.error) return { error: isMissing(r.error) ? `Not saved. ${RUN_SQL}` : `Not saved: ${logged('reading the topic', r.error)} failed. Try again.` }
  if (!r.data) return { error: 'Not saved: that topic isn’t there any more.' }
  const before = r.data as ColourBefore
  const u = await sb.from('topics').update({ status: to, status_at: new Date().toISOString(), last_done: today }).eq('id', id).select('id')
  if (u.error) return { error: `Not saved: ${logged('saving the colour', u.error)} failed. Try again.` }
  if (!u.data?.length) return { error: 'Not saved: that topic isn’t there any more.' }
  return { before }
}

/** Undo a colour change: only if the topic still has the colour that was set (`set`); otherwise it's left alone. */
export async function restoreTopicColour(sb: SupabaseClient, b: ColourBefore, set: Colour): Promise<string | null> {
  const u = await sb.from('topics').update({ status: b.status, status_at: b.status_at, last_done: b.last_done }).eq('id', b.id).eq('status', set).select('id')
  if (u.error) return `Couldn’t undo: ${logged('undoing the colour', u.error)} failed. Try again.`
  return u.data?.length ? null : 'Undo skipped: its colour has changed since, so it was left as it is.'
}

// ---------------------------------------------------------------------------
// The import: what he has now, and saving a plan
// ---------------------------------------------------------------------------

/** What the import compares the spreadsheet with. `ready` is false until supabase/tracker.sql has run. */
export async function loadImportCurrent(sb: SupabaseClient): Promise<ImportCurrent> {
  const [subs, cats, topics, goals, attempts, mistakes, progs, items, prof] = await Promise.all([
    firstOf(() => sb.from('subjects').select('id,name,category_id,archived_at').order('sort_order')),
    firstOf(() => sb.from('categories').select('id,name')),
    firstOf(
      () => sb.from('topics').select(`${TOPIC_BASE},status,status_at,${TOPIC_TRACKER}`).is('archived_at', null).order('sort_order'),
      () => sb.from('topics').select(`${TOPIC_BASE},status,status_at`).is('archived_at', null).order('sort_order'),
      () => sb.from('topics').select(TOPIC_BASE).is('archived_at', null).order('sort_order'),
    ),
    firstOf(
      () => sb.from('goals').select(`${GOAL_BASE},${GOAL_TRACKER}`).eq('kind', 'test').is('archived_at', null),
      () => sb.from('goals').select(GOAL_BASE).eq('kind', 'test').is('archived_at', null),
    ),
    optional(() => sb.from('test_attempts').select('id,goal_id,done_on,what,score,out_of').is('archived_at', null)),
    firstOf(
      () => sb.from('mistakes').select(`${MISTAKE_BASE},${MISTAKE_TRACKER}`).is('archived_at', null),
      () => sb.from('mistakes').select(MISTAKE_BASE).is('archived_at', null),
    ),
    optional(() => sb.from('programmes').select('id,name').is('archived_at', null)),
    optional(() => sb.from('programme_items').select('id,programme_id,position,title,status,done_on,minutes,result,url').is('archived_at', null).order('position')),
    sb.from('profiles').select('planning').maybeSingle(),
  ])
  if (prof.error) { logged("reading your settings", prof.error); throw new Error(READ_FAILED) }
  const topicCode = new Map(topics.rows.map((r) => [r.id as string, s(r.code)]))
  return {
    ready: topics.level === 0 && goals.level === 0 && mistakes.level === 0 && attempts !== null && progs !== null,
    subjects: subs.rows.map((r) => ({ id: r.id as string, name: r.name as string, categoryId: s(r.category_id), archived: !!r.archived_at })),
    categories: cats.rows.map((r) => ({ id: r.id as string, name: r.name as string })),
    topics: topics.rows.map((r): CurrentTopic => {
      const t = toTopic(r, '')
      return { ...t, specRef: s(r.spec_ref), sortOrder: t.order, notesUrl: s(r.notes_url), statusAt: s(r.status_at) }
    }),
    tests: goals.rows.map((r) => ({
      id: r.id as string, title: r.title as string, date: d(r.target_date), subjectId: s(r.subject_id), testKind: oneOf(r.test_kind, KINDS),
      info: s(r.info), topicCodes: Array.isArray(r.topic_codes) ? (r.topic_codes as string[]) : [], topics: s(r.topics),
      minutesPerDay: n(r.minutes_per_day), minutesMax: n(r.minutes_max), limits: s(r.limits), lengthMin: n(r.length_min), marks: n(r.marks),
      source: s(r.source), sourceRef: s(r.source_ref),
    })),
    attempts: (attempts ?? []).map((r) => ({ id: r.id as string, goalId: r.goal_id as string, doneOn: d(r.done_on)!, what: (r.what as Attempt['what']) ?? 'other', score: n(r.score), outOf: n(r.out_of) })),
    mistakes: mistakes.rows.map((r) => ({
      id: r.id as string, goalId: s(r.goal_id), topicId: s(r.topic_id), code: s(r.code) ?? (r.topic_id ? topicCode.get(r.topic_id as string) ?? null : null),
      question: s(r.question), body: r.body as string, source: s(r.source),
    })),
    programmes: (progs ?? []).map((p) => ({
      id: p.id as string, name: p.name as string,
      items: (items ?? []).filter((i) => i.programme_id === p.id).map((i) => ({
        id: i.id as string, position: n(i.position) ?? 0, title: i.title as string, status: (oneOf(i.status, ['todo', 'doing', 'done', 'skipped'] as const) ?? 'todo'),
        doneOn: d(i.done_on), minutes: n(i.minutes), result: s(i.result), url: s(i.url),
      })),
    })),
    planning: (prof.data?.planning ?? {}) as Record<string, unknown>,
  }
}

export type ApplyResult = {
  ok: boolean
  saved: ImportCounts             // only what the database confirmed
  error?: string                  // where it stopped, and why
}

const zero = (): ImportCounts => ({ topicsNew: 0, topicsUpdated: 0, topicsSame: 0, topicsReordered: 0, duplicatesArchived: 0, mistakesMoved: 0, testsNew: 0, testsUpdated: 0, attemptsNew: 0, mistakesNew: 0, programmesNew: 0, programmeItemsNew: 0, programmeItemsUpdated: 0, settings: 0, subjectsNew: 0 })
const stamp = (row: Row, now: string): Row => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v === 'now' && k.endsWith('_at') ? now : v]))

/** Many small updates, a few at a time: the items the database confirmed, and the first error (logged; not his to read). */
async function each<T>(list: T[], run: (x: T) => PromiseLike<{ data: unknown[] | null; error: Err }>): Promise<{ done: T[]; error: string | null }> {
  const done: T[] = []
  let error: string | null = null
  for (let i = 0; i < list.length && !error; i += 6) {
    const batch = list.slice(i, i + 6)
    const rs = await Promise.all(batch.map(run))
    rs.forEach((r, k) => {
      if (r.error) error ??= r.error.message
      else if (!r.data?.length) error ??= 'a row wasn’t found (it may have been archived meanwhile)'
      else done.push(batch[k])
    })
  }
  return { done, error }
}

/**
 * Save an import plan, as Nat (row level security). Never deletes: duplicates are archived and their mistakes move.
 * Stops at the first problem and says exactly what was saved by then (each count is what the database confirmed).
 * Importing again afterwards is safe: it skips whatever is already there.
 */
export async function applyImport(sb: SupabaseClient, plan: ImportPlan, ready = true): Promise<ApplyResult> {
  const saved = zero()
  if (!ready) return { ok: false, saved, error: RUN_SQL }
  const now = new Date().toISOString()
  const stop = (what: string, msg: string) => ({ ok: false, saved, error: `Stopped while saving ${logged(what, msg)}. Importing the same file again is safe: it skips what was saved.` })

  // 1. subjects (normally none: Maths, Further Maths and Physics are there)
  const subjectId = new Map<string, string>()
  for (const x of plan.subjects) {
    const r = x.restoreId
      ? await sb.from('subjects').update({ archived_at: null }).eq('id', x.restoreId).select('id')
      : await sb.from('subjects').insert({ name: x.name, category_id: x.categoryId, sort_order: 0 }).select('id')
    if (r.error || !r.data?.length) return stop(`the subject ${x.name}`, r.error?.message ?? 'not saved')
    subjectId.set(x.name, r.data[0].id as string)
    saved.subjectsNew++
  }

  // 2. duplicates: their mistakes move to the kept topic, then they're archived
  for (const a of plan.topics.archive) {
    if (a.mistakeIds.length) {
      const m = await sb.from('mistakes').update({ topic_id: a.keptId }).in('id', a.mistakeIds).select('id')
      if (m.error) return stop(`the mistakes of ${a.label}`, m.error.message)
      saved.mistakesMoved += m.data?.length ?? 0
    }
    const r = await sb.from('topics').update({ archived_at: now }).eq('id', a.id).is('archived_at', null).select('id')
    if (r.error) return stop(`the duplicate ${a.label}`, r.error.message)
    if (r.data?.length) saved.duplicatesArchived++
  }

  // 3. topics he has: codes, teachers, dates… (his colours and notes stay unless they were blank)
  const upd = await each(plan.topics.update, (u) => sb.from('topics').update(stamp(u.patch, now)).eq('id', u.id).select('id'))
  saved.topicsReordered = upd.done.filter((u) => u.reorderOnly).length   // counted per confirmed row, never assumed
  saved.topicsUpdated = upd.done.length - saved.topicsReordered
  if (upd.error) return stop('topics', upd.error)

  // 4. new topics (one insert: all or none)
  const topicId = new Map<string, { id: string; subjectId: string }>()
  if (plan.topics.create.length) {
    const rows = plan.topics.create.map((c) => stamp({ ...c.row, subject_id: (c.row.subject_id as string | null) ?? subjectId.get(c.subject) ?? null }, now))
    if (rows.some((r) => !r.subject_id)) return stop('new topics', 'a subject is missing')
    const r = await sb.from('topics').insert(rows).select('id,code,subject_id')
    if (r.error) return stop('new topics', r.error.message)
    for (const t of r.data ?? []) topicId.set(String(t.code).toUpperCase(), { id: t.id as string, subjectId: t.subject_id as string })
    saved.topicsNew = r.data?.length ?? 0
  }

  // 5. tests
  const testId = new Map<string, string>()
  for (const t of plan.tests.create) {
    const row = { ...t.row, subject_id: (t.row.subject_id as string | null) ?? (t.subject ? subjectId.get(t.subject) ?? null : null) }
    const r = await sb.from('goals').insert(row).select('id')
    if (r.error || !r.data?.length) return stop(`the test ${t.label}`, r.error?.message ?? 'not saved')
    testId.set(t.key, r.data[0].id as string)
    saved.testsNew++
  }
  for (const t of plan.tests.update) testId.set(t.key, t.id)
  const tu = await each(plan.tests.update, (t) => sb.from('goals').update(t.patch).eq('id', t.id).select('id'))
  saved.testsUpdated = tu.done.length
  if (tu.error) return stop('tests', tu.error)

  // 6. test scores
  if (plan.attempts.length) {
    const rows = plan.attempts.map((a) => ({ ...a.row, goal_id: a.goalId ?? testId.get(a.testKey) ?? null }))
    if (rows.some((r) => !r.goal_id)) return stop('test scores', 'their test is missing')
    const r = await sb.from('test_attempts').insert(rows).select('id')
    if (r.error) return stop('test scores', r.error.message)
    saved.attemptsNew = r.data?.length ?? 0
  }

  // 7. mistakes (each linked to its topic and test)
  if (plan.mistakes.length) {
    const rows = plan.mistakes.map((m) => {
      const made = m.code ? topicId.get(m.code.toUpperCase()) : undefined
      const topic = m.topicId ?? made?.id ?? null
      return {
        ...m.row, topic_id: topic, goal_id: m.goalId ?? (m.testKey ? testId.get(m.testKey) ?? null : null),
        subject_id: (m.row.subject_id as string | null) ?? made?.subjectId ?? (m.subject ? subjectId.get(m.subject) ?? null : null),
      }
    })
    const r = await sb.from('mistakes').insert(rows).select('id')
    if (r.error) return stop('mistakes', r.error.message)
    saved.mistakesNew = r.data?.length ?? 0
  }

  // 8. programmes (STEP)
  for (const p of plan.programmes.create) {
    const row = { ...p.row, subject_id: (p.row.subject_id as string | null) ?? (p.subject ? subjectId.get(p.subject) ?? null : null) }
    const r = await sb.from('programmes').insert(row).select('id')
    if (r.error || !r.data?.length) return stop(`the ${p.name} programme`, r.error?.message ?? 'not saved')
    saved.programmesNew++
    if (p.items.length) {
      const it = await sb.from('programme_items').insert(p.items.map((i) => ({ ...i, programme_id: r.data[0].id }))).select('id')
      if (it.error) return stop(`the ${p.name} items (the programme itself was saved, with no items; importing again adds them)`, it.error.message)
      saved.programmeItemsNew += it.data?.length ?? 0
    }
  }
  for (const p of plan.programmes.addItems) {
    const it = await sb.from('programme_items').insert(p.items.map((i) => ({ ...i, programme_id: p.id }))).select('id')
    if (it.error) return stop(`new ${p.name} items`, it.error.message)
    saved.programmeItemsNew += it.data?.length ?? 0
  }
  const pu = await each(plan.programmes.updateItems, (u) => sb.from('programme_items').update(u.patch).eq('id', u.id).select('id'))
  saved.programmeItemsUpdated = pu.done.length
  if (pu.error) return stop('programme items', pu.error)

  // 9. settings (links, review gaps): one write to his profile
  if (plan.settings.length) {
    const { data: prof, error: e1 } = await sb.from('profiles').select('user_id,planning').maybeSingle()
    if (e1) return stop('settings', e1.message)
    const planning = { ...((prof?.planning ?? {}) as Record<string, unknown>) }
    for (const x of plan.settings) planning[x.key] = x.value
    const r = prof
      ? await sb.from('profiles').update({ planning }).eq('user_id', prof.user_id).select('user_id')
      : await sb.from('profiles').insert({ planning }).select('user_id')
    if (r.error || !r.data?.length) return stop('settings', r.error?.message ?? 'not saved')
    saved.settings = plan.settings.length
  }
  saved.topicsSame = plan.topics.same
  return { ok: true, saved }
}
