// Server-only: one typed message from Nat -> the brain decides what it is -> the bot acts on it.
// New items and corrections become cards (nothing saved before ✅). Questions are answered from his data.
// Past the daily AI cap, or if the AI is down, "simple mode" keeps capture working without the brain.
// Speed (queue item 3): cheapest first. Exact lists (no AI) → plain-code answers and plug-in fast paths (no AI) → the
// quick router (a small model, small prompt: thanks, an exact list, an obvious new item) → the full brain. The brain's
// context is read while the cheaper steps run, so handing a message on to the brain costs almost no extra time.
import 'server-only'
import { guidesForAI, relevantGuides } from '../guides-search'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordUsage, budget } from '../ai/usage'
import { loadPlannerContext, type PlannerContext } from '../ask/server'
import type { AskAnswer } from '../ask/types'
import { todayISO, weekStartISO } from '../time'
import { esc, type Button } from './api'
import { botAsked, looksLikeChange, looksLikeMeta, looksLikePartialEdit, route, think, triage, type Decision } from './brain'
import { checkActions, loadRows } from './actions'
import { proposePlan, proposeWeekPlan } from './dayplan'
import { noteWeek, proposeTrainingPlan } from './trainplan'
import { actionCard, cardForAI, editButtons, newCard, openCard, planEffect, replaceOld, worldOf, type Ask, type Pending } from './cards'
import { recentTurns, say, transcript, type Ref, type TurnRow } from './turns'
import { ASYNC_VIEWS, freeTimeForAI, loadViewData, matchView, type ViewData } from './views'
import { saveIdea } from './ideas'
import { askNextGap, typedGapAnswer } from './gapask'
import { claim, release } from './sent'
import { renderAny, weekPlanForAI } from './views-more'
import { proposeOwenDays } from './owen'
import { pluginFor, runFast } from './plugins'
import type { FastResult } from './plugin-types'
import { markPath } from './speed'

export type Outcome = Decision['intent'] | 'failed'

/** Is this a question? Only used in simple mode; normally the brain decides. */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase()
  return /\?\s*$/.test(t) || /^(what|what's|whats|how|when|where|which|who|why|should|shall|am i|can i|could i|plan my|tell me|show me|give me)\b/.test(t)
}

// ---------------------------------------------------------------------------
// The brain's context (his whole snapshot, the day's data, the optimiser's week): read once per message, started early
// ---------------------------------------------------------------------------

type Context = { ctx: Promise<PlannerContext>; data: Promise<ViewData>; week: Promise<string | undefined>; at: number; today: string }
// The context the last message of this drain read, for the next one (messages queued back to back). Only while nothing
// can have changed: forgotten after any tap, command or change in this instance, at the end of the drain, after 30 s,
// and whenever a card was saved or undone since it was read (checked with the next message's first reads).
let memo: Context | null = null
const MEMO_MS = 30_000

/** A tap, a command, the end of a drain or anything that may change his data: the next message reads everything fresh. */
export function forgetContext(): void { memo = null }

function readContext(sb: SupabaseClient, today: string): Context {
  const ctx = loadPlannerContext(sb)
  const data = loadViewData(sb, today)
  const week = data.then((d) => weekPlanForAI(sb, d)).catch(() => undefined)
  // awaited later (and their errors shown then); this only stops "unhandled rejection" when a message never needs them
  // a read that failed is never reused: the next message reads again (one Supabase blip = one ⚠️, not one per message)
  const c: Context = { ctx, data, week, at: Date.now(), today }
  ctx.catch(() => { if (memo === c) memo = null })
  data.catch(() => { if (memo === c) memo = null })
  return c
}

/** Was a card saved or undone (in any instance) since the context was read? Then his data may have changed. */
async function changedSince(sb: SupabaseClient, at: number): Promise<boolean> {
  const { data, error } = await sb.from('telegram_pending').select('id').in('status', ['saved', 'undone'])
    .gte('updated_at', new Date(at - 1000).toISOString()).limit(1)
  return !!error || !!data?.length
}

