// Queue item 6 (training + gym progress), plain tests (no database): reading lifts he types (shapes, typos, aliases,
// units, days), Epley e1RM, PRs, weekly sets per muscle group and the upper-body balance check, the next-session
// suggestion (double progression, deload), Hevy CSV import, /gym and /owen text, and training spacing on a realistic
// week with the real optimiser (upper 2× Mon + Sat at PureGym ~90 min, no heavy lower/plyo the day before a game, light
// lower allowed, Owen's days kept, football days respected) — all from data, nothing hardcoded.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/gym-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLifts, liftValue, dayOf } from '../lib/gym/parse.ts'
import { DEFAULT_EXERCISES, exerciseCatalogue, findExercise, distance } from '../lib/gym/catalogue.ts'
import { epley, e1rmOf, prOf, prWords, logLine, setsText, volumeOf, balanceOf, nextFor, nextAll, sessionsOf, bestsOf, prsIn, seriesOf, trendOf, groupReps, kgText } from '../lib/gym/progress.ts'
import { parseCsv, hevyTime, hevyExercise, readHevy, MAX_BYTES } from '../lib/gym/hevy.ts'
import { gymWeekHtml, exerciseHtml, gymSnapshot, volumeWords } from '../lib/gym/summary.ts'
import { owenSlots, slotsWords } from '../lib/gym/owen.ts'
import { gymPrefs, GYM_SETTINGS } from '../lib/gym/settings.ts'
import { DEFAULT_PREFS } from '../lib/gym/types.ts'
import { moreSettings, parseSetting, SETTINGS } from '../lib/settings.ts'
import { planTraining, fixedLoad, optWorldOf } from '../lib/week.ts'
import { planningSettings } from '../lib/freetime.ts'
import { planningEvents, shapesFor, DEFAULT_SESSIONS, GUESS_MINUTES, sessionMinutes, gameFor } from '../lib/setup.ts'
import { owenChange, sessionChange } from '../lib/setup-edit.ts'
import { mentalDays } from '../lib/mental.ts'
import { DEFAULT_RULES, DEFAULT_TYPES, ruleProblems } from '../lib/training.ts'
import { ruleFromRow, ruleToRow } from '../lib/training-data.ts'
import { assess } from '../lib/load.ts'
import { expandEvents } from '../lib/events.ts'
import { addDays, isoDow, minutesOf } from '../lib/time.ts'

const MON = '2026-10-19'   // a Monday
const d = (i) => addDays(MON, i)
const ex = (name) => findExercise(name)
const one = (msg, today = MON, opts) => { const r = parseLifts(msg, today, opts); assert.equal(r?.kind, 'lift', `“${msg}” is a lift`); assert.equal(r.lifts.length, 1); return r.lifts[0] }
const lift = (key, done_on, weight_kg, reps, sets = 1, extra = {}) => ({ id: `${key}-${done_on}-${weight_kg}-${reps}-${sets}`, exercise: key, exercise_key: key, done_on, weight_kg, reps, sets, rpe: null, source: 'chat', source_ref: null, notes: null, ...extra })

// ---------------------------------------------------------------------------
// Reading lifts
// ---------------------------------------------------------------------------

test('parse: the contract shapes (weight × reps × sets, weight then sets × reps, one set, a set each, bodyweight)', () => {
  const b = one('bench 80x5x3')
  assert.deepEqual([b.key, b.weightKg, b.reps, b.date, b.bodyweight], ['bench press', 80, [5, 5, 5], MON, false])
  assert.deepEqual(one('squat 100 5x5').reps, [5, 5, 5, 5, 5], '“squat 100 5x5” = 100 kg, 5 sets of 5')
  assert.deepEqual([one('bench 80x8').weightKg, one('bench 80x8').reps], [80, [8]], 'one set of 8')
  const dl = one('deadlift 140kg 3x5')
  assert.deepEqual([dl.key, dl.weightKg, dl.reps], ['deadlift', 140, [5, 5, 5]], '140 kg, 3 sets of 5')
  assert.deepEqual(one('OHP 50 x 6,6,5').reps, [6, 6, 5])
  assert.deepEqual(one('ohp 50 6,6,5').reps, [6, 6, 5])
  const pu = one('pull ups bw+10 3x8')
  assert.deepEqual([pu.key, pu.weightKg, pu.bodyweight, pu.reps], ['pull ups', 10, true, [8, 8, 8]], 'bodyweight + 10 kg, 3 sets of 8')
  const dips = one('dips bodyweight 3x12')
  assert.deepEqual([dips.key, dips.weightKg, dips.bodyweight, dips.reps], ['dips', 0, true, [12, 12, 12]])
  assert.deepEqual(one('pull ups 3x8').reps, [8, 8, 8], 'a bodyweight move: 3x8 = 3 sets of 8, no weight')
  assert.equal(one('pull ups 3x8').weightKg, 0)
  assert.deepEqual(one('pull ups 10,8,8').reps, [10, 8, 8])
  assert.deepEqual([one('dips 20kg 3x10').weightKg, one('dips 20kg 3x10').reps.length], [20, 3], 'weighted dips')
  assert.deepEqual(one('bench 80 x 5 x 3').reps, [5, 5, 5], 'spaces')
  assert.deepEqual(one('bench 80×5×3').reps, [5, 5, 5], '× sign')
  assert.deepEqual(one('bench 3x5 @ 80kg').reps, [5, 5, 5])
  assert.deepEqual(one('bench 80kg for 3 sets of 5').reps, [5, 5, 5])
  assert.deepEqual(one('bench 80 for 5').reps, [5])
  assert.equal(one('bench 82.5x5x3').weightKg, 82.5)
  assert.equal(one('bench 80x5x3 @8').rpe, 8, 'RPE')
  assert.equal(one('bench 80x5x3 rpe 8.5').rpe, 8.5)
})

test('parse: typos and the words he uses (bp, bench press, squats, rdl, ohp, lat pulldown, benhc, sqaut)', () => {
  const cases = { 'bp 80x5x3': 'bench press', 'bench press 80x5x3': 'bench press', 'squats 100 5x5': 'squat', 'rdl 100x8x3': 'romanian deadlift',
    'ohp 50x5x3': 'overhead press', 'lat pulldown 60 3x10': 'lat pulldown', 'benhc 80x5x3': 'bench press', 'sqaut 100 5x5': 'squat', 'bench pres 80x5x3': 'bench press',
    'incline db 30x10x3': 'incline dumbbell press', 'bulgarians 20kg 3x8': 'bulgarian split squat', 'hip thrusts 100x10x3': 'hip thrust', 'calf raises 60x15x3': 'calf raise',
    'chin ups 12': 'chin ups', 'DEADLIFTS 140 3x5': 'deadlift', 'lat raises 10x15x3': 'lateral raise', 'pushdowns 25x12x3': 'tricep pushdown' }
  for (const [msg, key] of Object.entries(cases)) assert.equal(one(msg).key, key, msg)
  assert.equal(distance('benhc', 'bench'), 1, 'a swapped pair is one typo')
  assert.equal(findExercise('xyz'), null)
  assert.equal(findExercise('rows')?.key, 'barbell row')
})

