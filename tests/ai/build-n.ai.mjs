// Build 2, phase N (load-based training planner), AI check (REAL models, a few cents a run). Run: npm run test:ai
// 1. The chat model routes the new requests: "when's best for upper and Owen lower/plyo?" (training slots), his week
//    typed out (kept), load costs ("games are max load", "Wednesday training is high CNS"), rules as weighed
//    guidelines with intensity and hours, and a Google session's type by name ("Games isn't a match").
// 2. The week reader turns his typed-out week into the right dated items (and invents nothing).
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { readWeek } = await import('../../lib/telegram/weekread.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { DEFAULT_RULES, DEFAULT_TYPES } = await import('../../lib/training.ts')
const { ctx, rows } = await import('./fixture.mjs')

let cost = 0, ok = 0, total = 0
const mark = (pass, line) => { total++; if (pass) ok++; console.log(`${pass ? '✓' : '✗'} ${line}`) }

// the fixture, plus a Google "Games" session, his training rules and load costs
rows.planning = {}
rows.rules = DEFAULT_RULES
rows.costs = []
rows.titles = ['School', 'CS tutor', 'Owen training', 'Vlad (maths/physics tutor)', 'Football', 'Match', 'Games']
ctx.snapshot = ctx.snapshot
  .replace('Wed 14 Oct: 08:40–15:30 School;', 'Wed 14 Oct: 08:40–15:30 School; 13:20–15:00 Games (Google);')
  .replace('## Reminders', `## Training rules (refs for changes; guidelines the week planner weighs, with recovery load)\n${DEFAULT_RULES.map((r, i) => `TR${i + 1} | ${r.label}`).join('\n')}\n\n## Training load (recovery cost of a heavy session, 0–10: legs / upper / CNS; light and moderate are a % of it; change with load_set)\n- Match: 9 / 2 / 10\n- Upper: 1 / 9 / 5\n- Lower: 9 / 1 / 6\n- Football: 7 / 1 / 7\n\n## Reminders`)
DEFAULT_RULES.forEach((r, i) => ctx.refs.set(`TR${i + 1}`, { kind: 'rule', id: `default:${i}`, title: r.label, status: 'on', deadline: null }))

const WEEK = 'my week: Mon school 8:40-3:30, football training 6-7:30pm, CS tutor 8-9pm. Wed maths tutor 5-6pm then football 6:30-8. Thu CS tutor 7-8pm. Sat game 10:30am, Sun game 11am'
const CASES = [
  ['when’s best for upper body and Owen lower/plyo?', (d) => d.intent === 'plan' && Array.isArray(d.plan?.training) && d.plan.training.length === 2 && d.plan.training.some((x) => /upper/i.test(x)) && d.plan.training.some((x) => /lower|plyo/i.test(x))],
  ['where should my gym sessions go this week?', (d) => d.intent === 'plan' && d.plan?.week && Array.isArray(d.plan?.training) && d.plan.training.length >= 1],
  [WEEK, (d) => d.intent === 'plan' && d.plan?.training === 'note'],
  ['games are max load', (d, acts) => acts.some((a) => a.op === 'load_set' && a.patch.type_key === 'match' && a.patch.legs === 10 && a.patch.cns === 10)],
  ['Thursday football is high CNS', (d, acts) => acts.some((a) => a.op === 'load_set' && a.patch.title === 'Football' && a.patch.weekday === 4 && a.patch.cns >= 8)],
  ['light lower is ok the day before a game', (d, acts) => acts.some((a) => a.op === 'rule_set' && a.patch.params?.minLoad === 'moderate')],
  ['avoid heavy legs within 48h of a game', (d, acts) => acts.some((a) => a.op === 'rule_set' && a.patch.params?.hours === 48 && a.patch.params?.minLoad === 'hard' && a.patch.params?.near?.includes('match'))],
  ['Games isn’t a match, it’s just school PE', (d, acts) => acts.some((a) => a.op === 'training_type' && a.patch.by_title === 'Games' && a.patch.training_type === 'none')],
]
await Promise.all(CASES.map(async ([message, good]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
  const d = res.ok ? res.decision : { intent: 'failed', actions: [], reply: res.error }
  const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  mark(good(d, actions), `${message.slice(0, 46).padEnd(46)} ${d.intent}${d.plan ? ` training=${JSON.stringify(d.plan.training)}` : ''} ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
}))

// ---- 2. the week reader (Mon 12 – Sun 18 Oct)
const r = await readWeek(WEEK, { from: '2026-10-12', to: '2026-10-18' }, DEFAULT_TYPES, async (m, u) => { cost += costOf(m, u) })
const items = r.ok ? r.items : []
const has = (date, start, f) => items.some((i) => i.date === date && i.start === start && f(i))
const WANT = [
  ['Mon football 18:00–19:30', has('2026-10-12', '18:00', (i) => i.end === '19:30' && i.training_type === 'football')],
  ['Mon CS tutor 20:00', has('2026-10-12', '20:00', (i) => i.kind === 'tutor')],
  ['Mon school', has('2026-10-12', '08:40', (i) => i.kind === 'school')],
  ['Wed maths tutor 17:00', has('2026-10-14', '17:00', (i) => i.kind === 'tutor')],
  ['Wed football 18:30', has('2026-10-14', '18:30', (i) => i.training_type === 'football')],
  ['Thu CS tutor 19:00', has('2026-10-15', '19:00', (i) => i.kind === 'tutor')],
  ['Sat game 10:30 (match)', has('2026-10-17', '10:30', (i) => i.training_type === 'match')],
  ['Sun game 11:00 (match)', has('2026-10-18', '11:00', (i) => i.training_type === 'match')],
  ['nothing invented (8 items)', items.length === 8],
]
for (const [what, pass] of WANT) mark(pass, `week reader: ${what}`)
if (!r.ok) console.log(r.error)
else console.log(items.map((i) => `  ${i.date} ${i.start}–${i.end} ${i.title} (${i.kind}${i.training_type ? `, ${i.training_type}` : ''})`).join('\n'))

console.log(`\nRight: ${ok}/${total} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === total ? 0 : 1)
