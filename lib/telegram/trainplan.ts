// Server-only: "when's best for upper body and Owen lower/plyo?" (Build 2 phase N). His calendars (and the week he
// sent, if he did) give the fixed sessions and free time; plain code (lib/load.ts) places the gym sessions he named by
// recovery load and his training rules, weighed, and gives one line of reasoning each. The card shows the week as
// low / med / high per day. He can move any session (🔁 under the card, or by saying "upper on Thursday") before ✅;
// ✅ saves them as plan blocks, which the 5-minute tick puts in his Life OS Google calendar. No AI picks the slots.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordUsage } from '../ai/usage'
import { INTENSITIES, loadView, matchTarget, type DayLoad, type Intensity, type Pin } from '../load'
import { addDays, dowShort, minutesOf, shortDate } from '../time'
import { trainingTypes } from '../training'
import { fixedLoad, planTraining, type WeekWorld } from '../week'
import type { Need } from '../training'
import { activePlaces, activeSessions, findPlace, findSession, hm, sessionTitle } from '../setup'
import type { OptPlan } from '../optimiser'
import { clearButtons, esc, type Button } from './api'
import type { PlanPayload } from './dayplan'
import { loadWorld, weekRange } from './ripple'
import { plain, say } from './turns'
import { looksLikeWeek, readWeek, saveWeek, weekLines, type WeekItem } from './weekread'
import type { ViewData } from './views'

export type TrainingInfo = {
  named: string[]                 // what he asked about ("upper", "Owen lower/plyo"); [] = his whole set-up
  only?: string[] | null          // the session types those words mean (null = all)
  upperCount?: number | null      // his choice of 2× or 3× upper (null = the optimiser decides)
  needs: Need[]                   // the sessions placed (for moving one)
  days: DayLoad[]; notes: string[]; sent: string[]; games: string[]
  pins?: Record<string, Pin>
  tbc: { key: string; title: string; reason: string }[]
  upper?: { count: number; reason: string } | null
  compare?: string | null
  left?: string[]                 // sessions he left out this week (🔁 → Leave it out)
}

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const LETTER: Record<Intensity, string> = { light: 'l', moderate: 'm', heavy: 'h' }
const FROM_LETTER: Record<string, Intensity> = { l: 'light', m: 'moderate', h: 'heavy' }

/** He sent his week: read it, keep it for this week's planning, and say what was read. Returns the items (or null). */
export async function noteWeek(sb: SupabaseClient, chatId: number, text: string, data: ViewData, opts: { quiet?: boolean } = {}): Promise<WeekItem[] | null> {
  const range = weekRange(data.today)
  const types = trainingTypes(data.planning)
  const res = await readWeek(text, range, types, (model, usage) => recordUsage(sb, 'plan', model, usage))
  if (!res.ok) { await say(sb, chatId, `⚠️ ${esc(res.error)}`); return null }
  if (!res.items.length) { if (!opts.quiet) await say(sb, chatId, `I couldn’t find days and times in that.${res.note ? ` <i>${esc(res.note)}</i>` : ''}`); return null }
  const kept = await saveWeek(sb, range, text, res.items)
  if (!opts.quiet) {
    await say(sb, chatId, [`📅 <b>Your week</b> (${day(range.from)} – ${day(range.to)})`, ...weekLines(res.items).map(esc),
      res.note ? `<i>${esc(res.note)}</i>` : '',
      kept ? '<i>Kept for planning this week, with your calendars. Ask “when’s best for upper and lower?” or “plan my week”.</i>'
        : '<i>Used for this message only (run supabase/build-n.sql to keep it for the week).</i>'].filter(Boolean).join('\n'), undefined, { intent: 'plan' })
  }
  return res.items
}