test('parse: lbs → kg, and his default unit setting', () => {
  const b = one('bench 135x5x3 lbs')
  assert.equal(b.unit, 'lbs')
  assert.equal(b.weightKg, 61.23, '135 lb = 61.23 kg')
  assert.equal(one('bench 225lbs 3x5').weightKg, 102.06)
  assert.equal(one('bench 135x5x3', MON, { unit: 'lbs' }).weightKg, 61.23, 'no unit: his setting (lbs)')
  assert.equal(one('bench 80kg x5x3', MON, { unit: 'lbs' }).weightKg, 80, 'kg said: kg')
  assert.equal(gymPrefs({ liftUnit: 'lbs' }).unit, 'lbs')
})

test('parse: the day (today unless he says: yesterday, on Monday, 2 days ago, last Tuesday)', () => {
  const tue = d(1)
  assert.equal(one('bench 80x5x3', tue).date, tue)
  const y = one('bench 80x5x3 yesterday', tue)
  assert.deepEqual([y.date, y.dateWords], [MON, 'yesterday'])
  assert.equal(one('yesterday bench 80x5x3', tue).date, MON)
  assert.equal(one('did bench 80x5x3 on monday', d(3)).date, MON)
  assert.equal(one('squat 100kg x 5 x 5 2 days ago', d(2)).date, MON)
  assert.equal(one('squat 100 5x5 last tuesday', d(1)).date, addDays(d(1), -7), 'last Tuesday said on a Tuesday = a week ago')
  assert.equal(dayOf('bench 80x5x3 on sunday', MON).date, addDays(MON, -1), 'a weekday is the most recent one (never the future)')
})

test('parse: vague ("did bench", "bench 80"), several lifts, and messages that are not lifts', () => {
  assert.deepEqual(parseLifts('did bench', MON), { kind: 'vague', exercises: [ex('bench')], weight: null })
  assert.equal(parseLifts('done squats and bench', MON).exercises.length, 2)
  assert.equal(parseLifts('benched today', MON).kind, 'vague')
  assert.deepEqual(parseLifts('bench 80', MON), { kind: 'vague', exercises: [ex('bench')], weight: 80 })
  const two = parseLifts('bench 80x5x3 and squat 100 5x5', MON)
  assert.deepEqual(two.lifts.map((l) => l.key), ['bench press', 'squat'])
  assert.deepEqual(parseLifts('bench 80x5x3\nohp 50 x 6,6,5 yesterday', d(1)).lifts.map((l) => l.date), [MON, MON], 'one day for the whole message')
  const own = one('zercher squat 60kg x 8 x 3')
  assert.deepEqual([own.exercise, own.key], [null, 'zercher squat'], 'his own exercise: kept by name')
  // other parts of the bot own these
  for (const m of ['upper 3x this week', 'HT2 practice 38/45', 'did Bicen matrices set 8/10', 'family dinner Sat 7', 'maths + physics 45 min/day this week',
    'football Wed 7:45', 'ACT practice: E33 M35 R34', 'out with friends tomorrow 2-9pm', 'matrices 🟢', 'PC1-01 green', 'mistake: PC1-03 Q3b assumed through origin – knowledge',
    'how’s my bench going?', 'CS tutor 8pm', 'remind me in 2 days', 'bench 80x5x25', 'did upper', 'physics homework due friday', 'take 2x paracetamol']) {
    assert.equal(parseLifts(m, MON), null, m)
  }
  assert.equal(liftValue(one('pull ups bw+10 3x8')), 'exercise=pull ups; weight=10; reps=8,8,8; bw=yes', 'no unit said: his setting decides on the card')
  assert.equal(liftValue(one('dips 20kg 3x10')), 'exercise=dips; weight=20; unit=kg; reps=10,10,10; bw=yes')
  assert.equal(liftValue(one('bench 135x5x3 lbs @8')), 'exercise=bench; weight=135; unit=lbs; reps=5,5,5; rpe=8')
})

// ---------------------------------------------------------------------------
// e1RM, PRs
// ---------------------------------------------------------------------------

test('Epley e1RM: w × (1 + reps/30); a single rep is the weight; bodyweight moves use his bodyweight', () => {
  assert.equal(Math.round(epley(80, 5) * 100) / 100, 93.33)
  assert.equal(epley(100, 1), 100, '1 rep = the weight')
  assert.equal(epley(100, 10), 100 * (1 + 10 / 30))
  assert.equal(epley(0, 5), 0)
  assert.equal(e1rmOf({ weight_kg: 80, reps: 5 }, ex('bench')), 93.3)
  assert.equal(e1rmOf({ weight_kg: 10, reps: 8 }, ex('pull ups')), null, 'no bodyweight set: no e1RM for pull-ups')
  assert.equal(e1rmOf({ weight_kg: 10, reps: 8 }, ex('pull ups'), { ...DEFAULT_PREFS, bodyweightKg: 70 }), 101.3, '(70 + 10) × (1 + 8/30)')
  assert.equal(kgText(93.3), '93.3 kg')
  assert.equal(kgText(80), '80 kg')
  assert.equal(kgText(61.23), '61.23 kg')
})

test('PRs: best e1RM; best weight for at least that many reps; most reps at a weight; the first log is not a PR', () => {
  const bench = ex('bench')
  const before = [lift('bench press', d(-7), 77.5, 4, 3), lift('bench press', d(-7), 90, 1)]
  assert.deepEqual(prOf([{ weight_kg: 80, reps: 5 }], before, bench), { kind: 'e1rm', value: 93.3, was: 90 })
  assert.equal(prWords({ kind: 'e1rm', value: 93.3, was: 90 }, bench), '🏆 new PR (was 90.0)')
  const l = logLine([{ weight_kg: 80, reps: 5, sets: 3 }], bench, before)
  assert.equal(l.text, 'Bench press 80 kg × 5 × 3 · e1RM 93.3 kg · 🏆 new PR (was 90.0)', 'the card line')
  assert.deepEqual(prOf([{ weight_kg: 80, reps: 5 }], [], bench), { kind: 'first' })
  assert.equal(logLine([{ weight_kg: 80, reps: 5, sets: 3 }], bench, []).text, 'Bench press 80 kg × 5 × 3 · e1RM 93.3 kg · first one logged')
  assert.equal(prOf([{ weight_kg: 80, reps: 5 }], [lift('bench press', d(-3), 85, 5)], bench), null, 'lighter than before: no PR')
  // more weight for 3+ reps than ever, but the e1RM isn't a best (a heavy single was)
  assert.deepEqual(prOf([{ weight_kg: 85, reps: 3 }], [lift('bench press', d(-9), 82.5, 3), lift('bench press', d(-8), 100, 1)], bench), { kind: 'weight', reps: 3, value: 85, was: 82.5 })
  // bodyweight dips with no bodyweight set: most reps
  const dips = ex('dips')
  assert.deepEqual(prOf([{ weight_kg: 0, reps: 13 }], [lift('dips', d(-5), 0, 12, 3)], dips), { kind: 'reps', weight: 0, value: 13, was: 12 })
  assert.equal(prWords({ kind: 'reps', weight: 0, value: 13, was: 12 }, dips), '🏆 most reps at BW (was 12)')
  assert.equal(logLine([{ weight_kg: 0, reps: 12, sets: 3 }], dips, []).text, 'Dips BW × 12 × 3 · first one logged', 'no e1RM without a bodyweight')
  assert.equal(setsText([{ weight_kg: 50, reps: 6, sets: 2 }, { weight_kg: 50, reps: 5, sets: 1 }], ex('ohp')), '50 kg × 6, 6, 5')
  assert.equal(setsText([{ weight_kg: 10, reps: 8, sets: 3 }], ex('pull ups')), 'BW+10 kg × 8 × 3')
  assert.deepEqual(groupReps([6, 6, 5]), [{ reps: 6, sets: 2 }, { reps: 5, sets: 1 }])
})

