import { disconnectGoogle } from '@/lib/google/oauth'
import { getServerSupabase } from '@/lib/supabase/server'

// "Disconnect" (Settings): Google forgets the sign-in; the copies of his Google events are archived. Signed in only.

export async function POST() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
  const error = await disconnectGoogle(sb)
  return Response.json(error ? { ok: false, error } : { ok: true })
}
