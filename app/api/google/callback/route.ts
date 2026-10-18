import { NextResponse, after, type NextRequest } from 'next/server'
import { COOKIE, finishConnect } from '@/lib/google/oauth'
import { syncGoogle } from '@/lib/google/sync'
import { getServerSupabase } from '@/lib/supabase/server'

// Google sends him back here. Only works signed in, with the cookie from /api/google/connect; the tokens are
// encrypted and saved, then the first sync runs just after (it makes the Life OS calendar).

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return NextResponse.redirect(new URL('/login', request.url))
  const p = request.nextUrl.searchParams
  const problem = await finishConnect(sb, { code: p.get('code'), state: p.get('state'), error: p.get('error'), cookie: request.cookies.get(COOKIE)?.value ?? null, origin: request.nextUrl.origin })
  const res = NextResponse.redirect(new URL(`/settings?google=${problem ?? 'connected'}`, request.url))
  res.cookies.set(COOKIE, '', { httpOnly: true, path: '/api/google', maxAge: 0 })
  if (!problem) after(() => syncGoogle(sb, { readOthers: true }).then(() => undefined))
  return res
}
