// Training rules (my-spec 31) as editable data that plain code enforces, and placing the week's flexible sessions
// (gym targets: Upper, Lower, plyo…) around the fixed ones (football, Owen's sprints, matches) without breaking them.
// Pure: no database, no clock, no AI.
import { addDays, minutesOf } from './time'

/** A training type's key ("upper", "swim"…): one of his training types (profiles.planning "trainingTypes"). */
export type TrainingType = string
/** A session's intensity as stored: 'hard' is heavy (the word kept from before), 'moderate' needs build-n.sql. */
export type Load = 'hard' | 'moderate' | 'light'
/** light < moderate < hard */
export const loadRank = (l: Load | string | null | undefined) => (l === 'light' ? 0 : l === 'moderate' ? 1 : 2)
/** Stored when Nat says something isn't training, so it's never asked about or guessed again. */
export const NOT_TRAINING = 'none'

/**
 * One training type. words: what a session's name contains for the app to guess this type (only a suggestion: the
 * bot asks him once). placeable: the planner may put it into free time itself; team sessions at set times
 * (football, matches, sprints) come from the calendar instead. load: what a session of it is unless he says.
 * The list order is the guessing order ("Owen training" is a sprint before it's football).
 */
export type TypeDef = { key: string; label: string; words: string[]; placeable: boolean; load: Load; archived?: boolean }

/** Used until he changes the list (my-spec 31 and 34). */
export const DEFAULT_TYPES: TypeDef[] = [
  { key: 'match', label: 'Match', words: ['match', 'game', 'fixture'], placeable: false, load: 'hard' },
  { key: 'sprint', label: 'Sprint', words: ['sprint', 'track', 'owen', 'speed'], placeable: false, load: 'hard' },
  { key: 'lower', label: 'Lower', words: ['lower', 'legs', 'squat'], placeable: true, load: 'hard' },   // "Lower + plyo" is a Lower day
  { key: 'plyo', label: 'Plyo', words: ['plyo', 'jump'], placeable: true, load: 'hard' },
  { key: 'upper', label: 'Upper', words: ['upper', 'push', 'pull', 'chest', 'arms'], placeable: true, load: 'hard' },
  { key: 'football', label: 'Football', words: ['football', 'team', 'training', 'futsal'], placeable: false, load: 'hard' },
  { key: 'gym', label: 'Gym', words: ['gym', 'lift'], placeable: true, load: 'hard' },
  // Build O: the lighter sessions of his week (his brief, 11 Oct)
  { key: 'injury', label: 'Injury prevention', words: ['injury', 'prehab', 'rehab'], placeable: true, load: 'moderate' },
  { key: 'core', label: 'Core', words: ['core', 'abs'], placeable: true, load: 'light' },
  { key: 'mobility', label: 'Mobility', words: ['mobility', 'stretch', 'stretching', 'yoga'], placeable: true, load: 'light' },
  { key: 'other', label: 'Other', words: ['recovery', 'walk'], placeable: true, load: 'light' },
]

const TYPE_KEY = /^[a-z][a-z0-9_]{0,24}$/   // fits in a Telegram button (64 bytes)
/** His training types (archived ones included, flagged), checked; the defaults if he has none. */
export function trainingTypes(planning: unknown): TypeDef[] {
  const v = planning && typeof planning === 'object' ? (planning as Record<string, unknown>).trainingTypes : undefined
  if (!Array.isArray(v)) return DEFAULT_TYPES
  const seen = new Set<string>()
  const out: TypeDef[] = []
  for (const x of v) {
    const t = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const key = typeof t.key === 'string' ? t.key : ''
    const label = typeof t.label === 'string' ? t.label.trim().slice(0, 30) : ''
    if (!TYPE_KEY.test(key) || key === NOT_TRAINING || !label || seen.has(key)) continue
    seen.add(key)
    const words = Array.isArray(t.words) ? (t.words as unknown[]).filter((w): w is string => typeof w === 'string').map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 2).slice(0, 12) : []
    out.push({ key, label, words, placeable: t.placeable === true, load: t.load === 'light' ? 'light' : t.load === 'moderate' ? 'moderate' : 'hard', ...(t.archived === true ? { archived: true } : {}) })
  }
  return out.length ? out : DEFAULT_TYPES
}

