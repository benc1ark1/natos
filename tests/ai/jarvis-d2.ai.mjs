// Jarvis phase D2, AI check (REAL models; about $0.25 a run). Run: npm run test:ai
// 1. Routing: "plan my week", training types and rules said in plain words reach the right change.
// 2. Plan my week on the made-up week (Mon 12 – Sun 18 Oct): the gym sessions come from code (0 rule breaks),
//    study comes from Opus, placed by code; nothing after its deadline; school days after school.
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { buildWeekPlan } = await import('../../lib/telegram/dayplan.ts')
const { DEFAULT_RULES, ruleProblems } = await import('../../lib/training.ts')
const { fixedSessions } = await import('../../lib/week.ts')
const { DEFAULT_PLANNING } = await import('../../lib/freetime.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { ctx, events, rows } = await import('./fixture.mjs')

let cost = 0
const onUsage = async (model, u) => { cost += costOf(model, u) }
const results = []
const log = (ok, name, got, problems = []) => { results.push(ok); console.log(`${ok ? '✓' : '✗'} ${name.padEnd(46)} ${got}${ok ? '' : `   <- ${problems.join('; ')}`}`) }
rows.rules = DEFAULT_RULES
const input = (message) => ({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today })

// the fixture snapshot gets the training rules section the real one has
ctx.snapshot = ctx.snapshot.replace('## Reminders', `## Training rules (refs for changes; the app enforces these)\n${DEFAULT_RULES.map((r, i) => `TR${i + 1} | ${r.label}`).join('\n')}\n\n## Reminders`)
DEFAULT_RULES.forEach((r, i) => ctx.refs.set(`TR${i + 1}`, { kind: 'rule', id: `default:${i}`, title: r.label, status: 'on', deadline: null }))

// ---------------------------------------------------------------- 1. routing
const ROUTES = [
  ['plan my week', (d) => d.intent === 'plan' && d.plan?.week === true],
  ['can you re-plan the week', (d) => d.intent === 'plan' && d.plan?.week === true],
  ['Owen’s sessions are sprints', (d, a) => a.some((x) => x.op === 'training_type' && x.id === 'Owen training' && x.patch.training_type === 'sprint')],
  ['no plyo within 24 hours of a match, either side', (d, a) => a.some((x) => x.op === 'rule_set' && x.patch.params?.what?.includes('plyo') && x.patch.params?.near?.includes('match') && x.patch.params?.side === 'both')],
  ['switch off the double-day rule', (d, a) => a.some((x) => x.op === 'rule_off' && x.id === '3')],
]
await Promise.all(ROUTES.map(async ([message, ok]) => {
  const res = await think(input(message), ctx, onUsage)
  if (!res.ok) { log(false, message, res.error, ['error']); return }
  const { actions } = checkActions(res.decision.actions, ctx, rows, message, ctx.today)
  const good = ok(res.decision, actions)
  log(good, message, `${res.decision.intent} ${actions.map((a) => `${a.op}:${a.id}`).join(', ')} ${res.decision.plan ? JSON.stringify(res.decision.plan) : ''}`, good ? [] : ['wrong'])
}))

// ---------------------------------------------------------------- 2. plan my week
const evs = events.map((e) => ({ ...e, training_type: e.title === 'Owen training' ? 'sprint' : null }))
const targets = [...rows.targets.values()].map((t) => ({ ...t, is_active: true }))
const world = {
  today: ctx.today, nowMin: 16 * 60 + 5, from: '2026-10-12', to: '2026-10-18', settings: DEFAULT_PLANNING,
  events: evs, changes: [], targets, logs: [], weekCounts: [], rules: DEFAULT_RULES, energy: new Map(), planned: [],
}
const r = await buildWeekPlan(world, ctx, 'plan my week', null, onUsage)
if ('message' in r) log(false, 'plan my week (Mon 12 – Sun 18)', r.message, ['no plan'])
else {
  const p = r.payload
  const problems = []
  const training = p.blocks.filter((b) => b.kind === 'training')
  const broken = ruleProblems([...fixedSessions(world), ...training.map((b) => ({ date: b.date, start: b.start, type: b.title === 'Lower' ? 'lower' : 'upper', load: 'hard', title: b.title, fixed: false, key: `${b.title}${b.date}` }))], DEFAULT_RULES)
    .filter((x) => x.keys.some((k) => !k.startsWith('event:')))
  if (broken.length) problems.push(`rules broken: ${broken.map((x) => x.text).join('; ')}`)
  if (!training.some((b) => b.title === 'Lower')) problems.push('Lower not placed')
  const deadlines = new Map([...ctx.refs.values()].filter((x) => x.kind === 'task').map((x) => [x.id, x.deadline]))
  const late = p.blocks.filter((b) => b.ref?.kind === 'task' && deadlines.get(b.ref.id) && b.date > deadlines.get(b.ref.id))
  if (late.length) problems.push(`after its deadline: ${late.map((b) => b.title).join(', ')}`)
  const school = p.blocks.filter((b) => b.kind !== 'training' && ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].includes(b.date) && b.start < '15:30')
  if (school.length) problems.push(`study during/before school: ${school.map((b) => `${b.date} ${b.start}`).join(', ')}`)
  const phys = p.blocks.find((b) => b.ref?.id === 't1')
  if (!phys) problems.push('Physics homework (due Fri) not planned')
  log(!problems.length, 'plan my week (Mon 12 – Sun 18)', p.blocks.map((b) => `${b.date.slice(8)} ${b.start} ${b.title.slice(0, 16)}`).join(' · ').slice(0, 300), problems)
}

const passed = results.filter(Boolean).length
console.log(`\nRight: ${passed}/${results.length} (need all)`)
console.log(`Cost of this run: $${cost.toFixed(3)}`)
process.exit(passed === results.length ? 0 : 1)
