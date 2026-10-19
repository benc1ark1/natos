'use client'
import Link from 'next/link'
import type { Task } from '@/lib/types'
import { isDue, pickToday } from '@/lib/tasks'
import { moreSettings } from '@/lib/settings'
import TaskRow from '../TaskRow'
import { Empty } from '../ui'
import type { HomeData } from './HomeView'

export default function TodayCard({ data, onComplete, onEdit }: {
  data: HomeData; onComplete: (t: Task) => Promise<void>; onEdit: (t: Task) => void
}) {
  const items = pickToday(data.tasks, data.today, moreSettings(data.planning).todayMax)
  const due = items.filter(isDue)
  const nice = items.filter((t) => !isDue(t))

  return (
    <section className="card s7" aria-labelledby="todo-h">
      <div className="ch">
        <span className="lbl" id="todo-h"><span className="n">01 //</span> To do</span>
        <span className="lbl">{due.length} due · {nice.length} nice</span>
      </div>
      {data.plan.length > 0 && (
        <>
          <div className="sub lbl">Plan</div>
          {data.plan.map((b) => (
            <div key={b.id} className="trow" style={{ gridTemplateColumns: 'auto minmax(0,1fr)' }}>
              <span className="tmeta">{b.start_time}–{b.end_time}</span>
              <div className="ttitle">{b.title}</div>
            </div>
          ))}
        </>
      )}
      {items.length === 0 ? (
        <Empty>
          Nothing for today yet. Move tasks into <b>Today</b> on the <Link href="/tasks">Tasks</Link> page, or star one.
          Anything due by tomorrow shows here automatically.
        </Empty>
      ) : (
        <>
          <div className="sub lbl">Due</div>
          {due.length === 0 && <div className="state">Nothing due.</div>}
          {due.map((t) => <TaskRow key={t.id} task={t} lookup={data.lookup} today={data.today} onComplete={onComplete} onEdit={onEdit} />)}
          <div className="sub lbl">Nice</div>
          {nice.length === 0 && <div className="state">Nothing optional today.</div>}
          {nice.map((t) => <TaskRow key={t.id} task={t} lookup={data.lookup} today={data.today} onComplete={onComplete} onEdit={onEdit} />)}
        </>
      )}
      {data.doneToday > 0 && <div className="lbl donetoday">{data.doneToday} done today</div>}
    </section>
  )
}