/** The types to pick from or guess (not archived). */
export const activeTypes = (types: TypeDef[]) => types.filter((t) => !t.archived)
export const isTrainingType = (key: string | null | undefined, types: TypeDef[] = DEFAULT_TYPES) => !!key && types.some((t) => t.key === key)
export const labelOf = (key: string, types: TypeDef[] = DEFAULT_TYPES) => types.find((t) => t.key === key)?.label ?? key
/** The load a type gets unless he says otherwise. */
export const defaultLoad = (key: string, types: TypeDef[] = DEFAULT_TYPES): Load => types.find((t) => t.key === key)?.load ?? 'hard'
/** May the planner place it into free time itself? */
export const isPlaceable = (key: string, types: TypeDef[] = DEFAULT_TYPES) => types.find((t) => t.key === key)?.placeable ?? false

/** A session on a day: fixed (an event) or flexible (a weekly target placed by the planner). */
export type Session = { date: string; start?: string | null; type: TrainingType; load: Load; title: string; fixed: boolean; key?: string }

/**
 * Rules are guidelines the planner weighs, not hard blocks: 'avoid' costs a lot, 'prefer' a little (lib/load.ts).
 * A gap rule can apply only from an intensity up (minLoad: "light lower is fine the day before a game") and can be
 * in hours instead of days ("within 48 h").
 */
export type Strength = 'avoid' | 'prefer'
export type Rule =
  | { id?: string; kind: 'gap'; what: TrainingType[]; near: TrainingType[]; side: 'before' | 'after' | 'both'; days: number; label: string; enabled: boolean; minLoad?: Load; hours?: number; strength?: Strength }
  | { id?: string; kind: 'max_hard'; n: number; pairs: [TrainingType, TrainingType][]; label: string; enabled: boolean; strength?: Strength }
  | { id?: string; kind: 'after_double'; label: string; enabled: boolean; strength?: Strength }

/** The five rules from my-spec 31, used until Nat changes one ("check with Owen"). Queue item 6 (19 Oct, his words):
 *  light lower is fine the day before a game (only moderate/heavy lower is kept off it; plyo stays off it at any
 *  intensity: the last rule), and Tuesday is school football then Owen, so Owen's speed session is fine on a football
 *  day. Still guesses: his saved rules win. The plyo rule is last so the older rules keep their places (TR refs). */
export const DEFAULT_RULES: Rule[] = [
  { kind: 'gap', what: ['lower'], near: ['sprint', 'match'], side: 'before', days: 1, minLoad: 'moderate', label: 'No Lower the day before a sprint session or match (light lower is fine)', enabled: true },
  { kind: 'gap', what: ['sprint', 'plyo'], near: ['lower'], side: 'after', days: 1, label: 'Sprint and plyo when fresh: not the day after (or later the same day as) Lower', enabled: true },
  { kind: 'max_hard', n: 1, pairs: [['upper', 'football'], ['sprint', 'football']], label: 'At most one hard session a day (Upper or Owen’s speed is fine on football days)', enabled: true },
  { kind: 'after_double', label: 'After a double-session day, a lighter next day', enabled: true },
  { kind: 'gap', what: ['plyo'], near: ['sprint', 'match'], side: 'before', days: 1, label: 'No plyo the day before a sprint session or match (not even light)', enabled: true },
]

/** A best guess from the name: only a suggestion. The bot asks him once (lib/telegram/asktype.ts) and stores his answer;
 *  until he answers, the planner uses the guess so the rules still protect the session. */
