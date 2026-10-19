// The exercise catalogue (queue item 6): names, the words he uses for them ("bp", "ohp", "rdl", "squats"), the muscle
// groups each one trains and whether it's upper or lower body. Editable defaults (not his schedule): he can add his
// own or override one in profiles.planning ("gymExercises"), e.g. { name: 'Zercher squat', muscles: 'quads, glutes',
// aliases: 'zercher' }. Finding an exercise forgives small typos ("benhc", "sqaut"). Pure: no database.
import type { Exercise, Muscle, Pattern } from './types'
import { MUSCLES } from './types'

type Def = [name: string, primary: Muscle[], secondary: Muscle[], pattern: Pattern, opts: { lower?: boolean; compound?: boolean; bw?: boolean }, aliases: string[]]

const DEFS: Def[] = [
  // upper: push
  ['Bench press', ['chest'], ['triceps', 'shoulders'], 'push', { compound: true }, ['bench', 'bp', 'flat bench', 'barbell bench', 'barbell bench press', 'benchpress', 'bench press barbell', 'flat bench press']],
  ['Incline bench press', ['chest'], ['shoulders', 'triceps'], 'push', { compound: true }, ['incline bench', 'incline bp', 'incline press', 'incline barbell press', 'incline barbell bench']],
  ['Dumbbell bench press', ['chest'], ['triceps', 'shoulders'], 'push', {}, ['db bench', 'dumbbell bench', 'db bench press', 'db press', 'dumbbell press', 'dumbbell chest press', 'db chest press', 'bench press dumbbell']],
  ['Incline dumbbell press', ['chest'], ['shoulders', 'triceps'], 'push', {}, ['incline db', 'incline db press', 'incline dumbbell', 'incline dumbbell bench', 'incline db bench', 'incline dumbbell bench press', 'incline bench press dumbbell', 'incline press dumbbell']],
  ['Close-grip bench press', ['triceps'], ['chest'], 'push', { compound: true }, ['close grip bench', 'close grip bench press', 'cgbp', 'close grip bp']],
  ['Chest press machine', ['chest'], ['triceps'], 'push', {}, ['chest press', 'machine chest press', 'machine press', 'seated chest press']],
  ['Chest fly', ['chest'], [], 'push', {}, ['fly', 'flys', 'flies', 'flyes', 'chest flys', 'chest flies', 'cable fly', 'cable flys', 'cable flies', 'pec deck', 'pec fly', 'db fly', 'dumbbell fly', 'cable crossover', 'crossovers']],
  ['Dips', ['chest', 'triceps'], ['shoulders'], 'push', { compound: true, bw: true }, ['dip', 'chest dips', 'weighted dips', 'parallel bar dips']],
  ['Push-ups', ['chest'], ['triceps', 'shoulders'], 'push', { bw: true }, ['push ups', 'pushups', 'push up', 'pushup', 'press ups', 'press up', 'pressups']],
  ['Overhead press', ['shoulders'], ['triceps'], 'push', { compound: true }, ['ohp', 'military press', 'standing press', 'barbell overhead press', 'overhead press barbell', 'shoulder press barbell', 'strict press']],
  ['Dumbbell shoulder press', ['shoulders'], ['triceps'], 'push', {}, ['db shoulder press', 'shoulder press', 'seated shoulder press', 'dumbbell overhead press', 'db overhead press', 'seated db press', 'arnold press', 'machine shoulder press', 'shoulder press dumbbell', 'overhead press dumbbell', 'seated overhead press dumbbell']],
  ['Lateral raise', ['shoulders'], [], 'push', {}, ['lateral raises', 'lat raise', 'lat raises', 'side raise', 'side raises', 'laterals', 'side laterals', 'lateral', 'cable lateral raise', 'db lateral raise']],
  ['Tricep pushdown', ['triceps'], [], 'push', {}, ['pushdown', 'pushdowns', 'tricep pushdowns', 'triceps pushdown', 'rope pushdown', 'rope pushdowns', 'tricep pressdown', 'cable pushdown']],
  ['Skull crushers', ['triceps'], [], 'push', {}, ['skull crusher', 'skullcrushers', 'skullcrusher', 'lying tricep extension', 'ez bar skull crushers']],
  ['Overhead tricep extension', ['triceps'], [], 'push', {}, ['overhead extension', 'tricep extension', 'triceps extension', 'overhead triceps extension', 'french press']],
  // upper: pull
  ['Pull-ups', ['back'], ['biceps'], 'pull', { compound: true, bw: true }, ['pull ups', 'pullups', 'pull up', 'pullup', 'weighted pull ups', 'weighted pullups', 'wide grip pull ups']],
  ['Chin-ups', ['back', 'biceps'], [], 'pull', { compound: true, bw: true }, ['chin ups', 'chinups', 'chin up', 'chinup', 'chins', 'weighted chin ups']],
  ['Lat pulldown', ['back'], ['biceps'], 'pull', {}, ['lat pull down', 'lat pulldowns', 'pulldown', 'pulldowns', 'pull down', 'lat pull', 'cable pulldown', 'wide grip pulldown']],
  ['Barbell row', ['back'], ['biceps'], 'pull', { compound: true }, ['bent over row', 'bent over rows', 'bb row', 'barbell rows', 'bent row', 'pendlay row', 'pendlay rows', 'row', 'rows']],
  ['Dumbbell row', ['back'], ['biceps'], 'pull', {}, ['db row', 'db rows', 'dumbbell rows', 'one arm row', 'single arm row', 'one arm db row', 'single arm db row']],
  ['Seated cable row', ['back'], ['biceps'], 'pull', {}, ['cable row', 'cable rows', 'seated row', 'seated rows', 'low row', 'seated cable rows']],
  ['Chest-supported row', ['back'], ['biceps'], 'pull', {}, ['chest supported row', 'machine row', 't bar row', 'tbar row', 'seal row', 'incline row']],
  ['Face pull', ['shoulders'], ['back'], 'pull', {}, ['face pulls', 'facepull', 'facepulls', 'rope face pull']],
  ['Rear delt fly', ['shoulders'], ['back'], 'pull', {}, ['rear delt', 'rear delts', 'rear delt flys', 'reverse fly', 'reverse flys', 'reverse pec deck', 'rear fly']],
  ['Bicep curl', ['biceps'], [], 'pull', {}, ['curl', 'curls', 'bicep curls', 'biceps curl', 'biceps curls', 'db curl', 'db curls', 'dumbbell curl', 'barbell curl', 'ez curl', 'ez bar curl', 'cable curl', 'preacher curl', 'incline curl']],
  ['Hammer curl', ['biceps'], [], 'pull', {}, ['hammer curls', 'hammers', 'rope hammer curl']],
  ['Shrugs', ['back'], [], 'pull', {}, ['shrug', 'barbell shrugs', 'db shrugs', 'dumbbell shrugs', 'trap shrugs']],
  // lower
  ['Squat', ['quads'], ['glutes', 'core'], 'legs', { lower: true, compound: true }, ['squats', 'back squat', 'back squats', 'barbell squat', 'barbell squats', 'high bar squat', 'low bar squat', 'sq']],
  ['Front squat', ['quads'], ['glutes', 'core'], 'legs', { lower: true, compound: true }, ['front squats', 'fs']],
  ['Deadlift', ['hamstrings', 'glutes', 'back'], ['quads'], 'legs', { lower: true, compound: true }, ['deadlifts', 'dl', 'deads', 'conventional deadlift', 'sumo deadlift', 'barbell deadlift', 'deadlift barbell']],
  ['Romanian deadlift', ['hamstrings'], ['glutes', 'back'], 'legs', { lower: true, compound: true }, ['rdl', 'rdls', 'romanian deadlifts', 'romanian dl', 'stiff leg deadlift', 'sldl', 'db rdl', 'dumbbell rdl']],
  ['Trap bar deadlift', ['quads', 'glutes', 'hamstrings'], ['back'], 'legs', { lower: true, compound: true }, ['trap bar', 'hex bar', 'hex bar deadlift', 'trap bar deadlifts', 'trap bar dl']],
  ['Leg press', ['quads'], ['glutes'], 'legs', { lower: true }, ['leg presses', 'legpress', 'sled press']],
  ['Bulgarian split squat', ['quads', 'glutes'], ['hamstrings'], 'legs', { lower: true }, ['bulgarian', 'bulgarians', 'bss', 'split squat', 'split squats', 'bulgarian split squats', 'rfess']],
  ['Lunges', ['quads', 'glutes'], ['hamstrings'], 'legs', { lower: true }, ['lunge', 'walking lunges', 'walking lunge', 'reverse lunges', 'reverse lunge', 'db lunges']],
  ['Step-ups', ['quads', 'glutes'], [], 'legs', { lower: true }, ['step ups', 'step up', 'stepups', 'box step ups']],
  ['Hip thrust', ['glutes'], ['hamstrings'], 'legs', { lower: true }, ['hip thrusts', 'barbell hip thrust', 'glute bridge', 'glute bridges', 'hip thrusters']],
  ['Leg curl', ['hamstrings'], [], 'legs', { lower: true }, ['leg curls', 'hamstring curl', 'hamstring curls', 'lying leg curl', 'seated leg curl', 'ham curls']],
  ['Leg extension', ['quads'], [], 'legs', { lower: true }, ['leg extensions', 'quad extension', 'quad extensions', 'leg ext']],
  ['Nordic curl', ['hamstrings'], [], 'legs', { lower: true, bw: true }, ['nordic curls', 'nordics', 'nordic', 'nordic hamstring curl', 'nordic hamstring curls']],
  ['Calf raise', ['calves'], [], 'legs', { lower: true }, ['calf raises', 'calves', 'standing calf raise', 'seated calf raise', 'calf raise machine']],
  // core
  ['Hanging leg raise', ['core'], [], 'core', { bw: true }, ['hanging leg raises', 'leg raises', 'leg raise', 'knee raises', 'hanging knee raise']],
  ['Cable crunch', ['core'], [], 'core', {}, ['cable crunches', 'kneeling cable crunch', 'rope crunch']],
  ['Ab wheel', ['core'], [], 'core', { bw: true }, ['ab rollout', 'ab rollouts', 'rollouts', 'ab wheel rollout', 'ab roller']],
  ['Sit-ups', ['core'], [], 'core', { bw: true }, ['sit ups', 'situps', 'weighted sit ups', 'decline sit ups', 'crunches', 'crunch']],
]

