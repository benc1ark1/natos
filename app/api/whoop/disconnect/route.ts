import { disconnectWhoop } from '@/lib/whoop/oauth'
import { getServerSupabase } from '@/lib/supabase/server'

// "Disconnect" (Settings): Whoop forgets the app; his Whoop history stays. Signed in only.

export async function POST() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
  const error = await disconnectWhoop(sb)
  return Response.json(error ? { ok: false, error } : { ok: true })
}
