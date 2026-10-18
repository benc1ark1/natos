// Build 2, phase H, AI check (REAL chat model, about $0.20 a run). Run: npm run test:ai
// His settings, lists, events and targets, changed in plain words, must become the right change and pass the app's
// checks; ordinary messages still go the usual way, and what the app can't do is still an App idea.
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { settingsForAI, DEFAULT_MORE } = await import('../../lib/settings.ts')
const { DEFAULT_TYPES } = await import('../../lib/training.ts')
const { DEFAULT_SOURCES } = await import('../../lib/lists.ts')
const { ctx, rows } = await import('./fixture.mjs')
rows.planning = {}
ctx.snapshot = ctx.snapshot
  .replace('## Open tasks', `## About Nat (his own words; change with a setting action, key about)\n${DEFAULT_MORE.about}\n\n## Open tasks`)
  .replace('## Reminders', `## Settings (change with a setting action)\n${settingsForAI({}).join('\n')}\n\n## Training types (his list; change with list_edit, list=types)\n${DEFAULT_TYPES.map((t) => `- ${t.label} (key ${t.key}): ${t.load}; ${t.placeable ? 'the planner may place it in free time' : 'only at set times from the calendar'}; spotted from names with: ${t.words.join(', ')}`).join('\n')}\n\n## Task sources (where tasks come from; change with list_edit, list=sources)\n${DEFAULT_SOURCES.map((s) => `- ${s.label}`).join('\n')}\n\n## Reminders`)

const has = (a, o) => Object.entries(o).every(([k, v]) => JSON.stringify(a.patch[k]) === JSON.stringify(v))
const CASES = [
  ['send my morning brief at 7:30 instead', (d, acts) => acts.some((a) => a.op === 'setting' && a.patch.briefAt === '07:30')],
  ['do the weekly check-in on Saturdays from now on', (d, acts) => acts.some((a) => a.op === 'setting' && a.patch.checkinDay === 'saturday')],
  ['I’m in year 13 now and I’ve dropped SMC', (d, acts) => acts.some((a) => a.op === 'setting' && /13/.test(a.patch.about ?? '') && !/SMC maths challenge prep/.test(a.patch.about))],
  ['rename the CS tutor event to Computing tutor', (d, acts) => acts.some((a) => a.op === 'event_set' && a.id === 'CS tutor' && a.patch.title === 'Computing tutor')],
  ['upper sessions take 75 minutes', (d, acts) => acts.some((a) => a.op === 'target_set' && a.id === 'w2' && a.patch.session_minutes === 75)],
  ['upper should be 3 a week from now on', (d, acts) => acts.some((a) => a.op === 'target_set' && a.id === 'w2' && a.patch.target_count === 3)],
  ['add swimming as a training type, it’s light and you can fit it in anywhere', (d, acts) => acts.some((a) => a.op === 'list_edit' && a.patch.trainingTypes?.some((t) => /swim/i.test(t.label) && t.load === 'light' && t.placeable))],
  ['homework can also come from my new physics tutor Sam', (d, acts) => acts.some((a) => a.op === 'list_edit' && a.patch.sources?.some((s) => /sam/i.test(s.label)))],
  ['connect my Strava so runs count', (d) => d.intent === 'app_idea'],
  ['Physics homework due Friday', (d) => d.intent === 'new'],
  ['thanks', (d) => d.intent === 'chat'],
]
let cost = 0, ok = 0
await Promise.all(CASES.map(async ([message, good]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
  const d = res.ok ? res.decision : { intent: 'failed', actions: [], idea: null }
  const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  const pass = good(d, actions)
  if (pass) ok++
  console.log(`${pass ? '✓' : '✗'} ${message.padEnd(80)} ${d.intent}${d.idea ? ` “${d.idea}”` : ''} ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch).slice(0, 160)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
}))
console.log(`\nRight: ${ok}/${CASES.length} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === CASES.length ? 0 : 1)
