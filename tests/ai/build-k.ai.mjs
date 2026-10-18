// Build 2, phase K (study pipelines), AI check (REAL models, about $0.10 a run). Run: npm run test:ai
// 1. The sorter (Haiku): "finished the Bicen video on matrices" is study progress on the right topic and stage; a
//    mistake is a mistake; "I still don't understand vectors" is NOT progress.
// 2. The brain (Sonnet): study progress and mistakes are new items; pipelines and topics change by chat; "what should
//    I study tonight?" suggests the next pipeline action.
import { readFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const cap = await import('../../lib/capture/server.ts')
const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { costOf, SORT_MODEL } = await import('../../lib/ai/models.ts')
const { ctx, rows } = await import('./fixture.mjs')

// ---- the sorter, with two subjects' pipelines
const st = (id, subject_id, name, sort_order) => ({ id, subject_id, name, sort_order, archived_at: null })
const tp = (id, subject_id, name, sort_order) => ({ id, subject_id, name, spec_ref: null, notes_url: null, sort_order, archived_at: null })
const study = {
  stages: [st('v', 'fm', 'Bicen video', 0), st('n', 'fm', 'GoodNotes notes', 1), st('q', 'fm', 'Textbook questions', 2), st('e', 'fm', 'Exam questions', 3), st('pv', 'ph', 'Video', 0), st('pq', 'ph', 'Questions', 1)],
  topics: [tp('cx', 'fm', 'Complex numbers', 0), tp('mx', 'fm', 'Matrices', 1), tp('vc', 'ph', 'Vectors', 0), tp('mo', 'ph', 'Moments', 1)],
  progress: [], mistakes: [],
}
const capCtx = {
  today: '2026-10-10', now: '16:05', subjects: [{ id: 'fm', name: 'Further Maths', category_id: null }, { id: 'ph', name: 'Physics', category_id: null }],
  projects: [], targets: [], events: [], changes: [], tests: [], facts: [], openTasks: [], reminders: [], resources: [], loggedToday: [], planning: {}, study,
}
const client = new Anthropic()
let cost = 0, ok = 0, total = 0
async function sort(text) {
  const res = await client.messages.create({ model: SORT_MODEL, max_tokens: 1024, system: cap.SYSTEM_PROMPT, messages: [{ role: 'user', content: cap.contextMessage(text, capCtx) }], output_config: { format: { type: 'json_schema', schema: cap.OUTPUT_SCHEMA } } })
  cost += costOf(res.model ?? SORT_MODEL, res.usage)
  return cap.checkProposal(cap.nullify(JSON.parse(res.content.find((b) => b.type === 'text').text)), text, capCtx)
}
const SORTS = [
  ['finished the Bicen video on matrices', (p) => p.kind === 'study' && p.topic_id === 'mx' && p.stage_id === 'v'],
  ['did the exam questions for complex numbers', (p) => p.kind === 'study' && p.topic_id === 'cx' && p.stage_id === 'e'],
  ['done with vectors questions', (p) => p.kind === 'study' && p.topic_id === 'vc' && p.stage_id === 'pq'],
  ['Q5 wrong on moments: forgot the sign', (p) => p.kind === 'mistake' && p.topic_id === 'mo' && p.subject_id === 'ph'],
  // my-spec 9: "keep that as something to revisit": a task, an idea or a mistake to review all do that; progress doesn't
  ['I still don’t understand vectors properly', (p) => p.kind !== 'study'],
  ['Physics homework due Friday', (p) => p.kind === 'task'],
]

// ---- the brain, with a Study section in its snapshot
ctx.snapshot = ctx.snapshot.replace('## Calendar, next 14 days', '## Study: next action per topic (his pipelines; up to 2 per subject)\nST1 | Further Maths: Matrices — GoodNotes notes (stage 2/4)\nST2 | Further Maths: Complex numbers — Bicen video (stage 1/4)\nPipelines:\n- Further Maths: Bicen video → GoodNotes notes → Textbook questions → Exam questions · 2 topics\n- Physics: (no stages yet) · 0 topics\n\n## Mistakes to come back to (quick reviews)\nX1 | Physics · Vectors: Q5 sign error | review now\n\n## Calendar, next 14 days')
ctx.refs.set('ST1', { kind: 'topic', id: 'mx', title: 'Further Maths: Matrices — GoodNotes notes', status: null, deadline: null })
ctx.refs.set('ST2', { kind: 'topic', id: 'cx', title: 'Further Maths: Complex numbers — Bicen video', status: null, deadline: null })
ctx.refs.set('X1', { kind: 'mistake', id: 'm1', title: 'Review: Q5 sign error', status: null, deadline: '2026-10-10' })
rows.planning = {}
rows.study = { ...study, mistakes: [{ id: 'm1', subject_id: 'ph', topic_id: 'vc', body: 'Q5 sign error', logged_on: '2026-10-07', review_on: '2026-10-10', reviewed_at: null, archived_at: null }], subjects: capCtx.subjects }
const BRAINS = [
  ['finished the Bicen video on matrices', (d) => d.intent === 'new'],
  ['Q5 on the vectors sheet was wrong, I mixed up the sign', (d) => d.intent === 'new'],
  ['my physics pipeline is video, notes, textbook questions, exam questions', (d, acts) => acts.some((a) => a.op === 'stage_set' && a.id === 'ph' && a.patch.stages.length === 4)],
  // Vectors and Moments are already there: only Projectiles is new
  ['add vectors, moments and projectiles to physics topics', (d, acts) => acts.some((a) => a.op === 'topic_new' && a.id === 'ph' && a.patch.topics.join() === 'Projectiles')],
  ['I’ve gone over the Q5 sign mistake', (d, acts) => acts.some((a) => a.op === 'mistake_done' && a.id === 'm1')],
  ['what should I study tonight?', (d) => d.intent === 'question' && (d.answer?.plan ?? []).some((p) => p.kind === 'topic' || p.kind === 'mistake')],
]

await Promise.all([
  ...SORTS.map(async ([text, good]) => {
    total++
    const p = await sort(text)
    const pass = good(p)
    if (pass) ok++
    console.log(`${pass ? '✓' : '✗'} sort  ${text.padEnd(60)} ${p.kind} topic=${p.topic_id} stage=${p.stage_id} subject=${p.subject_id}${p.notes.length ? ` (${p.notes.join('; ')})` : ''}`)
  }),
  ...BRAINS.map(async ([message, good]) => {
    total++
    const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today }, ctx, async (m, u) => { cost += costOf(m, u) })
    const d = res.ok ? res.decision : { intent: 'failed', actions: [], reply: res.error }
    const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
    const pass = good(d, actions)
    if (pass) ok++
    console.log(`${pass ? '✓' : '✗'} brain ${message.padEnd(60)} ${d.intent} ${(d.answer?.plan ?? []).map((p) => `${p.kind}:${p.title}`).join(', ')} ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch).slice(0, 100)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}`)
  }),
])
console.log(`\nRight: ${ok}/${total} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === total ? 0 : 1)