export function guessType(name: string, types: TypeDef[] = DEFAULT_TYPES): { type: TrainingType; load: Load } | null {
  // whole words, or the start of one ("jumps", "lifting"), so "match" never matches "rematch" mid-word
  const words = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `
  for (const t of activeTypes(types)) {
    if (t.words.some((w) => words.includes(` ${w.replace(/[^a-z0-9]+/g, ' ').trim()}`))) return { type: t.key, load: t.load }
  }
  return null
}

const NAMES: Record<string, string> = { upper: 'Upper', lower: 'Lower', plyo: 'plyo', sprint: 'a sprint session', football: 'football', match: 'a match', gym: 'gym', other: 'training' }
const nameOf = (t: string) => NAMES[t] ?? t

/** Every rule a week of sessions breaks, in words ("Lower on Wed is the day before a sprint session (Thu)"). */
export type RuleProblem = { rule: string; text: string; keys: string[]; strength: Strength }
export function ruleProblems(sessions: Session[], rules: Rule[]): RuleProblem[] {
  const out: RuleProblem[] = []
  const byDay = new Map<string, Session[]>()
  for (const s of sessions) byDay.set(s.date, [...(byDay.get(s.date) ?? []), s])
  const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })
  const k = (s: Session) => s.key ?? `${s.date}:${s.title}`
  for (const r of rules.filter((x) => x.enabled)) {
    if (r.kind === 'gap') {
      for (const s of sessions.filter((x) => r.what.includes(x.type) && (!r.minLoad || loadRank(x.load) >= loadRank(r.minLoad)))) {
        for (const o of sessions.filter((x) => x !== s && r.near.includes(x.type))) {
          const diff = (Date.parse(`${o.date}T12:00:00Z`) - Date.parse(`${s.date}T12:00:00Z`)) / 86_400_000
          if (r.hours) {
            // in hours, start to start (a session with no time counts from 17:00)
            const h = (diff * 24 * 60 + minutesOf(o.start ?? '17:00') - minutesOf(s.start ?? '17:00')) / 60
            const near = r.side === 'before' ? h > 0 && h < r.hours : r.side === 'after' ? h < 0 && -h < r.hours : Math.abs(h) < r.hours
            if (near) out.push({ rule: r.label, strength: r.strength ?? 'avoid', text: `${s.title} on ${day(s.date)} is ${Math.round(Math.abs(h))} h ${h > 0 ? 'before' : 'after'} ${nameOf(o.type)} (${day(o.date)})`, keys: [k(s), k(o)] })
            continue
          }
          // "before": s is within `days` days before o (or earlier the same day); "after": s is within `days` after o (or later the same day)
          const sameDayOrder = diff === 0 && s.start && o.start ? minutesOf(s.start) - minutesOf(o.start) : 0
          const before = (diff > 0 && diff <= r.days) || (diff === 0 && sameDayOrder < 0)
          const after = (diff < 0 && -diff <= r.days) || (diff === 0 && sameDayOrder > 0)
          const hit = r.side === 'before' ? before : r.side === 'after' ? after : before || after || diff === 0
          if (hit) out.push({ rule: r.label, strength: r.strength ?? 'avoid', text: `${s.title} on ${day(s.date)} is ${before ? 'right before' : diff === 0 ? 'the same day as' : 'right after'} ${nameOf(o.type)} (${day(o.date)})`, keys: [k(s), k(o)] })
        }
      }
    } else if (r.kind === 'max_hard') {
      for (const [d, list] of byDay) {
        const hard = list.filter((x) => x.load === 'hard')
        if (hard.length <= r.n) continue
        const okPair = hard.length === 2 && r.pairs.some(([a, b]) => (hard[0].type === a && hard[1].type === b) || (hard[0].type === b && hard[1].type === a))
        if (!okPair) out.push({ rule: r.label, strength: r.strength ?? 'avoid', text: `${hard.map((x) => x.title).join(' and ')} on ${day(d)}: ${hard.length} hard sessions in a day`, keys: hard.map(k) })
      }
    } else if (r.kind === 'after_double') {
      for (const [d, list] of byDay) {
        if (list.filter((x) => x.load === 'hard').length < 2) continue
        const next = (byDay.get(addDays(d, 1)) ?? []).filter((x) => x.load === 'hard')
        if (next.length) out.push({ rule: r.label, strength: r.strength ?? 'avoid', text: `${next.map((x) => x.title).join(' and ')} on ${day(addDays(d, 1))} comes after a double on ${day(d)}`, keys: next.map(k) })
      }
    }
  }
  return out
}

/** A flexible session still to place this week. */
export type Need = { key: string; title: string; type: TrainingType; load: Load; minutes: number; preferred?: string | null }
/** Free time per day for training (a gap long enough, before the heavy cut-off), worked out by lib/freetime.ts. */
export type DayRoom = { date: string; slots: { start: string; end: string }[] }
export type Placed = { key: string; title: string; type: TrainingType; load: Load; date: string; start: string; end: string }

/**
 * Put the flexible sessions on days so no rule breaks (with the fixed sessions as they are). Prefers the day a
 * session already had (fewest changes), then spreading out, then earlier. Sessions with no valid day are "TBC":
 * allowed, never forced (my-spec 31). Small enough to search exhaustively.
 */
export function placeWeek(needs: Need[], fixed: Session[], days: DayRoom[], rules: Rule[], heavyUntil: string, trainingFrom = '15:00'):
  { placed: Placed[]; tbc: { title: string; reason: string }[] } {
  // training prefers his usual time (setting trainingFrom, 15:00 unless he changes it); earlier only if nothing later fits
  const beforeUsual = (x: { start: string }) => Number(minutesOf(x.start) < minutesOf(trainingFrom))
  const fits = (n: Need, d: DayRoom): { start: string; end: string } | null => {
    const slots = [...d.slots].sort((a, b) => beforeUsual(a) - beforeUsual(b) || minutesOf(a.start) - minutesOf(b.start))
    for (const s of slots) {
      const from = minutesOf(s.start), to = Math.min(minutesOf(s.end), n.load === 'hard' ? minutesOf(heavyUntil) : 24 * 60)
      if (to - from >= n.minutes) return { start: s.start, end: `${String(Math.floor((from + n.minutes) / 60)).padStart(2, '0')}:${String((from + n.minutes) % 60).padStart(2, '0')}` }
    }
    return null
  }
  // best = most sessions placed, then fewest moved from their preferred day, then most spread, then earliest
  let best: { chosen: (string | null)[]; score: number[] } | null = null
  const order = [...needs]
  const chosen: (string | null)[] = []
  const better = (a: number[], b: number[]) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false }
  const score = () => {
    const days = chosen.filter(Boolean) as string[]
    const moved = order.reduce((m, n, i) => m + (n.preferred && chosen[i] && chosen[i] !== n.preferred ? 1 : 0), 0)
    const sorted = [...days].sort()
    let spread = 0
    for (let i = 1; i < sorted.length; i++) spread += Math.min(3, (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 86_400_000)
    const early = -days.reduce((a, d) => a + Date.parse(d) / 86_400_000, 0)
    return [days.length, -moved, spread, early]
  }
  const sessionsSoFar = (): Session[] => [...fixed, ...order.flatMap((n, i) => (chosen[i] ? [{ date: chosen[i]!, type: n.type, load: n.load, title: n.title, fixed: false, key: n.key }] : []))]
  // only problems a flexible session causes count: a clash between two fixed sessions can't be fixed by placing
  const flexible = new Set(order.map((n) => n.key))
  const placingBreaksARule = () => ruleProblems(sessionsSoFar(), rules).some((p) => p.keys.some((x) => flexible.has(x)))
  let steps = 0
  const search = (i: number) => {
    if (++steps > 200_000) return
    if (i === order.length) { const s = score(); if (!best || better(s, best.score)) best = { chosen: [...chosen], score: s }; return }
    const n = order[i]
    // two sessions of the same thing are interchangeable: only try them in day order (each plan once)
    const twin = order.slice(0, i).map((x, j) => (x.title === n.title && x.type === n.type ? j : -1)).filter((j) => j >= 0).pop()
    if (twin !== undefined && chosen[twin] === null) { chosen[i] = null; search(i + 1); return }
    const candidates = [...days].sort((a, b) => Number(b.date === n.preferred) - Number(a.date === n.preferred))
      .filter((d) => twin === undefined || d.date > chosen[twin]!)
    for (const d of candidates) {
      if (chosen.some((c, j) => c === d.date && order[j].load === 'hard' && n.load === 'hard' && order[j].type === n.type)) continue
      if (!fits(n, d)) continue
      chosen[i] = d.date
      if (!placingBreaksARule()) search(i + 1)
      chosen[i] = null
    }
    chosen[i] = null
    search(i + 1)   // or leave it TBC
  }
  search(0)
  const pick = (best ?? { chosen: order.map(() => null) }).chosen
  const placed: Placed[] = []
  const tbc: { title: string; reason: string }[] = []
  // times: each day's sessions take its free time in turn, 10 minutes apart
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const left = new Map(days.map((d) => [d.date, d.slots.map((x) => ({ ...x }))]))
  order.forEach((n, i) => {
    const d = pick[i]
    if (!d) { tbc.push({ title: n.title, reason: 'no day this week without breaking a training rule or running out of free time' }); return }
    const slots = left.get(d)!
    const at = fits(n, { date: d, slots })
    if (!at) { tbc.push({ title: n.title, reason: 'not enough free time left that day' }); return }
    const slot = slots.find((x) => x.start === at.start)!
    slot.start = hm(Math.min(minutesOf(at.end) + 10, minutesOf(slot.end)))
    placed.push({ key: n.key, title: n.title, type: n.type, load: n.load, date: d, start: at.start, end: at.end })
  })
  return { placed, tbc }
}
