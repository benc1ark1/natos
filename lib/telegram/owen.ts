// Server-only: "which days should I give Owen?" (Build O part 7). The optimiser plans a TYPICAL week (school, the
// sessions that come every week, the game on his usual day; nothing one-off, no tests, no Whoop) and picks the best
// days for Owen's sessions (speed, heavy lower, injury prevention, core). A ✅ card shows them with the reasons, a
// comparison with Owen's current suggestion and a ready-to-copy message for Owen; ✅ saves them as his Owen days (the
// planner then keeps Owen's sessions on them). If his weekly pattern changes later, it re-checks and tells him if he
// should update Owen (once per change).
import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEvents } from '../events'
import { mentalDays } from '../mental'
import { activeSessions, gameEvents, owenDays, DAY3, type DayMap } from '../setup'
import { addDays, isoDow, todayISO, weekStartISO } from '../time'
import { planTraining, type WeekWorld } from '../week'
import type { OptPlan } from '../optimiser'
import type { EventRow } from '../types'
import type { Action } from './actions'
import { clearButtons, esc } from './api'
import { claim } from './sent'
import { loadWorld } from './ripple'
import { plain, say } from './turns'
import { loadViewData, type ViewData } from './views'

const DAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** What comes every week: his own repeating events, and Google sessions with the same name on the same weekday and time. */
export function weeklyOnly(events: EventRow[], from: string, to: string): EventRow[] {
  const google = events.filter((e) => e.external_source === 'google' && !e.all_day)
  const occ = expandEvents(google, addDays(from, -28), addDays(to, 28), [])
  const count = new Map<string, number>()
  for (const o of occ) { const k = `${norm(o.event.title)}|${isoDow(o.date)}|${o.start}`; count.set(k, (count.get(k) ?? 0) + 1) }
  // a name that comes back on the same weekday and time: every copy of it stays (so the planner sees it's weekly)
  const titles = new Set([...count].filter(([, n]) => n >= 2).map(([k]) => k.split('|')[0]))
  return events.filter((e) => e.external_source !== 'setup' && e.external_source !== 'week' && (e.external_source === 'google' ? titles.has(norm(e.title)) : !!e.repeat_days?.length))
}

/** The best days for Owen's sessions in a typical week (the coming Mon–Sun, with only what repeats). */
export async function typicalOwenPlan(sb: SupabaseClient, data: ViewData): Promise<{ plan: OptPlan; days: DayMap; from: string }> {
  const from = addDays(weekStartISO(data.today), 7), to = addDays(from, 6)
  const world = await loadWorld(sb, data, { from, to })
  // compared with what Owen does now: the days already agreed with him, else his own suggestion
  const saved = owenDays(data.planning)
  const planning = { ...((data.planning ?? {}) as Record<string, unknown>), owenDays: null, gameWeeks: {}, ...(saved ? { owenBaseline: saved } : {}) }
  const events = [...weeklyOnly(world.events, from, to), ...gameEvents(from, to, planning, () => false)]
  const w: WeekWorld = {
    ...world, events, planned: [], energy: new Map(), tiredWhy: undefined, whoop: null, done: [], logs: [], weekCounts: [], pins: undefined, sent: [],
    planning, mental: mentalDays({ from: addDays(from, -1), to, planning, events, changes: world.changes, goals: [], tasks: [], blocks: [] }),
  }
  const plan = planTraining(w, { compare: true })
  const sessions = activeSessions(planning).filter((s) => s.owen)
  const days: DayMap = {}
  for (const s of sessions) {
    const list = plan.placed.filter((p) => plan.sessionOf[p.key] === s.key || (s.stackWith && plan.sessionOf[p.key] === s.stackWith)).map((p) => isoDow(p.date))
    if (list.length) days[s.key] = [...new Set(list)].sort()
  }
  return { plan, days, from }
}

