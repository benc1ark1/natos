// Server-only: tap-to-tick on the brief and the pinned Today (Build O part 10). A plan block toggles planned ↔ done
// (a training block that counts toward a weekly target logs it too, once); a must-do task is completed (archived,
// never deleted) or put back. The tapped message's buttons are redrawn and the pinned Today updates.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { completeTask, undoComplete } from '../data'
import { parseSessionTitle } from '../setup'
import { todayISO } from '../time'
import type { Task } from '../types'
import { answerTap, tg } from './api'
import { loadDay, tickButtons } from './brief'
import { refreshPinned } from './pinned'
import { remember } from './turns'

/** Training that counts toward a weekly target: logged once per block (and taken off again if unticked).
 *  (Item 5: also used by a tap on Today, lib/today/done.ts.) */
export async function logTrainingTick(sb: SupabaseClient, b: { id: string; kind: string; target_id: string | null; on_date: string }, done: boolean) {
  if (b.kind !== 'training' || !b.target_id) return
  if (done) await sb.from('target_logs').insert({ target_id: b.target_id, done_on: b.on_date, amount: 1, source: 'task', external_id: `block:${b.id}` }).then(() => null, () => null)
  else await sb.from('target_logs').delete().eq('source', 'task').eq('external_id', `block:${b.id}`)
}

/** A block ticked (or unticked). */
export async function tickBlock(sb: SupabaseClient, chatId: number, tapId: string, blockId: string, messageId?: number) {
  const { data: b } = await sb.from('plan_blocks').select('id,title,kind,status,target_id,on_date').eq('id', blockId).maybeSingle()
  if (!b || !['planned', 'done'].includes(b.status)) { await answerTap(tapId, 'That isn’t in your plan any more.'); return }
  const done = b.status === 'planned'
  const { error } = await sb.from('plan_blocks').update({ status: done ? 'done' : 'planned' }).eq('id', b.id).eq('status', b.status)
  if (error) { await answerTap(tapId, 'Couldn’t save that.'); return }
  await logTrainingTick(sb, b, done)
  const name = parseSessionTitle(b.title).name
  await answerTap(tapId, done ? `✅ ${name}` : `↩️ ${name}: not done`)
  await remember(sb, 'nat', `(ticked ${name}${done ? '' : ' off again'})`, { intent: 'tap' })
  await redraw(sb, chatId, messageId)
}

/** A must-do ticked from the brief: completed (archived), or put back. */
export async function tickTask(sb: SupabaseClient, chatId: number, tapId: string, taskId: string, messageId?: number) {
  const { data: t } = await sb.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (!t) { await answerTap(tapId, 'That task isn’t there any more.'); return }
  const task = t as Task
  const done = task.status !== 'completed'
  const err = done ? (await completeTask(sb, task)).error : await undoComplete(sb, task)
  if (err) { await answerTap(tapId, 'Couldn’t save that.'); return }
  await answerTap(tapId, done ? `✅ ${task.title}` : `↩️ ${task.title}: back on your list`)
  await remember(sb, 'nat', `(ticked ${task.title}${done ? '' : ' off again'})`, { intent: 'tap', refs: [{ kind: 'task', id: task.id, title: task.title }] })
  await redraw(sb, chatId, messageId)
}

/** The tapped message's buttons as they are now, and the pinned Today. */
async function redraw(sb: SupabaseClient, chatId: number, messageId?: number) {
  const pinned = await refreshPinned(sb, chatId, new Date(), { byNat: true })
  const { data: st } = await sb.from('telegram_state').select('today_message_id').maybeSingle()
  if (messageId && messageId !== st?.today_message_id) {
    const d = await loadDay(sb, todayISO())
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: tickButtons(d.blocks, d.tasks, d.today) } }).catch(() => null)
  }
  return pinned
}
