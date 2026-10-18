'use client'
import { colorOf } from '@/lib/lookup'
import { expandEvents, isBackground, isRepeating, timeRange } from '@/lib/events'
import { deadlineOf, isOpen } from '@/lib/tasks'
import { addDays, dayNum, dowShort, relativeDay, shortDate } from '@/lib/time'
import type { HomeData } from './HomeView'

// rank: 0 test, 1 due date, 2 window, 3 event (deadlines and tests first in each day)
type Item = { key: string; title: string; color: string; rank: number; flag?: string; sub?: string; time?: string }

const DAYS = 14

/**
 * Tests, deadlines and events for the next 14 days. Tests and deadlines come first in each day and are highlighted.
 * Repeating events show only their next occurrence; everyday things like school stay on the calendar only.
 * Prep sessions show on Today and on the test, not here.
 */
export default function UpcomingCard({ data }: { data: HomeData }) {
  const { today, lookup } = data
  const end = addDays(today, DAYS - 1)
  const byDate = new Map<string, Item[]>()
  const overdue: Item[] = []
  const add = (date: string, it: Item) => byDate.set(date, [...(byDate.get(date) ?? []), it])

  for (const g of data.goals) {
    if (g.kind !== 'test' || !g.target_date || g.target_date > end) continue
    add(g.target_date, { key: g.id, title: g.title, rank: 0, flag: 'Test', color: colorOf(lookup, { subject_id: g.subject_id, category_id: null }) })
  }
  for (const t of data.tasks.filter(isOpen)) {
    const d = deadlineOf(t)
    if (!d || t.is_system) continue
    const it: Item = {
      key: t.id, title: t.title, color: colorOf(lookup, t), rank: t.due_at ? 1 : 2,
      flag: t.due_at ? 'Due' : undefined,
      sub: !t.due_at && t.window_label ? t.window_label : undefined,
    }
    if (d < today) overdue.push(it)
    else if (d <= end) add(d, it)
  }
  const seen = new Set<string>()
  for (const o of expandEvents(data.events, today, end, data.changes)) {
    if (isBackground(o.event) || o.cancelled) continue
    if (isRepeating(o.event)) { if (seen.has(o.event.id)) continue; seen.add(o.event.id) }
    add(o.date, { key: o.key, title: o.event.title, color: colorOf(lookup, o.event), rank: 3, sub: o.event.location ?? undefined, time: timeRange(o) })
  }
  for (const list of byDate.values()) list.sort((a, b) => a.rank - b.rank)
  const dates = [...byDate.keys()].sort()

  return (
    <section className="card" aria-labelledby="up-h">
      <div className="ch">
        <span className="lbl" id="up-h"><span className="n">03 //</span> Upcoming</span>
        <span className="lbl">{overdue.length === 0 && dates.length === 0 ? 'Nothing in the next 2 weeks' : `Next ${DAYS} days`}</span>
      </div>
      {overdue.length > 0 && (
        <div className="ug">
          <div><div className="rel warn">Overdue</div></div>
          <div className="uitems">{overdue.map((u) => <Row key={u.key} u={u} />)}</div>
        </div>
      )}
      {dates.map((d) => {
        const rel = relativeDay(d, today)
        return (
          <div className="ug" key={d}>
            <div>
              <div className="lbl">{dowShort(d)}</div>
              <div className="udn mono" aria-label={shortDate(d)}>{dayNum(d)}</div>
              {rel && <div className="rel">{rel}</div>}
            </div>
            <div className="uitems">{byDate.get(d)!.map((u) => <Row key={u.key} u={u} />)}</div>
          </div>
        )
      })}
    </section>
  )
}

function Row({ u }: { u: Item }) {
  return (
    <div className={`uitem ${u.rank < 2 ? 'hl' : ''}`}>
      <span className="dot" style={{ background: u.color }} />
      <span>{u.title}</span>
      {u.flag && <span className={`flag ${u.rank === 0 ? 'test' : ''}`}>{u.flag}</span>}
      {u.sub && <span className="usub">{u.sub}</span>}
      {u.time && <span className="utime mono">{u.time}</span>}
    </div>
  )
}