// What a message can do without changing his data (it may make a card): the context it read stays good for the next one.
const READ_ONLY: readonly Outcome[] = ['question', 'chat', 'unclear', 'new', 'correction', 'instruction', 'app_idea']

export async function converse(sb: SupabaseClient, chatId: number, turn: TurnRow, opts: { claim: (key: string) => Promise<boolean>; forceQuestion?: boolean }): Promise<Outcome> {
  let out: Outcome
  try { out = await answerMessage(sb, chatId, turn, opts) } catch (e) { forgetContext(); throw e }
  if (!READ_ONLY.includes(out)) forgetContext()
  return out
}

async function answerMessage(sb: SupabaseClient, chatId: number, turn: TurnRow, opts: { claim: (key: string) => Promise<boolean>; forceQuestion?: boolean }): Promise<Outcome> {
  const message = turn.text.replace(/^\/ask\b\s*/, '').trim()
  if (!message) { await say(sb, chatId, 'Send a question, e.g. /ask what should I do now?'); return 'unclear' }

  const today = todayISO()
  const matched = matchView(message, today)
  const askNow = /^(?:ok |okay )?(?:ask me (?:now|the questions|them)|go through (?:the|your) questions|ask away|start asking(?: me)?(?: questions)? again)\b/i.test(message)
  const stopAsking = /^(?:please )?(?:stop|pause|no more) (?:asking(?: me)?(?: questions)?|questions)\b/i.test(message)
  const plain = !message.startsWith('/') && !matched && !askNow && !stopAsking
  // a typed answer to the question waiting (only possible when no instant list matched): read alongside the rest
  const gap = plain ? typedGapAnswer(sb, chatId, message).catch(() => false) : null
  // the last message of this drain read his whole context: still good unless a card was saved or undone since
  const reuse = memo && memo.today === today && Date.now() - memo.at < MEMO_MS ? memo : null

  // (`card` becomes null when his message turns out to be about something else: see "his own message" below)
  // eslint-disable-next-line prefer-const
  let [history, card, money, stale] = await Promise.all([
    recentTurns(sb, turn.id), openCard(sb), budget(sb).catch(() => null), reuse ? changedSince(sb, reuse.at) : false,
  ])
  // His whole context (snapshot, the day, the optimiser's week): read once no instant answer can do (alongside the
  // quick router, so handing on to the brain costs almost nothing), or reused
  let context: Context | null = reuse && !stale ? reuse : null
  const contextNow = () => (context ??= (memo = readContext(sb, today)))

  // Instant, free answers ("what's in my inbox?", /week, "when am I free tomorrow?"): no AI at all.
  // Not while a card is waiting, where a word like "today" may be a change to the card.
  // (with a card waiting, only the whole-question lists answer instantly: "where can I save time?", "how's my load?")
  const view = !card || message.startsWith('/') || (matched && ASYNC_VIEWS.includes(matched.view)) ? matched : null
  if (view && !opts.forceQuestion) {
    markPath('list')
    const r = await renderAny(sb, await loadViewData(sb, today), view)
    await say(sb, chatId, r.html, r.buttons, { intent: 'question', refs: r.refs })
    return 'question'
  }
  // Build O: "ask me now" goes through the gap questions; a typed answer to the question waiting is saved (no AI)
  if (!message.startsWith('/')) {
    if (askNow) {
      markPath('fast')
      await release(sb, 'gaps:paused')   // questions back on (a pause he set)
      if (!(await askNextGap(sb, chatId, new Date(), { force: true }))) await say(sb, chatId, 'Nothing to ask right now (or it’s school / late: I’ll ask later).', undefined, { intent: 'question' })
      return 'question'
    }
    if (stopAsking) {
      markPath('fast')
      await claim(sb, 'gaps:paused').catch(() => false)
      await say(sb, chatId, '⏸ No more questions until you say “ask me now”. Plans keep using my guesses (“what do you still need to know?” lists them).', undefined, { intent: 'instruction' })
      return 'instruction'
    }
    if (await (gap ?? typedGapAnswer(sb, chatId, message))) { markPath('fast'); forgetContext(); return 'instruction' }
    // "which days should I give Owen?": the optimiser on a typical week (no AI)
    if (/\b(?:which|what) days (?:should|do|can) i (?:give|tell|send|offer)(?: to)? owen\b|\bbest days for owen\b|\bowen'?s days\??$|\bdays (?:to give|for) owen\b/i.test(message)) {
      markPath('fast')
      await proposeOwenDays(sb, chatId, await loadViewData(sb, today))
      return 'question'
    }
    // plug-ins (lib/telegram/plugins): messages they understand without the AI ("matrices 🟢", "bench 80x5x3"):
    // instant and free, and still the usual ✅ card for any change
    const fast = await runFast(message, { sb, chatId, today, now: new Date(), cardOpen: !!card, cardEditing: card?.status === 'editing' })
    if (fast) {
      const out = await useFast(sb, chatId, message, fast.result)
      if (out) { markPath('fast'); if (fast.result.kind === 'handled') forgetContext(); return out }
    }
  }

  if (money?.over) {
    markPath('simple')
    if (await opts.claim(`cap:${todayISO()}`)) {
      await say(sb, chatId, `💸 Today’s AI limit ($${money.cap.toFixed(2)}) is used up, so I’m in simple mode until midnight: new things still get sorted, but questions and changes wait. /usage for details · /cap 2 to raise the limit.`)
    }
    return simpleMode(sb, chatId, message, card, 'Today’s AI limit is used up')
  }

  // The quick router: thanks, an exact list, an obvious new item, without the full brain. Never while a card is waiting
  // (his message may change it). If it isn't sure, fails or is slow, the brain reads the message as before.
  contextNow()
  if (triage(message, { cardOpen: !!card, forceQuestion: opts.forceQuestion, botAsked: botAsked(history) }) === 'router') {
    const r = await route({ message, transcript: transcript(history.slice(-4), 240), today }, (model, usage) => recordUsage(sb, 'chat', model, usage))
    if (r?.route === 'chat') {
      markPath('quick')
      await say(sb, chatId, esc(r.reply), undefined, { intent: 'chat' })
      return 'chat'
    }
    if (r?.route === 'list') {
      markPath('quick')
      const shown = await renderAny(sb, await contextNow().data, r.show)
      await say(sb, chatId, shown.html, shown.buttons, { intent: 'question', refs: shown.refs })
      return 'question'
    }
    if (r?.route === 'new') {
      markPath('quick')
      await newCard(sb, chatId, r.itemText)
      return 'new'
    }
  }

  markPath('brain')
  const parts = contextNow()
  const [ctx, data, weekPlan] = await Promise.all([parts.ctx, parts.data, parts.week])
  // a change is likely: its card's knock-on needs the week, so read it while the AI thinks
  if (looksLikeChange(message) || card?.kind === 'action') void worldOf(sb, data)
  const ask = (withCard: typeof card) => think(
    {
      now: ctx.snapshot.split('\n', 1)[0], transcript: transcript(history), card: withCard ? cardForAI(withCard) : null,
      cardEditing: withCard?.status === 'editing', message, freeTime: freeTimeForAI(data), today, forceQuestion: opts.forceQuestion,
      guides: (() => { const g = relevantGuides(ctx.guides ?? [], message); return g.length ? guidesForAI(g) : undefined })(),
      weekPlan,
    },
    ctx,
    (model, usage) => recordUsage(sb, 'chat', model, usage),
  )
  let res = await ask(card)
  if (!res.ok) {
    await say(sb, chatId, `⚠️ ${esc(res.error)}`)
    return simpleMode(sb, chatId, message, card, 'The AI didn’t answer')
  }
  // His own message, not a change to the waiting card: a "correction" that has nothing to do with the card ("maths
  // test on Thursday" while "Chemistry notes" waits), or a report that something is done ("Sam's CS homework is done").
  // It is read again as if no card were waiting, so it's handled as itself and the card stays as it was. After ✏️
  // Change his next message is the card's new version, as before; short edits ("30 min", "make it Thursday") too.
  const unrelated = (about: string) => message.trim().split(/\s+/).length >= 3 && !sharesWords(about, `${res.ok ? res.decision.itemText ?? '' : ''} ${message}`)
  const ownMessage = card && card.status !== 'editing' && !looksLikePartialEdit(message) && (
    (card.kind === 'capture' && res.decision.intent === 'correction' && (looksDone(message) || unrelated(card.payload.proposal?.title ?? card.text)))
    || (card.kind === 'action' && ['correction', 'instruction'].includes(res.decision.intent) && unrelated(card.text)))
  if (ownMessage) {
    const again = await ask(null)
    if (again.ok) { res = again; card = null }
  }

  const d = res.decision
  // A change to a day plan that isn't applied yet: plan that day again with his words. (Not the small add-only cards:
  // "move it to tomorrow", "fit X into your plan", a knock-on: his next instruction is about something else.)
  const replannable = card?.kind === 'plan' && !(card.payload as { add?: boolean }).add
  if (replannable && card && ['plan', 'correction', 'instruction'].includes(d.intent)) {
    const was = card.payload as { date?: string; week?: unknown; training?: unknown }
    if (was.training) {
      // a change to a training plan: "upper on Thursday", "lower light on Fri" (or a whole new question)
      const named = Array.isArray(d.plan?.training) ? d.plan!.training : null
      await proposeTrainingPlan(sb, chatId, message, named ?? [], data, { replaces: named ? null : card as never, onReplace: () => replaceOld(sb, chatId, card) })
      return 'plan'
    }
    if (was.week || d.plan?.week) {
      await proposeWeekPlan(sb, chatId, message, ctx, data, { replaces: card, onReplace: () => replaceOld(sb, chatId, card) })
      return 'plan'
    }
    await proposePlan(sb, chatId, { date: d.plan?.date && d.intent === 'plan' ? d.plan.date : was.date ?? todayISO(), from: d.plan?.from ?? null, minutes: d.plan?.minutes ?? null, until: d.plan?.until ?? null, energy: d.plan?.energy ?? null, words: message },
      ctx, data, { replaces: card, onReplace: () => replaceOld(sb, chatId, card) })
    return 'plan'
  }
  // A change to a card that lists changes is a new list of changes, not a re-sorted item.
  if (card?.kind === 'action' && (d.intent === 'correction' || d.intent === 'instruction')) {
    return proposeChanges(sb, chatId, message, d, ctx, history, card, data)
  }
  switch (d.intent) {
    case 'new':
      await newCard(sb, chatId, d.itemText!, { kind: d.itemKind })
      return 'new'
    case 'correction':
      await newCard(sb, chatId, d.itemText!, { kind: d.itemKind, replaces: card })
      return 'correction'
    case 'question':
      await answer(sb, chatId, message, d.answer!, d.show ? await renderAny(sb, data, d.show) : null)
      return 'question'
    case 'instruction':
      return proposeChanges(sb, chatId, message, d, ctx, history, null, data)
    case 'app_idea':
      await saveIdea(sb, chatId, d.idea!, message, d.needs ?? '')
      return 'app_idea'
    case 'plan':
      if (d.plan!.training === 'note') await noteWeek(sb, chatId, message, data)
      else if (d.plan!.training?.length) await proposeTrainingPlan(sb, chatId, message, d.plan!.training, data)
      else if (d.plan!.week) await proposeWeekPlan(sb, chatId, message, ctx, data)
      else await proposePlan(sb, chatId, { ...d.plan!, words: message }, ctx, data)
      return 'plan'
    default:
      // While a card is being edited its buttons are hidden: offer them again ("that's okay" = keep it).
      await say(sb, chatId, esc(d.reply), card?.status === 'editing' ? editButtons(card.id, card.kind) : undefined, { intent: d.intent, pending_id: card?.id ?? null })
      return d.intent
  }
}

