// Pure: Nat's casual words for his own plans → a name, a day and a time ("family dinner Sat 7" → Family dinner,
// Sat 24 Oct 19:00–21:00). No database and no clock: today (and the minute it is now) come in, Europe/London days.
// Strict on purpose: anything it isn't sure about gives null, and the brain reads the message instead.
// Casual times follow the brain's rule (lib/telegram/brain.ts "Casual times"): football, dinner, friends, the cinema
// and anything after school are in the evening ("7" = 19:00, "8-11" = 20:00–23:00); am / morning words mean morning.
import { addDays, daysBetween, isoDow, weekStartISO } from '../time'

export type Part = 'morning' | 'afternoon' | 'evening' | null
/** What kind of plan it is, from its words: decides an ambiguous hour and the guessed length. */
export type Kind = 'evening' | 'morning' | 'appointment' | null
export type TimeSpec = { h: number; m: number; ap: 'am' | 'pm' | null; fixed: boolean }
export type DayRef = { date: string; words: string; weekday: boolean; part: Part }

/** A new event from his words (one-off, or weekly when he said every / weekly). */
export type NewEvent = {
  title: string
  date: string                 // the day (weekly: the first one from today)
  dateWords: string            // his words for the day, exactly as typed ("tomorrow", "Sat", "every Wed")
  start: string                // HH:MM
  end: string                  // HH:MM
  lengthGuess: number | null   // minutes, when he gave no end (the card says it's a guess)
  allDay: boolean
  weekly: { words: string; days: number[] } | null
}

const pad = (n: number) => String(n).padStart(2, '0')
export const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
const LAST = 23 * 60 + 59

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const DAY = '(?:mon|monday|tue|tues|tuesday|wed|weds|wednesday|wensday|wedensday|thu|thur|thurs|thursday|thrusday|thurday|fri|friday|sat|saturday|sun|sunday)'
const DAYS_PLURAL = '(?:mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)'
const MONTH = '(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)'
const REL = '(?:today|tonight|tmrw|tmr|tmrow|tomoz|2moro|2morrow|tomorow|tommorow|tommorrow|tomorrow)'
const PART_WORD = '(?:morning|afternoon|evening|night|lunchtime)'

/** "wed", "Weds", "Wednesday", "thrusday" → 3 (ISO weekday). */
export function dayIndex(word: string): number | null {
  const w = word.toLowerCase()
  if (w.startsWith('mon')) return 1
  if (w.startsWith('tu')) return 2
  if (w.startsWith('we')) return 3
  if (w.startsWith('th')) return 4
  if (w.startsWith('fr')) return 5
  if (w.startsWith('sa')) return 6
  if (w.startsWith('su')) return 7
  return null
}
const monthIndex = (word: string) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(word.toLowerCase().slice(0, 3)) + 1
const partOf = (w: string | undefined): Part => {
  const x = (w ?? '').toLowerCase()
  if (x === 'morning') return 'morning'
  if (x === 'afternoon' || x === 'lunchtime' || x === 'lunch') return 'afternoon'
  if (x === 'evening' || x === 'night' || x === 'tonight') return 'evening'
  return null
}

const has = (text: string, words: string) => new RegExp(`\\b(?:${words})\\b`, 'i').test(text)
const EVENING = "football|footy|futsal|training|gym|club|dinner|tea|supper|party|drinks|pub|cinema|film|movie|movies|gig|concert|theatre|theater|sleepover|bowling|restaurant|takeaway|friends|mates|out|bbq|barbecue|disco|prom|quiz|karaoke|nandos|owen"
// ("school" only counts as morning when it's the whole name: "school play Thu 7" is unsure, so the brain asks)
const MORNING = 'breakfast|brunch|lesson|lessons|class|assembly|run|jog'
const APPOINTMENT = 'dentist|dentists|doctor|doctors|gp|orthodontist|optician|opticians|hospital|appointment|appt|haircut|barber|barbers|hairdresser|hairdressers|physio|checkup|check-up|vaccine|vaccination|jab|interview|meeting|clinic'

/** Evening, morning or appointment, from the words (null when it can't tell, or they disagree). */
export function kindOf(text: string): Kind {
  if (/^\s*school\s*$/i.test(text)) return 'morning'
  const ap = has(text, APPOINTMENT), ev = has(text, EVENING), mo = has(text, MORNING)
  if (ap && !ev) return 'appointment'
  if (ev && !mo) return 'evening'
  if (mo && !ev) return 'morning'
  return null
}

