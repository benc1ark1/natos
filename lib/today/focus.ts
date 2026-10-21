// What may be planned on a day (fix round, plans/fix-round.md), by plain code, for Your week and Today alike:
// - Not before: a task's window_start ("don't start before Mon 26 Oct"): nothing for it before that date.
// - Later (status this_month): never planned, unless it's due within the days being planned.
// - A focus period: planning.focusPeriods [{ from, until, only }] ("until 25 Oct only ACT"): on those days only that
//   work is planned; it ends by itself after `until` (nothing to undo).
// - A test day (a test on a day without school: the ACT on Sun 25 Oct): nothing but the test; the day before: light.
// - App ideas are requests for Claude Code (app_ideas, /ideas): a task that is one is never planned.
// Pure: no database, no clock.
import type { PlanItem } from '../plan'
import { addDays, dowShort, shortDate } from '../time'

export type FocusPeriod = { from: string; until: string; only: string }

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** His focus periods (odd entries left out). */
export function focusPeriods(planning: unknown): FocusPeriod[] {
  const raw = planning && typeof planning === 'object' ? (planning as Record<string, unknown>).focusPeriods : null
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is FocusPeriod => !!p && typeof p === 'object' && ISO.test(String((p as FocusPeriod).until)) && typeof (p as FocusPeriod).only === 'string' && !!(p as FocusPeriod).only.trim())
    .map((p) => ({ from: ISO.test(String(p.from)) ? p.from : '0000-01-01', until: p.until, only: p.only.trim() }))
}

/** The focus period on this day, if any (the first one he set wins). */
export const focusOn = (planning: unknown, date: string): FocusPeriod | null => focusPeriods(planning).find((p) => p.from <= date && date <= p.until) ?? null

