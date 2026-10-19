// Server-only: the "App ideas" inbox (plans/ideas-inbox.md). When Nat asks the bot for something it can't do yet, it
// says so in one line and keeps the request here: his exact words, a short title and what's needed to build it. /ideas
// sends every open one as ONE block to paste into Claude Code; "/ideas done 2" marks one built, "/ideas drop 2" drops it.
// Never deleted: ↩️ Undo (or /ideas drop) marks an idea dropped.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dateISOOf, dowShort, shortDate, todayISO } from '../time'
import { esc } from './api'
import { say } from './turns'

export const CANT = 'I can’t do that yet — it needs adding in Claude Code.'

// Before supabase/speed.sql runs, app_ideas has no "needs" column: the idea is saved without it.
const missingColumn = (e: { code?: string; message: string }) =>
  e.code === 'PGRST204' || e.code === '42703' || /could not find the .* column|column .* does not exist/i.test(e.message)

/**
 * Say "I can't do that yet" (one line), keep the request in App ideas, and offer ↩️ Undo.
 * request: a short title ("Rename a calendar event from Telegram"); words: his exact message; needs: what Claude Code
 * would have to add for it, in one sentence (from the brain; '' if nobody knows yet).
 */
export async function saveIdea(sb: SupabaseClient, chatId: number, request: string, words: string, needs = ''): Promise<void> {
  const req = request.trim().replace(/\s+/g, ' ').slice(0, 500) || words.trim().slice(0, 500)
  const need = needs.trim().replace(/\s+/g, ' ').slice(0, 500)
  const row: { request: string; source_text: string; needs?: string } = { request: req, source_text: words.slice(0, 2000) }
  let { data, error } = await sb.from('app_ideas').insert(need ? { ...row, needs: need } : row).select('id').single()
  if (error && need && missingColumn(error)) ({ data, error } = await sb.from('app_ideas').insert(row).select('id').single())
  if (error || !data) {
    await say(sb, chatId, `${CANT}\n⚠️ Couldn’t save it to your App ideas: ${esc(error?.message ?? 'not saved')}`, undefined, { intent: 'app_idea' })
    return
  }
  const card = await sb.from('telegram_pending').insert({ kind: 'idea', text: words.slice(0, 2000), status: 'saved', payload: { idea_id: data.id } }).select('id').single()
  await say(sb, chatId, `${CANT} 💡 Saved to your App ideas (/ideas).`,
    card.data ? [[{ text: '↩️ Undo', callback_data: `u:${card.data.id}` }]] : undefined,
    { intent: 'app_idea', pending_id: card.data?.id ?? null, refs: [{ kind: 'app_idea', id: data.id, title: req }] })
}

/** ↩️ Undo: the idea is marked dropped (kept, never deleted). */
export async function dropIdea(sb: SupabaseClient, ideaId: string): Promise<string | null> {
  const { error } = await sb.from('app_ideas').update({ status: 'dropped' }).eq('id', ideaId).eq('status', 'open').select('id').single()
  return error ? error.message : null
}

export type Idea = { id: string; request: string; source_text: string | null; needs?: string | null; created_at: string }

/** The open ideas, oldest first (the numbers /ideas shows). Works before speed.sql (no "needs" yet). */
async function openIdeas(sb: SupabaseClient): Promise<{ ideas: Idea[]; error: string | null }> {
  const first = await sb.from('app_ideas').select('id,request,source_text,needs,created_at').eq('status', 'open').order('created_at')
  const res = first.error && missingColumn(first.error)
    ? await sb.from('app_ideas').select('id,request,source_text,created_at').eq('status', 'open').order('created_at')
    : first
  return { ideas: (res.data ?? []) as Idea[], error: res.error?.message ?? null }
}

const MAX_BLOCK = 3500   // Telegram allows 4096 characters; leaves room for the lines around the block (and escaping)
const one = (s: string) => s.replace(/\s+/g, ' ').trim()

/** The block for Claude Code: a header, each open idea numbered (his words, what's needed, the date), how to build them. */
export function ideasBlock(ideas: Idea[], today: string): { text: string; shown: number } {
  const head = `Nat OS: App ideas from my Telegram bot (${ideas.length} open, ${dowShort(today)} ${shortDate(today)})`
  const tail = 'Build these one at a time, in this order: propose a plan for the first one and wait for my "go". When it is built and tested, tell me to send "/ideas done <number>".'
  const parts: string[] = []
  // measured as sent (escaped): an idea full of & < > grows 4–5× and must not push the footer off the message
  let used = esc(head).length + esc(tail).length + 4
  for (const [i, x] of ideas.entries()) {
    const words = one(x.source_text || x.request)
    const needs = one(x.needs || (x.source_text && one(x.source_text) !== one(x.request) ? x.request : '') || 'not worked out yet: ask me what I meant')
    const part = `${i + 1}. "${words.slice(0, 400)}" (${shortDate(dateISOOf(x.created_at))})\n   Needs: ${needs.slice(0, 400)}`
    const size = esc(part).length + 2
    if (used + size > MAX_BLOCK) break
    parts.push(part)
    used += size
  }
  return { text: [head, '', parts.join('\n\n'), '', tail].join('\n'), shown: parts.length }
}