/** How long it usually lasts when he gives no end: meal 2 h, football 1.5 h, appointment 1 h, cinema 2.5 h, party 3 h, else 1 h. */
export function guessLength(text: string): number {
  if (has(text, APPOINTMENT)) return 60
  if (has(text, 'football|footy|futsal|match|training')) return 90
  if (has(text, 'cinema|film|movie|movies')) return 150
  if (has(text, 'party|gig|concert|prom|disco|celebration')) return 180
  if (has(text, 'dinner|lunch|breakfast|brunch|meal|tea|supper|restaurant|nandos|bbq|barbecue')) return 120
  return 60
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** The next date with this ISO weekday, today counting. */
const nextDow = (today: string, dow: number) => addDays(today, (dow - isoDow(today) + 7) % 7)

/** A real calendar date? */
const realDate = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const iso = `${y}-${pad(m)}-${pad(d)}`
  return new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null
}
/** "24th" → the next 24th (this month, else next); "24 Oct" → this year's, else next year's. */
function dayOfMonth(today: string, d: number, month: number | null): string | null {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  if (month) {
    const iso = realDate(y, month, d)
    if (iso && iso >= today) return iso
    return realDate(y + 1, month, d)
  }
  for (let i = 0; i < 2; i++) {
    const mm = ((m - 1 + i) % 12) + 1, yy = y + Math.floor((m - 1 + i) / 12)
    const iso = realDate(yy, mm, d)
    if (iso && iso >= today) return iso
  }
  return null
}

type Found<T> = { value: T; index: number; length: number }
const span = <T,>(m: RegExpExecArray, value: T): Found<T> => ({ value, index: m.index, length: m[0].length })

/**
 * The one day in his words, and where it is: "tomorrow", "tonight", "Sat", "this Sat", "next Sat", "Sat 24th",
 * "Saturday the 24th", "24th", "the 24th of Oct", "24 Oct", "Oct 24", "24/10". A weekday is the next one (today
 * counting); "next Sat" is the one after this week's. A weekday and a date that disagree → 'bad'.
 */