/** The session types he named ("upper body", "Owen lower/plyo", "speed"); null = all of them. */
export function namedSessions(w: WeekWorld, named: string[]): string[] | null {
  if (!named.length || named.some((n) => /^(all|everything|gym|training|my sessions|the week)$/i.test(n.trim()))) return null
  const sessions = activeSessions(w.planning)
  const keys = new Set<string>()
  for (const said of named) {
    const s = findSession(sessions, said.replace(/\b(owen'?s?|body|session|sessions|day)\b/gi, ' ').replace(/\s+/g, ' ').trim())
      ?? sessions.find((x) => x.type === (/(lower|leg|squat)/i.test(said) ? 'lower' : /(plyo|jump)/i.test(said) ? 'lower' : /(upper|push|pull|chest)/i.test(said) ? 'upper' : /(speed|sprint|track)/i.test(said) ? 'sprint' : ''))
    if (s) keys.add(s.key)
  }
  return keys.size ? [...keys] : []
}

/** "upper on Thursday", "lower light on Fri at 5pm", "move Tue upper to Thu" → that session placed there. */
export function parsePins(words: string, placed: { key: string; title: string; date: string; type: string }[], from: string, to: string, places?: ReturnType<typeof activePlaces>): Map<string, Pin> {
  const pins = new Map<string, Pin>()
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const dateOf = (w: string) => { const i = DAYS.indexOf(w.slice(0, 3)); if (i < 0) return null; for (let d = from; d <= to; d = addDays(d, 1)) if (dowShort(d).toLowerCase().startsWith(DAYS[i])) return d; return null }
  for (const clause of words.toLowerCase().split(/[,;.]|\band\b|\bthen\b/)) {
    const days = [...clause.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/g)].map((m) => dateOf(m[1])).filter(Boolean) as string[]
    if (!days.length) continue
    const target = days[days.length - 1], fromDay = days.length > 1 ? days[0] : null
    const t = clause.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\b/)
    let start: string | null = null
    if (t && (t[2] || t[3])) { let h = Number(t[1]); if (t[3] === 'pm' && h < 12) h += 12; if (t[3] === 'am' && h === 12) h = 0; if (h < 24) start = `${String(h).padStart(2, '0')}:${t[2] ?? '00'}` }
    const lv = /\b(light|easy)\b/.test(clause) ? 'light' : /\b(moderate|medium)\b/.test(clause) ? 'moderate' : /\b(heavy|hard)\b/.test(clause) ? 'heavy' : null
    // "at PureGym", "at the school gym", "at home"
    const at = clause.match(/\bat (?:the )?([a-z][a-z ]{2,30}?)(?:\s+(?:on|at|from|light|heavy|moderate)\b|$)/)
    const place = at && places ? findPlace(places, at[1])?.key ?? null : null
    const pick = matchTarget(clause.replace(/\bat (?:the )?[a-z][a-z ]{2,30}$/, ''), placed.map((p) => ({ id: p.key, name: `${p.title} ${p.type}` })))
      ?? matchTarget(clause, placed.map((p) => ({ id: p.key, name: `${p.title} ${p.type}` })))
    if (!pick) continue
    const same = placed.filter((p) => p.title === placed.find((x) => x.key === pick.id)!.title && !pins.has(p.key))
    const which = (fromDay && same.find((p) => p.date === fromDay)) || same.find((p) => p.date !== target) || same[0]
    if (which) pins.set(which.key, { date: target, start, intensity: lv as Intensity | null, ...(place ? { place } : {}) })
  }
  return pins
}

/** A placed session's block: its place in the title, the reason, and when to leave. */
export function blockOf(p: OptPlan['placed'][number]) {
  return { date: p.date, start: p.start, end: p.end, title: sessionTitle(p.title, p.label ?? null), kind: 'training' as const, why: p.why, intensity: p.intensity, wanted: p.wanted, key: p.key,
    place: p.label ?? null, placeKey: p.place ?? null, leave: p.before ? hm(minutesOf(p.start) - p.before) : null, from: p.from ?? null, back: p.after ?? 0,
    ref: p.targetId ? { kind: 'target', id: p.targetId } : null }
}

/** Work the plan out (no messages): the card's payload. */
export async function buildTrainingPlan(sb: SupabaseClient, data: ViewData, named: string[], pins?: Map<string, Pin>, opts: { upperCount?: number | null } = {}): Promise<{ payload: PlanPayload } | { message: string }> {
  const world = await loadWorld(sb, data, weekRange(data.today))
  const w: WeekWorld = { ...world, pins }
  const only = namedSessions(w, named)
  if (only && !only.length) {
    return { message: `I couldn’t match “${named.join(', ')}” to a session in your set-up (${activeSessions(w.planning).map((s) => s.name).join(', ')}). Add it with e.g. “add swimming as a session, 45 min, twice a week”.` }
  }
  const plan = planTraining(w, { only, pins, upperCount: opts.upperCount ?? null })
  if (!plan.placed.length && !plan.tbc.length) return { message: 'Nothing left to place this week: those sessions are done.' }
  const games = fixedLoad(w).filter((s) => s.type === 'match' && s.date >= w.from && s.date <= w.to).map((s) => `${s.title} (${dowShort(s.date)})`)
  const sent = (world.sent ?? []) as WeekItem[]
  const needs: Need[] = plan.needs.map((n) => ({ key: n.key, title: n.title, type: n.type, load: n.intensity === 'heavy' ? 'hard' : n.intensity, minutes: n.minutes }))
  const info: TrainingInfo = { named, only, upperCount: opts.upperCount ?? null, needs, days: plan.days, notes: plan.notes, sent: weekLines(sent), games: [...new Set(games)], tbc: plan.tbc,
    pins: pins ? Object.fromEntries(pins) : undefined, upper: plan.upper, compare: plan.compare }
  return { payload: { date: w.from, week: { from: w.from, to: w.to }, energy: 'normal', energyGiven: false, blocks: plan.placed.map(blockOf), unplaced: [], tbc: plan.tbc, note: '', pushBack: '', training: info } as PlanPayload }
}

/** One session on a card: "Tue 16:25 Upper @ PureGym · heavy (leave 16:10)". */
export const sessionLine = (b: PlanPayload['blocks'][number], today: string) =>
  `<b>${b.date === today ? 'Today' : dowShort(b.date!)} ${b.start}</b> ${esc(b.title)} · ${b.intensity ?? 'heavy'}${b.leave ? ` <i>(leave ${b.from === 'school' ? 'school ' : ''}${b.leave})</i>` : ''}`

/** The card. */
export function trainText(p: PlanPayload, today: string): string {
  const t = p.training!
  const lines = [`🏋️ <b>Training plan</b> · ${day(p.week!.from)} – ${day(p.week!.to)}`]
  for (const b of p.blocks) {
    lines.push(sessionLine(b, today))
    if (b.why) lines.push(`   <i>↳ ${esc(b.why)}</i>`)
  }
  if (t.tbc.length) lines.push(`<i>Not placed: ${esc(t.tbc.map((x) => `${x.title} (${x.reason})`).join('; '))}</i>`)
  if (t.upper) lines.push(`💪 <i>Upper ${esc(t.upper.reason)}</i>`)
  if (t.compare) lines.push(`<i>${esc(t.compare)}</i>`)
  lines.push('', '<b>Load</b> (legs + upper + CNS)', ...loadView(t.days, today))
  for (const n of t.notes) lines.push(`⚠️ ${esc(n)}`)
  if (t.games.length) lines.push(`<i>Counted as games: ${esc(t.games.join(', '))}. Not a game? Say “Games isn’t a match”.</i>`)
  if (t.sent.length) lines.push(`<i>From the week you sent: ${esc(t.sent.join(' / '))}</i>`)
  lines.push('<i>🔁 moves a session; or say “upper Sat at PureGym”, “lower light on Fri”. ✅ adds them to your plan and Life OS calendar.</i>')
  return lines.join('\n')
}

export const trainButtons = (id: string, p: PlanPayload): Button[][] => {
  const rows: Button[][] = [[{ text: '✅ Apply', callback_data: `a:${id}` }, { text: '✖ Cancel', callback_data: `x:${id}` }]]
  const per = p.blocks.map((b, i): Button => ({ text: `🔁 ${dowShort(b.date!)} ${b.title}`.slice(0, 40), callback_data: `o:${id}:s${i}` }))
  for (let i = 0; i < per.length; i += 2) rows.push(per.slice(i, i + 2))
  return rows
}

/** "upper 3x this week", "only 2 uppers" → his choice of upper sessions (null = not said). */
export const upperWords = (words: string): number | null => {
  const m = words.toLowerCase().match(/\b(?:upper\w*\s*(?:x\s*)?([23])\s*(?:x|times)\b|([23])\s*(?:x|times)?\s*upper|(two|three)\s+upper)/)
  if (!m) return null
  return Number(m[1] ?? m[2] ?? (m[3] === 'two' ? 2 : 3))
}

/** Send the card (replacing an older one being changed). */
export async function proposeTrainingPlan(sb: SupabaseClient, chatId: number, words: string, named: string[], data: ViewData,
  opts: { replaces?: { id: string; payload: PlanPayload & { card_message_id?: number | null } } | null; onReplace?: () => Promise<void>; pins?: Map<string, Pin> } = {}): Promise<void> {
  // a week typed out in the same message is read first
  if (looksLikeWeek(words)) await noteWeek(sb, chatId, words, data, { quiet: true })
  let pins = opts.pins
  const was = opts.replaces?.payload
  if (!pins && was?.training) {
    pins = new Map([...Object.entries(was.training.pins ?? {}), ...parsePins(words, was.blocks.map((b) => ({ key: b.key!, title: b.title, date: b.date!, type: '' })), was.week!.from, was.week!.to, activePlaces(data.planning))])
  }
  const upperCount = upperWords(words) ?? was?.training?.upperCount ?? null
  const built = await buildTrainingPlan(sb, data, was?.training?.named ?? named, pins, { upperCount })
  if ('message' in built) { await say(sb, chatId, esc(built.message), undefined, { intent: 'plan' }); return }
  await sendCard(sb, chatId, built.payload, words, data.today, opts)
}

async function sendCard(sb: SupabaseClient, chatId: number, payload: PlanPayload, words: string, today: string,
  opts: { replaces?: { id: string } | null; onReplace?: () => Promise<void>; head?: string } = {}) {
  const body = trainText(payload, today)
  payload.summary = plain(body)
  if (opts.replaces) payload.replaces = opts.replaces.id
  const { data: row, error } = await sb.from('telegram_pending').insert({ kind: 'plan', text: words.trim().slice(0, 500) || 'training plan', payload }).select('id').single()
  if (error || !row) throw new Error(`Couldn’t hold the plan: ${error?.message ?? 'not saved'}`)
  await opts.onReplace?.()
  const msgId = await say(sb, chatId, `${opts.head ?? (opts.replaces ? '✏️ <b>Changed</b>\n' : '')}${body}\n\nNothing changes until you tap ✅ Apply.`, trainButtons(row.id, payload), { pending_id: row.id, intent: 'plan' })
  if (msgId) await sb.from('telegram_pending').update({ payload: { ...payload, card_message_id: msgId } }).eq('id', row.id)
}

// ---------------------------------------------------------------------------
// 🔁 Move one session: o:<card>:s<i> lists other days; p:<card>:s<i>_<yyyymmdd>_<l|m|h> (or _tbc, _keep) picks one
// ---------------------------------------------------------------------------

const pinsOf = (p: PlanPayload): Map<string, Pin> => new Map(p.blocks.map((b) => [b.key!, { date: b.date!, start: b.start, intensity: (b.intensity ?? 'heavy') as Intensity, place: b.placeKey ?? null }]))

/** The other days this session could go, best first (everything else re-fitted around it). */
export async function slotOptions(sb: SupabaseClient, data: ViewData, p: PlanPayload, i: number, base?: Map<string, Pin>): Promise<{ label: string; arg: string }[]> {
  const b = p.blocks[i]
  const world = await loadWorld(sb, data, p.week!)
  const t = p.training ?? p.yourWeek!.training
  const count = t.upperCount ?? t.upper?.count ?? null
  const wanted = ((b as { wanted?: string }).wanted ?? 'heavy') as Intensity
  const out: { label: string; arg: string; cost: number }[] = []
  for (let d = p.week!.from < data.today ? data.today : p.week!.from; d <= p.week!.to; d = addDays(d, 1)) {
    for (const lv of INTENSITIES.filter((x) => INTENSITIES.indexOf(x) <= INTENSITIES.indexOf(wanted)).reverse()) {
      if (d === b.date && lv === b.intensity) continue
      // the training card keeps everything else where it is; the Your week card re-fits the rest around it
      const pins = new Map(base ?? pinsOf(p))
      pins.set(b.key!, { date: d, intensity: lv })
      const plan = planTraining({ ...world, pins }, { only: t.only ?? null, pins, upperCount: count, compare: false })
      const s = plan.placed.find((x) => x.key === b.key)
      if (!s) continue
      out.push({ label: `${dowShort(d)} ${s.start} · ${lv}${s.why.startsWith('⚠️') ? ' ⚠️' : ''}`, arg: `s${i}_${d.replace(/-/g, '')}_${LETTER[lv]}`, cost: plan.cost })
      break   // the heaviest intensity that fits that day is enough; lighter is offered when it's cheaper
    }
  }
  return out.sort((a, b2) => a.cost - b2.cost).slice(0, 6).map(({ label, arg }) => ({ label, arg }))
}

/** 🔁 tapped: show where else it could go. */
export async function showSlotOptions(sb: SupabaseClient, chatId: number, id: string, p: PlanPayload, arg: string, data: ViewData) {
  const i = Number(arg.slice(1))
  const b = p.blocks[i]
  if (!b) { await say(sb, chatId, 'That session isn’t on the card any more.'); return }
  const opts = await slotOptions(sb, data, p, i, p.yourWeek ? new Map(Object.entries(p.yourWeek.training.pins ?? {})) : undefined)
  const rows: Button[][] = []
  for (let k = 0; k < opts.length; k += 2) rows.push(opts.slice(k, k + 2).map((o) => ({ text: o.label, callback_data: `p:${id}:${o.arg}` })))
  rows.push([{ text: `Lighter: ${b.intensity === 'heavy' ? 'moderate' : 'light'}`, callback_data: `p:${id}:s${i}_${b.date!.replace(/-/g, '')}_${b.intensity === 'heavy' ? 'm' : 'l'}` }, { text: 'Leave it out', callback_data: `p:${id}:s${i}_tbc` }])
  rows.push([{ text: '↩️ Keep it there', callback_data: `p:${id}:s${i}_keep` }])
  await say(sb, chatId, `🔁 <b>${esc(b.title)}</b> is ${day(b.date!)} ${b.start} (${b.intensity}). Where instead? <i>Best first; ⚠️ = goes against your load limits or rules.</i>`, rows, { pending_id: id, intent: 'plan' })
}

/** A new place picked: the card again with that session there and the rest as they were. */
export async function pickSlot(sb: SupabaseClient, chatId: number, card: { id: string; payload: PlanPayload & { card_message_id?: number | null } }, arg: string, data: ViewData) {
  const p = card.payload
  const m = arg.match(/^s(\d+)_(?:(\d{8})_([lmh])|(tbc)|(keep))$/)
  const b = m ? p.blocks[Number(m[1])] : null
  if (!m || !b) { await say(sb, chatId, 'That session isn’t on the card any more.'); return }
  if (m[5]) {   // keep: the same card again, with its buttons
    if (card.payload.card_message_id) await clearButtons(chatId, card.payload.card_message_id).catch(() => null)
    const msgId = await say(sb, chatId, `${trainText(p, data.today)}\n\nNothing changes until you tap ✅ Apply.`, trainButtons(card.id, p), { pending_id: card.id, intent: 'plan' })
    if (msgId) await sb.from('telegram_pending').update({ payload: { ...p, card_message_id: msgId } }).eq('id', card.id)
    return
  }
  const pins = pinsOf(p)
  if (!m[4]) pins.set(b.key!, { date: `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}`, intensity: FROM_LETTER[m[3]] })
  if (m[4]) pins.delete(b.key!)
  const built = await buildTrainingPlan(sb, data, p.training!.named, pins, { upperCount: p.training!.upperCount ?? null })
  if (m[4] && !('message' in built)) {
    // left out: drop it from the new card
    built.payload.blocks = built.payload.blocks.filter((x) => x.key !== b.key)
  }
  if ('message' in built) { await say(sb, chatId, esc(built.message)); return }
  const next = built.payload
  if (m[4]) next.training!.tbc = [...next.training!.tbc, { key: b.key!, title: b.title, reason: 'you left it out' }]
  await sb.from('telegram_pending').update({ status: 'replaced' }).eq('id', card.id).in('status', ['open', 'editing'])
  if (card.payload.card_message_id) await clearButtons(chatId, card.payload.card_message_id).catch(() => null)
  await sendCard(sb, chatId, next, `move ${b.title}`, data.today, { head: `✏️ <b>${esc(b.title)}</b> → ${m[4] ? 'left out' : `${day(pins.get(b.key!)!.date!)} (${pins.get(b.key!)!.intensity})`}\n` })
}