/** /ideas: every open idea as one ready-to-paste block for Claude Code (tap it in Telegram to copy it). */
export async function ideasText(sb: SupabaseClient): Promise<string> {
  const { ideas, error } = await openIdeas(sb)
  if (error) return `⚠️ Couldn’t read your App ideas: ${esc(error)}`
  if (!ideas.length) return '💡 No App ideas yet. When I can’t do something you ask, I’ll keep it here for Claude Code.'
  const { text, shown } = ideasBlock(ideas, todayISO())
  return [
    `💡 <b>App ideas</b> (${ideas.length}): tap the block to copy it, then paste it into Claude Code.`,
    `<pre>${esc(text)}</pre>`,
    shown < ideas.length ? `<i>${ideas.length - shown} more didn’t fit: they’ll show once these are built.</i>` : '',
    '<i>Built one? “/ideas done 1”. Not wanted? “/ideas drop 1”.</i>',
  ].filter(Boolean).join('\n')
}

/** "/ideas", "/ideas done 2", "/ideas drop 2" (his own command, so no card: it only marks the idea, never deletes it). */
export async function ideasCommand(sb: SupabaseClient, args: string): Promise<string> {
  const a = args.trim().toLowerCase()
  if (!a) return ideasText(sb)
  if (/^(undo|reopen|back)$/.test(a)) return reopenLast(sb)
  const m = a.match(/^(done|built|finished|drop|dropped|remove)\s*#?(\d{1,3})$/)
  if (!m) return 'Send /ideas for the list, “/ideas done 2” when number 2 is built, “/ideas drop 2” to drop it, or “/ideas undo” to reopen the last one.'
  const { ideas, error } = await openIdeas(sb)
  if (error) return `⚠️ Couldn’t read your App ideas: ${esc(error)}`
  const idea = ideas[Number(m[2]) - 1]
  if (!idea) return ideas.length ? `There’s no idea ${m[2]}: you have ${ideas.length} open (/ideas lists them).` : 'You have no open App ideas.'
  const status = /^(done|built|finished)$/.test(m[1]) ? 'done' : 'dropped'
  const { error: e2 } = await sb.from('app_ideas').update({ status }).eq('id', idea.id).eq('status', 'open').select('id').single()
  if (e2) return `⚠️ Not changed: ${esc(e2.message)}`
  // the numbers move up once one is closed: show the new ones, so "/ideas done 2" from the old list can't close the wrong one
  const left = ideas.filter((x) => x.id !== idea.id)
  return [
    status === 'done' ? `✅ Marked built: “${esc(idea.request)}”.` : `Dropped: “${esc(idea.request)}” (kept, not deleted).`,
    left.length ? `<b>Still open</b> (new numbers):\n${left.slice(0, 10).map((x, i) => `${i + 1}. ${esc(one(x.request).slice(0, 80))}`).join('\n')}${left.length > 10 ? `\n<i>+${left.length - 10} more · /ideas</i>` : ''}` : '<i>No open App ideas left.</i>',
    '<i>Wrong one? “/ideas undo” reopens it.</i>',
  ].join('\n')
}

/** "/ideas undo": reopens the idea he marked built or dropped most recently (within a day). */
async function reopenLast(sb: SupabaseClient): Promise<string> {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { data, error } = await sb.from('app_ideas').select('id,request').in('status', ['done', 'dropped'])
    .gte('updated_at', since).order('updated_at', { ascending: false }).limit(1)
  if (error) return `⚠️ Couldn’t read your App ideas: ${esc(error.message)}`
  const idea = data?.[0]
  if (!idea) return 'Nothing to reopen: no idea was marked built or dropped in the last day.'
  const { error: e2 } = await sb.from('app_ideas').update({ status: 'open' }).eq('id', idea.id).in('status', ['done', 'dropped']).select('id').single()
  if (e2) return `⚠️ Not changed: ${esc(e2.message)}`
  return `↩️ Reopened: “${esc(idea.request)}” (/ideas lists it again).`
}
