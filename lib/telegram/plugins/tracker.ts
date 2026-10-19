// Item 1: the study tracker in Telegram (plans/contracts.md §3.7): topics, colours, reviews, tests, mistakes, programmes
// and temporary rules, all changeable by chat (a short preview + ✅, ↩️ Undo), understood without the AI for the common
// shapes ("matrices 🟢", "did Bicen matrices set 8/10", "HT2 practice 38/45", "done STEP 3", "pause getting ahead until
// 25 Oct"…), and by the brain for the rest. /maths /physics /tests /review /rules /programmes; "what next?" = the
// planner's top pick; "export my tracker" = a CSV; Classroom tests are asked about once. A bot plug-in
// (lib/telegram/plugin-types.ts). The work is in lib/tracker/bot-*.ts and lib/tracker/classroom.ts.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BotPlugin, CommandEnv, CommandResult, FastEnv, FastResult, PluginRawAction } from '../plugin-types'
import { sendDocument } from '../api'
import { TRK_OPS, checkTrk, snapshotRefs, type NextHint } from '../../tracker/bot-ops'
import { kv } from '../../tracker/bot-parse'
import { SQL_NOTE, loadTracker, type TrackerData } from '../../tracker/bot-data'
import { applyTrk, undoTrk, type TrkApplied } from '../../tracker/bot-apply'
import { mightBeTracker, parseFast } from '../../tracker/bot-fast'
import { mathsView, nextLine, physicsView, programmesView, reviewView, rulesView, snapshotSections, testsView, whatNextText } from '../../tracker/bot-views'
import { trackerCsvAll } from '../../tracker/csv'
import { classroomTick } from '../../tracker/classroom'
import { loadStudyWorld, loadTrackerData } from '../../tracker/data'
import { planStudyDay } from '../../tracker/engine'
import { isoDow, shortDate } from '../../time'

const PROMPT = `- Study tracker (see "Study tracker topics"; topic refs are their codes like PC1-03 (TP… for topics without one), tests TS…, mistakes MK…, programmes PG…, rules RL…; value "key=value; …"; prefer these over topic_status for tracker topics): trk_colour (ref topic; "colour=green|yellow|red|white") · trk_log (work he did on a topic: ref topic; "what=textbook|exercise|mixed|bicen|integral|stretch|booklet|pmt|review|diagnostic; score=8; out_of=10" (only if he gave a score; "pct=80" for a %), "notes=yes" if he used notes; the app sets the colour, step and review) · trk_mistake (ref topic or ""; "question=Q3b; what=<what went wrong, his words>; kind=knowledge|method|algebra|misread|calculator|time|careless; rule=<rule for next time>; test=TS…; source=<book / sheet>") · trk_redo (ref MK…; "result=right|wrong") · trk_attempt (a score on a test or paper: ref TS…; "what=diagnostic|booklet|timed|paper|real|other; score=38; out_of=45; label=<his words>"; date + words only if it wasn't today) · trk_test (a new test: ref "", "title=…; kind=test|consolidation|paper|mock; subject=Further Maths; topics=PC1-01, PC1-02; info=…; limits=no momentum; length=50; marks=45; per_day=30-60", date = its day + words = his words; ref TS… to change one: only the fields that change) · trk_topic (ref topic; "teacher=…", "strand=…", "taught=yes|in_class|not_yet", "taught_from=YYYY-MM-DD" + words, "notes=…", "concepts=…", "booklet=done|doing|todo", "pmt=done|doing|todo", "bicen=<section>", "integral=<link>", "name=…") · trk_programme (ref "" + "do=new; name=…; items=A | B | C; per_week=1; days=weekend; minutes=60; mode=in_order|gaps_only|optional" (date + words for an end date); or ref PG… + "do=pause" (date + words = until when, if he said), "do=resume", "do=stop", "do=add; add=D | E", or "do=change; per_week=2" / "days=…" / "minutes=…" / "ends=YYYY-MM-DD" + words) · trk_item (an item of a programme: ref PG…; "do=done|skip|result; item=3 (its number; "" = the next one); result=solved with hints · idea: …; score=…; out_of=…") · trk_rule (a temporary rule: "do=add; kind=boost (top priority)|pause|cap (minutes a day)|note; target=act|ahead (getting ahead)|stretch|reviews|mistakes (redos)|tests|fix|old|physics|subject:<name>|subjects:Maths,Further Maths,Physics|programme:<name>|topic:<code>; minutes=45 (cap)", date = the last day it counts ("this week" = this Sunday) + words = his words, or "ends=until_i_say" in value for "until I say"; if he gave no end, put it in ask with options This week ("ends=week"), 2 weeks ("ends=2weeks"), Until I say ("ends=until_i_say"); ref RL… + "do=end" to end one). "maths" = Maths + Further Maths.`

/** Read what the changes need: the tracker, and any Classroom homework copy a test card archives. */
async function loadRows(sb: SupabaseClient, raws: PluginRawAction[], today: string): Promise<unknown> {
  const d = await loadTracker(sb, today)
  const ids = raws.map((r) => kv(r.value ?? '').homework).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x))
  const tasks = ids.length ? ((await sb.from('tasks').select('id,title,archived_at,status,archive_reason').in('id', ids)).data ?? []) : []
  return { ...d, tasks }
}

/** The last few messages (his and the bot's), newest first, so "make it green" can find what "it" is. */
async function recentTexts(sb: SupabaseClient): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data } = await sb.from('telegram_turns').select('text').eq('status', 'done').gte('created_at', since).order('id', { ascending: false }).limit(6)
  return ((data ?? []) as { text: string }[]).map((r) => r.text)
}

