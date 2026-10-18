// Server-only: reading and writing his connections (integrations table) as Nat, under row level security.
// Tokens go in and out only through lib/integrations/crypto.ts; nothing here logs or returns a token to a page.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { open, seal } from './crypto'

export type Provider = 'google' | 'whoop'
export type Tokens = { access_token: string; refresh_token: string; expires_at: number }   // expires_at: ms
export type Connection = {
  id: string; provider: Provider; status: 'connected' | 'needs_reconnect' | 'disconnected'
  account: string | null; scopes: string | null; settings: Record<string, unknown>
  last_sync_at: string | null; last_error: string | null
  token_enc: string | null
}

/** The columns a page may see (everything but the encrypted tokens). */
export const PUBLIC_COLS = 'id,provider,status,account,scopes,settings,last_sync_at,last_error,connected_at,updated_at'

export async function loadConnection(sb: SupabaseClient, provider: Provider): Promise<Connection | null> {
  const { data, error } = await sb.from('integrations').select('*').eq('provider', provider).maybeSingle()
  if (error) return null   // before the SQL runs: not connected
  return (data as Connection | null) ?? null
}

export const tokensOf = (c: Connection): Tokens | null => (c.token_enc ? open<Tokens>(c.token_enc, c.provider) : null)

/** Save a new connection (or a fresh sign-in over an old one). */
export async function saveConnection(sb: SupabaseClient, provider: Provider, t: Tokens, extra: { account?: string | null; scopes?: string | null; settings?: Record<string, unknown> }): Promise<string | null> {
  const old = await loadConnection(sb, provider)
  const row = {
    provider, status: 'connected', token_enc: seal(t, provider), account: extra.account ?? null, scopes: extra.scopes ?? null,
    settings: { ...(old?.settings ?? {}), ...(extra.settings ?? {}) }, last_error: null, connected_at: new Date().toISOString(),
  }
  const { error } = old
    ? await sb.from('integrations').update(row).eq('id', old.id).select('id').single()
    : await sb.from('integrations').insert(row).select('id').single()
  return error ? `Not saved: ${error.message}` : null
}

export async function saveTokens(sb: SupabaseClient, c: Connection, t: Tokens) {
  const { error } = await sb.from('integrations').update({ token_enc: seal(t, c.provider) }).eq('id', c.id)
  if (error) throw new Error(`Couldn’t keep the new sign-in: ${error.message}`)
}

export async function updateConnection(sb: SupabaseClient, c: Connection, patch: Partial<Pick<Connection, 'status' | 'settings' | 'last_sync_at' | 'last_error' | 'account'>> & { token_enc?: null }) {
  const { error } = await sb.from('integrations').update(patch).eq('id', c.id)
  if (error) throw new Error(`Couldn’t save the ${c.provider} connection: ${error.message}`)
  Object.assign(c, patch)
}
