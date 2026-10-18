// THE ONLY FILE THAT USES THE SUPABASE SERVICE ROLE KEY.
// It does one thing: open a normal signed-in session for Nat (NAT_OS_OWNER_USER_ID), so the
// Telegram bot reads and writes through row level security exactly like the dashboard.
// The admin client never leaves this function. Nothing here logs, and errors never carry
// the key or any upstream message (tests/telegram-guard.test.mjs checks this file is the only user).
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const noStore = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }

let cached: { sb: SupabaseClient; until: number } | null = null

export class OwnerSessionError extends Error {}

/** A Supabase client signed in as Nat (and only Nat). Throws OwnerSessionError with a safe message. */
export async function openOwnerSession(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const ownerId = process.env.NAT_OS_OWNER_USER_ID
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey || !ownerId || !UUID.test(ownerId)) {
    throw new OwnerSessionError('The bot isn’t fully set up yet (server settings missing).')
  }
  // reuse a session while it has more than 2 minutes left (warm instances only)
  if (cached && cached.until > Date.now() + 120_000) return cached.sb

  try {
    const { sb, session } = await freshSession(url, anonKey, serviceKey, ownerId)
    cached = { sb, until: (session.expires_at ?? 0) * 1000 }
    return sb
  } catch {
    cached = null
    throw new OwnerSessionError('Couldn’t open your session. Check the bot’s server settings.')
  }
}

/** A brand-new session for Nat (only his: the id is checked at every step). The admin client stays in here. */
async function freshSession(url: string, anonKey: string, serviceKey: string, ownerId: string) {
  const admin = createClient(url, serviceKey, noStore)
  const { data: found, error: e1 } = await admin.auth.admin.getUserById(ownerId)
  if (e1 || found.user?.id !== ownerId || !found.user.email) throw new Error()
  const { data: link, error: e2 } = await admin.auth.admin.generateLink({ type: 'magiclink', email: found.user.email })
  if (e2 || link.user?.id !== ownerId || !link.properties?.hashed_token) throw new Error()
  // Redeem the one-time link on a plain (anon key) client: from here on it is just Nat, under RLS.
  const sb = createClient(url, anonKey, noStore)
  const { data: s, error: e3 } = await sb.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token })
  if (e3 || !s.session || s.user?.id !== ownerId) throw new Error()
  return { sb, session: s.session }
}

/**
 * For the Telegram Mini App only, after its sign-in check passed: a new session's tokens, so the dashboard opens
 * signed in. Never the cached bot session (signing out of one must not affect the other).
 */
export async function ownerSessionTokens(): Promise<{ access_token: string; refresh_token: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const ownerId = process.env.NAT_OS_OWNER_USER_ID
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey || !ownerId || !UUID.test(ownerId)) throw new OwnerSessionError('The app isn’t fully set up yet (server settings missing).')
  try {
    const { session } = await freshSession(url, anonKey, serviceKey, ownerId)
    return { access_token: session.access_token, refresh_token: session.refresh_token }
  } catch {
    throw new OwnerSessionError('Couldn’t open your session.')
  }
}
