// Jarvis phase B, AI check (REAL chat model, about $0.05 a run). Run: npm run test:ai
// Questions worded so the free word-matcher doesn't catch them, so the brain must: pick the right exact list
// ("show"), answer "do I have time?" correctly from the app's free-time numbers, and push back on the task
// postponed 3 times. Pass marks: lists ≥ 90% right; every yes/no time answer right; push-back present.
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { freeTimeForAI, matchView } = await import('../../lib/telegram/views.ts')
const { DEFAULT_PLANNING } = await import('../../lib/freetime.ts')
const { ctx, events, now } = await import('./fixture.mjs')

const freeTime = freeTimeForAI({ today: ctx.today, now, settings: DEFAULT_PLANNING, events, changes: [] })

// [message, check]. show: the list wanted (arg optional); yes/no: the first word of the reply; push: must push back.
const CASES = [
  ['anything big on this week?', { show: ['week', 'coming'] }],
  ['got anything sitting in my inbox?', { show: ['inbox'] }],
  ['when have I got free time on Monday', { show: ['free'], arg: '2026-10-12' }],
  ['show me my free time tomorrow pls', { show: ['free'], arg: '2026-10-11' }],
  ['what have I been putting off lately?', { show: ['postponed'] }],
  ['what’s the next step for football comeback', { show: ['project'], arg: /football comeback/i }],
  ['what’s left for the rest of today?', { show: ['today'] }],
  ['what deadlines and tests have I got in the next fortnight', { show: ['coming'] }],
  ['do I have time for the SMC paper tonight?', { yes: true }],
  // the slot, or the better answer: it's due Wednesday, so Thursday is too late
  ['do I have time for the SMC paper before football on Thursday?', { yes: true, mentions: /15:40|17:25|due (on )?wed/i }],
  ['have I got time for a 2 hour session before Vlad on Wednesday?', { yes: false }],
  ['could I fit the physics homework in on Tuesday before Owen?', { yes: true }],
  ['what should I do tonight?', { push: true }],
]

let cost = 0
async function run([message, want]) {
  if (matchView(message, ctx.today)) return { message, ok: false, got: 'caught by the free matcher (pick other wording)', problems: ['matcher'] }
  const input = { now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, freeTime, today: ctx.today }
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await think(input, ctx, async (model, u) => { cost += costOf(model, u) })
    if (!res.ok) { if (attempt === 0) continue; return { message, ok: false, got: `error: ${res.error}`, problems: ['error'] } }
    const d = res.decision
    const problems = []
    if (d.intent !== 'question') problems.push(`intent ${d.intent}`)
    if (want.show && !want.show.includes(d.show?.view ?? '')) problems.push(`show ${d.show?.view ?? '-'} (wanted ${want.show.join('/')})`)
    if (want.arg && !(want.arg instanceof RegExp ? want.arg.test(d.show?.arg ?? '') : d.show?.arg === want.arg)) problems.push(`arg ${d.show?.arg}`)
    if (want.yes !== undefined && !(want.yes ? /^(yes|yep|yeah)\b/i : /^(no|nope|not)\b/i).test(d.reply)) problems.push(`should start with ${want.yes ? 'yes' : 'no'}`)
    if (want.mentions && !want.mentions.test(d.reply)) problems.push('slot not named')
    if (want.push && !/postpon|put (it )?off|3 times|three times|3×/i.test(`${d.reply} ${d.answer?.plan.map((p) => p.why).join(' ')}`)) problems.push('no push-back')
    return { message, ok: !problems.length, got: `${d.intent}${d.show ? ` [${d.show.view}${d.show.arg ? ` ${d.show.arg}` : ''}]` : ''} — ${d.reply.slice(0, 110)}`, problems, want }
  }
}

const results = []
results.push(await run(CASES[0]))
for (let i = 1; i < CASES.length; i += 4) results.push(...(await Promise.all(CASES.slice(i, i + 4).map(run))))
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.message.padEnd(62)} ${r.got}${r.ok ? '' : `   <- ${r.problems.join('; ')}`}`)

const lists = results.filter((r) => r.want?.show)
const listPct = (100 * lists.filter((r) => r.ok).length) / lists.length
const timeOK = results.filter((r) => r.want?.yes !== undefined).every((r) => r.ok)
const pushOK = results.filter((r) => r.want?.push).every((r) => r.ok)
console.log(`\nLists picked right: ${lists.filter((r) => r.ok).length}/${lists.length} (${listPct.toFixed(0)}%, need ≥90%)`)
console.log(`"Do I have time" answers right: ${timeOK ? 'all' : 'NOT all'} · push-back: ${pushOK ? 'yes' : 'NO'}`)
console.log(`Cost of this run: $${cost.toFixed(3)}`)
process.exit(listPct >= 90 && timeOK && pushOK ? 0 : 1)
