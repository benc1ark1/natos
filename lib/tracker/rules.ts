// The tracker's small rules, exactly as the "Start here" tab says (plans/contracts.md §3.2). Shared by the planner,
// the bot and the Subjects page so the numbers live in one place. Pure: no database, no clock.
import { addDays, daysBetween } from '../time'
import type { Colour, MistakeKind, TaughtState, TrackerTopic } from './types'
import { MISTAKE_KINDS } from './types'

/** 🔴 < 65% on fresh questions · 🟡 65–84% · 🟢 ≥ 85% without notes (with notes it's at most 🟡). */
export function colourFromPct(pct: number, withNotes = false): Colour {
  if (pct < 65) return 'not_secure'
  if (pct < 85 || withNotes) return 'understand'
  return 'exam_ready'
}

export const pctOf = (score: number, outOf: number) => (outOf > 0 ? Math.round((score / outOf) * 100) : 0)

/** Review gaps in days (Start here §7): 🔴 +1 · 🟡 +3 · 🟢 +14 · ⚪ +7. */
export const DEFAULT_REVIEW_DAYS: Record<Colour, number> = { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 }

/** The next review date: last done + the gap for its colour (none if never done). */
export const nextReview = (t: Pick<TrackerTopic, 'lastDone' | 'status'>, days: Record<Colour, number> = DEFAULT_REVIEW_DAYS): string | null =>
  t.lastDone ? addDays(t.lastDone, days[t.status] ?? 7) : null

export const isDue = (t: Pick<TrackerTopic, 'lastDone' | 'status'>, today: string, days: Record<Colour, number> = DEFAULT_REVIEW_DAYS) => {
  const r = nextReview(t, days)
  return !!r && r <= today
}

/** ✅ Taught · ⏭ Next up (taught within 21 days) · Later. Physics "Taught?" wins over the date. */
export function taughtState(t: Pick<TrackerTopic, 'taughtFrom' | 'taught'>, today: string, nextUpDays = 21): TaughtState {
  if (t.taught === 'yes' || t.taught === 'in_class') return 'taught'
  if (t.taught === 'not_yet') return t.taughtFrom && daysBetween(today, t.taughtFrom) <= nextUpDays ? 'next_up' : 'later'
  if (!t.taughtFrom) return 'later'
  if (t.taughtFrom <= today) return 'taught'
  return daysBetween(today, t.taughtFrom) <= nextUpDays ? 'next_up' : 'later'
}

/** Mistakes: redo 3 days after logging, then again ~1 week after the first redo; then it's done. */
export const FIRST_REDO_DAYS = 3
export const SECOND_REDO_DAYS = 7
export const firstRedo = (loggedOn: string) => addDays(loggedOn, FIRST_REDO_DAYS)
/** After a redo on `doneOn`: the next stage and its date (stage 2 = done, no date). */
export function afterRedo(stage: number, doneOn: string): { stage: number; reviewOn: string | null } {
  if (stage <= 0) return { stage: 1, reviewOn: addDays(doneOn, SECOND_REDO_DAYS) }
  return { stage: 2, reviewOn: null }
}

/** "knowledge" / "Algebra" / "careless slip" → a mistake type. */
export function parseMistakeKind(w: string): MistakeKind | null {
  const v = w.trim().toLowerCase()
  const hit = MISTAKE_KINDS.find((k) => v === k || v.startsWith(k))
  if (hit) return hit
  if (/^(calc|calculator)/.test(v)) return 'calculator'
  if (/^(mis-?read|read the question)/.test(v)) return 'misread'
  if (/^(slip|silly|sign)/.test(v)) return 'careless'
  if (/^(timing|ran out|too slow)/.test(v)) return 'time'
  return null
}

/** Maths pipeline: what he did → the step it reaches (steps only move forward from a report). */
export const STEP_OF: Record<string, number> = {
  textbook: 1,        // read the section + worked examples (Learn)
  exercise: 2,        // textbook exercise, every 2nd question (Fluency)
  mixed: 3,           // mixed exercise + red/blue problem-solving questions (Chapter check)
  bicen: 4,           // Bicen exam questions set (Exam questions)
  integral: 5,        // Integral topic assessment ≥ 85% (Prove it) — below 85% it stays at 4
  stretch: 6,         // Bicen hardest / MadAs / STEP
}
export const stepAfter = (current: number, what: keyof typeof STEP_OF | string, pct?: number | null): number => {
  const s = STEP_OF[what]
  if (s === undefined) return current
  if (what === 'integral' && (pct ?? 0) < 85) return Math.max(current, 4)
  return Math.max(current, s)
}
