// Server-only: what the study tracker bot reads, as Nat (row level security): live topics with their colour, step and
// review date; tests (goals of kind 'test') with their attempts; open mistakes; programmes with their items; temporary
// rules. Shapes are lib/tracker/types.ts. Before supabase/tracker.sql has run it still answers (topics with the old
// columns, nothing else) and says so (`sqlMissing`), so the old maths flows keep working.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays } from '../time'
import type { Attempt, Colour, PlanRule, Programme, ProgrammeItem, TestKind, TrackerLinks, TrackerMistake, TrackerTest, TrackerTopic } from './types'
import { linksFrom } from './settings'
import { moreSettings } from '../settings'
import { rulesWeekLine } from './bot-views'

export type Subject = { id: string; name: string }
export type TrackerData = {
  today: string
  sqlMissing: boolean            // supabase/tracker.sql hasn't run yet
  subjects: Subject[]
  topics: TrackerTopic[]         // live (not archived), school order within each subject
  tests: TrackerTest[]           // live tests, from 30 days ago on
  mistakes: TrackerMistake[]     // open ones (not archived, not redone twice)
  programmes: Programme[]        // not archived
  rules: PlanRule[]              // not archived (expired ones included; `liveRules` picks the ones that count)
  links: TrackerLinks            // the "Start here" links (for the resource ladder)
}

/** The "Start here" links from his settings (lib/tracker/settings.ts); empty until he pastes them. */
export const trackerLinks = (planning: unknown): TrackerLinks => linksFrom(moreSettings(planning))

export const TOPIC_COLS = 'id,subject_id,name,spec_ref,sort_order,status,code,strand,teacher,half_term,taught_from,taught,step,bicen,integral_url,fresh_pct,last_done,weak_notes,concepts,booklet,pmt,pmt_ref,book_ref'
export const TEST_COLS = 'id,title,target_date,subject_id,topics,test_kind,info,topic_codes,minutes_per_day,minutes_max,limits,length_min,marks,source,source_ref'
export const MISTAKE_COLS = 'id,subject_id,topic_id,body,logged_on,review_on,reviewed_at,goal_id,question,code,kind,rule,source,redo_stage'
export const PROGRAMME_COLS = 'id,name,area,subject_id,per_week,minutes,days,starts_on,ends_on,status,paused_until,mode,notes,sort_order'
export const ITEM_COLS = 'id,programme_id,position,title,details,url,minutes,status,done_on,result,score,out_of'
export const RULE_COLS = 'id,words,kind,target,minutes,starts_on,ends_on'

/** A Supabase error that means "this column / table isn't there yet" (the SQL file hasn't run). */
export const isMissing = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (e.code === '42703' || e.code === '42P01' || e.code === 'PGRST204' || e.code === 'PGRST205'
    || /does not exist|could not find the .*(column|table)|schema cache/i.test(e.message ?? ''))

export const SQL_NOTE = '🛠 The study tracker needs one step first: paste <code>supabase/tracker.sql</code> into Supabase → SQL Editor → Run (it only adds things).'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const date = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : null)
const COLOURS: Colour[] = ['not_started', 'not_secure', 'understand', 'exam_ready']

export function topicOf(r: Row, subjects: Map<string, string>): TrackerTopic {
  const status = COLOURS.includes(r.status as Colour) ? (r.status as Colour) : 'not_started'
  const taught = ['yes', 'in_class', 'not_yet'].includes(r.taught as string) ? (r.taught as TrackerTopic['taught']) : null
  const state = (v: unknown) => (['done', 'doing', 'todo'].includes(v as string) ? (v as 'done') : null)
  return {
    id: String(r.id), subjectId: String(r.subject_id), subject: subjects.get(String(r.subject_id)) ?? '', code: str(r.code), name: String(r.name),
    strand: str(r.strand), teacher: str(r.teacher), halfTerm: str(r.half_term), taughtFrom: date(r.taught_from), taught, status,
    step: Number(r.step ?? 0) || 0, bicen: str(r.bicen), integralUrl: str(r.integral_url), freshPct: num(r.fresh_pct), lastDone: date(r.last_done),
    weakNotes: str(r.weak_notes), concepts: str(r.concepts), booklet: state(r.booklet), pmt: state(r.pmt), pmtRef: str(r.pmt_ref),
    bookRef: str(r.book_ref) ?? str(r.spec_ref), order: Number(r.sort_order ?? 0),
  }
}

