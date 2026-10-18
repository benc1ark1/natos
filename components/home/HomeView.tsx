'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { completeTask, undoComplete, getUserId, loadLookupRows, loadOpenTasks, rows } from '@/lib/data'
import { makeLookup } from '@/lib/lookup'
import { addDays, greetingFor, longDate, timeOf, todayISO, tzAbbrev, weekStartISO, zonedParts, zonedToUTC } from '@/lib/time'
import { loadWeekCounts } from '@/lib/targets'
import { loadPlan } from '@/lib/plan'
import type { EventException, EventRow, Habit, Profile, Task, TargetLog, WeeklyTarget } from '@/lib/types'
import { useNow } from '@/lib/useNow'
import CaptureBox from '../CaptureBox'
import TaskForm from '../TaskForm'
import { ErrorBox, Loading, useLoad, useToast } from '../ui'
import TodayCard from './TodayCard'
import UpcomingCard from './UpcomingCard'
import WeekCard from './WeekCard'
import CalendarCard from './CalendarCard'
import RoutinesLink from './RoutinesLink'
import RemindersLine from './RemindersLine'
import GoalsCard from './GoalsCard'
import { loadActiveGoals } from '@/lib/goals'
import AskCard from './AskCard'
import RecoveryCard from './RecoveryCard'
import InsightsCard from './InsightsCard'
import StudyCard from './StudyCard'
import { loadStudy } from '@/lib/study-data'
import { planningEvents } from '@/lib/setup'

/** One Whoop day (lib/whoop/sync.ts has the server side). */
type WhoopDay = { on_date: string; recovery: number | null; hrv: number | null; resting_hr: number | null; sleep_minutes: number | null; sleep_performance: number | null; strain: number | null }
import CheckinSheet from './CheckinSheet'
import { isoDow } from '@/lib/time'
import { checkinDow } from '@/lib/settings'

export type HomeData = Awaited<ReturnType<typeof loadHome>>
export type GoalStats = { done: number; sessions: number; sessionsDone: number }

async function loadHome() {
  const sb = getSupabase()
  const today = todayISO()
  const weekStart = weekStartISO(today)
  const [userId, lk, tasks, prof, targets, logs, events, changes, habits, goals, goalDone, doneToday, weekCounts, plan, whoop, study] = await Promise.all([
    getUserId(sb),
    loadLookupRows(sb),
    loadOpenTasks(sb),
    sb.from('profiles').select('user_id,display_name,timezone,planning').maybeSingle(),
    sb.from('weekly_targets').select('*').eq('is_active', true).order('sort_order'),
    sb.from('target_logs').select('id,target_id,done_on,amount,source,created_at').gte('done_on', weekStart).lte('done_on', addDays(weekStart, 6)),
    sb.from('events').select('*').is('archived_at', null),
    // one-week changes from last week to 3 weeks ahead (covers this week + Upcoming's 14 days)
    sb.from('event_exceptions').select('id,event_id,on_date,cancelled,new_date,new_start,new_end,missed')
      .gte('on_date', addDays(weekStart, -7)).lte('on_date', addDays(today, 21)),
    sb.from('habits').select('id,name,is_active,sort_order,days_of_week').eq('is_active', true),
    loadActiveGoals(sb, today),
    // finished tasks per goal, and every prep session (open or not) per test
    sb.from('tasks').select('goal_id,is_system,archive_reason,archived_at').not('goal_id', 'is', null)
      .or('is_system.eq.true,archived_at.not.is.null'),
    // "3 done today"
    sb.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'completed').gte('completed_at', zonedToUTC(today, '00:00')),
    loadWeekCounts(sb, weekStart),   // one-week target numbers ("coach set 3 lower this week")
    loadPlan(sb, today),             // today's plan, if he applied one in Telegram
    // Whoop, the last 7 days (none before it's connected, or before its SQL has run)
    sb.from('whoop_days').select('on_date,recovery,hrv,resting_hr,sleep_minutes,sleep_performance,strain').gte('on_date', addDays(today, -6)).order('on_date')
      .then((r) => (r.error ? [] : (r.data ?? []) as WhoopDay[])),
    loadStudy(sb).catch(() => ({ stages: [], topics: [], progress: [], mistakes: [] })),   // study pipelines (step 12)
  ])
  if (doneToday.error) throw new Error(`Couldn't count today's done tasks: ${doneToday.error.message}`)
  // "2/5 tasks" for goals; "1/4 sessions" for tests (expired leftovers don't count)
  const goalStats: Record<string, GoalStats> = {}
  type R = { goal_id: string; is_system: boolean; archive_reason: string | null; archived_at: string | null }
  for (const r of rows<R>(goalDone, 'goal progress')) {
    const g = (goalStats[r.goal_id] ??= { done: 0, sessions: 0, sessionsDone: 0 })
    if (!r.is_system) g.done++
    else if (r.archive_reason !== 'expired') { g.sessions++; if (r.archive_reason === 'done') g.sessionsDone++ }
  }
  if (prof.error) throw new Error(`Couldn't load your profile: ${prof.error.message}`)
  return {
    userId,
    today,
    weekStart,
    lookup: makeLookup(lk.categories, lk.subjects),
    tasks,
    profile: prof.data as Profile | null,
    planning: (prof.data as { planning?: unknown } | null)?.planning ?? null,   // his settings (lib/settings.ts)
    targets: rows<WeeklyTarget>(targets, 'weekly targets'),
    logs: rows<TargetLog>(logs, 'target progress'),
    weekCounts,
    plan,
    // read-only sessions he asked the app to ignore are left out; this week's game (his set-up) is shown
    events: planningEvents(rows<EventRow>(events, 'events'), rows<EventException>(changes, 'calendar changes'), (prof.data as { planning?: unknown } | null)?.planning ?? null, addDays(weekStart, -7), addDays(today, 28)),
    changes: rows<EventException>(changes, 'calendar changes'),
    habits: rows<Habit>(habits, 'routines'),
    goals,
    goalStats,
    doneToday: doneToday.count ?? 0,
    whoop,
    study,
  }
}

