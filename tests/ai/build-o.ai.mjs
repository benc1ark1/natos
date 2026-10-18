// Build O (the week optimiser), AI check (REAL models, a few cents a run). Run: npm run test:ai
// The chat model routes the new requests to the right change or answer: this week's game, a read-only session that
// stopped, places and travel, session lengths, Owen's days, upper this week, a school day's times, plan blocks
// ("move study to 5pm", "skip gym today"), a new subject / target, restore, 🧠 per session, and the questions that
// are answered from the optimiser's week ("where should I train today?", "upper 2x or 3x?", "why is lower on
// Thursday?") or a list ("how's my load this week?", "what do you still need to know?", "where can I save time?").
import { readFileSync } from 'node:fs'

const ROOT = new URL('../../', import.meta.url).pathname
const key = readFileSync(`${ROOT}.env.local`, 'utf8').split('\n').find((l) => l.startsWith('ANTHROPIC_API_KEY='))?.slice(18)
if (!key) { console.error('No ANTHROPIC_API_KEY in .env.local'); process.exit(1) }
process.env.ANTHROPIC_API_KEY = key
delete process.env.ANTHROPIC_BASE_URL

const { think } = await import('../../lib/telegram/brain.ts')
const { checkActions } = await import('../../lib/telegram/actions.ts')
const { costOf } = await import('../../lib/ai/models.ts')
const { DEFAULT_RULES } = await import('../../lib/training.ts')
const { setupForAI } = await import('../../lib/setup.ts')
const { ctx, rows } = await import('./fixture.mjs')

let cost = 0, ok = 0, total = 0
const mark = (pass, line) => { total++; if (pass) ok++; console.log(`${pass ? '✓' : '✗'} ${line}`) }

// the fixture plus Build O: his set-up, Google sessions, plan blocks (B…) and an archived task (A…)
rows.planning = {}
rows.rules = DEFAULT_RULES
rows.costs = []
rows.titles = ['School', 'CS tutor', 'Owen training', 'Vlad (maths/physics tutor)', 'Football', 'Match', 'EFA training', 'Games', 'SMC mock']
rows.subjects = [{ id: 's1', name: 'Physics', archived_at: null }]
rows.categories = [{ id: 'c1', name: 'Study' }]
rows.blocks = new Map([
  ['b1', { id: 'b1', on_date: '2026-10-12', start_time: '18:30', end_time: '19:15', title: 'Physics homework', kind: 'focus', status: 'planned' }],
  ['b2', { id: 'b2', on_date: '2026-10-10', start_time: '17:00', end_time: '18:00', title: 'Upper @ PureGym Swiss Cottage', kind: 'training', status: 'planned' }],
])
rows.archived = new Map([['a1', { id: 'a1', title: 'Learn the guitar riff', archived_at: '2026-10-08T10:00:00Z', status: 'inbox' }]])
ctx.refs.set('B1', { kind: 'block', id: 'b1', title: 'Physics homework', status: 'planned', deadline: '2026-10-12' })
ctx.refs.set('B2', { kind: 'block', id: 'b2', title: 'Upper @ PureGym Swiss Cottage', status: 'planned', deadline: '2026-10-10' })
ctx.refs.set('A1', { kind: 'archived', id: 'a1', title: 'Learn the guitar riff', status: null, deadline: null })
ctx.snapshot = ctx.snapshot
  .replace('Sun 11 Oct: nothing booked', 'Sun 11 Oct: 08:30–10:00 EFA training (Google); 08:30–16:00 Game')
  .replace('## Reminders', `## His set-up (places, sessions, Owen’s days, this week’s game; editable)\n${setupForAI({}, '2026-10-05').join('\n')}\n\n## Plan blocks, next 7 days (refs for block_move / block_skip; ✓ = ticked done)\nB1 | Mon 12 Oct 18:30–19:15 Physics homework (focus)\nB2 | Sat 10 Oct 17:00–18:00 Upper @ PureGym Swiss Cottage (training)\n\n## Recently archived tasks (refs for restore: back to the Inbox)\nA1 | Learn the guitar riff | dropped Thu 8 Oct\n\n## Reminders`)
const weekPlan = `The optimiser's week (Mon 2026-10-12 – Sun 2026-10-18); no week applied yet:
- Mon 16:20–16:40 Core @ Home · light — why: med day · home — other days cost: Tue +1 (two sessions on Tue)
- Tue 16:30–17:37 Speed + circuits @ Owen · heavy · leave school 16:10 — why: 2 days from Heavy lower (Thu) · high day — other days cost: Wed +12 (high-CNS days back to back)
- Thu 16:10–17:10 Heavy lower @ School gym · heavy — why: 2 days from Speed + circuits (Tue) · 3 days before Game · med day · School gym, no travel after school — other days cost: Wed +22 (heavy lower and speed back to back (Tue–Wed)); Fri +30 (Friday: keep training light)
- Sat 15:00–16:00 Upper @ PureGym Swiss Cottage · heavy · leave 14:30 — why: upper body fresh · med day
Upper 2× this week: a 3rd upper would hurt heavy lower or speed (two sessions on Thu).
Better than Owen’s current days (speed Tue, heavy lower Thu, injury prevention Fri, core Sat): core Mon not Sat. His days would mean two sessions on Tue.
Load per day (💪 legs+upper+CNS): Mon med 15.8, Tue high 23, Wed med 15, Thu med 16, Fri low 0.7, Sat med 15, Sun high 23`