/** "what next?": the planner's top pick not done yet (null when it has nothing: then the brain answers as before). */
async function whatNext(sb: SupabaseClient, today: string, d: TrackerData): Promise<string | null> {
  const world = await loadStudyWorld(sb, today)
  // TODO(lead, item 5): use lib/today's DayContext (holidays → half_term, his real free minutes) once it lands
  const plan = planStudyDay(world, { date: today, dow: isoDow(today), mode: 'school', studyMinutes: 120, maxPicks: 5 })
  const left = plan.picks.filter((p) => !world.doneToday.includes(p.key))
  return left.length ? whatNextText(left[0], left.slice(1), d) : null
}

/** "export my tracker": every tab in one CSV (lib/tracker/csv.ts, the same as the Subjects page's export) as a document. */
async function exportTracker(env: FastEnv): Promise<FastResult> {
  const t = await loadTrackerData(env.sb, env.today)
  if (!t.ready) return { kind: 'answer', html: SQL_NOTE }
  const f = trackerCsvAll({ world: t.world, allMistakes: t.allMistakes, allProgrammes: t.allProgrammes })
  await sendDocument(env.chatId, { name: f.name, content: f.csv, type: 'text/csv' }, `📤 Study tracker · ${shortDate(env.today)}`)
  return { kind: 'answer', html: [
    `📤 <b>Your tracker</b> (${t.world.topics.length} topics, ${t.world.tests.length} tests, ${t.allMistakes.length} mistakes, ${t.allProgrammes.length} programmes) is in the file above: every tab, each under a “## tab” line.`,
    '<i>Backup: Google Sheets → File → Import → Upload. (The Subjects page has one file per tab too.)</i>',
  ].join('\n') }
}

/** A quick-tap question (which topic? until when?): each answer's change is checked now and joins the card on a tap. */
async function askCard(env: FastEnv, message: string, d: TrackerData, question: string, options: { label: string; action: PluginRawAction }[]): Promise<FastResult | null> {
  const check = { today: env.today, said: message, grounded: () => true, ref: undefined, others: [] }
  const opts = options.map((o) => ({ o, action: checkTrk(o.action.op, o.action, d, check).action })).filter((x) => x.action)
  if (!opts.length) return null
  if (opts.length === 1) return { kind: 'actions', actions: [opts[0].o.action] }
  const { actionCard } = await import('../cards')   // (not at the top: cards.ts loads the plug-ins)
  await actionCard(env.sb, env.chatId, message, [], [], { asks: [{ question, options: opts.map((x) => ({ label: x.o.label, actions: [x.action as never] })) }] })
  return { kind: 'handled' }
}

async function fast(message: string, env: FastEnv): Promise<FastResult | null> {
  if (!mightBeTracker(message)) return null
  const d = await loadTracker(env.sb, env.today)
  const vague = /\b(it|it's|its|that|that's|this)\b/i.test(message)
  const intent = parseFast(message, d, env.today, { recent: vague && !env.cardOpen ? await recentTexts(env.sb) : [], cardOpen: env.cardOpen })
  if (!intent) return null
  if (d.sqlMissing) return intent.kind === 'export' ? { kind: 'answer', html: SQL_NOTE } : null   // before tracker.sql the old flows answer
  switch (intent.kind) {
    case 'actions': return { kind: 'actions', actions: intent.actions }
    case 'idea': return { kind: 'idea', request: intent.request }
    case 'export': return exportTracker(env)
    case 'next': { const html = await whatNext(env.sb, env.today, d); return html ? { kind: 'answer', html } : null }
    case 'ask': return askCard(env, message, d, intent.question, intent.options)
  }
}

/** A command's list, or the one-step set-up note before tracker.sql (/maths then shows the old maths tracker). */
const command = (view: (d: TrackerData) => string, before?: (env: CommandEnv) => Promise<string>) => async (env: CommandEnv): Promise<CommandResult> => {
  const d = await loadTracker(env.sb, env.today)
  if (d.sqlMissing) return { html: before ? `${await before(env)}\n\n${SQL_NOTE}` : SQL_NOTE }
  return { html: view(d) }
}

/** The maths tracker as it was (before tracker.sql runs). */
async function oldMaths(env: CommandEnv): Promise<string> {
  const [{ loadViewData }, { renderAny }] = await Promise.all([import('../views'), import('../views-more')])
  return (await renderAny(env.sb, await loadViewData(env.sb, env.today, env.now), { view: 'maths', arg: null })).html
}

export const plugin: BotPlugin = {
  name: 'tracker',
  ops: TRK_OPS,
  prompt: PROMPT,
  loadRows,
  check: checkTrk,
  apply: (sb, a, now) => applyTrk(sb, a, now),
  undo: (sb, a) => undoTrk(sb, a),
  afterApply: async (sb, applied, today) => {
    const hints = applied.map((a) => ((a.after ?? {}) as TrkApplied).next).filter((h): h is NextHint => !!h)
    return hints.length ? nextLine(await loadTracker(sb, today), hints) : null
  },
  snapshot: async (sb, today) => {
    const d = await loadTracker(sb, today)
    return d.sqlMissing ? { sections: [], refs: [] } : { sections: snapshotSections(d), refs: snapshotRefs(d) }
  },
  fast,
  commands: [
    { command: 'maths', description: 'Maths + FM topics, reviews, next up', run: command(mathsView, oldMaths) },
    { command: 'physics', description: 'Physics topics, reviews, next up', run: command(physicsView) },
    { command: 'tests', description: 'Tests: days left, scores, mistakes', run: command(testsView) },
    { command: 'review', description: 'What’s due for review today', run: command(reviewView) },
    { command: 'rules', description: 'Temporary study rules', run: command(rulesView) },
    { command: 'programmes', description: 'Programmes (STEP…): next item', run: command(programmesView) },
  ],
  tick: classroomTick,
}
