// Travel between Nat's places (Jarvis phase E), worked out by plain code. Pure: no database, no clock.
// - How he says he goes ("school to football is 25 min by bus") always wins.
// - Otherwise an Uber (his own estimate, "20 min by Uber", or later a driving service) + a pickup wait, against
//   tube/bus from TfL. Tube/bus is recommended when it's as fast or nearly as fast (within transitSlackMin).
// - Times can be ranges ("Uber 15–20 min + 0–8 min wait"): leave-by uses the slow end unless travelEnd says otherwise.
// - A journey can be for one weekday only ("Wednesday training"): that beats an every-day one.
// - "Where he'll be before" an event = the previous event's place that day (if it ends shortly before), else home.
import type { Occurrence } from './events'
import { isoDow, minutesOf } from './time'

export type Place = { id: string; name: string; address: string | null; lat: number | null; lng: number | null; is_home: boolean; archived_at: string | null }
/** minutes = the slow end of the journey; minutes_low = the quick end (a range); wait_low/high = waiting for the car; weekday 1–7 = that day only. */
export type TravelRow = {
  id?: string; from_place_id: string; to_place_id: string; mode: string; minutes: number; source: 'manual' | 'mapbox' | 'tfl'; depart_hour: number | null; archived_at: string | null; updated_at?: string
  minutes_low?: number | null; wait_low?: number | null; wait_high?: number | null; weekday?: number | null
}
export type TravelEnd = 'slow' | 'middle' | 'fast'
export type TravelSettings = { uberPickupMin: number; transitSlackMin: number; travelEnd: TravelEnd }
export const DEFAULT_TRAVEL: TravelSettings = { uberPickupMin: 5, transitSlackMin: 10, travelEnd: 'slow' }

export type TravelWorld = { places: Place[]; times: TravelRow[]; eventPlace: Map<string, string | null>; settings: TravelSettings }

/** One journey: how long, how, from where; `other` is the alternative for the card ("Uber 30 min"); `range` the spread ("15–20 min + 0–8 min wait"). */
export type Leg = { minutes: number; mode: string; from: string | null; to: string | null; other: string | null; range?: string }

const MODE_WORDS: Record<string, string> = { walk: 'walking', bus: 'by bus', tube: 'by tube', train: 'by train', transit: 'by tube/bus', car: 'by car', uber: 'by Uber', cycle: 'by bike', any: '' }
export const modeWords = (m: string) => MODE_WORDS[m] ?? ''
export const DAY_NAMES = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays']

export function travelSettings(raw: unknown): TravelSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const n = (k: 'uberPickupMin' | 'transitSlackMin', max: number) => (Number.isInteger(o[k]) && (o[k] as number) >= 0 && (o[k] as number) <= max ? (o[k] as number) : DEFAULT_TRAVEL[k])
  const end = ['slow', 'middle', 'fast'].includes(o.travelEnd as string) ? (o.travelEnd as TravelEnd) : DEFAULT_TRAVEL.travelEnd
  return { uberPickupMin: n('uberPickupMin', 60), transitSlackMin: n('transitSlackMin', 60), travelEnd: end }
}

const span = (lo: number, hi: number) => (lo === hi ? `${hi}` : `${lo}–${hi}`)
const at = (lo: number, hi: number, end: TravelEnd) => (end === 'fast' ? lo : end === 'middle' ? Math.round((lo + hi) / 2) : hi)

/** A journey's minutes at the chosen end of its range, and the range in words (only if it is one). Uber/car adds the wait. */
export function journey(t: TravelRow, s: TravelSettings): { minutes: number; range?: string } {
  const hi = t.minutes, lo = Math.min(t.minutes_low ?? hi, hi)
  const car = t.mode === 'uber' || t.mode === 'car'
  const wHi = car ? (t.wait_high ?? (t.wait_low ?? s.uberPickupMin)) : 0
  const wLo = car ? Math.min(t.wait_low ?? wHi, wHi) : 0
  const minutes = at(lo, hi, s.travelEnd) + at(wLo, wHi, s.travelEnd)
  const ranged = lo !== hi || (car && (t.wait_low != null || t.wait_high != null) && wLo !== wHi)
  if (!ranged) return { minutes }
  return { minutes, range: `${span(lo, hi)} min${car && (t.wait_low != null || t.wait_high != null) ? ` + ${span(wLo, wHi)} min wait` : ''}` }
}