const CASES = [
  // changes
  // on a Saturday "this week" can mean the coming week (the app plans the coming week at weekends): either is right
  ['game is Saturday this week', (d, acts) => acts.some((a) => a.op === 'game_week' && (a.patch.gameWeeks?.['2026-10-05']?.date === '2026-10-10' || a.patch.gameWeeks?.['2026-10-12']?.date === '2026-10-17'))],
  ['no game this week', (d, acts) => acts.some((a) => a.op === 'game_week' && a.patch.gameWeeks?.['2026-10-05']?.none === true)],
  ['EFA training is over', (d, acts) => acts.some((a) => a.op === 'session_ignore' && a.patch.ignoredSessions?.includes('EFA training'))],
  ['PureGym is more like 25 min by bus from home', (d, acts) => acts.some((a) => a.op === 'setup_set' && a.patch.trainingPlaces?.find((p) => p.key === 'puregym')?.fromHome === 25)],
  ['an upper session takes me about 50 minutes', (d, acts) => acts.some((a) => a.op === 'setup_set' && a.patch.sessionTypes?.find((s) => s.key === 'upper')?.minutes === 50)],
  ['I’ve told Owen I can do speed on Tuesdays and heavy lower on Thursdays', (d, acts) => acts.some((a) => a.op === 'owen_days' && a.patch.owenDays?.speed?.[0] === 2 && a.patch.owenDays?.heavy_lower?.[0] === 4)],
  ['do upper 3x this week', (d, acts) => acts.some((a) => a.op === 'upper_week' && a.patch.upperWeeks?.['2026-10-05'] === 3)],
  ['school finishes at 15:00 on Wednesdays', (d, acts) => d.actions.some((a) => a.op === 'school_day' && /wed/i.test(a.value) && /15:00/.test(a.value))],
  ['move my physics homework block to 5pm', (d, acts) => acts.some((a) => a.op === 'block_move' && a.patch.start_time === '17:00')],
  ['skip the gym today', (d, acts) => acts.some((a) => a.op === 'block_skip' && a.id === 'b2')],
  ['add ACT as a subject', (d, acts) => acts.some((a) => a.op === 'subject_new' && a.patch.name === 'ACT')],
  ['bring back the guitar riff idea', (d, acts) => acts.some((a) => a.op === 'restore' && a.id === 'a1')],
  ['the SMC mock is max mental load', (d, acts) => acts.some((a) => a.op === 'load_set' && a.patch.mental === 10)],
  ['Friday evening should be free from 7pm', (d, acts) => acts.some((a) => a.op === 'setting' && a.patch.fridayFreeFrom === '19:00')],
  ['I go to bed at 10:15 on school nights', (d, acts) => acts.some((a) => a.op === 'setting' && a.patch.bedAt === '22:15')],
  // questions
  ['where should I train today?', (d) => d.intent === 'question' && /pure ?gym|upper/i.test(d.reply)],
  ['should I do upper 2x or 3x?', (d) => d.intent === 'question' && /2/.test(d.reply) && /(lower|speed|thu)/i.test(d.reply)],
  ['why is heavy lower on Thursday?', (d) => d.intent === 'question' && /(speed|tue|game|wed|back to back)/i.test(d.reply)],
  ['how’s my load this week?', (d) => d.intent === 'question' && d.show?.view === 'load'],
  ['what do you still need to know?', (d) => d.intent === 'question' && d.show?.view === 'gaps'],
  ['where can I save time?', (d) => d.intent === 'question' && d.show?.view === 'savings'],
  ['connect my whoop', (d) => (d.intent === 'chat' || d.intent === 'question') && /settings|dashboard/i.test(d.reply)],
]
const only = process.env.ONLY ? new RegExp(process.env.ONLY, 'i') : null
await Promise.all(CASES.filter(([m]) => !only || only.test(m)).map(async ([message, good]) => {
  const res = await think({ now: 'Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London).', transcript: '', card: null, cardEditing: false, message, today: ctx.today, weekPlan }, ctx, async (m, u) => { cost += costOf(m, u) })
  const d = res.ok ? res.decision : { intent: 'failed', actions: [], reply: res.error }
  const { actions, problems } = res.ok ? checkActions(d.actions, ctx, rows, message, ctx.today) : { actions: [], problems: [res.error] }
  mark(good(d, actions), `${message.slice(0, 50).padEnd(50)} ${d.intent}${d.show ? ` show=${d.show.view}` : ''} ${actions.map((a) => `${a.op} ${JSON.stringify(a.patch).slice(0, 120)}`).join(', ')}${problems.length ? ` (left out: ${problems.join('; ')})` : ''}${d.intent === 'question' || d.intent === 'chat' ? ` — “${d.reply.slice(0, 140)}”` : ''}`)
}))

console.log(`\nRight: ${ok}/${total} (need all) · cost $${cost.toFixed(3)}`)
process.exit(ok === total ? 0 : 1)
