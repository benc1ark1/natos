// Reading a lift he typed (queue item 6), with no AI: "bench 80x5x3" (80 kg × 5 reps × 3 sets), "squat 100 5x5"
// (100 kg, 5 sets of 5), "bench 80x8" (one set), "deadlift 140kg 3x5", "OHP 50 x 6,6,5" (a set each), "pull ups bw+10 3x8",
// "dips bodyweight 3x12", lbs ("bench 135x5x3 lbs" → kg), "3 sets of 5 at 80kg", "80 for 5", RPE ("@8"), and the day
// ("yesterday", "on Monday", "2 days ago"; today otherwise). Strict on purpose: anything it isn't sure about is left
// to the brain. Pure: no database.
import { addDays, isoDow } from '../time'
import { DEFAULT_EXERCISES, findExercise, keyOf, normWords } from './catalogue'
import type { Exercise } from './types'

export const LB = 0.45359237
export type ParsedLift = {
  words: string                 // the exercise as he wrote it
  exercise: Exercise | null     // the catalogue's (null = his own exercise, not in the list)
  key: string                   // exercise_key
  weightKg: number              // for bodyweight moves: what he added (0 = just bodyweight)
  bodyweight: boolean           // a bodyweight move (or he said "bw")
  unit: 'kg' | 'lbs'; given: number   // the weight as he gave it
  unitSaid: boolean             // he said kg or lbs (otherwise his setting decides, on the card)
  reps: number[]                // one per set: [5, 5, 5] or [6, 6, 5]
  rpe: number | null
  date: string; dateWords: string     // the day it was done ('' = today, not said)
}
export type ParseResult =
  | { kind: 'lift'; lifts: ParsedLift[] }
  | { kind: 'vague'; exercises: Exercise[]; weight: number | null }   // "did bench": which weight and reps?

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
/** Words that are never an exercise (other parts of the bot own these messages). */
const NOT_LIFTS = new Set(['act', 'maths', 'math', 'physics', 'test', 'tests', 'practice', 'homework', 'upper', 'lower', 'football', 'game', 'games', 'match', 'session', 'study',
  'bicen', 'integral', 'step', 'paper', 'mock', 'set', 'sets', 'chapter', 'exercise', 'textbook', 'mistake', 'redo', 'review', 'speed', 'core', 'stretch', 'stretching', 'gym', 'run', 'running',
  'sprint', 'sprints', 'tutor', 'english', 'reading', 'science', 'smc', 'q', 'question', 'questions', 'owen', 'training', 'plan', 'week', 'today', 'tomorrow', 'remind', 'reminder'])

const NUM = String.raw`(\d{1,3}(?:\.\d{1,2})?)`
const UNIT = String.raw`(kg|kgs|kilos?|lbs?|pounds?)`
const unitOf = (u: string | undefined) => (u && /^(lb|lbs|pound|pounds)$/.test(u) ? 'lbs' : u ? 'kg' : null)
const toKg = (n: number, unit: 'kg' | 'lbs') => (unit === 'lbs' ? Math.round(n * LB * 100) / 100 : n)