test('bests, sessions, PRs over a range, trend and the chart series', () => {
  const L = [lift('bench press', d(-28), 75, 5, 3), lift('bench press', d(-21), 77.5, 5, 3), lift('bench press', d(-14), 80, 4, 3), lift('bench press', d(-7), 80, 5, 3),
    lift('squat', d(-7), 100, 5, 5), lift('squat', d(0), 105, 5, 5)]
  const ss = sessionsOf(L, 'bench press', ex('bench'))
  assert.equal(ss.length, 4)
  assert.deepEqual(seriesOf(L, 'bench press', ex('bench')).map((p) => p.e1rm), [87.5, 90.4, 90.7, 93.3])
  assert.equal(trendOf(ss), 6.6, '+6.6% over ~4 weeks')
  const b = bestsOf(L)
  assert.deepEqual(b.map((x) => [x.key, x.e1rm, x.date]), [['squat', 122.5, d(0)], ['bench press', 93.3, d(-7)]])
  const prs = prsIn(L, d(-7), d(6))
  assert.deepEqual(prs.map((p) => [p.key, p.date]), [['bench press', d(-7)], ['squat', d(0)]])
  assert.equal(prs[1].short, 'Squat e1RM 122.5 kg (was 116.7)')
})

// ---------------------------------------------------------------------------
// Weekly sets per muscle group and the balance check
// ---------------------------------------------------------------------------

test('weekly volume: Mon–Sun only, a primary muscle counts each set, a secondary half; his own exercises apart', () => {
  const L = [lift('bench press', d(0), 80, 5, 3), lift('overhead press', d(2), 50, 6, 3), lift('squat', d(4), 100, 5, 5), lift('zercher squat', d(4), 60, 8, 3),
    lift('barbell row', d(-1), 70, 8, 3)]   // last Sunday: not this week
  const v = volumeOf(L, MON, d(6))
  assert.equal(v.muscles.chest, 3)
  assert.equal(v.muscles.triceps, 3, 'bench ½ × 3 + OHP ½ × 3')
  assert.equal(v.muscles.shoulders, 4.5, 'bench ½ × 3 + OHP 3')
  assert.equal(v.muscles.quads, 5)
  assert.equal(v.muscles.back, 0, 'Sunday’s rows were last week')
  assert.deepEqual([v.push, v.pull, v.legs, v.unknown, v.sets], [6, 0, 5, 3, 14])
  assert.equal(volumeWords(v), 'chest 3 · shoulders 4.5 · triceps 3 · quads 5 · glutes 2.5 · core 2.5')
})

test('balance: one short suggestion (pull behind push, back behind chest, shoulders light), or balanced; nothing with too little logged', () => {
  const week = (list) => volumeOf(list, MON, d(6))
  const pushHeavy = week([lift('bench press', d(0), 80, 5, 4), lift('incline bench press', d(0), 60, 8, 3), lift('overhead press', d(5), 50, 6, 3), lift('lat pulldown', d(5), 60, 10, 3)])
  const b = balanceOf(pushHeavy)
  assert.equal(b.ok, false)
  assert.match(b.line, /^Pull is behind push \(3 sets vs 10 sets\): add 6 sets of rows or pull-ups next upper session\.$/)
  const even = week([lift('bench press', d(0), 80, 5, 3), lift('overhead press', d(0), 50, 6, 3), lift('barbell row', d(0), 70, 8, 3), lift('face pull', d(5), 20, 15, 3)])
  assert.deepEqual(balanceOf(even), { ok: true, line: 'Upper body balanced: push 6 sets, pull 6 sets ✓' })
  const noShoulders = week([lift('bench press', d(0), 80, 5, 4), lift('dumbbell bench press', d(5), 30, 10, 3), lift('barbell row', d(0), 70, 8, 4), lift('seated cable row', d(5), 50, 10, 3)])
  assert.match(balanceOf(noShoulders).line, /^Shoulders are light/)
  assert.equal(balanceOf(week([lift('bench press', d(0), 80, 5, 3)])), null, 'under 6 upper sets: nothing to say yet')
})

// ---------------------------------------------------------------------------
// Next session (double progression) and deloads
// ---------------------------------------------------------------------------

test('next session: +1 rep; all sets at the top of the range → +2.5 kg upper / +5 kg lower; stalled 3 sessions → deload −10 %', () => {
  const bench = ex('bench'), squat = ex('squat')
  assert.equal(nextFor([lift('bench press', d(0), 80, 5, 3)], 'bench press', bench).text, 'Bench press: 80 kg × 6 × 3 (+1 rep)')
  const top = nextFor([lift('bench press', d(0), 80, 8, 3)], 'bench press', bench)
  assert.deepEqual([top.weight, top.reps, top.sets, top.kind], [82.5, 5, 3, 'weight'])
  assert.equal(top.text, 'Bench press: 82.5 kg × 5 × 3 (every set hit 8+ reps: +2.5 kg)')
  const legs = nextFor([lift('squat', d(0), 100, 8, 5)], 'squat', squat)
  assert.deepEqual([legs.weight, legs.reps], [105, 5], 'lower body: +5 kg')
  const mixed = nextFor([lift('overhead press', d(0), 50, 8, 2), lift('overhead press', d(0), 50, 7, 1)], 'overhead press', ex('ohp'))
  assert.deepEqual([mixed.weight, mixed.reps, mixed.kind], [50, 8, 'reps'], 'one set short of the top: +1 rep (all sets to 8 first)')
  const curl = nextFor([lift('bicep curl', d(0), 15, 12, 3)], 'bicep curl', ex('curls'))
  assert.equal(curl.text, 'Bicep curl: 17.5 kg × 8 × 3 (every set hit 12+ reps: +2.5 kg)', 'accessories use 8–12')
  assert.equal(nextFor([lift('incline dumbbell press', d(0), 30, 10, 3)], 'incline dumbbell press', ex('incline db')).text, 'Incline dumbbell press: 30 kg × 11 × 3 (+1 rep)', 'dumbbell presses: 8–12')
  // stalled: three sessions without beating the best before them
  const stall = [lift('bench press', d(-21), 80, 6, 3), lift('bench press', d(-14), 80, 6, 3), lift('bench press', d(-7), 80, 5, 3), lift('bench press', d(0), 80, 6, 3)]
  const de = nextFor(stall, 'bench press', bench)
  assert.equal(de.kind, 'deload')
  assert.equal(de.weight, 72.5, '80 − 10 % = 72, rounded to 2.5')
  assert.match(de.text, /Bench press: 72\.5 kg × 6 × 3 \(deload: no progress in 3 sessions: −10%, then build back up\)/)
  // progress in one of the last three: no deload
  const ok = [...stall.slice(0, 3), lift('bench press', d(0), 80, 7, 3)]
  assert.equal(nextFor(ok, 'bench press', bench).kind, 'reps')
  // bodyweight with nothing added: an easier week (one set fewer)
  const dips = [d(-21), d(-14), d(-7), d(0)].map((x) => lift('dips', x, 0, 12, 3))
  const dd = nextFor(dips, 'dips', ex('dips'))
  assert.deepEqual([dd.kind, dd.sets], ['deload', 2])
  // his own ranges and deload settings
  const p = gymPrefs({ repsCompound: '3-5', deloadPct: 20, stallSessions: 2 })
  assert.deepEqual([p.compound, p.deloadPct, p.stall], [[3, 5], 20, 2])
  assert.equal(nextFor([lift('bench press', d(0), 80, 5, 3)], 'bench press', bench, p).weight, 82.5, '5s with a 3–5 range: add weight')
  assert.deepEqual(gymPrefs({ repsCompound: 'lots', deloadPct: 99 }).compound, [5, 8], 'odd settings: the defaults')
  assert.equal(nextAll([lift('bench press', d(-30), 80, 5, 3), lift('squat', d(0), 100, 5, 5)], MON).map((n) => n.key).join(), 'squat', 'only exercises done in the last 3 weeks')
})

