'use client'
import { useState } from 'react'
import type { Task } from '@/lib/types'
import { colorOf, subjectName, type Lookup } from '@/lib/lookup'
import { safeUrl } from '@/lib/data'
import { isDue, metaLine } from '@/lib/tasks'
import { CheckIcon } from './ui'

type Props = {
  task: Task
  lookup: Lookup
  today: string
  onComplete: (t: Task) => Promise<void>
  onEdit?: (t: Task) => void
  actions?: React.ReactNode
  pending?: boolean   // a change is waiting for the database to confirm
  meta?: string       // replaces the usual meta line under the title
}

/** One task line, in the style of the design's Today rows. */
export default function TaskRow({ task, lookup, today, onComplete, onEdit, actions, pending, meta: metaOverride }: Props) {
  const [busy, setBusy] = useState(false)
  const color = colorOf(lookup, task)
  const sub = subjectName(lookup, task.subject_id)
  const meta = metaOverride ?? metaLine(task, today)
  const nice = !isDue(task)

  async function complete() {
    setBusy(true)
    try { await onComplete(task) } finally { setBusy(false) }
  }

  return (
    <div className={`trow ${nice ? 'nice' : ''} ${busy ? 'completing' : pending ? 'pending' : ''}`} aria-busy={busy || pending || undefined}>
      <button className="chkbtn" onClick={complete} disabled={busy} aria-label={`Complete and archive: ${task.title}`}>
        <span className={`chk ${busy ? 'on' : nice ? 'dash' : ''}`}>{busy && <CheckIcon />}</span>
      </button>
      <div style={{ minWidth: 0 }}>
        {onEdit
          ? <button className="ttitle" onClick={() => onEdit(task)}>{task.title}</button>
          : <div className="ttitle">{task.title}</div>}
        {task.needs_sorting && <div className="tmeta warn">Not sorted yet</div>}
        {meta && <div className={`tmeta ${meta.startsWith('Overdue') ? 'warn' : ''}`}>{meta}</div>}
        <HandIn task={task} />
      </div>
      <span className="tagcell">{sub && <span className="tag" style={{ color }}><span className="dot" style={{ background: color }} />{sub}</span>}</span>
      <span className="tmins mono">{task.duration_minutes ? <>{task.duration_minutes}<span className="u">min</span></> : ''}</span>
      <div className="tactions">{actions}</div>
    </div>
  )
}

/** "Hand in: Google Classroom ↗" — the link opens in a new tab. */
export function HandIn({ task }: { task: Task }) {
  const url = safeUrl(task.hand_in_url)
  if (!task.hand_in && !url) return null
  return (
    <div className="handin">
      <span>Hand in:</span>
      {url
        ? <a href={url} target="_blank" rel="noopener noreferrer">{task.hand_in || 'link'} ↗</a>
        : <span>{task.hand_in}</span>}
    </div>
  )
}
