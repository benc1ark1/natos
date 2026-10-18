// Server-only: the bot's memory and its queue, both in telegram_turns (as Nat, under row level security).
// - Memory: the last ~10 messages from the past 30 minutes, so "it" and "make it Thursday" make sense.
// - Queue: each of Nat's messages is queued first and handled one at a time, in the order he sent them,
//   so a quick follow-up ("actually Thursday") always sees the card the first message made.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { timeOf } from '../time'
import { send, type Button } from './api'

export const MEMORY_TURNS = 10
export const MEMORY_MINUTES = 30
const LOCK_SECONDS = 150          // a crashed run frees the queue after this (renewed after each message)
const STALE_WORKING_MS = 5 * 60_000

export type Ref = { kind: string; id: string; title: string }
export type TurnRow = {
  id: number; role: 'nat' | 'bot'; text: string; tg_message_id: number | null; status: 'queued' | 'working' | 'done'
  intent: string | null; pending_id: string | null; refs: Ref[]; created_at: string
}
const COLS = 'id,role,text,tg_message_id,status,intent,pending_id,refs,created_at'

const fail = (what: string, e: { message: string }) => { throw new Error(`Couldn’t ${what}: ${e.message}`) }

/** Queue one of Nat's messages. null = Telegram sent this exact message before (already handled or queued). */
export async function enqueue(sb: SupabaseClient, text: string, tgMessageId: number | null): Promise<number | null> {
  const { data, error } = await sb.from('telegram_turns')
    .insert({ role: 'nat', text: text.slice(0, 4000), tg_message_id: tgMessageId, status: 'queued' }).select('id').single()
  if (error?.code === '23505') return null
  if (error || !data) fail('queue your message', error ?? { message: 'not saved' })
  return data!.id as number
}

/** Record something that isn't a typed message (a button tap) or a reply, straight into the memory. */
export async function remember(sb: SupabaseClient, role: 'nat' | 'bot', text: string,
  extra: { intent?: string; pending_id?: string | null; refs?: Ref[]; tg_message_id?: number | null } = {}) {
  const { error } = await sb.from('telegram_turns').insert({ role, text: text.slice(0, 4000), status: 'done', refs: [], ...extra })
  // Memory is a help, not a must: a reply that went out is never turned into an error by this.
  return !error
}

/** Telegram's HTML -> plain words, for the memory. */
export const plain = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim()

/** Send a reply and remember it. Returns Telegram's message number (to remove a card's buttons later). */
export async function say(sb: SupabaseClient, chatId: number, html: string, buttons?: Button[][],
  extra: { intent?: string; pending_id?: string | null; refs?: Ref[] } = {}): Promise<number | null> {
  const sent = await send(chatId, html, buttons) as { message_id?: number } | null
  const id = typeof sent?.message_id === 'number' ? sent.message_id : null
  await remember(sb, 'bot', plain(html), { ...extra, tg_message_id: id })
  return id
}

/** The conversation before turn `beforeId`: at most 10 turns, none older than 30 minutes, oldest first. */
export async function recentTurns(sb: SupabaseClient, beforeId: number): Promise<TurnRow[]> {
  const since = new Date(Date.now() - MEMORY_MINUTES * 60_000).toISOString()
  const { data, error } = await sb.from('telegram_turns').select(COLS)
    .lt('id', beforeId).eq('status', 'done').gte('created_at', since).order('id', { ascending: false }).limit(MEMORY_TURNS)
  if (error) fail('read the conversation', error)
  return ((data ?? []) as TurnRow[]).reverse()
}

/** The memory as the AI reads it. */
export function transcript(turns: TurnRow[]): string {
  return turns.map((t) => {
    const who = t.role === 'nat' ? 'Nat' : 'You'
    const text = t.text.length > 700 ? `${t.text.slice(0, 700)}…` : t.text
    return `[${timeOf(t.created_at)}] ${who}: ${text.replace(/\n+/g, ' / ')}`
  }).join('\n')
}

// ---------------------------------------------------------------------------
// One at a time: a small lock (telegram_state.busy_until) and the queue
// ---------------------------------------------------------------------------

export async function takeLock(sb: SupabaseClient): Promise<boolean> {
  const now = new Date()
  const until = new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString()
  const grab = () => sb.from('telegram_state').update({ busy_until: until })
    .or(`busy_until.is.null,busy_until.lt."${now.toISOString()}"`).select('user_id')
  let { data, error } = await grab()
  if (error) fail('check the queue', error)
  if (data?.length) return true
  // The very first message ever: make the row (if it isn't there yet), then try again.
  const { count } = await sb.from('telegram_state').select('user_id', { count: 'exact', head: true })
  if (count === 0) {
    const ins = await sb.from('telegram_state').insert({ busy_until: null })
    if (ins.error && ins.error.code !== '23505') fail('set up the queue', ins.error)
    ;({ data, error } = await grab())
    if (error) fail('check the queue', error)
    return !!data?.length
  }
  return false
}

export async function extendLock(sb: SupabaseClient) {
  await sb.from('telegram_state').update({ busy_until: new Date(Date.now() + LOCK_SECONDS * 1000).toISOString() }).not('user_id', 'is', null)
}

export async function releaseLock(sb: SupabaseClient) {
  await sb.from('telegram_state').update({ busy_until: null }).not('user_id', 'is', null)
}

/** The oldest message still waiting. A run that died mid-message (over 5 minutes) is closed first. */
export async function nextQueued(sb: SupabaseClient): Promise<{ next: TurnRow | null; lost: TurnRow[] }> {
  const { data, error } = await sb.from('telegram_turns').select(COLS)
    .eq('role', 'nat').neq('status', 'done').order('tg_message_id', { ascending: true }).order('id', { ascending: true }).limit(20)
  if (error) fail('read the queue', error)
  const rows = (data ?? []) as TurnRow[]
  const lost = rows.filter((r) => r.status === 'working' && Date.now() - Date.parse(r.created_at) > STALE_WORKING_MS)
  for (const r of lost) await setStatus(sb, r.id, 'done', 'failed')
  return { next: rows.find((r) => r.status === 'queued') ?? null, lost }
}

export async function setStatus(sb: SupabaseClient, id: number, status: TurnRow['status'], intent?: string) {
  const { error } = await sb.from('telegram_turns').update({ status, ...(intent ? { intent } : {}) }).eq('id', id)
  if (error) fail('update the queue', error)
}

export async function isDone(sb: SupabaseClient, id: number): Promise<boolean> {
  const { data } = await sb.from('telegram_turns').select('status').eq('id', id).maybeSingle()
  return !data || data.status === 'done'
}
