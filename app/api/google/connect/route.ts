import { NextResponse, type NextRequest } from 'next/server'
import { googleConfigured } from '@/lib/google/api'
import { COOKIE, startConnect } from '@/lib/google/oauth'
import { getServerSupabase } from '@/lib/supabase/server'

// "Connect Google Calendar" (Settings): signed in only. Sends him to Google's consent page with a one-time state;
// the matching secret goes in an httpOnly cookie that only /api/google/callback reads.

export async function GET(request: NextRequest) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))
  if (!googleConfigured()) return NextResponse.redirect(new URL('/settings?google=not-set-up', request.url))
  const { url, cookie } = startConnect(request.nextUrl.origin)
  const res = NextResponse.redirect(url)
  res.cookies.set(COOKIE, cookie, { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/api/google', maxAge: 600 })
  return res
}