/**
 * Changes to saved records: plain code checks each one the brain proposed (real record, his words for dates,
 * sane values), then one card shows them all. Nothing changes until ✅ Apply. `replaces`: a change card being corrected.
 */
async function proposeChanges(sb: SupabaseClient, chatId: number, message: string, d: Decision, ctx: PlannerContext,
  history: TurnRow[], replaces: Pending | null, data: ViewData): Promise<Outcome> {
  const said = [...history.filter((t) => t.role === 'nat').map((t) => t.text), message].join('\n')
  const optionActions = d.asks.flatMap((q) => q.options.flatMap((o) => o.actions))
  const rows = await loadRows(sb, [...d.actions, ...optionActions], ctx)
  const { actions, problems } = checkActions(d.actions, ctx, rows, said, todayISO())
  // a quick-tap question per unclear part: each answer's changes are checked now, like the rest (lib/telegram/cards.ts)
  const asks: Ask[] = d.asks.map((q) => ({
    question: q.question,
    options: q.options.map((o) => ({ label: o.label, actions: checkActions([...d.actions, ...o.actions], ctx, rows, said, todayISO()).actions.slice(actions.length) }))
      .filter((o) => o.actions.length),
  })).filter((q) => q.options.length)
  if (!actions.length && asks.length) {
    // nothing clear yet: the card is just the question
    await actionCard(sb, chatId, message, [], problems, { replaces, asks })
    return 'instruction'
  }
  if (!actions.length) {
    // a change it has no way to make: say so and keep it for Claude Code (standing rule, CLAUDE.md)
    if (!problems.length && !d.actions.length) { await saveIdea(sb, chatId, message, message, d.needs || d.reply); return 'app_idea' }
    await say(sb, chatId, `${esc(d.reply || 'Which one do you mean?')}\n<i>Nothing to change: ${esc(problems.join('; '))}.</i>`, undefined, { intent: 'instruction' })
    return 'instruction'
  }
  // what it knocks on in this week's plan, or two options if it clashes with another session (lib/telegram/ripple.ts)
  await actionCard(sb, chatId, message, actions, problems, { replaces, asks, ...(await planEffect(sb, actions, data)) })
  return 'instruction'
}

