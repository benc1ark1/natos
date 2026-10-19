// Server-only: cards (a proposal waiting for Nat's tap) and what each button does.
// Two kinds: a new item (✅ Save / 📥 Inbox) and a list of changes to saved records (✅ Apply, then ↩️ Undo).
// Nothing is saved until Nat taps. ✏️ Edit / ✏️ Change keeps the card waiting for his correction;
// a corrected card replaces the old one (status 'replaced'). Rows are never deleted.
import 'server-only'
import { sourceLabel } from '../lists'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveProposal, saveUnsorted, type UndoRef } from '../capture/save'
import { sortCapture } from '../capture/sort'
import { KIND_LABELS, type CaptureKind, type Duplicate, type Proposal } from '../capture/types'
import { captureToInbox } from '../data'
import { dowShort, shortDate, todayISO } from '../time'
import { applyActions, undoActions, type Action, type Applied } from './actions'
import { applyPlan, offerSlot, planButtons, undoPlan, type PlanApplied, type PlanPayload } from './dayplan'
import { loadViewData } from './views'
import { applyRipple, clashOptions, knockOn, loadWorld, rippleLines, undoRipple, type RippleApplied } from './ripple'
import type { Ripple } from '../week'
import { answerTap, clearButtons, editCard, esc, type Button } from './api'
import type { TgUpdate } from './guard'
import { refreshPinned } from './pinned'
import { dropIdea } from './ideas'
import { askNextType, setType, type TypeQuestion } from './asktype'
import { pickSlot, showSlotOptions } from './trainplan'
import { pickWeekSlot } from './yourweek'
import { answerGap, askNextGap } from './gapask'
import { toggleCleanup } from './cleanup'
import { tickBlock, tickTask } from './ticks'
import { recordSuggestion } from './roi'
import type { Gap } from '../gaps'
import { MEMORY_MINUTES, plain, remember, say, type Ref } from './turns'
import { draftReply } from '../mail/draft'
import { pluginAfterApply, pluginTap } from './plugins'

