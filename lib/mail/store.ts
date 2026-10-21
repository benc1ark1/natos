// Server-only: storing what a Gmail script sent (by the incoming route, or read from the fallback calendar by the
// Google sync). Each email once (account + Gmail's id); the account's "last checked in" time.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserId } from '../data'
import { addressedTo, listOnly, parseFrom, type Account, type Incoming } from './rules'

/** "column … does not exist" (a SQL file not run yet), from Postgres or PostgREST. */
export const missingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(e.message ?? ''))

/** The mark the school script's fallback puts at the start of an event's description: "natos-mail {json}". */
export const MAIL_MARK = 'natos-mail '

/** Every address of his the app knows: both watchers' accounts and the Google account he connected. A failed read
 *  just leaves the script's own address (and aliases). */
export async function myAddresses(sb: SupabaseClient): Promise<string[]> {
  const [accs, google] = await Promise.all([
    sb.from('mail_accounts').select('address').then((r) => r.data ?? [], () => []),
    sb.from('integrations').select('account').eq('provider', 'google').then((r) => r.data ?? [], () => []),
  ])
  return [...accs.map((a) => a.address), ...google.map((g) => g.account)]
    .filter((a): a is string => typeof a === 'string' && /^[^\s@]+@[^\s@]+$/.test(a)).map((a) => a.toLowerCase())
}

/** Store new emails (each once) and note that this account's watcher checked in. Returns how many were new. */
export async function ingest(sb: SupabaseClient, input: { account: Account; address: string | null; via: 'url' | 'calendar'; sent?: string | null; messages: Incoming[]; aliases?: string[] }): Promise<number> {
  const userId = await getUserId(sb)
  // the calendar fallback is read later than the script ran: its own time says when it last checked in
  const at = input.via === 'calendar' && input.sent ? input.sent : new Date().toISOString()
  const seen = { user_id: userId, account: input.account, via: input.via, last_seen_at: at, ...(input.address ? { address: input.address } : {}) }
  const { error: e1 } = await sb.from('mail_accounts').upsert(seen, { onConflict: 'user_id,account' })
  if (e1) throw new Error(`Couldn’t note the check-in: ${e1.message}`)
  if (!input.messages.length) return 0
  // fix round 22: only CC'd, or between other people → noted here, so the sorting files it under "Emails worth a look".
  // Both his accounts count as him (school mail forwarded to his personal Gmail is still To him)
  const mine = [input.address, ...(input.aliases ?? []), ...(await myAddresses(sb))]
  const rows = input.messages.map((m) => {
    const f = parseFrom(m.from)
    const to = addressedTo(m, mine)
    return {
      user_id: userId, account: input.account, message_id: m.id, thread_id: m.thread, from_name: f.name?.slice(0, 200) ?? null, from_email: f.email?.slice(0, 320) ?? null,
      subject: m.subject || null, snippet: m.snippet || null, received_at: m.received, labels: m.labels, automated: m.automated, via: input.via,
      // through a list or Google Group only (year13@…): noted, so the sorting can tell it from a newsletter
      ...(m.body ? { body: m.body } : {}), details: { ...(to === 'cc' || to === 'others' ? { addressed: to } : {}), ...(listOnly(m) ? { list: true } : {}) },
    }
  })
  const save = (list: typeof rows) => sb.from('emails').upsert(list, { onConflict: 'user_id,account,message_id', ignoreDuplicates: true }).select('id')
  let { data, error } = await save(rows)
  // before supabase/mail-homework.sql there's no "body" column: kept without it (the preview line still works)
  if (error && rows.some((r) => 'body' in r) && missingColumn(error)) ({ data, error } = await save(rows.map(({ body: _, ...r }) => r)))
  if (error) throw new Error(`Couldn’t save the emails: ${error.message}`)
  return data?.length ?? 0
}

