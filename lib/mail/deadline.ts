// The deadline of a homework email, read from its words in plain code (no AI, no database): "Due 20th October 2026",
// "before Monday evening at 8pm", "by Friday", "due tomorrow 9am", "deadline: 3/11". Only words next to a deadline
// word count (due, deadline, by, before, until, for, hand in, submit…), so "lesson on Monday at 5pm" isn't one.
// - A weekday is the next one after the day the email was sent; a date without a year is the next one from then.
// - "before Monday" with no time means by the end of Sunday; with a time ("before Monday 8pm") it's that time.
// - The subject and the body are both read; when they disagree, the earlier deadline wins.
// - No deadline in the words: the day it was sent, marked as a guess.
import { addDays, dateISOOf, isoDow } from '../time'

export type Deadline = {
  date: string              // YYYY-MM-DD (London)
  time: string | null       // HH:MM, only when the email gives a clock time
  words: string             // the email's own words it came from ('' for a guess)
  from: 'subject' | 'body' | 'sent'
  guess: boolean            // true: no deadline in the email, so the day it was sent
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MONTH = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const WEEKDAY = '(mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)'
const ORD = '(\\d{1,2})(?:st|nd|rd|th)?'
const TIME = '(?:(?:at|by|before|for|until|till)\\s+)?(?:(\\d{1,2})(?:[:.](\\d{2}))?\\s?(am|pm)|([01]?\\d|2[0-3]):([0-5]\\d)|(noon|midday|midnight))'
const PART = '(?:(?:in\\s+the\\s+)?(?:morning|afternoon|evening|night)\\s+)?'

// One deadline word, then (optionally a time, then "on") a day: the whole phrase is matched so its words can be quoted.
const TRIGGER = '\\b(due(?:\\s+(?:on|by|in))?|deadline(?:\\s+is)?:?|hand(?:ed)?[- ]?in(?:\\s+(?:on|by))?|submit(?:ted)?(?:\\s+(?:on|by))?|(?:complete|done|finish(?:ed)?)\\s+by|by|before|until|till|no\\s+later\\s+than|for)'
const DAY = [
  `(today|tonight|tomorrow|tmrw)`,
  // "Tuesday 27th October" (a number after a weekday is a date only with its month: "Monday 8pm" is a time)
  `(?:(?:next|this|on)\\s+)?${WEEKDAY}\\b(?:\\s+${ORD}\\s+${MONTH}\\b)?`,
  `(?:the\\s+)?${ORD}(?:\\s+of)?\\s+${MONTH}\\b(?:,?\\s+(\\d{4}))?`,
  `${MONTH}\\s+${ORD}\\b(?:,?\\s+(\\d{4}))?`,
  `(\\d{1,2})\\/(\\d{1,2})(?:\\/(\\d{2,4}))?`,
].map((d) => `(?:${d})`).join('|')
const PHRASE = new RegExp(`${TRIGGER}\\s*(?:(?:the\\s+)?(?:end\\s+of\\s+)?)?(?:${TIME}\\s+(?:on\\s+)?)?(?:${DAY})(?:\\s*,?\\s*${PART}${TIME})?`, 'gi')

const pad = (n: number) => String(n).padStart(2, '0')
const validDate = (y: number, m: number, d: number) => {
  const iso = `${y}-${pad(m)}-${pad(d)}`
  return m >= 1 && m <= 12 && d >= 1 && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null
}
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1

/** "8", "30", "pm" | "20", "00" | "noon" → "20:30"; null when it isn't a clock time. */
function clock(h12?: string, m12?: string, ap?: string, h24?: string, m24?: string, word?: string): string | null {
  if (word) return /midnight/i.test(word) ? '23:59' : '12:00'
  if (h24 !== undefined && m24 !== undefined) return `${pad(+h24)}:${m24}`
  if (h12 === undefined || !ap) return null
  let h = +h12
  if (h < 1 || h > 12) return null
  if (/pm/i.test(ap) && h !== 12) h += 12
  if (/am/i.test(ap) && h === 12) h = 0
  return `${pad(h)}:${m12 ?? '00'}`
}

/** A date without a year: the next one from the day it was sent (a few days back still counts as this year's). */
function nextDate(month: number, day: number, year: number | null, sent: string): string | null {
  if (year) return validDate(year < 100 ? 2000 + year : year, month, day)
  const y = +sent.slice(0, 4)
  const same = validDate(y, month, day)
  if (same && same >= addDays(sent, -14)) return same
  return validDate(y + 1, month, day)
}

/** The next given weekday strictly after the day it was sent. */
function nextWeekday(name: string, sent: string): string {
  const want = DAYS.indexOf(name.slice(0, 3).toLowerCase()) + 1
  let d = addDays(sent, 1)
  while (isoDow(d) !== want) d = addDays(d, 1)
  return d
}

/** Every deadline phrase in one piece of text. */
export function deadlinesIn(text: string, sent: string): { date: string; time: string | null; words: string }[] {
  const out: { date: string; time: string | null; words: string }[] = []
  const t = text.replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ')
  for (const m of t.matchAll(PHRASE)) {
    const g = m.slice(1)
    const trigger = (g[0] ?? '').toLowerCase()
    // groups: trigger | time before (6) | rel | weekday, its day, its month | day, month, year | month, day, year | d/m/y | time after (6)
    const before = clock(g[1], g[2], g[3], g[4], g[5], g[6])
    const [rel, wd, wdDay, wdMonth, d1, m1, y1, m2, d2, y2, nd, nm, ny] = g.slice(7, 20)
    const after = clock(g[20], g[21], g[22], g[23], g[24], g[25])
    let date: string | null = null
    if (rel) {
      const r = rel.toLowerCase()
      date = r === 'tomorrow' || r === 'tmrw' ? addDays(sent, 1) : sent
    } else if (wd) {
      // "Tuesday 20th October": the date wins over the weekday; "Monday" alone: the next one after it was sent
      date = wdDay && wdMonth ? nextDate(monthOf(wdMonth), +wdDay, null, sent) : nextWeekday(wd, sent)
    } else if (d1 && m1) date = nextDate(monthOf(m1), +d1, y1 ? +y1 : null, sent)
    else if (m2 && d2) date = nextDate(monthOf(m2), +d2, y2 ? +y2 : null, sent)
    else if (nd && nm) date = nextDate(+nm, +nd, ny ? +ny : null, sent)   // UK order: day/month
    if (!date) continue
    // "for" is only a deadline before a day ("for Thursday"), never "for 30 minutes": the day is required above
    let time = before ?? after
    // "before Monday" (no time): the end of Sunday
    if (trigger === 'before' && !time) date = addDays(date, -1)
    if (time === '00:00') time = null
    out.push({ date, time, words: m[0].trim() })
  }
  return out
}

const key = (x: { date: string; time: string | null }) => `${x.date} ${x.time ?? '23:59'}`

/** The email's deadline: the earliest one in the subject or the body; else the day it was sent (a guess). */
export function findDeadline(input: { subject: string | null; body: string | null; sentAt: string }): Deadline {
  const sent = dateISOOf(input.sentAt)
  const found = [
    ...deadlinesIn(input.subject ?? '', sent).map((x) => ({ ...x, from: 'subject' as const })),
    ...deadlinesIn(input.body ?? '', sent).map((x) => ({ ...x, from: 'body' as const })),
  ]
  if (!found.length) return { date: sent, time: null, words: '', from: 'sent', guess: true }
  found.sort((a, b) => key(a).localeCompare(key(b)) || (a.time ? -1 : 1) - (b.time ? -1 : 1))
  const best = found[0]
  // the same day said twice ("Due Monday" … "before Monday evening at 8pm"): keep the one with a time
  const timed = found.find((x) => x.date === best.date && x.time)
  return { ...(timed ?? best), guess: false }
}
