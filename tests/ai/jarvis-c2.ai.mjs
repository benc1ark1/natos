// Jarvis phase C2, AI check (REAL chat model, about $0.05 a run). Run: npm run test:ai
// Calendar, test and goal changes: the brain must pick the right event/test and session, and its proposals must
// pass the app's own checks. Pass marks: ≥ 90% exactly right, 0 wrong events cancelled or archived.
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

// wanted: op, record id, and the fields that must match (on the checked change)
const CASES = [
  ['Owen moved training to Thursday 6pm this week', { op: 'event_move', id: 'Owen training', table: 'event_exceptions', usualDate: '2026-10-13', patch: { new_date: '2026-10-15', new_start: '18:00' } }],
  ['match cancelled Saturday', { op: 'event_cancel', id: 'Match' }],
  ['CS tutor is off this week', { op: 'event_cancel', id: 'CS tutor', table: 'event_exceptions', usualDate: '2026-10-12' }],
  ['dentist Tuesday 3pm', { op: 'event_new', patch: { starts_at: '2026-10-13T14:00:00.000Z' } }],
  ['dentist Thursday 4:30pm for half an hour', { op: 'event_new', patch: { starts_at: '2026-10-15T15:30:00.000Z', ends_at: '2026-10-15T16:00:00.000Z' } }],
  ['Physics test moved to Monday', { op: 'test_date', id: 'g1', patch: { target_date: '2026-10-12' } }],
  ['add moments to the physics test topics', { op: 'goal_topics', id: 'g1', topics: /moments/i }],
  ['football is on Fridays from now on', { op: 'event_move', id: 'Football', table: 'events', patch: { repeat_days: [5] } }],
  ['Vlad moved to 6pm this week', { op: 'event_move', id: 'Vlad (maths/physics tutor)', table: 'event_exceptions', usualDate: '2026-10-14', patch: { new_start: '18:00' } }],
  ['no school on Friday, it’s an inset day', { op: 'event_cancel', id: 'School', table: 'event_exceptions', usualDate: '2026-10-16' }],
]

let cost = 0
async function run([message, w]) {
  const input = { now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await think(input, ctx, async (model, u) => { cost += costOf(model, u) })
    if (!res.ok) { if (attempt === 0) continue; return { message, ok: false, got: `error: ${res.error}`, problems: ['error'], wrong: 0 } }
    const d = res.decision
    const { actions, problems: left } = checkActions(d.actions, ctx, rows, message, ctx.today)
    const problems = []
    if (d.intent !== 'instruction') problems.push(`intent ${d.intent}`)
    const hit = actions.find((a) => a.op === w.op && (w.id === undefined || a.id === w.id) && (w.table === undefined || a.table === w.table)
      && (w.usualDate === undefined || a.usualDate === w.usualDate)
      && Object.entries(w.patch ?? {}).every(([k, v]) => JSON.stringify(a.patch[k]) === JSON.stringify(v))
      && (w.topics === undefined || w.topics.test(String(a.patch.topics ?? ''))))
    if (!hit) problems.push(`missing ${w.op} ${w.id ?? ''}`)
    const wrong = actions.filter((a) => ['event_cancel', 'goal_archive'].includes(a.op) && !(a.op === w.op && a.id === w.id)).length
    if (wrong) problems.push(`${wrong} WRONG EVENT CANCELLED/ARCHIVED`)
    const got = `${d.intent} ${actions.map((a) => `${a.op}:${a.id ?? 'new'}${a.usualDate ? `@${a.usualDate}` : ''} ${JSON.stringify(a.patch)}`).join(', ')}${left.length ? ` (left out: ${left.join('; ')})` : ''}`
    return { message, ok: !problems.length, got: got.slice(0, 220), problems, wrong }
  }
}

const results = []
results.push(await run(CASES[0]))
for (let i = 1; i < CASES.length; i += 4) results.push(...(await Promise.all(CASES.slice(i, i + 4).map(run))))
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.message.padEnd(48)} ${r.got}${r.ok ? '' : `   <- ${r.problems.join('; ')}`}`)
const pct = (100 * results.filter((r) => r.ok).length) / results.length
const wrong = results.reduce((a, r) => a + r.wrong, 0)
console.log(`\nChanges exactly right: ${results.filter((r) => r.ok).length}/${results.length} (${pct.toFixed(0)}%, need ≥90%)`)
console.log(`Wrong events cancelled/archived: ${wrong} (need 0)`)
console.log(`Cost of this run: $${cost.toFixed(3)}`)
process.exit(pct >= 90 && wrong === 0 ? 0 : 1)
