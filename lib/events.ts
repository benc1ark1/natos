import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventException, EventRow } from './types'
import { addDays, dateISOOf, hhmm, isoDow, timeOf } from './time'

export type Occurrence = {
  key: string
  event: EventRow
  usualDate: string             // the date it normally happens (one-week changes are keyed by this)
  date: string                  // where it actually is (differs when moved)
  start: string | null
  end: string | null
  change: EventException | null // this week's change, if any
  cancelled: boolean
  moved: boolean
  missed: boolean
  // travel worked out from where he'll be (lib/travel.ts); without these, the event's own travel minutes count
  travelBefore?: number
  travelAfter?: number
  leg?: { minutes: number; mode: string; from: string | null; to: string | null; other: string | null; range?: string } | null
}

export const isRepeating = (ev: EventRow) => !!(ev.repeat_days && ev.repeat_days.length > 0 && ev.start_time)

/**
 * Turn event rows (one-off or weekly repeating) into dated occurrences between from and to (inclusive),
 * with "just this week" changes applied. Cancelled ones are kept (flagged) so they can be restored.
 */
export function expandEvents(events: EventRow[], from: string, to: string, changes: EventException[] = []): Occurrence[] {
  const changeOf = new Map(changes.map((c) => [c.event_id + c.on_date, c]))
  const out: Occurrence[] = []
  const push = (ev: EventRow, usualDate: string, start: string | null, end: string | null) => {
    const c = changeOf.get(ev.id + usualDate) ?? null
    const moved = !!c && !c.cancelled && !!(c.new_date || c.new_start || c.new_end)
    const date = moved && c!.new_date ? c!.new_date : usualDate
    if (date < from || date > to) return
    out.push({
      key: ev.id + usualDate, event: ev, usualDate, date,
      start: moved && c!.new_start ? hhmm(c!.new_start) : start,
      end: moved && c!.new_end ? hhmm(c!.new_end) : end,
      change: c, cancelled: !!c?.cancelled, moved, missed: !!c?.missed,
    })
  }
  for (const ev of events) {
    if (ev.archived_at) continue
    if (isRepeating(ev)) {
      // a week either side, so a session moved into the range from outside it still shows
      for (let d = addDays(from, -6); d <= addDays(to, 6); d = addDays(d, 1)) {
        if (!ev.repeat_days!.includes(isoDow(d))) continue
        if (ev.repeat_from && d < ev.repeat_from) continue
        if (ev.repeat_until && d > ev.repeat_until) continue
        push(ev, d, hhmm(ev.start_time), ev.end_time ? hhmm(ev.end_time) : null)
      }
    } else if (ev.starts_at && ev.all_day) {
      // a whole-day event (from Google): one occurrence per day it covers, with no times
      const first = dateISOOf(ev.starts_at), last = ev.ends_at ? addDays(dateISOOf(ev.ends_at), -1) : first
      for (let d = first < addDays(from, -1) ? addDays(from, -1) : first; d <= last && d <= addDays(to, 1); d = addDays(d, 1)) push(ev, d, null, null)
    } else if (ev.starts_at) {
      push(ev, dateISOOf(ev.starts_at), timeOf(ev.starts_at), ev.ends_at ? timeOf(ev.ends_at) : null)
    }
  }
  return out.sort((a, b) => (a.date + (a.start ?? '')).localeCompare(b.date + (b.start ?? '')))
}

/** Things like school that happen most days: shown on the calendar, not in Upcoming. */
export const isEveryday = (ev: EventRow) => (ev.repeat_days?.length ?? 0) >= 5

/** Background: school every day, or lessons copied from his school's Google calendar. Calendar only, not Upcoming. */
export const isBackground = (ev: EventRow) => isEveryday(ev) || (ev.external_source === 'google' && ev.is_school === true)

/** A read-only copy of an event from one of his Google calendars. */
export const isFromGoogle = (ev: EventRow) => ev.external_source === 'google'

/** Is it school (school nights, "after school")? His answer on the event if he gave one; otherwise anything that
 *  repeats most weekdays is taken to be school (a guess: a holiday camp would fool it, so he can say "not school"). */
export const isSchool = (ev: EventRow) => (typeof ev.is_school === 'boolean' ? ev.is_school : isEveryday(ev))

/** The calendar grid's hours: 08–22, stretched (in 2-hour steps) to fit every event and its travel. */
export function gridHours(occ: Occurrence[]): { startH: number; endH: number; hours: number[] } {
  let first = 8 * 60, last = 22 * 60
  for (const o of occ) {
    if (!o.start) continue
    const [h, m] = o.start.split(':').map(Number)
    const s = h * 60 + m - (o.event.travel_minutes ?? 0)
    const e = (o.end ? Number(o.end.slice(0, 2)) * 60 + Number(o.end.slice(3, 5)) : s + 60) + (o.event.travel_minutes ?? 0)
    first = Math.min(first, s)
    last = Math.max(last, e)
  }
  const startH = Math.max(0, Math.floor(first / 120) * 2), endH = Math.min(24, Math.ceil(last / 120) * 2)
  const hours: number[] = []
  for (let h = startH; h <= endH; h += 2) hours.push(h)
  return { startH, endH, hours }
}

export const timeRange = (o: Occurrence) => (o.start ? (o.end ? `${o.start}–${o.end}` : o.start) : '')

/** Fields of a one-week change; anything left out is cleared. */
export type ChangeFields = Partial<Pick<EventException, 'cancelled' | 'new_date' | 'new_start' | 'new_end' | 'missed'>>

/** Save this week's change for one occurrence (creates or updates its row; never deletes). */
export async function saveChange(sb: SupabaseClient, userId: string, o: Occurrence, fields: ChangeFields): Promise<string | null> {
  const values = {
    user_id: userId, event_id: o.event.id, on_date: o.usualDate,
    cancelled: o.change?.cancelled ?? false, new_date: o.change?.new_date ?? null,
    new_start: o.change?.new_start ?? null, new_end: o.change?.new_end ?? null, missed: o.change?.missed ?? false,
    ...fields,
  }
  const { data, error } = await sb.from('event_exceptions')
    .upsert(values, { onConflict: 'user_id,event_id,on_date' }).select('id').single()
  return error || !data ? `Not saved: ${error?.message ?? 'unknown error'}` : null
}

/** Put an occurrence's change back exactly as it was (for Undo). */
export const restoreChange = (sb: SupabaseClient, userId: string, o: Occurrence) =>
  saveChange(sb, userId, { ...o, change: null }, {
    cancelled: o.change?.cancelled ?? false, new_date: o.change?.new_date ?? null,
    new_start: o.change?.new_start ?? null, new_end: o.change?.new_end ?? null, missed: o.change?.missed ?? false,
  })

/** Delete = archive (with Undo). Nothing is hard-deleted. */
export async function setEventArchived(sb: SupabaseClient, ev: EventRow, archived: boolean): Promise<string | null> {
  const { data, error } = await sb.from('events')
    .update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', ev.id).select('id').single()
  return error || !data ? `Couldn't ${archived ? 'delete' : 'restore'} “${ev.title}”: ${error?.message ?? 'not saved'}` : null
}
