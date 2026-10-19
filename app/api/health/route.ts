import { getServerSupabase } from '@/lib/supabase/server'
import { missingEnv } from '@/lib/health'

// Settings → the app's own check: which secret settings Vercel is missing (names only, never values; signed in only).
export async function GET() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return Response.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
  return Response.json({ ok: true, missing: missingEnv() })
}