const KINDS: TestKind[] = ['test', 'consolidation', 'paper', 'mock', 'act']
export function testOf(r: Row, subjects: Map<string, string>, attempts: Attempt[]): TrackerTest {
  return {
    id: String(r.id), title: String(r.title), date: date(r.target_date), kind: KINDS.includes(r.test_kind as TestKind) ? (r.test_kind as TestKind) : 'test',
    subjectId: str(r.subject_id), subject: r.subject_id ? subjects.get(String(r.subject_id)) ?? null : null, info: str(r.info),
    topicCodes: Array.isArray(r.topic_codes) ? (r.topic_codes as string[]) : [], minutesPerDay: num(r.minutes_per_day), minutesMax: num(r.minutes_max),
    limits: str(r.limits), lengthMin: num(r.length_min), marks: num(r.marks), attempts: attempts.filter((a) => a.goalId === r.id),
  }
}

export const attemptOf = (r: Row): Attempt => ({
  id: String(r.id), goalId: String(r.goal_id), doneOn: date(r.done_on) ?? '', what: (r.what as Attempt['what']) ?? 'other', label: str(r.label), score: num(r.score), outOf: num(r.out_of),
})

export const mistakeOf = (r: Row): TrackerMistake => ({
  id: String(r.id), goalId: str(r.goal_id), topicId: str(r.topic_id), subjectId: str(r.subject_id), code: str(r.code), question: str(r.question),
  body: String(r.body ?? ''), kind: (str(r.kind) as TrackerMistake['kind']) ?? null, rule: str(r.rule), source: str(r.source), loggedOn: date(r.logged_on) ?? '',
  reviewOn: date(r.review_on) ?? '', redoStage: Number(r.redo_stage ?? 0) || 0, reviewedAt: str(r.reviewed_at),
})

export const itemOf = (r: Row): ProgrammeItem => ({
  id: String(r.id), programmeId: String(r.programme_id), position: Number(r.position), title: String(r.title), details: str(r.details), url: str(r.url),
  minutes: num(r.minutes), status: (r.status as ProgrammeItem['status']) ?? 'todo', doneOn: date(r.done_on), result: str(r.result), score: num(r.score), outOf: num(r.out_of),
})

export const programmeOf = (r: Row, items: ProgrammeItem[]): Programme => ({
  id: String(r.id), name: String(r.name), area: (r.area as Programme['area']) ?? 'study', subjectId: str(r.subject_id), perWeek: Number(r.per_week ?? 1),
  minutes: Number(r.minutes ?? 60), days: str(r.days), startsOn: date(r.starts_on), endsOn: date(r.ends_on), status: (r.status as Programme['status']) ?? 'active',
  pausedUntil: date(r.paused_until), mode: (r.mode as Programme['mode']) ?? 'in_order', notes: str(r.notes),
  items: items.filter((i) => i.programmeId === r.id).sort((a, b) => a.position - b.position),
})

export const ruleOf = (r: Row): PlanRule => ({
  id: String(r.id), words: String(r.words), kind: r.kind as PlanRule['kind'], target: String(r.target), minutes: num(r.minutes), startsOn: date(r.starts_on) ?? '', endsOn: date(r.ends_on) ?? '',
})

/** Rules that count on `day` (they auto-expire: an old one just stops counting). */
export const liveRules = (rules: PlanRule[], day: string) => rules.filter((r) => r.startsOn <= day && day <= r.endsOn)

