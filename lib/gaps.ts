// What the planner doesn't know yet, or isn't sure of (Build O part 4). Each gap is one question with quick-tap
// answers (and free text), the guess the plans use until he answers, and what his answer changes. The bot asks them
// one at a time, most important first, at most a few a day, never at night or during school (lib/telegram/gapask.ts).
// Every answer becomes an editable setting (or a calendar session, for times of things in his week).
// Pure: no database, no clock.
import { expandEvents, isSchool } from './events'
import { moreSettings, DAYS_OF_WEEK } from './settings'
import { activePlaces, activeSessions, gameFor, GUESS_MINUTES, GUESS_TRAVEL, ignoredSessions, sessionMinutes, DAY3 } from './setup'
import { addDays, dowShort, isoDow, minutesOf, weekStartISO } from './time'
import { guessType, trainingTypes } from './training'
import { typeOf } from './training-data'
import type { EventException, EventRow } from './types'

export type GapOption = { label: string; value: string }
export type Gap = {
  key: string; priority: number
  question: string                 // plain text (escaped when sent)
  why: string                      // what it's for, in a few words
  guess: string                    // what plans use until he answers
  options: GapOption[]
  free: string                     // what a typed answer looks like
  meta?: Record<string, string>    // what the answer needs (a session's exact title)
}

/** Answers he gave that don't change any data (a "yes, that's right"), so the question isn't asked again. */
export const gapsDone = (planning: unknown): Record<string, string> => {
  const v = (planning && typeof planning === 'object' ? (planning as Record<string, unknown>).gapsDone : null)
  return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'string')) as Record<string, string> : {}
}

const has = (planning: unknown, key: string) => !!planning && typeof planning === 'object' && key in (planning as Record<string, unknown>)
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const MINS = (list: number[]) => list.map((n) => ({ label: `${n} min`, value: String(n) }))
const TIMES = (list: string[]) => list.map((t) => ({ label: t, value: t }))

export type GapInput = { planning: unknown; events: EventRow[]; changes: EventException[]; today: string; createdAfter?: string | null }

