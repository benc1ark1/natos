// Loading places and travel times (as Nat, under row level security). Never throws: before jarvis-e.sql has run,
// or with no places saved, travel falls back to each event's own travel minutes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { travelSettings, type Place, type TravelRow, type TravelWorld } from './travel'
import type { EventRow } from './types'

export async function loadTravel(sb: SupabaseClient, events: EventRow[], planning: unknown): Promise<TravelWorld | null> {
  const [places, times] = await Promise.all([
    sb.from('places').select('id,name,address,lat,lng,is_home,archived_at').is('archived_at', null),
    // '*': the range and weekday columns (jarvis-g.sql) are used when they're there
    sb.from('travel_times').select('*').is('archived_at', null),
  ])
  if (places.error || times.error || !places.data?.length) return null
  return {
    places: places.data as Place[], times: (times.data ?? []) as TravelRow[], settings: travelSettings(planning),
    eventPlace: new Map(events.map((e) => [e.id, (e as EventRow & { place_id?: string | null }).place_id ?? null])),
  }
}
