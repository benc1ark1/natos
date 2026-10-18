// Jarvis phase E, AI check (REAL chat model, about $0.03 a run). Run: npm run test:ai
// Places and journeys said in plain words must become the right change, and pass the app's checks.
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
rows.places = [{ id: 'pl1', name: 'Home', address: null, lat: null, lng: null, is_home: true, archived_at: null }]
ctx.snapshot = ctx.snapshot.replace('## Reminders', '## Places and journeys\n- Home (home)\n\n## Reminders')

const kv = (v) => Object.fromEntries(String(v ?? '').split(';').map((x) => x.split('=').map((y) => y.trim())))
const CASES = [
  ['school to football is 25 min by bus', (a) => a.op === 'travel_set' && /school/i.test(a.patch.from) && /football/i.test(a.patch.to) && a.patch.minutes === 25 && a.patch.mode === 'bus'],
  ['football is at Hackney Marshes', (a) => a.op === 'event_place' && a.id === 'Football' && /hackney marshes/i.test(a.patch.new_place ?? '')],
  ['an Uber from home to the match takes about 20 minutes', (a) => a.op === 'travel_set' && a.patch.from === 'Home' && /match/i.test(a.patch.to) && a.patch.minutes === 20 && a.patch.mode === 'uber'],
  ['the tube from home to Vlad’s is 35 min', (a) => a.op === 'travel_set' && a.patch.from === 'Home' && a.patch.minutes === 35 && a.patch.mode === 'tube'],
  ['school is at E9 5PF', (a) => a.op === 'place_new' && /school/i.test(a.patch.name) && /E9 5PF/i.test(a.patch.address ?? '')],
]
let cost = 0, ok = 0
await Promise.all(CASES.map(async ([message, good]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
  const { actions, problems } = res.ok ? checkActions(res.decision.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  const pass = actions.some(good)
  if (pass) ok++
  console.log(`${pass ? '✓' : '✗'} ${message.padEnd(54)} ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
}))
console.log(`\nRight: ${ok}/${CASES.length} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === CASES.length ? 0 : 1)
