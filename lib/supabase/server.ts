import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Server client for route handlers: runs as the signed-in user (anon key + their
// session cookie), so row level security still applies. Never the service role key.
export async function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase keys are missing from .env.local')
  const store = await cookies()
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)) } catch { /* read-only here */ } },
    },
  })
}
