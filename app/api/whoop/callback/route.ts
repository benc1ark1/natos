import { NextResponse, after, type NextRequest } from 'next/server'
import { WHOOP_COOKIE, finishWhoopConnect } from '@/lib/whoop/oauth'
import { syncWhoop } from '@/lib/whoop/sync'
import { getServerSupabase } from '@/lib/supabase/server'

// Whoop sends him back here. Only works signed in, with the cookie from /api/whoop/connect; the tokens are
// encrypted and saved, then the first sync (last two weeks) runs just after.

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))
  const p = request.nextUrl.searchParams
  const problem = await finishWhoopConnect(sb, { code: p.get('code'), state: p.get('state'), error: p.get('error'), cookie: request.cookies.get(WHOOP_COOKIE)?.value ?? null, origin: request.nextUrl.origin })
  const res = NextResponse.redirect(new URL(`/settings?whoop=${problem ?? 'connected'}`, request.url))
  res.cookies.set(WHOOP_COOKIE, '', { httpOnly: true, path: '/api/whoop', maxAge: 0 })
  if (!problem) after(() => syncWhoop(sb, { force: true }).then(() => undefined))
  return res
}
