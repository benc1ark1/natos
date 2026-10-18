import type { SupabaseClient } from '@supabase/supabase-js'
import type { Reminder } from './types'
import { rows } from './data'
import { dateISOOf, dowShort, shortDate, timeOf, todayISO, zonedToUTC } from './time'

/** Open reminders that can still show: person ones, and day/time ones from today on. */
export async function loadReminders(sb: SupabaseClient): Promise<Reminder[]> {
  const today = todayISO()
  const res = await sb.from('reminders').select('*').is('done_at', null)
    .or(`kind.eq.person,remind_on.gte.${today},remind_at.gte.${zonedToUTC(today, '00:00')}`)
    .order('created_at')
  return rows<Reminder>(res, 'reminders')
}

/** The day a day/time reminder belongs to (null for person reminders). */
export const dayOf = (r: Reminder): string | null =>
  r.kind === 'day' ? r.remind_on : r.kind === 'time' && r.remind_at ? dateISOOf(r.remind_at) : null

/**
 * Split into what shows now ("Remember today") and what's coming later.
 * Today: today's day reminders, time reminders whose time has come today, all person reminders.
 */
export function splitReminders(list: Reminder[], today: string, now: Date) {
  const nowList: Reminder[] = []
  const later: Reminder[] = []
  for (const r of list) {
    if (r.kind === 'person') { nowList.push(r); continue }
    const d = dayOf(r)
    if (!d || d < today) continue
    if (d === today && (r.kind === 'day' || new Date(r.remind_at!) <= now)) nowList.push(r)
    else later.push(r)
  }
  const at = (r: Reminder) => (r.kind === 'time' ? r.remind_at! : r.kind === 'day' ? `${r.remind_on}T00:00` : '~')
  nowList.sort((a, b) => (at(a) < at(b) ? -1 : 1))
  later.sort((a, b) => (at(a) < at(b) ? -1 : 1))
  return { now: nowList, later }
}

/** Short label shown before the text: "16:00", "Fri 9 Oct", "Sam". */
export function reminderWhen(r: Reminder, today: string): string {
  if (r.kind === 'person') return r.person ?? ''
  const d = dayOf(r)!
  const day = d === today ? '' : `${dowShort(d)} ${shortDate(d)}`
  return r.kind === 'time' ? [day, timeOf(r.remind_at!)].filter(Boolean).join(' ') : day
}

export async function setReminderDone(sb: SupabaseClient, r: Reminder, done: boolean): Promise<string | null> {
  const { data, error } = await sb.from('reminders')
    .update({ done_at: done ? new Date().toISOString() : null })
    .eq('id', r.id).select('id').single()
  return error || !data ? `Couldn't ${done ? 'tick' : 'undo'} “${r.body}”: ${error?.message ?? 'not saved'}` : null
}
