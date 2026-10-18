// Saving his settings (profiles.planning), as him under row level security. Used by the Settings page; the bot
// saves through its ✅ cards (lib/telegram/actions-c2.ts). One key at a time, so two changes never undo each other.
import type { SupabaseClient } from '@supabase/supabase-js'

/** Set one key (undefined = back to the default). Returns the new settings, or an error. */
export async function savePlanningKey(sb: SupabaseClient, key: string, value: unknown): Promise<{ planning?: Record<string, unknown>; error?: string }> {
  const { data: prof, error: e1 } = await sb.from('profiles').select('user_id,planning').maybeSingle()
  if (e1) return { error: `Couldn’t read your settings: ${e1.message}` }
  const planning = { ...((prof?.planning ?? {}) as Record<string, unknown>) }
  if (value === undefined) delete planning[key]
  else planning[key] = value
  const { error } = prof
    ? await sb.from('profiles').update({ planning }).eq('user_id', prof.user_id).select('user_id').single()
    : await sb.from('profiles').insert({ planning }).select('user_id').single()
  return error ? { error: `Not saved: ${error.message}` } : { planning }
}
