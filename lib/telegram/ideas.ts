// Server-only: the "App ideas" list. When Nat asks the bot for something it can't do yet, it says so and keeps the
// request here, so he can bring it to Claude Code later (/ideas lists them). Never deleted: ↩️ Undo marks one dropped.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { esc } from './api'
import { say } from './turns'

export const CANT = 'I can’t do that yet — it needs adding in Claude Code.'

/** Say "I can't do that yet", keep the request in App ideas, and offer ↩️ Undo. */
export async function saveIdea(sb: SupabaseClient, chatId: number, request: string, words: string): Promise<void> {
  const req = request.trim().replace(/\s+/g, ' ').slice(0, 500) || words.trim().slice(0, 500)
  const { data, error } = await sb.from('app_ideas').insert({ request: req, source_text: words.slice(0, 2000) }).select('id').single()
  if (error || !data) {
    await say(sb, chatId, `${CANT}\n⚠️ Couldn’t save it to your App ideas: ${esc(error?.message ?? 'not saved')}`, undefined, { intent: 'app_idea' })
    return
  }
  const card = await sb.from('telegram_pending').insert({ kind: 'idea', text: words.slice(0, 2000), status: 'saved', payload: { idea_id: data.id } }).select('id').single()
  await say(sb, chatId, `${CANT}\n💡 Saved to your App ideas: “${esc(req)}”. /ideas shows the list.`,
    card.data ? [[{ text: '↩️ Undo', callback_data: `u:${card.data.id}` }]] : undefined,
    { intent: 'app_idea', pending_id: card.data?.id ?? null, refs: [{ kind: 'app_idea', id: data.id, title: req }] })
}

/** ↩️ Undo: the idea is marked dropped (kept, never deleted). */
export async function dropIdea(sb: SupabaseClient, ideaId: string): Promise<string | null> {
  const { error } = await sb.from('app_ideas').update({ status: 'dropped' }).eq('id', ideaId).eq('status', 'open').select('id').single()
  return error ? error.message : null
}

/** /ideas: the open ones, oldest first. */
export async function ideasText(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.from('app_ideas').select('request,created_at').eq('status', 'open').order('created_at')
  if (error) return `⚠️ Couldn’t read your App ideas: ${esc(error.message)}`
  if (!data?.length) return '💡 No App ideas yet. When I can’t do something you ask, I’ll keep it here for Claude Code.'
  return [`💡 <b>App ideas</b> (${data.length}): things I can’t do yet. Bring them to Claude Code.`, ...data.map((r, i) => `${i + 1}. ${esc(r.request)}`)].join('\n')
}
