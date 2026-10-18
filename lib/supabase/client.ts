import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

// Browser client: uses only the public URL + anon key. Every query runs as the
// signed-in user, so row level security decides what can be read or written.
// The service role key must never be used here.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let client: SupabaseClient | null = null

export function hasSupabaseConfig(): boolean {
  return Boolean(url && anonKey)
}

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) throw new Error('Supabase keys are missing from .env.local')
  if (!client) client = createBrowserClient(url, anonKey)
  return client
}