/**
 * What a plug-in's fast path understood. Changes are checked exactly like the brain's (no snapshot needed: a plug-in's
 * refs are its own) and shown on the usual card; if none of them survive the checks, the brain reads the message instead.
 */
async function useFast(sb: SupabaseClient, chatId: number, message: string, r: FastResult): Promise<Outcome | null> {
  if (r.kind === 'handled') return r.intent ?? 'question'   // the plug-in replied itself (and says what it was)
  if (r.kind === 'answer') { await say(sb, chatId, r.html, r.buttons, { intent: 'question' }); return 'question' }
  if (r.kind === 'idea') { await saveIdea(sb, chatId, r.request, message); return 'app_idea' }   // (a fast path knows what, not what's needed)
  const today = todayISO()
  // the records its actions name, if it gave any ("E1" → that event): built-in ops can then find them like the brain's
  const refs = new Map((r.refs ?? []).map(([key, ref]) => [key.trim().toUpperCase(), ref] as const)) as unknown as PlannerContext['refs']
  const ctx: PlannerContext = { today, weekStart: weekStartISO(today), snapshot: '', refs }
  const raw = r.actions.map((a) => ({ op: a.op, ref: a.ref ?? '', value: a.value ?? '', date: a.date ?? '', date_to: a.date_to ?? '', time: a.time ?? '', time_to: a.time_to ?? '', number: a.number ?? 0, words: a.words ?? '' }))
  const rows = await loadRows(sb, raw, ctx)
  const { actions, problems } = checkActions(raw, ctx, rows, message, today)
  if (!actions.length) return null
  const builtIn = actions.some((a) => !pluginFor(a.op))
  await actionCard(sb, chatId, message, actions, problems, { ...(r.head ? { head: r.head } : {}), ...(builtIn ? await planEffect(sb, actions) : {}) })
  return 'instruction'
}

