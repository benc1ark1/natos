// Server-only: the instant answers that need more than one read (Build O): "how's my load this week?" (🧠 and 💪 per
// day), "what do you still need to know?" (the gap questions left) and "where can I save time?" (this week's
// suggestions). Plain code over his data, no AI; the other lists are lib/telegram/views.ts.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { costOf, dayLoads, intensityOf } from '../load'
import { mentalDays, DOT } from '../mental'
import { activeSessions, findSession, parseSessionTitle } from '../setup'
import { addDays, dowShort } from '../time'
import { fixedLoad } from '../week'
import type { Button } from './api'
import { esc } from './api'
import { gapsText } from './gapask'
import { loadMentalOverrides, loadWorld } from './ripple'
import { savingsText } from './roi'
import { nextText, trackerText, type MathsWorld } from '../maths'
import { loadStudy } from '../study-data'
import { moreSettings } from '../settings'
import type { Ref } from './turns'
import { render, ASYNC_VIEWS, type ViewData, type ViewRequest } from './views'

export type AnyRendered = { html: string; refs: Ref[]; buttons?: Button[][] }

/** Any view, the quick ones included. */
export async function renderAny(sb: SupabaseClient, d: ViewData, req: ViewRequest): Promise<AnyRendered> {
  if (!ASYNC_VIEWS.includes(req.view)) return render(d, req)
  if (req.view === 'gaps') return { html: await gapsText(sb, d), refs: [] }
  if (req.view === 'savings') return savingsText(sb, d)
  if (req.view === 'maths') {
    // item 1: the study tracker's maths view (as /maths); the old one until supabase/tracker.sql has run
    const [{ loadTracker }, { mathsView }] = await Promise.all([import('../tracker/bot-data'), import('../tracker/bot-views')])
    const t = await loadTracker(sb, d.today)
    if (!t.sqlMissing) return { html: mathsView(t), refs: [] }
  }
  if (req.view === 'maths' || req.view === 'mathsnext') {
    const w = await mathsWorld(sb, d)
    return { html: req.view === 'maths' ? trackerText(w, esc) : nextText(w, esc), refs: [] }
  }
  return { html: await loadText(sb, d), refs: [] }
}

const PDOT = { rest: '⚪', low: '🟢', med: '🟡', high: '🔴' } as const

/** The week's load: each day's 🧠 and 💪 from the calendar and the plan as applied. */
export async function loadText(sb: SupabaseClient, d: ViewData): Promise<string> {
  const w = await loadWorld(sb, d)
  const sessions = activeSessions(d.planning)
  const types = w.types ?? []
  // planned training blocks count with their session's cost
  const planned = w.planned.filter((b) => b.kind === 'training').map((b) => {
    const t = parseSessionTitle(b.title)
    const s = findSession(sessions, t.name)
    const type = s?.type ?? 'gym', intensity = t.intensity ?? s?.intensity ?? intensityOf('hard')
    return { key: b.id, title: t.name, type, intensity, date: b.on_date, start: b.start_time, end: b.end_time, fixed: false, cost: costOf({ title: t.name, type, intensity, date: b.on_date }, w.costs ?? [], types, w.load ?? (d.planning as never)) }
  })
  const days = dayLoads([...fixedLoad(w), ...planned], { from: w.from, to: w.to, settings: w.load! })
  const mental = mentalDays({ from: w.from, to: w.to, planning: d.planning, events: w.events, changes: w.changes, goals: d.goals, tasks: d.tasks, blocks: w.planned, overrides: await loadMentalOverrides(sb) })
  const lines = [`⚖️ <b>Your load</b> · ${dowShort(w.from)} – ${dowShort(w.to)}`]
  for (const x of days) {
    const m = mental.find((y) => y.date === x.date)
    lines.push(`<b>${x.date === d.today ? 'Today' : dowShort(x.date)}</b> 🧠${DOT[m?.level ?? 'low']} ${m?.total ?? 0} · 💪${PDOT[x.level]} ${x.total}${x.sessions.length ? ` — ${esc(x.sessions.map((s) => `${s.title}${s.intensity !== 'heavy' ? ` (${s.intensity})` : ''}`).join(', '))}` : ''}`)
  }
  const total = Math.round(days.reduce((a, x) => a + x.total, 0) * 10) / 10
  const high = mental.filter((m) => m.level === 'high').map((m) => dowShort(m.date))
  lines.push(`<i>💪 ${total} this week (limit ${w.load?.weekMaxLoad ?? 140} in any 7 days)${high.length ? ` · 🧠 high: ${high.join(', ')}` : ''}. 💪 = legs + upper + CNS; 🧠 = school, tutors, study, tests.</i>`)
  if (!planned.length) lines.push('<i>No training applied this week yet: “plan my week” gives you the Your week card.</i>')
  void addDays
  return lines.join('\n')
}

/** The optimiser's week for the brain: each session with its place, reason and what other days would cost; upper 2×/3×;
 *  vs Owen's days; each day's load; whether a week is applied. Plain code (no AI). */
export async function weekPlanForAI(sb: SupabaseClient, d: ViewData): Promise<string> {
  const { optWorldOf } = await import('../week')
  const { optimise, whyNot } = await import('../optimiser')
  const w = await loadWorld(sb, d)
  const ow = optWorldOf(w)
  const plan = optimise(ow, { compare: true })
  const applied = w.planned.filter((b) => b.kind === 'training')
  const lines = [`The optimiser's week (${dowShort(w.from)} ${w.from} – ${dowShort(w.to)} ${w.to})${applied.length ? `; he has applied ${applied.length} training block${applied.length === 1 ? '' : 's'} (see Plan blocks)` : '; no week applied yet'}:`]
  for (const p of plan.placed) {
    const alt = whyNot(ow, plan, p.key).filter((x) => Number.isFinite(x.delta)).slice(0, 3).map((x) => `${dowShort(x.date)} ${x.delta >= 0 ? '+' : ''}${x.delta} (${x.reason})`)
    lines.push(`- ${dowShort(p.date)} ${p.start}–${p.end} ${p.title}${p.label ? ` @ ${p.label}` : ''} · ${p.intensity}${p.before ? ` · leave ${p.from === 'school' ? 'school ' : ''}${addMinutes(p.start, -p.before)}` : ''} — why: ${p.why}${alt.length ? ` — other days cost: ${alt.join('; ')}` : ''}`)
  }
  for (const t of plan.tbc) lines.push(`- Not placed: ${t.title} (${t.reason})`)
  if (plan.upper) lines.push(`Upper ${plan.upper.reason}.`)
  if (plan.compare) lines.push(plan.compare)
  lines.push(`Load per day (💪 legs+upper+CNS): ${plan.days.map((x) => `${dowShort(x.date)} ${x.level} ${x.total}`).join(', ')}`)
  return lines.join('\n')
}

const addMinutes = (t: string, m: number) => { const x = Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) + m; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}` }

/** His maths world: subjects, topics with colours, tasks, tests and settings (lib/maths.ts). */
export async function mathsWorld(sb: SupabaseClient, d: ViewData): Promise<MathsWorld> {
  const [study, subjects] = await Promise.all([
    loadStudy(sb).catch(() => ({ stages: [], topics: [], progress: [], mistakes: [] })),
    sb.from('subjects').select('id,name').is('archived_at', null).then((r) => (r.data ?? []) as { id: string; name: string }[]),
  ])
  return { today: d.today, subjects, topics: study.topics, tasks: d.tasks, goals: d.goals, settings: moreSettings(d.planning) }
}