/** Everything the bot needs, read in parallel. Throws a readable error only for a real read problem. */
export async function loadTracker(sb: SupabaseClient, today: string): Promise<TrackerData> {
  const [subjectsRes, topicsRes, testsRes, mistakesRes, progRes, itemsRes, rulesRes, profile] = await Promise.all([
    sb.from('subjects').select('id,name').is('archived_at', null).order('sort_order'),
    sb.from('topics').select(TOPIC_COLS).is('archived_at', null).order('sort_order'),
    sb.from('goals').select(TEST_COLS).eq('kind', 'test').is('archived_at', null).gte('target_date', addDays(today, -30)).order('target_date'),
    sb.from('mistakes').select(MISTAKE_COLS).is('archived_at', null).is('reviewed_at', null).lt('redo_stage', 2).order('review_on'),
    sb.from('programmes').select(PROGRAMME_COLS).is('archived_at', null).order('sort_order'),
    sb.from('programme_items').select(ITEM_COLS).is('archived_at', null).order('position'),
    sb.from('plan_rules').select(RULE_COLS).is('archived_at', null).order('ends_on'),
    sb.from('profiles').select('planning').maybeSingle(),
  ])
  if (subjectsRes.error) throw new Error(`Couldn’t read your subjects: ${subjectsRes.error.message}`)
  const subjects = (subjectsRes.data ?? []) as Subject[]
  const names = new Map(subjects.map((s) => [s.id, s.name]))
  const missing = [topicsRes, testsRes, mistakesRes, progRes, itemsRes, rulesRes].some((r) => isMissing(r.error))
  for (const r of [topicsRes, testsRes, mistakesRes, progRes, itemsRes, rulesRes]) if (r.error && !isMissing(r.error)) throw new Error(`Couldn’t read your study tracker: ${r.error.message}`)

  let topicRows = (topicsRes.data ?? []) as Row[]
  if (isMissing(topicsRes.error)) {
    // before tracker.sql: the topics as they were (with their colour if maths.sql ran)
    const old = await sb.from('topics').select('id,subject_id,name,spec_ref,sort_order,status').is('archived_at', null).order('sort_order')
    const plain = isMissing(old.error) ? await sb.from('topics').select('id,subject_id,name,spec_ref,sort_order').is('archived_at', null).order('sort_order') : old
    topicRows = plain.error ? [] : (plain.data ?? []) as Row[]
  }
  const goalIds = isMissing(testsRes.error) ? [] : ((testsRes.data ?? []) as Row[]).map((r) => String(r.id))
  const attemptsRes = goalIds.length && !missing ? await sb.from('test_attempts').select('id,goal_id,done_on,what,label,score,out_of').in('goal_id', goalIds).is('archived_at', null).order('done_on') : null
  const attempts = attemptsRes && !attemptsRes.error ? ((attemptsRes.data ?? []) as Row[]).map(attemptOf) : []
  const items = isMissing(itemsRes.error) ? [] : ((itemsRes.data ?? []) as Row[]).map(itemOf)

  return {
    today, sqlMissing: missing, subjects,
    topics: topicRows.map((r) => topicOf(r, names)),
    tests: isMissing(testsRes.error) ? [] : ((testsRes.data ?? []) as Row[]).map((r) => testOf(r, names, attempts)),
    mistakes: isMissing(mistakesRes.error) ? [] : ((mistakesRes.data ?? []) as Row[]).map(mistakeOf),
    programmes: isMissing(progRes.error) ? [] : ((progRes.data ?? []) as Row[]).map((r) => programmeOf(r, items)),
    rules: isMissing(rulesRes.error) ? [] : ((rulesRes.data ?? []) as Row[]).map(ruleOf),
    links: trackerLinks(profile.error ? null : profile.data?.planning ?? null),
  }
}

/** The Your week card's "📌 Rules this week: …" line (null when there are none, or before tracker.sql). */
export async function weekRulesLine(sb: SupabaseClient, from: string, to: string): Promise<string | null> {
  const { data, error } = await sb.from('plan_rules').select(RULE_COLS).is('archived_at', null).lte('starts_on', to).gte('ends_on', from).order('ends_on')
  if (error) return null
  return rulesWeekLine(((data ?? []) as Row[]).map(ruleOf), from, to)
}