export function findDay(text: string, today: string): Found<DayRef> | 'bad' | null {
  let m = new RegExp(`\\b(?:(?:on|for)\\s+)?(${REL}|this\\s+(?:morning|afternoon|evening))(?:\\s+(?:in\\s+the\\s+)?(${PART_WORD}))?\\b`, 'i').exec(text)
  if (m) {
    const w = m[1].toLowerCase()
    const date = /^(today|tonight|this )/.test(w) ? today : addDays(today, 1)
    const part = w === 'tonight' ? 'evening' : w.startsWith('this ') ? partOf(w.slice(5)) : partOf(m[2])
    return span(m, { date, words: m[0].replace(/^(?:on|for)\s+/i, ''), weekday: false, part })
  }
  m = new RegExp(`\\b(?:(?:on|for)\\s+)?(?:(this|next|coming)\\s+)?(${DAY})(?:\\s+(${PART_WORD}))?(?:\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)(?:\\s+(?:of\\s+)?(${MONTH}))?|\\s+(\\d{1,2})\\s+(${MONTH}))?\\b`, 'i').exec(text)
  if (m) {
    const dow = dayIndex(m[2])!
    const words = m[0].replace(/^(?:on|for)\s+/i, '')
    const num = m[4] ?? m[6]
    if (num) {
      const date = dayOfMonth(today, Number(num), m[5] ?? m[7] ? monthIndex(m[5] ?? m[7]) : null)
      if (!date || isoDow(date) !== dow) return 'bad'
      return span(m, { date, words, weekday: false, part: partOf(m[3]) })
    }
    let date = nextDow(today, dow)
    if (m[1]?.toLowerCase() === 'next' && daysBetween(today, date) < 7 && weekStartISO(date) === weekStartISO(today)) date = addDays(date, 7)
    return span(m, { date, words, weekday: true, part: partOf(m[3]) })
  }
  // "Oct 24th" first, so its month isn't left behind by "24th"
  m = new RegExp(`\\b(?:(?:on|for)\\s+)?(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i').exec(text)
  if (m) {
    const date = dayOfMonth(today, Number(m[2]), monthIndex(m[1]))
    return date ? span(m, { date, words: m[0].replace(/^(?:on|for)\s+/i, ''), weekday: false, part: null }) : 'bad'
  }
  m = new RegExp(`\\b(?:(?:on|for)\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)(?:\\s+(?:of\\s+)?(${MONTH}))?\\b`, 'i').exec(text)
    ?? new RegExp(`\\b(?:(?:on|for)\\s+)?(\\d{1,2})\\s+(${MONTH})\\b`, 'i').exec(text)
  if (m) {
    const date = dayOfMonth(today, Number(m[1]), m[2] ? monthIndex(m[2]) : null)
    return date ? span(m, { date, words: m[0].replace(/^(?:on|for)\s+/i, ''), weekday: false, part: null }) : 'bad'
  }
  m = /\b(?:(?:on|for)\s+)?(\d{1,2})\/(\d{1,2})\b/i.exec(text)
  if (m) {
    const y = Number(today.slice(0, 4))
    const date = realDate(y, Number(m[2]), Number(m[1]))
    const iso = date && date >= today ? date : realDate(y + 1, Number(m[2]), Number(m[1]))
    return iso ? span(m, { date: iso, words: m[0].replace(/^(?:on|for)\s+/i, ''), weekday: false, part: null }) : 'bad'
  }
  return null
}

/** Any other day words left over (two days in one message: unsure). */
const moreDays = (text: string) => new RegExp(`\\b(?:${REL}|${DAY}|${DAYS_PLURAL}|weekdays?|weekends?)\\b|\\b\\d{1,2}(?:st|nd|rd|th)\\b|\\b\\d{1,2}\\s+${MONTH}\\b|\\b${MONTH}\\s+\\d{1,2}\\b|\\b\\d{1,2}/\\d{1,2}\\b`, 'i').test(text)

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

const ATOM = "(?:half(?:\\s+past)?\\s+\\d{1,2}|quarter\\s+(?:past|to)\\s+\\d{1,2}|noon|midday|midnight|\\d{1,2}(?:[:.]\\d{2})?(?:\\s*(?:am|pm|a\\.m\\.?|p\\.m\\.?))?(?:\\s*o'?clock)?(?:ish)?)"
const ATOM_RE = new RegExp(`^${ATOM}$`, 'i')

/** One time as he typed it ("7", "7:45", "7.45pm", "19:45", "half 7", "quarter to 8", "noon"). 'midnight' only ends things. */
export function timeAtom(raw: string): TimeSpec | 'midnight' | null {
  const s = raw.trim().toLowerCase().replace(/ish$/, '').replace(/\s*o'?clock$/, '').trim()
  if (!ATOM_RE.test(raw.trim())) return null
  if (s === 'noon' || s === 'midday') return { h: 12, m: 0, ap: 'pm', fixed: true }
  if (s === 'midnight') return 'midnight'
  let m = s.match(/^half(?:\s+past)?\s+(\d{1,2})$/)
  if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? { h: Number(m[1]), m: 30, ap: null, fixed: false } : null
  m = s.match(/^quarter\s+(past|to)\s+(\d{1,2})$/)
  if (m) {
    const h = Number(m[2])
    if (h < 1 || h > 12) return null
    return m[1] === 'past' ? { h, m: 15, ap: null, fixed: false } : { h: h === 1 ? 12 : h - 1, m: 45, ap: null, fixed: false }
  }
  m = s.match(/^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.?|p\.m\.?)?$/)
  if (!m) return null
  const h = Number(m[1]), min = m[2] ? Number(m[2]) : 0
  if (min > 59) return null
  const ap = m[3] ? (m[3].startsWith('a') ? 'am' : 'pm') : null
  if (ap) return h >= 1 && h <= 12 ? { h, m: min, ap, fixed: false } : null
  if (h > 23) return null
  // "19:45", "07:30": the 24-hour clock says exactly when
  return { h, m: min, ap: null, fixed: h >= 13 || (m[1].length === 2 && m[1].startsWith('0')) }
}

export type TimeCtx = { part: Part; kind: Kind; near?: number | null }

/**
 * Minutes after midnight for one time, read as he means it. am/pm or the 24-hour clock say exactly; then "morning",
 * "afternoon", "evening"; then: 1–6 = afternoon/evening; 7–11 = evening for evening things, morning for appointments
 * and morning things; with `near` (an event's current start, when moving it) the nearer of the two; otherwise 9–11 =
 * morning and 7–8 = unsure (null).
 */
export function resolveTime(t: TimeSpec, ctx: TimeCtx): number | null {
  const at = (h: number) => h * 60 + t.m
  if (t.ap === 'am') return at(t.h === 12 ? 0 : t.h)
  if (t.ap === 'pm') return at(t.h === 12 ? 12 : t.h + 12)
  if (t.fixed) return at(t.h)
  const h = t.h
  if (h === 0) return null
  if (h === 12) return ctx.part === 'evening' ? null : at(12)
  if (ctx.part === 'morning') return h >= 5 ? at(h) : null
  if (ctx.part === 'afternoon') return h <= 7 ? at(h + 12) : null
  if (ctx.part === 'evening') return h >= 4 ? at(h + 12) : null
  if (h <= 6) return at(h + 12)
  if (ctx.kind === 'appointment') return h >= 9 ? at(h) : null
  if (ctx.kind === 'morning') return at(h)
  if (ctx.near != null) return Math.abs(at(h) - ctx.near) < Math.abs(at(h + 12) - ctx.near) ? at(h) : at(h + 12)
  // evening things: 7–9 are the evening; 10 or 11 could be a morning game or a late night: unsure (the brain asks)
  if (ctx.kind === 'evening') return h <= 9 ? at(h + 12) : null
  return h >= 9 ? at(h) : null
}

/** The end of a range: the first of h / h+12 after the start, at most 14 hours on (null if it would pass midnight). */
function endAfter(start: number, t: TimeSpec | 'midnight'): number | null {
  if (t === 'midnight') return LAST
  // "party 8-12", "9pm-12": an end of 12 after a start in the afternoon/evening is midnight
  if (t.h === 12 && t.m === 0 && t.ap !== 'pm' && !t.fixed && start >= 12 * 60) return LAST
  if (t.ap || t.fixed) { const e = resolveTime(t, { part: null, kind: null }); return e !== null && e > start ? e : null }
  for (const h of [t.h % 12, (t.h % 12) + 12]) {
    const e = h * 60 + t.m
    if (e > start && e - start <= 14 * 60) return e
  }
  return null
}

/** "2–9pm", "8-11", "4-5:30", "10am-2", "7pm-9", "11-1": start and end in minutes, read as he means them. */
export function resolveRange(a: TimeSpec, b: TimeSpec | 'midnight', ctx: TimeCtx): { start: number; end: number } | null {
  if (b !== 'midnight' && b.h === 12 && b.m === 0 && b.ap === 'am') b = 'midnight'   // "8pm-12am"
  let start: number | null
  if (!a.ap && !a.fixed && b !== 'midnight' && (b.ap || b.fixed)) {
    // the end says am/pm: the start is the latest reading of it that's before the end ("2-9pm" = 14:00, "10-2pm" = 10:00)
    const end = resolveTime(b, ctx)
    if (end === null) return null
    const options = a.h === 12 ? [12 * 60 + a.m] : [a.h * 60 + a.m, (a.h + 12) * 60 + a.m]
    start = options.filter((x) => x < end && end - x <= 14 * 60).sort((x, y) => y - x)[0] ?? null
    return start === null ? null : { start, end }
  }
  start = resolveTime(a, ctx)
  if (start === null) return null
  const end = endAfter(start, b)
  return end === null ? null : { start, end }
}

/** "for 2 hours", "for 90 min", "for an hour", "for half an hour", "for 1.5 hours" → minutes. */
const DURATION = /\bfor\s+(an?\s+hour\s+and\s+a\s+half|half\s+an?\s+hour|an?\s+hour|one\s+hour|(?:\d{1,3}(?:\.\d)?|one|two|three|four|five)\s*(?:hours?|hrs?|h|minutes?|mins?|m))\b/i
function durationOf(words: string): number | null {
  const w = words.toLowerCase().replace(/\s+/g, ' ')
  if (/hour and a half/.test(w)) return 90
  if (/^half an? hour/.test(w)) return 30
  if (/^(an?|one) hour$/.test(w)) return 60
  const m = w.match(/^(\d{1,3}(?:\.\d)?|one|two|three|four|five)\s*(hours?|hrs?|h|minutes?|mins?|m)$/)
  if (!m) return null
  const n = ({ one: 1, two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[m[1]] ?? Number(m[1])
  const min = /^h/.test(m[2]) ? Math.round(n * 60) : Math.round(n)
  return min >= 10 && min <= 14 * 60 ? min : null
}

type TimeFound = { a: TimeSpec; b: TimeSpec | 'midnight' | 'late' | null }
/** The one time (or range) in the text and where it is; null if none; 'bad' if there are two, or it isn't a time. */
export function findTime(text: string): Found<TimeFound> | 'bad' | null {
  const range = new RegExp(`(?:\\b(?:from|at)\\s+|@\\s*)?(?<![\\w:.])(${ATOM})\\s*(?:-|to|till|til|until|'til)\\s*(${ATOM}|late)(?![\\w:])`, 'i').exec(text)
  let found: Found<TimeFound> | null = null
  if (range) {
    const a = timeAtom(range[1]), b = /^late$/i.test(range[2]) ? 'late' as const : timeAtom(range[2])
    if (!a || a === 'midnight' || !b) return 'bad'
    found = span(range, { a, b })
  } else {
    const single = new RegExp(`(?:\\b(?:at|from)\\s+|@\\s*)?(?<![\\w:.])(${ATOM})(?![\\w:])`, 'i').exec(text)
    if (!single) return null
    const a = timeAtom(single[1])
    if (!a || a === 'midnight') return 'bad'
    found = span(single, { a, b: null })
  }
  const rest = text.slice(0, found.index) + ' ' + text.slice(found.index + found.length)
  if (/\d/.test(rest) || /\b(?:noon|midday|midnight|half past|quarter (?:past|to))\b/i.test(rest)) return 'bad'
  return found
}

// ---------------------------------------------------------------------------
// The name
// ---------------------------------------------------------------------------

const LEAD = /^(?:(?:ok(?:ay)?|so|right|also|and|oh|btw|yo|hey)[,\s]+)*(?:(?:can you |could you |please |pls )?(?:add|put|book|schedule|pencil in|stick)\s+(?:in\s+)?)?(?:(?:i'?m|i am|im|i have|i've got|ive got|i got|got|we're|we are|we have|there'?s|there is)\s+)?(?:(?:going|gonna|heading)\s+(?:to\s+(?:the\s+)?)?)?(?:(?:a|an)\s+)?/i
const TRAIL = /\s+(?:(?:to|in|on|into)\s+(?:my|the)\s+(?:calendar|diary|cal|life os(?: calendar)?)|please|pls|thanks|thx|ta)\s*$/i

/** The name left over: his own words, first letter capitalised; null if it isn't a clear name. */
export function cleanTitle(rest: string): string | null {
  let t = rest.replace(/[,;:!.]+/g, ' ').replace(/\s+-\s+|\s+-$|^-\s+/g, ' ').replace(/\s+/g, ' ').trim()
  for (let i = 0; i < 3; i++) t = t.replace(TRAIL, '').replace(/\s+(?:at|on|from|for|this|next|@|-)$/i, '').trim()
  t = t.replace(LEAD, '').replace(/^(?:at|on|from|for|@|-)\s+/i, '').trim()
  if (!t || t.length > 60 || /\d|[?#/\\]/.test(t)) return null
  const words = t.split(' ')
  if (words.length > 8 || !/[a-z]{2}/i.test(t)) return null
  if (/^(?:it|that|this|them|those|these|something|stuff|things?|plans?|busy|free|out)$/i.test(t)) return null
  // settings, study, his set-up's sessions, or a sentence rather than a name: not a new event (the brain reads it)
  if (NOT_A_TITLE.test(t) || /\b(?:after|until|till|til|before|from|by|was|is|are|were|be|been)$|'s$/i.test(t)) return null
  if (/\brevision\b/i.test(t) && !/\b(?:session|class|club|lesson|group|day)\b/i.test(t)) return null
  return t[0].toUpperCase() + t.slice(1)
}
const NOT_A_TITLE = /\b(?:brief|check ?-?in|wake|waking|up|bed|bedtime|sleep|alarm|quiet|free|study|studying|revise|revising|bicen|textbook|homework|routine|reminder|priorit\w*|rule|setting|test|exam|task|block|plan|limit|cap|idea|topic|goal|game|games|match|matches|fixture|owen|pause|ends?|starts?|is|was|are|were)\b/i

/** Messages that read as something else (a question, a log, a reminder, a task or test, a change): never an event or App idea. */
export const looksLikeOther = (text: string) => NOT_NEW.test(text)

/** Repeats the app can't do yet (every other week, monthly): the one-line App idea for them. */
export function unsupportedRepeat(text: string): string | null {
  if (/\b(?:every other|every second|alternate) days?\b/i.test(text)) return 'Add calendar events that repeat every other day from Telegram'
  if (/\b(?:every other|every second|every (?:2|two) weeks|fortnightly|bi-?weekly)\b/i.test(text)) return 'Add calendar events that repeat every other week (fortnightly) from Telegram'
  if (/\b(?:monthly|every month|once a month|(?:first|second|third|last|1st|2nd|3rd) (?:mon|tue|wed|thu|fri|sat|sun)[a-z]* of (?:the|every) month)\b/i.test(text)) return 'Add calendar events that repeat every month from Telegram'
  return null
}

// Messages that are something else: a question, a log of what he did, a reminder, a task or test, a change
const NOT_NEW = /\?|\b(?:what|when|where|which|who|why|how|should|shall|can i|could i|am i|do i|is there|are there|have i|did|done|finished|went|had|remind|reminder|due|homework|hw|test|exam|mock|assessment|deadline|essay|coursework|paper|cancel|cancelled|canceled|move|moved|moving|push|pushed|postpone|postponed|reschedule|instead|now|off|not|no|isn'?t|anymore|any more|change|changed|rename|delete|drop|skip|scrap|remove|plan|until i say|routine|priority|priorities)\b/i
const WEEKLY = new RegExp(`\\b(?:every|each)\\s+(?:${DAY}|${DAYS_PLURAL}|day|weekday|weekdays|weekend|weekends|week)\\b|\\bweekly\\b|\\bdaily\\b`, 'i')
const DAY_LIST = `(?:${DAY}|${DAYS_PLURAL})(?:\\s*(?:,|and|&|\\+|\\/)\\s*(?:${DAY}|${DAYS_PLURAL}))*`

/** Weekdays in his words for a weekly event: "every Monday and Wednesday" → [1, 3]; "every day" → all; "weekdays" → Mon–Fri. */
export function weekdaysOf(words: string): number[] {
  const w = words.toLowerCase()
  if (/\b(?:every ?day|daily)\b/.test(w)) return [1, 2, 3, 4, 5, 6, 7]
  const days = new Set<number>()
  if (/\bweekdays?\b/.test(w)) [1, 2, 3, 4, 5].forEach((d) => days.add(d))
  if (/\bweekends?\b/.test(w)) [6, 7].forEach((d) => days.add(d))
  for (const m of w.matchAll(new RegExp(`\\b(${DAY}|${DAYS_PLURAL})\\b`, 'g'))) days.add(dayIndex(m[1])!)
  return [...days].sort()
}

/**
 * "out with friends tomorrow 2–9pm", "family dinner Sat 7", "football Wed 7:45", "dentist Thursday 3:30",
 * "cinema with Sam Friday 8-11", "revision session at school Tue 4-5:30", "football every Wed 7:45".
 * `nowMin`: minutes after midnight now (a time today that has passed: a weekday name means next week's; "today" → null).
 */
export function parseNewEvent(message: string, today: string, nowMin: number | null = null): NewEvent | null {
  const text = message.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim()
  if (!text || text.length > 120 || NOT_NEW.test(text) || unsupportedRepeat(text)) return null
  let rest = text
  const cut = (f: { index: number; length: number }) => { rest = `${rest.slice(0, f.index)} ${rest.slice(f.index + f.length)}` }

  // all day, a length ("for 2 hours")
  const allDay = /\ball[\s-]day\b/i.test(rest)
  if (allDay) rest = rest.replace(/\b(?:for\s+)?(?:the\s+)?all[\s-]day\b/i, ' ')
  const dur = DURATION.exec(rest)
  const length = dur ? durationOf(dur[1]) : null
  if (dur && length === null) return null
  if (dur) cut(span(dur, null))
  const afterSchool = /\bafter school\b/i.test(rest)
  if (afterSchool) rest = rest.replace(/\bafter school\b/i, ' ')

  // the day: one-off, or the days of a weekly one
  let weekly: NewEvent['weekly'] = null
  let day: DayRef | null = null
  if (WEEKLY.test(rest)) {
    const m = new RegExp(`\\b(?:every|each)\\s+(?:single\\s+)?(?:${DAY_LIST}|day|weekday|weekdays|weekend|weekends)\\b|\\bweekly\\s+on\\s+${DAY_LIST}\\b|\\b(?:on\\s+)?${DAY_LIST}\\s+(?:every|each)\\s+week\\b|\\b(?:every|each)\\s+week\\s+on\\s+${DAY_LIST}\\b|\\bdaily\\b`, 'i').exec(rest)
    if (!m) return null
    const words = m[0].replace(/^on\s+/i, '')
    const days = weekdaysOf(words)
    if (!days.length) return null
    weekly = { words, days }
    cut(span(m, null))
    if (moreDays(rest) || /\b(?:every|each|weekly)\b/i.test(rest)) return null
    const first = days.map((d) => nextDow(today, d)).sort()[0]
    day = { date: first, words, weekday: true, part: null }
  } else {
    const f = findDay(rest, today)
    if (!f || f === 'bad') return null
    day = f.value
    cut(f)
    if (moreDays(rest)) return null
    // "Thursday next week", "Sat week", "Sat after next", "the week after next": a weekday a week or two on
    const mod = /\b(?:the\s+)?(week\s+after\s+next|next\s+week|this\s+week|after\s+next|week\s+on|week)\b/i.exec(rest)
    if (mod) {
      const w = mod[1].toLowerCase().replace(/\s+/g, ' ')
      if (!day.weekday || /^(?:next|this|coming)\b/i.test(day.words)) return null
      const dow = isoDow(day.date)
      const date = w === 'this week' ? day.date
        : w === 'next week' ? addDays(weekStartISO(today), 7 + dow - 1)
          : w === 'week after next' ? addDays(weekStartISO(today), 14 + dow - 1)
            : addDays(day.date, 7)
      if (w === 'this week' && weekStartISO(date) !== weekStartISO(today)) return null
      day = { ...day, date, words: mod[0].trim(), weekday: false }
      cut(span(mod, null))
    }
  }
  // a part of the day said on its own ("in the evening")
  const pm = new RegExp(`\\b(?:in\\s+the\\s+)(${PART_WORD})\\b`, 'i').exec(rest)
  let part: Part = day.part ?? null
  if (pm) { if (part && part !== partOf(pm[1])) return null; part = partOf(pm[1]); cut(span(pm, null)) }

  // the time
  let start: number, end: number, lengthGuess: number | null = null
  if (allDay) {
    if (findTime(rest)) return null
    start = 8 * 60; end = 22 * 60
  } else {
    const t = findTime(rest)
    if (!t || t === 'bad') return null
    cut(t)
    // what it is comes from its name ("after school 4" / "after school 8": afternoon or evening)
    const kind = afterSchool ? 'evening' : kindOf(cleanTitle(rest) ?? '')
    if (t.value.b && t.value.b !== 'late') {
      if (length) return null
      const r = resolveRange(t.value.a, t.value.b, { part, kind })
      if (!r) return null
      start = r.start; end = r.end
    } else {
      const s = resolveTime(t.value.a, { part, kind })
      if (s === null) return null
      start = s
      const len = length ?? guessLength(text)
      if (!length) lengthGuess = len
      end = Math.min(start + len, LAST)
      if (end <= start) return null
    }
  }
  const title = cleanTitle(rest)
  if (!title) return null
  // "every Wed 7:45 from next week / until Christmas / starting …": dates the parser doesn't take: the brain reads it
  if (/\b(?:week|weeks|starting|onwards|from|until|till|ending|through|term)\b/i.test(title)) return null

  let date = day.date
  if (!weekly && date === today && nowMin !== null && start <= nowMin) {
    if (!day.weekday) return null          // "today 9am" at 11: something he did, or a slip — the brain reads it
    date = addDays(date, 7)                // "Mon 7pm" on Monday night: next Monday
  }
  return { title, date, dateWords: day.words, start: hm(start), end: hm(end), lengthGuess, allDay, weekly }
}

// ---------------------------------------------------------------------------
// Cancelling and moving his own events
// ---------------------------------------------------------------------------

export type Scope = 'one' | 'every' | null
export type Target = { day: DayRef | null; nextWeek: boolean; time: { a: TimeSpec; b: TimeSpec | 'midnight' | null } | null; part: Part; shift: number | null; words: string }
export type ParsedChange =
  | { kind: 'cancel'; name: string; day: DayRef | null; scope: Scope }
  | { kind: 'move'; name: string; day: DayRef | null; scope: Scope; to: Target }

const SCOPE_EVERY = /\b(?:every week|each week|for good|altogether|from now on|permanently|for the rest of (?:the )?term|every time)\b/i
const SCOPE_ONE = /\b(?:just this week|this week only|only this week|this week|just this once|this once|this time)\b/i
const FILLER_WORDS = /\b(?:any ?more|after all|please|pls|sadly|unfortunately|now|instead|then|ok(?:ay)?|btw)\b/gi

/** The event's name and the day of the session in "football Wed", "dinner on Sat", "the dentist": lower case. */
function nameAndDay(raw: string, today: string): { name: string; day: DayRef | null; scope: Scope } | null {
  let s = ` ${raw.replace(/[’‘]/g, "'").replace(/[,;:!.]+/g, ' ')} `
  const scope: Scope = SCOPE_EVERY.test(s) ? 'every' : SCOPE_ONE.test(s) ? 'one' : null
  s = s.replace(SCOPE_EVERY, ' ').replace(SCOPE_ONE, ' ').replace(FILLER_WORDS, ' ')
  const f = findDay(s, today)
  if (f === 'bad') return null
  let day: DayRef | null = null
  if (f) { day = f.value; s = `${s.slice(0, f.index)} ${s.slice(f.index + f.length)}` }
  if (moreDays(s) || /\d/.test(s)) return null
  const name = s.toLowerCase().replace(/\b(?:the|my|our|that|this|today'?s|tomorrow'?s|tonight'?s)\b/g, ' ').replace(/'s\b/g, '').replace(/\s+(?:on|at|for|this|next|in)\s*$/, '').replace(/\s+/g, ' ').trim()
  if (!name || name.split(' ').length > 6 || /^(?:it|that|them|this|those|these|one|anything|everything|stuff|plans?)$/.test(name)) return null
  return { name, day, scope }
}

/** The new day/time in "to Thu 8", "now 7:30", "next week", "an hour later": null unless it's clearly one. */
function targetOf(raw: string, today: string): Target | null {
  let s = ` ${raw.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/[,;!]+/g, ' ')} `
  s = s.replace(SCOPE_EVERY, ' ').replace(SCOPE_ONE, ' ')
  let nextWeek = false
  if (/\bnext week\b/i.test(s)) { nextWeek = true; s = s.replace(/\b(?:to\s+)?next week\b/i, ' ') }
  const f = findDay(s, today)
  if (f === 'bad') return null
  let day: DayRef | null = null
  if (f) { day = f.value; s = `${s.slice(0, f.index)} ${s.slice(f.index + f.length)}` }
  if (nextWeek && day) return null
  if (moreDays(s)) return null
  const pm = new RegExp(`\\b(?:in\\s+the\\s+)?(${PART_WORD})\\b`, 'i').exec(s)
  let part: Part = day?.part ?? null
  if (pm) { part = partOf(pm[1]); s = `${s.slice(0, pm.index)} ${s.slice(pm.index + pm[0].length)}` }
  const t = findTime(s)
  if (t === 'bad') return null
  let time: Target['time'] = null
  if (t) {
    if (t.value.b === 'late') return null
    time = { a: t.value.a, b: t.value.b }
    s = `${s.slice(0, t.index)} ${s.slice(t.index + t.length)}`
  }
  if (!day && !time && !nextWeek) return null
  // nothing else may be left but small linking words
  if (s.replace(/\b(?:to|at|on|for|from|the|instead|then|now|please|pls|same time|starts?|start(?:ing)?|is|it'?s|its|be|moved|it)\b/gi, ' ').trim()) return null
  return { day, nextWeek, time, part, shift: null, words: raw.trim() }
}

const SHIFT = /^(an hour|half an hour|\d{1,3}\s*(?:min|mins|minutes|h|hr|hrs|hours?))$/i
const shiftMin = (w: string) => {
  const x = w.toLowerCase()
  if (x === 'an hour') return 60
  if (x === 'half an hour') return 30
  const m = x.match(/^(\d{1,3})\s*(min|mins|minutes|h|hr|hrs|hours?)$/)
  if (!m) return null
  const n = /^h/.test(m[2]) ? Number(m[1]) * 60 : Number(m[1])
  return n >= 5 && n <= 12 * 60 ? n : null
}

/**
 * "cancel family dinner", "dinner's off", "family dinner is cancelled", "not going out tomorrow anymore", "no football
 * Wednesday", "can't make football Wed" → cancel; "move football to Thu 8", "family dinner is now 7:30", "push the
 * dentist to next week", "football moved to Thu 8pm", "push dinner back an hour" → move. The name is matched to his
 * events afterwards (lib/life/match.ts); times are read once the event is known (its kind and current time).
 */
export function parseChange(message: string, today: string): ParsedChange | null {
  const t = message.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '')
  if (!t || t.length > 120 || /\?/.test(t)) return null
  const lead = '(?:(?:ok(?:ay)?|so|actually|oh|btw|right|also)[,\\s]+)*(?:(?:can you|could you|please|pls)\\s+)?'
  let m: RegExpMatchArray | null

  // ---- moves (first: "moved" also reads like "cancelled" words below)
  m = t.match(new RegExp(`^${lead}(?:move|push|shift|bring|reschedule)\\s+(.+?)\\s+(back|forward|later|earlier)\\s+(?:by\\s+)?(an hour|half an hour|\\d{1,3}\\s*(?:min|mins|minutes|h|hr|hrs|hours?))$`, 'i'))
    ?? t.match(new RegExp(`^${lead}(?:move|push|shift|bring|reschedule)\\s+(.+?)\\s+(?:by\\s+)?(an hour|half an hour|\\d{1,3}\\s*(?:min|mins|minutes|h|hr|hrs|hours?))\\s+(back|forward|later|earlier)$`, 'i'))
  if (m) {
    const [dirWord, amount] = SHIFT.test(m[2]) ? [m[3], m[2]] : [m[2], m[3]]
    const n = shiftMin(amount)
    const who = nameAndDay(m[1], today)
    if (!n || !who) return null
    const sign = /^(back|later)$/i.test(dirWord) ? 1 : -1
    return { kind: 'move', ...who, to: { day: null, nextWeek: false, time: null, part: null, shift: sign * n, words: `${m[2]} ${m[3]}` } }
  }
  m = t.match(new RegExp(`^${lead}(?:move|push|shift|change|reschedule|bring|put)\\s+(.+?)\\s+(?:back\\s+to|forward\\s+to|over\\s+to|to|till|until)\\s+(.+)$`, 'i'))
    ?? t.match(/^(?:the |my )?(.+?)(?:'s|\s+is|\s+has|\s+has been|\s+got|\s+was|\s+has got)?\s+(?:now|moved to|moved|been moved to|changed to|pushed to|pushed back to|brought forward to|rescheduled to|rescheduled for|now moved to)\s+(.+)$/i)
    ?? t.match(/^(?:the |my )?(.+?)(?:'s|\s+is)\s+((?:at|on)\s+.+?)\s+instead$/i)
    // "football is at 8 on Thursday", "football's at 8 tomorrow": a change to it (only if that's a day/time)
    ?? t.match(/^(?:the |my )?(.+?)(?:'s|\s+is)\s+((?:at|on)\s+.+)$/i)
  if (m) {
    const who = nameAndDay(m[1], today)
    const to = targetOf(m[2], today)
    if (!who || !to) return null
    return { kind: 'move', ...who, scope: who.scope ?? (SCOPE_EVERY.test(m[2]) ? 'every' : SCOPE_ONE.test(m[2]) ? 'one' : null), to: { ...to, words: m[2].trim() } }
  }

  // ---- cancels
  m = t.match(new RegExp(`^${lead}(?:cancel|scrap|bin|call off|drop)\\s+(.+)$`, 'i'))
    ?? t.match(/^(?:the |my )?(.+?)(?:'s|\s+is|\s+has been|\s+got|\s+was|\s+has got)\s+(?:been\s+)?(?:cancelled|canceled|off|called off|scrapped|not happening)(?:\s+(.+))?$/i)
    ?? t.match(/^(?:the |my )?(.+?)\s+(?:cancelled|canceled|called off)(?:\s+(.+))?$/i)
    ?? t.match(/^(?:i'?m |i am |im )?not (?:going|doing|playing|having|attending|making)(?:\s+to)?\s+(.+)$/i)
    ?? t.match(/^(?:i )?(?:can'?t|cannot|won'?t) (?:make it to|make it|get to|go to|make|do)\s+(?:it to\s+)?(.+)$/i)
  if (m) {
    const who = nameAndDay(`${m[1]} ${m[2] ?? ''}`, today)
    if (!who) return null
    if (/^drop\b/i.test(t.replace(new RegExp(`^${lead}`, 'i'), '')) && !who.day && !who.scope) return null   // "drop the guitar idea": a task
    return { kind: 'cancel', ...who }
  }
  m = t.match(/^no\s+(.+)$/i)
  if (m) {
    const who = nameAndDay(m[1], today)
    if (!who || (!who.day && who.scope !== 'one')) return null   // "no worries", "no football" with no day: unsure
    return { kind: 'cancel', ...who }
  }
  return null
}