/** "Hi Owen, …": the days, plus what's fixed in his week, ready to copy. */
export function owenMessage(days: DayMap, planning: unknown, plan: OptPlan): string {
  const sessions = activeSessions(planning)
  const byDay = new Map<number, string[]>()
  for (const [k, ds] of Object.entries(days)) for (const d of ds) byDay.set(d, [...(byDay.get(d) ?? []), sessions.find((s) => s.key === k)?.name.toLowerCase() ?? k])
  const parts = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([d, names]) => `${names.join(' and ')} on ${DAY_LONG[d - 1]}`)
  const fixed = [...new Set(plan.days.flatMap((x) => x.sessions.filter((s) => s.fixed).map((s) => `${s.title} ${DAY3[isoDow(x.date) - 1]}`)))]
  return `Hi Owen, the days I can train best are: ${parts.join(', ')}.${fixed.length ? ` My fixed sessions are ${fixed.join(', ')}.` : ''} Does that work for you?`
}

/** The card: Owen's days with the reasons, the comparison, the message; ✅ saves them. `head`: a line on top (a re-check). */
export async function proposeOwenDays(sb: SupabaseClient, chatId: number, data: ViewData, head?: string): Promise<boolean> {
  const { plan, days } = await typicalOwenPlan(sb, data)
  const sessions = activeSessions(data.planning).filter((s) => s.owen)
  if (!Object.keys(days).length) { await say(sb, chatId, 'I couldn’t fit Owen’s sessions into a typical week: check your set-up (“what do you still need to know?”).', undefined, { intent: 'question' }); return false }
  const lines = [head ?? '🗓 <b>Days to give Owen</b>', '<i>Worked out on a typical week: school, the sessions that come every week, and the game on your usual day.</i>', '']
  // the week's load warning is said once, not on every session
  const weekWarn = new Set<string>()
  const why = (text: string) => text.split(' · ').filter((x) => !(/^the 7 days to .* over the load limit/.test(x) && weekWarn.add(x))).join(' · ')
  for (const s of sessions) {
    const p = plan.placed.filter((x) => plan.sessionOf[x.key] === s.key || (s.stackWith && plan.sessionOf[x.key] === s.stackWith))
    if (!p.length) { lines.push(`• <b>${esc(s.name)}</b>: no good day (${esc(plan.tbc.find((t) => t.key.startsWith(`${s.key}#`))?.reason ?? 'no room')})`); continue }
    const reason = why(p[0].why)
    lines.push(`• <b>${esc(s.name)}</b>: <b>${p.map((x) => DAY3[isoDow(x.date) - 1]).join('/')}</b>${reason ? ` <i>— ${esc(reason)}</i>` : ''}`)
  }
  for (const x of weekWarn) lines.push(`⚠️ <i>${esc(x[0].toUpperCase() + x.slice(1))}.</i>`)
  // a session that only fits lighter than it should: the week pattern is too full for it, said plainly
  const squeezed = plan.placed.filter((x) => sessions.some((s) => s.key === plan.sessionOf[x.key]) && x.intensity !== x.wanted)
  const fixedTraining = [...new Set(plan.days.flatMap((x) => x.sessions.filter((s) => s.fixed).map((s) => `${s.title} ${DAY3[isoDow(x.date) - 1]}`)))]
  for (const x of squeezed) lines.push('', `⚠️ <b>No day suits a ${esc(x.wanted)} ${esc(x.title.toLowerCase())} with this week pattern</b> (${esc(fixedTraining.join(', '))}). Keeping fewer football sessions, or giving Owen a light session, would fix it.`)
  if (plan.compare) lines.push('', `<i>${esc(plan.compare)}</i>`)
  const msg = owenMessage(days, data.planning, plan)
  lines.push('', '📋 <b>Message for Owen</b> <i>(tap to copy)</i>:', `<code>${esc(msg)}</code>`, '', '<i>✅ saves these as your Owen days: the planner keeps his sessions on them each week.</i>')
  const name = (k: string) => sessions.find((s) => s.key === k)?.name ?? k
  const action: Action = { op: 'owen_days', table: 'profiles', id: 'owenDays', title: 'Owen’s days',
    line: `🗓 Owen’s days: <b>${esc(Object.entries(days).map(([k, d]) => `${name(k)} ${d.map((x) => DAY3[x - 1]).join('/')}`).join(', '))}</b>`, patch: { owenDays: days } }
  const body = lines.join('\n')
  const { data: row, error } = await sb.from('telegram_pending').insert({ kind: 'action', text: 'Owen’s days', payload: { actions: [action], problems: [], summary: plain(body), owen: { days, message: msg } } }).select('id').single()
  if (error || !row) throw new Error(`Couldn’t hold the card: ${error?.message ?? 'not saved'}`)
  const msgId = await say(sb, chatId, body, [[{ text: '✅ Use these days', callback_data: `a:${row.id}` }, { text: '✖ Not now', callback_data: `x:${row.id}` }]], { pending_id: row.id, intent: 'question' })
  if (msgId) await sb.from('telegram_pending').update({ payload: { actions: [action], problems: [], summary: plain(body), owen: { days, message: msg }, card_message_id: msgId } }).eq('id', row.id)
  return true
}

const same = (a: DayMap, b: DayMap) => JSON.stringify(Object.keys(a).sort().map((k) => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map((k) => [k, b[k]]))

/** His weekly pattern changed and Owen's days no longer fit best: tell him once per change (with the card). */
export async function recheckOwen(sb: SupabaseClient, chatId: number, data: ViewData): Promise<boolean> {
  const saved = owenDays(data.planning)
  if (!saved) return false
  const from = addDays(weekStartISO(data.today), 7)
  const pattern = weeklyOnly(data.events, from, addDays(from, 6)).map((e) => `${norm(e.title)}|${(e.repeat_days ?? []).join()}|${e.start_time ?? ''}`).sort().join(';')
  const key = `owen-recheck:${createHash('sha256').update(pattern + JSON.stringify(activeSessions(data.planning))).digest('hex').slice(0, 24)}`
  const { data: before } = await sb.from('telegram_sent').select('key').like('key', 'owen-recheck:%').limit(1)
  // an Owen card from the last week: still open (he hasn't answered) → no second one; checked again once it's closed
  const { data: recent } = await sb.from('telegram_pending').select('status, payload').eq('text', 'Owen’s days').gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).order('created_at', { ascending: false }).limit(1)
  if (recent?.[0]?.status === 'open') return false
  if (!(await claim(sb, key))) return false   // this pattern was checked already
  if (!before?.length) return false            // the first look: nothing has changed yet
  const { days } = await typicalOwenPlan(sb, data)
  const relevant = Object.fromEntries(Object.entries(saved).filter(([k]) => k in days))
  if (!Object.keys(days).length || same(relevant, days)) return false
  // the same days he was offered this week and said "not now" to: don't ask again
  const offered = (recent?.[0]?.payload as { owen?: { days?: Record<string, number[]> } } | undefined)?.owen?.days
  if (offered && same(offered, days)) return false
  return proposeOwenDays(sb, chatId, data, '🔄 <b>Your week pattern changed: Owen’s days may need updating</b>')
}

/** After his answers (the gap questions) or the clean-up: an Owen card still waiting is sent again if its days changed. */
export async function refreshOwenCard(sb: SupabaseClient, chatId: number, after = 'with your answers'): Promise<boolean> {
  const { data: open } = await sb.from('telegram_pending').select('id, payload').eq('text', 'Owen’s days').eq('status', 'open').order('created_at', { ascending: false }).limit(1)
  const card = open?.[0] as { id: string; payload: { owen?: { days?: DayMap }; card_message_id?: number | null } } | undefined
  if (!card?.payload.owen?.days) return false
  const data = await loadViewData(sb, todayISO())
  const { days } = await typicalOwenPlan(sb, data)
  if (!Object.keys(days).length || same(card.payload.owen.days, days)) return false
  const { data: mine } = await sb.from('telegram_pending').update({ status: 'replaced' }).eq('id', card.id).eq('status', 'open').select('id').maybeSingle()
  if (!mine) return false
  if (card.payload.card_message_id) await clearButtons(chatId, card.payload.card_message_id).catch(() => null)
  return proposeOwenDays(sb, chatId, data, `🔄 <b>Days to give Owen, ${esc(after)}</b>`)
}
