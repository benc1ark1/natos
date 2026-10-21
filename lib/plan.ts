// Placing a day's plan into real free time, by plain code (the AI only picks WHAT, in order; never the times).
// Rules (my-spec 41): blocks only in free slots (events + travel + buffers already taken off), a buffer between
// blocks, focused work and training only before the heavy cut-off (~21:30), focused work capped on school
// nights, a lighter day when tired or ill. Pure: no database, no clock.
import type { SupabaseClient } from '@supabase/supabase-js'
import { toHHMM, type PlanningSettings, type Slot } from './freetime'
import { hhmm, minutesOf } from './time'

export type PlanRow = { id: string; start_time: string; end_time: string; title: string; kind: string; task_id: string | null }

/** A day's applied plan (Home, the brief, the bot). Empty (never an error) if none, or before jarvis-d1.sql has run. */
export async function loadPlan(sb: SupabaseClient, date: string): Promise<PlanRow[]> {
  const { data, error } = await sb.from('plan_blocks').select('id,start_time,end_time,title,kind,task_id').eq('on_date', date).eq('status', 'planned').order('start_time')
  return error ? [] : ((data ?? []) as PlanRow[]).map((r) => ({ ...r, start_time: hhmm(r.start_time), end_time: hhmm(r.end_time) }))
}

export type BlockKind = 'focus' | 'light' | 'training' | 'rest'
export type Energy = 'normal' | 'tired' | 'ill'

/** One thing to place, in priority order. */
export type PlanItem = { title: string; minutes: number; kind: BlockKind; ref?: { kind: string; id: string } | null; why?: string
  after?: string     // goes after the block with this ref id or title, if it's placed (an ACT test's review after the test)
  subject?: string | null }   // its subject, when the code that picked it knows (a focus period keeps only its own)
export type Block = { start: string; end: string; title: string; kind: BlockKind; ref?: { kind: string; id: string } | null; why?: string; date?: string
  intensity?: string; wanted?: string; key?: string    // training placed by load (lib/load.ts): light / moderate / heavy
  place?: string | null; placeKey?: string | null; leave?: string | null; from?: string | null; back?: number }   // where, and when to leave (lib/optimiser.ts)
export type Unplaced = { title: string; minutes: number; reason: string }

export const MAX_BLOCKS = 8
const MIN_BLOCK = 10

/** How much focused work fits today: school-night limit, less when tired, none when ill. null = no limit. */
export function focusBudget(schoolNight: boolean, s: PlanningSettings, energy: Energy): number | null {
  const base = schoolNight ? s.schoolNightFocusMin : null
  if (energy === 'ill') return 0
  if (energy === 'tired') return Math.round(((base ?? 240) * 0.6) / 5) * 5
  return base
}

/**
 * Put items into the slots in order: each goes in the earliest gap with room (heavy kinds only before the cut-off),
 * with a buffer after every block. Items that can't go anywhere are returned with the reason.
 */