/** Every gap, most important first. */
export function findGaps(x: GapInput): Gap[] {
  const { planning, today } = x
  const s = moreSettings(planning)
  const done = gapsDone(planning)
  const out: Gap[] = []
  const types = trainingTypes(planning)
  const weekStart = weekStartISO(today)
  const occ = expandEvents(x.events, today, addDays(today, 13), x.changes).filter((o) => !o.cancelled && o.start)
  const ignored = new Set(ignoredSessions(planning).map(norm))

  // 1. this week's game (it anchors the week)
  const game = gameFor(weekStart, planning)
  const weeks = (planning && typeof planning === 'object' ? (planning as Record<string, unknown>).gameWeeks : null) as Record<string, unknown> | null
  const calendarMatch = occ.some((o) => o.date >= weekStart && o.date <= addDays(weekStart, 6) && o.event.training_type === 'match' && !o.event.id.startsWith('game:'))
  if (!calendarMatch && !(weeks && weekStart in weeks) && s.gameDay !== 'none') {
    out.push({
      key: `game:${weekStart}`, priority: 10, why: 'game day is max load: the days around it are protected',
      question: `Your game this week: ${game ? `${dowShort(game.date)} as usual (leave ${game.leave}, back ${game.back})?` : 'which day?'}`,
      guess: game ? `${dowShort(game.date)}, leave ${game.leave}, back ${game.back}` : 'no game',
      options: [{ label: `✓ ${game ? dowShort(game.date) : 'Sun'} as usual`, value: 'usual' }, { label: 'Saturday', value: 'sat' }, { label: 'Sunday', value: 'sun' }, { label: 'No game', value: 'none' }],
      free: 'or type it, e.g. “Sat, leave 9:30, back 15:00”',
    })
  }

  // 2. football training on the days he said (Mon + Wed), if no calendar has it
  const footballDays = s.footballDays.split(',').map((d) => DAYS_OF_WEEK.indexOf(d.trim()) + 1).filter((d) => d > 0)
  const isFootball = (e: EventRow) => typeOf(e as never, types)?.type === 'football' && !ignored.has(norm(e.title))
  const missing = footballDays.filter((dow) => !occ.some((o) => isoDow(o.date) === dow && isFootball(o.event)))
  if (missing.length && !done.football) {
    const names = missing.map((d) => DAY3[d - 1]).join(' and ')
    out.push({
      key: 'football', priority: 20, why: 'it’s fixed load the planner works around', guess: 'not in the plan',
      question: `Football training on ${names}: what time? None of your calendars has it.`,
      options: [...TIMES(['17:30–19:00', '18:00–19:30', '19:00–20:30']), { label: `Not ${names} any more`, value: 'none' }],
      free: 'or type the time, e.g. “18:15–19:45”',
    })
  }

  // 3. calendar sessions that look like training but have no type (school "Games": a match?)
  const asked = new Set<string>()
  for (const o of occ) {
    const e = o.event
    if (e.training_type || asked.has(norm(e.title)) || ignored.has(norm(e.title)) || e.id.startsWith('game:')) continue
    const g = guessType(e.title, types)
    if (!g) continue
    asked.add(norm(e.title))
    const key = `type:${norm(e.title).replace(/ /g, '_').slice(0, 40)}`
    if (done[key]) continue
    out.push({
      key, priority: g.type === 'match' ? 25 : 45, why: 'it decides how much load that day carries',
      question: `What is “${e.title}” (${dowShort(o.date)} ${o.start}${e.external_source === 'google' ? ', from your Google calendar' : ''})?`,
      guess: g.type === 'match' && e.external_source === 'google' ? 'football, moderate' : `${types.find((t) => t.key === g.type)?.label ?? g.type}`,
      options: [{ label: 'A match', value: 'match' }, { label: 'Football training', value: 'football' }, { label: 'Light (PE, a kickabout)', value: 'other' }, { label: 'Not training', value: 'none' }],
      free: 'or type it, e.g. “football, light”', meta: { title: e.title },
    })
  }

  // 4. wake-up and bedtime (the day is built around them)
  if (!has(planning, 'wakeAt')) out.push({ key: 'wake', priority: 30, why: 'your morning routine and the day start from it', guess: s.wakeAt,
    question: 'What time do you wake up on school days?', options: TIMES(['06:30', '06:45', '07:00', '07:15']), free: 'or type a time' })
  if (!has(planning, 'bedAt')) out.push({ key: 'bed', priority: 31, why: 'sleep is protected: nothing planned in your night routine', guess: s.bedAt,
    question: 'Bedtime on school nights?', options: TIMES(['22:00', '22:30', '23:00', '23:30']), free: 'or type a time' })

  // 5. Owen's speed session and where it is
  const sessions = activeSessions(planning)
  const places = activePlaces(planning)
  const owen = places.find((p) => p.key === 'owen')
  const speed = sessions.find((x) => x.key === 'speed')
  if (speed && speed.minutes == null) out.push({ key: 'minutes:speed', priority: 35, why: 'so the session and travel fit', guess: `${GUESS_MINUTES.speed} min`,
    question: 'How long is a speed session with Owen (before the 5–7 min circuits)?', options: MINS([45, 60, 75, 90]), free: 'or type the minutes' })
  if (owen && owen.fromHome == null) out.push({ key: 'travel:owen', priority: 36, why: 'leave-by times and fitting it in', guess: `${GUESS_TRAVEL.other} min each way`,
    question: 'How long does it take to get to Owen’s sessions (each way)?', options: MINS([10, 20, 30, 45]), free: 'or type the minutes' })

  // 6. how long each session type takes
  let p = 40
  for (const st of sessions.filter((x) => x.key !== 'speed' && x.minutes == null)) {
    const m = sessionMinutes(st).minutes
    const choices = st.type === 'mobility' ? [10, 15, 20, 30] : st.type === 'core' ? [10, 15, 20, 30] : st.type === 'injury' ? [15, 20, 30, 45] : [45, 60, 75, 90]
    out.push({ key: `minutes:${st.key}`, priority: p++, why: 'so it fits the right gaps', guess: `${m} min`,
      question: `How long is ${st.name.toLowerCase()} (${st.key === 'stretch' ? 'one unit' : 'the session itself, not travel'})?`, options: MINS(choices), free: 'or type the minutes' })
  }

  // 7. routines, school, study and travel
  if (!has(planning, 'morningMin')) out.push({ key: 'morning', priority: 50, why: 'it’s a fixed block every morning', guess: `${s.morningMin} min`, question: 'How long does your morning routine take (wake to ready)?', options: MINS([15, 20, 30, 45]), free: 'or type the minutes' })
  if (!has(planning, 'nightMin')) out.push({ key: 'night', priority: 51, why: 'it’s a fixed block before bed', guess: `${s.nightMin} min`, question: 'How long does your night routine take (before lights out)?', options: MINS([15, 20, 30, 45]), free: 'or type the minutes' })
  const school = occ.filter((o) => isSchool(o.event) && o.event.is_busy && o.end)
  const ends = [...new Set(school.map((o) => o.end!))]
  if (school.length && !done.school && school.some((o) => o.event.external_source !== 'google')) out.push({ key: 'school', priority: 55, meta: { title: school.find((o) => o.event.external_source !== 'google')!.event.title, start: school[0].start! }, why: 'after-school sessions start from it', guess: ends.length === 1 ? `ends ${ends[0]} every day` : `ends ${ends.join(' / ')}`,
    question: `Your calendar has school ${school[0].start}–${ends.length === 1 ? ends[0] : ends.join(' or ')}${ends.length === 1 ? ' every day' : ''}. Right?`,
    options: [{ label: '✓ Yes', value: 'yes' }], free: 'or type the days that differ, e.g. “Wed ends 15:30”' })
  const home = places.find((x) => x.key === 'home')
  if (home && home.fromSchool == null) out.push({ key: 'travel:school_home', priority: 57, why: 'home sessions after school, and the walk from the school gym', guess: `${GUESS_TRAVEL.schoolHome} min`,
    question: 'How long is the walk home from school?', options: MINS([5, 10, 15, 20]), free: 'or type the minutes' })
  if (!has(planning, 'focusBest')) out.push({ key: 'focus', priority: 60, why: 'hard study goes there', guess: s.focusBest,
    question: 'When do you focus best for study?', options: [{ label: 'After school', value: 'after school' }, { label: 'Evening', value: 'evening' }, { label: 'Morning', value: 'morning' }], free: '' })
  if (!has(planning, 'maxBlockMin')) out.push({ key: 'block', priority: 61, why: 'study blocks never run longer', guess: `${s.maxBlockMin} min`,
    question: 'Longest study block before you need a break?', options: MINS([30, 45, 60, 90]), free: 'or type the minutes' })
  if (!has(planning, 'maxTravelMin')) out.push({ key: 'travelmax', priority: 70, why: 'gyms further than that aren’t used', guess: `${s.maxTravelMin} min`,
    question: 'Longest you’d travel each way to train?', options: MINS([15, 30, 45, 60]), free: 'or type the minutes' })

  // 8. something new in his calendar that repeats and the app knows nothing about (asked once)
  if (x.createdAfter) {
    const titles = new Map<string, { n: number; first: typeof occ[number] }>()
    for (const o of occ) {
      const e = o.event as EventRow & { created_at?: string }
      if (e.external_source !== 'google' || isSchool(e) || ignored.has(norm(e.title)) || !e.created_at || e.created_at < x.createdAfter) continue
      const t = titles.get(norm(e.title)) ?? { n: 0, first: o }
      t.n++; titles.set(norm(e.title), t)
    }
    for (const [n, t] of titles) {
      if (t.n < 2 || done[`new:${n}`]) continue
      out.push({ key: `new:${n.replace(/ /g, '_').slice(0, 40)}`, priority: 15, why: 'so plans include it (or leave it out)', guess: 'planned around',
        question: `New in your calendar: “${t.first.event.title}” (${dowShort(t.first.date)} ${t.first.start}, repeating). Plan around it?`,
        options: [{ label: '✓ Yes, it happens', value: 'keep' }, { label: 'Ignore it', value: 'ignore' }], free: '', meta: { title: t.first.event.title } })
    }
  }
  void minutesOf
  return out.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key))
}

