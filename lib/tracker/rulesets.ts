// Temporary rules (plans/contracts.md §3.6): "ACT top priority this week" (boost), "pause getting ahead until 25 Oct"
// (pause), "maths + physics 45 min/day this week" (cap), or just a note. A rule counts only while starts_on ≤ day ≤ ends_on
// — after that it simply stops counting (auto-expiry, nothing is deleted). Which picks a rule's target covers:
//   act · ahead · stretch · reviews (topic reviews + mistake redos) · mistakes · tests · fix / fixing · current · old ·
//   programmes · programme:<name> · physics · maths (= Maths + Further Maths) · subject:<name> · subjects:<a>,<b> · topic:<code>
// Homework is never paused, boosted or capped (it's always first and never dropped for time). Pure: no database, no clock.
import type { Pick as PlanPick } from '../plan-items'
import { dowShort, shortDate } from '../time'
import type { PlanRule } from './types'

/** Extra facts about a pick that its fields don't carry. */
export type PickMeta = { programme?: string | null; code?: string | null }

export const isLive = (r: Pick<PlanRule, 'startsOn' | 'endsOn'>, date: string) => r.startsOn <= date && date <= r.endsOn
export const liveRules = (rules: PlanRule[], date: string) => rules.filter((r) => isLive(r, date))

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const MATHS = new Set(['maths', 'math', 'mathematics'])
const FURTHER = new Set(['further maths', 'further mathematics', 'fm', 'further'])

/** Does a subject name in a rule cover the pick's subject? "maths" covers Maths + Further Maths. */
export function subjectCovers(said: string, subject: string | null | undefined): boolean {
  const a = norm(said), b = norm(subject)
  if (!a || !b) return false
  if (MATHS.has(a)) return MATHS.has(b) || FURTHER.has(b)
  if (FURTHER.has(a)) return FURTHER.has(b)
  return a === b
}

export const isAct = (p: Pick<PlanPick, 'subject' | 'kind' | 'key'>) => norm(p.subject) === 'act' || p.kind === 'act' || p.kind === 'flashcards' || p.key.startsWith('act:')
const TEST_KINDS = new Set(['test_diagnostic', 'test_booklet', 'test_topic', 'test_timed', 'test_light', 'consolidation'])

/** Is this pick covered by a rule's target? (The planner, and the "📌 Rules this week" line: what a rule touches.) */
export function targetMatches(target: string, p: PlanPick, meta: PickMeta = {}): boolean {
  if (p.kind === 'homework') return false
  const t = norm(target)
  const [head, ...rest] = t.split(':')
  const arg = rest.join(':').trim()
  switch (head) {
    case 'act': return isAct(p)
    case 'ahead': return p.kind === 'ahead'
    case 'stretch': return p.kind === 'stretch'
    case 'reviews': case 'review': return p.kind === 'review' || p.kind === 'mistake_redo'
    case 'mistakes': case 'mistake': return p.kind === 'mistake_redo'
    case 'tests': case 'test': return TEST_KINDS.has(p.kind)
    case 'fix': case 'fixing': return p.kind === 'fix'
    case 'current': return p.kind === 'current'
    case 'old': return p.kind === 'old'
    case 'programmes': return p.kind === 'programme'
    case 'programme': return p.kind === 'programme' && !!arg && !!meta.programme && norm(meta.programme).startsWith(arg)
    case 'physics': return subjectCovers('physics', p.subject)
    case 'maths': case 'math': return subjectCovers('maths', p.subject)
    case 'subject': return !!arg && subjectCovers(arg, p.subject)
    case 'subjects': return arg.split(/\s*,\s*|\s*\+\s*|\s+and\s+/).filter(Boolean).some((s) => subjectCovers(s, p.subject))
    case 'topic': return !!arg && !!meta.code && norm(meta.code) === arg
    default: return false
  }
}

const first = (rules: PlanRule[], kind: PlanRule['kind'], p: PlanPick, meta?: PickMeta) =>
  rules.find((r) => r.kind === kind && targetMatches(r.target, p, meta)) ?? null

/** The live pause rule that removes this pick (null = it stays). `rules` must already be the live ones. */
export const pausedBy = (rules: PlanRule[], p: PlanPick, meta?: PickMeta) => first(rules, 'pause', p, meta)
/** The live boost rule that moves this pick right after homework. */
export const boostedBy = (rules: PlanRule[], p: PlanPick, meta?: PickMeta) => first(rules, 'boost', p, meta)
/** Live caps: minutes a day for the picks their target covers (the higher priorities get the minutes first). */
export const capRules = (rules: PlanRule[]) => rules.filter((r) => r.kind === 'cap' && r.minutes != null && r.minutes >= 0)

/** Is an optional programme asked for (a live boost on it)? */
export const programmeBoosted = (rules: PlanRule[], name: string) => {
  const n = norm(name)
  return !!n && rules.some((r) => {
    const arg = norm(r.target.trim().slice(10))
    return r.kind === 'boost' && /^programme:/i.test(r.target.trim()) && !!arg && n.startsWith(arg)
  })
}

/** "getting ahead", "ACT", "Maths, Physics", "STEP" — the target in his words. */
export function targetLabel(target: string): string {
  const t = target.trim()
  const [head, ...rest] = t.split(':')
  const arg = rest.join(':').trim()
  switch (head.toLowerCase()) {
    case 'act': return 'ACT'
    case 'ahead': return 'getting ahead'
    case 'stretch': return 'stretch'
    case 'reviews': case 'review': return 'reviews'
    case 'mistakes': return 'mistake redos'
    case 'tests': return 'test prep'
    case 'fix': case 'fixing': return 'fixing 🔴/🟡'
    case 'current': return 'current topics'
    case 'old': return 'keeping old topics fresh'
    case 'programmes': return 'programmes'
    case 'physics': return 'Physics'
    case 'maths': return 'Maths + Further Maths'
    case 'subjects': return arg.split(/\s*,\s*/).filter(Boolean).join(' + ')
    default: return arg || t
  }
}

/** One line for the "📌 Rules this week" line (Your week card, /rules) and the plan's notes: "paused: getting ahead until Sun 25 Oct". */
export function ruleNote(r: PlanRule): string {
  const until = `until ${dowShort(r.endsOn)} ${shortDate(r.endsOn)}`
  const what = targetLabel(r.target)
  if (r.kind === 'pause') return `paused: ${what} ${until}`
  if (r.kind === 'boost') return `top priority: ${what} ${until}`
  if (r.kind === 'cap') return `cap: ${what} ${r.minutes} min/day ${until}`
  return `${r.words} (${until})`
}
