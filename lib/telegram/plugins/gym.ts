// Item 6: training and gym progress — lifts by chat (one message per exercise, one ✅), estimated 1RM (Epley), PR
// alerts, weekly sets per muscle group with an upper-body balance check, the next session's suggestion, /gym, /owen,
// and the brain's view of all of it. A bot plug-in (lib/telegram/plugin-types.ts, plans/contracts.md §2, §9).
// Changes: lift_log (new lifts), lift_edit (one saved lift), lift_archive (remove one: archived, never deleted).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BotPlugin, CheckEnv, CommandEnv, CommandResult, FastResult, PluginAction, PluginRawAction } from '../plugin-types'
import { addDays, dowShort, isoDow, shortDate } from '../../time'
import { exerciseCatalogue, exerciseOf, findExercise, keyOf } from '../../gym/catalogue'
import { LB, liftValue, parseLifts } from '../../gym/parse'
import { groupReps, kgText, logLine, nextFor, prOf, prShort, setsText } from '../../gym/progress'
import { gymPrefs } from '../../gym/settings'
import { COLS, RUN_SQL, archiveLifts, asLift, insertLifts, isMissing, loadLifts, recentLifts } from '../../gym/data'
import { esc, exerciseHtml, gymSnapshot, gymWeekHtml } from '../../gym/summary'
import { owenSlots, slotsWords } from '../../gym/owen'
import type { Exercise, LiftRow, NewLift } from '../../gym/types'

