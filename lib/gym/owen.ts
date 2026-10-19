// /owen (queue item 6): his free slots for Owen, in words. The free time is the week optimiser's (lib/week.ts
// trainingRooms: free time around school, events, routines and study blocks); his other planned sessions (upper…) and
// their travel come out of it, school days start from his usual training time, game days are left out, and only gaps
// long enough for a session are kept, ending by the heavy cut-off. Pure: no database.
import { dowShort, minutesOf } from '../time'

type Slot = { start: string; end: string }
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Each day's free gaps (≥ `min` minutes, ending by `until`, at most `perDay` a day), with `busy` sessions (and their
 * travel + a buffer) taken out. `from(date)`: the earliest start that day (school days: after school); `skip`: days
 * left out (game days).
 */
export function owenSlots(rooms: { date: string; slots: Slot[] }[], busy: { date: string; start: string; end: string; before?: number; after?: number }[],
  opts: { min: number; until: string; buffer: number; from?: (date: string) => string | null; skip?: Set<string>; perDay?: number }): { date: string; slots: Slot[] }[] {
  const cap = minutesOf(opts.until)
  return rooms.filter((r) => !opts.skip?.has(r.date)).map((r) => {
    const lo = opts.from?.(r.date) ? minutesOf(opts.from(r.date)!) : 0
    let parts = r.slots.map((s) => [Math.max(lo, minutesOf(s.start)), Math.min(minutesOf(s.end), cap)] as [number, number]).filter(([a, b]) => b > a)
    for (const x of busy.filter((b) => b.date === r.date)) {
      const a = minutesOf(x.start) - (x.before ?? 0) - opts.buffer, b = minutesOf(x.end) + (x.after ?? 0) + opts.buffer
      parts = parts.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q] as [number, number]] : [[p, Math.min(a, q)], [Math.max(b, p), q]] as [number, number][]))
    }
    // round to 5 minutes (inwards), so the message reads like a person wrote it
    parts = parts.map(([a, b]) => [Math.ceil(a / 5) * 5, Math.floor(b / 5) * 5] as [number, number])
    const long = parts.filter(([a, b]) => b - a >= opts.min).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, opts.perDay ?? 2).sort((x, y) => x[0] - y[0])
    return { date: r.date, slots: long.map(([a, b]) => ({ start: hm(a), end: hm(b) })) }
  }).filter((d) => d.slots.length)
}

/** "Tue 18:00–21:30 · Thu 16:10–17:20, 18:40–21:30" (one part per day). */
export const slotsWords = (days: { date: string; slots: Slot[] }[]) =>
  days.map((d) => `${dowShort(d.date)} ${d.slots.map((s) => `${s.start}–${s.end}`).join(', ')}`).join(' · ')
