// Today (queue item 5, plans/contracts.md §8): at most 5 things for the day, in time order, each with the exact thing
// to open, how long, why, and what "done" moves forward; one short line for the fixed commitments; "+N more" for the
// rest. Homework first, then the planner's order (lib/tracker/engine.ts + ACT); training counts as one item. Items go
// into real free time by lib/plan.ts's rules (buffers, nothing heavy late, focused work capped, the most important
// first while he's fresh). Pure: no database, no clock, no AI.
import type { DoneHint, Pick } from '../plan-items'
import { TIER } from '../plan-items'
import { placeItems, type Energy, type PlanItem } from '../plan'
import { toHHMM, type PlanningSettings, type Slot } from '../freetime'
import { addDays, dowShort, minutesOf } from '../time'

export const DEFAULT_ITEMS = 5
export const MIN_ITEMS = 3
export const MAX_ITEMS = 5

export type TodayItemKind = 'study' | 'task' | 'training'

export type TodayItem = {
  key: string                 // the planner's key ('task:<id>', 'topic:<id>:ahead', 'training:<date>')
  at: string | null           // HH:MM it starts (null: no free time for it today)
  end: string | null
  title: string
  open: string                // the exact thing to open
  url: string | null
  minutes: number
  why: string
  done: DoneHint              // what ticking it moves forward
  kind: TodayItemKind
  heavy: boolean
  subject: string | null
  rolledFrom: string | null   // not done that day, so it rolled on to today
  isDone: boolean
  blockIds: string[]          // its saved plan blocks (empty until saved)
  taskId: string | null
  topicId: string | null
  goalId: string | null
  programmeItemId: string | null
  targetId: string | null
  shortened?: boolean         // cut to fit the free time it has
  fixed?: boolean             // item 18: a fixed training session (his set time): only then is its clock time shown
  fixedAt?: string            // that fixed session's start (a planner-placed session merged before it doesn't move it)
}

export type HiddenItem = { key: string; title: string; open: string; minutes: number; why: string }

export type TodayPlan = {
  date: string
  mode: 'half_term' | 'school'
  items: TodayItem[]          // ≤ his todayItems setting (default 5), in time order
  fixed: string               // "🏫 School 08:45–16:00 · ⚽ Football 19:45" ('' when nothing is booked)
  more: number                // the "+N more" count
  hidden: HiddenItem[]        // what "+N more" is (/today all, and the web's collapsed list)
  noTime: boolean             // no free time today: only the most important 1–2 are shown
  note: string | null
  source: 'auto' | 'his' | 'new'   // a saved Today list, his own applied plan, or not saved yet
}

/** A training session today (an applied block, or where the week optimiser puts it). Already has its time. */
export type TrainingIn = { title: string; start: string; end: string; blockIds: string[]; targetId: string | null; open: string; done: boolean; cutFrom?: string; cutTo?: string
  fixed?: boolean }           // at his set time for it (lib/today/fixed.ts), not a time the planner chose
/** A fixed commitment (school, football, an event) for the one-line summary. */
export type FixedIn = { at: string | null; end: string | null; title: string; icon: string; school?: boolean }
/** Something not done on an earlier day: it rolls on when the planner picks it again. */
export type Rolled = { key: string | null; title: string; from: string }

export type TodayInput = {
  date: string
  mode: 'half_term' | 'school'
  slots: Slot[]               // free time for study (events, travel, buffers and routines already taken off), best first
  settings: PlanningSettings
  budget: number | null       // focused minutes allowed today (a school night), null = no limit
  energy: Energy
  picks: Pick[]               // the planner's picks, in its order (homework first)
  tasks: Pick[]               // must-do tasks that aren't the planner's (due today / overdue: tier 1; on Today: later)
  training: TrainingIn[]
  fixed: FixedIn[]
  max: number                 // his todayItems setting
  rolled: Rolled[]
  rolledPicks?: Pick[]        // yesterday's not-done items as picks: they come back straight after homework
}