const OPS = ['lift_log', 'lift_edit', 'lift_archive'] as const
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const kvOf = (v: string) => Object.fromEntries((v ?? '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? [x.trim().toLowerCase(), ''] : [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()] }).filter((x) => x[0])) as Record<string, string | undefined>
const yes = (v?: string) => /^(yes|true|y|on)$/i.test(v ?? '')
const r2 = (n: number) => Math.round(n * 100) / 100
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
const NAME_OK = /^[a-z][a-z0-9' -]{1,40}$/i

async function planningOf(sb: SupabaseClient): Promise<unknown> {
  const { data, error } = await sb.from('profiles').select('planning').maybeSingle()
  return error ? null : data?.planning ?? null
}

type Rows = { planning: unknown; history: LiftRow[]; recent: LiftRow[]; missing: boolean }

/** The lift a change points at: a snapshot ref (LF…), or "lift:<id>" from a fast path. */
function targetOf(raw: PluginRawAction, env: CheckEnv, rows: Rows): LiftRow | null {
  const id = env.ref?.kind === 'lift' ? env.ref.id : (raw.ref ?? '').match(/^lift:([0-9a-f-]{36})$/i)?.[1] ?? null
  return id ? rows.recent.find((r) => r.id === id) ?? null : null
}

/** A lift's weight, unit, reps and sets from a change's value; a problem in words otherwise. */
function amounts(kv: Record<string, string | undefined>, ex: Exercise, unitDefault: 'kg' | 'lbs', opts: { needWeight: boolean }): { weight?: number; reps?: number[]; rpe?: number | null; problem?: string } {
  const unit = /^lb|^pound/i.test(kv.unit ?? '') ? 'lbs' : /^kg|^kilo/i.test(kv.unit ?? '') ? 'kg' : unitDefault
  const bw = yes(kv.bw) || !!ex.bodyweight
  let weight: number | undefined
  if (kv.weight !== undefined && kv.weight !== '') {
    const w = Number(kv.weight.replace(/\s*(kg|kgs|lbs?)$/i, ''))
    if (!Number.isFinite(w) || w < 0) return { problem: `“${kv.weight}” isn’t a weight` }
    weight = unit === 'lbs' ? r2(w * LB) : r2(w)
    if (weight > 500) return { problem: `${kgText(weight)} for ${ex.name.toLowerCase()} looks wrong` }
  } else if (opts.needWeight) {
    if (!bw) return { problem: `how much weight for ${ex.name.toLowerCase()}? (e.g. “${ex.aliases[0] ?? ex.name.toLowerCase()} 80x5x3”)` }
    weight = 0
  }
  let reps: number[] | undefined
  if (kv.reps !== undefined && kv.reps !== '') {
    reps = kv.reps.split(/[\s,/]+/).filter(Boolean).map(Number)
    if (!reps.length || reps.some((r) => !Number.isInteger(r) || r < 1 || r > 100)) return { problem: `“${kv.reps}” isn’t a number of reps` }
    const sets = kv.sets !== undefined && kv.sets !== '' ? Number(kv.sets) : null
    if (sets != null) {
      if (!Number.isInteger(sets) || sets < 1 || sets > 20) return { problem: `“${kv.sets}” isn’t a number of sets (1–20)` }
      if (reps.length === 1) reps = Array.from({ length: sets }, () => reps![0])
    }
    if (reps.length > 20) return { problem: 'that’s more than 20 sets' }
  }
  let rpe: number | null | undefined
  if (kv.rpe) { const n = Number(kv.rpe); rpe = Number.isFinite(n) && n >= 1 && n <= 10 ? Math.round(n * 2) / 2 : null }
  return { weight, reps, rpe }
}

/** The day a lift was done: today unless his words said another day (never the future, at most ~3 months back). */
function dayFor(raw: PluginRawAction, env: CheckEnv): { date?: string; problem?: string } {
  const d = (raw.date ?? '').trim()
  if (!d || d === env.today) return { date: env.today }
  if (!isDate(d)) return { problem: `“${d}” isn’t a day` }
  if (d > env.today) return { problem: 'that day hasn’t happened yet' }
  if (d < addDays(env.today, -92)) return { problem: 'that’s more than 3 months ago (import it from Hevy instead)' }
  if (!env.grounded(raw.words ?? '')) return { problem: 'which day was it? (the day wasn’t in your words)' }
  return { date: d }
}

function checkLog(raw: PluginRawAction, rows: Rows, env: CheckEnv): { action?: PluginAction; problem?: string } {
  if (rows.missing) return { problem: 'lifts can’t be saved until supabase/gym.sql has run in Supabase' }
  const list = exerciseCatalogue(rows.planning), prefs = gymPrefs(rows.planning)
  const kv = kvOf(raw.value)
  const name = (kv.exercise ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!name) return { problem: 'which exercise?' }
  const found = findExercise(name, list)
  if (!found && !NAME_OK.test(name)) return { problem: `“${name}” isn’t an exercise I know` }
  const ex = found ?? exerciseOf(keyOf(name), list, name)
  const a = amounts(kv, ex, prefs.unit, { needWeight: true })
  if (a.problem) return { problem: a.problem }
  if (!a.reps) return { problem: `how many reps of ${ex.name.toLowerCase()}? (e.g. “${ex.aliases[0] ?? ex.name.toLowerCase()} 80x5x3”)` }
  const when = dayFor(raw, env)
  if (when.problem) return { problem: when.problem }
  const date = when.date!
  const lifts: NewLift[] = groupReps(a.reps).map((g) => ({ done_on: date, exercise: name, exercise_key: ex.key, weight_kg: a.weight!, reps: g.reps, sets: g.sets, rpe: a.rpe ?? null, source: 'chat', source_ref: null, notes: null }))
  const before = rows.history.filter((h) => h.exercise_key === ex.key && h.done_on <= date)
  const l = logLine(lifts, ex, before, prefs)
  const extra = [date !== env.today ? `<i>${esc(day(date))}</i>` : '', a.rpe ? `RPE ${a.rpe}` : '', !found ? '<i>(new exercise: no muscle group yet)</i>' : '']
  return { action: { op: 'lift_log', table: 'lift_sets', id: null, title: ex.name,
    line: `🏋️ <b>${esc(ex.name)}</b>${esc(l.text.slice(ex.name.length))}${extra.filter(Boolean).map((x) => ` · ${x}`).join('')}`, patch: { rows: lifts } } }
}

function checkEdit(raw: PluginRawAction, rows: Rows, env: CheckEnv): { action?: PluginAction; problem?: string } {
  if (rows.missing) return { problem: 'lifts can’t be changed until supabase/gym.sql has run in Supabase' }
  const t = targetOf(raw, env, rows)
  if (!t) return { problem: 'couldn’t find that lift' }
  const list = exerciseCatalogue(rows.planning), prefs = gymPrefs(rows.planning)
  const kv = kvOf(raw.value)
  const was = exerciseOf(t.exercise_key, list, t.exercise)
  let ex = was
  const patch: Record<string, unknown> = {}
  if (kv.exercise) {
    const f = findExercise(kv.exercise, list)
    if (!f && !NAME_OK.test(kv.exercise)) return { problem: `“${kv.exercise}” isn’t an exercise I know` }
    ex = f ?? exerciseOf(keyOf(kv.exercise), list, kv.exercise)
    if (ex.key !== t.exercise_key) { patch.exercise_key = ex.key; patch.exercise = kv.exercise.slice(0, 80) }
  }
  const a = amounts(kv, ex, prefs.unit, { needWeight: false })
  if (a.problem) return { problem: a.problem }
  if (a.weight !== undefined && a.weight !== t.weight_kg) patch.weight_kg = a.weight
  if (a.reps) {
    const g = groupReps(a.reps)
    if (g.length > 1) return { problem: 'one rep count per saved lift: change each set count separately' }
    if (g[0].reps !== t.reps) patch.reps = g[0].reps
    if ((kv.sets || a.reps.length > 1) && g[0].sets !== t.sets) patch.sets = g[0].sets
  } else if (kv.sets) {
    const n = Number(kv.sets)
    if (!Number.isInteger(n) || n < 1 || n > 20) return { problem: `“${kv.sets}” isn’t a number of sets (1–20)` }
    if (n !== t.sets) patch.sets = n
  }
  if (a.rpe !== undefined && a.rpe !== t.rpe) patch.rpe = a.rpe
  if (raw.date && raw.date !== t.done_on) {
    const when = dayFor(raw, env)
    if (when.problem) return { problem: when.problem }
    patch.done_on = when.date
  }
  if (!Object.keys(patch).length) return { problem: `nothing to change on ${was.name.toLowerCase()} (${day(t.done_on)})` }
  const now = { ...t, ...patch } as LiftRow
  const line = `✏️ <b>${esc(was.name)}</b> (${esc(day(t.done_on))}): ${esc(setsText([t], was))} → <b>${esc(`${ex.key !== was.key ? `${ex.name} ` : ''}${setsText([now], ex)}`)}</b>${patch.done_on ? ` on ${esc(day(String(patch.done_on)))}` : ''}`
  return { action: { op: 'lift_edit', table: 'lift_sets', id: t.id, title: was.name, line, patch } }
}

function checkArchive(raw: PluginRawAction, rows: Rows, env: CheckEnv): { action?: PluginAction; problem?: string } {
  if (rows.missing) return { problem: 'no lifts saved yet (supabase/gym.sql hasn’t run)' }
  const t = targetOf(raw, env, rows)
  if (!t) return { problem: 'couldn’t find that lift' }
  const ex = exerciseOf(t.exercise_key, exerciseCatalogue(rows.planning), t.exercise)
  return { action: { op: 'lift_archive', table: 'lift_sets', id: t.id, title: ex.name,
    line: `🗑 <b>${esc(ex.name)}</b> ${esc(setsText([t], ex))} (${esc(day(t.done_on))}): removed <i>(kept in the archive)</i>`, patch: { archived_at: '__now__' } } }
}

const FIELDS = ['done_on', 'exercise', 'exercise_key', 'weight_kg', 'reps', 'sets', 'rpe'] as const
const pick = (r: LiftRow) => Object.fromEntries(FIELDS.map((k) => [k, r[k] ?? null])) as Record<string, unknown>
const same = (a: Record<string, unknown>, b: Record<string, unknown>, keys: string[]) => keys.every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null))

async function readLift(sb: SupabaseClient, id: string): Promise<LiftRow | null> {
  const { data, error } = await sb.from('lift_sets').select(COLS).eq('id', id).maybeSingle()
  if (error) throw new Error(isMissing(error) ? RUN_SQL : `Couldn’t read that lift: ${error.message}`)
  return data ? asLift(data as Record<string, unknown>) : null
}

/** "How much?" for "did bench" (no numbers). */
function vagueHtml(exercises: Exercise[], weight: number | null): string {
  const ex = exercises[0]
  const say = ex.aliases[0] && ex.aliases[0].length <= 12 ? ex.aliases[0] : ex.name.toLowerCase()
  if (weight != null) return `💪 ${kgText(weight)} for how many reps and sets? Send it like “${esc(say)} ${weight}x5x3” (kg × reps × sets).`
  const names = exercises.map((e) => e.name.toLowerCase())
  return `💪 Nice. How much${names.length > 1 ? ` (one message per exercise: ${esc(names.join(', '))})` : ''}? Send it like “${esc(say)} 80x5x3” (80 kg × 5 reps × 3 sets) or “${esc(say)} 80 x 6,6,5”.`
}

/** Could this message be about lifting at all (so the planning read is only done when it might be)? */
const MAYBE = /\d|^(?:i\s+)?(?:just\s+)?(?:did|done|finished|hit|smashed|trained|benched|squatted|deadlifted)\b|\bdone[.!]*$|\bhow'?s|\bhow (?:is|are)\b|\bprogress\b|\b(?:pr|prs|1rm|e1rm|max)\b|\bhevy\b|\btrain ?heroic\b|^(?:delete|remove|undo|scrap|bin)\b/i
const GYM_WORDS = /^(?:gym|lifting|lifts|my lifts|training|strength|weights|the gym|my gym)$/

/** Words that correct a card that's waiting ("make it 82.5x5x3", "actually 85"): the card's business, not a new lift. */
const CORRECTION = /^(?:make it|actually|no\b|nope|change|instead|should be|sorry|oops|wait|i meant|not\b)|\b(?:instead|should be|i meant|make it|change (?:it|that) to)\b/i

async function fast(message: string, env: { sb: SupabaseClient; today: string; cardOpen?: boolean }): Promise<FastResult | null> {
  const text = message.trim().replace(/[‘’]/g, "'")
  if (!text || text.startsWith('/') || text.length > 300 || !MAYBE.test(text)) return null
  // things it can't do yet (Hevy is read from its CSV export only; TrainHeroic from a CSV or a photo, not built)
  if (/\b(?:sync|connect|link|hook up|auto[- ]?import|pull)\b.*\bhevy\b|\bhevy\b.*\b(?:sync|api|automatic(?:ally)?|connect(?:ed)?|live)\b/i.test(text)) {
    return { kind: 'idea', request: 'Sync Hevy workouts automatically (needs the official Hevy API and a Hevy Pro API key; the Training page imports Hevy’s CSV export now)' }
  }
  if (/\btrain ?heroic\b/i.test(text)) return { kind: 'idea', request: 'Import TrainHeroic workouts (from its CSV export or a photo of the session)' }
  const q = text.toLowerCase().replace(/[’]/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  const asked = q.match(/^(?:how'?s|how is|how are|hows)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:going|doing|looking|coming along|progressing|getting on|lately|now))*$/)?.[1]
    ?? q.match(/^(?:what'?s|what is|whats)\s+my\s+(.+?)\s+(?:pr|1rm|e1rm|max|best|record)$/)?.[1]
    ?? q.match(/^(?:my\s+)?(.+?)\s+(?:progress|prs?|1rm|e1rm|stats|history)$/)?.[1] ?? null
  const removing = q.match(/^(?:delete|remove|undo|scrap|bin)\s+(?:my\s+|the\s+|that\s+)?(?:last\s+)?(.+?)(?:\s+(?:i\s+)?just\s+(?:logged|did|sent|added))?$/)?.[1] ?? null
  if (!asked && !removing) {
    // a card is waiting: a correction to it is the brain's job; only a clearly new lift of a known exercise goes on
    if (env.cardOpen && CORRECTION.test(q)) return null
    // a lift: read with the default exercise list and no unit (no database read here); his unit setting and the PR
    // are worked out on the card. A name the default list doesn't know is tried against his own exercises.
    let res = parseLifts(text, env.today)
    if (!res && /\d\s*[x×]\s*\d/i.test(text)) {
      const mine = (await planningOf(env.sb)) as { gymExercises?: unknown } | null
      if (Array.isArray(mine?.gymExercises) && mine.gymExercises.length) res = parseLifts(text, env.today, { list: exerciseCatalogue(mine) })
    }
    if (!res) return null
    if (env.cardOpen && res.kind === 'lift' && res.lifts.some((l) => !l.exercise)) return null
    if (res.kind === 'vague') return { kind: 'answer', html: vagueHtml(res.exercises, res.weight) }
    return {
      kind: 'actions', head: res.lifts.length > 1 ? `🏋️ <b>Log these ${res.lifts.length} lifts?</b>` : '🏋️ <b>Log this lift?</b>',
      actions: res.lifts.map((l) => ({ op: 'lift_log', ref: '', value: liftValue(l), date: l.date, date_to: '', time: '', time_to: '', number: 0, words: l.dateWords })),
    }
  }
  const planning = await planningOf(env.sb)
  const list = exerciseCatalogue(planning), prefs = gymPrefs(planning)
  if (asked) {
    if (GYM_WORDS.test(asked)) {
      const { rows, missing } = await loadLifts(env.sb)
      return { kind: 'answer', html: gymWeekHtml(rows, env.today, list, prefs, { missing }) }
    }
    const ex = findExercise(asked, list)
    if (!ex) return null
    const { rows, missing } = await loadLifts(env.sb, { keys: [ex.key] })
    return { kind: 'answer', html: missing ? gymWeekHtml([], env.today, list, prefs, { missing }) : exerciseHtml(rows, ex, env.today, prefs) }
  }
  if (removing) {
    // "delete my last lift", "remove the bench I just logged": the newest lift (of that exercise), on a ✅ card
    const ex = /^(?:lift|lifts|set|log|one|entry)$/.test(removing) ? null : findExercise(removing.replace(/^(?:my|the)\s+/, ''), list)
    if (!ex && !/^(?:lift|lifts|set|log|one|entry)$/.test(removing)) return null
    const { rows } = await recentLifts(env.sb, 50, { logged: true })
    const t = rows.find((r) => !ex || r.exercise_key === ex.key)
    if (!t) return { kind: 'answer', html: ex ? `No ${esc(ex.name.toLowerCase())} logged recently.` : 'No lifts logged recently.' }
    return { kind: 'actions', head: '🗑 <b>Remove this lift?</b>', actions: [{ op: 'lift_archive', ref: `lift:${t.id}`, value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }] }
  }
  return null
}

/** /owen: a ready-to-send message with this week's Owen days and his free slots (tap the message to copy it). */
async function owenCommand(env: CommandEnv): Promise<CommandResult> {
  // loaded here, not at the top: these modules sit on the bot's own import chain
  const [{ loadViewData }, { loadWorld }, { planTraining, trainingRooms, optWorldOf, fixedLoad }, { owenMessage }, { activeSessions, owenDays, DAY3 }] = await Promise.all([
    import('../views'), import('../ripple'), import('../../week'), import('../owen'), import('../../setup')])
  const data = await loadViewData(env.sb, env.today, env.now)
  const owen = activeSessions(data.planning).filter((s) => s.owen)
  if (!owen.length) return { html: 'No sessions with Owen in your set-up. Tell me which ones he programmes, and /owen writes him a message.' }
  const world = await loadWorld(env.sb, data)
  const plan = planTraining(world)
  const saved = owenDays(data.planning)
  const days: Record<string, number[]> = {}
  for (const s of owen) if (saved?.[s.key]?.length) days[s.key] = saved[s.key]
  const fromSetup = Object.keys(days).length > 0
  if (!fromSetup) {
    for (const s of owen) {
      const ds = plan.placed.filter((p) => plan.sessionOf[p.key] === s.key || (s.stackWith && plan.sessionOf[p.key] === s.stackWith)).map((p) => isoDow(p.date))
      if (ds.length) days[s.key] = [...new Set(ds)].sort((a, b) => a - b)
    }
  }
  if (!Object.keys(days).length) return { html: 'I couldn’t find days for Owen this week: say “which days should I give Owen?” first.' }
  // free time around school, events, routines and study, minus his other (not light) sessions this week and their
  // travel; school days from his usual training time, game days left out
  const mine = new Set(owen.map((s) => s.key))
  const rooms = trainingRooms(world, world.planned.filter((b) => b.kind !== 'training'))
  const busy = plan.placed.filter((p) => !mine.has(plan.sessionOf[p.key] ?? '') && p.intensity !== 'light')
  const school = optWorldOf(world).schoolEnd
  const games = new Set(fixedLoad(world).filter((f) => f.type === 'match').map((f) => f.date))
  const free = slotsWords(owenSlots(rooms, busy, { min: 60, until: world.settings.heavyUntil, buffer: world.settings.bufferMin,
    from: (date) => (school.has(date) ? world.trainingFrom ?? null : null), skip: games }))
  const msg = owenMessage(days, data.planning, plan, { free })
  const which = Object.entries(days).map(([k, d]) => `${owen.find((s) => s.key === k)?.name ?? k} ${d.map((x) => DAY3[x - 1]).join('/')}`).join(', ')
  const when = world.from === env.today ? 'from today' : `for the week of ${day(world.from)}`
  return {
    html: ['📋 <b>Message for Owen</b> <i>(tap it to copy)</i>:', `<code>${esc(msg)}</code>`, '',
      `<i>${fromSetup ? `Owen’s days from your set-up: ${esc(which)}.` : `No Owen days saved yet, so these are this week’s best days: ${esc(which)} (“which days should I give Owen?” saves them).`} Free slots ${esc(when)}: after school and at weekends, around your events, routines and other sessions; game days left out.</i>`].join('\n'),
  }
}

async function gymCommand(env: CommandEnv): Promise<CommandResult> {
  const planning = await planningOf(env.sb)
  const { rows, missing } = await loadLifts(env.sb)
  const html = gymWeekHtml(rows, env.today, exerciseCatalogue(planning), gymPrefs(planning), { missing })
  return { html, ...(env.appUrl ? { buttons: [[{ text: '📈 Charts and Hevy import', url: `${env.appUrl}/training` }]] } : {}) }
}

export const plugin: BotPlugin = {
  name: 'gym',
  ops: OPS,
  prompt: `- Gym (see "Gym"; e1RM = Epley estimate): lift_log for each exercise he did (ref ""; value "exercise=<his name for it>; weight=<number>; unit=kg|lbs; reps=<reps, or each set's reps: 6,6,5>; sets=<number>; bw=yes for a bodyweight move (weight = what he added, 0 if none); rpe=<1–10 if he said>"; date = the day if not today, words = his words for it). "bench 80x5x3" = 80 kg × 5 reps × 3 sets; "squat 100 5x5" = 100 kg, 5 sets of 5; "OHP 50 x 6,6,5" = reps=6,6,5. A lift he did is lift_log (instruction), not new. No weight or reps given: unclear, ask for them. lift_edit (ref LF…; value with only what changes: "weight=82.5", "reps=6", "sets=4", "exercise=…"; date + words to move its day) · lift_archive (ref LF…: "delete that bench", "I didn't do that").`,
  loadRows: async (sb, raw) => {
    const planning = await planningOf(sb)
    const list = exerciseCatalogue(planning)
    const keys = [...new Set(raw.filter((a) => a.op === 'lift_log').map((a) => kvOf(a.value).exercise ?? '').filter(Boolean).map((n) => findExercise(n, list)?.key ?? keyOf(n)))]
    const [history, recent] = await Promise.all([
      keys.length ? loadLifts(sb, { keys, max: 3000 }) : Promise.resolve({ rows: [] as LiftRow[], missing: false }),
      raw.some((a) => a.op !== 'lift_log') ? recentLifts(sb, 300) : Promise.resolve({ rows: [] as LiftRow[], missing: false }),
    ])
    return { planning, history: history.rows, recent: recent.rows, missing: history.missing || recent.missing } satisfies Rows
  },
  check: (op, raw, rows, env) => {
    const r = (rows ?? { planning: null, history: [], recent: [], missing: false }) as Rows
    if (op === 'lift_log') return checkLog(raw, r, env)
    if (op === 'lift_edit') return checkEdit(raw, r, env)
    if (op === 'lift_archive') return checkArchive(raw, r, env)
    return { problem: `“${op}” isn’t a gym change` }
  },
  apply: async (sb, a, now) => {
    if (a.op === 'lift_log') {
      const saved = await insertLifts(sb, a.patch.rows as NewLift[])
      return { op: a.op, table: 'lift_sets', id: saved[0].id, title: a.title, before: null, after: { ids: saved.map((r) => r.id), rows: saved.map((r) => ({ id: r.id, ...pick(r) })) } }
    }
    const was = await readLift(sb, a.id!)
    if (!was || was.archived_at) throw new Error('That lift isn’t there any more.')
    if (a.op === 'lift_archive') {
      const { data, error } = await sb.from('lift_sets').update({ archived_at: now }).eq('id', a.id!).is('archived_at', null).select('id,archived_at').maybeSingle()
      if (error || !data) throw new Error(`Not saved: ${error?.message ?? 'that lift changed meanwhile'}`)
      return { op: a.op, table: 'lift_sets', id: a.id!, title: a.title, before: { archived_at: null }, after: { archived_at: (data as { archived_at: string }).archived_at } }
    }
    const keys = Object.keys(a.patch)
    const before = Object.fromEntries(keys.map((k) => [k, (was as unknown as Record<string, unknown>)[k] ?? null]))
    const { data, error } = await sb.from('lift_sets').update(a.patch).eq('id', a.id!).is('archived_at', null).select(COLS).single()
    if (error || !data) throw new Error(`Not saved: ${error?.message ?? 'not confirmed'}`)
    const row = asLift(data as Record<string, unknown>) as unknown as Record<string, unknown>
    return { op: a.op, table: 'lift_sets', id: a.id!, title: a.title, before, after: Object.fromEntries(keys.map((k) => [k, row[k] ?? null])) }
  },
  undo: async (sb, a) => {
    if (a.op === 'lift_log') {
      const ids = (a.after.ids as string[] | undefined) ?? []
      const was = (a.after.rows as Record<string, unknown>[] | undefined) ?? []
      const { data, error } = await sb.from('lift_sets').select(COLS).in('id', ids)
      if (error) throw new Error(error.message)
      const now = ((data ?? []) as Record<string, unknown>[]).map(asLift)
      // only if nothing changed them since (another edit, or already removed)
      const untouched = ids.length > 0 && ids.every((id) => { const r = now.find((x) => x.id === id); const w = was.find((x) => x.id === id); return !!r && !r.archived_at && !!w && same(pick(r), w, [...FIELDS]) })
      if (!untouched) return 'skipped'
      await archiveLifts(sb, ids)
      return 'undone'
    }
    const now = await readLift(sb, a.id)
    if (!now) return 'skipped'
    if (a.op === 'lift_archive') {
      if (!now.archived_at || Date.parse(now.archived_at) !== Date.parse(String(a.after.archived_at))) return 'skipped'
      const { error } = await sb.from('lift_sets').update({ archived_at: null }).eq('id', a.id).select('id').single()
      if (error) throw new Error(error.message)
      return 'undone'
    }
    const keys = Object.keys(a.after)
    if (now.archived_at || !same(now as unknown as Record<string, unknown>, a.after, keys)) return 'skipped'
    const { error } = await sb.from('lift_sets').update(a.before ?? {}).eq('id', a.id).select('id').single()
    if (error) throw new Error(error.message)
    return 'undone'
  },
  afterApply: async (sb, applied, today) => {
    const logs = applied.filter((a) => a.op === 'lift_log')
    if (!logs.length) return null
    const planning = await planningOf(sb)
    const list = exerciseCatalogue(planning), prefs = gymPrefs(planning)
    const saved = logs.flatMap((a) => (a.after.rows as { id: string; exercise_key: string; exercise: string; done_on: string }[] | undefined) ?? [])
    const keys = [...new Set(saved.map((r) => r.exercise_key))]
    const { rows } = await loadLifts(sb, { keys, max: 3000 })
    const mine = new Set(saved.map((r) => r.id))
    const lines: string[] = []
    for (const key of keys) {
      const ex = exerciseOf(key, list, saved.find((r) => r.exercise_key === key)?.exercise)
      const now = rows.filter((r) => mine.has(r.id) && r.exercise_key === key)
      const date = now[0]?.done_on ?? today
      const pr = prOf(now, rows.filter((r) => r.exercise_key === key && !mine.has(r.id) && r.done_on <= date), ex, prefs)
      if (pr && pr.kind !== 'first') lines.push(`🏆 <b>New PR</b>: ${esc(ex.name)} ${esc(prShort(pr, ex))}`)
      const next = nextFor(rows.filter((r) => r.done_on <= today), key, ex, prefs)
      if (next) lines.push(`➡️ Next time: ${esc(keys.length > 1 ? next.text : next.text.replace(`${ex.name}: `, ''))}`)
    }
    return lines.slice(0, 4).join('\n') || null
  },
  snapshot: async (sb, today) => {
    // the last six months is plenty for bests and trends, and keeps every brain call quick
    const [planning, all, recent] = await Promise.all([planningOf(sb), loadLifts(sb, { from: addDays(today, -182), max: 2000 }), recentLifts(sb, 10)])
    return gymSnapshot(all.rows, recent.rows, today, exerciseCatalogue(planning), gymPrefs(planning), all.missing || recent.missing)
  },
  fast: (message, env) => fast(message, env),
  commands: [
    { command: 'gym', description: 'This week’s lifts, PRs and next sessions', run: gymCommand },
    { command: 'lifts', description: 'Same as /gym', run: gymCommand },
    { command: 'owen', description: 'A message for Owen: your days and free slots', run: owenCommand },
  ],
}
