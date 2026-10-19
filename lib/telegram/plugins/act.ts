// Item 2: ACT (books as programmes, daily flashcards, steady and countdown modes, practice scores, misses by rule).
// A bot plug-in (lib/telegram/plugin-types.ts, plans/contracts.md §2, §5): the changes live in lib/act/bot.ts, the
// message shapes in lib/act/parse.ts, the planner in lib/act/engine.ts. Every change is a ✅ card first.
import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, todayISO, weekStartISO } from '../../time'
import { ACT_OPS, actNext, actSnapshot, actView, applyAct, checkAct, kvText, raw, undoAct } from '../../act/bot'
import { loadActRows, type ActRows } from '../../act/data'
import { isActQuestion, isSetup, parseBareDate, parseBook, parseMiss, parseRedo, parseRetake, parseScore } from '../../act/parse'
import { actMode } from '../../act/engine'
import type { BotPlugin, FastEnv, FastResult, PluginRawAction } from '../plugin-types'
import type { Pending } from '../cards'

/** The question the bot asks when he mentions a retake without a date (a bare date answer is then read as the date). */
export const ASK_DATE = '📅 When is your ACT retake? Send the date (e.g. “12 Dec”) and I’ll switch to countdown mode.'
const ASK_PLAIN = '📅 When is your ACT retake?'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const BOOK_VALUE: Record<string, string> = { english: 'english', reading: 'reading', maths_gaps: 'college panda', maths_hard: 'advanced', reading_extra: 'critical', flashcards: 'flashcards' }
const dateWords = (d: string) => { const [, m, dd] = d.split('-'); return `${+dd} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]}` }
const setupButton = [[{ text: '✅ Set up ACT', callback_data: 'act:setup' }]]

/** Did the bot just ask for the retake date (the last thing it said, in the last 30 minutes)? */
async function askedForDate(sb: SupabaseClient): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data } = await sb.from('telegram_turns').select('role,text').eq('status', 'done').gte('created_at', since).order('id', { ascending: false }).limit(3)
  const turns = (data ?? []) as { role: string; text: string }[]
  const lastBot = turns.find((t) => t.role === 'bot')
  return !!lastBot && lastBot.text.startsWith(ASK_PLAIN)
}

/**
 * Messages it understands without the AI. A change it understood but that can't be made ("already done", "no such
 * chapter", a score logged twice) gets its reason straight away instead of an AI call that couldn't do better.
 */
