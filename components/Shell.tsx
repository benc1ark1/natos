'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase/client'
import { useNow } from '@/lib/useNow'
import { navDate, timeOf, todayISO } from '@/lib/time'
import ExportButton from './ExportButton'
import { useToast } from './ui'

// Item 5: Home is Today first (the rest of Home is one tap below it), so its tab says Today.
const LINKS = [
  { href: '/', label: 'Today', icon: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z' },
  { href: '/tasks', label: 'Tasks', icon: 'M10 6h10M10 12h10M10 18h10M4 6l1.2 1.2L7.5 5M4 12l1.2 1.2 2.3-2.2M4 18l1.2 1.2 2.3-2.2' },
  { href: '/projects', label: 'Projects', icon: 'M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z' },
  { href: '/subjects', label: 'Subjects', icon: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6' },
  { href: '/training', label: 'Training', icon: 'M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11' },
  { href: '/inbox', label: 'Inbox', icon: 'M3 13h5l1.5 3h5l1.5-3h5M5.5 5h13L21 13v6H3v-6z' },
  { href: '/archive', label: 'Archive', icon: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4' },
  { href: '/settings', label: 'Settings', icon: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4' },
]

const isOn = (href: string, path: string) => (href === '/' ? path === '/' : path.startsWith(href))

// The phone's tab bar keeps the everyday ones; the rest are one tap away under More.
const PHONE_TABS = ['/', '/tasks', '/subjects', '/training', '/inbox']
const MORE_ICON = 'M5 12h.01M12 12h.01M19 12h.01'
const MORE = LINKS.filter((l) => !PHONE_TABS.includes(l.href))

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const now = useNow()
  const toast = useToast()
  const [more, setMore] = useState(false)
  useEffect(() => { setMore(false) }, [pathname])

  // sign-in pages (incl. the Telegram Mini App entry): no nav, tabs, Export or Sign out
  if (pathname.startsWith('/login') || pathname === '/tg') return <div className="wrap">{children}</div>

  const section = pathname.startsWith('/routines') ? 'Routine' : pathname.startsWith('/guides') ? 'Guides' : LINKS.find((l) => isOn(l.href, pathname))?.label ?? ''
  const moreOn = MORE.some((l) => isOn(l.href, pathname))

  async function signOut() {
    if (hasSupabaseConfig()) await getSupabase().auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <div className="wrap">
      <header className="nav">
        <Link className="brand mono" href="/">
          <span className="live" />NAT OS <span className="n">// {section.toUpperCase()}</span>
        </Link>
        <nav className="navlinks" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`navlink ${isOn(l.href, pathname) ? 'on' : ''}`}
              aria-current={isOn(l.href, pathname) ? 'page' : undefined}>{l.label}</Link>
          ))}
        </nav>
        <div className="navr">
          {now && <span className="date">{navDate(todayISO())}<span className="sep">·</span>{timeOf(now)}</span>}
          <ExportButton toast={toast.show} />
          <button className="signout" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main>{children}</main>
      {toast.node}
      {more && (
        <div className="moresheet" role="dialog" aria-label="More pages" onClick={() => setMore(false)}>
          <nav className="morelist" aria-label="More" onClick={(e) => e.stopPropagation()}>
            {MORE.map((l) => (
              <Link key={l.href} href={l.href} className={isOn(l.href, pathname) ? 'on' : ''} aria-current={isOn(l.href, pathname) ? 'page' : undefined}>{l.label}</Link>
            ))}
          </nav>
        </div>
      )}
      <nav className="tabbar" aria-label="Main">
        {LINKS.filter((l) => PHONE_TABS.includes(l.href)).map((l) => (
          <Link key={l.href} href={l.href} className={isOn(l.href, pathname) ? 'on' : ''}
            aria-current={isOn(l.href, pathname) ? 'page' : undefined}>
            <svg className="ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={l.icon} /></svg>
            <span>{l.label}</span>
          </Link>
        ))}
        <button className={moreOn || more ? 'on' : ''} aria-expanded={more} onClick={() => setMore((v) => !v)}>
          <svg className="ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={MORE_ICON} strokeWidth={3} /></svg>
          <span>More</span>
        </button>
      </nav>
    </div>
  )
}
