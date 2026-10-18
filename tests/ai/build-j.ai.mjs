// Build 2, phase J (Whoop), AI check (REAL chat model, about $0.08 a run). Run: npm run test:ai
// Which Whoop workouts count toward a target, said in plain words; and on a low-recovery day, "what should I do
// tonight?" leaves training out (or keeps it light) and says why.
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { ctx, rows } = await import('./fixture.mjs')
rows.planning = {}
ctx.snapshot = ctx.snapshot.replace('## Reminders', '## Whoop (low recovery = below 34%: lighter training, protect sleep)\nFri 9 Oct: 71% recovery · HRV 64 · 7h 50m sleep · strain 12.4\nSat 10 Oct (today): 22% recovery · HRV 38 · 5h 10m sleep · strain 4.1 · LOW\n\n## Reminders')

const gym = new Set(['w2', 'w3'])
const CASES = [
  ['count my whoop weightlifting workouts toward upper body', (d, acts) => acts.some((a) => a.op === 'target_set' && a.id === 'w2' && /weightlifting/i.test((a.patch.whoop_sports ?? []).join(',')))],
  ['what should I do tonight?', (d) => d.intent === 'question' && !(d.answer?.plan ?? []).some((p) => gym.has(p.id)) && /recover/i.test(d.reply)],
]
let cost = 0, ok = 0
await Promise.all(CASES.map(async ([message, good]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
  const d = res.ok ? res.decision : { intent: 'failed', actions: [], reply: res.error }
  const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  const pass = good(d, actions)
  if (pass) ok++
  console.log(`${pass ? '✓' : '✗'} ${message.padEnd(60)} ${d.intent} “${(d.reply ?? '').slice(0, 140)}” ${(d.answer?.plan ?? []).map((p) => p.title).join(', ')} ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
}))
console.log(`\nRight: ${ok}/${CASES.length} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === CASES.length ? 0 : 1)
