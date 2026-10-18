'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { goalWhen, setGoalArchived } from '@/lib/goals'
import type { Goal, Task } from '@/lib/types'
import GoalSheet from '../GoalSheet'
import type { ShowToast } from '../ui'
import type { HomeData } from './HomeView'

/** Goals: name, optional date (none = ongoing), linked tasks. Past their date they leave Home by themselves. */
export default function GoalsCard({ data, reload, toast, onComplete }: {
  data: HomeData; reload: () => Promise<void>; toast: ShowToast; onComplete: (t: Task) => Promise<void>
}) {
  const [open, setOpen] = useState<{ id: string | null; kind: Goal['kind'] } | null>(null)
  const openGoal = open?.id ? data.goals.find((g) => g.id === open.id) ?? null : null
  const left = (g: Goal) => data.tasks.filter((t) => t.goal_id === g.id && !t.is_system).length
  const done = (g: Goal) => data.goalStats[g.id]?.done ?? 0
  // tests first (soonest first), then goals
  const list = [...data.goals].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'test' ? -1 : 1))
  const progress = (g: Goal) => {
    if (g.kind === 'test') { const s = data.goalStats[g.id]; return s?.sessions ? `${s.sessionsDone}/${s.sessions} sessions` : 'No sessions' }
    const total = done(g) + left(g)
    return total ? `${done(g)}/${total} tasks` : 'No tasks'
  }

  async function archive(g: Goal) {
    const sb = getSupabase()
    const err = await setGoalArchived(sb, g, true)
    await reload()
    if (err) return toast({ kind: 'error', text: err })
    setOpen(null)
    toast({
      kind: 'ok', text: `Archived “${g.title}”.`,
      action: { label: 'Undo', run: async () => { const e = await setGoalArchived(sb, g, false); if (e) toast({ kind: 'error', text: e }); reload() } },
    })
  }

  return (
    <section className="card" aria-labelledby="goals-h">
      <div className="ch" style={{ marginBottom: data.goals.length ? 8 : 0 }}>
        <span className="lbl" id="goals-h"><span className="n">//</span> Goals{data.goals.length ? '' : ' · none yet'}</span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button className="btn sm ghost" onClick={() => setOpen({ id: null, kind: 'test' })}>+ Test</button>
          <button className="btn sm ghost" onClick={() => setOpen({ id: null, kind: 'goal' })}>+ Goal</button>
        </span>
      </div>
      {list.map((g) => (
        <button key={g.id} className="goalrow" onClick={() => setOpen({ id: g.id, kind: g.kind })}>
          {g.kind === 'test' && <span className="flag">Test</span>}
          <span className="wn">{g.title}</span>
          <span className="wsub mono">{goalWhen(g, data.today)}</span>
          <span className="wc mono">{progress(g)}</span>
        </button>
      ))}
      {open && (open.id === null || openGoal) && (
        <GoalSheet key={open.id ?? `new-${open.kind}`} goal={openGoal} kind={open.kind} tasks={data.tasks} doneCount={openGoal ? done(openGoal) : 0}
          lookup={data.lookup} toast={toast} onComplete={onComplete} onArchive={archive} onClose={() => setOpen(null)}
          onSaved={async (msg) => { if (!open.id) setOpen(null); await reload(); toast({ kind: 'ok', text: msg }) }}
          onTasksChanged={async (msg) => { await reload(); if (msg) toast({ kind: 'ok', text: msg }) }} />
      )}
    </section>
  )
}
