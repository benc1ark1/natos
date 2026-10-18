'use client'
import { useEffect, useId, useState } from 'react'
import { addDays, isoDow, todayISO } from '@/lib/time'
import { usePopover } from './usePopover'

const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const monthOf = (iso: string) => iso.slice(0, 7) + '-01'
function addMonths(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const days = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, days)).padStart(2, '0')}`
}
export function formatDay(iso: string) {
  const y = iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10)
  return `${DOW[isoDow(iso) - 1]} ${d} ${MON_SHORT[m - 1]}${y !== todayISO().slice(0, 4) ? ' ' + y : ''}`
}

type Props = { value: string; onChange: (v: string) => void; label: string; placeholder?: string }

/** Date picker in the design's style (replaces the browser's date input). Keyboard: arrows, PgUp/PgDn, Enter, Esc. */
export default function DatePicker({ value, onChange, label, placeholder = 'No date' }: Props) {
  const id = useId()
  const p = usePopover(300)
  const [focus, setFocus] = useState(value || todayISO())
  const view = monthOf(focus)
  const today = todayISO()

  function openCal() {
    setFocus(value || todayISO())
    p.setOpen(true)
  }
  useEffect(() => {
    if (p.open) (p.panel.current?.querySelector(`[data-iso="${focus}"]`) as HTMLButtonElement | null)?.focus()
  }, [focus, p.open, p.panel, p.style])   // p.style: re-run once placed (hidden on first render)

  function pick(iso: string) {
    onChange(iso)
    p.close()
  }

  function onKey(e: React.KeyboardEvent) {
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focus, -1), ArrowRight: () => addDays(focus, 1),
      ArrowUp: () => addDays(focus, -7), ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, -1), PageDown: () => addMonths(focus, 1),
      Home: () => addDays(focus, 1 - isoDow(focus)), End: () => addDays(focus, 7 - isoDow(focus)),
    }
    if (moves[e.key]) { e.preventDefault(); setFocus(moves[e.key]()) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.close() }
  }

  const start = addDays(view, 1 - isoDow(view))
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i))

  return (
    <div className="field">
      <span id={`${id}-lab`}>{label}</span>
      <button ref={p.anchor} id={`${id}-b`} type="button" className="selbtn" aria-haspopup="dialog" aria-expanded={p.open}
        aria-labelledby={`${id}-lab ${id}-b`} onClick={() => (p.open ? p.close() : openCal())}>
        <span className={value ? 'selval' : 'selval ph'}>{value ? formatDay(value) : placeholder}</span>
        <svg className="ic selchev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
      </button>
      {p.open && (
        <div ref={p.panel} role="dialog" aria-label={`Choose ${label.toLowerCase()}`} className="pop cal" style={p.style} onKeyDown={onKey}>
          <div className="calnav">
            <button type="button" className="calarrow" aria-label="Previous month" onClick={() => setFocus(addMonths(focus, -1))}>‹</button>
            <span className="calmonth" aria-live="polite">{MON[+view.slice(5, 7) - 1]} {view.slice(0, 4)}</span>
            <button type="button" className="calarrow" aria-label="Next month" onClick={() => setFocus(addMonths(focus, 1))}>›</button>
          </div>
          <div className="calgrid7">
            {DOW.map((d) => <span key={d} className="caldow" aria-hidden="true">{d.slice(0, 2)}</span>)}
            {cells.map((iso) => (
              <button key={iso} type="button" data-iso={iso} tabIndex={iso === focus ? 0 : -1}
                className={`calday ${iso.slice(0, 7) !== view.slice(0, 7) ? 'out' : ''} ${iso === today ? 'today' : ''} ${iso === value ? 'sel' : ''}`}
                aria-label={formatDay(iso)} aria-pressed={iso === value} onClick={() => pick(iso)}>
                {+iso.slice(8, 10)}
              </button>
            ))}
          </div>
          <div className="calfoot">
            <button type="button" className="btn sm ghost" onClick={() => pick(today)}>Today</button>
            {value && <button type="button" className="btn sm ghost" onClick={() => { onChange(''); p.close() }}>Clear</button>}
          </div>
        </div>
      )}
    </div>
  )
}