test('gym settings: in the Settings page group "gym", defaults and checks', () => {
  for (const k of Object.keys(GYM_SETTINGS)) assert.equal(SETTINGS[k].group, 'gym', k)
  const s = moreSettings({})
  assert.deepEqual([s.bodyweightKg, s.liftUnit, s.repsCompound, s.repsAccessory, s.stallSessions, s.deloadPct], [0, 'kg', '5-8', '8-12', 3, 10])
  assert.equal(parseSetting('bodyweightKg', '70', {}), 70)
  assert.equal(parseSetting('liftUnit', 'lbs', {}), 'lbs')
  assert.equal(parseSetting('deloadPct', '50', {}), null, 'too much')
  assert.equal(gymPrefs({ bodyweightKg: 70 }).bodyweightKg, 70)
})

test('the catalogue: every exercise has muscles and a pattern; his own exercises join it (planning.gymExercises)', () => {
  for (const e of DEFAULT_EXERCISES) {
    assert.ok(e.primary.length, `${e.name} trains something`)
    assert.ok(['push', 'pull', 'legs', 'core'].includes(e.pattern))
  }
  const keys = DEFAULT_EXERCISES.map((e) => e.key)
  assert.equal(new Set(keys).size, keys.length, 'one entry per exercise')
  const aliases = DEFAULT_EXERCISES.flatMap((e) => e.aliases)
  assert.equal(new Set(aliases).size, aliases.length, 'no alias means two exercises')
  const mine = exerciseCatalogue({ gymExercises: [{ name: 'Zercher squat', muscles: 'quads, glutes', aliases: 'zercher' }, { name: 'Bench press', aliases: 'flat' }] })
  const z = findExercise('zercher', mine)
  assert.deepEqual([z.key, z.primary, z.pattern, z.lower], ['zercher squat', ['quads', 'glutes'], 'legs', true])
  assert.equal(findExercise('flat', mine).key, 'bench press', 'an alias added to a default one')
  assert.equal(volumeOf([lift('zercher squat', d(0), 60, 8, 3)], MON, d(6), mine).muscles.quads, 3)
})

// ---------------------------------------------------------------------------
// Hevy CSV import
// ---------------------------------------------------------------------------

const HEADER = '"title","start_time","end_time","description","exercise_title","superset_id","exercise_notes","set_index","set_type","weight_kg","reps","distance_km","duration_seconds","rpe"'
const HEVY = [HEADER,
  '"Upper A","19 Oct 2026, 18:05","19 Oct 2026, 19:30","Felt good, strong","Bench Press (Barbell)",,"Paused, ""tight"" arch",0,"warmup",40,10,,,',
  '"Upper A","19 Oct 2026, 18:05","19 Oct 2026, 19:30","Felt good, strong","Bench Press (Barbell)",,"Paused, ""tight"" arch",1,"normal",80,5,,,8',
  '"Upper A","19 Oct 2026, 18:05","19 Oct 2026, 19:30","Felt good, strong","Bench Press (Barbell)",,"Paused, ""tight"" arch",2,"normal",80,5,,,',
  '"Upper A","19 Oct 2026, 18:05","19 Oct 2026, 19:30","Felt good, strong","Bench Press (Barbell)",,"Paused, ""tight"" arch",3,"failure",80,4,,,9.5',
  '"Upper A","19 Oct 2026, 18:05","19 Oct 2026, 19:30","Felt good, strong","Pull Up",,,0,"normal",,8,,,',
  '"Upper A","19 Oct 2026, 18:05","19 Oct 2026, 19:30","Felt good, strong","Incline Bench Press (Dumbbell)",,"multi',
  'line note",0,"normal",30,10,,,',
  '"Upper A","19 Oct 2026, 18:05","19 Oct 2026, 19:30","Felt good, strong","Treadmill",,,0,"normal",,,2.1,900,',
  '"Legs","17 Oct 2026, 10:00","17 Oct 2026, 11:10","","Squat (Barbell)",,,0,"normal",100,5,,,',
  '"Legs","17 Oct 2026, 10:00","17 Oct 2026, 11:10","","Romanian Deadlift (Barbell)",,,0,"normal",90,8,,,',
  '"Legs","17 Oct 2026, 10:00","17 Oct 2026, 11:10","","Zercher Squat",,,0,"normal",60,8,,,',
  '"Legs","not a date","17 Oct 2026, 11:10","","Squat (Barbell)",,,1,"normal",100,5,,,',
].join('\r\n')

test('CSV: quotes, commas and line breaks inside quotes, doubled quotes, CRLF, a BOM, empty fields', () => {
  const t = parseCsv(`﻿a,b,c\r\n"x, y","he said ""hi""",\r\n"multi\nline",2,3\n`)
  assert.deepEqual(t, [['a', 'b', 'c'], ['x, y', 'he said "hi"', ''], ['multi\nline', '2', '3']])
  assert.deepEqual(parseCsv(''), [])
})

test('Hevy times and exercise names', () => {
  assert.deepEqual(hevyTime('19 Oct 2026, 18:05'), { date: '2026-10-19', time: '18:05' })
  assert.deepEqual(hevyTime('2026-10-19 18:05:00'), { date: '2026-10-19', time: '18:05' })
  assert.deepEqual(hevyTime('Oct 19, 2026, 6:05 PM'), { date: '2026-10-19', time: '18:05' })
  assert.deepEqual(hevyTime('19/10/2026 07:30'), { date: '2026-10-19', time: '07:30' })
  assert.equal(hevyTime('31 Feb 2026, 10:00'), null)
  assert.equal(hevyTime('soon'), null)
  const k = (t) => hevyExercise(t)?.key ?? null
  assert.equal(k('Bench Press (Barbell)'), 'bench press')
  assert.equal(k('Incline Bench Press (Dumbbell)'), 'incline dumbbell press')
  assert.equal(k('Bench Press (Dumbbell)'), 'dumbbell bench press')
  assert.equal(k('Squat (Barbell)'), 'squat')
  assert.equal(k('Pull Up'), 'pull ups')
  assert.equal(k('Lat Pulldown (Cable)'), 'lat pulldown')
  assert.equal(k('Romanian Deadlift (Barbell)'), 'romanian deadlift')
  assert.equal(k('Seated Cable Row - V Grip (Cable)'), 'seated cable row')
  assert.equal(k('Lateral Raise (Dumbbell)'), 'lateral raise')
  assert.equal(k('Triceps Pushdown'), 'tricep pushdown')
  assert.equal(k('Shoulder Press (Dumbbell)'), 'dumbbell shoulder press')
  assert.equal(k('Zercher Squat'), null)
})

