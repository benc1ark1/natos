// A long casual message about several sessions (AI check, REAL model, a few cents a run).
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs tests/ai/multi-part.ai.mjs
// The chat model must send ONE instruction with every session (day, evening time, place, be-there time, football)
// and each Uber home either as a journey or as a quick-tap question: never just the first session, never a week note.
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

const MESSAGE = 'I have training Monday for Club 360 Talent, 8 get there to 10 end at Christchurch Finchley College, Uber back; Wednesday same club 7:45 be there, ends 9:30 at 24 Tiverton Road, Uber back'
const RUNS = Number(process.env.RUNS ?? 3)   // the model isn't deterministic: every run must pass
let cost = 0, ok = 0

const session = (acts, dow, start, end, place) => acts.find((a) => a.op === 'event_weekly' && a.patch.repeat_days?.join() === `${dow}`
  && a.patch.start_time === start && a.patch.end_time === end && a.patch.training_type === 'football' && /be there/.test(a.line)
  && (a.patch.new_place ?? '').toLowerCase().includes(place))
// "Uber back" from a place: a journey home by Uber in the card, or a question whose every answer is one
const uberHome = (place, acts, asks) => {
  const isIt = (a) => a.op === 'travel_set' && a.patch.mode === 'uber' && String(a.patch.from).toLowerCase().includes(place) && /^home$/i.test(String(a.patch.to))
  return acts.some(isIt) || asks.some((q) => q.options.length >= 2 && q.options.every((o) => o.actions.some(isIt)))
}

for (let i = 0; i < RUNS; i++) {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message: MESSAGE, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
  if (!res.ok) { console.log(`✗ run ${i + 1}: ${res.error}`); continue }
  const d = res.decision
  const { actions, problems } = checkActions(d.actions, ctx, rows, MESSAGE, ctx.today)
  const asks = d.asks.map((q) => ({ question: q.question, options: q.options.map((o) => ({ label: o.label, actions: checkActions([...d.actions, ...o.actions], ctx, rows, MESSAGE, ctx.today).actions.slice(actions.length) })) }))
  const checks = {
    instruction: d.intent === 'instruction',
    'Mon 20:00–22:00 at Christchurch Finchley College': !!session(actions, 1, '20:00', '22:00', 'christchurch'),
    'Wed 19:45–21:30 at 24 Tiverton Road': !!session(actions, 3, '19:45', '21:30', 'tiverton'),
    'Uber home (Mon)': uberHome('christchurch', actions, asks),
    'Uber home (Wed)': uberHome('tiverton', actions, asks),
    'nothing left out': !problems.length,
  }
  const pass = Object.values(checks).every(Boolean)
  if (pass) ok++
  console.log(`${pass ? '✓' : '✗'} run ${i + 1}: ${d.intent}`)
  for (const [k, v] of Object.entries(checks)) if (!v) console.log(`    missing: ${k}`)
  for (const a of actions) console.log(`    • ${a.line.replace(/<[^>]+>/g, '')}`)
  for (const q of asks) console.log(`    ❓ ${q.question} [${q.options.map((o) => o.label).join(' | ')}]`)
  if (problems.length) console.log(`    left out: ${problems.join('; ')}`)
}
console.log(`\nRight: ${ok}/${RUNS} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === RUNS ? 0 : 1)
