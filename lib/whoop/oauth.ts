// Server-only: connecting Whoop. Like Google (lib/google/oauth.ts): a one-time random state in an httpOnly cookie
// must come back with Whoop's answer; the tokens are encrypted before they're saved.
import 'server-only'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadConnection, saveConnection, tokensOf, updateConnection } from '../integrations/store'
import { WHOOP_SCOPES, Whoop, exchangeWhoopCode, whoopAuthUrl } from './api'

export const WHOOP_COOKIE = 'w_oauth'
export const whoopCallbackUrl = (origin: string) => `${origin}/api/whoop/callback`

export function startWhoopConnect(origin: string): { url: string; cookie: string } {
  const state = randomBytes(24).toString('base64url')   // Whoop wants at least 8 characters
  return { url: whoopAuthUrl(whoopCallbackUrl(origin), state), cookie: state }
}

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))

/** Whoop's answer: checked, swapped for tokens, saved encrypted. Returns a code from lib/whoop/messages.ts on failure. */
export async function finishWhoopConnect(sb: SupabaseClient, q: { code: string | null; state: string | null; error: string | null; cookie: string | null; origin: string }): Promise<string | null> {
  if (q.error) return q.error === 'access_denied' ? 'cancelled' : 'failed'
  if (!q.code || !q.state || !q.cookie || !sameText(q.state, q.cookie)) return 'expired'
  let t: Awaited<ReturnType<typeof exchangeWhoopCode>>
  try { t = await exchangeWhoopCode(q.code, whoopCallbackUrl(q.origin)) } catch { return 'rejected' }
  const granted = t.scope.split(/\s+/)
  if (t.scope && WHOOP_SCOPES.some((x) => !granted.includes(x))) return 'scopes'
  let account: string | null = null
  try { const p = await new Whoop(t.access_token).profile(); account = p.email ?? p.first_name ?? null } catch {}
  const err = await saveConnection(sb, 'whoop', { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at }, { account, scopes: t.scope, settings: { synced_at: null } })
  return err ? 'save' : null
}

/** Disconnect: Whoop forgets the app, the app forgets the tokens. His Whoop days and workouts stay (history). */
export async function disconnectWhoop(sb: SupabaseClient): Promise<string | null> {
  const c = await loadConnection(sb, 'whoop')
  if (!c) return null
  try { const t = tokensOf(c); if (t) await new Whoop(t.access_token).revoke() } catch {}
  await updateConnection(sb, c, { status: 'disconnected', token_enc: null, last_error: null })
  return null
}