test('Hevy import preview: warm-ups and cardio skipped, every set once with its own ref, RPE, notes once, bad rows counted', () => {
  const p = readHevy(HEVY)
  assert.equal(p.problem, null)
  assert.equal(p.workouts, 2)
  assert.equal(p.sets, 8)
  assert.deepEqual(p.skipped, { warmup: 1, notLifts: 1, bad: 1 })
  assert.deepEqual([p.from, p.to], ['2026-10-17', '2026-10-19'])
  assert.deepEqual(p.unknown, ['Zercher Squat'])
  const bench = p.rows.filter((r) => r.exercise_key === 'bench press')
  assert.deepEqual(bench.map((r) => [r.weight_kg, r.reps, r.sets, r.rpe]), [[80, 5, 1, 8], [80, 5, 1, null], [80, 4, 1, 9.5]])
  assert.equal(bench[0].notes, 'Paused, "tight" arch', 'quoted notes, once per exercise')
  assert.equal(bench[1].notes, null)
  assert.equal(bench[0].source_ref, 'hevy|2026-10-19T18:05|0|Bench Press (Barbell)|1')
  assert.equal(new Set(p.rows.map((r) => r.source_ref)).size, p.rows.length, 'one ref per set')
  assert.ok(p.rows.every((r) => r.source === 'hevy' && r.done_on >= '2026-10-17'))
  const pull = p.rows.find((r) => r.exercise_key === 'pull ups')
  assert.equal(pull.weight_kg, 0, 'an empty weight is bodyweight')
  assert.equal(p.rows.find((r) => r.exercise_key === 'incline dumbbell press').notes, 'multi\nline note')
  // the same file twice gives the same refs (so it imports once)
  assert.deepEqual(readHevy(HEVY).rows.map((r) => r.source_ref), p.rows.map((r) => r.source_ref))
})

test('Hevy import: lbs exports, files that are not Hevy, too big', () => {
  const lbs = readHevy([HEADER.replace('weight_kg', 'weight_lbs'), '"A","19 Oct 2026, 18:05","","","Bench Press (Barbell)",,,0,"normal",135,5,,,'].join('\n'))
  assert.equal(lbs.rows[0].weight_kg, 61.23)
  assert.match(readHevy('date,score\n2026-10-19,5').problem, /doesn’t look like a Hevy export \(missing title, start_time, exercise_title, set_index, set_type, reps, weight_kg\)/)
  assert.match(readHevy('x'.repeat(MAX_BYTES + 1)).problem, /too big/)
  assert.match(readHevy('').problem, /empty/)
})

// ---------------------------------------------------------------------------
// /gym, "how's my squat going?", the brain's snapshot, /owen's free slots
// ---------------------------------------------------------------------------

const WEEK = [lift('bench press', d(-7), 77.5, 5, 3), lift('bench press', d(0), 80, 5, 3), lift('overhead press', d(0), 50, 6, 2), lift('overhead press', d(0), 50, 5, 1),
  lift('squat', d(-5), 100, 5, 5), lift('squat', d(2), 102.5, 5, 5)].map((r, i) => ({ ...r, id: `00000000-0000-0000-0000-00000000000${i}` }))

test('/gym: this week’s sessions, PRs, sets per muscle group, the balance check and next sessions', () => {
  const html = gymWeekHtml(WEEK, d(3))
  assert.match(html, /🏋️ <b>Gym this week<\/b> · Mon 19 Oct – Sun 25 Oct/)
  assert.match(html, /<b>Mon 19 Oct<\/b>: Bench press 80 kg × 5 × 3 · Overhead press 50 kg × 6, 6, 5/)
  assert.match(html, /<b>Wed 21 Oct<\/b>: Squat 102.5 kg × 5 × 5/)
  assert.match(html, /🏆 Bench press e1RM 93.3 kg \(was 90.4\) <i>\(Mon 19 Oct\)<\/i>/)
  assert.match(html, /🏆 Squat e1RM 119.6 kg \(was 116.7\)/)
  assert.match(html, /💪 Sets: chest 3 · shoulders 4.5 · triceps 3 · quads 5 · glutes 2.5 · core 2.5/)
  assert.match(html, /⚖️ Pull is behind push \(0 sets vs 6 sets\)/)
  assert.match(html, /• Squat: 102.5 kg × 6 × 5 \(\+1 rep\)/)
  assert.match(html, /• Bench press: 80 kg × 6 × 3 \(\+1 rep\)/)
  assert.match(gymWeekHtml([], MON), /No lifts logged yet/)
  assert.match(gymWeekHtml(WEEK, d(9)), /No lifts logged this week yet\.[\s\S]*Next sessions/)
  assert.match(gymWeekHtml([], MON, undefined, undefined, { missing: true }), /run <b>supabase\/gym.sql<\/b>/)
})

test('"how’s my squat going?": best, trend, last and next; nothing logged; bodyweight hint', () => {
  const html = exerciseHtml(WEEK, ex('squat'), d(3))
  assert.match(html, /📈 <b>Squat<\/b>\nBest: e1RM <b>119.6 kg<\/b> — 102.5 kg × 5 × 5 \(Wed 21 Oct\) 🏆 this week/)
  assert.match(html, /Last 2 sessions \(e1RM\): 116.7 → 119.6 kg <i>\(\+2.5% since Wed 14 Oct\)<\/i>/)
  assert.match(html, /➡️ Next: 102.5 kg × 6 × 5 \(\+1 rep\)/)
  assert.match(exerciseHtml([], ex('rdl'), MON), /No romanian deadlift logged yet/)
  assert.match(exerciseHtml([lift('pull ups', MON, 0, 8, 3)], ex('pull ups'), MON), /bodyweight/)
})

test('the brain’s snapshot: recent lifts with LF refs, bests with trends and next sessions, this week', () => {
  const recent = [...WEEK].reverse()
  const s = gymSnapshot(WEEK, recent, d(3))
  assert.equal(s.sections.length, 3)
  assert.match(s.sections[0].lines[0], /^LF1 \| Wed 21 Oct \| Squat 102.5 kg × 5 × 5 \| e1RM 119.6 kg$/)
  assert.deepEqual(s.refs[0], ['LF1', { kind: 'lift', id: WEEK[5].id, title: 'Squat 102.5 kg × 5 × 5 (Wed 21 Oct)', status: null, deadline: null }])
  assert.match(s.sections[1].lines.join('\n'), /Bench press: best e1RM 93.3 kg \(80 kg × 5 × 3, Mon 19 Oct\) · 2 sessions, last Mon 19 Oct · \+3.2% over ~4 weeks · next 80 kg × 6 × 3 \(\+1 rep\)/)
  assert.match(s.sections[2].lines.join('\n'), /Balance: Pull is behind push/)
  assert.match(s.sections[2].lines.join('\n'), /PRs in the last 4 weeks: .*Bench press e1RM 93.3 kg \(was 90.4\) on Mon 19 Oct/)
  assert.deepEqual(gymSnapshot([], [], MON).sections[0].lines, ['No lifts logged yet.'])
  assert.match(gymSnapshot([], [], MON, undefined, undefined, true).sections[0].lines[0], /gym.sql/)
})