export const clampItems = (n: unknown) => (Number.isInteger(n) ? Math.min(MAX_ITEMS, Math.max(MIN_ITEMS, n as number)) : DEFAULT_ITEMS)

/** Hard thinking (placed while fresh, never late, counted against a school night's focus limit)? */
export const heavyOf = (p: Pick) => p.heavy ?? (p.kind !== 'flashcards' && p.kind !== 'test_light' && p.minutes >= 20)

/**
 * Homework first, then what rolled on from yesterday (not ticked, so it comes back — the planner's fresher version when
 * it picked it again), then the planner's order: homework picks · tasks due today · rolled · the planner's other picks ·
 * tasks on Today.
 */
export function candidates(picks: Pick[], tasks: Pick[], rolled: Pick[] = []): Pick[] {
  const seen = new Set<string>()
  const ids = new Set<string>()
  const out: Pick[] = []
  const add = (p: Pick) => {
    const tid = p.taskId ?? (p.done.kind === 'task' ? p.done.taskId : null)
    if (seen.has(p.key) || (tid && ids.has(tid))) return
    seen.add(p.key)
    if (tid) ids.add(tid)
    out.push(p)
  }
  picks.filter((p) => p.tier <= TIER.homework).forEach(add)
  tasks.filter((p) => p.tier <= TIER.homework).forEach(add)
  for (const r of rolled) add(picks.find((p) => p.key === r.key) ?? tasks.find((p) => p.key === r.key) ?? r)
  picks.filter((p) => p.tier > TIER.homework).forEach(add)
  tasks.filter((p) => p.tier > TIER.homework).forEach(add)
  return out
}

const itemOf = (date: string, p: Pick, at: string | null, end: string | null, rolled: Rolled[]): TodayItem => {
  const r = rolled.find((x) => (x.key && x.key === p.key) || (!x.key && x.title === p.title))
  const minutes = at && end ? minutesOf(end) - minutesOf(at) : p.minutes
  const taskId = p.taskId ?? (p.done.kind === 'task' ? p.done.taskId : null)
  return {
    key: p.key, at, end, title: p.title, open: p.open, url: p.url ?? null, minutes,
    why: r ? [r.from === addDays(date, -1) ? 'from yesterday' : `from ${dowShort(r.from)}`, p.why].filter(Boolean).join(' · ') : p.why,
    done: p.done, kind: p.done.kind === 'task' ? 'task' : 'study', heavy: heavyOf(p), subject: p.subject ?? null,
    rolledFrom: r?.from ?? null, isDone: false, blockIds: [], taskId, topicId: p.topicId ?? (p.done.kind === 'topic' ? p.done.topicId : null),
    goalId: p.goalId ?? (p.done.kind === 'attempt' ? p.done.goalId : null), programmeItemId: p.programmeItemId ?? (p.done.kind === 'programme_item' ? p.done.itemId : null),
    targetId: null,
  }
}

/** Today's training as one item ("Upper @ PureGym + Core"), from its first start to its last end. */
export function trainingItem(date: string, list: TrainingIn[]): TodayItem | null {
  if (!list.length) return null
  const s = [...list].sort((a, b) => a.start.localeCompare(b.start))
  const minutes = s.reduce((a, t) => a + Math.max(0, minutesOf(t.end) - minutesOf(t.start)), 0)
  // one session: its title (with the place) and when to leave; several: their names, then each one's details
  const name = (t: TrainingIn) => t.title.replace(/ @ .*$/, '').replace(/ · (light|moderate|heavy)$/, '')
  const title = s.length === 1 ? s[0].title : s.map(name).join(' + ')
  const open = s.length === 1 ? s[0].open : s.map((t) => (t.open ? `${t.title} (${t.open})` : t.title)).join(' · ')
  return {
    key: `training:${date}`, at: s[0].start, end: s.at(-1)!.end, title,
    open, url: null, minutes, why: '', done: { kind: 'block' }, kind: 'training', heavy: true,
    subject: null, rolledFrom: null, isDone: s.every((t) => t.done), blockIds: s.flatMap((t) => t.blockIds), taskId: null, topicId: null, goalId: null,
    programmeItemId: null, targetId: s.find((t) => t.targetId)?.targetId ?? null,
    // fixed when any session in it is at his set time; the clock shows that session's start, not the first one's
    fixed: s.some((t) => t.fixed), ...(s.some((t) => t.fixed) ? { fixedAt: s.find((t) => t.fixed)!.start } : {}),
  }
}