/** A question's answer: the plan (real records only), an exact list if asked for, anything unsure, and an offer to save a fact. */
async function answer(sb: SupabaseClient, chatId: number, question: string, a: AskAnswer, list: { html: string; refs: Ref[] } | null) {
  const lines = [esc(a.answer)]
  if (list) lines.push('', list.html)
  if (a.plan.length) {
    lines.push('')
    a.plan.forEach((p, i) => lines.push(`${i + 1}. <b>${esc(p.title)}</b>${p.focus ? ` · ${esc(p.focus)}` : ''}${p.minutes ? ` — ${p.minutes} min` : ''}`))
  }
  if (a.unsure) lines.push('', `<i>Not sure: ${esc(a.unsure)}</i>`)
  for (const n of a.notes) lines.push(`<i>${esc(n)}</i>`)
  let buttons: Button[][] | undefined
  let pendingId: string | null = null
  if (a.fact_to_save) {
    const { data, error } = await sb.from('telegram_pending').insert({ kind: 'fact', text: question, payload: { fact: a.fact_to_save } }).select('id').single()
    if (!error && data) {
      pendingId = data.id
      lines.push('', `Save as a fact about you? “${esc(a.fact_to_save)}”`)
      buttons = [[{ text: '💾 Save fact', callback_data: `f:${data.id}` }, { text: '❌ No', callback_data: `x:${data.id}` }]]
    }
  }
  const refs: Ref[] = [...a.plan.map((p) => ({ kind: p.kind, id: p.id, title: p.title })), ...(list?.refs ?? [])]
  await say(sb, chatId, lines.join('\n'), buttons, { intent: 'question', refs, pending_id: pendingId })
}

