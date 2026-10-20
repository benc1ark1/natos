// Changing his set-up by chat or a gap answer (Build O): places and their equipment and travel, session types, Owen's
// days, this week's game and read-only sessions to ignore. Each change is checked here and becomes ONE key of
// profiles.planning (the whole new list or map), so ✅ / ↩️ Undo work like any setting. Nothing is ever removed: a
// place or session he stops using is archived. Pure: no database.
import { EQUIPMENT, activePlaces, gameFor, ignoredSessions, owenDays, holidayOwenDays, sessionTimes, sessionTypes, trainingPlaces, findPlace, findSession, daysWords,
  type DayMap, type DayTimes, type SessionType, type TrainingPlace } from './setup'
import { newKey } from './lists'
import { addDays, dowShort, isoDow, shortDate, weekStartISO } from './time'
import { moreSettings } from './settings'

export type SetupChange = { key: string; title: string; line: string; patch: Record<string, unknown> }
type Result = { change?: SetupChange; problem?: string }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const kvOf = (v: string) => Object.fromEntries((v ?? '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? [x.trim().toLowerCase(), ''] : [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()] }).filter((x) => x[0]))
const yes = (v?: string) => /^(yes|true|y|on)$/i.test(v ?? '')
const no = (v?: string) => /^(no|false|n|off)$/i.test(v ?? '')
const mins = (v: string | undefined, lo = 0, hi = 240) => { const n = Number((v ?? '').replace(/\s*min\w*$/i, '')); return Number.isInteger(n) && n >= lo && n <= hi ? n : null }
const words = (v: string) => v.split(/\s*,\s*|\s+and\s+/).map((x) => x.trim()).filter(Boolean)
/** "barbells, squat rack" → equipment keys (unknown words kept as their own key). */
const equipmentOf = (v: string) => words(v).map((w) => {
  const n = w.toLowerCase()
  const hit = Object.entries(EQUIPMENT).find(([k, label]) => k === n.replace(/ /g, '_') || label.toLowerCase() === n || label.toLowerCase().replace(/s$/, '') === n.replace(/s$/, ''))
  return hit ? hit[0] : n.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24)
}).filter((k) => /^[a-z][a-z0-9_]{0,24}$/.test(k))

/** value "place=PureGym; fromSchool=15; fromHome=30; toHome=30; equipment=+cables; poor=upper machines; access=any; new=yes; archive=yes" */
export function placeChange(value: string, planning: unknown): Result {
  const kv = kvOf(value)
  const list: TrainingPlace[] = trainingPlaces(planning).map((p) => ({ ...p, equipment: [...p.equipment], poor: [...(p.poor ?? [])] }))
  const name = (kv.place ?? '').slice(0, 60)
  if (!name) return { problem: 'which place?' }
  let p = findPlace(list.filter((x) => !x.archived || yes(kv.unarchive)), name)
  const bits: string[] = []
  if (!p) {
    if (!yes(kv.new) && !kv.equipment && !kv.fromhome && !kv.fromschool) return { problem: `you have no training place called “${name}” (yours: ${activePlaces(planning).map((x) => x.name).join(', ')}); say it’s new to add it` }
    p = { key: newKey(name, list.map((x) => x.key)), name, address: kv.address ?? null, equipment: [], poor: [], goodFor: '', access: 'any', fromHome: null, fromSchool: null, toHome: null, mode: null }
    list.push(p)
    bits.push('new place')
  }
  if (yes(kv.archive)) { if (p.archived) return { problem: `“${p.name}” is already archived` }; p.archived = true; bits.push('archived (sessions stop using it)') }
  if (yes(kv.unarchive) && p.archived) { delete p.archived; bits.push('back in use') }
  for (const [k, field] of [['fromschool', 'fromSchool'], ['fromhome', 'fromHome'], ['tohome', 'toHome']] as const) {
    if (kv[k] === undefined) continue
    const n = mins(kv[k])
    if (n == null) return { problem: `“${kv[k]}” isn’t a number of minutes` }
    if (p[field] !== n) { bits.push(`${field === 'fromSchool' ? 'from school' : field === 'fromHome' ? 'from home' : 'back home'} ${p[field] ?? '?'} → ${n} min`); p[field] = n }
  }
  if (kv.both !== undefined) {   // "20 min each way"
    const n = mins(kv.both)
    if (n == null) return { problem: `“${kv.both}” isn’t a number of minutes` }
    p.fromHome = n; p.toHome = n; if (p.fromSchool == null) p.fromSchool = n
    bits.push(`${n} min each way`)
  }
  if (kv.equipment) {
    const add = kv.equipment.startsWith('+'), drop = kv.equipment.startsWith('-')
    const list2 = equipmentOf(kv.equipment.replace(/^[+-]\s*/, ''))
    if (!list2.length) return { problem: 'which equipment?' }
    p.equipment = add ? [...new Set([...p.equipment, ...list2])] : drop ? p.equipment.filter((e) => !list2.includes(e)) : list2
    bits.push(`kit ${add ? '+' : drop ? '−' : '→ '}${list2.map((e) => EQUIPMENT[e] ?? e.replace(/_/g, ' ')).join(', ')}`)
  }
  if (kv.poor) { const l = /^(none|nothing)$/i.test(kv.poor) ? [] : equipmentOf(kv.poor); p.poor = l; bits.push(`poor: ${l.map((e) => EQUIPMENT[e] ?? e).join(', ') || 'nothing'}`) }
  if (kv.access) {
    const a = /school/i.test(kv.access) ? 'school' : /owen/i.test(kv.access) ? 'owen' : 'any'
    if (a !== p.access) { p.access = a; bits.push(a === 'school' ? 'school days only' : a === 'owen' ? 'Owen’s sessions' : 'any time') }
  }
  if (kv.afterschool !== undefined) { p.bestAfterSchool = yes(kv.afterschool) || /best/i.test(kv.afterschool); bits.push(p.bestAfterSchool ? 'best straight after school' : 'no after-school preference') }
  if (kv.freeperiods !== undefined) { p.freePeriods = yes(kv.freeperiods); bits.push(p.freePeriods ? 'also in free periods' : 'not in free periods') }
  if (kv.address) { p.address = kv.address.slice(0, 120); bits.push(`address ${p.address}`) }
  if (kv.goodfor) { p.goodFor = kv.goodfor.slice(0, 200); bits.push(`good for ${p.goodFor}`) }
  if (kv.name && kv.name !== p.name) { bits.push(`renamed → ${kv.name.slice(0, 60)}`); p.name = kv.name.slice(0, 60) }
  if (!bits.length) return { problem: `nothing new for “${p.name}”` }
  return { change: { key: 'trainingPlaces', title: p.name, line: `📍 <b>${esc(p.name)}</b>: ${esc(bits.join('; '))}`, patch: { trainingPlaces: list } } }
}

/** value "session=Upper; minutes=50; perWeek=2-3; places=PureGym, School gym; intensity=heavy; needs=barbell; stack=Injury prevention; new=yes; type=upper; archive=yes" */
export function sessionChange(value: string, planning: unknown): Result {
  const kv = kvOf(value)
  const list: SessionType[] = sessionTypes(planning).map((s) => ({ ...s, places: [...s.places] }))
  const places = trainingPlaces(planning)
  const name = (kv.session ?? '').slice(0, 40)
  if (!name) return { problem: 'which session?' }
  let s = findSession(list.filter((x) => !x.archived || yes(kv.unarchive)), name)
  const bits: string[] = []
  if (!s) {
    if (!yes(kv.new) && !kv.minutes && !kv.perweek) return { problem: `you have no session called “${name}” (yours: ${list.filter((x) => !x.archived).map((x) => x.name).join(', ')})` }
    const type = (kv.type ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'other'
    s = { key: newKey(name, list.map((x) => x.key)), name, type, intensity: 'moderate', minutes: null, perWeek: 1, places: [], target: null }
    list.push(s)
    bits.push('new session')
  }
  if (yes(kv.archive)) { s.archived = true; bits.push('archived (no longer planned)') }
  if (yes(kv.unarchive)) { delete s.archived; bits.push('back in use') }
  if (kv.minutes !== undefined) { const n = mins(kv.minutes, 5); if (n == null) return { problem: `“${kv.minutes}” isn’t a number of minutes` }; bits.push(`${s.minutes ?? '?'} → ${n} min`); s.minutes = n }
  if (kv.perweek !== undefined) {
    const m = kv.perweek.match(/^(\d{1,2})(?:\s*(?:-|–|to)\s*(\d{1,2}))?\s*x?$/i)
    if (!m) return { problem: `“${kv.perweek}” isn’t a number a week` }
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : null
    if (a > 14 || (b != null && b < a)) return { problem: `“${kv.perweek}” doesn’t work` }
    s.perWeek = a
    if (b != null && b > a) s.maxPerWeek = b; else delete s.maxPerWeek
    bits.push(`${a}${b && b > a ? `–${b}` : ''}× a week`)
  }
  if (kv.places) {
    const ps = words(kv.places).map((w) => findPlace(places, w)).filter((p): p is TrainingPlace => !!p)
    if (!ps.length) return { problem: `no place called “${kv.places}” (yours: ${places.filter((p) => !p.archived).map((p) => p.name).join(', ')})` }
    s.places = ps.map((p) => p.key)
    bits.push(`at ${ps.map((p) => p.name).join(' or ')}${ps.length > 1 ? ` (${ps[0].name} preferred)` : ''}`)
  }
  if (kv.intensity) { const lv = /light/i.test(kv.intensity) ? 'light' : /moderate|medium/i.test(kv.intensity) ? 'moderate' : 'heavy'; s.intensity = lv; bits.push(lv) }
  if (kv.needs) { s.needs = /^(none|nothing)$/i.test(kv.needs) ? [] : equipmentOf(kv.needs); bits.push(`needs ${s.needs.map((e) => EQUIPMENT[e] ?? e).join(', ') || 'nothing special'}`) }
  if (kv.stack !== undefined) {
    if (/^(none|no|off)$/i.test(kv.stack)) { s.stackWith = null; bits.push('done on its own') }
    else { const o = findSession(list, kv.stack); if (!o || o.key === s.key) return { problem: `no session called “${kv.stack}” to stack onto` }; s.stackWith = o.key; bits.push(`done straight after ${o.name}`) }
  }
  if (kv.type && !bits.includes('new session')) { s.type = kv.type.toLowerCase().replace(/[^a-z0-9_]/g, ''); bits.push(`type ${s.type}`) }
  if (kv.target !== undefined) { s.target = /^(none|no)$/i.test(kv.target) ? null : kv.target.slice(0, 80); bits.push(s.target ? `counts toward ${s.target}` : 'counts toward no target') }
  if (kv.owen !== undefined) { s.owen = yes(kv.owen); bits.push(s.owen ? 'Owen programmes it' : 'not Owen’s') }
  if (kv.lighter !== undefined) { if (yes(kv.lighter)) delete s.noLighter; else s.noLighter = true; bits.push(s.noLighter ? 'never lighter' : 'can go lighter when needed') }
  if (kv.name && kv.name !== s.name) { bits.push(`renamed → ${kv.name.slice(0, 40)}`); s.name = kv.name.slice(0, 40) }
  if (!bits.length) return { problem: `nothing new for “${s.name}”` }
  return { change: { key: 'sessionTypes', title: s.name, line: `🏋️ <b>${esc(s.name)}</b>: ${esc(bits.join('; '))}`, patch: { sessionTypes: list } } }
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const dowOf = (w: string) => { const i = DAYS.indexOf(w.trim().toLowerCase().slice(0, 3)); return i < 0 ? null : i + 1 }

/** value "speed=tue; heavy_lower=thu; injury=fri; core=sat" (session words or keys), or "clear=yes". "holiday=yes":
 *  the days in the holidays instead (they replace the usual days in a holiday week). */
export function owenChange(value: string, planning: unknown): Result {
  const { holiday, ...kv } = kvOf(value)
  const hol = yes(holiday)
  const sessions = sessionTypes(planning)
  const daysKey = hol ? 'holidayOwenDays' : 'owenDays', timesKey = hol ? 'holidaySessionTimes' : 'sessionTimes'
  const saved = hol ? holidayOwenDays(planning) : owenDays(planning)
  if (yes(kv.clear)) {
    if (!saved) return { problem: hol ? 'no holiday days are set' : 'Owen’s days aren’t set' }
    return { change: { key: daysKey, title: hol ? 'Holiday days' : 'Owen’s days', line: hol ? '🗓 Holiday days: cleared (the usual days in the holidays too)' : '🗓 Owen’s days: cleared (the planner picks freely)', patch: hol ? { holidayOwenDays: null, holidaySessionTimes: null } : { owenDays: null } } }
  }
  const map: DayMap = { ...(saved ?? {}) }
  const times: DayTimes = { ...sessionTimes(planning, timesKey) }
  const bits: string[] = []
  for (const [k, v] of Object.entries(kv) as [string, string][]) {
    const s = findSession(sessions, k.replace(/_/g, ' '))
    if (!s) return { problem: `no session called “${k}”` }
    // "mon, sat 09:30": a day with a time keeps that time (no time = the usual, e.g. straight after school)
    const parts = v.split(/\s*[,/+&]\s*|\s+and\s+/).map((x) => ({ d: dowOf(x), t: x.match(/(\d{1,2})[:.](\d{2})/) })).filter((x) => x.d != null)
    if (!parts.length) return { problem: `“${v}” isn’t a day` }
    map[s.key] = [...new Set(parts.map((x) => x.d!))].sort()
    const own: Record<string, string> = {}
    for (const x of parts) if (x.t && Number(x.t[1]) < 24 && Number(x.t[2]) < 60) own[String(x.d)] = `${x.t[1].padStart(2, '0')}:${x.t[2]}`
    if (Object.keys(own).length) times[s.key] = own; else delete times[s.key]
    bits.push(`${s.name} ${map[s.key].map((d) => `${daysWords([d])}${own[String(d)] ? ` ${own[String(d)]}` : ''}`).join('/')}`)
  }
  if (!bits.length) return { problem: 'which sessions on which days?' }
  if (hol) return { change: { key: daysKey, title: 'Holiday days', line: `🗓 In the holidays: <b>${esc(bits.join(', '))}</b> <i>(instead of the usual days in a holiday week)</i>`, patch: { holidayOwenDays: map, holidaySessionTimes: times } } }
  return { change: { key: daysKey, title: 'Fixed days', line: `🗓 Fixed days: <b>${esc(bits.join(', '))}</b> <i>(the planner keeps these sessions on them)</i>`, patch: { owenDays: map, sessionTimes: times } } }
}

/** This week's game: value "date=YYYY-MM-DD; leave=09:00; back=15:00", "none=yes", or "usual=yes" (the week starting `weekStart`). */
export function gameChange(value: string, planning: unknown, today: string): Result {
  const kv = kvOf(value)
  const raw = (planning && typeof planning === 'object' ? (planning as Record<string, unknown>).gameWeeks : null)
  const weeks = { ...((raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>) }
  // drop weeks long gone (the map stays small)
  for (const k of Object.keys(weeks)) if (k < addDays(weekStartISO(today), -21)) delete weeks[k]
  const date = /^\d{4}-\d{2}-\d{2}$/.test(kv.date ?? '') ? kv.date : null
  const wk = weekStartISO(date ?? today)
  const was = gameFor(wk, planning)
  const s = moreSettings(planning)
  const t = (v?: string) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v ?? '') ? v! : null)
  const wasWords = was ? `${dowShort(was.date)} ${was.leave}–${was.back}${was.guess ? ' (usual)' : ''}` : 'no game'
  if (yes(kv.none)) {
    weeks[wk] = { none: true }
    return { change: { key: 'gameWeeks', title: 'This week’s game', line: `⚽ Game, week of ${shortDate(wk)}: ${esc(wasWords)} → <b>no game</b>`, patch: { gameWeeks: weeks } } }
  }
  const usual = yes(kv.usual)
  const d = usual ? (was?.date ?? null) : date
  if (!d) return { problem: 'which day is the game?' }
  if (d < today) return { problem: 'that day has passed' }
  const leave = t(kv.leave) ?? (usual ? was?.leave : null) ?? s.gameLeave, back = t(kv.back) ?? (usual ? was?.back : null) ?? s.gameBack
  weeks[wk] = { date: d, leave, back }
  const now = `${dowShort(d)} ${shortDate(d)}, leave ${leave}, back ${back}`
  return { change: { key: 'gameWeeks', title: 'This week’s game', line: `⚽ Game, week of ${shortDate(wk)}: ${esc(wasWords)} → <b>${esc(now)}</b>${usual ? ' <i>(confirmed)</i>' : ''}`, patch: { gameWeeks: weeks } } }
}

/** A read-only session the app should ignore (or stop ignoring): value "title=EFA training; ignore=yes|no". */
export function ignoreChange(value: string, planning: unknown, titles: string[]): Result {
  const kv = kvOf(value)
  const want = (kv.title ?? '').toLowerCase().trim()
  if (!want) return { problem: 'which session?' }
  const list = ignoredSessions(planning)
  const off = no(kv.ignore)
  if (off) {
    const hit = list.find((x) => x.toLowerCase() === want) ?? list.find((x) => x.toLowerCase().includes(want))
    if (!hit) return { problem: `“${kv.title}” isn’t being ignored` }
    return { change: { key: 'ignoredSessions', title: hit, line: `👁 <b>${esc(hit)}</b>: back in your plans`, patch: { ignoredSessions: list.filter((x) => x !== hit) } } }
  }
  const title = titles.find((x) => x.toLowerCase() === want) ?? titles.find((x) => x.toLowerCase().includes(want))
  if (!title) return { problem: `there’s no session called “${kv.title}” in your calendars` }
  if (list.some((x) => x.toLowerCase() === title.toLowerCase())) return { problem: `“${title}” is already ignored` }
  return { change: { key: 'ignoredSessions', title, line: `🗄 <b>${esc(title)}</b>: the app ignores it from now on <i>(it stays in Google; say “bring back ${esc(title)}” to undo later)</i>`, patch: { ignoredSessions: [...list, title] } } }
}

/** A question he answered with "that's right" (or a session he kept): remembered so it isn't asked again. */
export function doneChange(key: string, value: string, planning: unknown): SetupChange {
  const raw = (planning && typeof planning === 'object' ? (planning as Record<string, unknown>).gapsDone : null)
  const map = { ...((raw && typeof raw === 'object' ? raw : {}) as Record<string, string>), [key]: value }
  return { key: 'gapsDone', title: key, line: '✓ noted', patch: { gapsDone: map } }
}

export { isoDow }

/** This week's number of upper sessions (the optimiser decides otherwise): value "count=2" or "auto=yes". */
export function upperWeekChange(value: string, planning: unknown, today: string): Result {
  const kv = kvOf(value)
  const raw = (planning && typeof planning === 'object' ? (planning as Record<string, unknown>).upperWeeks : null)
  const weeks = { ...((raw && typeof raw === 'object' ? raw : {}) as Record<string, number>) }
  const wk = weekStartISO(today)
  for (const k of Object.keys(weeks)) if (k < addDays(wk, -21)) delete weeks[k]
  if (yes(kv.auto)) {
    if (!(wk in weeks)) return { problem: 'the optimiser already decides this week' }
    delete weeks[wk]
    return { change: { key: 'upperWeeks', title: 'Upper this week', line: '💪 Upper this week: back to the optimiser’s choice (2× or 3×)', patch: { upperWeeks: weeks } } }
  }
  const n = Number(kv.count)
  if (!Number.isInteger(n) || n < 0 || n > 6) return { problem: 'how many upper sessions this week?' }
  if (weeks[wk] === n) return { problem: `upper is already ${n}× this week` }
  weeks[wk] = n
  return { change: { key: 'upperWeeks', title: 'Upper this week', line: `💪 Upper this week: <b>${n}×</b> <i>(this week only; the optimiser decides again next week)</i>`, patch: { upperWeeks: weeks } } }
}

/** His choice of upper sessions for the week starting `weekStart`, if he made one. */
export const upperWeek = (planning: unknown, weekStart: string): number | null => {
  const raw = (planning && typeof planning === 'object' ? (planning as Record<string, unknown>).upperWeeks : null) as Record<string, unknown> | null
  const n = raw?.[weekStart]
  return Number.isInteger(n) ? (n as number) : null
}
