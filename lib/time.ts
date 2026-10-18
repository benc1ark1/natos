// Date helpers. Everything is worked out in the user's timezone (Europe/London
// by default), using plain 'YYYY-MM-DD' strings for calendar days.

export const DEFAULT_TZ = 'Europe/London'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DOW_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const pad = (n: number) => String(n).padStart(2, '0')

type Parts = { y: number; m: number; d: number; hh: number; mm: number }

export function zonedParts(date: Date, tz = DEFAULT_TZ): Parts {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  })
  const p: Record<string, string> = {}
  for (const x of f.formatToParts(date)) p[x.type] = x.value
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute }
}

export function todayISO(tz = DEFAULT_TZ): string {
  const p = zonedParts(new Date(), tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

export function dateISOOf(ts: string, tz = DEFAULT_TZ): string {
  const p = zonedParts(new Date(ts), tz)
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

export function timeOf(ts: string | Date, tz = DEFAULT_TZ): string {
  const p = zonedParts(typeof ts === 'string' ? new Date(ts) : ts, tz)
  return `${pad(p.hh)}:${pad(p.mm)}`
}

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(iso: string, n: number): string {
  const dt = toUTC(iso)
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

/** ISO weekday: 1 = Mon ... 7 = Sun */
export function isoDow(iso: string): number {
  const w = toUTC(iso).getUTCDay()
  return w === 0 ? 7 : w
}

export function weekStartISO(iso: string): string {
  return addDays(iso, 1 - isoDow(iso))
}

export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / 86400000)
}

export const dowShort = (iso: string) => DOW[isoDow(iso) - 1]
export const dayNum = (iso: string) => iso.slice(8, 10)
export const shortDate = (iso: string) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`
export const longDate = (iso: string) =>
  `${DOW_LONG[isoDow(iso) - 1]}, ${+iso.slice(8, 10)} ${MON_LONG[+iso.slice(5, 7) - 1]}`
export const navDate = (iso: string) => `${dowShort(iso)} ${dayNum(iso)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`

export function tzAbbrev(tz = DEFAULT_TZ): string {
  const part = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date()).find((x) => x.type === 'timeZoneName')
  return part?.value ?? tz
}

export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** A due date picked as a day is stored at midday UTC so it is the same day in London all year. */
export const dueAtFromDate = (iso: string) => `${iso}T12:00:00Z`

/** Every 15 minutes, 00:00 to 23:45 */
export const TIMES_15 = Array.from({ length: 96 }, (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`)

/** 'HH:MM:SS' -> 'HH:MM' */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '')

export const minutesOf = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function relativeDay(iso: string, today: string): string {
  const diff = daysBetween(today, iso)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return ''
}

/** A wall-clock day and 'HH:MM' in the user's timezone -> the exact moment (ISO, UTC). */
export function zonedToUTC(iso: string, time: string, tz = DEFAULT_TZ): string {
  const [y, m, d] = iso.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  const wanted = Date.UTC(y, m - 1, d, hh, mm)
  let t = wanted
  // correct by the zone's offset; twice so a clock change in between still lands right
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(t), tz)
    t += wanted - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm)
  }
  return new Date(t).toISOString()
}