const STOP = new Set(['the', 'and', 'for', 'due', 'with', 'this', 'that', 'next', 'make', 'its', 'it’s', 'from', 'about', 'add', 'need', 'have', 'today', 'tomorrow', 'week'])
const wordsOf = (s: string) => new Set(s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)))
/** A report that something is finished ("Sam's CS homework is done", "finished the physics sheet", "did my reading"). */
export const looksDone = (message: string) =>
  /\b(is|are|'s|’s|was|were|all|now)\s+(done|finished|complete|completed|handed in|submitted|sent)\b|^(done|finished|completed|did|handed in|submitted)\b/i.test(message.trim())

/** Do two texts share a real word ("Chemistry notes" and "Chemistry notes due Friday, 30 min")? */
export function sharesWords(a: string, b: string): boolean {
  const x = wordsOf(a)
  return [...wordsOf(b)].some((w) => x.has(w))
}

/**
 * Without the brain: never save a meta-message; a card being edited takes the message as its whole new
 * version; questions wait; anything else is sorted into a card as before (the cheap sorter still runs).
 */
export async function simpleMode(sb: SupabaseClient, chatId: number, message: string, card: Pending | null, why: string): Promise<Outcome> {
  markPath('simple')
  if (looksLikeMeta(message)) {
    await say(sb, chatId, `${why}, so I can only take new things right now. Nothing saved.`, card?.status === 'editing' ? editButtons(card.id) : undefined, { intent: 'chat' })
    return 'chat'
  }
  if (card?.status === 'editing') {
    if (looksLikePartialEdit(message)) {
      await say(sb, chatId, `${why}, so I can’t apply a change like that. Send the whole corrected version (e.g. “Physics homework due Thursday”), or /cancel.`, undefined, { pending_id: card.id })
      return 'unclear'
    }
    await newCard(sb, chatId, message, { replaces: card })
    return 'correction'
  }
  if (isQuestion(message)) {
    await say(sb, chatId, `${why}, so I can’t answer questions right now. Try again later${why.includes('limit') ? ' (or raise the limit with /cap 2)' : ''}.`, undefined, { intent: 'question' })
    return 'question'
  }
  await newCard(sb, chatId, message)
  return 'new'
}
