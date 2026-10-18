'use client'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Shared behaviour for dropdowns and date pickers: a panel fixed to the
 * viewport next to its button (so scrolling boxes never clip it), flipping
 * upwards when there isn't room below, closing on outside click.
 */
export function usePopover(panelWidth?: number) {
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({ position: 'fixed', visibility: 'hidden' })

  const place = useCallback(() => {
    const a = anchor.current
    if (!a) return
    const r = a.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const width = Math.min(panelWidth ?? Math.max(r.width, 200), vw - 16)
    const left = Math.min(Math.max(8, r.left), vw - width - 8)
    const below = vh - r.bottom - 12
    const above = r.top - 12
    const up = below < 260 && above > below
    setStyle(up
      ? { position: 'fixed', left, width, bottom: vh - r.top + 6, maxHeight: Math.min(340, above) }
      : { position: 'fixed', left, width, top: r.bottom + 6, maxHeight: Math.min(340, below) })
  }, [panelWidth])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open, place])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    if (refocus) anchor.current?.focus()
  }, [])

  return { anchor, panel, open, setOpen, close, style }
}

export function Chevron() {
  return <svg className="ic selchev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
}
