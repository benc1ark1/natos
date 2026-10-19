// Server-only: ACT records as Nat (row level security) (plans/contracts.md §5): the ACT subject, the retake date (a test
// goal with test_kind 'act'), scores (act_scores), the books (programmes with area 'act' + their items), the open
// misses (mistakes on the ACT subject) and what's already done today. Works before supabase/tracker.sql and
// supabase/act.sql have run: the missing parts are empty and `missing` names the file to run.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dateISOOf } from '../time'
import { afterRedo } from '../tracker/rules'
import type { Programme, ProgrammeItem, TrackerMistake } from '../tracker/types'
import { actSettings } from './config'
import { roleOf } from './books'
import { missSection } from './engine'
import type { ActScore, ActWorld } from './types'

export type ActGoalRow = { id: string; title: string; target_date: string; subject_id: string | null; test_kind?: string | null; status?: string | null }
export type ActSubjectRow = { id: string; name: string; archived_at: string | null; category_id: string | null }

export type ActRows = {
  missing: string[]                          // SQL files not run yet ('supabase/act.sql', 'supabase/tracker.sql')
  planning: unknown
  subject: ActSubjectRow | null              // the ACT subject (a live one first; an archived one can be restored)
  categories: { id: string; name: string }[]
  goals: ActGoalRow[]                        // live ACT test goals, soonest first (past ones too)
  scores: (ActScore & { createdOn: string })[]
  books: Programme[]
  positions: Record<string, number[]>        // per book: every item position, archived ones included (positions are unique)
  misses: TrackerMistake[]                   // open ACT misses
  hasTestKind: boolean                       // goals.test_kind exists (supabase/tracker.sql)
  world: ActWorld
}

const isMissing = (e: { message?: string; code?: string } | null) =>
  !!e && (/does not exist|could not find|schema cache/i.test(e.message ?? '') || e.code === '42P01' || e.code === '42703' || e.code === 'PGRST204' || e.code === 'PGRST205')

export const toItem = (r: Record<string, unknown>): ProgrammeItem => ({
  id: String(r.id), programmeId: String(r.programme_id), position: Number(r.position), title: String(r.title), details: (r.details as string) ?? null,
  url: (r.url as string) ?? null, minutes: r.minutes == null ? null : Number(r.minutes), status: (r.status as ProgrammeItem['status']) ?? 'todo',
  doneOn: (r.done_on as string) ?? null, result: (r.result as string) ?? null, score: r.score == null ? null : Number(r.score), outOf: r.out_of == null ? null : Number(r.out_of),
})

export const toProgramme = (r: Record<string, unknown>, items: ProgrammeItem[]): Programme => ({
  id: String(r.id), name: String(r.name), area: (r.area as Programme['area']) ?? 'act', subjectId: (r.subject_id as string) ?? null,
  perWeek: Number(r.per_week ?? 1), minutes: Number(r.minutes ?? 60), days: (r.days as string) ?? null, startsOn: (r.starts_on as string) ?? null,
  endsOn: (r.ends_on as string) ?? null, status: (r.status as Programme['status']) ?? 'active', pausedUntil: (r.paused_until as string) ?? null,
  mode: (r.mode as Programme['mode']) ?? 'in_order', notes: (r.notes as string) ?? null, items,
})

const toMistake = (r: Record<string, unknown>): TrackerMistake => ({
  id: String(r.id), goalId: (r.goal_id as string) ?? null, topicId: (r.topic_id as string) ?? null, subjectId: (r.subject_id as string) ?? null,
  code: (r.code as string) ?? null, question: (r.question as string) ?? null, body: String(r.body ?? ''), kind: (r.kind as TrackerMistake['kind']) ?? null,
  rule: (r.rule as string) ?? null, source: (r.source as string) ?? null, loggedOn: String(r.logged_on), reviewOn: String(r.review_on),
  redoStage: Number(r.redo_stage ?? 0), reviewedAt: (r.reviewed_at as string) ?? null,
})

/** Is this test goal the ACT? test_kind 'act', or a test on the ACT subject (never by its title: "Act 2 essay" isn't the ACT). */
export const isActGoal = (g: ActGoalRow, subjectId: string | null) =>
  g.test_kind === 'act' || (!!subjectId && g.subject_id === subjectId)