/** Free slots with some minute ranges taken out (15-minute crumbs dropped). */
export function cutSlots(slots: Slot[], cuts: [number, number][], s: { heavyUntil: string }): Slot[] {
  let parts = slots.map((x) => [minutesOf(x.start), minutesOf(x.end)] as [number, number])
  for (const [a, b] of cuts) parts = parts.flatMap(([x, y]) => (b <= x || a >= y ? [[x, y] as [number, number]] : [[x, Math.min(a, y)], [Math.max(b, x), y]] as [number, number][]))
  const heavy = minutesOf(s.heavyUntil)
  return parts.filter(([x, y]) => y - x >= 15).map(([x, y]) => ({ start: toHHMM(x), end: toHHMM(y), minutes: y - x, heavyMinutes: Math.max(0, Math.min(y, heavy) - x) }))
}

/** The fixed commitments as one short line: "🏫 School 08:45–16:00 · ⚽ Football training 19:45". */
export function fixedLine(fixed: FixedIn[]): string {
  const list = [...fixed].sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''))
  const parts = list.map((f) => `${f.icon ? `${f.icon} ` : ''}${f.title}${f.at ? ` ${f.school && f.end ? `${f.at}–${f.end}` : f.at}` : ''}`)
  return parts.length > 5 ? `${parts.slice(0, 4).join(' · ')} · +${parts.length - 4}` : parts.join(' · ')
}

const round5 = (m: number) => Math.round(m / 5) * 5

/** Today's list: training (as one item) plus the most important picks that fit his free time, in time order. */
export function buildToday(input: TodayInput): TodayPlan {
  const max = clampItems(input.max)
  const train = trainingItem(input.date, input.training)
  const s = input.settings
  // study goes around training (its travel and a buffer either side)
  const cuts = input.training.map((t) => [minutesOf(t.cutFrom ?? t.start) - s.bufferMin, minutesOf(t.cutTo ?? t.end) + s.bufferMin] as [number, number])
  const slots = cutSlots(input.slots, cuts, s)
  const cands = candidates(input.picks, input.tasks, input.rolledPicks ?? [])
  const free = slots.reduce((a, x) => a + x.minutes, 0)
  const base = { date: input.date, mode: input.mode, fixed: fixedLine(input.fixed), source: 'new' as const }
  const hide = (ps: Pick[]): HiddenItem[] => ps.map((p) => ({ key: p.key, title: p.title, open: p.open, minutes: p.minutes, why: p.why }))

  // no free time: say so, and only the most important one or two
  if (free < 15) {
    const top = cands.filter((p) => p.tier <= TIER.test)
    const room = train ? 1 : 2
    const shown = (top.length ? top : cands).slice(0, room)
    const items = [...(train ? [train] : []), ...shown.map((p) => itemOf(input.date, p, null, null, input.rolled))]
    const rest = cands.filter((p) => !shown.includes(p))
    return { ...base, items, more: rest.length, hidden: hide(rest), noTime: true,
      note: items.length ? `No free time today: just ${items.length === 1 ? 'this' : 'these'} if you can.` : 'No free time today.' }
  }

  const cap = max - (train ? 1 : 0)
  const chosen: PlanItem[] = []
  const items: TodayItem[] = []
  const hidden: Pick[] = []
  const opts = { budget: input.budget, energy: input.energy }
  const place = (p: Pick, minutes: number) => {
    const it: PlanItem = { title: p.key, minutes, kind: heavyOf(p) ? 'focus' : 'light', ref: { kind: 'pick', id: p.key }, ...(p.after ? { after: p.after } : {}) }
    const r = placeItems([...chosen, it], slots, s, opts)
    const b = r.blocks.find((x) => x.ref?.id === p.key)
    return b ? { it, b } : null
  }
  for (const p of cands) {
    if (items.length >= cap) { hidden.push(p); continue }
    let hit = place(p, p.minutes)
    let shortened = false
    // too long for any gap: a shorter version (at least half, at least 25 min) is better than nothing
    for (const f of [0.75, 0.5]) {
      if (hit || p.minutes < 40) break
      const m = round5(p.minutes * f)
      if (m < 25) break
      hit = place(p, m)
      shortened = !!hit
    }
    if (hit) {
      chosen.push(hit.it)
      const it = itemOf(input.date, p, hit.b.start, hit.b.end, input.rolled)
      items.push(shortened ? { ...it, shortened: true, why: [it.why, 'cut to fit today’s free time'].filter(Boolean).join(' · ') } : it)
    } else if (p.tier <= TIER.homework) {
      // homework is never dropped for time: shown without a time
      items.push({ ...itemOf(input.date, p, null, null, input.rolled), why: `${p.why ? `${p.why} · ` : ''}no free slot long enough today` })
    } else hidden.push(p)
  }
  if (train) items.push(train)
  items.sort((a, b) => (a.at ?? '99').localeCompare(b.at ?? '99'))
  return { ...base, items, more: hidden.length, hidden: hide(hidden), noTime: false, note: null }
}

