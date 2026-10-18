import { NextResponse, type NextRequest } from 'next/server'
import { whoopConfigured } from '@/lib/whoop/api'
import { WHOOP_COOKIE, startWhoopConnect } from '@/lib/whoop/oauth'
import { getServerSupabase } from '@/lib/supabase/server'

// "Connect Whoop" (Settings): signed in only. Sends him to Whoop's consent page with a one-time state, which also
// goes in an httpOnly cookie that only /api/whoop/callback reads.

export async function GET(request: NextRequest) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))
  if (!whoopConfigured()) return NextResponse.redirect(new URL('/settings?whoop=not-set-up', request.url))
  const { url, cookie } = startWhoopConnect(request.nextUrl.origin)
  const res = NextResponse.redirect(url)
  res.cookies.set(WHOOP_COOKIE, cookie, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/whoop', maxAge: 600 })
  return res
}