// ---------------------------------------------------------------------------
// Reading a typed answer (no AI): times, minutes, days, yes/no
// ---------------------------------------------------------------------------

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
/** "6:45", "6.45am", "18:30", "7pm" → "HH:MM" (or null). */
export function timeIn(text: string): string | null {
  const m = text.toLowerCase().match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/)
  if (!m || (!m[2] && !m[3])) return null
  let h = Number(m[1]); const min = Number(m[2] ?? '0')
  if (m[3] === 'pm' && h < 12) h += 12
  if (m[3] === 'am' && h === 12) h = 0
  return h < 24 && min < 60 ? hhmm(h, min) : null
}
/** "18:00–19:30", "6-7:30pm", "6:15 to 7:45" → [start, end] (an evening range when no am/pm is given). */
export function rangeIn(text: string): [string, string] | null {
  const m = text.toLowerCase().match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|till|until)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/)
  if (!m) return null
  const pm = m[6] === 'pm' || m[3] === 'pm'
  const conv = (h: number, mer?: string) => (mer === 'am' ? (h === 12 ? 0 : h) : (mer === 'pm' || pm || h < 8) && h < 12 ? h + 12 : h)
  const a = hhmm(conv(Number(m[1]), m[3]), Number(m[2] ?? '0')), b = hhmm(conv(Number(m[4]), m[6]), Number(m[5] ?? '0'))
  return minutesOf(b) > minutesOf(a) ? [a, b] : null
}
/** "45", "45 min", "an hour", "1h15" → minutes (or null). */
export function minutesIn(text: string): number | null {
  const t = text.toLowerCase()
  if (/\b(an|one) hour\b/.test(t)) return 60
  const h = t.match(/\b(\d)\s*h(?:ours?|rs?)?\s*(\d{1,2})?\b/)
  if (h) return Number(h[1]) * 60 + Number(h[2] ?? 0)
  const m = t.match(/\b(\d{1,3})\s*(?:min|mins|minutes|m)?\b/)
  return m ? Number(m[1]) : null
}
/** "sat", "Saturday" → 6 (ISO weekday) or null. */
export const dayIn = (text: string) => { const m = text.toLowerCase().match(/\b(mon|tue|wed|thu|fri|sat|sun)/); return m ? ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].indexOf(m[1]) + 1 : null }
export const yesIn = (text: string) => /^\s*(y|yes|yeah|yep|correct|right|that'?s right|✓)\b/i.test(text)
export const noIn = (text: string) => /^\s*(no|nope|nah|not any more|none|no game)\b/i.test(text)

/** A typed answer turned into one of the gap's values (or a value of its own: "range=18:15-19:45"), or null if it isn't one. */
export function readAnswer(g: Gap, text: string): string | null {
  const t = text.trim()
  if (!t || t.length > 200) return null
  // only a short reply can be an answer; anything longer is something else he's saying ("game moved to Saturday, leave 9")
  const words = t.split(/\s+/).length
  if (words > (g.key.startsWith('game:') || g.key === 'football' || g.key === 'school' ? 8 : 4)) return null
  const opt = g.options.find((o) => o.label.toLowerCase().replace(/^✓ /, '') === t.toLowerCase() || o.value === t.toLowerCase())
  if (opt) return opt.value
  if (g.key.startsWith('game:')) {
    if (noIn(t)) return 'none'
    if (yesIn(t) || /\bas usual\b/i.test(t)) return 'usual'
    const d = dayIn(t)
    if (!d) return null
    const r = rangeIn(t)
    // "leave 9", "back 3": a bare hour is morning for leaving and afternoon for coming back (before 8)
    const clock = (word: string, pm: boolean) => {
      const m = t.match(new RegExp(`${word}\\s+(?:at\\s+)?(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)?`, 'i'))
      if (!m) return null
      let h = Number(m[1]); const min = Number(m[2] ?? '0')
      if (m[3]?.toLowerCase() === 'pm' && h < 12) h += 12
      else if (!m[3] && pm && h < 8) h += 12
      return h < 24 && min < 60 ? hhmm(h, min) : null
    }
    const leave = r?.[0] ?? clock('leave', false)
    const back = r?.[1] ?? clock('back', true)
    return `day=${d}${leave ? `;leave=${leave}` : ''}${back ? `;back=${back}` : ''}`
  }
  if (g.key === 'football') {
    if (noIn(t)) return 'none'
    if (!/^\d/.test(t)) return null
    const r = rangeIn(t)
    return r ? `${r[0]}–${r[1]}` : null
  }
  if (g.key.startsWith('type:')) {
    const w = t.toLowerCase()
    if (!/^(?:it'?s |a |an |just )*(?:match|game|fixture|football(?: training)?|training|pe|a kickabout|kickabout|light|not training|none|no)(?:[, ]+(?:light|moderate|heavy|hard))?$/.test(w)) return null
    const level = /\blight\b/.test(w) ? ' light' : /\bmoderate\b/.test(w) ? ' moderate' : ''
    if (/not training|^no\b|isn'?t training/.test(w)) return 'none'
    if (/match|game|fixture/.test(w)) return `match${level}`
    if (/football|training/.test(w)) return `football${level}`
    if (/\bpe\b|light|kickabout/.test(w)) return 'other'
    return null
  }
  if (g.key === 'wake' || g.key === 'bed') return /^(?:at |about |around |~)?\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?$/i.test(t) ? timeIn(/[:.]|am|pm/i.test(t) ? t : `${t}:00`) : null
  if (g.key === 'school') { if (yesIn(t)) return 'yes'; const d = dayIn(t), e = timeIn(t); return d && e ? `day=${d};end=${e}` : null }
  if (g.key.startsWith('new:')) return yesIn(t) ? 'keep' : /ignore|no\b|isn'?t|doesn'?t/i.test(t) ? 'ignore' : null
  if (g.key === 'focus') return /evening|night/i.test(t) ? 'evening' : /morning/i.test(t) ? 'morning' : /after school|afternoon/i.test(t) ? 'after school' : null
  // a number of minutes, and nothing else ("45", "45 min", "about an hour", "1h15")
  if (!/^(?:about |around |~)?(?:\d{1,3}\s*(?:min|mins|minutes|m)?|an hour|one hour|\dh(?:\s*\d{1,2})?|\d hours?)$/i.test(t)) return null
  const n = minutesIn(t)
  return n != null && n >= 5 && n <= 240 ? String(n) : null
}