// ---------------------------------------------------------------------------
// A list saved earlier today (the morning message saves it as plan blocks), or his own applied plan
// ---------------------------------------------------------------------------

export type SavedBlock = {
  id: string; start_time: string; end_time: string; title: string; kind: string; status: string
  task_id: string | null; goal_id: string | null; target_id: string | null
  topic_id?: string | null; programme_item_id?: string | null; pick_key?: string | null; open_text?: string | null; open_url?: string | null
  why?: string | null; done_hint?: DoneHint | null; rolled_from?: string | null; source?: string | null; plan_id?: string | null
}

/** The pick a saved block stands for (its key, else its task, else its title), so it keeps its "open" and "done". */
export function matchPick(b: SavedBlock, picks: Pick[]): Pick | null {
  return (b.pick_key ? picks.find((p) => p.key === b.pick_key) : null)
    ?? (b.task_id ? picks.find((p) => (p.taskId ?? (p.done.kind === 'task' ? p.done.taskId : null)) === b.task_id) : null)
    ?? picks.find((p) => p.title === b.title) ?? null
}

/** The planner's pick for the subject a block of his own plan names ("Maths: Bicen set" → the top Maths pick). */
export function subjectPick(b: SavedBlock, picks: Pick[]): Pick | null {
  const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  const t = words(b.title)
  const subj = (p: Pick) => (p.subject ? words(p.subject) : '')
  // the longest subject name that's in the title ("further maths" before "maths")
  const hits = picks.filter((p) => subj(p).trim() && t.includes(subj(p)))
  const best = Math.max(0, ...hits.map((p) => subj(p).length))
  return hits.find((p) => subj(p).length === best && p.open) ?? null
}

/**
 * Today from saved plan blocks: training as one item, each other block as an item (its pick's details when known),
 * at most `max` in time order (the rest "+N more", with the planner's picks not on the list). `effectDone`: whether
 * what ticking it moves forward already happened (he reported it by message), so it shows as done.
 */