test('/owen free slots: his other sessions and their travel (plus a buffer) come out; long-enough gaps only, by the heavy cut-off', () => {
  const rooms = [{ date: d(1), slots: [{ start: '16:10', end: '22:00' }] }, { date: d(3), slots: [{ start: '16:10', end: '17:20' }, { start: '18:40', end: '22:00' }] }, { date: d(4), slots: [{ start: '16:10', end: '16:40' }] }]
  const busy = [{ date: d(1), start: '18:00', end: '19:00', before: 20, after: 20 }]
  const free = owenSlots(rooms, busy, { min: 45, until: '21:30', buffer: 10 })
  assert.deepEqual(free, [
    { date: d(1), slots: [{ start: '16:10', end: '17:30' }, { start: '19:30', end: '21:30' }] },
    { date: d(3), slots: [{ start: '16:10', end: '17:20' }, { start: '18:40', end: '21:30' }] },
  ])
  assert.equal(slotsWords(free), 'Tue 16:10–17:30, 19:30–21:30 · Thu 16:10–17:20, 18:40–21:30')
  // school days start from his training time; game days are left out; at most two (the longest) a day
  const more = owenSlots([{ date: d(0), slots: [{ start: '07:15', end: '08:35' }, { start: '16:10', end: '19:50' }] }, { date: d(5), slots: [{ start: '08:30', end: '10:00' }, { start: '11:00', end: '12:00' }, { start: '13:00', end: '18:00' }] }, { date: d(6), slots: [{ start: '16:10', end: '21:30' }] }],
    [], { min: 60, until: '21:30', buffer: 10, from: (x) => (x === d(0) ? '15:00' : null), skip: new Set([d(6)]) })
  assert.equal(slotsWords(more), 'Mon 16:10–19:50 · Sat 08:30–10:00, 13:00–18:00')
})

// ---------------------------------------------------------------------------
// Training spacing on a realistic week (the real optimiser; his rules as data)
// ---------------------------------------------------------------------------

const ev = (o) => ({ id: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null, start_time: null, end_time: null,
  repeat_from: '2026-09-01', repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, external_source: 'manual', ...o })
// His week as he described it (19 Oct): school Mon–Fri, club football Mon + Wed evenings, Tue school football then Owen,
// the game on Sunday (his usual game day, a setting), tutors after school.
const NAT = [
  ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', is_school: true }),
  ev({ title: 'CS tutor', repeat_days: [4], start_time: '17:30', end_time: '18:30' }),
  ev({ title: 'Maths tutor', repeat_days: [3], start_time: '17:00', end_time: '18:00' }),
  ev({ title: 'Club 360 football', repeat_days: [1], start_time: '20:00', end_time: '21:45', training_type: 'football', load: 'hard' }),
  ev({ title: 'School football', repeat_days: [2], start_time: '16:15', end_time: '17:30', training_type: 'football', load: 'hard' }),
  ev({ title: 'Club 360 football (Wed)', repeat_days: [3], start_time: '19:45', end_time: '21:30', training_type: 'football', load: 'hard' }),
]
// his set-up: Owen's days and his own fixed days (owen_days "speed=tue; heavy_lower=thu; upper=mon, sat 09:30")
const SETUP = { owenDays: { speed: [2], heavy_lower: [4], upper: [1, 6] }, sessionTimes: { upper: { 6: '09:30' } } }

function world(planning = SETUP, extra = []) {
  const evs = planningEvents([...NAT, ...extra], [], planning, addDays(MON, -7), addDays(MON, 13))
  const shapes = shapesFor(planning, evs, [], [], addDays(MON, -1), addDays(MON, 7))
  const settings = { ...planningSettings(planning), dayBounds: (x) => { const s = shapes.get(x); return s ? { start: s.morningEnd, end: s.nightStart } : null } }
  return {
    today: MON, nowMin: 7 * 60, from: MON, to: d(6), settings, events: evs, changes: [], targets: [], logs: [], weekCounts: [],
    rules: DEFAULT_RULES, energy: new Map(), planned: [], travel: null, types: DEFAULT_TYPES, trainingFrom: '15:00', costs: [], load: moreSettings(planning), planning,
    mental: mentalDays({ from: addDays(MON, -1), to: d(6), planning, events: evs, changes: [], goals: [], tasks: [], blocks: [] }), done: [],
  }
}
const busyOn = (w, date) => expandEvents(w.events, date, date, w.changes).filter((o) => o.date === date && !o.cancelled && o.event.is_busy && o.start)
const uppers = (p) => p.placed.filter((s) => s.type === 'upper')

test('his rules are data: the defaults match what he said (19 Oct), each still changeable by chat', () => {
  const upper = DEFAULT_SESSIONS.find((s) => s.key === 'upper')
  assert.deepEqual([upper.perWeek, upper.maxPerWeek, upper.intensity, upper.noLighter, upper.places[0]], [2, undefined, 'heavy', true, 'puregym'], 'upper 2× a week, heavy, PureGym first')
  assert.deepEqual([GUESS_MINUTES.upper, sessionMinutes(upper)], [90, { minutes: 90, guess: true }], '~90 min, still marked as a guess')
  const gap = DEFAULT_RULES[0]
  assert.deepEqual([gap.what, gap.near, gap.minLoad], [['lower'], ['sprint', 'match'], 'moderate'], 'no heavy lower the day before a game; light is fine')
  assert.deepEqual([DEFAULT_RULES[4].what, DEFAULT_RULES[4].minLoad], [['plyo'], undefined], 'plyo off the day before at any intensity')
  assert.ok(DEFAULT_RULES[2].pairs.some(([a, b]) => a === 'sprint' && b === 'football'), 'Tue school football then Owen is fine')
  const s = moreSettings({})
  assert.deepEqual([s.footballDays, s.gameDay], ['monday, wednesday', 'sunday'], 'club football Mon/Wed, games on Sunday (settings)')
  assert.equal(gameFor(MON, {}).date, d(6))
  // by chat (each a normal ✅ change)
  assert.deepEqual(owenChange('upper=mon, sat 09:30', {}).change.patch.owenDays, { upper: [1, 6] })
  assert.deepEqual(owenChange('speed=tue; heavy_lower=thu', SETUP).change.patch.owenDays, { speed: [2], heavy_lower: [4], upper: [1, 6] }, 'Owen’s days kept with his own')
  assert.equal(sessionChange('session=Upper; minutes=75', {}).change.patch.sessionTypes.find((x) => x.key === 'upper').minutes, 75)
  assert.equal(sessionChange('session=Upper; perWeek=2-3', {}).change.patch.sessionTypes.find((x) => x.key === 'upper').maxPerWeek, 3, 'back to 2–3 if he wants')
  assert.equal(parseSetting('gameDay', 'saturday', {}), 'saturday')
  assert.equal(parseSetting('footballDays', 'monday, wednesday', {}), 'monday, wednesday')
  const row = ruleToRow({ ...DEFAULT_RULES[0], minLoad: 'hard' }, 0)
  assert.equal(ruleFromRow({ id: 'r', ...row }).minLoad, 'hard', '“only heavy lower is off the day before” round-trips as a saved rule')
})

test('spacing: upper 2× — Monday PureGym straight after school and Saturday 09:30, ~90 min, heavy', () => {
  const w = world()
  const p = planTraining(w)
  if (process.env.SHOW) console.log(p.placed.map((s) => `${s.date} ${s.start}-${s.end} ${s.title} @ ${s.label} ${s.intensity} | ${s.why}`).join('\n'), p.tbc)
  const u = uppers(p)
  assert.equal(u.length, 2, 'upper twice')
  assert.deepEqual(u.map((s) => s.date), [d(0), d(5)], 'Mon and Sat')
  assert.ok(u.every((s) => s.place === 'puregym' && s.intensity === 'heavy'), 'PureGym, heavy')
  assert.ok(u.every((s) => minutesOf(s.end) - minutesOf(s.start) === 90), '~90 min')
  assert.equal(u[0].from, 'school', 'Monday: straight after school')
  assert.equal(u[1].start, '09:30', 'Saturday at his time')
  assert.deepEqual(p.tbc, [], 'nothing left out')
  assert.equal(p.upper.count, 2)
})

