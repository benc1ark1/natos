// Jarvis phase C1, AI check (REAL chat model, about $0.06 a run). Run: npm run test:ai
// "Change a saved record" messages: the brain must pick the right records and changes, and its proposals must
// pass the app's own checks (lib/telegram/actions.ts: real record, dates from his words, sane values).
// Pass marks: ≥ 90% exactly right, and 0 changes that complete or drop the wrong record.
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

const SAVED_KHAN = '[16:00] Nat: Email Mr Khan about UCAS\n[16:00] You: Task: Email Mr Khan about UCAS / nice / Nothing is saved until you tap ✅ Save.\n[16:01] Nat: (tapped ✅ Save)\n[16:01] You: ✅ Task saved to Today. (“Email Mr Khan about UCAS”)'
const CHANGE_CARD = 'A list of changes to saved records, not applied yet:\n🔧 Change\n• Physics homework: Due Fri → due Sun 11 Oct\nHis words: “move physics homework to tomorrow”'

// [message, wanted changes (op + record id + fields that must match), options]
const CASES = [
  ['move physics homework to tomorrow', [{ op: 'due', id: 't1', date: '2026-10-11' }]],
  ['done with the SMC paper', [{ op: 'complete', id: 't2' }]],
  ['drop the guitar idea', [{ op: 'drop', id: 't5' }]],
  ['star it', [{ op: 'star', id: 't3' }], { transcript: SAVED_KHAN }],
  ['physics homework will take an hour actually', [{ op: 'minutes', id: 't1', number: 60 }]],
  ['add the vectors video to football comeback', [{ op: 'project', id: 't4' }]],
  ['new project: learn music production', [{ op: 'project_new', value: /music production/i }]],
  ['PE kit reminder Thursday not Friday', [{ op: 'reminder_when', id: 'm2', date: '2026-10-15' }]],
  ['tick the Sam reminder', [{ op: 'reminder_done', id: 'm1' }]],
  ['coach set 3 lower this week', [{ op: 'target_week', id: 'w3', number: 3 }]],
  ['put the SMC paper in later', [{ op: 'move', id: 't2', status: 'this_month' }]],
  ['make the vectors video a must', [{ op: 'importance', id: 't4', value: 'must' }]],
  ['rename the Mr Khan email to "Email Mr Khan about predicted grades"', [{ op: 'rename', id: 't3' }]],
  ['move physics homework to tomorrow and star it', [{ op: 'due', id: 't1', date: '2026-10-11' }, { op: 'star', id: 't1' }]],
  ['no, Monday', [{ op: 'due', id: 't1', date: '2026-10-12' }], { card: CHANGE_CARD }],
]

let cost = 0
async function run([message, want, o = {}]) {
  const input = { now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: o.transcript ?? '', card: o.card ?? null, cardEditing: false, message, today: ctx.today }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await think(input, ctx, async (model, u) => { cost += costOf(model, u) })
    if (!res.ok) { if (attempt === 0) continue; return { message, ok: false, got: `error: ${res.error}`, problems: ['error'], wrong: 0 } }
    const d = res.decision
    const said = [o.transcript ?? '', message].join('\n')
    const { actions, problems: left } = checkActions(d.actions, ctx, rows, said, ctx.today)
    const problems = []
    const okIntents = o.anyIntent ?? ['instruction']
    if (!okIntents.includes(d.intent)) problems.push(`intent ${d.intent}`)
    for (const w of want) {
      const hit = actions.find((a) => a.op === w.op && (w.id === undefined || a.id === w.id)
        && (w.date === undefined || String(a.patch.due_at ?? a.patch.remind_on ?? '').startsWith(w.date))
        && (w.number === undefined || a.patch.duration_minutes === w.number || a.patch.target_count === w.number)
        && (w.status === undefined || a.patch.status === w.status)
        && (w.value === undefined || (w.value instanceof RegExp ? w.value.test(a.name ?? '') : a.patch.importance === w.value)))
      if (!hit) problems.push(`missing ${w.op} ${w.id ?? ''}`)
    }
    if (!want.length && actions.length) problems.push(`${actions.length} unexpected change(s)`)
    // the dangerous mistake: completing or dropping a record he didn't mean
    const wrong = actions.filter((a) => ['complete', 'drop', 'project_archive', 'reminder_done'].includes(a.op) && !want.some((w) => w.op === a.op && w.id === a.id)).length
    if (wrong) problems.push(`${wrong} WRONG RECORD FINISHED`)
    const got = `${d.intent} ${actions.map((a) => `${a.op}:${a.id ?? a.name}`).join(', ')}${left.length ? ` (left out: ${left.join('; ')})` : ''} — ${d.reply.slice(0, 70)}`
    return { message, ok: !problems.length, got, problems, wrong }
  }
}

const results = []
results.push(await run(CASES[0]))
for (let i = 1; i < CASES.length; i += 4) results.push(...(await Promise.all(CASES.slice(i, i + 4).map(run))))
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.message.padEnd(66)} ${r.got}${r.ok ? '' : `   <- ${r.problems.join('; ')}`}`)
const pct = (100 * results.filter((r) => r.ok).length) / results.length
const wrong = results.reduce((a, r) => a + r.wrong, 0)
console.log(`\nChanges exactly right: ${results.filter((r) => r.ok).length}/${results.length} (${pct.toFixed(0)}%, need ≥90%)`)
console.log(`Wrong records completed/dropped: ${wrong} (need 0)`)
console.log(`Cost of this run: $${cost.toFixed(3)}`)
process.exit(pct >= 90 && wrong === 0 ? 0 : 1)
