'use client'
// One exercise's estimated 1RM over time (queue item 6): inline SVG, no chart library. One series (the title names it),
// a 2px line with a light wash, ringed points, the last value labelled, hairline gridlines. Hover, tap or the arrow keys
// show a point's value, date and top set; "Show as table" lists every point.
import { useEffect, useMemo, useRef, useState } from 'react'
import { dowShort, shortDate } from '@/lib/time'
import s from '@/app/training/training.module.css'

export type ChartPoint = { date: string; e1rm: number; top: string }

const LINE = '#35a383'          // the app's mint, one step darker so the line holds against the dark card
const SURFACE = '#0b1010'
const GRID = 'rgba(255,255,255,0.075)'
const INK = '#9aa6a3'           // axis text: the muted text token
const t = (iso: string) => Date.parse(`${iso}T12:00:00Z`)
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`

/** Round tick values for a range (3–5 of them). */
function ticks(lo: number, hi: number): number[] {
  const span = Math.max(1, hi - lo)
  const step = [1, 2, 2.5, 5, 10, 20, 25, 50, 100].find((x) => span / x <= 4) ?? 100
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 10) / 10)
  return out
}

export default function TrainingChart({ name, points }: { name: string; points: ChartPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(340)
  const [active, setActive] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => { setActive(null) }, [name])

  const H = 200, M = { l: 38, r: 46, t: 14, b: 26 }
  const geo = useMemo(() => {
    if (!points.length) return null
    const vals = points.map((p) => p.e1rm)
    const lo0 = Math.min(...vals), hi0 = Math.max(...vals)
    const pad = Math.max(1, (hi0 - lo0) * 0.15)
    const ys = ticks(lo0 - pad, hi0 + pad)
    const lo = Math.min(ys[0], lo0 - pad), hi = Math.max(ys[ys.length - 1], hi0 + pad)
    const t0 = t(points[0].date), t1 = t(points[points.length - 1].date)
    const x = (iso: string) => (t1 === t0 ? M.l + (width - M.l - M.r) / 2 : M.l + ((t(iso) - t0) / (t1 - t0)) * (width - M.l - M.r))
    const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b)
    const xy = points.map((p) => ({ ...p, x: x(p.date), y: y(p.e1rm) }))
    const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('')
    const area = xy.length > 1 ? `${line}L${xy[xy.length - 1].x.toFixed(1)},${H - M.b}L${xy[0].x.toFixed(1)},${H - M.b}Z` : ''
    return { xy, line, area, ys, y }
  }, [points, width, M.l, M.r, M.t, M.b])

  if (!geo) return null
  const { xy } = geo
  const last = xy[xy.length - 1]
  const pick = (clientX: number) => {
    const box = wrap.current?.getBoundingClientRect()
    if (!box) return
    const px = clientX - box.left
    let best = 0
    xy.forEach((p, i) => { if (Math.abs(p.x - px) < Math.abs(xy[best].x - px)) best = i })
    setActive(best)
  }
  const a = active != null ? xy[active] : null
  const first = points[0], end = points[points.length - 1]
  const summary = `${name}: estimated 1RM ${points.length > 1 ? `from ${first.e1rm} kg (${day(first.date)}) to ${end.e1rm} kg (${day(end.date)})` : `${end.e1rm} kg (${day(end.date)})`}, ${points.length} session${points.length === 1 ? '' : 's'}`
  const xLabels = points.length > 1 ? [xy[0], ...(width > 420 && xy.length > 2 ? [xy[Math.floor(xy.length / 2)]] : []), last] : [last]

  return (
    <>
      <div ref={wrap} className={s.chartwrap} onPointerMove={(e) => { if (e.pointerType === 'mouse') pick(e.clientX) }} onPointerDown={(e) => pick(e.clientX)}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActive(null) }}>
        <svg className={s.chart} width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={summary} tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setActive((i) => Math.max(0, Math.min(xy.length - 1, (i ?? (e.key === 'ArrowRight' ? -1 : xy.length)) + (e.key === 'ArrowRight' ? 1 : -1)))) }
            if (e.key === 'Escape') setActive(null)
          }}>
          {geo.ys.map((v) => (
            <g key={v}>
              <line x1={M.l} x2={width - M.r} y1={geo.y(v)} y2={geo.y(v)} stroke={GRID} strokeWidth={1} />
              <text x={M.l - 8} y={geo.y(v)} fill={INK} fontSize={11} textAnchor="end" dominantBaseline="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>{v}</text>
            </g>
          ))}
          {xLabels.map((p, i) => (
            <text key={`${p.date}${i}`} x={p.x} y={H - 6} fill={INK} fontSize={11} textAnchor={xLabels.length > 1 && i === 0 ? 'start' : i === xLabels.length - 1 && xLabels.length > 1 ? 'end' : 'middle'}>{shortDate(p.date)}</text>
          ))}
          {geo.area && <path d={geo.area} fill={LINE} opacity={0.1} />}
          {xy.length > 1 && <path d={geo.line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
          {a && <line x1={a.x} x2={a.x} y1={M.t} y2={H - M.b} stroke="rgba(255,255,255,0.35)" strokeWidth={1} />}
          {xy.map((p, i) => <circle key={p.date} cx={p.x} cy={p.y} r={i === active ? 5.5 : 4} fill={LINE} stroke={SURFACE} strokeWidth={2} />)}
          <text x={last.x + 9} y={last.y} fill="#e6ebe9" fontSize={12} fontWeight={600} dominantBaseline="middle" style={{ fontVariantNumeric: 'tabular-nums' }}>{last.e1rm}</text>
        </svg>
        {a && (
          <div className={s.tip} style={{ left: Math.max(70, Math.min(width - 70, a.x)) }} role="status">
            <div className={s.tipv}>{a.e1rm} kg e1RM</div>
            <div className={s.tipl}>{day(a.date)} · {a.top}</div>
          </div>
        )}
      </div>
      <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setTable((x) => !x)} aria-expanded={table}>{table ? 'Hide table' : 'Show as table'}</button>
      {table && (
        <table className={s.table}>
          <thead><tr><th>Day</th><th>Top set</th><th>e1RM</th></tr></thead>
          <tbody>{[...points].reverse().map((p) => <tr key={p.date}><td>{day(p.date)}</td><td>{p.top}</td><td>{p.e1rm} kg</td></tr>)}</tbody>
        </table>
      )}
    </>
  )
}