test('spacing: Owen’s days kept (speed Tue after school football, heavy lower Thu) and football days respected', () => {
  const w = world()
  const p = planTraining(w)
  const speed = p.placed.find((s) => s.key.startsWith('speed#')), lower = p.placed.find((s) => s.key.startsWith('heavy_lower#'))
  assert.equal(speed.date, d(1), 'speed on Owen’s day (Tue)')
  assert.ok(minutesOf(speed.start) >= minutesOf('17:30'), 'after school football')
  assert.equal(lower.date, d(3), 'heavy lower on Owen’s day (Thu)')
  assert.equal(lower.intensity, 'heavy')
  // football is fixed load the week is built around: on its days, never clashed with (travel and buffer included)
  const football = fixedLoad(w).filter((f) => f.type === 'football' && f.date >= MON && f.date <= d(6))
  assert.deepEqual(football.map((f) => isoDow(f.date)), [1, 2, 3], 'club Mon + Wed, school Tue')
  for (const s of p.placed) {
    const a = minutesOf(s.start) - (s.before ?? 0), b = minutesOf(s.end) + (s.after ?? 0)
    for (const o of busyOn(w, s.date)) {
      const x = minutesOf(o.start) - w.settings.bufferMin, y = minutesOf(o.end ?? o.start) + w.settings.bufferMin
      assert.ok(b <= x || a >= y, `${s.title} ${s.date} ${s.start}–${s.end} clashes with ${o.event.title}`)
    }
  }
  // the optimiser's own Owen days (none saved): speed still not back to back with heavy lower, nothing heavy on game day
  const free = planTraining(world({}))
  const fs = free.placed.find((s) => s.key.startsWith('speed#')), fl = free.placed.find((s) => s.key.startsWith('heavy_lower#'))
  assert.ok(Math.abs(Date.parse(fs.date) - Date.parse(fl.date)) / 86_400_000 >= 2, 'heavy lower and speed apart')
  assert.ok(!free.placed.some((s) => s.date === d(6) && s.intensity !== 'light'), 'nothing hard on game day')
})

test('spacing: no heavy lower or plyo the day before a game; light lower is allowed then', () => {
  // the rule as data: heavy (or moderate) lower the day before the match breaks it, light doesn't
  const sat = d(5), sun = d(6)
  const match = { date: sun, start: '10:00', type: 'match', load: 'hard', title: 'Game', fixed: true, key: 'game' }
  const at = (load, type = 'lower') => [{ date: sat, start: '15:00', type, load, title: 'Lower', fixed: false, key: 'l' }, match]
  assert.equal(ruleProblems(at('hard'), DEFAULT_RULES).filter((x) => x.rule === DEFAULT_RULES[0].label).length, 1)
  assert.equal(ruleProblems(at('moderate'), DEFAULT_RULES).filter((x) => x.rule === DEFAULT_RULES[0].label).length, 1)
  assert.equal(ruleProblems(at('hard', 'plyo'), DEFAULT_RULES).filter((x) => x.rule === DEFAULT_RULES[4].label).length, 1)
  assert.deepEqual(ruleProblems(at('light'), DEFAULT_RULES), [], 'light lower the day before a game: fine')
  // the real optimiser: left to itself, heavy lower is never Saturday (the Sunday game)
  const w = world({ owenDays: { speed: [2], upper: [1, 6] }, sessionTimes: { upper: { 6: '09:30' } } })
  const p = planTraining(w)
  const lower = p.placed.find((s) => s.key.startsWith('heavy_lower#'))
  assert.ok(lower && !(lower.date === sat && lower.intensity !== 'light'), `no heavy lower the day before the game (${lower?.date} ${lower?.intensity})`)
  assert.ok(!p.placed.some((s) => s.date === sat && ['lower', 'plyo'].includes(s.type) && s.intensity !== 'light'))
  // he puts lower on Saturday himself: it goes light (allowed), with the reason, not left out
  const pinned = planTraining(w, { pins: new Map([['heavy_lower#1', { date: sat }]]) })
  const l2 = pinned.placed.find((s) => s.key.startsWith('heavy_lower#'))
  assert.equal(l2.date, sat)
  assert.equal(l2.intensity, 'light')
  assert.match(l2.why, /light, not heavy: the day before Game \(Sun\)/)
  const ow = optWorldOf(w, [])
  const { issues } = assess([...ow.fixed, ...pinned.placed], ow)
  assert.ok(!issues.some((i) => i.keys.includes(l2.key) && /day before|no lower or plyo/i.test(i.text)), issues.map((i) => i.text).join(' | '))
})

// reviewer probes (busy weeks, a game on Friday)
const busy = (title, dow, start, end) => ev({ title, repeat_days: [dow], start_time: start, end_time: end })
const show = (p) => { if (process.env.SHOW) console.log(p.placed.map((s) => `${s.date} ${s.start}-${s.end} ${s.title} ${s.intensity} | ${s.why}`).join('\n'), p.tbc) }
const at = (s) => Date.parse(`${s.date}T${s.start}:00Z`)

test('spacing, busy week: Owen’s sessions cost more to leave out than his own fixed-day uppers', () => {
  const planning = { owenDays: { speed: [6], heavy_lower: [5], injury: [5], core: [5], upper: [1, 6] } }
  const p = planTraining(world(planning, [busy('Busy Mon', 1, '16:00', '19:55'), busy('Busy Sat', 6, '08:00', '20:00')]))
  show(p)
  assert.ok(p.placed.some((s) => s.key.startsWith('speed#')), `Owen’s speed session is kept (tbc: ${p.tbc.map((t) => t.title).join(', ')})`)
  assert.ok(!p.tbc.some((t) => /Speed|Heavy lower/.test(t.title)))
  const u = uppers(p).sort((a, b) => at(a) - at(b))
  for (let i = 1; i < u.length; i++) assert.ok(at(u[i]) - at(u[i - 1]) >= 48 * 3_600_000, 'uppers ≥ 48 h apart')
})

test('spacing: never two uppers less than 48 h apart (one is left out instead)', () => {
  const p = planTraining(world({ owenDays: { speed: [2], heavy_lower: [6], upper: [1, 6] } }))
  show(p)
  const u = uppers(p).sort((a, b) => at(a) - at(b))
  for (let i = 1; i < u.length; i++) assert.ok(at(u[i]) - at(u[i - 1]) >= 48 * 3_600_000, `${u[i - 1].date} ${u[i - 1].start} and ${u[i].date} ${u[i].start}`)
  assert.ok(!p.placed.some((s) => / only \d+ h after Upper/.test(s.why)))
  assert.equal(p.upper.count, u.length)
})

test('spacing, a game on Friday: Owen’s days stay (speed Tue, heavy lower Thu goes lighter rather than moving)', () => {
  const p = planTraining(world({ ...SETUP, gameDay: 'friday' }))
  show(p)
  const speed = p.placed.find((s) => s.key.startsWith('speed#')), lower = p.placed.find((s) => s.key.startsWith('heavy_lower#'))
  assert.equal(speed?.date, d(1), 'speed stays on Tuesday')
  assert.equal(lower?.date, d(3), 'heavy lower stays on Thursday')
  assert.equal(lower.intensity, 'light', 'the day before the game: light (allowed), not heavy')
})

// ---------------------------------------------------------------------------
// Reviewer probes: the fast path stays conservative (unsure → null, the brain reads it)
// ---------------------------------------------------------------------------