/** "Bench press (Barbell)", "bench-press!" → "bench press". */
export const normWords = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export const keyOf = (name: string) => normWords(name).slice(0, 80)

export const DEFAULT_EXERCISES: Exercise[] = DEFS.map(([name, primary, secondary, pattern, o, aliases]) => ({
  key: keyOf(name), name, primary, secondary, pattern, lower: !!o.lower, compound: !!o.compound, ...(o.bw ? { bodyweight: true } : {}), aliases,
}))

const obj = (raw: unknown) => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
const musclesOf = (v: unknown): Muscle[] => (typeof v === 'string' ? v.split(/\s*,\s*/) : Array.isArray(v) ? v : [])
  .map((m) => String(m).trim().toLowerCase().replace(/s$/, '')).map((m) => (MUSCLES as readonly string[]).find((x) => x === m || x.replace(/s$/, '') === m))
  .filter((m): m is Muscle => !!m)

/**
 * The catalogue he uses: the defaults, plus his own exercises (or changes to one) from profiles.planning.gymExercises,
 * a list of { name, muscles, secondary?, pattern?, lower?, bodyweight?, aliases? }. Odd entries are skipped.
 */
export function exerciseCatalogue(planning?: unknown): Exercise[] {
  const own = obj(planning).gymExercises
  if (!Array.isArray(own) || !own.length) return DEFAULT_EXERCISES
  const out = [...DEFAULT_EXERCISES]
  for (const raw of own.slice(0, 100)) {
    const e = obj(raw)
    const name = typeof e.name === 'string' ? e.name.trim().slice(0, 60) : ''
    const key = keyOf(name)
    if (!key) continue
    const primary = musclesOf(e.muscles)
    const was = out.findIndex((x) => x.key === key)
    const base = was >= 0 ? out[was] : null
    const pattern = (['push', 'pull', 'legs', 'core'] as const).find((p) => p === e.pattern) ?? base?.pattern
      ?? (primary.some((m) => ['quads', 'hamstrings', 'glutes', 'calves'].includes(m)) ? 'legs' : primary.includes('core') ? 'core' : primary.some((m) => m === 'back' || m === 'biceps') ? 'pull' : 'push')
    const aliases = (typeof e.aliases === 'string' ? e.aliases.split(/\s*,\s*/) : Array.isArray(e.aliases) ? e.aliases.map(String) : []).map(normWords).filter((a) => a.length >= 2).slice(0, 20)
    const ex: Exercise = {
      key, name, primary: primary.length ? primary : base?.primary ?? [], secondary: musclesOf(e.secondary).length ? musclesOf(e.secondary) : base?.secondary ?? [], pattern,
      lower: typeof e.lower === 'boolean' ? e.lower : base?.lower ?? pattern === 'legs', compound: typeof e.compound === 'boolean' ? e.compound : base?.compound ?? false,
      ...((typeof e.bodyweight === 'boolean' ? e.bodyweight : base?.bodyweight) ? { bodyweight: true } : {}),
      aliases: [...new Set([...(base?.aliases ?? []), ...aliases])],
    }
    if (was >= 0) out[was] = ex; else out.push(ex)
  }
  return out
}

