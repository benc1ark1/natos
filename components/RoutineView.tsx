'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { rows, safeUrl } from '@/lib/data'
import { blocksOf } from '@/lib/routines'
import { isoDow, todayISO } from '@/lib/time'
import type { Habit, HabitItem } from '@/lib/types'
import { Empty, ErrorBox, Loading, useLoad } from './ui'

type Step = { id: string; habit_item_id: string; title: string; sort_order: number }
const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MODE_KEY = 'routine-mode'

/** A routine as a reference guide: blocks in order, tap one for its steps. Nothing to tick. */
export default function RoutineView({ id }: { id: string }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const sb = getSupabase()
    const [h, items] = await Promise.all([
      sb.from('habits').select('id,name,is_active,sort_order,days_of_week').eq('id', id).maybeSingle(),
      sb.from('habit_items').select('id,habit_id,name,is_required,sort_order,guide_url,guide_id,condition_label,days_of_week').eq('habit_id', id),
    ])
    if (h.error) throw new Error(`Couldn't load the routine: ${h.error.message}`)
    const blocks = blocksOf(id, rows<HabitItem>(items, 'routine blocks'))
    const steps = blocks.length
      ? rows<Step>(await sb.from('routine_steps').select('id,habit_item_id,title,sort_order').in('habit_item_id', blocks.map((b) => b.id)), 'steps')
      : []
    return { habit: h.data as Habit | null, blocks, steps }
  })
  const [mode, setMode] = useState<'learn' | 'quick'>('learn')
  const [open, setOpen] = useState<Set<string>>(new Set())

  useEffect(() => {
    try { const m = localStorage.getItem(MODE_KEY); if (m === 'learn' || m === 'quick') setMode(m) } catch { /* storage blocked */ }
  }, [])
  const pickMode = (m: 'learn' | 'quick') => { setMode(m); try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ } }
  const toggle = (bid: string) => setOpen((s) => { const n = new Set(s); if (n.has(bid)) n.delete(bid); else n.add(bid); return n })

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data && loading) return <div className="card"><Loading lines={6} /></div>
  if (!data) return null
  if (!data.habit) return <Empty>That routine doesn’t exist (or isn’t yours). <Link href="/">Back to Home</Link></Empty>

  const today = isoDow(todayISO())
  const learn = mode === 'learn'

  return (
    <div className="rwrap">
      <div className="pagehead">
        <div>
          <Link href="/" className="lbl" style={{ textDecoration: 'none' }}>← Home</Link>
          <h1 className="pagetitle serif">{data.habit.name}</h1>
          <div className="lbl" style={{ marginTop: 8 }}>{data.blocks.length} blocks · reference, nothing to tick</div>
        </div>
        <div className="seg2" role="tablist" aria-label="View">
          <button role="tab" aria-selected={learn} className={learn ? 'on' : ''} onClick={() => pickMode('learn')}>Learning</button>
          <button role="tab" aria-selected={!learn} className={!learn ? 'on' : ''} onClick={() => pickMode('quick')}>Quick</button>
        </div>
      </div>

      {data.blocks.length === 0 && <Empty>No blocks in this routine yet. Import them from Notion on the <Link href="/guides/import">Guides</Link> page, or add them in Supabase (habit_items).</Empty>}

      <ol className="blocks">
        {data.blocks.map((b, i) => {
          const steps = data.steps.filter((s) => s.habit_item_id === b.id).sort((x, y) => x.sort_order - y.sort_order)
          const expanded = learn || open.has(b.id)
          const guide = b.guide_id ? `/guides/${b.guide_id}` : safeUrl(b.guide_url)
          const notToday = b.days_of_week && !b.days_of_week.includes(today)
          const label = b.condition_label ?? (b.days_of_week ? `${b.days_of_week.map((d) => DAY[d - 1]).join(', ')} only` : null)
          const head = (
            <>
              <span className="bn mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="bt">{b.name}</span>
              {label && <span className="condtag">{label}</span>}
            </>
          )
          return (
            <li key={b.id} className={`blk ${notToday ? 'off' : ''}`}>
              {learn ? <div className="bh">{head}</div> : (
                <button className="bh" onClick={() => toggle(b.id)} aria-expanded={expanded}>
                  {head}
                  <svg className={`ic chev ${expanded ? 'open' : ''}`} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </button>
              )}
              {expanded && (steps.length > 0 || guide) && (
                <div className="bbody">
                  {steps.length > 0 && (
                    <ol className="steps">
                      {steps.map((s, j) => <li key={s.id}><span className="sn mono">{j + 1}</span>{s.title}</li>)}
                    </ol>
                  )}
                  {guide && (b.guide_id
                    ? <Link className="glink" href={guide}>Open guide →</Link>
                    : <a className="glink" href={guide} target="_blank" rel="noopener noreferrer">Open guide →</a>)}
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
