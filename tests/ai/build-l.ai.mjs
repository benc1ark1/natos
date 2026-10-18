// Build 2, phase L (guides), AI check (REAL chat model, about $0.08 a run). Run: npm run test:ai
// A how-do-I question is answered from the guide's own steps; weekly-log and guide additions become the right change.
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { relevantGuides, guidesForAI } = await import('../../lib/guides-search.ts')
const { ctx, rows } = await import('./fixture.mjs')
const guides = [
  { id: 'g1', title: 'Skincare & Grooming', body: '## Recovery night\n1. Gentle cleanser\n2. Azelaic acid\n3. Thick moisturiser\n## Normal night\n1. Cleanser\n2. Retinol', has_log: false },
  { id: 'g2', title: 'Athletic & Lower', body: 'Fixed: 10 min warm-up, hops before squats.', has_log: true },
  { id: 'g3', title: 'Sleep', body: 'Lights out 22:30. No screens after 22:00.', has_log: false },
]
ctx.guides = guides
ctx.snapshot = ctx.snapshot.replace('## Facts about Nat', `## Guides (his how-to pages; any that match his message are given in <guides>)\n${guides.map((g) => `- ${g.title}`).join('\n')}\n\n## Facts about Nat`)
rows.guides = guides
rows.planning = {}

const CASES = [
  ['what’s my recovery-night skincare?', (d) => d.intent === 'question' && /azelaic/i.test(d.reply) && !/retinol/i.test(d.reply)],
  ['coach set 3x5 back squats and 4x3 box jumps this week', (d, acts) => acts.some((a) => a.op === 'guide_log' && a.id === 'g2' && /squat/i.test(a.patch.body))],
  ['add magnesium 30 min before bed to my sleep guide', (d, acts) => acts.some((a) => a.op === 'guide_note' && a.id === 'g3' && /magnesium/i.test(a.patch.body))],
  ['Physics homework due Friday', (d) => d.intent === 'new'],
]
let cost = 0, ok = 0
await Promise.all(CASES.map(async ([message, good]) => {
  const g = relevantGuides(guides, message)
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today, guides: g.length ? guidesForAI(g) : undefined }, ctx, async (m, u) => { cost += costOf(m, u) })
  const d = res.ok ? res.decision : { intent: 'failed', actions: [], reply: res.error }
  const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  const pass = good(d, actions)
  if (pass) ok++
  console.log(`${pass ? '✓' : '✗'} ${message.padEnd(56)} ${d.intent} “${(d.reply ?? '').slice(0, 110)}” ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch).slice(0, 100)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
}))
console.log(`\nRight: ${ok}/${CASES.length} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === CASES.length ? 0 : 1)