export default function HomeView() {
  const { data, error, loading, reload } = useLoad(loadHome)
  const toast = useToast()
  const now = useNow()
  const [editing, setEditing] = useState<Task | null>(null)
  const [checkin, setCheckin] = useState(false)

  const hour = now ? zonedParts(now).hh : 12
  const name = data?.profile?.display_name ?? ''

  async function complete(t: Task) {
    if (!data) return
    const sb = getSupabase()
    const { error: err } = await completeTask(sb, t)
    await reload()
    if (err) { toast.show({ kind: 'error', text: err }); return }
    toast.show({
      kind: 'ok', text: `Archived “${t.title}”.`,
      action: {
        label: 'Undo', run: async () => {
          const e = await undoComplete(sb, t)
          if (e) toast.show({ kind: 'error', text: e })
          else { toast.show({ kind: 'ok', text: 'Put back.' }); reload() }
        },
      },
    })
  }

  return (
    <div className="grid">
      <section className="card s12 sess" aria-label="Greeting and capture">
        <div>
          <h1 className="greet serif">{greetingFor(hour)}{name ? <>, <em>{name}.</em></> : '.'}</h1>
          <div className="lbl" style={{ marginTop: 10 }}>{longDate(todayISO())}</div>
        </div>
        <div className="clock">
          <div className="time mono">{now ? timeOf(now) : ' '}</div>
          <div className="lbl">London · {now ? tzAbbrev() : ''}</div>
        </div>
        <CaptureBox onSaved={() => reload()} />
      </section>

      <RemindersLine toast={toast.show} />

      {error && <div className="s12"><ErrorBox message={error} onRetry={reload} /></div>}

      {!data && loading && (
        <>
          <section className="card s7"><Loading lines={5} /></section>
          <section className="card s5"><Loading lines={5} /></section>
        </>
      )}

      {data && (
        <>
          <TodayCard data={data} onComplete={complete} onEdit={setEditing} />
          <div className="s5 col">
            <UpcomingCard data={data} />
            <GoalsCard data={data} reload={reload} toast={toast.show} onComplete={complete} />
            <StudyCard data={data} reload={reload} toast={toast.show} />
            <RecoveryCard data={data} />
            <InsightsCard toast={toast.show} reloadHome={reload} />
            <WeekCard data={data} reload={reload} toast={toast.show} />
            <RoutinesLink data={data} />
          </div>
          <CalendarCard data={data} now={now} reload={reload} toast={toast.show} />
          <AskCard reload={reload} toast={toast.show} onCheckin={() => setCheckin(true)} checkinDay={isoDow(data.today) === checkinDow(data.planning)} />
        </>
      )}

      {editing && data && (
        <TaskForm task={editing} lookup={data.lookup} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); toast.show({ kind: 'ok', text: 'Saved.' }); reload() }} />
      )}
      {checkin && data && <CheckinSheet data={data} onClose={() => setCheckin(false)} reload={reload} toast={toast.show} />}
      {toast.node}
    </div>
  )
}