/** Everything the ACT plug-in and planner need, read in parallel. */
export async function loadActRows(sb: SupabaseClient, today: string): Promise<ActRows> {
  const missing = new Set<string>()
  const goalsQ = async (): Promise<{ rows: ActGoalRow[]; hasTestKind: boolean }> => {
    const a = await sb.from('goals').select('id,title,target_date,subject_id,test_kind,status').eq('kind', 'test').is('archived_at', null).order('target_date')
    if (!a.error) return { rows: (a.data ?? []) as ActGoalRow[], hasTestKind: true }
    if (!isMissing(a.error)) throw new Error(`Couldn’t read your tests: ${a.error.message}`)
    missing.add('supabase/tracker.sql')
    const b = await sb.from('goals').select('id,title,target_date,subject_id,status').eq('kind', 'test').is('archived_at', null).order('target_date')
    if (b.error) throw new Error(`Couldn’t read your tests: ${b.error.message}`)
    return { rows: (b.data ?? []) as ActGoalRow[], hasTestKind: false }
  }
  const [profile, subjects, categories, goals, scores, progs, blocks] = await Promise.all([
    sb.from('profiles').select('planning').maybeSingle(),
    sb.from('subjects').select('id,name,archived_at,category_id').ilike('name', 'act'),
    sb.from('categories').select('id,name').order('created_at'),
    goalsQ(),
    sb.from('act_scores').select('id,taken_on,kind,english,maths,reading,science,composite,created_at').is('archived_at', null).order('taken_on').order('created_at'),
    sb.from('programmes').select('id,name,area,subject_id,per_week,minutes,days,starts_on,ends_on,status,paused_until,mode,notes,sort_order').eq('area', 'act').is('archived_at', null).order('sort_order').order('created_at'),
    sb.from('plan_blocks').select('pick_key,status').eq('on_date', today).like('pick_key', 'act:%'),
  ])
  if (subjects.error) throw new Error(`Couldn’t read your subjects: ${subjects.error.message}`)
  const subjRows = (subjects.data ?? []) as ActSubjectRow[]
  const subject = subjRows.find((s) => !s.archived_at) ?? subjRows[0] ?? null
  const liveSubjectId = subject && !subject.archived_at ? subject.id : null

  if (scores.error && !isMissing(scores.error)) throw new Error(`Couldn’t read your ACT scores: ${scores.error.message}`)
  if (scores.error) missing.add('supabase/act.sql')
  if (progs.error && !isMissing(progs.error)) throw new Error(`Couldn’t read your ACT books: ${progs.error.message}`)
  if (progs.error) missing.add('supabase/tracker.sql')

  const progRows = (progs.error ? [] : progs.data ?? []) as Record<string, unknown>[]
  const ids = progRows.map((p) => String(p.id))
  const [items, misses] = await Promise.all([
    ids.length ? sb.from('programme_items').select('*').in('programme_id', ids).order('position') : Promise.resolve({ data: [], error: null }),
    loadMisses(sb, liveSubjectId, missing),
  ])
  if (items.error) throw new Error(`Couldn’t read your ACT book chapters: ${items.error.message}`)
  const allItems = (items.data ?? []) as Record<string, unknown>[]
  const positions: Record<string, number[]> = {}
  for (const r of allItems) (positions[String(r.programme_id)] ??= []).push(Number(r.position))
  const books = progRows.map((p) => toProgramme(p, allItems.filter((i) => String(i.programme_id) === String(p.id) && !i.archived_at).map(toItem)))

  const planning = profile.error ? null : profile.data?.planning ?? null
  const set = actSettings(planning)
  const scoreRows = ((scores.error ? [] : scores.data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id), takenOn: String(r.taken_on), kind: r.kind as ActScore['kind'],
    english: r.english as number | null, maths: r.maths as number | null, reading: r.reading as number | null, science: r.science as number | null,
    composite: r.composite as number | null, createdOn: dateISOOf(String(r.created_at)),
  }))
  const actGoals = goals.rows.filter((g) => isActGoal(g, liveSubjectId)).sort((a, b) => Number(b.test_kind === 'act') - Number(a.test_kind === 'act') || a.target_date.localeCompare(b.target_date))
  const next = actGoals.filter((g) => g.target_date >= today).sort((a, b) => a.target_date.localeCompare(b.target_date))[0] ?? null

  // done today: a ticked ACT pick (Today), an ACT book chapter finished today, or a practice score logged today
  const doneToday = new Set<string>()
  for (const b of (blocks.error ? [] : blocks.data ?? []) as { pick_key: string; status: string }[]) if (b.status === 'done') { doneToday.add(b.pick_key); doneToday.add('act:day') }
  // (a skipped chapter isn't work, and a College Panda chapter test with full marks moves straight on to the next test)
  if (books.some((b) => roleOf(b) !== 'flashcards' && b.items.some((i) => i.doneOn === today && i.status === 'done'))) doneToday.add('act:day')
  if (scoreRows.some((s) => s.kind !== 'real' && s.createdOn === today)) doneToday.add('act:day')

  const world: ActWorld = {
    today, retake: next ? { goalId: next.id, date: next.target_date } : null, goal: set.goal,
    scores: scoreRows.map(({ createdOn: _c, ...s }) => s), books, misses, doneToday: [...doneToday],
    settings: { halfTermMin: set.halfTermMin, schoolMin: set.schoolMin, schoolDays: set.schoolDays, flashMin: set.flashMin, fullTestDow: set.fullTestDow, mockDow: set.mockDow, science: set.science },
    subjectId: liveSubjectId,
  }
  return {
    missing: [...missing], planning, subject, categories: (categories.data ?? []) as { id: string; name: string }[], goals: actGoals, scores: scoreRows,
    books, positions, misses, hasTestKind: goals.hasTestKind, world,
  }
}

