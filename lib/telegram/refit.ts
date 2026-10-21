// Server-only: keeping the week right as things change (Build O parts 4 and 11). After a change (an answer to a gap
// question, a cancelled session, new homework, low Whoop, a game moved…), the optimiser works the week out again
// and only what's affected moves:
// - a Your week card still waiting for ✅ is sent again, re-planned (the study the AI picked is kept: no new AI call);
// - a week already applied gets a short "moved X to Thu — ✅?" card (its knock-on; nothing moves until he taps).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPlannerContext } from '../ask/server'
import { addDays, dowShort, todayISO } from '../time'
import { ripple, type Ripple } from '../week'
import { esc } from './api'
import type { PlanPayload } from './dayplan'
import { loadWorld, rippleLines } from './ripple'
import { plain, say } from './turns'
import { loadViewData, type ViewData } from './views'
import { buildYourWeek, yourWeekButtons, yourWeekText } from './yourweek'

type Card = { id: string; payload: PlanPayload & { card_message_id?: number | null }; created_at: string }

/** The newest Your week card still waiting for ✅ (last 36 hours). */
export async function openWeekCard(sb: SupabaseClient): Promise<Card | null> {
  const since = new Date(Date.now() - 36 * 3_600_000).toISOString()
  const { data } = await sb.from('telegram_pending').select('id,payload,created_at').eq('kind', 'plan').in('status', ['open', 'editing']).gte('created_at', since)
    .order('created_at', { ascending: false }).limit(5)
  return ((data ?? []) as Card[]).find((c) => !!c.payload?.yourWeek) ?? null
}

/** What the change knocks on in the week as applied (empty if nothing's applied, or nothing has to move). */
export async function appliedKnockOn(sb: SupabaseClient, data: ViewData, days?: string[]): Promise<Ripple> {
  const world = await loadWorld(sb, data)
  if (!world.planned.some((b) => b.on_date >= world.today)) return { moves: [], warnings: [], tbc: [] }
  // the change is already saved: compare the plan as it is with where the optimiser now puts things. Only what has to
  // move does: a time that's busy now, a rule it now breaks, or (on the days the change is about) a better place.
  const r = ripple(world, world)
  const onDay = (m: Ripple['moves'][number]) => !!days?.some((d) => m.from.startsWith(`${dowShort(d)} ${+d.slice(8)} `))
  const moves = r.moves.filter((m) => (m.reason !== 'the week changed' && !/ today: /.test(m.reason)) || onDay(m))
  // a move that lands on a block whose own move was left out: that block moves too (never two on top of each other)
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
  for (let again = true; again;) {
    again = false
    for (const x of r.moves) {
      const b = moves.includes(x) ? null : world.planned.find((p) => p.id === x.blockId)
      if (b && moves.some((k) => k.to && k.to.date === b.on_date && m(k.to.start) < m(b.end_time) && m(b.start_time) < m(k.to.end))) { moves.push(x); again = true }
    }
  }
  r.moves = moves
  return r
}

/** Re-plan after a change. Returns what it sent: 'week' (the card again), 'moves' (a knock-on card) or null. */
export async function refitAfterChange(sb: SupabaseClient, chatId: number, why: string, opts: { days?: string[]; data?: ViewData } = {}): Promise<'week' | 'moves' | null> {
  const data = opts.data ?? await loadViewData(sb, todayISO())
  const card = await openWeekCard(sb)
  if (card) {
    const y = card.payload.yourWeek!
    const ctx = await loadPlannerContext(sb)
    const built = await buildYourWeek(sb, data, ctx, '', { range: card.payload.week!, pins: new Map(Object.entries(y.training.pins ?? {})), upperCount: y.training.upperCount ?? null, left: y.training.left ?? [], studyItems: y.studyItems, review: y.review, recs: y.recs })
    if ('message' in built) return null
    const p = built.payload
    const body = yourWeekText(p, data.today)
    p.summary = plain(body).slice(0, 3000)
    p.replaces = card.id
    const { data: row } = await sb.from('telegram_pending').insert({ kind: 'plan', text: `your week (${why})`, payload: p }).select('id').single()
    if (!row) return null
    await sb.from('telegram_pending').update({ status: 'replaced' }).eq('id', card.id).in('status', ['open', 'editing'])
    const { clearButtons } = await import('./api')
    if (card.payload.card_message_id) await clearButtons(chatId, card.payload.card_message_id).catch(() => null)
    const msgId = await say(sb, chatId, `🔄 <b>Your week, re-planned ${esc(why)}</b>\n${body}\n\nNothing changes until you tap ✅ Apply.`, yourWeekButtons(row.id, p), { pending_id: row.id, intent: 'plan' })
    if (msgId) await sb.from('telegram_pending').update({ payload: { ...p, card_message_id: msgId } }).eq('id', row.id)
    return 'week'
  }
  const r = await appliedKnockOn(sb, data, opts.days)
  if (!r.moves.length) return null
  const payload: PlanPayload = { date: data.today, energy: 'normal', energyGiven: false, add: true, blocks: [], unplaced: [], note: '', pushBack: '', ripple: r, week: { from: data.today, to: addDays(data.today, 6) } }
  const lines = [`↪️ <b>Re-planned ${esc(why)}</b>`, ...r.moves.map((m) => `• ${esc(m.title)}: ${esc(m.from)} → ${m.to ? `${dowShort(m.to.date)} ${m.to.start}${m.to.title !== m.title ? ` (${esc(m.to.title)})` : ''}` : 'dropped'} <i>(${esc(m.reason)})</i>`), ...r.warnings.map((w) => `⚠️ ${esc(w)}`)]
  void rippleLines
  payload.summary = plain(lines.join('\n'))
  const { data: row } = await sb.from('telegram_pending').insert({ kind: 'plan', text: `re-plan (${why})`, payload }).select('id').single()
  if (!row) return null
  await say(sb, chatId, `${lines.join('\n')}\n\n✅ to move ${r.moves.length === 1 ? 'it' : 'them'}?`, [[{ text: '✅ Move', callback_data: `a:${row.id}` }, { text: '❌ Keep as is', callback_data: `x:${row.id}` }]], { pending_id: row.id, intent: 'plan' })
  return 'moves'
}
