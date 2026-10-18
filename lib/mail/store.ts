// Server-only: storing what a Gmail script sent (by the incoming route, or read from the fallback calendar by the
// Google sync). Each email once (account + Gmail's id); the account's "last checked in" time.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserId } from '../data'
import { parseFrom, type Account, type Incoming } from './rules'

/** The mark the school script's fallback puts at the start of an event's description: "natos-mail {json}". */
export const MAIL_MARK = 'natos-mail '

/** Store new emails (each once) and note that this account's watcher checked in. Returns how many were new. */
export async function ingest(sb: SupabaseClient, input: { account: Account; address: string | null; via: 'url' | 'calendar'; sent?: string | null; messages: Incoming[] }): Promise<number> {
  const userId = await getUserId(sb)
  // the calendar fallback is read later than the script ran: its own time says when it last checked in
  const at = input.via === 'calendar' && input.sent ? input.sent : new Date().toISOString()
  const seen = { user_id: userId, account: input.account, via: input.via, last_seen_at: at, ...(input.address ? { address: input.address } : {}) }
  const { error: e1 } = await sb.from('mail_accounts').upsert(seen, { onConflict: 'user_id,account' })
  if (e1) throw new Error(`Couldn’t note the check-in: ${e1.message}`)
  if (!input.messages.length) return 0
  const rows = input.messages.map((m) => {
    const f = parseFrom(m.from)
    return {
      user_id: userId, account: input.account, message_id: m.id, thread_id: m.thread, from_name: f.name?.slice(0, 200) ?? null, from_email: f.email?.slice(0, 320) ?? null,
      subject: m.subject || null, snippet: m.snippet || null, received_at: m.received, labels: m.labels, automated: m.automated, via: input.via,
    }
  })
  const { data, error } = await sb.from('emails').upsert(rows, { onConflict: 'user_id,account,message_id', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`Couldn’t save the emails: ${error.message}`)
  return data?.length ?? 0
}