/** Open ACT misses: on the ACT subject, or saved with an "ACT …" source. */
async function loadMisses(sb: SupabaseClient, subjectId: string | null, missing: Set<string>): Promise<TrackerMistake[]> {
  type Res = { data: unknown[] | null; error: { message: string; code?: string } | null }
  const none: Res = { data: [], error: null }
  const base = (c: string) => sb.from('mistakes').select(c).is('archived_at', null).is('reviewed_at', null)
  const cols = 'id,goal_id,topic_id,subject_id,code,question,body,kind,rule,source,logged_on,review_on,redo_stage,reviewed_at'
  let [a, b] = (await Promise.all([subjectId ? base(cols).eq('subject_id', subjectId) : none, base(cols).ilike('source', 'ACT %')])) as Res[]
  if ((a.error && isMissing(a.error)) || (b.error && isMissing(b.error))) {
    // before supabase/tracker.sql: no rule / source / redo columns yet, so only the subject's misses
    missing.add('supabase/tracker.sql')
    a = (subjectId ? await base('id,subject_id,topic_id,body,logged_on,review_on,reviewed_at').eq('subject_id', subjectId) : none) as Res
    b = none
  }
  if (a.error) throw new Error(`Couldn’t read your ACT misses: ${a.error.message}`)
  if (b.error) throw new Error(`Couldn’t read your ACT misses: ${b.error.message}`)
  const seen = new Map<string, TrackerMistake>()
  for (const r of [...(a.data ?? []), ...(b.data ?? [])] as Record<string, unknown>[]) seen.set(String(r.id), toMistake(r))
  return [...seen.values()].filter((m) => m.redoStage < 2).sort((x, y) => x.loggedOn.localeCompare(y.loggedOn))
}

/** Everything the ACT planner needs for `today` (plans/contracts.md §5). */
export async function loadActWorld(sb: SupabaseClient, today: string): Promise<ActWorld> {
  return (await loadActRows(sb, today)).world
}

/**
 * For Today (lib/today): when an ACT pick is ticked, the misses its redo step listed move on a stage (redo +3 days,
 * then ~1 week, then done; lib/tracker/rules.ts) — only for a pick that had the redo step (its key ends ':redo').
 * Countdown picks cover every section; a steady pick its own section. Book items move on through the pick's `done`
 * hint (programme_item) as usual. Returns how many misses moved.
 */
export async function markActPickDone(sb: SupabaseClient, pickKey: string, today: string): Promise<number> {
  if (!pickKey.startsWith('act:') || !pickKey.endsWith(':redo')) return 0
  const rows = await loadActRows(sb, today)
  const section = pickKey.split(':')[1]
  const due = rows.misses.filter((m) => m.reviewOn <= today && (rows.world.retake || missSection(m) === section))
  let n = 0
  for (const m of due) {
    const next = afterRedo(m.redoStage, today)
    const { error } = await sb.from('mistakes').update(next.stage >= 2
      ? { redo_stage: 2, reviewed_at: new Date().toISOString() }
      : { redo_stage: next.stage, review_on: next.reviewOn }).eq('id', m.id).eq('redo_stage', m.redoStage).select('id').single()
    if (!error) n++
  }
  return n
}
