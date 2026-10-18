// Server-only: automatic travel times (Jarvis phase E2).
// - postcodes.io (free, no key, open data): a UK postcode -> map position, kept on the place.
// - TfL Unified API (free key, open data: "Powered by TfL Open Data"): tube/bus/overground journey minutes,
//   cached per hour of the day and refreshed after 30 days.
// Driving (Uber) times: Nat's own estimates for now; Mapbox's terms don't allow its results without a Mapbox map.
// Tests point these at local fakes (TFL_API_BASE / POSTCODES_API_BASE, localhost only).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEvents } from '../events'
import { minutesOf } from '../time'
import type { Place, TravelWorld } from '../travel'
import type { EventException, EventRow } from '../types'

const local = (v: string | undefined, real: string) => (v && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(v) ? v : real)
const TFL = () => local(process.env.TFL_API_BASE, 'https://api.tfl.gov.uk')
const POSTCODES = () => local(process.env.POSTCODES_API_BASE, 'https://api.postcodes.io')

const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i
export const postcodeIn = (text: string | null) => { const m = (text ?? '').match(POSTCODE); return m ? `${m[1]} ${m[2]}`.toUpperCase() : null }

export async function postcodeToLatLng(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const res = await fetch(`${POSTCODES()}/postcodes/${encodeURIComponent(postcode.replace(/\s+/g, ''))}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    const json = (await res.json()) as { status?: number; result?: { latitude?: number; longitude?: number } }
    const r = json.result
    return res.ok && typeof r?.latitude === 'number' && typeof r?.longitude === 'number' ? { lat: r.latitude, lng: r.longitude } : null
  } catch { return null }
}

/** The quickest tube/bus journey leaving around `time` (HH:MM) on `date`, in minutes (null if none). */
export async function transitMinutes(from: { lat: number; lng: number }, to: { lat: number; lng: number }, date: string, time: string): Promise<number | null> {
  const key = process.env.TFL_APP_KEY
  const q = new URLSearchParams({ date: date.replace(/-/g, ''), time: time.replace(':', ''), timeIs: 'Departing', ...(key ? { app_key: key } : {}) })
  try {
    const res = await fetch(`${TFL()}/Journey/JourneyResults/${from.lat},${from.lng}/to/${to.lat},${to.lng}?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    const json = (await res.json()) as { journeys?: { duration?: number }[] }
    const mins = (json.journeys ?? []).map((j) => j.duration).filter((d): d is number => typeof d === 'number' && d > 0)
    return mins.length ? Math.min(...mins) : null
  } catch { return null }
}

const MAX_PAIRS = 12        // a day's refresh asks about at most this many journeys
const STALE_DAYS = 30

/**
 * Once a day (from the tick): give places with a postcode their map position, then fetch TfL times for the
 * journeys the next two days need that aren't known yet (or are over 30 days old). Never throws.
 */
export async function refreshTravel(sb: SupabaseClient, w: TravelWorld | null, events: EventRow[], changes: EventException[], today: string, tomorrow: string): Promise<number> {
  if (!w) return 0
  let fetched = 0
  try {
    // 1. postcodes -> positions
    for (const p of w.places.filter((x) => x.lat === null && postcodeIn(x.address))) {
      const pos = await postcodeToLatLng(postcodeIn(p.address)!)
      if (!pos) continue
      await sb.from('places').update(pos).eq('id', p.id)
      Object.assign(p, pos)
    }
    // 2. the journeys the next two days need: home/previous place -> each event's place
    const home = w.places.find((p) => p.is_home)
    const occ = expandEvents(events, today, tomorrow, changes).filter((o) => !o.cancelled && o.start && w.eventPlace.get(o.event.id))
    const pairs = new Map<string, { from: Place; to: Place; date: string; hour: number }>()
    for (const o of occ) {
      const to = w.places.find((p) => p.id === w.eventPlace.get(o.event.id))
      const prev = occ.filter((x) => x.date === o.date && x.end && minutesOf(x.end) <= minutesOf(o.start!) && minutesOf(o.start!) - minutesOf(x.end) <= 240).pop()
      const from = (prev && w.places.find((p) => p.id === w.eventPlace.get(prev.event.id))) || home
      if (!from || !to || from.id === to.id) continue
      const hour = Math.max(0, Math.floor(minutesOf(o.start!) / 60) - 1)
      for (const [a, b] of [[from, to], [to, from]] as const) pairs.set(`${a.id}>${b.id}@${hour}`, { from: a, to: b, date: o.date, hour })
    }
    for (const { from, to, date, hour } of [...pairs.values()].slice(0, MAX_PAIRS)) {
      if (from.lat === null || to.lat === null) continue
      const told = w.times.some((t) => t.source === 'manual' && t.mode !== 'uber' && t.mode !== 'car' && ((t.from_place_id === from.id && t.to_place_id === to.id) || (t.from_place_id === to.id && t.to_place_id === from.id)))
      if (told) continue   // he told us how he goes: no need to ask
      const cached = w.times.find((t) => t.source === 'tfl' && t.from_place_id === from.id && t.to_place_id === to.id && t.depart_hour === hour)
      if (cached?.updated_at && Date.now() - Date.parse(cached.updated_at) < STALE_DAYS * 86_400_000) continue
      const mins = await transitMinutes({ lat: from.lat!, lng: from.lng! }, { lat: to.lat!, lng: to.lng! }, date, `${String(hour).padStart(2, '0')}:00`)
      fetched++
      if (!mins) continue
      await sb.from('travel_times').upsert({ from_place_id: from.id, to_place_id: to.id, mode: 'transit', source: 'tfl', depart_hour: hour, weekday: null, minutes: Math.min(mins, 300), archived_at: null },
        { onConflict: 'user_id,from_place_id,to_place_id,mode,source,depart_hour,weekday' })
    }
  } catch {}
  return fetched
}