/** The day words in a message ("yesterday", "on monday", "2 days ago"), taken out; today otherwise. */
export function dayOf(text: string, today: string): { rest: string; date: string; words: string } | null {
  let date = today, words = ''
  const take = (re: RegExp, f: (m: RegExpMatchArray) => string | null) => {
    const m = text.match(re)
    if (!m || words) return
    const d = f(m)
    if (!d) return
    date = d; words = m[0].trim(); text = `${text.slice(0, m.index)} ${text.slice(m.index! + m[0].length)}`
  }
  take(/\b(?:yesterday|yday|last night)\b/, () => addDays(today, -1))
  take(/\b(?:today|this morning|this afternoon|this evening|tonight)\b/, () => today)
  take(/\b(\d) days? ago\b/, (m) => addDays(today, -Number(m[1])))
  take(/\b(?:on |last )?(monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b/, (m) => {
    const dow = DAYS.indexOf(m[1].slice(0, 3)) + 1
    let d = today
    while (isoDow(d) !== dow) d = addDays(d, -1)
    return /^last /.test(m[0]) && d === today ? addDays(d, -7) : d
  })
  return { rest: text.replace(/\s+/g, ' ').trim(), date, words }
}

type Numbers = { w: number | null; unit: 'kg' | 'lbs' | null; bw: boolean; reps: number[]; rpe: number | null; form?: 'wr' }

/** The numbers after the exercise's name (null = not a lift): every set 1–100 reps, at most 20 sets. */
function numbersOf(rest: string, bodyweightMove: boolean): Numbers | null {
  const n = readNumbers(rest, bodyweightMove)
  return n && n.reps.length >= 1 && n.reps.length <= 20 && n.reps.every((r) => Number.isInteger(r) && r >= 1 && r <= 100) ? n : null
}

function readNumbers(rest: string, bodyweightMove: boolean): Numbers | null {
  let s = rest.replace(/\s*(x)\s*/g, 'x').replace(/\s*,\s*/g, ',').replace(/\s*\/\s*/g, '/').replace(/\s*\+\s*/g, '+').replace(/\s+/g, ' ').trim()
  let rpe: number | null = null
  const r = s.match(/\s*(?:@\s?|rpe\s?)(\d{1,2}(?:\.5)?)$/)
  if (r && !/(kg|lb)/.test(s.slice(r.index!)) && Number(r[1]) >= 1 && Number(r[1]) <= 10) { rpe = Number(r[1]); s = s.slice(0, r.index).trim() }
  let unitAll: 'kg' | 'lbs' | null = null
  const u = s.match(new RegExp(String.raw`\s${UNIT}$`))
  if (u) { unitAll = unitOf(u[1]); s = s.slice(0, u.index).trim() }
  const rep = (n: string) => Number(n)
  const list = (x: string) => x.split(',').map(rep)
  const times = (reps: number, sets: number) => Array.from({ length: sets }, () => reps)
  const BW = String.raw`(?:bodyweight only|bodyweight|body weight|bw)(?:\+${NUM}\s?${UNIT}?)?`
  const WEIGHT = String.raw`(?:${NUM}\s?${UNIT}?|\+${NUM}\s?${UNIT}?)`
  let m: RegExpMatchArray | null
  const weight = (a: string | undefined, b: string | undefined, c: string | undefined, d: string | undefined) => ({ w: Number(a ?? c), unit: unitOf(b ?? d) ?? unitAll })
  // bodyweight: "bw+10 3x8", "bodyweight 3x12", "bw x 8 x 3", "bw 10,8,8"
  if ((m = s.match(new RegExp(`^${BW} (\\d{1,2})x(\\d{1,3})$`)))) return { w: m[1] ? Number(m[1]) : 0, unit: unitOf(m[2]) ?? unitAll, bw: true, reps: times(rep(m[4]), rep(m[3])), rpe }
  if ((m = s.match(new RegExp(`^${BW}x(\\d{1,3})x(\\d{1,2})$`)))) return { w: m[1] ? Number(m[1]) : 0, unit: unitOf(m[2]) ?? unitAll, bw: true, reps: times(rep(m[3]), rep(m[4])), rpe }
  if ((m = s.match(new RegExp(`^${BW}x(\\d{1,3})$`)))) return { w: m[1] ? Number(m[1]) : 0, unit: unitOf(m[2]) ?? unitAll, bw: true, reps: [rep(m[3])], rpe }
  if ((m = s.match(new RegExp(`^${BW} x?(\\d{1,3}(?:,\\d{1,3})+)$`)))) return { w: m[1] ? Number(m[1]) : 0, unit: unitOf(m[2]) ?? unitAll, bw: true, reps: list(m[3]), rpe }
  // a bodyweight move: "3x8" is sets × reps (a weight needs kg/lbs or "bw+": "pull ups 10kg 3x8", "bw+10 3x8")
  if (bodyweightMove && (m = s.match(/^(\d{1,2})x(\d{1,3})$/))) return { w: 0, unit: unitAll, bw: true, reps: times(rep(m[2]), rep(m[1])), rpe }
  // weight × reps × sets: "80x5x3", "80kg x 5 x 3"
  if ((m = s.match(new RegExp(`^${WEIGHT}x(\\d{1,3})x(\\d{1,2})$`)))) return { ...weight(m[1], m[2], m[3], m[4]), bw: false, reps: times(rep(m[5]), rep(m[6])), rpe }
  // weight × reps (one set): "80x8"
  if ((m = s.match(new RegExp(`^${WEIGHT}x(\\d{1,3})$`)))) return { ...weight(m[1], m[2], m[3], m[4]), bw: false, reps: [rep(m[5])], rpe, form: 'wr' }
  // weight, then sets × reps: "100 5x5", "140kg 3x5"
  if ((m = s.match(new RegExp(`^${WEIGHT} (\\d{1,2})x(\\d{1,3})$`)))) return { ...weight(m[1], m[2], m[3], m[4]), bw: false, reps: times(rep(m[6]), rep(m[5])), rpe }
  // weight, then each set's reps: "50 x 6,6,5", "50 6,6,5"
  if ((m = s.match(new RegExp(`^${WEIGHT}(?: x?|x)(\\d{1,3}(?:,\\d{1,3})+)$`)))) return { ...weight(m[1], m[2], m[3], m[4]), bw: false, reps: list(m[5]), rpe }
  // in words: "80 for 5", "80kg for 5 reps", "80 for 3 sets of 5", "80kg 3 sets of 5"
  if ((m = s.match(new RegExp(`^${WEIGHT} for (\\d{1,3})(?: reps?)?$`)))) return { ...weight(m[1], m[2], m[3], m[4]), bw: false, reps: [rep(m[5])], rpe }
  if ((m = s.match(new RegExp(`^${WEIGHT} (?:for )?(\\d{1,2}) sets? of (\\d{1,3})(?: reps?)?$`)))) return { ...weight(m[1], m[2], m[3], m[4]), bw: false, reps: times(rep(m[6]), rep(m[5])), rpe }
  // sets × reps at a weight: "3x5 @ 80kg", "3 sets of 5 at 80kg", "5x5 at 100"
  if ((m = s.match(new RegExp(`^(\\d{1,2})(?:x| sets? of )(\\d{1,3})(?: reps?)? (?:@|at|with) ?${NUM} ?${UNIT}?$`)))) return { w: Number(m[3]), unit: unitOf(m[4]) ?? unitAll, bw: false, reps: times(rep(m[2]), rep(m[1])), rpe }
  // a bodyweight move with no weight: "dips 3x12", "pull ups 10,8,8", "chin ups 12"
  if (bodyweightMove) {
    if ((m = s.match(/^(\d{1,2})x(\d{1,3})$/))) return { w: 0, unit: unitAll, bw: true, reps: times(rep(m[2]), rep(m[1])), rpe }
    if ((m = s.match(/^(\d{1,3}(?:,\d{1,3})+)$/))) return { w: 0, unit: unitAll, bw: true, reps: list(m[1]), rpe }
    if ((m = s.match(/^(\d{1,3})(?: reps?)?$/))) return { w: 0, unit: unitAll, bw: true, reps: [rep(m[1])], rpe }
  }
  return null
}

/** Where the exercise's name ends and the numbers start ("pull ups bw+10 3x8" → "pull ups"). */
function splitName(s: string): { name: string; rest: string } | null {
  const i = s.search(/\s(?:\d|\+\d|bw\b|bodyweight\b|body weight\b)|^\d/)
  if (i <= 0) return null
  return { name: s.slice(0, i).replace(/\s*[:\-–]\s*$/, '').replace(/\s+(?:at|for|with|@)$/, '').trim(), rest: s.slice(i).trim() }
}

const nameOk = (name: string) => /^[a-z][a-z' -]{1,40}$/.test(name) && name.split(' ').length <= 5 && !name.split(' ').some((w) => NOT_LIFTS.has(w))

/**
 * One message → the lift(s) in it (one per line, or "bench 80x5x3 and squat 100 5x5"), "vague" for an exercise
 * with no numbers ("did bench"), or null when it isn't clearly a lift (the brain reads it).
 */
export function parseLifts(message: string, today: string, opts: { list?: Exercise[]; unit?: 'kg' | 'lbs' } = {}): ParseResult | null {
  const list = opts.list ?? DEFAULT_EXERCISES
  const text = message.toLowerCase().replace(/[×*]/g, 'x').replace(/[–—]/g, '-').replace(/[’]/g, "'").replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/[.!]+$/, '').trim()
  if (!text || text.length > 300 || /\?$/.test(text)) return null
  const parts = text.split(/\s*(?:\n|;|\band then\b|\band\b)\s*/).map((p) => p.replace(/[.!]+$/, '').trim()).filter(Boolean)
  // "did bench", "done squats and bench", "benched today": an exercise with no numbers
  const VERB = /^(?:i\s+)?(?:just\s+)?(?:did|done|finished|hit|smashed|trained)\s+(?:some\s+|my\s+|the\s+)?/
  const PAST: Record<string, string> = { benched: 'bench', squatted: 'squat', deadlifted: 'deadlift', curled: 'curl', rowed: 'row', pressed: 'overhead press' }
  const bare = parts.map((p) => {
    const d = dayOf(p.replace(VERB, '').replace(/\s+(?:done|session)$/, ''), today)
    return d && d.rest && !/\d/.test(d.rest) ? findExercise(PAST[d.rest] ?? d.rest, list) : null
  })
  if (bare.every(Boolean) && (VERB.test(text) || /\bdone$/.test(text) || Object.keys(PAST).includes(text.split(' ')[0]))) return { kind: 'vague', exercises: bare as Exercise[], weight: null }
  const out: ParsedLift[] = []
  let vague: { exercises: Exercise[]; weight: number | null } | null = null
  for (const part of parts) {
    const p = part.replace(/^(?:i\s+)?(?:just\s+)?(?:did|done|hit|logged|log|got)\s+/, '')
    const d = dayOf(p, today)
    if (!d) return null
    const split = splitName(d.rest)
    if (!split) return null
    const ex = findExercise(split.name, list)
    if (!ex && !nameOk(split.name)) return null
    const nums = numbersOf(split.rest, !!ex?.bodyweight)
    if (!nums) {
      // "bench 80": a weight but no reps
      const w = ex && split.rest.match(new RegExp(`^${NUM}\\s?${UNIT}?$`))
      if (w && parts.length === 1) { vague = { exercises: [ex], weight: toKg(Number(w[1]), unitOf(w[2]) ?? opts.unit ?? 'kg') }; continue }
      return null
    }
    if (!ex && nums.bw) return null   // "his own" bodyweight move: too unsure without the AI
    // a name that isn't one of his exercises only counts with kg or lbs said ("meeting 5x5", "revision 3x30" aren't lifts)
    if (!ex && !nums.unit) return null
    // "squat 5x5", "bench 3x10": sets × reps with no weight (not 5 kg × 5): ask how much
    if (ex && !ex.bodyweight && nums.form === 'wr' && !nums.unit && (nums.w ?? 0) <= 20 && nums.reps[0] <= 20) {
      if (parts.length !== 1) return null
      vague = { exercises: [ex], weight: null }
      continue
    }
    const unit = nums.unit ?? opts.unit ?? 'kg'
    out.push({
      words: split.name, exercise: ex, key: ex?.key ?? keyOf(split.name), weightKg: toKg(nums.w ?? 0, unit), bodyweight: nums.bw || !!ex?.bodyweight,
      unit, given: nums.w ?? 0, unitSaid: !!nums.unit, reps: nums.reps, rpe: nums.rpe, date: d.date, dateWords: d.words,
    })
  }
  if (vague && !out.length) return { kind: 'vague', ...vague }
  if (!out.length || out.length !== parts.length) return null
  // one day for the whole message ("bench 80x5x3 and squat 100 5x5 yesterday")
  const said = out.find((l) => l.dateWords)
  if (said) for (const l of out) if (!l.dateWords) { l.date = said.date; l.dateWords = said.dateWords }
  return { kind: 'lift', lifts: out }
}

/** A lift as the value of a lift_log change ("exercise=bench press; weight=80; reps=5,5,5"); no unit = his setting. */
export function liftValue(l: ParsedLift): string {
  return [`exercise=${l.words}`, `weight=${l.given}`, l.unitSaid ? `unit=${l.unit}` : '', `reps=${l.reps.join(',')}`, l.bodyweight ? 'bw=yes' : '', l.rpe != null ? `rpe=${l.rpe}` : ''].filter(Boolean).join('; ')
}

export { normWords }
