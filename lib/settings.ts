// Nat's settings, changed on the Settings page or by chat ("nothing planned after 22:00", "brief at 7:30"). They
// live in profiles.planning; each is checked here, and anything missing or odd is its default.
// Pure: no database.
import { planningSettings } from './freetime'
import { travelSettings } from './travel'
import { EXTRA_SETTINGS } from './settings-extra'

type Kind = 'time' | 'minutes' | 'number' | 'choice' | 'text' | 'list'
export type Group = 'you' | 'day' | 'week' | 'planning' | 'messages' | 'training' | 'load' | 'mental' | 'optimiser' | 'study' | 'tests' | 'travel' | 'act' | 'gym'
export type Spec = { label: string; kind: Kind; group: Group; min?: number; max?: number; choices?: string[]; help?: string }

export const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

const CORE_SETTINGS: Record<string, Spec> = {
  about: { label: 'About you (the AI reads this)', kind: 'text', group: 'you', max: 600, help: 'Who you are, in a sentence or two: school year, subjects, sport.' },
  // your day (Build O): every day is built around the morning and night routines; wake and bed are protected
  wakeAt: { label: 'Wake up on school days', kind: 'time', group: 'day' },
  weekendWakeAt: { label: 'Wake up on other days', kind: 'time', group: 'day' },
  bedAt: { label: 'Bedtime', kind: 'time', group: 'day' },
  morningMin: { label: 'Morning routine takes', kind: 'minutes', group: 'day', min: 5, max: 180 },
  nightMin: { label: 'Night routine takes', kind: 'minutes', group: 'day', min: 5, max: 180 },
  earlierNightMin: { label: 'Bed this much earlier before a test or a game', kind: 'minutes', group: 'day', max: 120 },
  // the week's rhythm
  fridayFreeFrom: { label: 'Friday evening kept free from', kind: 'time', group: 'week' },
  fridayLight: { label: 'Only light training earlier on Fridays', kind: 'choice', group: 'week', choices: ['yes', 'no'] },
  footballDays: { label: 'Football training days (the calendar has the times)', kind: 'list', group: 'week', max: 80, help: 'Days, separated by commas (“monday, wednesday”), or “none”.' },
  gameDay: { label: 'Usual game day', kind: 'choice', group: 'week', choices: [...DAYS_OF_WEEK, 'none'] },
  gameLeave: { label: 'Game day: leave at', kind: 'time', group: 'week' },
  gameBack: { label: 'Game day: back at', kind: 'time', group: 'week' },
  resetAt: { label: 'Sunday week reset (your “Your week” card comes then)', kind: 'time', group: 'week' },
  resetMin: { label: 'Sunday week reset takes', kind: 'minutes', group: 'week', min: 10, max: 120 },
  endOfDayAt: { label: 'Evening message', kind: 'time', group: 'week', help: 'Tick what you did; the rest moves to tomorrow by itself.' },
  quietFrom: { label: 'No new messages after this (until the morning brief)', kind: 'time', group: 'week' },
  dayStart: { label: 'Free time starts', kind: 'time', group: 'planning' },
  dayEnd: { label: 'Nothing planned after', kind: 'time', group: 'planning' },
  heavyUntil: { label: 'Nothing heavy after', kind: 'time', group: 'planning' },
  bufferMin: { label: 'Buffer around every event', kind: 'minutes', group: 'planning', max: 60 },
  leaveSchoolAt: { label: 'I leave school at (empty = when school ends)', kind: 'time', group: 'planning' },
  schoolFreePeriods: { label: 'My free periods every week (empty = from the school calendar)', kind: 'list', group: 'planning', max: 300, help: 'Day and time, separated by commas (“mon 11:40-12:50, tue 09:10-10:15”).' },
  schoolNightFocusMin: { label: 'Focused work on a school night', kind: 'minutes', group: 'planning', max: 600 },
  hardSubjects: { label: 'Hard thinking (done while fresh)', kind: 'list', group: 'planning', max: 200, help: 'Subjects, separated by commas.' },
  todayMax: { label: 'Most tasks on the To do card', kind: 'number', group: 'planning', min: 3, max: 12 },
  pushBackAfter: { label: 'Push back on a task put off this many times', kind: 'number', group: 'planning', min: 2, max: 10 },
  briefAt: { label: 'Morning message', kind: 'time', group: 'messages', help: 'Your Today: at most 5 things, each with what to open. On holidays not before your holiday wake time.' },
  nudgeAt: { label: '“Don’t forget” nudge', kind: 'time', group: 'messages' },
  checkinDay: { label: 'Weekly check-in day', kind: 'choice', group: 'messages', choices: DAYS_OF_WEEK },
  leaveAlertMin: { label: '“Leave in …” alert this long before', kind: 'minutes', group: 'messages', min: 0, max: 60 },
  gapsPerDay: { label: 'Questions to fill gaps in what I know: at most a day', kind: 'number', group: 'messages', min: 0, max: 10 },
  trainingFrom: { label: 'Gym sessions go from this time (earlier only if nothing later fits)', kind: 'time', group: 'training' },
  noTrainingDays: { label: 'No extra training on (only what’s in your calendar)', kind: 'list', group: 'training', max: 80, help: 'Days, separated by commas (“wednesday”), or “none”.' },
  lowRecovery: { label: 'Whoop recovery below this % = a lighter day', kind: 'number', group: 'training', min: 0, max: 100 },
  // training load (lib/load.ts): a session's cost = legs + upper + CNS, 0–10 each at heavy
  lightPct: { label: 'A light session costs this % of a heavy one', kind: 'number', group: 'load', min: 5, max: 100 },
  moderatePct: { label: 'A moderate session costs this % of a heavy one', kind: 'number', group: 'load', min: 5, max: 100 },
  dayMedLoad: { label: 'Day load: medium from', kind: 'number', group: 'load', min: 1, max: 90 },
  dayHighLoad: { label: 'Day load: high from', kind: 'number', group: 'load', min: 1, max: 90 },
  dayMaxLoad: { label: 'Most load in a day', kind: 'number', group: 'load', min: 5, max: 120 },
  weekMaxLoad: { label: 'Most load in any 7 days', kind: 'number', group: 'load', min: 10, max: 500 },
  cnsHigh: { label: 'A high-CNS day has this much CNS load (not two in a row)', kind: 'number', group: 'load', min: 1, max: 30 },
  cnsBaseline: { label: 'Days that are high-CNS every week (fixed: no warning)', kind: 'list', group: 'load', max: 80, help: 'Days, separated by commas (“tuesday, wednesday”), or “none”.' },
  areaHeavy: { label: 'A body area is “worked” at this much load (legs or upper)', kind: 'number', group: 'load', min: 1, max: 10 },
  legsRecoveryH: { label: 'Legs recovery between worked sessions (hours)', kind: 'number', group: 'load', min: 0, max: 120 },
  upperRecoveryH: { label: 'Upper body recovery between worked sessions (hours)', kind: 'number', group: 'load', min: 0, max: 120 },
  gameDaysBefore: { label: 'Protect this many days before a game', kind: 'number', group: 'load', min: 0, max: 3 },
  gameDaysAfter: { label: 'Protect this many days after a game', kind: 'number', group: 'load', min: 0, max: 3 },
  gameEveMax: { label: 'Most legs + CNS load in a session on a protected day', kind: 'number', group: 'load', min: 0, max: 20 },
  highStrain: { label: 'Whoop strain above this = go easier the next day', kind: 'number', group: 'load', min: 1, max: 21 },
  // mental load (lib/mental.ts): each day's 🧠 load, 0–10 per thing
  mentalSchool: { label: 'A school day', kind: 'number', group: 'mental', min: 0, max: 10 },
  mentalTutor: { label: 'A tutor session', kind: 'number', group: 'mental', min: 0, max: 10 },
  mentalStudyHour: { label: 'An hour of focused study', kind: 'number', group: 'mental', min: 0, max: 10 },
  mentalTest: { label: 'A test or mock', kind: 'number', group: 'mental', min: 0, max: 10 },
  mentalTestEve: { label: 'The day before a test (added)', kind: 'number', group: 'mental', min: 0, max: 10 },
  mentalDeadline: { label: 'A must-do due the next day (added, each)', kind: 'number', group: 'mental', min: 0, max: 10 },
  mentalMed: { label: '🧠 medium from', kind: 'number', group: 'mental', min: 1, max: 40 },
  mentalHigh: { label: '🧠 high from (no hard training on a high day)', kind: 'number', group: 'mental', min: 1, max: 40 },
  // optimiser weights (lib/optimiser.ts): what each thing costs when the week is scored; bigger = avoided more
  wTravel: { label: '10 minutes of travel', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wMental: { label: 'Hard training on a high-🧠 day or a test eve', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wFriday: { label: 'Training that isn’t light on a Friday', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wWeekendUpper: { label: 'One upper at the weekend (a bonus)', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wAfterSchool: { label: 'PureGym straight after school (a bonus)', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wUpperThird: { label: 'What a 3rd upper session is worth', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wPoorFit: { label: 'A place without the kit a session wants (each item)', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wLighter: { label: 'Going one step lighter than planned', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wGame: { label: 'Legs/CNS work next to a game', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wArea: { label: 'A body area not recovered', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wCnsRow: { label: 'High-CNS days back to back', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wTired: { label: 'Hard training on a tired or low-Whoop day', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wLeaveOut: { label: 'Leaving a session out of the week', kind: 'number', group: 'optimiser', min: 0, max: 200 },
  wAvoid: { label: 'Going against one of your training rules', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wPrefer: { label: 'Going against a “where possible” rule', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  wSameDay: { label: 'Two worked sessions on one day', kind: 'number', group: 'optimiser', min: 0, max: 100 },
  studyPerSubject: { label: 'Next study actions shown per subject', kind: 'number', group: 'study', min: 1, max: 5 },
  mistakeReviewDays: { label: 'A logged mistake comes back for review after (days)', kind: 'number', group: 'study', min: 1, max: 30 },
  focusBest: { label: 'Best time for focused study', kind: 'choice', group: 'study', choices: ['after school', 'evening', 'morning'] },
  maxBlockMin: { label: 'Longest study block', kind: 'minutes', group: 'study', min: 20, max: 180 },
  // maths + further maths (lib/maths.ts)
  mathsSubjects: { label: 'Maths courses (the tracker and maths blocks)', kind: 'list', group: 'study', max: 120, help: 'Subjects, separated by commas, in order.' },
  mathsTestDays: { label: 'A maths test this close switches to 🔥 test mode (days)', kind: 'number', group: 'study', min: 1, max: 21 },
  mathsBlocksPerWeek: { label: 'Maths blocks a week (🚀 / 🔥 / 📝)', kind: 'number', group: 'study', min: 0, max: 14 },
  mathsBlockMin: { label: 'A maths block takes', kind: 'minutes', group: 'study', min: 20, max: 180 },
  mathsResources: { label: 'Maths resources (in order)', kind: 'text', group: 'study', max: 300 },
  prepMinutes: { label: 'Test prep session (normal priority; high +5, low −10)', kind: 'minutes', group: 'tests', min: 15, max: 120 },
  uberPickupMin: { label: 'Uber wait (when you don’t give one)', kind: 'minutes', group: 'travel', max: 60 },
  transitSlackMin: { label: 'Tube/bus wins if it’s no more than this slower than an Uber', kind: 'minutes', group: 'travel', max: 60 },
  travelEnd: { label: 'Leave-by uses this end of a journey’s range', kind: 'choice', group: 'travel', choices: ['slow', 'middle', 'fast'] },
  maxTravelMin: { label: 'Longest trip each way to a training session', kind: 'minutes', group: 'travel', max: 120 },
}

/** Every setting: the core ones, then the queue items' (lib/settings-extra.ts). */
export const SETTINGS: Record<string, Spec> = {
  ...CORE_SETTINGS,
  ...Object.fromEntries(Object.entries(EXTRA_SETTINGS).filter(([k]) => !(k in CORE_SETTINGS)).map(([k, x]) => { const { default: _d, ...spec } = x; return [k, spec] })),
}

export type MoreSettings = {
  about: string; hardSubjects: string; todayMax: number; pushBackAfter: number
  briefAt: string; nudgeAt: string; checkinDay: string; leaveAlertMin: number; trainingFrom: string; prepMinutes: number
  lowRecovery: number; studyPerSubject: number; mistakeReviewDays: number
  lightPct: number; moderatePct: number; dayMedLoad: number; dayHighLoad: number; dayMaxLoad: number; weekMaxLoad: number; cnsHigh: number; cnsBaseline: string; noTrainingDays: string
  areaHeavy: number; legsRecoveryH: number; upperRecoveryH: number; gameDaysBefore: number; gameDaysAfter: number; gameEveMax: number; highStrain: number
  wakeAt: string; weekendWakeAt: string; bedAt: string; morningMin: number; nightMin: number; earlierNightMin: number
  fridayFreeFrom: string; fridayLight: string; footballDays: string; gameDay: string; gameLeave: string; gameBack: string; resetAt: string; resetMin: number; endOfDayAt: string; quietFrom: string
  gapsPerDay: number; focusBest: string; maxBlockMin: number; maxTravelMin: number
  mathsSubjects: string; mathsTestDays: number; mathsBlocksPerWeek: number; mathsBlockMin: number; mathsResources: string
  mentalSchool: number; mentalTutor: number; mentalStudyHour: number; mentalTest: number; mentalTestEve: number; mentalDeadline: number; mentalMed: number; mentalHigh: number
  wTravel: number; wMental: number; wFriday: number; wWeekendUpper: number; wAfterSchool: number; wUpperThird: number; wPoorFit: number
  wLighter: number; wGame: number; wArea: number; wCnsRow: number; wTired: number; wLeaveOut: number; wAvoid: number; wPrefer: number; wSameDay: number
}
/** Defaults (my-spec 40, 41 and 44); his own values replace them. */
export const DEFAULT_MORE: MoreSettings = {
  about: 'UK sixth-form student: A-levels in Maths, Further Maths and Physics; Computer Science with a tutor; football and gym.',
  hardSubjects: 'Further Maths, Maths, Physics',
  todayMax: 6, pushBackAfter: 3,
  briefAt: '07:30', nudgeAt: '18:00', checkinDay: 'sunday', leaveAlertMin: 10,
  trainingFrom: '15:00', prepMinutes: 40,
  lowRecovery: 34,   // Whoop's red zone is 0–33%
  studyPerSubject: 2, mistakeReviewDays: 3,
  // training load: heavy upper ≈ 15, heavy lower ≈ 16, a match ≈ 21 (lib/load.ts DEFAULT_COSTS)
  lightPct: 35, moderatePct: 65, dayMedLoad: 10, dayHighLoad: 20, dayMaxLoad: 30, weekMaxLoad: 140, cnsHigh: 8, cnsBaseline: 'none', noTrainingDays: 'none',
  areaHeavy: 6, legsRecoveryH: 48, upperRecoveryH: 48, gameDaysBefore: 1, gameDaysAfter: 1, gameEveMax: 7, highStrain: 14,
  // your day and week (his brief, 11 Oct); wake, bed and routine lengths are guesses until he answers (lib/gaps.ts)
  wakeAt: '06:45', weekendWakeAt: '08:00', bedAt: '22:30', morningMin: 30, nightMin: 30, earlierNightMin: 30,
  fridayFreeFrom: '18:00', fridayLight: 'yes', footballDays: 'monday, wednesday', gameDay: 'sunday', gameLeave: '08:30', gameBack: '16:00', resetAt: '18:00', resetMin: 30, endOfDayAt: '21:00', quietFrom: '21:30',
  gapsPerDay: 5, focusBest: 'after school', maxBlockMin: 60, maxTravelMin: 45,
  mathsSubjects: 'Maths, Further Maths', mathsTestDays: 7, mathsBlocksPerWeek: 5, mathsBlockMin: 60,
  mathsResources: 'Textbook: OCR/Cambridge first; only if stuck: Bicen, AMSP, TL Maths. Questions: Integral/UCS → PMT → Madas/Naiker (optional).',
  mentalSchool: 4, mentalTutor: 3, mentalStudyHour: 2, mentalTest: 8, mentalTestEve: 3, mentalDeadline: 1, mentalMed: 6, mentalHigh: 10,
  wTravel: 2, wMental: 12, wFriday: 15, wWeekendUpper: 3, wAfterSchool: 2, wUpperThird: 8, wPoorFit: 4,
  wLighter: 5, wGame: 15, wArea: 10, wCnsRow: 12, wTired: 20, wLeaveOut: 40, wAvoid: 15, wPrefer: 4, wSameDay: 3,
}

/** The defaults with the queue items' settings added (lib/settings-extra.ts). */
const ALL_DEFAULTS: Record<string, string | number> = {
  ...Object.fromEntries(Object.entries(EXTRA_SETTINGS).filter(([k]) => !(k in CORE_SETTINGS)).map(([k, x]) => [k, x.default])),
  ...(DEFAULT_MORE as unknown as Record<string, string | number>),
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const obj = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

/** The settings beyond free time and travel, each checked (odd or missing = the default). */
export function moreSettings(raw: unknown): MoreSettings & Record<string, string | number> {
  const o = obj(raw)
  const out = { ...ALL_DEFAULTS }
  for (const k of Object.keys(ALL_DEFAULTS)) {
    const s = SETTINGS[k], v = o[k]
    if (v === undefined || v === null) continue
    if (s.kind === 'time' && typeof v === 'string' && HHMM.test(v)) out[k] = v
    else if ((s.kind === 'minutes' || s.kind === 'number') && Number.isInteger(v) && (v as number) >= (s.min ?? 0) && (v as number) <= (s.max ?? 1e6)) out[k] = v as number
    else if (s.kind === 'choice' && typeof v === 'string' && s.choices!.includes(v)) out[k] = v
    else if ((s.kind === 'text' || s.kind === 'list') && typeof v === 'string' && v.trim() && v.length <= (s.max ?? 500)) out[k] = v.trim()
  }
  return out as unknown as MoreSettings & Record<string, string | number>
}

/** One setting's value now (his, else the default), for the queue items' own settings. */
export const setting = <T extends string | number>(planning: unknown, key: string): T => moreSettings(planning)[key] as T

/** Every setting as it is now (his value, else the default). */
export const currentSettings = (planning: unknown): Record<string, string | number> => {
  const { dayBounds: _bounds, ...free } = planningSettings(planning)
  return { ...moreSettings(planning), ...free, leaveSchoolAt: free.leaveSchoolAt ?? '', schoolFreePeriods: free.schoolFreePeriods ?? '', ...travelSettings(planning) }
}

export const showSetting = (key: string, v: string | number) => {
  const k = SETTINGS[key]?.kind
  if (k === 'minutes') return `${v} min`
  if (key === 'checkinDay' || key === 'gameDay') return String(v).charAt(0).toUpperCase() + String(v).slice(1)
  return String(v)
}

/** ISO weekday (1 = Mon … 7 = Sun) of the weekly check-in. */
export const checkinDow = (planning: unknown) => DAYS_OF_WEEK.indexOf(moreSettings(planning).checkinDay) + 1

/** A days setting ("tuesday, wednesday" / "none") as ISO weekdays (1 = Mon … 7 = Sun). */
export const daysOf = (v: string | undefined) => (v ?? '').toLowerCase().split(/\s*,\s*/).map((d) => DAYS_OF_WEEK.findIndex((x) => d.length >= 3 && x.startsWith(d.slice(0, 3))) + 1).filter((d) => d > 0)

/** Hard-thinking subjects as a list. */
export const hardSubjects = (planning: unknown) => moreSettings(planning).hardSubjects.split(',').map((s) => s.trim()).filter(Boolean)

/** A new value for one setting, checked; null if it isn't a valid value (or doesn't work with the others). */
export function parseSetting(key: string, raw: string, planning: unknown): string | number | null {
  const s = SETTINGS[key]
  if (!s) return null
  const text = (raw ?? '').trim()
  const v = text.toLowerCase()
  let value: string | number | null = null
  if (s.kind === 'time') {
    const m = v.match(/^(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?$/)
    if (m) {
      let h = Number(m[1])
      const min = Number(m[2] ?? '0')
      if (m[3] === 'pm' && h < 12) h += 12
      if (m[3] === 'am' && h === 12) h = 0
      value = (m[2] !== undefined || m[3]) && h < 24 && min < 60 ? `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null
    }
  } else if (s.kind === 'minutes' || s.kind === 'number') {
    const n = Number(v.replace(/\s*(min\w*|times?|x|×)$/, ''))
    value = Number.isInteger(n) && n >= (s.min ?? 0) && n <= s.max! ? n : null
  } else if (s.kind === 'choice') {
    value = s.choices!.find((c) => c === v || ((key === 'checkinDay' || key === 'gameDay') && c.startsWith(v.slice(0, 3)) && v.length >= 3)) ?? null
  } else if (s.kind === 'list') {
    const items = text.split(/\s*,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean)
    value = items.length && items.join(', ').length <= s.max! ? items.join(', ') : null
  } else {
    value = text && text.length <= s.max! ? text.replace(/\s+/g, ' ') : null
  }
  if (value === null) return null
  // e.g. "nothing after 06:00" when the day starts at 07:00 would be thrown away: refuse it instead
  const merged = { ...obj(planning), [key]: value }
  return currentSettings(merged)[key] === value ? value : null
}

/** For the AI: each setting's key, what it means and its value now ("about" has its own section). */
export const settingsForAI = (planning: unknown) =>
  Object.entries(currentSettings(planning)).filter(([k]) => k !== 'about')
    .map(([k, v]) => `${k} = ${v}${SETTINGS[k]?.kind === 'minutes' ? ' (minutes)' : ''} · ${SETTINGS[k]?.label ?? ''}`)
