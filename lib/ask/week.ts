import { addDays, isoDow, weekStartISO } from '../time'

/** Which days the check-in plans: on Sat/Sun the coming Mon–Sun; otherwise the rest of this week. */
export function checkinRange(today: string): { from: string; to: string } {
  const dow = isoDow(today)
  if (dow >= 6) { const mon = addDays(today, 8 - dow); return { from: mon, to: addDays(mon, 6) } }
  return { from: today, to: addDays(weekStartISO(today), 6) }
}
