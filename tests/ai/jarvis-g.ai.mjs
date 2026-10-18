// Jarvis follow-ups (G), AI check (REAL chat model, about $0.20 a run). Run: npm run test:ai
// Journey ranges, the standing rule (can't do -> App idea), recurring events, settings and training types, said in
// plain words, must become the right change and pass the app's checks; ordinary messages must not become App ideas.
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { settingsForAI } = await import('../../lib/settings.ts')
const { ctx, rows } = await import('./fixture.mjs')
rows.places = [{ id: 'pl1', name: 'Home', address: null, lat: null, lng: null, is_home: true, archived_at: null }]
rows.planning = {}
ctx.snapshot = ctx.snapshot.replace('## Reminders', `## Places and journeys\n- Home (home)\n\n## Settings (change with a setting action)\n${settingsForAI({}).join('\n')}\n\n## Reminders`)

const has = (a, o) => Object.entries(o).every(([k, v]) => JSON.stringify(a.patch[k]) === JSON.stringify(v))
const CASES = [
  ['an Uber to Thursday football is 15 to 20 min, plus 0 to 8 min waiting for it', (d, acts) => acts.some((a) => a.op === 'travel_set' && a.patch.mode === 'uber' && /football/i.test(a.patch.to) && has(a, { minutes_low: 15, minutes: 20, wait_low: 0, wait_high: 8 }))],
  ['on Tuesdays the Uber to Owen training is 10-15 min + 0-8 wait', (d, acts) => acts.some((a) => a.op === 'travel_set' && /owen/i.test(a.patch.to) && has(a, { minutes_low: 10, minutes: 15, wait_low: 0, wait_high: 8, weekday: 2 }))],
  ['change how many hard sessions a day I can do to two', (d) => d.intent === 'app_idea'],   // renaming an event is an action since phase H
  ['connect my Strava so runs count', (d) => d.intent === 'app_idea'],
  ['football training every Monday and Wednesday 6 to 7:30pm', (d, acts) => acts.some((a) => a.op === 'event_weekly' && has(a, { repeat_days: [1, 3], start_time: '18:00', end_time: '19:30' }))],
  ['don’t plan anything after 10pm', (d, acts) => acts.some((a) => a.op === 'setting' && a.patch.dayEnd === '22:00')],
  ['Owen’s sessions are sprint sessions', (d, acts) => acts.some((a) => a.op === 'training_type' && a.id === 'Owen training' && a.patch.training_type === 'sprint')],
  ['Physics homework due Friday', (d) => d.intent === 'new'],
  ['what’s on tomorrow?', (d) => d.intent === 'question'],
  ['thanks', (d) => d.intent === 'chat'],
]
let cost = 0, ok = 0
await Promise.all(CASES.map(async ([message, good]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
  const d = res.ok ? res.decision : { intent: 'failed', actions: [], idea: null }
  const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  const pass = good(d, actions)
  if (pass) ok++
  console.log(`${pass ? '✓' : '✗'} ${message.padEnd(80)} ${d.intent}${d.idea ? ` “${d.idea}”` : ''} ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
}))
console.log(`\nRight: ${ok}/${CASES.length} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === CASES.length ? 0 : 1)
