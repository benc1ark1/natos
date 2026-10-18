// Shared between the Ask AI route (server) and the Ask card / weekly check-in (browser).
// The AI only recommends. Nothing here changes a record; every change is a separate tap Nat makes.

/** What a plan item points at. Every item must be one of Nat's real records. */
export type PlanRefKind = 'task' | 'target' | 'goal' | 'routine' | 'topic' | 'mistake'

export type PlanItem = {
  kind: PlanRefKind
  id: string               // the record's real id
  title: string            // the record's real title (never the AI's wording)
  minutes: number | null
  focus: string | null     // optional detail from the AI, e.g. "Q1–8" or "juggling + first touch"
  why: string | null
  status: string | null    // tasks only: its column, so the card knows if "Move to Today" makes sense
}

export type AskAnswer = {
  answer: string
  plan: PlanItem[]
  unsure: string | null
  fact_to_save: string | null    // offered as a button; saved only if Nat taps it
  notes: string[]                // checks the server made, e.g. "Left out a suggestion that wasn't in your data"
}

export type Turn = { q: string; a: string }

export type AskResult = { ok: true; answer: AskAnswer } | { ok: false; error: string }

/** A drafted week (Sunday check-in). Saved only when Nat confirms; it changes no tasks. */
export type WeekPlanDay = { date: string; items: (PlanItem & { done?: boolean })[] }
export type WeekPlan = { week_start: string; days: WeekPlanDay[]; notes: string | null }
export type WeekPlanResult = { ok: true; plan: WeekPlan; notes: string[] } | { ok: false; error: string }

export const QUICK_QUESTIONS = [
  'What should I do tonight?',
  'Plan my week',
  'What have I been postponing?',
  'What’s coming up that I might forget?',
]
