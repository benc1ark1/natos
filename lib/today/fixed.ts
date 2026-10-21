// Item 18: is a training session fixed (he has to be there at that time)? Only fixed things show a clock time and a
// leave-by line on Today; a session the planner placed itself shows its minutes, like study. Fixed = his set time for
// that session on that weekday (Owen's days with a time, "speed Tue 18:30"; the holiday times in a holiday week) and
// the session is at it. (Calendar events are fixed too: they're on the fixed line.) Pure.
import { activeSessions, findSession, fixedDaysFor, parseSessionTitle } from '../setup'
import { addDays, isoDow, weekStartISO } from '../time'
import { isHoliday } from './holidays'

/** A holiday week, as the week planner decides it (lib/week.ts): most of its weekdays are holidays. */
const holidayWeek = (planning: unknown, date: string) => {
  const mon = weekStartISO(date)
  return [0, 1, 2, 3, 4].filter((i) => isHoliday(planning, addDays(mon, i))).length * 2 > 5
}

export function isFixedSession(planning: unknown, date: string, title: string, start: string): boolean {
  const { times } = fixedDaysFor(planning, holidayWeek(planning, date))
  // "Upper @ PureGym" / "Upper · PureGym": the session's name is before the place
  const name = parseSessionTitle(title).name.split(' · ')[0]
  const s = findSession(activeSessions(planning), name)
  return !!s && times[s.key]?.[String(isoDow(date))] === start.slice(0, 5)
}