test('not lifts: unknown words with “AxB” (only his exercises, or a new name with kg/lbs said)', () => {
  for (const m of ['squad meeting 5x5', 'revision 3x30', 'chess club 3x5', 'lunch 12x1', 'meeting 5x5', 'exam 9x3', 'french 5x5', 'bench 80x5x3 and dinner 7x2',
    'deadline 5x5', 'squad 5x5', 'beach 80x5x3', 'bunch 80x5x3', 'lungs 3x10', 'make it 82.5x5x3', 'no 85x5x3', 'change to 85x5x3', 'actually 85x5x3']) {
    assert.equal(parseLifts(m, MON), null, m)
  }
  const own = one('zercher squat 60kg x8x3')
  assert.deepEqual([own.exercise, own.key, own.weightKg], [null, 'zercher squat', 60], 'a new name with kg said is kept')
  assert.equal(findExercise('deadline'), null, 'a real word is not a typo')
  assert.equal(findExercise('squad'), null)
  assert.equal(findExercise('benhc')?.key, 'bench press', 'a swapped pair still is')
})

test('sets × reps with no weight on a weighted exercise asks how much (“squat 5x5”, “bench 3x10”), never 5 kg × 5', () => {
  assert.deepEqual(parseLifts('squat 5x5', MON), { kind: 'vague', exercises: [ex('squat')], weight: null })
  assert.deepEqual(parseLifts('bench 3x10', MON), { kind: 'vague', exercises: [ex('bench')], weight: null })
  assert.equal(parseLifts('bench 80x5x3 and squat 5x5', MON), null, 'part of a message: the brain reads it')
  assert.equal(one('bench 20kg x 10').weightKg, 20, 'kg said: a light set is fine')
  assert.equal(one('bench 20x10x3').weightKg, 20, 'three numbers: weight × reps × sets')
  assert.deepEqual(one('pull ups 3x8').reps, [8, 8, 8], 'bodyweight moves: sets × reps')
})

test('deloads: after one, build back up — never a second deload in a row (80 → 72.5 → 75 → 77.5 → 80)', () => {
  const bench = ex('bench')
  const L = [lift('bench press', d(-21), 80, 6, 3), lift('bench press', d(-14), 80, 6, 3), lift('bench press', d(-7), 80, 5, 3), lift('bench press', d(0), 80, 6, 3)]
  const de = nextFor(L, 'bench press', bench)
  assert.equal(de.kind, 'deload')
  let lifts = [...L], day = 1
  const seen = []
  for (let i = 0; i < 4; i++) {
    const n = nextFor(lifts, 'bench press', bench)
    seen.push(`${n.kind} ${n.weight}`)
    lifts = [...lifts, lift('bench press', d(day++ * 7), n.weight, n.reps, n.sets)]
  }
  assert.deepEqual(seen, ['deload 72.5', 'weight 75', 'weight 77.5', 'weight 80'], 'then back to his best weight')
  assert.notEqual(nextFor(lifts, 'bench press', bench).kind, 'deload', 'back at 80: progressing again, not another deload')
  assert.match(nextFor([...L, lift('bench press', d(7), 72.5, 6, 3)], 'bench press', bench).text, /building back up after the deload: \+2.5 kg/)
  // bodyweight: fewer sets was the deload; the sets come back
  const dips = [d(-21), d(-14), d(-7), d(0)].map((x) => lift('dips', x, 0, 12, 3))
  const after = [...dips, lift('dips', d(7), 0, 12, 2)]
  const back = nextFor(after, 'dips', ex('dips'))
  assert.deepEqual([back.sets, back.kind], [3, 'reps'])
})

test('Hevy: assisted rows are not lifts; refs use start time, the block’s place and the set (an exercise twice, a renamed workout)', () => {
  const rows = [HEADER,
    '"Upper","19 Oct 2026, 18:05","","","Bench Press (Barbell)",,,0,"normal",80,5,,,',
    '"Upper","19 Oct 2026, 18:05","","","Pull Up (Assisted)",,,0,"normal",20,8,,,',
    '"Upper","19 Oct 2026, 18:05","","","Lat Pulldown (Cable)",,,0,"normal",50,10,,,',
    '"Upper","19 Oct 2026, 18:05","","","Bench Press (Barbell)",,,0,"normal",70,8,,,',
  ]
  const p = readHevy(rows.join('\n'))
  assert.equal(p.skipped.notLifts, 1, 'assisted pull-ups skipped (help, not load)')
  assert.deepEqual(p.rows.map((r) => r.source_ref), ['hevy|2026-10-19T18:05|0|Bench Press (Barbell)|0', 'hevy|2026-10-19T18:05|2|Lat Pulldown (Cable)|0', 'hevy|2026-10-19T18:05|3|Bench Press (Barbell)|0'])
  const renamed = readHevy(rows.map((r) => r.replace('"Upper"', '"Push day"')).join('\n'))
  assert.deepEqual(renamed.rows.map((r) => r.source_ref), p.rows.map((r) => r.source_ref), 'renaming the workout in Hevy imports nothing again')
})

test('the upload cap is counted while reading (no content-length needed)', async () => {
  const { readCapped } = await import('../lib/gym/hevy.ts')
  const big = new Request('http://x/', { method: 'POST', body: new ReadableStream({ start(c) { for (let i = 0; i < 30; i++) c.enqueue(new Uint8Array(100_000)); c.close() } }), duplex: 'half' })
  assert.equal(await readCapped(big, 2_400_000), null, 'refused once past the cap')
  assert.equal(await readCapped(new Request('http://x/', { method: 'POST', body: '{"csv":"a"}' }), 2_400_000), '{"csv":"a"}')
})

test('an import that fails part-way says how much was saved', async () => {
  const { importLifts } = await import('../lib/gym/data.ts')
  let inserts = 0
  const chain = (result) => { const c = { select: () => c, not: () => c, order: () => c, range: () => Promise.resolve(result), in: () => c, then: (f, r) => Promise.resolve(result).then(f, r) }; return c }
  const sb = { from: () => ({
    select: () => chain({ data: [], error: null }),
    insert: (rows) => ({ select: () => Promise.resolve(++inserts === 1 ? { data: rows.map((_, i) => ({ id: `id${i}` })), error: null } : { data: null, error: { message: 'timeout', code: '57014' } }) }),
  }) }
  const rows = Array.from({ length: 700 }, (_, i) => ({ done_on: MON, exercise: 'Bench', exercise_key: 'bench press', weight_kg: 80, reps: 5, sets: 1, rpe: null, source: 'hevy', source_ref: `r${i}`, notes: null }))
  await assert.rejects(importLifts(sb, rows), /^Error: Saved 500 of 700 sets, then stopped: timeout\. Choose the file again to add the rest \(nothing is added twice\)\.$/)
})

test('light plyo is still kept off the day before a game (only lower got lighter)', () => {
  const sat = d(5), sun = d(6)
  const match = { date: sun, start: '10:00', type: 'match', load: 'hard', title: 'Game', fixed: true, key: 'game' }
  const plyo = { date: sat, start: '15:00', type: 'plyo', load: 'light', title: 'Plyo', fixed: false, key: 'p' }
  assert.equal(ruleProblems([plyo, match], DEFAULT_RULES).length, 1)
  assert.match(ruleProblems([plyo, match], DEFAULT_RULES)[0].rule, /No plyo the day before/)
  assert.deepEqual(ruleProblems([{ ...plyo, type: 'lower' }, match], DEFAULT_RULES), [], 'light lower: fine')
})