/** Typos between two short strings: a letter added, missing, changed, or two letters swapped ("benhc") count one each. */
export function distance(a: string, b: string): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > 2) return 3
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)))
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}

/** One slip of the fingers: two letters swapped ("benhc"), one letter missing ("bench pres") or one extra. A changed
 *  letter doesn't count: that's how real words look ("squad", "deadline", "beach" are not squat, deadlift, bench). */
export function oneSlip(a: string, b: string): boolean {
  if (a === b) return false
  if (a.length === b.length) {
    const i = [...a].findIndex((c, k) => c !== b[k])
    return i >= 0 && i < a.length - 1 && a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2)
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a]
  if (l.length - s.length !== 1) return false
  for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true
  return false
}
/** Real words one slip away from an exercise name. */
const REAL_WORDS = new Set(['lungs', 'lounge', 'lounges', 'curly', 'calve', 'dipt', 'rower', 'rowers', 'curler'])

/**
 * Which exercise his words mean: an exact name or alias first, then without a plural "s", then one slip of the
 * fingers (oneSlip), if only one exercise is that close. null = not one of his exercises.
 */
export function findExercise(words: string, list: Exercise[] = DEFAULT_EXERCISES): Exercise | null {
  const w = normWords(words).replace(/^(?:the|my|some|a) /, '')
  if (!w) return null
  const names = (e: Exercise) => [e.key, ...e.aliases.map(normWords)]
  const exact = (x: string) => list.find((e) => names(e).includes(x)) ?? null
  const hit = exact(w) ?? exact(w.replace(/s$/, '')) ?? exact(w.replace(/es$/, '')) ?? exact(w.replace(/ (?:barbell|dumbbell|db|machine|cable)$/, ''))
  if (hit) return hit
  if (w.length < 4 || REAL_WORDS.has(w)) return null
  const near = new Set(list.filter((e) => names(e).some((n) => n.length >= 4 && oneSlip(w, n))))
  return near.size === 1 ? [...near][0] : null
}

/** The exercise a stored row is (by its key), or a made-up entry for one that isn't in the catalogue. */
export function exerciseOf(key: string, list: Exercise[] = DEFAULT_EXERCISES, name?: string): Exercise {
  return list.find((e) => e.key === key) ?? {
    key, name: name ? name.charAt(0).toUpperCase() + name.slice(1) : key.charAt(0).toUpperCase() + key.slice(1),
    primary: [], secondary: [], pattern: 'push', lower: false, compound: false, aliases: [],
  }
}

/** Is this exercise in the catalogue (so its sets count toward muscle groups)? */
export const known = (key: string, list: Exercise[] = DEFAULT_EXERCISES) => list.some((e) => e.key === key)
