'use client'
import Link from 'next/link'
import { routinesForDay } from '@/lib/routines'
import type { HomeData } from './HomeView'

/** One small line: links to today's routines and the guides library. No progress, no buttons. */
export default function RoutinesLink({ data }: { data: HomeData }) {
  const routines = routinesForDay(data.habits, data.today)
  return (
    <nav className="card rlink" aria-label="Routines">
      <span className="lbl"><span className="n">06 //</span> Routines</span>
      <span className="rlinks">
        {routines.map((r, i) => (
          <span key={r.id}>
            {i > 0 && <span className="sep" aria-hidden="true">·</span>}
            <Link href={`/routines/${r.id}`}>{r.name}</Link>
          </span>
        ))}
        {routines.length > 0 && <span className="sep" aria-hidden="true">·</span>}
        <Link href="/guides">Guides</Link>
      </span>
    </nav>
  )
}
