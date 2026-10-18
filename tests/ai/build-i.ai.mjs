// Build 2, phase I (Google Calendar), AI check (REAL chat model, about $0.10 a run). Run: npm run test:ai
// Which Google calendars to read, Life OS on/off per event, and read-only Google events, said in plain words.
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
rows.google = { id: 'gi1', calendars: [{ id: 'fam', name: 'Family', read: true, school: false }, { id: 'tt', name: 'Timetable 12B', read: true, school: false }] }
ctx.snapshot = ctx.snapshot
  .replace('Sun 11 Oct: nothing booked', 'Sun 11 Oct: 12:00–15:00 Grandma visit (Google)')
  .replace('## Reminders', '## Google Calendar\nConnected as nat@example.com; his sessions and plans go into his "Life OS" calendar; last sync 16:00.\n- Family: read\n- Timetable 12B: read\n\n## Reminders')

const CASES = [
  ['stop reading my family calendar', (d, acts) => acts.some((a) => a.op === 'calendar_set' && a.patch.calendars.find((c) => c.id === 'fam').read === false)],
  ['the timetable calendar is my school timetable', (d, acts) => acts.some((a) => a.op === 'calendar_set' && a.patch.calendars.find((c) => c.id === 'tt').school === true)],
  ['don’t put the match in google calendar', (d, acts) => acts.some((a) => a.op === 'event_set' && a.id === 'Match' && a.patch.sync_google === false)],
  // a reply only (an instruction with no change would be saved as an App idea)
  ['move grandma’s visit to 2pm', (d, acts) => acts.length === 0 && ['chat', 'unclear'].includes(d.intent) && /google/i.test(d.reply)],
  ['connect my google calendar', (d, acts) => acts.length === 0 && ['chat', 'unclear'].includes(d.intent) && /setting/i.test(d.reply)],
  ['Physics homework due Friday', (d) => d.intent === 'new'],
]
let cost = 0, ok = 0
await Promise.all(CASES.map(async ([message, good]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
  const d = res.ok ? res.decision : { intent: 'failed', actions: [], idea: null, reply: res.error }
  const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  const pass = good(d, actions)
  if (pass) ok++
  console.log(`${pass ? '✓' : '✗'} ${message.padEnd(50)} ${d.intent} “${(d.reply ?? '').slice(0, 90)}” ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch).slice(0, 120)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
}))
console.log(`\nRight: ${ok}/${CASES.length} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === CASES.length ? 0 : 1)
