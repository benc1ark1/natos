import { syncGoogle } from '@/lib/google/sync'
import { getServerSupabase } from '@/lib/supabase/server'

// "Sync now" (Settings): runs one Google sync as him and says what happened. Signed in only.

export const maxDuration = 60

export async function POST() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
  const r = await syncGoogle(sb, { readOthers: true })
  if (!r) return Response.json({ ok: false, error: 'Google Calendar isn’t connected.' })
  return Response.json(r)
}