/** The best way from one place to another around `hour` on weekday `dow` (1 = Mon; null if nothing is known). */
export function bestLeg(w: TravelWorld, fromId: string, toId: string, hour: number, dow: number | null = null): Leg | null {
  const name = (id: string) => w.places.find((p) => p.id === id)?.name ?? null
  const base = { from: name(fromId), to: name(toId) }
  if (fromId === toId) return { minutes: 0, mode: 'any', other: null, ...base }
  // a journey for this weekday beats an every-day one (and one for another day doesn't count)
  const live = w.times.filter((t) => !t.archived_at && (t.weekday == null || t.weekday === dow))
  const dayFirst = (rows: TravelRow[]) => (rows.some((t) => t.weekday != null) ? rows.filter((t) => t.weekday != null) : rows)
  const pick = (from: string, to: string) => live.filter((t) => t.from_place_id === from && t.to_place_id === to)
  // one direction told is good for both
  const both = (f: (t: TravelRow) => boolean) => dayFirst([...pick(fromId, toId).filter(f), ...pick(toId, fromId).filter(f)])
  const quickest = (rows: TravelRow[]) => rows.map((t) => ({ t, ...journey(t, w.settings) })).sort((x, y) => x.minutes - y.minutes)[0]
  const ranged = (j: { range?: string }) => (j.range ? { range: j.range } : {})
  // how he says he goes (bus, tube, walk…) always wins
  const told = quickest(both((t) => t.source === 'manual' && t.mode !== 'uber' && t.mode !== 'car'))
  if (told) return { minutes: told.minutes, mode: told.t.mode, other: null, ...base, ...ranged(told) }
  // otherwise an Uber (his own estimate, or a driving service) against tube/bus (TfL), by his rule
  const nearest = (rows: TravelRow[]) => [...rows].sort((x, y) => Math.abs((x.depart_hour ?? 12) - hour) - Math.abs((y.depart_hour ?? 12) - hour))[0]
  const carRow = quickest(both((t) => t.source === 'manual' && (t.mode === 'uber' || t.mode === 'car')))?.t
    ?? nearest(pick(fromId, toId).filter((t) => t.source === 'mapbox'))
  const car = carRow ? journey({ ...carRow, mode: 'uber' }, w.settings) : null   // a driving time is an Uber: + the wait
  const transit = nearest(pick(fromId, toId).filter((t) => t.source === 'tfl'))
  const uberWords = car ? `Uber ${car.range ?? `${car.minutes} min`}` : ''
  if (car && transit) {
    return transit.minutes <= car.minutes + w.settings.transitSlackMin
      ? { minutes: transit.minutes, mode: 'transit', other: uberWords, ...base }
      : { minutes: car.minutes, mode: 'uber', other: `tube/bus ${transit.minutes} min`, ...base, ...ranged(car) }
  }
  if (transit) return { minutes: transit.minutes, mode: 'transit', other: null, ...base }
  if (car) return { minutes: car.minutes, mode: 'uber', other: null, ...base, ...ranged(car) }
  return null
}

const NEAR_MIN = 4 * 60   // an event ending within 4 hours before is where he travels from

/**
 * Work out each busy event's travel there and back for one day's occurrences, from where he'll actually be.
 * Events without a saved place (or with no known journey) keep their own travel minutes.
 */
export function withTravel(occ: Occurrence[], w: TravelWorld | null): Occurrence[] {
  if (!w || !w.places.length) return occ
  const home = w.places.find((p) => p.is_home && !p.archived_at)?.id ?? null
  const byDate = new Map<string, Occurrence[]>()
  for (const o of occ) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])
  const out: Occurrence[] = []
  for (const list of byDate.values()) {
    const timed = list.filter((o) => !o.cancelled && o.event.is_busy && o.start).sort((a, b) => minutesOf(a.start!) - minutesOf(b.start!))
    for (const o of list) {
      const place = w.eventPlace.get(o.event.id) ?? null
      if (!place || !o.start || o.cancelled) { out.push(o); continue }
      const i = timed.indexOf(o)
      const prev = [...timed.slice(0, i)].reverse().find((p) => w.eventPlace.get(p.event.id) && minutesOf(o.start!) - minutesOf(p.end ?? p.start!) <= NEAR_MIN)
      const next = timed.slice(i + 1).find((n) => w.eventPlace.get(n.event.id) && minutesOf(n.start!) - minutesOf(o.end ?? o.start!) <= NEAR_MIN)
      const from = (prev && w.eventPlace.get(prev.event.id)) || home
      const to = (next && w.eventPlace.get(next.event.id)) || home
      const hour = Math.floor(minutesOf(o.start) / 60)
      const dow = isoDow(o.date)
      const there = from ? bestLeg(w, from, place, Math.max(0, hour - 1), dow) : null
      const back = to ? bestLeg(w, place, to, Math.floor(minutesOf(o.end ?? o.start) / 60), dow) : null
      out.push({
        ...o,
        travelBefore: there ? there.minutes : o.event.travel_minutes,
        travelAfter: back ? (next && to === w.eventPlace.get(next.event.id) ? 0 : back.minutes) : o.event.travel_minutes,
        leg: there ?? null,
      })
    }
  }
  return out.sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')))
}

/** "17:20 by tube/bus (Uber 30 min)" — when to leave for an event, if its journey is known (a range: its slow end). */
export function leaveBy(o: Occurrence): { at: string; words: string } | null {
  const mins = o.travelBefore ?? o.event.travel_minutes
  if (!o.start || !mins) return null
  const m = minutesOf(o.start) - mins
  const at = `${String(Math.floor(Math.max(m, 0) / 60)).padStart(2, '0')}:${String(Math.max(m, 0) % 60).padStart(2, '0')}`
  const how = o.leg ? [modeWords(o.leg.mode), o.leg.from ? `from ${o.leg.from}` : ''].filter(Boolean).join(' ') : ''
  return { at, words: `${mins} min${how ? ` ${how}` : ''}${o.leg?.range ? ` (${o.leg.range})` : ''}${o.leg?.other ? `; ${o.leg.other}` : ''}` }
}
