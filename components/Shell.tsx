'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabase, hasSupabaseConfig } from '@/lib/supabase/client'
import { useNow } from '@/lib/useNow'
import { navDate, timeOf, todayISO } from '@/lib/time'
import ExportButton from './ExportButton'
import { useToast } from './ui'

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/projects', label: 'Projects' },
  { href: '/subjects', label: 'Subjects' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/archive', label: 'Archive' },
  { href: '/settings', label: 'Settings' },
]

const isOn = (href: string, path: string) => (href === '/' ? path === '/' : path.startsWith(href))

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const now = useNow()
  const toast = useToast()

  // sign-in pages (incl. the Telegram Mini App entry): no nav, tabs, Export or Sign out
  if (pathname.startsWith('/login') || pathname === '/tg') return <div className="wrap">{children}</div>

  const section = pathname.startsWith('/routines') ? 'Routine' : pathname.startsWith('/guides') ? 'Guides' : LINKS.find((l) => isOn(l.href, pathname))?.label ?? ''

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
      <nav className="tabbar" aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={isOn(l.href, pathname) ? 'on' : ''}
            aria-current={isOn(l.href, pathname) ? 'page' : undefined}>{l.label}</Link>
        ))}
      </nav>
    </div>
  )
}