/** Is this work what the focus is on? Its subject, or the focus's name in its title ("ACT" as a word, case kept for short names). */
export function inFocus(f: Pick<FocusPeriod, 'only'>, x: { title: string; subject?: string | null }): boolean {
  const only = f.only.trim()
  if (x.subject && x.subject.trim().toLowerCase() === only.toLowerCase()) return true
  const re = new RegExp(`\\b${only.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, only.length <= 4 && only === only.toUpperCase() ? '' : 'i')
  return re.test(x.title)
}

/** "only ACT until Sun 25 Oct" */
export const focusWords = (f: FocusPeriod) => `only ${f.only} until ${dowShort(f.until)} ${shortDate(f.until)}`

type TaskLike = { title: string; status: string; window_start?: string | null; due_at?: string | null; window_end?: string | null; source_text?: string | null }

/** Before the date he said it can start. */
export const notYet = (t: { window_start?: string | null }, date: string) => !!t.window_start && date < t.window_start.slice(0, 10)

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** A task that is really one of his App ideas (the same message, or the idea's own words as its title). */
export function isAppIdea(t: TaskLike, ideas: { request: string; source_text?: string | null }[]): boolean {
  const title = norm(t.title), src = norm(t.source_text ?? '')
  return ideas.some((i) => (!!src && !!i.source_text && norm(i.source_text) === src) || (title.length >= 8 && norm(i.request) === title))
}

/** A test that takes the day: one on a day without school (a weekend or a holiday). date → its title. */
export function testDays(goals: { kind: string; title: string; target_date: string | null }[], schoolDay: (date: string) => boolean): Map<string, string> {
  const out = new Map<string, string>()
  for (const g of goals) if (g.kind === 'test' && g.target_date && !schoolDay(g.target_date) && !out.has(g.target_date)) out.set(g.target_date, g.title)
  return out
}

export type Pause = { names: string[]; until: string }
export type DayRules = { focus: FocusPeriod | null; test: string | null; eve: string | null; paused?: Pause[] }
/** The study tracker's dated rules (plan_rules, lib/tracker/bot-fast.ts): "pause physics until 25 Oct", "focus on ACT until 25 Oct". */
export type TrackerRule = { kind: string; target: string; words: string; startsOn: string; endsOn: string }

/** The subjects a tracker rule's target names (null: not a whole subject, e.g. "getting ahead"). */
function ruleSubjects(target: string): string[] | null {
  const [head, ...rest] = target.trim().split(':')
  const arg = rest.join(':').trim()
  switch (head.toLowerCase()) {
    case 'act': return ['ACT']
    case 'physics': return ['Physics']
    case 'maths': case 'math': return ['Maths', 'Further Maths', 'FM']
    case 'subject': return arg ? [arg] : null
    case 'subjects': { const l = arg.split(/\s*,\s*|\s*\+\s*/).filter(Boolean); return l.length ? l : null }
    default: return null
  }
}

/**
 * What holds on this day: its focus period, a test that takes the day, or the day before one; and the tracker's live
 * rules the same way: a subject paused until a date is left out, and "focus on ACT until 25 Oct" (a top-priority rule
 * in those words) is a focus period too (one he set with focus_period wins).
 */
export function dayRules(planning: unknown, tests: Map<string, string>, date: string, tracker: TrackerRule[] = []): DayRules {
  const live = tracker.filter((r) => r.startsOn <= date && date <= r.endsOn)
  const paused = live.filter((r) => r.kind === 'pause').map((r) => ({ names: ruleSubjects(r.target) ?? [], until: r.endsOn })).filter((p) => p.names.length)
  const boost = live.find((r) => r.kind === 'boost' && /\b(?:focus|only)\b/i.test(r.words) && ruleSubjects(r.target)?.length === 1)
  const focus = focusOn(planning, date) ?? (boost ? { from: boost.startsOn, until: boost.endsOn, only: ruleSubjects(boost.target)![0] } : null)
  return { focus, test: tests.get(date) ?? null, eve: tests.get(addDays(date, 1)) ?? null, ...(paused.length ? { paused } : {}) }
}

/**
 * Why this can't go on this day (null: it can). `deadline` = the task's due date (if a task); `until` = the last day
 * being planned (Later work due by then may still be planned). `light`: hard thinking (focus) or not.
 */
export function blockedWhy(x: { title: string; subject?: string | null; heavy: boolean; task?: TaskLike | null; deadline?: string | null; ofTest?: boolean },
  date: string, rules: DayRules, opts: { until: string; ideas?: { request: string; source_text?: string | null }[]; later?: boolean }): string | null {
  const t = x.task
  if (t && opts.ideas?.length && isAppIdea(t, opts.ideas)) return 'an App idea, not a task'
  if (t && notYet(t, date)) return `not before ${dowShort(t.window_start!.slice(0, 10))} ${shortDate(t.window_start!.slice(0, 10))}`
  // (Today keeps what he put on it himself or starred: `later: false`; the week leaves Later out)
  if (t && opts.later !== false && t.status === 'this_month' && !(x.deadline && x.deadline <= opts.until)) return 'in Later'
  // (the test day keeps only the test's own light warm-up; the day before, nothing heavy, the test's work included)
  if (rules.test && (!x.ofTest || x.heavy)) return `${rules.test} today: nothing else`
  if (rules.eve && x.heavy) return `the day before ${rules.eve}: light only`
  const pause = rules.paused?.find((p) => p.names.some((n) => inFocus({ only: n }, x)))
  if (pause) return `${pause.names[0]} paused until ${dowShort(pause.until)} ${shortDate(pause.until)}`
  if (rules.focus && !inFocus(rules.focus, x)) return focusWords(rules.focus)
  return null
}

// ---------------------------------------------------------------------------
// Your week (lib/telegram/yourweek.ts): ACT free time, the card's lines and what the planner AI is told
// ---------------------------------------------------------------------------

export const ACT_FILL_WHY = 'ACT focus: free time'

/** Free time in an ACT focus period: ACT reading, grammar and ACT maths (one of each a day, after everything else). */
export const ACT_FILL = [
  { key: 'reading', title: 'ACT reading: timed passages + review', minutes: 40, open: 'Two Reading passages, timed → mark → every miss: why you missed it, logged' },
  { key: 'grammar', title: 'ACT grammar: rules + English questions', minutes: 30, open: 'Your rules list → 20 English questions, timed → mark each miss against its rule' },
  { key: 'maths', title: 'ACT maths: timed questions + review', minutes: 45, open: '15 ACT Maths questions, timed → mark → redo every miss without looking' },
] as const

export function actFillers(maxMin: number): PlanItem[] {
  return ACT_FILL.map((f) => ({ title: f.title, minutes: Math.max(20, Math.min(f.minutes, maxMin)), kind: 'focus', ref: null, why: ACT_FILL_WHY, subject: 'ACT' }))
}

/** Is this day's free time for ACT (an ACT focus period, not the test day or the day before)? */
export const actFillDay = (r: DayRules) => !!r.focus && /^act$/i.test(r.focus.only) && !r.test && !r.eve

const label = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`

/** The card's lines: the focus period this week, and what can't start yet ("⏳ From Mon 26 Oct: FM homework, …"). */
export function focusLines(planning: unknown, tasks: TaskLike[], from: string, to: string): string[] {
  const out = focusPeriods(planning).filter((f) => f.from <= to && f.until >= from).map((f) => `🎯 Focus: ${focusWords(f)}`)
  const waiting = new Map<string, string[]>()
  for (const t of tasks) {
    const s = t.window_start?.slice(0, 10)
    if (!s || s <= from || s > addDays(to, 7) || t.status === 'completed' || t.status === 'someday') continue
    waiting.set(s, [...(waiting.get(s) ?? []), t.title])
  }
  for (const [d, titles] of [...waiting].sort()) out.push(`⏳ From ${label(d)}: ${titles.slice(0, 3).join(', ')}${titles.length > 3 ? ` (+${titles.length - 3} more)` : ''}`)
  return out
}

/** What the planner AI is told about these days (so it doesn't pick what the app would leave out). '' when nothing applies. */
export function rulesForAI(dates: string[], rulesOf: (date: string) => DayRules, tasks: TaskLike[], until: string): string {
  const lines: string[] = []
  for (const d of dates) {
    const r = rulesOf(d)
    if (r.eve) lines.push(`${label(d)}: the day before ${r.eve}: light items only.`)
    else if (r.focus) lines.push(`${label(d)}: focus period: only ${r.focus.only} work.`)
  }
  const first = dates[0] ?? until
  const later = tasks.filter((t) => t.window_start && t.window_start.slice(0, 10) > first).map((t) => `"${t.title}" not before ${label(t.window_start!.slice(0, 10))}`)
  if (later.length) lines.push(`Not before (never on an earlier day): ${later.join('; ')}.`)
  lines.push(`Tasks in Later: only if due by ${label(until)}. App ideas are never tasks.`)
  return `\nRules the app enforces:\n${lines.map((l) => `- ${l}`).join('\n')}`
}

// ---------------------------------------------------------------------------
// The bot's focus_period change (lib/telegram/actions-c2.ts): "until 25 Oct only ACT" → planning.focusPeriods
// ---------------------------------------------------------------------------

const kv = (v: string) => Object.fromEntries(v.split(';').map((x) => x.split('=').map((y) => y.trim())).filter((x) => x.length === 2 && x[0]).map(([k, x]) => [k.toLowerCase(), x]))
const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** value "until=2026-10-25; only=ACT" (optional "from=…"), or "clear=yes" (every focus period off). Ended ones are dropped. */
export function focusChange(value: string, planning: unknown, today: string): { problem?: string; change?: { key: string; title: string; line: string; patch: Record<string, unknown> } } {
  const v = kv(value)
  const now = focusPeriods(planning).filter((p) => p.until >= today)
  if (/^(yes|true)$/i.test(v.clear ?? '')) {
    if (!now.length) return { problem: 'there’s no focus period to end' }
    return { change: { key: 'focusPeriods', title: 'Focus period', line: `🎯 Focus period: ${escH(now.map(focusWords).join('; '))} → <b>ended</b> <i>(everything is planned again)</i>`, patch: { focusPeriods: [] } } }
  }
  const until = v.until ?? '', only = (v.only ?? '').slice(0, 40)
  if (!ISO.test(until) || until < today) return { problem: 'until which date is the focus?' }
  if (until > addDays(today, 120)) return { problem: 'a focus period is at most 4 months: until which date?' }
  if (!only) return { problem: 'what is the focus on (e.g. ACT)?' }
  const from = ISO.test(v.from ?? '') && v.from! <= until ? v.from! : today
  if (now.some((p) => p.only.toLowerCase() === only.toLowerCase() && p.until === until && p.from <= from)) return { problem: `you’re already on ${focusWords({ from, until, only })}` }
  // a new focus replaces the ones it overlaps (one focus a day)
  const kept = now.filter((p) => p.until < from || p.from > until)
  const f = { from, until, only }
  return { change: { key: 'focusPeriods', title: 'Focus period', line: `🎯 Focus: <b>${escH(focusWords(f))}</b>${from > today ? ` <i>(from ${label(from)})</i>` : ''} <i>(only that is planned; then everything else again)</i>`, patch: { focusPeriods: [...kept, f] } } }
}
