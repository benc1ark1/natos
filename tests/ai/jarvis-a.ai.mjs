// Jarvis phase A, AI check (uses the REAL chat model, so it costs a little: about $0.50–1 a run).
// Run: npm run test:ai
// ~40 labelled messages, each with its conversation and open card, go through the real brain + checks.
// Pass marks: at least 95% routed as labelled, and 100% of meta-messages never become a new item.
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
// Only the AI key is taken from .env.local, and only into this process.
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { costOf } = await import('../../lib/ai/models.ts')

const { ctx } = await import('./fixture.mjs')

const IDEA_CARD = 'Idea: Look up the 3blue1brown vectors video\ngoes to Inbox\nHis original words: “Look up the 3blue1brown vectors video”'
const TASK_CARD = 'Task: Chemistry notes\nmust · due Fri 16 Oct\nHis original words: “Chemistry notes due Friday”'
const SAVED_TO_INBOX = '[16:01] Nat: Look up the vectors video\n[16:01] You: Idea: Look up the vectors video / goes to Inbox / Nothing is saved until you tap ✅ Save.\n[16:02] Nat: (tapped 📥 Inbox)\n[16:02] You: 📥 Saved to Inbox.'
// a task that is in the snapshot (since C1 the brain must point at a real record)
const JUST_SAVED_TASK = '[16:00] Nat: Email Mr Khan about UCAS\n[16:00] You: Task: Email Mr Khan about UCAS / nice / Nothing is saved until you tap ✅ Save.\n[16:01] Nat: (tapped ✅ Save)\n[16:01] You: ✅ Task saved to Today. (“Email Mr Khan about UCAS”)'
const EDITING = '[16:03] Nat: (tapped ✏️ Edit)\n[16:03] You: ✏️ What should I change? e.g. “make it Thursday”, “it’s a task”, “45 min”, or send the whole thing again.'

// [message, expected intents, options]. text: what the item must say; kind: the kind Nat asked for; meta: must never be new.
const CASES = [
  ['thanks', ['chat'], { meta: true }],
  ['ok', ['chat', 'unclear'], { meta: true }],
  ['That okay maybe', ['chat', 'unclear'], { meta: true, card: TASK_CARD, editing: true, transcript: EDITING }],
  ['hmm', ['chat', 'unclear'], { meta: true }],
  ['lol nice', ['chat'], { meta: true }],
  ['cheers', ['chat'], { meta: true }],
  ['yes', ['chat', 'unclear'], { meta: true, card: TASK_CARD }],
  ['good morning', ['chat'], { meta: true }],
  ['I’m knackered', ['chat', 'plan'], { meta: true }],   // since D1, "tired" can mean a lighter plan
  ['Can you move it as a real task', ['correction'], { card: IDEA_CARD, kind: 'task', text: /vectors video/i }],
  ['Can you make it a real task', ['correction'], { card: IDEA_CARD, kind: 'task', text: /vectors video/i }],
  ['Can you move it as a real task', ['instruction'], { meta: true, transcript: SAVED_TO_INBOX }],
  ['make it Thursday', ['correction'], { card: TASK_CARD, text: /chemistry notes.*thursday/i }],
  ['it’s for Vlad', ['correction'], { card: TASK_CARD, text: /vlad/i }],
  ['actually 45 min', ['correction'], { card: TASK_CARD, text: /45/ }],
  ['no make it Friday', ['correction'], { card: 'Task: Chemistry notes\nmust · due Thu 15 Oct\nHis original words: “Chemistry notes due Thursday”', text: /friday/i }],
  ['Chemistry notes due Thursday', ['correction'], { card: TASK_CARD, editing: true, transcript: EDITING, text: /thursday/i }],
  ['Physics homework due Friday', ['new'], { text: /physics homework due friday/i }],
  ['remind me to bring PE kit Friday', ['new'], { text: /pe kit.*friday/i }],
  ['can you remind me to text Sam tomorrow', ['new'], { text: /text sam tomorrow/i }],
  ['Can you add maths homework due Monday', ['new'], { text: /maths homework due monday/i }],
  ['did football today', ['new'], { text: /football/i }],
  ['no football Thursday this week', ['new', 'instruction'], {}],
  ['no football Wednesday this week', ['unclear'], { reply: /no football on wednesday|no wednesday|isn.t .*wednesday|not .*wednesday/i }],   // there is no Wednesday football: say so, don't make a card
  ['SMC is on 7 November', ['new'], { text: /7 november/i }],
  ['Vlad gave extra homework due tomorrow', ['new'], { text: /homework.*tomorrow/i }],
  ['Look up that philosophy book', ['new'], { text: /philosophy book/i }],
  ['thanks, and add buy batteries', ['new'], { text: /batteries/i }],
  ['what should I do now?', ['question'], {}],
  ['what’s coming up this week', ['question'], {}],
  ['am I behind?', ['question'], {}],
  ['when am I free tomorrow', ['question'], {}],
  ['what’s in my inbox?', ['question'], {}],
  ['move physics homework to tomorrow', ['instruction'], {}],
  ['done with the SMC paper', ['instruction'], {}],
  ['drop the guitar idea', ['instruction'], {}],
  ['star it', ['instruction'], { transcript: JUST_SAVED_TASK }],
  ['Physics test moved to Monday', ['instruction'], {}],
  ['Owen moved training to Thursday 6pm this week', ['new', 'instruction'], {}],
  ['move it', ['unclear'], { meta: true }],
  ['the physics one', ['unclear'], { meta: true }],
]

let cost = 0
const results = []
async function run(c) {
  const [message, want, o] = c
  const input = { now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: o.transcript ?? '', card: o.card ?? null, cardEditing: !!o.editing, message }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await think(input, ctx, async (model, u) => { cost += costOf(model, u) })
    if (!res.ok) { if (attempt === 0) continue; return { c, ok: false, got: `error: ${res.error}` } }
    const d = res.decision
    const problems = []
    if (!want.includes(d.intent)) problems.push(`intent ${d.intent} (wanted ${want.join('/')})`)
    if (o.meta && d.intent === 'new') problems.push('META SAVED AS NEW')
    if (o.text && d.itemText && !o.text.test(d.itemText)) problems.push(`item_text “${d.itemText}”`)
    if (o.kind && d.itemKind !== o.kind) problems.push(`kind ${d.itemKind}`)
    if (o.reply && !o.reply.test(d.reply)) problems.push('reply doesn’t say so')
    return { c, ok: problems.length === 0, got: `${d.intent}${d.itemText ? ` “${d.itemText}”` : ''}${d.reply ? ` — ${d.reply.slice(0, 90)}` : ''}`, problems, metaBroken: problems.includes('META SAVED AS NEW') }
  }
}

// a few at a time (the first call writes the cache; the rest read it)
results.push(await run(CASES[0]))
for (let i = 1; i < CASES.length; i += 4) results.push(...(await Promise.all(CASES.slice(i, i + 4).map(run))))

const passed = results.filter((r) => r.ok).length
const metaBroken = results.filter((r) => r.metaBroken).length
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.c[0].padEnd(48)} ${r.got}${r.ok ? '' : `   <- ${r.problems?.join('; ') ?? ''}`}`)
const pct = (100 * passed) / results.length
console.log(`\nRouted as labelled: ${passed}/${results.length} (${pct.toFixed(1)}%, need ≥95%)`)
console.log(`Meta-messages saved as new: ${metaBroken} (need 0)`)
console.log(`Cost of this run: $${cost.toFixed(3)}`)
process.exit(pct >= 95 && metaBroken === 0 ? 0 : 1)