async function fast(message: string, env: FastEnv): Promise<FastResult | null> {
  const r = await understand(message, env)
  if (r?.kind !== 'actions') return r
  const rows = await loadActRows(env.sb, env.today)
  const grounded = (w: string) => w.trim().length >= 3 && message.toLowerCase().includes(w.trim().toLowerCase())
  const problems = r.actions.map((a) => checkAct(a.op, a, rows, { today: env.today, said: message, grounded, ref: undefined, others: r.actions }).problem).filter(Boolean) as string[]
  if (problems.length < r.actions.length) return r
  return { kind: 'answer', html: `🎯 ${esc(problems.map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}`).join('. '))}.` }
}

async function understand(message: string, env: FastEnv): Promise<FastResult | null> {
  const today = env.today
  const act = (a: PluginRawAction): FastResult => ({ kind: 'actions', actions: [a] })
  if (isSetup(message)) { await setupCard(env.sb, env.chatId, message); return { kind: 'handled' } }
  if (isActQuestion(message)) {
    const v = actView(await loadActRows(env.sb, today), today)
    return { kind: 'answer', html: v.html, buttons: v.setup ? setupButton : undefined }
  }
  // with a card waiting, bare scores ("E32 M35 R34") may be a correction to it: only take them if he says ACT / practice / real
  const sc = parseScore(message)
  if (sc && (!env.cardOpen || /(^|[^a-z])(act|real|mock|pra[a-z]*)([^a-z]|$)/i.test(message))) {
    const v = [`kind=${sc.kind}`, ...(['english', 'maths', 'reading', 'science'] as const).filter((k) => sc[k] != null).map((k) => `${k[0]}=${sc[k]}`)].join('; ')
    return act(raw('act_score', v, sc.yesterday ? { date: addDays(today, -1), words: 'yesterday' } : {}))
  }
  const rt = parseRetake(message, today)
  if (rt?.kind === 'set') return act(raw('act_date', 'set', { date: rt.date, words: rt.words }))
  if (rt?.kind === 'clear') return act(raw('act_date', 'clear'))
  if (rt?.kind === 'ask' || rt?.kind === 'when') {
    const rows = await loadActRows(env.sb, today)
    const m = actMode(rows.world)
    if (m.mode === 'countdown') return { kind: 'answer', html: `🎯 Your ACT retake is <b>${dateWords(m.date)}</b> (${m.daysLeft === 0 ? 'today' : m.daysLeft === 1 ? 'tomorrow' : `${m.daysLeft} days`}): countdown mode is on. Moved? Send the new date (“ACT retake is 13 Feb”).` }
    return { kind: 'answer', html: ASK_DATE }
  }
  if (!env.cardOpen) {
    const bare = parseBareDate(message, today)
    if (bare && (await askedForDate(env.sb))) return act(raw('act_date', 'set', { date: bare.date, words: bare.words }))
  }
  const redo = parseRedo(message)
  if (redo) return act(raw('act_miss', ['do=redo', redo.section ? `section=${redo.section}` : '', redo.question ? `question=${redo.question}` : ''].filter(Boolean).join('; ')))
  const miss = parseMiss(message)
  if (miss) {
    return act(raw('act_miss', [`section=${miss.section}`, miss.question ? `question=${miss.question}` : '', `rule=${kvText(miss.rule)}`, miss.what ? `what=${kvText(miss.what)}` : '', miss.kind ? `kind=${miss.kind}` : '']
      .filter(Boolean).join('; ')))
  }
  const bk = parseBook(message)
  if (bk) {
    const book = `book=${BOOK_VALUE[bk.book]}`
    const item = (i: { kind: 'chapter' | 'passage'; n: number }) => `item=${i.kind === 'passage' ? 'passage ' : 'ch '}${i.n}`
    const score = (s: number | null, o: number | null) => (s != null ? `; score=${s}; out_of=${o}` : '')
    switch (bk.do) {
      case 'start': case 'stop': return act(raw('act_book', `${book}; do=${bk.do}`))
      case 'count': return act(raw('act_book', `${book}; do=count; kind=${bk.kind}; count=${bk.count}`))
      case 'rename': return act(raw('act_book', `${book}; ${item(bk.item)}; do=rename; title=${kvText(bk.title)}`))
      case 'score': return act(raw('act_book', `${book}; ${item(bk.item)}; do=score${score(bk.score, bk.outOf)}${bk.full && bk.score == null ? '; full=yes' : ''}`))
      default: return act(raw('act_book', `${book}; ${item(bk.item)}; do=${bk.do}${score(bk.score, bk.outOf)}`))
    }
  }
  return null
}

/**
 * The set-up card ("set up ACT" or the /act button): the usual ✅ card, nothing saved before ✅. A set-up card still
 * waiting is replaced, so there are never two to ✅ (and applying one re-checks what exists: lib/act/bot.ts).
 */
async function setupCard(sb: SupabaseClient, chatId: number, text = 'set up ACT'): Promise<void> {
  const { checkActions, loadRows } = await import('../actions')
  const { actionCard } = await import('../cards')
  const { say } = await import('../turns')
  const today = todayISO()
  const ctx = { today, weekStart: weekStartISO(today), snapshot: '', refs: new Map() }
  const list = [raw('act_setup', '')]
  const rows = await loadRows(sb, list, ctx)
  const { actions, problems } = checkActions(list, ctx, rows, text, today)
  if (!actions.length) {
    const why = problems.join('; ') || 'nothing to set up'
    await say(sb, chatId, `🎯 ${esc(why.charAt(0).toUpperCase() + why.slice(1))}.`)
    return
  }
  const { data: waiting } = await sb.from('telegram_pending').select('id,kind,text,payload,status,updated_at').eq('kind', 'action').in('status', ['open', 'editing'])
    .order('updated_at', { ascending: false }).limit(20)
  const old = ((waiting ?? []) as Pending[]).find((c) => c.payload?.actions?.some((a) => (a.op as string) === 'act_setup')) ?? null
  await actionCard(sb, chatId, text, actions, problems, { replaces: old })
}

export const plugin: BotPlugin = {
  name: 'act',
  ops: ACT_OPS,
  prompt: `- ACT (see "ACT"; his books are refs AC…; never invent chapter titles): act_score (value "kind=practice|real|section; e=33; m=35; r=34; s=32": only the sections he gave, each 1–36; date + words only if not today) · act_date (value "set" + date + words = his date words: "ACT retake is 12 Dec"; value "clear" when there's no retake any more; a retake mentioned without a date: unclear, ask for the date) · act_miss (value "section=english; question=Q12; rule=<the grammar rule>; what=<what went wrong>; kind=careless" to log a miss; "do=redo; question=Q12" or "do=redo" (all due) for redos) · act_book (ref AC… or value "book=english|reading|college panda|advanced|critical|flashcards; item=ch 3 (or passage 2); do=done|skip|reopen|score|rename|remove|count|add|start|stop|pause|resume; score=12; out_of=15; title=<his name>; count=18; kind=chapter|passage": College Panda chapter tests: full marks = skip the chapter, dropped marks = do it) · act_setup (value "": makes the ACT subject, his 5 books, the daily flashcards and his last real score; only if "ACT" says it isn't set up).`,
  loadRows: async (sb, _raw, today) => loadActRows(sb, today),
  check: (op, a, rows, env) => checkAct(op, a, rows as ActRows | undefined, env),
  apply: applyAct,
  undo: undoAct,
  afterApply: async (sb, applied, today) => actNext(await loadActRows(sb, today), applied, today),
  snapshot: async (sb, today) => actSnapshot(await loadActRows(sb, today), today),
  fast,
  commands: [{
    command: 'act',
    description: 'ACT: mode, scores, next chapters, misses',
    run: async ({ sb, today }) => {
      const v = actView(await loadActRows(sb, today), today)
      return { html: v.html, buttons: v.setup ? setupButton : undefined }
    },
  }],
  taps: [{ prefix: 'act', run: async (sb, chatId, data) => { if (data === 'act:setup') await setupCard(sb, chatId) } }],
}