export type Pending = {
  id: string; kind: 'capture' | 'fact' | 'action' | 'plan' | 'idea' | 'type'; text: string
  payload: {
    proposal?: Proposal; duplicates?: Duplicate[]; summary?: string; card_message_id?: number | null; replaces?: string; fact?: string
    actions?: Action[]; problems?: string[]; applied?: Applied[] | PlanApplied; log_id?: string; undo_ref?: UndoRef
    ripple?: Ripple; rippleApplied?: RippleApplied
    options?: { label: string; actions: Action[]; ripple: Ripple }[]; chosen?: number; idea_id?: string
    table?: TypeQuestion['table']; id?: string; name?: string
    cleanup?: unknown[]
    asks?: Ask[]            // quick-tap questions about unclear parts, first one shown (q:<id>:o0 adds that answer's changes)
  } & Partial<Omit<PlanPayload, 'applied' | 'summary' | 'card_message_id' | 'replaces'>>
  status: 'open' | 'editing' | 'saved' | 'cancelled' | 'replaced' | 'undone'; updated_at: string
}

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`

/** A quick-tap question about one unclear part of a change card; each answer is its checked changes. */
export type Ask = { question: string; options: { label: string; actions: Action[] }[] }
type Clash = { clash: string; options: { label: string; actions: Action[]; ripple: Ripple }[] }

/** What a list of changes knocks on in this week's plan, or two options if it clashes with another session (lib/telegram/ripple.ts). */
export async function planEffect(sb: SupabaseClient, actions: Action[], data?: Awaited<ReturnType<typeof loadViewData>>): Promise<{ ripple?: Ripple; clash?: Clash }> {
  if (!actions.length) return {}
  const world = await loadWorld(sb, data ?? await loadViewData(sb, todayISO()))
  const clash = clashOptions(world, actions)
  if (clash) return { clash: { clash: clash.clash, options: clash.options.map((o) => ({ ...o, ripple: knockOn(world, o.actions) })) } }
  return { ripple: knockOn(world, actions) }
}

/** The change card's text and buttons: the changes, what's left out, the first open question, then 1️⃣/2️⃣ or ✅ Apply. */
function actionCardBody(id: string, actions: Action[], problems: string[], opts: { ripple?: Ripple; clash?: Clash | null; head?: string; asks?: Ask[] }) {
  const lines = [opts.head ?? `🔧 <b>${actions.length > 1 ? `${actions.length} changes` : 'Change'}</b>`, ...actions.map((a) => `• ${a.line}`)]
  if (problems.length) lines.push(`<i>Left out: ${esc(problems.join('; '))}.</i>`)
  if (opts.clash) {
    lines.push('', opts.clash.clash)
    opts.clash.options.forEach((o, i) => {
      const n = o.ripple.moves.length
      lines.push(`${i ? '2️⃣' : '1️⃣'} ${esc(o.label)}${n ? ` <i>(moves ${n} thing${n > 1 ? 's' : ''} in your plan)</i>` : ''}`)
    })
  } else lines.push(...rippleLines(opts.ripple))
  const ask = opts.asks?.[0]
  if (ask) lines.push('', `❓ <b>${esc(ask.question)}</b>${(opts.asks?.length ?? 0) > 1 ? ` <i>(1 of ${opts.asks!.length})</i>` : ''}`)
  const body = lines.join('\n')
  const askRows: Button[][] = ask ? [
    ask.options.map((o, i) => ({ text: o.label, callback_data: `q:${id}:o${i}` })),
    [{ text: '✋ Skip this part', callback_data: `q:${id}:skip` }],
  ] : []
  const buttons: Button[][] = !actions.length
    ? [...askRows, [{ text: '✖ Cancel', callback_data: `x:${id}` }]]
    : opts.clash
      ? [...askRows, [{ text: '1️⃣', callback_data: `1:${id}` }, { text: '2️⃣', callback_data: `2:${id}` }, { text: '✖ Cancel', callback_data: `x:${id}` }]]
      : [...askRows, ...actionButtons(id)]
  const tail = !actions.length ? 'Tap an answer: nothing changes until you tap ✅ Apply.'
    : `Nothing changes until you tap ${opts.clash ? '1️⃣ or 2️⃣' : '✅ Apply'}${ask ? ' (the question can be answered first, or left out)' : ''}.`
  return { body, buttons, tail }
}

export const cardButtons = (id: string): Button[][] => [
  [{ text: '✅ Save', callback_data: `s:${id}` }, { text: '📥 Inbox', callback_data: `i:${id}` }],
  [{ text: '✏️ Edit', callback_data: `e:${id}` }, { text: '✖ Cancel', callback_data: `x:${id}` }],
]

export const actionButtons = (id: string): Button[][] => [
  [{ text: '✅ Apply', callback_data: `a:${id}` }, { text: '✏️ Change', callback_data: `e:${id}` }, { text: '✖ Cancel', callback_data: `x:${id}` }],
]

/** Under the "what should I change?" message: keep the card as it is, or drop it. */
export const editButtons = (id: string, kind: Pending['kind'] = 'capture'): Button[][] =>
  [[kind === 'action' || kind === 'plan' ? { text: '✅ Apply as is', callback_data: `a:${id}` } : { text: '✅ Save as is', callback_data: `s:${id}` }, { text: '✖ Cancel', callback_data: `x:${id}` }]]

/** The card Nat is most likely talking about: the newest one still waiting (or being edited) from the last 30 minutes. */
export async function openCard(sb: SupabaseClient): Promise<Pending | null> {
  const since = new Date(Date.now() - MEMORY_MINUTES * 60_000).toISOString()
  const { data, error } = await sb.from('telegram_pending').select('id,kind,text,payload,status,updated_at')
    .in('kind', ['capture', 'action', 'plan']).in('status', ['open', 'editing']).gte('updated_at', since)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`Couldn’t read the open card: ${error.message}`)
  return (data as Pending | null) ?? null
}

/** The open card in words, for the AI. */
export const cardForAI = (c: Pending) =>
  c.kind === 'action'
    ? `A list of changes to saved records, not applied yet:\n${c.payload.summary ?? ''}\nHis words: “${c.text}”`
    : c.kind === 'plan'
      ? `A day plan, not applied yet:\n${c.payload.summary ?? ''}\nHis words: “${c.text}”`
      : `${c.payload.summary ?? '(card)'}\nHis original words: “${c.text}”`

/**
 * Show a list of checked changes as one card: "before → after", what it knocks on in the plan, then
 * ✅ Apply · ✏️ Change · ✖ Cancel. With a clash: the two options as 1️⃣ / 2️⃣ instead of Apply.
 */
export async function actionCard(sb: SupabaseClient, chatId: number, text: string, actions: Action[], problems: string[],
  opts: { replaces?: Pending | null; ripple?: Ripple; clash?: Clash | null; head?: string; asks?: Ask[] } = {}): Promise<string> {
  const draft = actionCardBody('', actions, problems, opts)
  const payload: Pending['payload'] = {
    actions, problems, summary: plain(draft.body), ...(opts.replaces ? { replaces: opts.replaces.id } : {}),
    ...(opts.ripple ? { ripple: opts.ripple } : {}), ...(opts.clash ? { options: opts.clash.options } : {}),
    ...(opts.asks?.length ? { asks: opts.asks } : {}), ...(opts.head ? { head: opts.head } : {}),
  }
  const { data, error } = await sb.from('telegram_pending').insert({ kind: 'action', text: text.trim() || 'change', payload }).select('id').single()
  if (error || !data) throw new Error(`Couldn’t hold the card: ${error?.message ?? 'not saved'}`)
  const id = data.id as string
  await replaceOld(sb, chatId, opts.replaces ?? null)
  const { body, buttons, tail } = actionCardBody(id, actions, problems, opts)
  const msgId = await say(sb, chatId, `${opts.replaces ? '✏️ <b>Corrected</b>\n' : ''}${body}\n\n${tail}`, buttons, { pending_id: id, intent: 'instruction' })
  if (msgId) await sb.from('telegram_pending').update({ payload: { ...payload, card_message_id: msgId } }).eq('id', id)
  return id
}

/**
 * His tap on a quick-tap question (q:<id>:o<n> or q:<id>:skip): that answer's changes join the card (or the part is
 * left out), the knock-on is worked out again, and the card is redrawn in place with the next question, if any.
 */
async function answerAsk(sb: SupabaseClient, chatId: number, card: Pending, arg: string, messageId: number | undefined) {
  const p = card.payload
  const [ask, ...rest] = p.asks ?? []
  const back = () => sb.from('telegram_pending').update({ status: card.status }).eq('id', card.id)
  if (!ask) { await back(); await say(sb, chatId, 'That question isn’t there any more.', undefined, { pending_id: card.id }); return }
  const opt = arg === 'skip' ? null : ask.options[Number(arg.slice(1))]
  if (arg !== 'skip' && !opt) { await back(); await say(sb, chatId, 'That answer isn’t there any more: tell me instead.', undefined, { pending_id: card.id }); return }
  await remember(sb, 'nat', opt ? `(answered “${ask.question}”: ${opt.label})` : `(skipped “${ask.question}”)`, { intent: 'tap', pending_id: card.id })
  const actions = [...(p.actions ?? []), ...(opt?.actions ?? [])]
  const problems = [...(p.problems ?? []), ...(opt ? [] : [`${ask.question.replace(/\?$/, '')} (skipped)`])]
  if (!actions.length && !rest.length) {
    await sb.from('telegram_pending').update({ status: 'cancelled' }).eq('id', card.id)
    if (messageId) await clearButtons(chatId, messageId)
    await say(sb, chatId, 'Okay, nothing to change then.', undefined, { pending_id: card.id })
    return
  }
  const effect = await planEffect(sb, actions)
  const head = (p as { head?: string }).head
  const opts = { ...effect, asks: rest, ...(head ? { head } : {}) }
  const { body, buttons, tail } = actionCardBody(card.id, actions, problems, opts)
  const payload: Pending['payload'] = { ...p, actions, problems, summary: plain(body), asks: rest, ripple: effect.ripple, options: effect.clash?.options }
  // the card goes back to waiting (or being edited), with the answer in it
  await sb.from('telegram_pending').update({ payload, status: card.status }).eq('id', card.id)
  const html = `${body}\n\n${tail}`
  if (messageId) await editCard(chatId, messageId, html, buttons).catch(async () => { await say(sb, chatId, html, buttons, { pending_id: card.id, intent: 'instruction' }) })
  else await say(sb, chatId, html, buttons, { pending_id: card.id, intent: 'instruction' })
}

/** The old card a corrected one replaces: 'replaced' (if still waiting) and its buttons removed. */
export async function replaceOld(sb: SupabaseClient, chatId: number, old: Pending | null) {
  if (!old) return
  const { data: was } = await sb.from('telegram_pending').update({ status: 'replaced' }).eq('id', old.id).in('status', ['open', 'editing']).select('id').maybeSingle()
  if (was && old.payload.card_message_id) await clearButtons(chatId, old.payload.card_message_id)
}

/** The proposal as a short message, with names instead of ids. */
export async function describe(sb: SupabaseClient, p: Proposal, dups: Duplicate[]): Promise<string> {
  const name = async (table: string, col: string, id: string | null) => {
    if (!id) return null
    const { data } = await sb.from(table).select(col).eq('id', id).maybeSingle()
    return (data as Record<string, string> | null)?.[col] ?? null
  }
  const bits: string[] = []
  const head = `<b>${esc(KIND_LABELS[p.kind])}</b>: ${esc(p.kind === 'fact' ? p.fact ?? p.title : p.title)}`
  switch (p.kind) {
    case 'task': {
      const subject = await name('subjects', 'name', p.subject_id)
      if (subject) bits.push(subject)
      bits.push(p.importance === 'must' ? 'must' : 'nice')
      if (p.due) bits.push(`due ${day(p.due)}`)
      else if (p.window_end) bits.push(`${p.window_label ?? 'by'} (by ${day(p.window_end)})`)
      if (p.duration_minutes) bits.push(`~${p.duration_minutes} min`)
      if (p.origin && p.origin !== 'own') bits.push(`from ${sourceLabel(await sb.from('profiles').select('planning').maybeSingle().then((r) => r.data?.planning ?? null), p.origin)}`)
      if (p.hand_in) bits.push(`hand in: ${p.hand_in}`)
      break
    }
    case 'idea': bits.push(p.someday ? 'goes to Someday' : 'goes to Inbox'); break
    case 'test': bits.push(p.test_date ? day(p.test_date) : 'no date yet (Edit to add one)', 'prep sessions get planned'); break
    case 'reminder':
      bits.push(p.reminder_kind === 'person' ? `next time you see ${p.person}` : p.remind_day ? `${day(p.remind_day)}${p.remind_time ? ` ${p.remind_time}` : ''}` : 'no day yet')
      break
    case 'goal_progress': bits.push(`${(await name('weekly_targets', 'name', p.target_id)) ?? 'which target?'} +${p.amount}`, day(p.done_on)); break
    case 'event_change': {
      const ev = (await name('events', 'title', p.event_id)) ?? 'which event?'
      const to = p.cancel ? 'cancelled' : [p.new_date && day(p.new_date), p.new_start && `${p.new_start}${p.new_end ? `–${p.new_end}` : ''}`].filter(Boolean).join(' ')
      bits.push(`${ev}${p.event_on_date ? ` on ${day(p.event_on_date)}` : ''} → ${to || '?'}`, p.event_scope === 'every' ? 'every week' : 'just this week')
      break
    }
    case 'resource': if (p.url) bits.push(p.url); break
    case 'fact': break
    case 'study': {
      const subject = await name('subjects', 'name', p.subject_id)
      const topic = await name('topics', 'name', p.topic_id)
      const stage = await name('pipeline_stages', 'name', p.stage_id)
      bits.push(`${subject ? `${subject} · ` : ''}${topic ?? 'which topic?'}: ${stage ? `${stage} ✓` : 'which stage?'}`)
      break
    }
    case 'mistake': {
      const subject = await name('subjects', 'name', p.subject_id)
      const topic = await name('topics', 'name', p.topic_id)
      bits.push(...[subject, topic].filter((x): x is string => !!x), 'comes back for review in a few days')
      break
    }
  }
  const lines = [head]
  if (bits.length) lines.push(esc(bits.join(' · ')))
  for (const d of dups) lines.push(`⚠️ Looks like a duplicate: ${esc(d.what)} “${esc(d.title)}”`)
  for (const n of p.notes) lines.push(`<i>${esc(n)}</i>`)
  if (p.reasoning) lines.push(`<i>Why: ${esc(p.reasoning)}</i>`)
  return lines.join('\n')
}

/**
 * Sort `text` into a new card and send it. With `replaces`, the new card takes the old one's place:
 * the old one becomes 'replaced' and loses its buttons. If sorting fails, a new item is kept in Inbox
 * ("never lose the words"), but a correction leaves the old card exactly as it was.
 */
export async function newCard(sb: SupabaseClient, chatId: number, text: string,
  opts: { kind?: CaptureKind | null; replaces?: Pending | null } = {}): Promise<void> {
  const old = opts.replaces ?? null
  const res = await sortCapture(sb, text, { kind: opts.kind ?? undefined })
  if (!res.ok) {
    if (old) {
      await say(sb, chatId, `⚠️ Couldn’t sort the correction (${esc(res.error)}). The card is unchanged: try again, or tap a button on it.`, undefined, { pending_id: old.id })
      return
    }
    const saved = await saveUnsorted(sb, text)
    await say(sb, chatId, saved.error
      ? `⚠️ Couldn’t sort it (${esc(res.error)}) and couldn’t save it: ${esc(saved.error)}`
      : `⚠️ Couldn’t sort it (${esc(res.error)}). Saved to Inbox as “not sorted yet”.`,
    undefined, { refs: saved.task ? [{ kind: 'task', id: saved.task.id, title: saved.task.title }] : [] })
    return
  }
  await proposalCard(sb, chatId, text, res.proposal, res.duplicates, { replaces: old })
}

/** Show a sorted proposal as a card (✅ Save · 📥 Inbox · ✏️ Edit · ✖ Cancel). `head`: a line above it (an email's sender).
 *  Returns the card's id. */
export async function proposalCard(sb: SupabaseClient, chatId: number, text: string, proposal: Proposal, duplicates: Duplicate[],
  opts: { replaces?: Pending | null; head?: string } = {}): Promise<string> {
  const old = opts.replaces ?? null
  const body = `${opts.head ? `${opts.head}\n` : ''}${await describe(sb, proposal, duplicates)}`
  const payload: Pending['payload'] = { proposal, duplicates, summary: plain(body), ...(old ? { replaces: old.id } : {}) }
  const { data, error } = await sb.from('telegram_pending').insert({ kind: 'capture', text: text.trim(), payload }).select('id').single()
  if (error || !data) throw new Error(`Couldn’t hold the card: ${error?.message ?? 'not saved'}`)
  const id = data.id as string

  await replaceOld(sb, chatId, old)   // only a card still waiting is replaced (a tap on it in the meantime wins)
  const head = old ? '✏️ <b>Corrected</b>\n' : ''
  const msgId = await say(sb, chatId, `${head}${body}\n\nNothing is saved until you tap ✅ Save.`, cardButtons(id), { pending_id: id })
  // remember which message holds the buttons, so a correction or /cancel can remove them
  if (msgId) await sb.from('telegram_pending').update({ payload: { ...payload, card_message_id: msgId } }).eq('id', id)
  return id
}

/** /cancel: drop the card that's waiting. */
export async function cancelOpenCard(sb: SupabaseClient, chatId: number): Promise<void> {
  const card = await openCard(sb)
  if (!card) { await say(sb, chatId, 'Nothing to cancel.'); return }
  const { data } = await sb.from('telegram_pending').update({ status: 'cancelled' }).eq('id', card.id).in('status', ['open', 'editing']).select('id').maybeSingle()
  if (data && card.payload.card_message_id) await clearButtons(chatId, card.payload.card_message_id)
  await say(sb, chatId, data ? `Cancelled “${esc(card.payload.proposal?.title ?? card.text)}”. Nothing saved.` : 'Already handled.', undefined, { pending_id: card.id })
}

// ---------------------------------------------------------------------------
// Button taps: s = save, i = inbox, f = save fact, a = apply changes, e = edit/change, x = cancel, u = undo,
// t:<id>:<type> = his answer to "what type of training is …?"
// ---------------------------------------------------------------------------

type Tap = NonNullable<TgUpdate['callback_query']>
const TAP_WORDS: Record<string, string> = { s: '✅ Save', i: '📥 Inbox', e: '✏️ Edit', x: '✖ Cancel', f: '💾 Save fact', a: '✅ Apply', u: '↩️ Undo', 1: 'option 1️⃣', 2: 'option 2️⃣', t: 'a training type', o: '🔁 Move a session', p: 'a new slot', g: 'an answer', c: 'keep / archive', q: 'an answer' }
// Which cards each button works on, and the status a tap moves the card to (in one step, so a double tap
// can't do it twice). A card being edited can still be saved/applied as it is, or cancelled.
const TAP_RULES: Record<string, { kinds: Pending['kind'][]; from: Pending['status'][]; to: Pending['status'] }> = {
  s: { kinds: ['capture'], from: ['open', 'editing'], to: 'saved' },
  i: { kinds: ['capture'], from: ['open', 'editing'], to: 'saved' },
  f: { kinds: ['fact'], from: ['open'], to: 'saved' },
  a: { kinds: ['action', 'plan'], from: ['open', 'editing'], to: 'saved' },
  1: { kinds: ['action'], from: ['open', 'editing'], to: 'saved' },
  2: { kinds: ['action'], from: ['open', 'editing'], to: 'saved' },
  e: { kinds: ['capture', 'action', 'plan'], from: ['open', 'editing'], to: 'editing' },
  x: { kinds: ['capture', 'action', 'fact', 'plan'], from: ['open', 'editing'], to: 'cancelled' },
  u: { kinds: ['action', 'capture', 'plan', 'idea', 'type'], from: ['saved'], to: 'undone' },
  t: { kinds: ['type'], from: ['open'], to: 'saved' },
  o: { kinds: ['plan'], from: ['open', 'editing'], to: 'open' },   // 🔁 under a training plan: where else could it go?
  p: { kinds: ['plan'], from: ['open', 'editing'], to: 'open' },   // …that one (a new card follows)
  g: { kinds: ['type'], from: ['open'], to: 'saved' },             // an answer to a gap question (lib/telegram/gapask.ts)
  c: { kinds: ['action'], from: ['open', 'editing'], to: 'open' }, // ✓ Keep / 🗄 Archive one session on the clean-up card
  q: { kinds: ['action'], from: ['open', 'editing'], to: 'open' }, // an answer to a quick-tap question on a change card
}

export async function onTap(sb: SupabaseClient, chatId: number, q: Tap) {
  // a plug-in's own buttons ("trk:…", lib/telegram/plugins): it answers the tap itself
  const owned = pluginTap(q.data ?? '')
  if (owned && q.id) {
    await answerTap(q.id)
    await remember(sb, 'nat', `(tapped ${(q.data ?? '').split(':')[0]})`, { intent: 'tap' })
    await owned(sb, chatId, q.data ?? '', q.message?.message_id)
    return
  }
  // ✍️ Draft a reply (under an email alert): no card behind it, just the email (lib/mail/draft.ts)
  const draft = (q.data ?? '').match(/^d:([0-9a-f-]{36})$/)
  if (draft && q.id) {
    await answerTap(q.id, 'Drafting…')
    await remember(sb, 'nat', '(tapped ✍️ Draft a reply)', { intent: 'tap' })
    await draftReply(sb, chatId, draft[1])
    return
  }
  // tap-to-tick on the brief and the pinned Today (no card behind it)
  const tick = (q.data ?? '').match(/^([kj]):([0-9a-f-]{36})$/)
  if (tick && q.id) {
    if (tick[1] === 'k') await tickBlock(sb, chatId, q.id, tick[2], q.message?.message_id)
    else await tickTask(sb, chatId, q.id, tick[2], q.message?.message_id)
    return
  }
  const m = (q.data ?? '').match(/^([siexfau12]):([0-9a-f-]{36})$|^([topgcq]):([0-9a-f-]{36}):([a-z][a-z0-9_]{0,24})$/)
  if (!m || !q.id) { if (q.id) await answerTap(q.id); return }
  const action = m[1] ?? m[3], id = m[2] ?? m[4], arg = m[5] ?? ''
  const messageId = q.message?.message_id
  const rule = TAP_RULES[action]

  const { data: row } = await sb.from('telegram_pending').update({ status: rule.to })
    .eq('id', id).in('kind', rule.kinds).in('status', rule.from).select('*').maybeSingle()
  if (!row) { await answerTap(q.id, 'Already handled.'); if (messageId) await clearButtons(chatId, messageId); return }
  await answerTap(q.id)
  if (action === 'c') { await toggleCleanup(sb, chatId, row as never, arg, messageId); return }   // redrawn in place, buttons kept
  if (action === 'q') { await answerAsk(sb, chatId, row as Pending, arg, messageId); return }   // redrawn in place
  if (messageId) await clearButtons(chatId, messageId)
  await remember(sb, 'nat', `(tapped ${action === 't' ? arg : TAP_WORDS[action]})`, { intent: 'tap', pending_id: id })
  const card = row as Pending
  const back = (status: Pending['status'] = 'open') => sb.from('telegram_pending').update({ status }).eq('id', id)
  const tell = (html: string, buttons?: Button[][], refs: Ref[] = []) => say(sb, chatId, html, buttons, { pending_id: id, refs })
  const pinned = () => refreshPinned(sb, chatId, new Date(), { byNat: true })   // the pinned "Today" message

  if (action === 'o' || action === 'p') {
    const p = card.payload as unknown as PlanPayload
    if (!p.training && !p.yourWeek) { await tell('⚠️ Sessions on that card can’t be moved one by one: tell me what to change.'); return }
    const data = await loadViewData(sb, todayISO())
    if (action === 'o') await showSlotOptions(sb, chatId, id, p, arg, data)
    else if (p.yourWeek) await pickWeekSlot(sb, chatId, { id, payload: p }, arg, data)
    else await pickSlot(sb, chatId, { id, payload: p }, arg, data)
    return
  }

  if (action === 'g') {
    const g = (card.payload as { gap?: Gap }).gap
    if (!g) { await tell('That question isn’t there any more.'); return }
    if (arg === 'skip') {
      await tell('✋ Skipped for now. I’ll ask again another day (until then I keep guessing).')
      await askNextGap(sb, chatId, new Date()).catch(() => false)
      return
    }
    const opt = g.options[Number(arg.slice(1))]
    if (!opt) { await back(); await tell('That answer isn’t there any more: type it instead.'); return }
    await answerGap(sb, chatId, { id, payload: card.payload as never, created_at: card.updated_at, status: 'saved' }, opt.value)
    return
  }

  if (action === 't') {
    const q2 = card.payload as unknown as TypeQuestion
    const res = await setType(sb, q2, arg)
    if (res.error) { await back(); await tell(`⚠️ ${esc(res.error)} Tap a type again, or tell me (“${esc(q2.name)} is a sprint session”).`); return }
    await sb.from('telegram_pending').update({ payload: { ...card.payload, applied: res.applied } }).eq('id', id)
    await tell(`✅ <b>${esc(q2.name)}</b>: ${esc(res.words!)}. Saved.`, [[{ text: '↩️ Undo', callback_data: `u:${id}` }]])
    return
  }

  if (action === 'x') {
    const roi = (card.payload as { roi?: { key: string; title: string; savesMin: number; weekStart: string } }).roi
    if (roi) { await recordSuggestion(sb, roi, roi.weekStart, 'dismissed'); await tell('✋ Not now: I won’t suggest it again this week.'); return }
    await tell(card.kind === 'action' ? 'Cancelled. Nothing changed.' : 'Cancelled. Nothing saved.')
    return
  }
  if (action === 'e') {
    if (card.kind === 'plan') { await tell('✏️ What should be different? e.g. “no physics tonight”, “start at 7”, “add the gym”, “I only have an hour”.', editButtons(id, card.kind)); return }
    await tell(card.kind === 'action'
      ? '✏️ What should be different? e.g. “not that one, the maths one”, “Thursday instead”, “leave the reminder”.'
      : '✏️ What should I change? e.g. “make it Thursday”, “it’s a task”, “45 min”, or send the whole thing again.', editButtons(id, card.kind))
    return
  }

  if (action === 'a' && card.kind === 'plan') {
    const p = card.payload as unknown as PlanPayload
    const res = await applyPlan(sb, id, p)
    if (res.error) { await back(); await tell(`⚠️ Plan not saved: ${esc(res.error)}`, planButtons(id)); return }
    await sb.from('telegram_pending').update({ payload: { ...card.payload, applied: res.applied } }).eq('id', id)
    if (p.add && !p.blocks.length && p.ripple) {   // a "moved X — ✅?" card (lib/telegram/refit.ts)
      const n = res.applied!.ripple?.length ?? 0
      await tell(`✅ Moved ${n} thing${n === 1 ? '' : 's'} in your plan.`, [[{ text: '↩️ Undo', callback_data: `u:${id}` }]])
      await pinned()
      return
    }
    const moved = res.applied!.moved.length
    if (p.yourWeek) {
      const n = p.blocks.filter((b) => b.kind === 'training').length, s2 = p.blocks.length - n
      await tell(`✅ <b>Your week is set</b>: ${n} training session${n === 1 ? '' : 's'} and ${s2} study block${s2 === 1 ? '' : 's'}${p.yourWeek.upperTarget ? ` · upper ${p.yourWeek.upperTarget.count}× this week` : ''}. On Home and your pinned Today; Life OS gets them within 5 minutes.`,
        [[{ text: '↩️ Undo', callback_data: `u:${id}` }]], p.blocks.filter((b) => b.ref).map((b) => ({ kind: b.ref!.kind, id: b.ref!.id, title: b.title })))
      await pinned()
      return
    }
    if (p.training) {
      await tell(`✅ <b>Training plan saved</b>: ${p.blocks.length} session${p.blocks.length === 1 ? '' : 's'}. On Home and your pinned Today; your Life OS calendar gets ${p.blocks.length === 1 ? 'it' : 'them'} within 5 minutes.`,
        [[{ text: '↩️ Undo', callback_data: `u:${id}` }]], p.blocks.filter((b) => b.ref).map((b) => ({ kind: b.ref!.kind, id: b.ref!.id, title: b.title })))
      await pinned()
      return
    }
    await tell(`✅ <b>Plan saved</b>${moved ? ` · ${moved} task${moved > 1 ? 's' : ''} moved to Today` : ''}. It’s on Home and in your pinned Today.`, [[{ text: '↩️ Undo', callback_data: `u:${id}` }]],
      p.blocks.filter((b) => b.ref).map((b) => ({ kind: b.ref!.kind, id: b.ref!.id, title: b.title })))
    await pinned()
    return
  }

  if (action === 'a' || action === '1' || action === '2') {
    const option = action === 'a' ? null : card.payload.options?.[Number(action) - 1] ?? null
    if (action !== 'a' && !option) { await back(); await tell('⚠️ That option isn’t there any more.'); return }
    const actions = option ? option.actions : card.payload.actions ?? []
    const res = await applyActions(sb, actions)
    if (res.error) {
      await back()
      if (res.notPutBack?.length) {
        await tell(`⚠️ That didn’t fully work (${esc(res.error)}), and I couldn’t put back: <b>${esc(res.notPutBack.join(', '))}</b>. Check ${res.notPutBack.length > 1 ? 'them' : 'it'} on the dashboard.`)
      } else await tell(`⚠️ Nothing changed: ${esc(res.error)}`, actionButtons(id))
      return
    }
    // then what it knocks on in the plan (if that fails, the changes are put back too)
    let rippleApplied: RippleApplied = []
    try { rippleApplied = await applyRipple(sb, option ? option.ripple : card.payload.ripple) } catch (e) {
      await undoActions(sb, res.applied)
      await back()
      await tell(`⚠️ Nothing changed: ${esc(e instanceof Error ? e.message : 'the plan couldn’t be updated')}`, card.payload.options ? undefined : actionButtons(id))
      return
    }
    await sb.from('telegram_pending').update({ payload: { ...card.payload, applied: res.applied, rippleApplied, ...(option ? { chosen: Number(action) - 1 } : {}) } }).eq('id', id)
    const refs: Ref[] = res.applied.map((a) => ({ kind: a.table === 'tasks' ? 'task' : a.table, id: a.id, title: a.title }))
    const moved = rippleApplied.length ? `\n<i>…and ${rippleApplied.length} thing${rippleApplied.length > 1 ? 's' : ''} moved in your plan.</i>` : ''
    const unanswered = (card.payload.asks ?? []).map((q) => q.question)
    const notDone = unanswered.length ? `\n<i>Not saved (no answer): ${esc(unanswered.join('; '))}. Tell me when you know.</i>` : ''
    const next = await pluginAfterApply(sb, res.applied, todayISO()).catch(() => [] as string[])
    await tell(`✅ <b>Done</b>\n${actions.map((a) => `• ${a.line}`).join('\n')}${moved}${notDone}${next.length ? `\n${next.join('\n')}` : ''}`, [[{ text: '↩️ Undo', callback_data: `u:${id}` }]], refs)
    await pinned()
    const roi = (card.payload as { roi?: { key: string; title: string; savesMin: number; weekStart: string } }).roi
    if (roi) await recordSuggestion(sb, roi, roi.weekStart, 'applied')
    // his set-up or calendar changed (clean-up, Owen's days, a gap-like change): the week re-fits (lib/telegram/refit.ts)
    if (card.payload.cleanup || actions.some((a) => ['owen_days', 'game_week', 'setup_set', 'session_ignore', 'school_day', 'upper_week', 'block_skip'].includes(a.op))) {
      const { refitAfterChange } = await import('./refit')
      await refitAfterChange(sb, chatId, card.payload.cleanup ? 'after the clean-up' : 'with that change').catch(() => null)
      if (card.payload.cleanup) { const { refreshOwenCard } = await import('./owen'); await refreshOwenCard(sb, chatId, 'after the clean-up').catch(() => null) }
    }
    // a session it added: what type of training is it? (asked once; lib/telegram/asktype.ts)
    const added = res.applied.filter((a) => a.op === 'event_new' || a.op === 'event_weekly').map((a) => a.id)
    if (added.length) await askNextType(sb, chatId, added).catch(() => false)
    return
  }

  if (action === 'u' && card.kind === 'idea') {
    const err = await dropIdea(sb, String(card.payload.idea_id))
    if (err) { await back('saved'); await tell(`⚠️ Couldn’t undo: ${esc(err)}`); return }
    await tell('↩️ Taken off your App ideas (kept as dropped, not deleted).')
    return
  }

  if (action === 'u' && card.kind === 'plan') {
    const p = card.payload as unknown as PlanPayload
    const res = await undoPlan(sb, p.date, card.payload.applied as PlanApplied)
    const lines = ['↩️ <b>Plan undone</b>: the old one (if any) is back.']
    if (res.skipped.length) lines.push(`<i>Left as it is (moved since): ${esc(res.skipped.join(', '))}</i>`)
    if (res.failed.length) { lines.push(`⚠️ Couldn’t undo: ${esc(res.failed.join(', '))}`); await back('saved') }
    await tell(lines.join('\n'))
    await pinned()
    return
  }

  if (action === 'u') {
    if (card.kind === 'capture') {
      // What can be undone here: a "did football" log (that one row goes, like the Log button's Undo), a study stage
      // marked done (marked undone), a logged mistake (archived)
      const ref = card.payload.undo_ref ?? (card.payload.log_id ? { table: 'target_logs' as const, id: card.payload.log_id } : null)
      if (!ref) { await back('saved'); await tell('That one can’t be undone from here: change it on the dashboard.'); return }
      const { error } = ref.table === 'target_logs'
        ? await sb.from('target_logs').delete().eq('id', ref.id).select('id').single()
        : ref.table === 'topic_progress'
          ? await sb.from('topic_progress').update({ undone_at: new Date().toISOString() }).eq('id', ref.id).select('id').single()
          : await sb.from('mistakes').update({ archived_at: new Date().toISOString() }).eq('id', ref.id).select('id').single()
      if (error) { await back('saved'); await tell(`⚠️ Couldn’t undo: ${esc(error.message)}`); return }
      await tell(ref.table === 'target_logs' ? '↩️ Undone: that log is gone.' : ref.table === 'topic_progress' ? '↩️ Undone: that stage isn’t done any more.' : '↩️ Undone: that mistake is off the list.')
      await pinned()
      return
    }
    const skippedPlan = await undoRipple(sb, card.payload.rippleApplied)
    const res = await undoActions(sb, (card.payload.applied ?? []) as Applied[])
    if (skippedPlan.length) res.skipped.push(`${skippedPlan.length} plan block${skippedPlan.length > 1 ? 's' : ''}`)
    const lines = [res.undone.length ? `↩️ <b>Undone</b>: ${esc([...new Set(res.undone)].join(', '))}` : '↩️ Nothing to undo.']
    if (res.skipped.length) lines.push(`<i>Left as it is (changed since): ${esc(res.skipped.join(', '))}</i>`)
    if (res.failed.length) lines.push(`⚠️ Couldn’t undo: ${esc(res.failed.join(', '))}`)
    if (!res.undone.length && res.failed.length) await back('saved')
    await tell(lines.join('\n'))
    await pinned()
    return
  }

  if (action === 'f') {
    const fact = String(card.payload?.fact ?? '').trim()
    const { data, error } = await sb.from('context_facts').insert({ fact, source_text: card.text }).select('id').single()
    if (error || !data) { await back(); await tell(`⚠️ Fact not saved: ${esc(error?.message ?? 'unknown error')}`); return }
    await tell('💾 Fact saved. The AI will use it from now on.', undefined, [{ kind: 'fact', id: data.id, title: fact }])
    return
  }

  if (action === 'i') {
    const res = await captureToInbox(sb, card.text)
    if (res.error || !res.task) { await back(); await tell(`⚠️ ${esc(res.error ?? 'Not saved.')}`); return }
    await tell('📥 Saved to Inbox.', undefined, [{ kind: 'task', id: res.task.id, title: res.task.title }])
    await pinned()
    return
  }

  // s: save the proposal exactly as the dashboard's Confirm does
  const p = card.payload.proposal as Proposal
  const res = await saveProposal(sb, p, card.text, [])
    .catch((e) => ({ error: e instanceof Error ? e.message : 'Not saved.', message: undefined, task: undefined, logId: undefined }))
  if (res.error || !res.message) {
    await back()
    const again: Button[][] = [[{ text: '📥 Inbox instead', callback_data: `i:${id}` }, { text: '✏️ Edit', callback_data: `e:${id}` }]]
    await tell(`⚠️ ${esc((res.error ?? 'Not saved.').replace(' Your text is still in the box.', ''))}`, again)
    return
  }
  const refs: Ref[] = res.task ? [{ kind: 'task', id: res.task.id, title: res.task.title }] : []
  const undoRef = 'undoRef' in res ? res.undoRef : undefined
  if (undoRef) await sb.from('telegram_pending').update({ payload: { ...card.payload, undo_ref: undoRef, ...(res.logId ? { log_id: res.logId } : {}) } }).eq('id', id)
  await tell(`✅ ${esc(res.message)} (“${esc(p.title)}”)`, undoRef ? [[{ text: '↩️ Undo', callback_data: `u:${id}` }]] : undefined, refs)
  await pinned()
  // new homework due this week, and there's a week plan: offer a slot for it before the deadline (D2 knock-on)
  if (res.task && (res.task.due_at || res.task.window_end)) await offerSlot(sb, chatId, res.task, await loadViewData(sb, todayISO())).catch(() => false)
}
