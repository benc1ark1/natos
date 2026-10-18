'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { Chevron, usePopover } from './usePopover'

export type Option = { value: string; label: string; group?: string }

type Props = {
  value: string
  onChange: (value: string) => void
  options: Option[]
  label?: string          // shows a field label above (form style)
  ariaLabel?: string      // name for screen readers when there's no visible label
  placeholder?: string
  size?: 'sm'
  disabled?: boolean
}

/** Dropdown in the design's style (replaces the browser's <select>). Keyboard: arrows, Home/End, Enter, Esc, type a letter. */
export default function Select({ value, onChange, options, label, ariaLabel, placeholder = 'Choose…', size, disabled }: Props) {
  const id = useId()
  const p = usePopover()
  const [active, setActive] = useState(0)
  const typed = useRef({ text: '', at: 0 })
  const current = options.find((o) => o.value === value)

  function openList() {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    p.setOpen(true)
  }
  // re-run once placed: the panel is hidden on its first render and can't take focus then
  useEffect(() => { if (p.open) p.panel.current?.focus() }, [p.open, p.panel, p.style])
  useEffect(() => {
    if (p.open) document.getElementById(`${id}-o${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [active, p.open, id])

  function choose(i: number) {
    onChange(options[i].value)
    p.close()
  }

  function onListKey(e: React.KeyboardEvent) {
    const last = options.length - 1
    const keys: Record<string, () => void> = {
      ArrowDown: () => setActive((a) => Math.min(last, a + 1)),
      ArrowUp: () => setActive((a) => Math.max(0, a - 1)),
      Home: () => setActive(0),
      End: () => setActive(last),
      Enter: () => choose(active),
      ' ': () => choose(active),
      Escape: () => p.close(),
    }
    if (keys[e.key]) {
      e.preventDefault()
      e.stopPropagation()   // Esc closes only the list, not a surrounding dialog
      keys[e.key]()
    } else if (e.key === 'Tab') {
      p.close(false)
    } else if (e.key.length === 1) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const i = options.findIndex((o) => o.label.toLowerCase().startsWith(typed.current.text))
      if (i >= 0) setActive(i)
    }
  }

  const button = (
    <button
      ref={p.anchor} id={`${id}-b`} type="button" disabled={disabled}
      className={`selbtn ${size === 'sm' ? 'sm' : ''}`}
      aria-haspopup="listbox" aria-expanded={p.open} aria-controls={`${id}-l`}
      aria-labelledby={label ? `${id}-lab ${id}-b` : undefined}
      aria-label={label ? undefined : `${ariaLabel ?? ''}${ariaLabel ? ': ' : ''}${current?.label ?? placeholder}`}
      onClick={() => (p.open ? p.close() : openList())}
      onKeyDown={(e) => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); openList() } }}
    >
      <span className={current ? 'selval' : 'selval ph'}>{current?.label ?? placeholder}</span>
      <Chevron />
    </button>
  )

  let lastGroup: string | undefined
  const list = p.open && (
    <div ref={p.panel} id={`${id}-l`} role="listbox" tabIndex={-1} className="pop"
      aria-labelledby={label ? `${id}-lab` : undefined} aria-label={label ? undefined : ariaLabel}
      aria-activedescendant={`${id}-o${active}`} style={p.style} onKeyDown={onListKey}>
      {options.map((o, i) => {
        const header = o.group && o.group !== lastGroup ? o.group : null
        lastGroup = o.group
        return (
          <div key={o.value + i}>
            {header && <div className="popgroup" aria-hidden="true">{header}</div>}
            <div id={`${id}-o${i}`} role="option" aria-selected={o.value === value}
              className={`popopt ${i === active ? 'active' : ''} ${o.value === value ? 'sel' : ''}`}
              onPointerEnter={() => setActive(i)} onClick={() => choose(i)}>
              {o.label}
              {o.value === value && <svg className="ic" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
            </div>
          </div>
        )
      })}
    </div>
  )

  if (label) {
    return (
      <div className="field">
        <span id={`${id}-lab`}>{label}</span>
        {button}{list}
      </div>
    )
  }
  return <span className="selwrap">{button}{list}</span>
}
