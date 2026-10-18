// Server-only: connecting Google. The browser goes to Google's consent page with a one-time random "state" and a
// PKCE secret kept in an httpOnly cookie (never readable by page scripts); Google sends him back with a code, which
// only works with that cookie. The tokens are encrypted before they're saved (lib/integrations/crypto.ts).
import 'server-only'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadConnection, saveConnection, updateConnection } from '../integrations/store'
import { authUrl, exchangeCode, missingScopes, revoke } from './api'
import { tokensOf } from '../integrations/store'

export const COOKIE = 'g_oauth'
export const callbackUrl = (origin: string) => `${origin}/api/google/callback`

/** Where to send him, and the cookie that must come back with Google's answer. */
export function startConnect(origin: string): { url: string; cookie: string } {
  const state = randomBytes(24).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { url: authUrl(callbackUrl(origin), state, challenge), cookie: `${state}.${verifier}` }
}

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Google's answer: check it's the one we asked for, swap the code for tokens, save them. Returns a code from
 *  lib/google/messages.ts on failure (the page shows the words; the address never carries text). */
export async function finishConnect(sb: SupabaseClient, q: { code: string | null; state: string | null; error: string | null; cookie: string | null; origin: string }): Promise<string | null> {
  if (q.error) return q.error === 'access_denied' ? 'cancelled' : 'failed'
  const [state, verifier] = (q.cookie ?? '').split('.')
  if (!q.code || !q.state || !state || !verifier || !sameText(q.state, state)) return 'expired'
  let t: Awaited<ReturnType<typeof exchangeCode>>
  try { t = await exchangeCode(q.code, verifier, callbackUrl(q.origin)) } catch { return 'rejected' }
  const missing = missingScopes(t.scope)
  if (missing.length) {
    await revoke(t.refresh_token ?? t.access_token)
    return 'scopes'
  }
  if (!t.refresh_token) return 'no-refresh'
  // a different Google account than before: start its settings afresh (its own Life OS calendar)
  const old = await loadConnection(sb, 'google')
  const fresh = !old || (old.account && t.email && old.account !== t.email)
  if (old && fresh) await updateConnection(sb, old, { settings: {} })
  const err = await saveConnection(sb, 'google', { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }, { account: t.email, scopes: t.scope, settings: fresh ? {} : undefined })
  return err ? 'save' : null
}

/** Disconnect: Google forgets the sign-in, the app forgets the tokens, and the copies of his Google events are
 *  archived (never deleted). The Life OS calendar stays in his Google account; he can delete it there if he wants. */
export async function disconnectGoogle(sb: SupabaseClient): Promise<string | null> {
  const c = await loadConnection(sb, 'google')
  if (!c) return null
  try { const t = tokensOf(c); if (t) await revoke(t.refresh_token) } catch {}
  await updateConnection(sb, c, { status: 'disconnected', token_enc: null, last_error: null })
  const { error } = await sb.from('events').update({ archived_at: new Date().toISOString() }).eq('external_source', 'google').is('archived_at', null)
  return error ? `Disconnected, but the copied events weren’t archived: ${error.message}` : null
}
