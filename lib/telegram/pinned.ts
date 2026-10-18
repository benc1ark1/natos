// Server-only: the pinned "Today" message that the bot keeps up to date (my-spec 44, plans/jarvis.md B2).
// One message per day, pinned quietly; edited in place (no buzz) only when its text actually changes:
// right after a ✅ in the bot, on /pin, and on the 5-minute tick (dashboard changes, events passing).
// It only shows fixed times ("leave by 17:35"), never countdowns, so it isn't edited every few minutes.
// A new day's message is pinned from 07:00 (or as soon as Nat does something); yesterday's is unpinned, never deleted.
import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEvents, isSchool, timeRange } from '../events'
import { blockLeave, dayItems, dayLevel, itemLine, overload } from '../day'
import { DOT } from '../mental'
import { parseSessionTitle } from '../setup'
import { tickButtons } from './brief'
import { pickToday, deadlineLabel, deadlineOf } from '../tasks'
import { moreSettings } from '../settings'
import { dateISOOf, longDate, minutesOf, timeOf } from '../time'
import { leaveBy, withTravel } from '../travel'
import { editCard, esc, pin, send, unpin, type Button } from './api'
import { claim, release } from './sent'
import { loadViewData, type ViewData } from './views'

const PDOT = { rest: '⚪', low: '🟢', med: '🟡', high: '🔴' } as const
/** When he's free after school today (the school block's end + the buffer), if it's a school day. */
const schoolEndOf = (d: ViewData) => {
  const ends = expandEvents(d.events, d.today, d.today, d.changes).filter((o) => o.date === d.today && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.end).map((o) => o.end!).sort()
  return ends.length ? minutesOf(ends.at(-1)!) + d.settings.bufferMin : null
}

/** The message text (without the "updated" stamp, which isn't part of what counts as a change). */
export function buildPinned(d: ViewData): string {
  const now = timeOf(d.now)
  const occ = withTravel(expandEvents(d.events, d.today, d.today, d.changes), d.travel ?? null)
    .filter((o) => o.date === d.today && !o.cancelled && o.start)
  const current = occ.find((o) => o.start! <= now && (o.end ? o.end > now : false))
  const upcoming = occ.filter((o) => o.start! > now)
  const lines = [`📌 <b>Today · ${esc(longDate(d.today))}</b>`]

  if (current) lines.push(`▶️ <b>Now</b>: ${esc(current.event.title)} (until ${current.end})`)
  const next = upcoming[0]
  const todo = pickToday(d.tasks.filter((t) => t.status !== 'completed' && !t.archived_at), d.today, moreSettings(d.planning).todayMax)
  // the plan's next block, if it comes before the next event
  const block = (d.plan ?? []).find((b) => b.end_time > now)
  if (block && (!next || block.start_time < next.start!)) lines.push(`⏭ <b>Next</b>: ${esc(block.title)} ${block.start_time}–${block.end_time}`)
  else if (next) lines.push(`⏭ <b>Next</b>: ${esc(next.event.title)} ${esc(timeRange(next))}`)
  else if (todo[0]) lines.push(`⏭ <b>Next</b>: ${esc(todo[0].title)}`)
  else if (!current) lines.push('⏭ Nothing else booked today.')

  // leave-by for the next event with a journey (fixed clock times only), from where he'll be
  const go = upcoming.map((o) => ({ o, l: leaveBy(o) })).find((x) => x.l)
  if (go) {
    lines.push(go.l!.at > now
      ? `🚶 Leave by <b>${go.l!.at}</b> for ${esc(go.o.event.title)} (${go.o.start}; ${esc(go.l!.words)})`
      : `🚶 <b>Leave now</b> for ${esc(go.o.event.title)} (${go.o.start}; ${esc(go.l!.words)})`)
  }

  // a training block next: when to leave for it (its place is in the title; travel from the set-up)
  if (!go && block?.kind === 'training') {
    const l = blockLeave({ start_time: block.start_time, title: block.title }, d.planning, schoolEndOf(d), d.settings.bufferMin)
    if (l) lines.push(l.leave > now ? `🚶 Leave by <b>${l.leave}</b> for ${esc(parseSessionTitle(block.title).name)} (${block.start_time}; ${esc(l.how)})` : `🚶 <b>Leave now</b> for ${esc(parseSessionTitle(block.title).name)} (${block.start_time}; ${esc(l.how)})`)
  }

  // Build O: the whole day in time order, routines included, ticked blocks marked; and how heavy it is
  const blocks = d.blocks ?? []
  if (d.shapes || blocks.length) {
    const items = dayItems({ date: d.today, events: d.events, changes: d.changes, travel: d.travel ?? null, shape: d.shapes?.get(d.today) ?? null, blocks, planning: d.planning, bufferMin: d.settings.bufferMin })
    const level = dayLevel({ date: d.today, planning: d.planning, events: d.events, changes: d.changes, goals: (d.goalsLite ?? []) as never, tasks: d.tasks, blocks, costs: d.costs ?? [] })
    const over = overload(level, blocks, d.tasks, d.planning, d.today)
    lines.push('', `🗓 <b>Your day</b> · 🧠${DOT[level.mental]} 💪${PDOT[level.physical]}${blocks.length ? ' <i>(tap to tick)</i>' : ''}`, ...(over ? [`<i>${esc(over.line)}</i>`] : []), ...items.map((it) => itemLine(it, esc)))
  } else {
    const rest = (d.plan ?? []).filter((b) => b.end_time > now && b !== block)
    if (rest.length) lines.push('', '🗓 <b>Plan</b>', ...rest.slice(0, 6).map((b) => `• ${b.start_time} ${esc(b.title)}`))
  }

  if (todo.length) {
    const musts = [...todo].sort((a, b) => Number(b.importance === 'must') - Number(a.importance === 'must'))
    lines.push('', '✅ <b>To do</b>', ...musts.map((t) => {
      const when = deadlineOf(t) ? deadlineLabel(t, d.today) : ''
      return `• ${t.importance === 'must' ? `<b>${esc(t.title)}</b>` : esc(t.title)}${when ? ` <i>(${esc(when)})</i>` : ''}`
    }))
  } else lines.push('', '✅ Nothing on the to-do list.')
  return lines.join('\n')
}

