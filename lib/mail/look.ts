// "Emails worth a look" (fix round 22): emails where Nat is only CC'd, or that are between other people. They never
// become a card or an alert; this list shows them on the Inbox page and in /mail. Read-only, works in the browser and
// on the server (row level security keeps it to his own emails).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account } from './rules'

export type LookEmail = {
  id: string; account: Account; thread_id: string | null; from_name: string | null; from_email: string | null
  subject: string | null; snippet: string | null; received_at: string; look: 'cc' | 'others'
}

export const LOOK_DAYS = 14

/** The last two weeks' emails worth a look, newest first. */
export async function loadWorthALook(sb: SupabaseClient, now = new Date(), limit = 20): Promise<LookEmail[]> {
  const since = new Date(now.getTime() - LOOK_DAYS * 86_400_000).toISOString()
  const { data, error } = await sb.from('emails').select('id,account,thread_id,from_name,from_email,subject,snippet,received_at,details')
    .eq('status', 'sorted').eq('kind', 'ignore').in('details->>look', ['cc', 'others']).gte('received_at', since)
    .order('received_at', { ascending: false }).limit(limit)
  if (error) throw new Error(`Couldn’t load the emails worth a look: ${error.message}`)
  return (data ?? []).map(({ details, ...e }) => ({ ...e, look: (details as { look: 'cc' | 'others' }).look }) as LookEmail)
}

/** "only CC’d" / "between other people". */
export const lookWhy = (look: LookEmail['look']) => (look === 'cc' ? 'only CC’d' : 'between other people')
