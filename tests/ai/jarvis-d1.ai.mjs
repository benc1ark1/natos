// Jarvis phase D1, AI check (REAL models: Sonnet routes, Opus plans; about $0.30–0.50 a run). Run: npm run test:ai
// 1. Routing: "plan my day / evening / tomorrow / 2 hours now / ill / wrecked" reach the planner with the right day,
//    window and energy. 2. Planning: the real planner + the app's placement on the made-up week. Code guarantees
//    the rules (checked again here: 100%); the AI must make sensible picks (the overdue-ish SMC first, nothing
//    heavy when ill, no training when tired, focus within the school-night limit).
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { buildPlan } = await import('../../lib/telegram/dayplan.ts')
const { planProblems, focusBudget } = await import('../../lib/plan.ts')
const { freeDays, DEFAULT_PLANNING } = await import('../../lib/freetime.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { ctx, events, now, rows } = await import('./fixture.mjs')

let cost = 0
const onUsage = async (model, u) => { cost += costOf(model, u) }
const results = []
const log = (ok, name, got, problems = []) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name.padEnd(52)} ${got}${ok ? '' : `   <- ${problems.join('; ')}`}`) }

// ---------------------------------------------------------------- 1. routing (Sonnet)
const ROUTES = [
  ['plan my day', (p) => p.date === '2026-10-10'],
  ['plan my evening', (p) => p.date === '2026-10-10' && (p.from === '17:00' || p.from === null)],
  ['plan tomorrow', (p) => p.date === '2026-10-11'],
  ['I’ve got 2 hours now', (p) => p.date === '2026-10-10' && p.minutes === 120],
  ['I’m ill today', (p) => p.energy === 'ill'],
  ['I’m wrecked after training, re-plan tonight', (p) => p.energy === 'tired'],
]
await Promise.all(ROUTES.map(async ([message, ok]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, onUsage)
  const d = res.ok ? res.decision : null
  const good = !!d && d.intent === 'plan' && ok(d.plan)
  log(good, message, d ? `${d.intent} ${JSON.stringify(d.plan)}` : res.error, good ? [] : ['wrong route'])
}))
// ("plan my week" is checked in jarvis-d2.ai.mjs)

// ---------------------------------------------------------------- 2. planning (Opus + code)
const data = { today: ctx.today, now, settings: DEFAULT_PLANNING, events, changes: [], tasks: [...rows.tasks.values()], plan: [] }
const PLANS = [
  ['this evening (Sat, free from 16:05)', { date: '2026-10-10', words: 'plan my evening' }, (p) => p.blocks.some((b) => b.ref?.id === 't2'), 'SMC (due Wed, put off 3×) is in it'],
  ['Thursday (school + football, school night)', { date: '2026-10-15', words: 'plan Thursday' }, (p) => p.blocks.every((b) => b.start >= '15:40'), 'nothing before school ends (15:30 + buffer)'],
  ['ill today', { date: '2026-10-10', energy: 'ill', words: 'I’m ill today' }, (p) => p.blocks.every((b) => b.kind === 'light' || b.kind === 'rest'), 'only light things or rest'],
  ['2 hours now', { date: '2026-10-10', minutes: 120, words: 'I’ve got 2 hours now' }, (p) => p.blocks.every((b) => b.end <= '18:05'), 'all done by 18:05'],
  ['tired tomorrow (Sun)', { date: '2026-10-11', energy: 'tired', words: 'plan tomorrow, I’m wrecked' }, (p) => !p.blocks.some((b) => b.kind === 'training'), 'no training'],
]
let rulesBroken = 0
await Promise.all(PLANS.map(async ([name, req, sensible, why]) => {
  const r = await buildPlan({ from: null, minutes: null, until: null, energy: null, ...req }, ctx, data, null, null, onUsage)
  if ('message' in r) { log(false, name, r.message, ['no plan']); return }
  const p = r.payload
  const [free] = freeDays(events, [], p.date, p.date, DEFAULT_PLANNING, ctx.today, 16 * 60 + 5)
  const budget = focusBudget(free.schoolNight, DEFAULT_PLANNING, p.energy)
  const broken = planProblems(p.blocks, free.slots, DEFAULT_PLANNING, budget)
  rulesBroken += broken.length
  const restLast = p.blocks.every((b, i) => b.kind !== 'rest' || i === p.blocks.length - 1)
  const problems = [...broken, ...(sensible(p) ? [] : [why]), ...(restLast ? [] : ['rest isn’t at the end of the day'])]
  log(!problems.length, name, p.blocks.map((b) => `${b.start} ${b.title.slice(0, 22)} (${b.kind})`).join(' · '), problems)
}))

const passed = results.filter(Boolean).length
console.log(`\nRight: ${passed}/${results.length} (need all, and 0 rules broken: ${rulesBroken})`)
console.log(`Cost of this run: $${cost.toFixed(3)}`)
process.exit(passed === results.length && rulesBroken === 0 ? 0 : 1)