export function placeItems(items: PlanItem[], slots: Slot[], s: PlanningSettings, opts: { budget: number | null; energy: Energy; until?: string | null }):
  { blocks: Block[]; unplaced: Unplaced[]; focusMinutes: number } {
  const heavyEnd = minutesOf(s.heavyUntil)
  const hardEnd = opts.until ? Math.min(minutesOf(opts.until), minutesOf(s.dayEnd)) : minutesOf(s.dayEnd)
  // each slot's next free minute
  const room = slots.map((x) => ({ from: minutesOf(x.start), to: Math.min(minutesOf(x.end), hardEnd) })).filter((x) => x.to - x.from >= MIN_BLOCK)
  const blocks: Block[] = []
  const unplaced: Unplaced[] = []
  let focusMinutes = 0

  // rest ("early night", "wind down") belongs at the end of the day: placed last, at the end of the latest gap
  const ordered = [...items.filter((x) => x.kind !== 'rest'), ...items.filter((x) => x.kind === 'rest')]
  for (const it of ordered) {
    const minutes = Math.round(it.minutes)
    if (!Number.isFinite(minutes) || minutes < MIN_BLOCK || minutes > 240) { unplaced.push({ title: it.title, minutes, reason: 'no sensible length' }); continue }
    if (blocks.length >= MAX_BLOCKS) { unplaced.push({ title: it.title, minutes, reason: 'the day is full enough' }); continue }
    const heavy = it.kind === 'focus' || it.kind === 'training'
    if (opts.energy === 'ill' && heavy) { unplaced.push({ title: it.title, minutes, reason: 'you’re ill: rest instead' }); continue }
    if (opts.energy === 'tired' && it.kind === 'training') { unplaced.push({ title: it.title, minutes, reason: 'you’re tired: no extra training' }); continue }
    if (it.kind === 'focus' && opts.budget !== null && focusMinutes + minutes > opts.budget) {
      unplaced.push({ title: it.title, minutes, reason: `over today’s ${opts.budget} min of focused work` }); continue
    }
    const end = (r: { from: number; to: number }) => Math.min(r.to, heavy ? heavyEnd : hardEnd)
    if (it.kind === 'rest') {
      const r = [...room].reverse().find((x) => x.to - x.from >= minutes)
      if (!r) { unplaced.push({ title: it.title, minutes, reason: 'no free time left for it' }); continue }
      blocks.push({ start: toHHMM(r.to - minutes), end: toHHMM(r.to), title: it.title, kind: it.kind, ref: it.ref ?? null, why: it.why })
      r.to -= minutes + s.bufferMin
      continue
    }
    // an item that goes after another (a test's review): only gaps from that block's end
    const prior = it.after ? blocks.find((b) => b.ref?.id === it.after || b.title === it.after) : null
    const minFrom = prior ? minutesOf(prior.end) + s.bufferMin : 0
    if (prior) {
      const p = room.find((x) => end(x) - Math.max(x.from, minFrom) >= minutes)
      if (!p) { unplaced.push({ title: it.title, minutes, reason: `no free time after ${prior.title}` }); continue }
      const at = Math.max(p.from, minFrom)
      blocks.push({ start: toHHMM(at), end: toHHMM(at + minutes), title: it.title, kind: it.kind, ref: it.ref ?? null, why: it.why })
      if (it.kind === 'focus') focusMinutes += minutes
      p.from = at + minutes + s.bufferMin
      continue
    }
    const r = room.find((x) => end(x) - x.from >= minutes)
    if (!r) {
      const longest = Math.max(0, ...room.map((x) => end(x) - x.from))
      unplaced.push({ title: it.title, minutes, reason: heavy && room.some((x) => x.to - x.from >= minutes) ? `only fits after ${s.heavyUntil}, too late for it` : `no free gap that long (longest ${longest} min)` })
      continue
    }
    blocks.push({ start: toHHMM(r.from), end: toHHMM(r.from + minutes), title: it.title, kind: it.kind, ref: it.ref ?? null, why: it.why })
    if (it.kind === 'focus') focusMinutes += minutes
    r.from += minutes + s.bufferMin   // a break before the next block
  }
  blocks.sort((a, b) => a.start.localeCompare(b.start))
  return { blocks, unplaced, focusMinutes }
}

/** Plain checks a plan must pass (used by the tests and as a last guard before saving). */
export function planProblems(blocks: Block[], slots: Slot[], s: PlanningSettings, budget: number | null): string[] {
  const out: string[] = []
  const inSlot = (b: Block) => slots.some((x) => minutesOf(x.start) <= minutesOf(b.start) && minutesOf(b.end) <= minutesOf(x.end))
  const sorted = [...blocks].sort((a, b) => a.start.localeCompare(b.start))
  sorted.forEach((b, i) => {
    if (!inSlot(b)) out.push(`${b.title} is outside free time`)
    if ((b.kind === 'focus' || b.kind === 'training') && minutesOf(b.end) > minutesOf(s.heavyUntil)) out.push(`${b.title} is heavy after ${s.heavyUntil}`)
    if (minutesOf(b.end) > minutesOf(s.dayEnd)) out.push(`${b.title} runs past ${s.dayEnd}`)
    if (i > 0 && minutesOf(b.start) < minutesOf(sorted[i - 1].end)) out.push(`${b.title} overlaps ${sorted[i - 1].title}`)
  })
  const focus = blocks.filter((b) => b.kind === 'focus').reduce((a, b) => a + minutesOf(b.end) - minutesOf(b.start), 0)
  if (budget !== null && focus > budget) out.push(`${focus} min of focused work is over the ${budget} min limit`)
  return out
}