export function todayFromSaved(x: {
  date: string; mode: 'half_term' | 'school'; blocks: SavedBlock[]; picks: Pick[]; fixed: FixedIn[]; max: number; source: 'auto' | 'his'
  trainingOpen?: (b: SavedBlock) => string; effectDone?: (it: TodayItem) => boolean
  trainingFixed?: (b: SavedBlock) => boolean   // item 18: at his set time (lib/today/fixed.ts)
  now?: string | null         // HH:MM now, if it's today: what's still to come is shown first
}): TodayPlan {
  const max = clampItems(x.max)
  const live = x.blocks.filter((b) => b.status === 'planned' || b.status === 'done').filter((b) => b.kind !== 'rest')
  const trainBlocks = live.filter((b) => b.kind === 'training')
  const train = trainingItem(x.date, trainBlocks.map((b) => ({ title: b.title, start: b.start_time.slice(0, 5), end: b.end_time.slice(0, 5), blockIds: [b.id], targetId: b.target_id, open: x.trainingOpen?.(b) ?? '', done: b.status === 'done', fixed: x.trainingFixed?.(b) ?? false })))
  const items: TodayItem[] = []
  for (const b of live.filter((y) => y.kind !== 'training')) {
    const p = matchPick(b, x.picks)
    // his own plan's block with no resource ("Maths: exam questions"): what to open comes from the planner's pick for that subject
    const sp = p ?? (b.open_text ? null : subjectPick(b, x.picks))
    const hint: DoneHint = b.done_hint ?? p?.done ?? (b.task_id ? { kind: 'task', taskId: b.task_id } : { kind: 'block' })
    const at = b.start_time.slice(0, 5), end = b.end_time.slice(0, 5)
    items.push({
      key: b.pick_key ?? p?.key ?? `block:${b.id}`, at, end, title: b.title, open: b.open_text ?? sp?.open ?? '', url: b.open_url ?? sp?.url ?? null,
      minutes: minutesOf(end) - minutesOf(at), why: b.why ?? p?.why ?? '', done: hint, kind: hint.kind === 'task' ? 'task' : 'study',
      heavy: b.kind === 'focus', subject: p?.subject ?? null, rolledFrom: b.rolled_from ?? null, isDone: b.status === 'done', blockIds: [b.id],
      taskId: b.task_id ?? (hint.kind === 'task' ? hint.taskId : null), topicId: b.topic_id ?? (hint.kind === 'topic' ? hint.topicId : null),
      goalId: b.goal_id ?? (hint.kind === 'attempt' ? hint.goalId : null), programmeItemId: b.programme_item_id ?? (hint.kind === 'programme_item' ? hint.itemId : null),
      targetId: b.target_id,
    })
  }
  if (train) items.push(train)
  // homework (and must-dos due) that had no free time when the list was saved: still on it, without a time
  const onBlocks = new Set(items.flatMap((it) => [it.key, it.title, ...(it.taskId ? [`task:${it.taskId}`] : [])]))
  for (const p of x.picks.filter((y) => y.tier <= TIER.homework)) {
    const tid = p.taskId ?? (p.done.kind === 'task' ? p.done.taskId : null)
    if (onBlocks.has(p.key) || onBlocks.has(p.title) || (tid && onBlocks.has(`task:${tid}`))) continue
    onBlocks.add(p.key)
    items.push({ ...itemOf(x.date, p, null, null, []), why: [p.why, 'no free slot long enough today'].filter(Boolean).join(' · ') })
  }
  for (const it of items) if (!it.isDone && x.effectDone?.(it)) it.isDone = true
  // what's still to come first (then done things, then what's past), shown in time order
  const rank = (it: TodayItem) => (!it.isDone && (!it.at || !x.now || (it.end ?? it.at) > x.now) ? 0 : it.isDone ? 1 : 2)
  const byTime = (a: TodayItem, b: TodayItem) => (a.at ?? '99').localeCompare(b.at ?? '99')
  const kept = [...items].sort((a, b) => rank(a) - rank(b) || byTime(a, b))
  const shown = kept.slice(0, max).sort(byTime)
  const over = kept.slice(max).sort(byTime)
  const onList = new Set(items.flatMap((it) => [it.key, it.title]))
  const rest = x.picks.filter((p) => !onList.has(p.key) && !onList.has(p.title))
  const hidden: HiddenItem[] = [
    ...over.map((it) => ({ key: it.key, title: it.title, open: it.open, minutes: it.minutes, why: it.why })),
    ...rest.map((p) => ({ key: p.key, title: p.title, open: p.open, minutes: p.minutes, why: p.why })),
  ]
  return { date: x.date, mode: x.mode, items: shown, fixed: fixedLine(x.fixed), more: hidden.length, hidden, noTime: false, note: null, source: x.source }
}
