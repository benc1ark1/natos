// Pure: which of Nat's events his words mean ("dinner" → Family dinner, "the dentist" → Dentist, "out" → Out with
// friends), and which session of it (on the day he named, else the next one). His own events can change; copies
// from his Google calendars are only ever named (he changes those in Google), and the Game from his set-up is left
// to the brain (game_week).
import { expandEvents, type Occurrence } from '../events'
import { addDays } from '../time'
import type { EventException, EventRow } from '../types'

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const STOP = new Set(['the', 'my', 'a', 'an', 'to', 'at', 'on', 'in', 'of', 'for', 'and', 'with', 'going', 'go', 'our', 'his', 'me', 'i'])
/** Words he may add that an event's name often leaves out ("dentist appointment" = Dentist). */
const SOFT = new Set(['appointment', 'appt', 'session', 'training', 'practice', 'thing', 'event', 'plan', 'lesson', 'class', 'meetup', 'night', 'evening', 'trip'])

/** Words of a name, lower case, without "'s", small words or a plural s ("Sam's dinners" → sam, dinner). */
export function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '').split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP.has(w)).map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

const edits = (a: string, b: string) => {
  // Levenshtein distance, stopping early above 1 (only "one typo" matters here)
  if (Math.abs(a.length - b.length) > 1) return 2
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev.splice(0, prev.length, ...cur)
  }
  return prev[b.length]
}
/** One word for another: the same, one the start of the other (4+ letters: "footy"/"football" no, "foot"/"football" yes), or one typo (5+ letters). */
export const sameWord = (a: string, b: string) => a === b
  || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)))
  || (a.length >= 5 && b.length >= 5 && edits(a, b) <= 1)
  || ((a === 'footy' && b === 'football') || (a === 'football' && b === 'footy'))

/** How well his words name an event: 0 = not it, 1 = some of its words, 2 = all its words, 3 = exactly its name. */
export function nameScore(words: string, title: string): number {
  const w = tokens(words), t = tokens(title)
  if (!w.length || !t.length) return 0
  const hit = w.filter((x) => t.some((y) => sameWord(x, y)))
  if (!hit.length || w.some((x) => !hit.includes(x) && !SOFT.has(x))) return 0
  const covered = t.every((y) => w.some((x) => sameWord(x, y)))
  return covered ? (w.length === t.length ? 3 : 2) : 1
}

export type EventMatch = { event: EventRow; session: Occurrence; score: number; own: boolean; google: boolean; setup: boolean }

/**
 * The events his words could mean, best first, each with the session he means: the one on `date` (where it normally
 * is, or where it moved to), else the next one that isn't cancelled (or over already, with nowMin). Events with no such session in the
 * next 8 weeks are left out. Only the best-scoring own events are kept (so "football" isn't also "Football club AGM"
 * when there's a Football event), then Google / set-up ones for the "change it in Google" reply.
 */
export function matchEvents(words: string, events: EventRow[], changes: EventException[], today: string, date: string | null, nowMin: number | null = null): EventMatch[] {
  // the next session: not one earlier today that's already over
  const ahead = (o: { date: string; start: string | null; end: string | null }) => o.date > today || (o.date === today && (nowMin === null || !o.start || toMin(o.end ?? o.start) > nowMin))
  const out: EventMatch[] = []
  for (const e of events) {
    if (e.archived_at) continue
    const score = nameScore(words, e.title)
    if (!score) continue
    const occ = expandEvents([e], date ?? today, addDays(date ?? today, date ? 0 : 56), changes.filter((c) => c.event_id === e.id))
    const session = date
      ? occ.find((o) => (o.usualDate === date || o.date === date) && !o.cancelled) ?? null
      : occ.find((o) => ahead(o) && !o.cancelled) ?? null
    if (!session) continue
    const google = e.external_source === 'google'
    const setup = (e.external_source as string) === 'setup'
    out.push({ event: e, session, score, own: !google && !setup, google, setup })
  }
  out.sort((a, b) => b.score - a.score || (a.session.date + (a.session.start ?? '')).localeCompare(b.session.date + (b.session.start ?? '')))
  const best = Math.max(0, ...out.filter((m) => m.own).map((m) => m.score))
  return out.filter((m) => !m.own || m.score === best)
}

/** Letter-pair likeness of two names (0–1), for "did you mean …?" when nothing matches. */
export function likeness(a: string, b: string): number {
  const pairs = (s: string) => { const x = s.toLowerCase().replace(/[^a-z0-9]/g, ''); const out: string[] = []; for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2)); return out }
  const p = pairs(a), q = pairs(b)
  if (!p.length || !q.length) return 0
  let hits = 0
  const left = [...q]
  for (const x of p) { const i = left.indexOf(x); if (i >= 0) { hits++; left.splice(i, 1) } }
  return (2 * hits) / (p.length + q.length)
}

/** His own events coming up in the next 2 weeks closest to his words (or simply the next ones), for the "can't find" reply. */
export function closest(words: string, events: EventRow[], changes: EventException[], today: string, n = 3, onlySimilar = false): { title: string; session: Occurrence }[] {
  const own = events.filter((e) => !e.archived_at && e.external_source !== 'google' && (e.external_source as string) !== 'setup')
  const occ = expandEvents(own, today, addDays(today, 13), changes).filter((o) => !o.cancelled && o.date >= today)
  const firsts = new Map<string, Occurrence>()
  for (const o of occ) if (!firsts.has(o.event.id)) firsts.set(o.event.id, o)
  const list = [...firsts.values()].map((o) => ({ title: o.event.title, session: o, like: likeness(words, o.event.title) }))
  const similar = list.filter((x) => x.like >= 0.3).sort((a, b) => b.like - a.like)
  return (similar.length || onlySimilar ? similar : list).slice(0, n).map(({ title, session }) => ({ title, session }))
}
