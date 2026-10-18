import { syncWhoop } from '@/lib/whoop/sync'
import { getServerSupabase } from '@/lib/supabase/server'

// "Sync now" (Settings): one Whoop sync as him. Signed in only.

export const maxDuration = 60

export async function POST() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
  const r = await syncWhoop(sb, { force: true })
  if (!r) return Response.json({ ok: false, error: 'Whoop isn’t connected.' })
  return Response.json(r)
}
