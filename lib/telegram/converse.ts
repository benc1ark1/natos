// Server-only: one typed message from Nat -> the brain decides what it is -> the bot acts on it.
// New items and corrections become cards (nothing saved before ✅). Questions are answered from his data.
// Past the daily AI cap, or if the AI is down, "simple mode" keeps capture working without the brain.
import 'server-only'
import { guidesForAI, relevantGuides } from '../guides-search'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordUsage, budget } from '../ai/usage'
import { loadPlannerContext, type PlannerContext } from '../ask/server'
import type { AskAnswer } from '../ask/types'
import { todayISO } from '../time'
import { esc, typing, type Button } from './api'
import { looksLikeMeta, looksLikePartialEdit, think, type Decision } from './brain'
import { checkActions, loadRows } from './actions'
import { proposePlan, proposeWeekPlan } from './dayplan'
import { noteWeek, proposeTrainingPlan } from './trainplan'
import { actionCard, cardForAI, editButtons, newCard, openCard, planEffect, replaceOld, type Ask, type Pending } from './cards'
import { recentTurns, say, transcript, type Ref, type TurnRow } from './turns'
import { ASYNC_VIEWS, freeTimeForAI, loadViewData, matchView, type ViewData } from './views'
import { saveIdea } from './ideas'
import { askNextGap, typedGapAnswer } from './gapask'
import { claim, release } from './sent'
import { renderAny, weekPlanForAI } from './views-more'
import { proposeOwenDays } from './owen'

export type Outcome = Decision['intent'] | 'failed'

/** Is this a question? Only used in simple mode; normally the brain decides. */
export function isQuestion(text: string): boolean {
  const t = text.trim().toLowerCase()
  return /\?\s*$/.test(t) || /^(what|what's|whats|how|when|where|which|who|why|should|shall|am i|can i|could i|plan my|tell me|show me|give me)\b/.test(t)
}

export async function converse(sb: SupabaseClient, chatId: number, turn: TurnRow, opts: { claim: (key: string) => Promise<boolean>; forceQuestion?: boolean }): Promise<Outcome> {
  const message = turn.text.replace(/^\/ask\b\s*/, '').trim()
  if (!message) { await say(sb, chatId, 'Send a question, e.g. /ask what should I do now?'); return 'unclear' }

  const [history, card, money] = await Promise.all([recentTurns(sb, turn.id), openCard(sb), budget(sb).catch(() => null)])

  // Instant, free answers ("what's in my inbox?", /week, "when am I free tomorrow?"): no AI at all.
  // Not while a card is waiting, where a word like "today" may be a change to the card.
  const today = todayISO()
  // (with a card waiting, only the whole-question lists answer instantly: "where can I save time?", "how's my load?")
  const matched = matchView(message, today)
  const view = !card || message.startsWith('/') || (matched && ASYNC_VIEWS.includes(matched.view)) ? matched : null
  if (view && !opts.forceQuestion) {
    const r = await renderAny(sb, await loadViewData(sb, today), view)
    await say(sb, chatId, r.html, r.buttons, { intent: 'question', refs: r.refs })
    return 'question'
  }
  // Build O: "ask me now" goes through the gap questions; a typed answer to the question waiting is saved (no AI)
  if (!message.startsWith('/')) {
    if (/^(?:ok |okay )?(?:ask me (?:now|the questions|them)|go through (?:the|your) questions|ask away|start asking(?: me)?(?: questions)? again)\b/i.test(message)) {
      await release(sb, 'gaps:paused')   // questions back on (a pause he set)
      if (!(await askNextGap(sb, chatId, new Date(), { force: true }))) await say(sb, chatId, 'Nothing to ask right now (or it’s school / late: I’ll ask later).', undefined, { intent: 'question' })
      return 'question'
    }
    if (/^(?:please )?(?:stop|pause|no more) (?:asking(?: me)?(?: questions)?|questions)\b/i.test(message)) {
      await claim(sb, 'gaps:paused').catch(() => false)
      await say(sb, chatId, '⏸ No more questions until you say “ask me now”. Plans keep using my guesses (“what do you still need to know?” lists them).', undefined, { intent: 'instruction' })
      return 'instruction'
    }
    if (await typedGapAnswer(sb, chatId, message)) return 'instruction'
    // "which days should I give Owen?": the optimiser on a typical week (no AI)
    if (/\b(?:which|what) days (?:should|do|can) i (?:give|tell|send|offer)(?: to)? owen\b|\bbest days for owen\b|\bowen'?s days\??$|\bdays (?:to give|for) owen\b/i.test(message)) {
      await typing(chatId)
      await proposeOwenDays(sb, chatId, await loadViewData(sb, today))
      return 'question'
    }
  }

  if (money?.over) {
    if (await opts.claim(`cap:${todayISO()}`)) {
      await say(sb, chatId, `💸 Today’s AI limit ($${money.cap.toFixed(2)}) is used up, so I’m in simple mode until midnight: new things still get sorted, but questions and changes wait. /usage for details · /cap 2 to raise the limit.`)
    }
    return simpleMode(sb, chatId, message, card, 'Today’s AI limit is used up')
  }

  await typing(chatId)
  const [ctx, data] = await Promise.all([loadPlannerContext(sb), loadViewData(sb, today)])
  const weekPlan = await weekPlanForAI(sb, data).catch(() => undefined)
  const res = await think(
    {
      now: ctx.snapshot.split('\n', 1)[0], transcript: transcript(history), card: card ? cardForAI(card) : null,
      cardEditing: card?.status === 'editing', message, freeTime: freeTimeForAI(data), today, forceQuestion: opts.forceQuestion,
      guides: (() => { const g = relevantGuides(ctx.guides ?? [], message); return g.length ? guidesForAI(g) : undefined })(),
      weekPlan,
    },
    ctx,
    (model, usage) => recordUsage(sb, 'chat', model, usage),
  )
  if (!res.ok) {
    await say(sb, chatId, `⚠️ ${esc(res.error)}`)
    return simpleMode(sb, chatId, message, card, 'The AI didn’t answer')
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
      await saveIdea(sb, chatId, d.idea!, message)
      return 'app_idea'
    case 'plan':
      await typing(chatId)
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
    if (!problems.length && !d.actions.length) { await saveIdea(sb, chatId, message, message); return 'app_idea' }
    await say(sb, chatId, `${esc(d.reply || 'Which one do you mean?')}\n<i>Nothing to change: ${esc(problems.join('; '))}.</i>`, undefined, { intent: 'instruction' })
    return 'instruction'
  }
  // what it knocks on in this week's plan, or two options if it clashes with another session (lib/telegram/ripple.ts)
  await actionCard(sb, chatId, message, actions, problems, { replaces, asks, ...(await planEffect(sb, actions, data)) })
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
      buttons = [[{ text: '💾 Save fact', callback_data: `f:${data.id}` }, { text: '✖ No', callback_data: `x:${data.id}` }]]
    }
  }
  const refs: Ref[] = [...a.plan.map((p) => ({ kind: p.kind, id: p.id, title: p.title })), ...(list?.refs ?? [])]
  await say(sb, chatId, lines.join('\n'), buttons, { intent: 'question', refs, pending_id: pendingId })
}

/**
 * Without the brain: never save a meta-message; a card being edited takes the message as its whole new
 * version; questions wait; anything else is sorted into a card as before (the cheap sorter still runs).
 */
export async function simpleMode(sb: SupabaseClient, chatId: number, message: string, card: Pending | null, why: string): Promise<Outcome> {
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
