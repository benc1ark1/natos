import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Runs before every page: refreshes the Supabase session cookie and sends
// anyone who isn't signed in to /login, so no personal page loads signed out.

export async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const isLogin = request.nextUrl.pathname.startsWith('/login')
  // the Telegram Mini App entry signs in on its own (app/tg); it must load signed out
  const isTelegramEntry = request.nextUrl.pathname === '/tg'

  // Keys not filled in yet: only the login page (which explains the problem) is reachable.
  if (!url || !anonKey) {
    return isLogin ? NextResponse.next() : NextResponse.redirect(new URL('/login', request.url))
  }

  let response = NextResponse.next({ request })
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  if (!user && !isLogin && !isTelegramEntry) return NextResponse.redirect(new URL('/login', request.url))
  if (user && isLogin) return NextResponse.redirect(new URL('/', request.url))
  return response
}

export const config = {
  // icons and the manifest must load signed out, so phones can add the app to the home screen;
  // the Telegram webhook and tick, and the Gmail scripts' route, check their own secrets (app/api/telegram/*, app/api/mail/*)
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png|apple-icon.png|manifest.webmanifest|api/telegram/|api/mail/).*)'],
}