const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 32)

type State = { today_message_id: number | null; today_date: string | null; today_hash: string | null }

/**
 * Bring the pinned message up to date. `byNat`: Nat just did something, so a new day's message may be
 * started at any hour (the tick waits until 07:00). Never throws: the pin is a nice-to-have.
 */
export async function refreshPinned(sb: SupabaseClient, chatId: number, now = new Date(), opts: { byNat?: boolean; startAfter?: string } = {}): Promise<'sent' | 'edited' | 'same' | 'waiting' | 'failed'> {
  try {
    const today = dateISOOf(now.toISOString())
    const { data: st } = await sb.from('telegram_state').select('today_message_id,today_date,today_hash').maybeSingle()
    if (!st) await sb.from('telegram_state').insert({ busy_until: null })   // first ever (ignore a race: the row is the same)
    const state = (st ?? { today_message_id: null, today_date: null, today_hash: null }) as State
    const d = await loadViewData(sb, today, now)
    const body = buildPinned(d)
    const hash = fingerprint(body)
    const text = `${body}\n<i>updated ${timeOf(now)}</i>`
    const buttons = tickButtons(d.blocks ?? [], d.tasks, d.today)

    if (state.today_date === today && state.today_message_id) {
      if (state.today_hash === hash) return 'same'
      try {
        await editCard(chatId, state.today_message_id, text, buttons)
      } catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (/not modified/i.test(msg)) { await save(sb, { today_hash: hash }); return 'same' }
        if (!/not found|can't be edited|message_id_invalid/i.test(msg)) throw e
        // Nat deleted it: start again with a new one
        return await startNew(sb, chatId, today, text, hash, state.today_message_id, false, buttons)
      }
      await save(sb, { today_hash: hash })
      return 'edited'
    }

    // a new day (or none yet): the tick waits until the morning brief
    if (!opts.byNat && opts.startAfter && timeOf(now) < opts.startAfter) return 'waiting'
    return await startNew(sb, chatId, today, text, hash, state.today_message_id, true, buttons)
  } catch {
    return 'failed'
  }
}

/** Send and pin a new "Today" message in place of `old` (unpinned if `unpinOld`; never deleted). */
async function startNew(sb: SupabaseClient, chatId: number, today: string, text: string, hash: string, old: number | null, unpinOld: boolean, buttons: Button[][] = []): Promise<'sent' | 'same'> {
  // Only one run starts it (the tick and a tap can arrive together).
  const key = `pin:${today}:${old ?? 0}`
  if (!(await claim(sb, key))) return 'same'
  try {
    const sent = (await send(chatId, text, buttons.length ? buttons : undefined)) as { message_id?: number }
    if (typeof sent?.message_id !== 'number') throw new Error('no message id')
    await save(sb, { today_message_id: sent.message_id, today_date: today, today_hash: hash })
    await pin(chatId, sent.message_id).catch(() => null)
    if (old && unpinOld) await unpin(chatId, old)
    return 'sent'
  } catch (e) {
    await release(sb, key)
    throw e
  }
}

async function save(sb: SupabaseClient, values: Partial<State>) {
  const { error } = await sb.from('telegram_state').update(values).not('user_id', 'is', null)
  if (error) throw new Error(error.message)
}
