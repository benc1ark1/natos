'use client'
import { useState } from 'react'
import { colorOf } from '@/lib/lookup'
import { expandEvents, gridHours, isBackground, timeRange, type Occurrence } from '@/lib/events'
import { schoolDays, windowIcon, type SchoolDay } from '@/lib/school'
import { planningSettings } from '@/lib/freetime'
import { addDays, dayNum, dowShort, minutesOf, shortDate, timeOf } from '@/lib/time'
import EventSheet from '../EventSheet'
import { Empty, type ShowToast } from '../ui'
import type { HomeData } from './HomeView'

const PX = 22

const hex = (c: string, a: number) => {
  const n = parseInt(c.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

/** "Club football, Tue 6 Oct 16:00–17:30, moved this week" */
const describe = (o: Occurrence) =>
  [o.event.title, `${dowShort(o.date)} ${shortDate(o.date)} ${timeRange(o)}`,
    o.cancelled ? 'cancelled this week' : o.moved ? 'moved this week' : '', o.missed ? 'missed' : '',
    o.event.travel_minutes ? `${o.event.travel_minutes} min travel each way` : ''].filter(Boolean).join(', ')

/** This week's events (Mon–Sun). Desktop: time grid like the design. Phone: a day list. Tap an event to edit it. */
export default function CalendarCard({ data, now, reload, toast }: { data: HomeData; now: Date | null; reload: () => Promise<void>; toast: ShowToast }) {
  const { today, weekStart, lookup } = data
  const [open, setOpen] = useState<{ occ: Occurrence | null } | null>(null)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const occ = expandEvents(data.events, weekStart, days[6], data.changes)
  // school as one block a day: both calendars' School merged, lessons hidden, free periods/break/lunch marked on it
  const school = schoolDays(data.events, data.changes, weekStart, days[6], planningSettings(data.planning).schoolFreePeriods)
  const hidden = new Set([...school.values()].flatMap((x) => [...x.hidden]))
  const byDay = (d: string) => occ.filter((o) => o.date === d && !hidden.has(o.key))
  /** The School event to open when the merged block is tapped: his own one if he has it. */
  const schoolOcc = (sd: SchoolDay) => {
    const blocks = occ.filter((o) => o.date === sd.date && sd.hidden.has(o.key) && o.start === sd.start)
    return blocks.find((o) => o.event.external_source !== 'google') ?? blocks[0] ?? null
  }
  const listDay = (d: string) => (d >= today ? byDay(d) : byDay(d).filter((o) => o.event.target_id))
  const nowMin = now ? minutesOf(timeOf(now)) : null
  // 08:00–22:00, stretched to fit anything earlier or later (with its travel) so nothing is cut off
  const { startH: START_H, endH: END_H, hours: HOURS } = gridHours(occ)
  const HEIGHT = (END_H - START_H) * PX

  const style = (o: Occurrence) => {
    if (isBackground(o.event)) return { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.09)', color: '#9aa6a3' }
    const c = colorOf(lookup, o.event)
    return { background: hex(c, 0.14), borderColor: hex(c, 0.45), color: c }
  }
  const row = (o: Occurrence) => (
    <button className={`uitem evrow ${o.cancelled ? 'cancelled' : ''} ${o.missed ? 'missed' : ''}`} key={o.key} onClick={() => setOpen({ occ: o })} aria-label={describe(o)}>
      <span className="dot" style={{ background: isBackground(o.event) ? '#55625f' : colorOf(lookup, o.event) }} />
      <span className="evt">{o.event.title}</span>
      {o.cancelled && <span className="usub">cancelled</span>}
      {o.moved && <span className="usub">moved</span>}
      {o.missed && <span className="usub">missed</span>}
      <span className="utime mono">{timeRange(o)}</span>
      {!o.cancelled && o.event.travel_minutes > 0 && <span className="usub">+{o.event.travel_minutes} min travel</span>}
    </button>
  )
  const y = (min: number) => Math.max(0, Math.min(HEIGHT, ((min - START_H * 60) / 60) * PX))

  return (
    <section className="card s12 calcard" aria-labelledby="cal-h">
      <div className="ch">
        <span className="lbl" id="cal-h"><span className="n">05 //</span> Calendar</span>
        <span className="lbl calrange">{shortDate(weekStart)} – {shortDate(days[6])}</span>
        <button className="btn sm ghost" onClick={() => setOpen({ occ: null })}>+ Event</button>
      </div>
      {occ.length === 0 && <Empty>No events this week. Tap + Event to add one.</Empty>}

      {occ.length > 0 && (
        <div className="calgrid">
          <div className="calhead" aria-hidden="true">
            <span />
            {days.map((d) => (
              <div key={d} className={`dh ${d < today ? 'past' : d === today ? 'today' : ''}`}>
                <div className="lbl">{dowShort(d)}</div><div className="dn mono">{dayNum(d)}</div>
              </div>
            ))}
          </div>
          <div className="calbody">
            <div className="gut" style={{ height: HEIGHT }} aria-hidden="true">
              {HOURS.map((h) => <span key={h} className="hl mono" style={{ top: (h - START_H) * PX }}>{String(h).padStart(2, '0')}</span>)}
            </div>
            <div className="cols" style={{ height: HEIGHT }}>
              {HOURS.map((h) => <span key={h} className="hline" style={{ top: (h - START_H) * PX }} />)}
              {days.map((d) => (
                <div key={d} className={`dcol ${d < today ? 'past' : d === today ? 'today' : ''}`} style={{ height: HEIGHT }}>
                  {byDay(d).filter((o) => o.start).map((o) => {
                    const s = minutesOf(o.start!)
                    const e = o.end ? minutesOf(o.end) : s + 60
                    const top = y(s)
                    const h = Math.max(10, y(e) - top)
                    const tr = o.cancelled ? 0 : o.event.travel_minutes
                    const st = style(o)
                    return (
                      <div key={o.key}>
                        {tr > 0 && <>
                          <div className="tb" style={{ top: y(s - tr), height: top - y(s - tr), borderColor: st.borderColor, background: st.background }} />
                          <div className="tb" style={{ top: y(e), height: y(e + tr) - y(e), borderColor: st.borderColor, background: st.background }} />
                        </>}
                        <button className={`eb ${o.cancelled ? 'cancelled' : ''} ${o.missed ? 'missed' : ''}`} style={{ top, height: h, ...st }}
                          title={describe(o)} aria-label={describe(o)} onClick={() => setOpen({ occ: o })}>
                          {h >= 16 ? o.event.title : ''}
                        </button>
                      </div>
                    )
                  })}
                  {(() => {
                    const sd = school.get(d)
                    if (!sd) return null
                    const top = y(minutesOf(sd.start)), so = schoolOcc(sd)
                    const label = `School ${sd.start}–${sd.end}${sd.windows.length ? `; ${sd.windows.map((w) => `${w.label.toLowerCase()} ${w.start}–${w.end}`).join(', ')}` : ''}`
                    return (
                      <div>
                        <button className="eb" style={{ top, height: Math.max(10, y(minutesOf(sd.end)) - top), background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.09)', color: '#9aa6a3' }}
                          title={label} aria-label={label} onClick={() => so && setOpen({ occ: so })}>School</button>
                        {sd.windows.map((w) => {
                          const wt = y(minutesOf(w.start)), wh = Math.max(8, y(minutesOf(w.end)) - wt)
                          return <div key={w.start} className="eb swin" style={{ top: wt, height: wh }} aria-hidden="true">{wh >= 14 ? `${windowIcon(w)} ${w.label}` : ''}</div>
                        })}
                      </div>
                    )
                  })()}
                  {d === today && nowMin !== null && nowMin >= START_H * 60 && nowMin <= END_H * 60 && (
                    <div className="nowln" style={{ top: y(nowMin) }}><span className="nowdot" /></div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Phones: a day list. Today onwards, plus earlier training sessions this week (so one can be marked missed). */}
      {occ.length > 0 && (
        <div className="callist">
          {days.filter((d) => d >= today || listDay(d).length > 0).map((d) => (
            <div key={d} className={`cday ${d === today ? 'today' : d < today ? 'past' : ''}`}>
              <div><div className="lbl">{dowShort(d)}</div><div className="udn mono">{dayNum(d)}</div></div>
              <div className="uitems">
                {listDay(d).length === 0 && !(d >= today && school.get(d)) && <span className="usub">Nothing booked</span>}
                {listDay(d).filter((o) => d >= today && school.get(d) && (o.start ?? '') < school.get(d)!.start).map(row)}
                {d >= today && (() => {
                  const sd = school.get(d)
                  if (!sd) return null
                  const so = schoolOcc(sd)
                  return <>
                    <button className="uitem evrow" onClick={() => so && setOpen({ occ: so })} aria-label={`School ${sd.start}–${sd.end}`}>
                      <span className="dot" style={{ background: '#55625f' }} />
                      <span className="evt">🏫 School</span>
                      <span className="utime mono">{sd.start}–{sd.end}</span>
                    </button>
                    {sd.windows.map((w) => (
                      <div className="uitem swrow" key={w.start}>
                        <span className="evt">{windowIcon(w)} {w.label}</span>
                        <span className="utime mono">{w.start}–{w.end}</span>
                      </div>
                    ))}
                  </>
                })()}
                {listDay(d).filter((o) => !(d >= today && school.get(d) && (o.start ?? '') < school.get(d)!.start)).map(row)}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <EventSheet key={open.occ?.key ?? 'new'} occ={open.occ} lookup={lookup} targets={data.targets} userId={data.userId}
          onChanged={reload} toast={toast} onClose={() => setOpen(null)} />
      )}
    </section>
  )
}
