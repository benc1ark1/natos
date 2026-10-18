// Server-only: "has this already been handled/sent?" keys in telegram_sent (as Nat, under row level security).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Record that something was handled/sent; false if it already was. */
export async function claim(sb: SupabaseClient, key: string): Promise<boolean> {
  const { error } = await sb.from('telegram_sent').insert({ key })
  if (!error) return true
  if (error.code === '23505') return false   // already there
  throw new Error(`Couldn’t record that: ${error.message}`)
}

/** Undo a claim when nothing actually went out, so a later try can send it. */
export const release = (sb: SupabaseClient, key: string) => sb.from('telegram_sent').delete().eq('key', key)
