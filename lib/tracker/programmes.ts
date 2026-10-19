// Programmes: an ordered series with a weekly target and an optional end date (STEP, the ACT books…), paused, changed
// or stopped by chat; new ones are just data (plans/contracts.md §3.5). Modes: in_order (item after item) · gaps_only
// (College Panda: the chapter TEST first, only do the chapters where marks were dropped) · optional (Critical Reader:
// only when boosted / asked). Pure: no database, no clock.
import { addDays, weekStartISO } from '../time'
import type { Programme, ProgrammeItem } from './types'

/** Is it running on `today`? Active (or paused with a pause date that has passed), within its dates, not paused today. */
export function isRunning(p: Programme, today: string): boolean {
  const resumed = p.status === 'paused' && !!p.pausedUntil && today > p.pausedUntil
  if (p.status !== 'active' && !resumed) return false
  if (p.pausedUntil && today <= p.pausedUntil) return false
  if (p.startsOn && today < p.startsOn) return false
  if (p.endsOn && today > p.endsOn) return false
  return true
}

/** Items done in the week (Mon–Sun) that holds `today`. */
export const doneThisWeek = (p: Programme, today: string) => {
  const from = weekStartISO(today), to = addDays(from, 6)
  return p.items.filter((i) => i.status === 'done' && i.doneOn && i.doneOn >= from && i.doneOn <= to).length
}

const inOrder = (p: Programme) => [...p.items].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))

/** gaps_only: the chapter test was taken with full marks → nothing to do in that chapter. */
const fullMarks = (i: ProgrammeItem) => i.score != null && i.outOf != null && i.outOf > 0 && i.score >= i.outOf

/** Nothing left to do in this item (done / skipped; gaps_only: full marks on its chapter test). */
export function itemFinished(p: Programme, i: ProgrammeItem): boolean {
  if (i.status === 'done' || i.status === 'skipped') return true
  return p.mode === 'gaps_only' && fullMarks(i)
}

/** The next item to do (in position order: the first not finished; a 'doing' one counts as not finished). */
export function nextItem(p: Programme): ProgrammeItem | null {
  return inOrder(p).find((i) => !itemFinished(p, i)) ?? null
}

/** What to do next: the item and whether it's the work itself or (gaps_only, no score yet) its chapter test. */
export function nextStep(p: Programme): { item: ProgrammeItem; action: 'do' | 'test' } | null {
  const item = nextItem(p)
  if (!item) return null
  return { item, action: p.mode === 'gaps_only' && item.score == null ? 'test' : 'do' }
}

/** How many more this week to meet the weekly target. */
export const leftThisWeek = (p: Programme, today: string) => Math.max(0, p.perWeek - doneThisWeek(p, today))

/** Should it be on today's list? Running, not optional (unless boosted / asked), the weekly target not met yet, nothing
 *  of it finished today already, today is one of its days, and something left to do. */
export function isDueToday(p: Programme, today: string, dow: number, boosted = false): boolean {
  if (!isRunning(p, today)) return false
  if (p.mode === 'optional' && !boosted) return false
  if (doneThisWeek(p, today) >= p.perWeek) return false
  if (p.items.some((i) => i.doneOn === today && (i.status === 'done' || i.status === 'skipped'))) return false
  return dayAllowed(p.days, dow) && !!nextItem(p)
}

const DAY = '(mon|tue|wed|thu|fri|sat|sun)[a-z]*'
const dayNo = (w: string) => ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(w.trim().slice(0, 3)) + 1

/** His words for a programme's days → the weekdays (1 = Mon … 7 = Sun), or null = any day. `understood: false` = no
 *  day words found at all (then any day, and the planner says so). "weekends only", "the weekend", "at weekends",
 *  "weekdays", "mon, wed", "Monday and Thursday", "mon-fri", "mon - fri", "mon to fri", "daily", "any". */
export function parseDays(days: string | null): { days: Set<number> | null; understood: boolean } {
  let v = (days ?? '').trim().toLowerCase()
  if (!v || /^(any( ?day)?|daily|every ?day|all week)$/.test(v)) return { days: null, understood: true }
  const out = new Set<number>()
  if (/\bweek-?ends?\b/.test(v)) { out.add(6); out.add(7) }
  if (/\bweek-?days?\b/.test(v)) for (let d = 1; d <= 5; d++) out.add(d)
  v = v.replace(/\bweek-?(ends?|days?)\b/g, ' ')
  v = v.replace(new RegExp(`\\b${DAY}\\s*(?:-|–|to|till|until)\\s*${DAY}\\b`, 'g'), (m) => {
    const [a, b] = (m.match(new RegExp(`\\b${DAY}`, 'g')) ?? []).map(dayNo)
    if (a > 0 && b > 0) for (let d = a; ; d = (d % 7) + 1) { out.add(d); if (d === b) break }
    return ' '
  })
  for (const m of v.match(new RegExp(`\\b${DAY}\\b`, 'g')) ?? []) out.add(dayNo(m))
  if (!out.size) return { days: null, understood: /\b(any|daily|every ?day)\b/.test(v) }
  return { days: out, understood: true }
}

/** Is `dow` one of the programme's days? (1 = Mon … 7 = Sun; words not understood = any day.) */
export function dayAllowed(days: string | null, dow: number): boolean {
  const p = parseDays(days)
  return !p.days || p.days.has(dow)
}

/** "1 a week · weekend · 3/28 done · next: STEP Support – Assignment 4" (for the bot and the Subjects page). */
export function programmeLine(p: Programme, today: string): string {
  const done = p.items.filter((i) => itemFinished(p, i)).length
  const next = nextStep(p)
  const pausedNow = !!p.pausedUntil && today <= p.pausedUntil
  const state = p.status === 'stopped' || p.status === 'done' ? p.status
    : pausedNow ? `paused until ${p.pausedUntil}` : p.status === 'paused' && !p.pausedUntil ? 'paused' : null
  const bits = [`${p.perWeek} a week`, p.days, `${done}/${p.items.length} done`, state, p.endsOn ? `ends ${p.endsOn}` : null,
    p.mode === 'gaps_only' ? 'chapter tests first' : p.mode === 'optional' ? 'optional' : null,
    next ? `next: ${next.item.title}${next.action === 'test' ? ' (chapter test)' : ''}` : 'all done']
  return bits.filter(Boolean).join(' · ')
}
