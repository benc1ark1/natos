'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { rows } from '@/lib/data'
import { expandEvents, isBackground, timeRange } from '@/lib/events'
import { targetProgress } from '@/lib/targets'
import { deadlineLabel, deadlineOf, sortByDate } from '@/lib/tasks'
import { addDays, dateISOOf, dowShort, shortDate, zonedToUTC } from '@/lib/time'
import { checkinRange } from '@/lib/ask/week'
import type { PlanItem, WeekPlan, WeekPlanResult } from '@/lib/ask/types'
import Select from '../controls/Select'
import { Empty, type ShowToast } from '../ui'
import type { HomeData } from './HomeView'

// Weekly check-in (my-spec section 40): look back, look ahead, pick 3 priorities, confirm a drafted week.
// Saves only on the buttons that say so. The week plan is a suggestion: it changes no tasks.

const day = (d: string) => `${dowShort(d)} ${shortDate(d)}`
const STEPS = ['Look back', 'Look ahead', 'Priorities', 'Your week']
type Done = { id: string; title: string; completed_at: string }

async function draftWeek(): Promise<WeekPlanResult> {
  try {
    const res = await fetch('/api/ask', { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'week' }) })
    const body = await res.json().catch(() => null)
    if (body && typeof body.ok === 'boolean') return body as WeekPlanResult
    return { ok: false, error: `Server replied ${res.status}.` }
  } catch {
    return { ok: false, error: 'Couldn’t reach the server.' }
  }
}

export default function CheckinSheet({ data, onClose, reload, toast }: { data: HomeData; onClose: () => void; reload: () => Promise<void>; toast: ShowToast }) {
  const range = checkinRange(data.today)
  const [step, setStep] = useState(0)
  const [done, setDone] = useState<Done[] | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>(() => Object.fromEntries(data.targets.filter((t) => t.counts_from === 'logs').map((t) => [t.id, t.target_count])))
  const [pri, setPri] = useState<string[]>(['', '', ''])
  const [plan, setPlan] = useState<WeekPlan | null>(null)
  const [planNotes, setPlanNotes] = useState<string[]>([])
  const [busy, setBusy] = useState<'' | 'counts' | 'pri' | 'draft' | 'save'>('')
  const [error, setError] = useState('')

  // Done this week, and any priorities already saved for the week being planned.
  useEffect(() => {
    const sb = getSupabase()
    Promise.all([
      sb.from('tasks').select('id,title,completed_at').eq('archive_reason', 'done').eq('is_system', false)
        .gte('completed_at', zonedToUTC(data.weekStart, '00:00')).order('completed_at'),
      sb.from('weekly_reviews').select('priorities,plan').eq('week_start', range.from >= addDays(data.weekStart, 7) ? range.from : data.weekStart).maybeSingle(),
    ]).then(([d, r]) => {
      try { setDone(rows<Done>(d, 'done tasks')) } catch (e) { setLoadErr(e instanceof Error ? e.message : 'Couldn’t load.') }
      if (r.data?.priorities?.length) setPri([0, 1, 2].map((i) => r.data!.priorities[i] ?? ''))
    })
  }, [data.weekStart, range.from])

  const reviewWeek = range.from >= addDays(data.weekStart, 7) ? range.from : data.weekStart

  // ---- look back
  const progress = data.targets.map((t) => ({ t, ...targetProgress(t, data) }))
  const overdue = sortByDate(data.tasks.filter((t) => { const d = deadlineOf(t); return d !== null && d < data.today }))
  const missedSessions = data.changes.filter((c) => c.missed && c.on_date >= data.weekStart && c.on_date <= data.today)
  const postponed = [...data.tasks].filter((t) => t.postpone_count > 0).sort((a, b) => b.postpone_count - a.postpone_count).slice(0, 3)

  // ---- look ahead
  const dueAhead = sortByDate(data.tasks.filter((t) => { const d = deadlineOf(t); return d !== null && d >= range.from && d <= range.to }))
  const testsAhead = data.goals.filter((g) => g.kind === 'test' && g.target_date && g.target_date <= range.to)
  const eventsAhead = expandEvents(data.events, range.from, range.to, data.changes).filter((o) => !o.cancelled && !isBackground(o.event))
  const suggestions = [...new Set([...data.goals.map((g) => g.title), ...dueAhead.filter((t) => t.importance === 'must').map((t) => t.title)])].slice(0, 6)

  async function saveCounts() {
    const changed = data.targets.filter((t) => counts[t.id] !== undefined && counts[t.id] !== t.target_count)
    if (changed.length === 0) return setStep(2)
    setBusy('counts'); setError('')
    const sb = getSupabase()
    for (const t of changed) {
      const { data: row, error: e } = await sb.from('weekly_targets').update({ target_count: counts[t.id] }).eq('id', t.id).select('id').single()
      if (e || !row) { setBusy(''); return setError(`${t.name} count not saved: ${e?.message ?? 'not saved'}`) }
    }
    setBusy('')
    await reload()
    toast({ kind: 'ok', text: `Saved ${changed.map((t) => `${t.name} ${counts[t.id]}`).join(', ')}.` })
    setStep(2)
  }

  async function savePriorities() {
    const list = pri.map((p) => p.trim()).filter(Boolean).slice(0, 3)
    setBusy('pri'); setError('')
    const { data: row, error: e } = await getSupabase().from('weekly_reviews')
      .upsert({ user_id: data.userId, week_start: reviewWeek, priorities: list }, { onConflict: 'user_id,week_start' }).select('id').single()
    setBusy('')
    if (e || !row) {
      const missing = e && /weekly_reviews/.test(e.message) && /(find|exist)/i.test(e.message)
      return setError(missing ? 'The check-in table isn’t set up yet: run supabase/step7-checkin.sql in Supabase first.' : `Priorities not saved: ${e?.message ?? 'not saved'}`)
    }
    toast({ kind: 'ok', text: list.length ? 'Priorities saved. Ask AI will use them all week.' : 'Saved with no priorities.' })
    setStep(3)
    draft()
  }

  async function draft() {
    setBusy('draft'); setError(''); setPlan(null)
    const res = await draftWeek()
    setBusy('')
    if (!res.ok) return setError(`Couldn’t draft the week: ${res.error}`)
    setPlan(res.plan); setPlanNotes(res.notes)
  }

  function removeItem(date: string, idx: number) {
    setPlan((p) => p && { ...p, days: p.days.map((d) => d.date === date ? { ...d, items: d.items.filter((_, i) => i !== idx) } : d) })
  }
  function moveItem(date: string, idx: number, to: string) {
    setPlan((p) => {
      if (!p || to === date) return p
      const item = p.days.find((d) => d.date === date)!.items[idx]
      return { ...p, days: p.days.map((d) => d.date === date ? { ...d, items: d.items.filter((_, i) => i !== idx) } : d.date === to ? { ...d, items: [...d.items, item] } : d) }
    })
  }

  async function confirmPlan() {
    if (!plan) return
    setBusy('save'); setError('')
    // nothing left in any day = no plan
    const stored = plan.days.every((d) => d.items.length === 0) ? null : { days:plan.days.map((d) => ({ date: d.date, items: d.items.map((i: PlanItem) => ({ kind: i.kind, id: i.id, title: i.title, minutes: i.minutes, focus: i.focus })) })), notes: plan.notes }
    const { data: row, error: e } = await getSupabase().from('weekly_reviews')
      .upsert({ user_id: data.userId, week_start: reviewWeek, priorities: pri.map((p) => p.trim()).filter(Boolean).slice(0, 3), plan: stored }, { onConflict: 'user_id,week_start' })
      .select('id').single()
    setBusy('')
    if (e || !row) return setError(`Plan not saved: ${e?.message ?? 'not saved'}`)
    toast({ kind: 'ok', text: 'Week plan saved. Ask AI will check it for “am I ahead or behind?”.' })
    onClose()
  }

  const dayOptions = plan?.days.map((d) => ({ value: d.date, label: day(d.date) })) ?? []

  return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ck-title">
        <div className="ckstep" aria-hidden="true">{STEPS.map((s, i) => <span key={s} className={i <= step ? 'on' : ''} />)}</div>
        <div className="lbl">Step {step + 1} of 4 · {range.from === data.today ? `rest of this week, to ${day(range.to)}` : `${day(range.from)} – ${day(range.to)}`}</div>
        <h2 id="ck-title" style={{ marginTop: 6 }}>{STEPS[step]}</h2>

        {step === 0 && (
          <div>
            {loadErr && <div className="err" role="alert">{loadErr}</div>}
            <div className="cksec">
              <span className="lbl">Done this week{done ? ` · ${done.length}` : ''}</span>
              {!done && !loadErr && <div className="state">Loading…</div>}
              {done && done.length === 0 && <Empty>No tasks ticked off this week yet.</Empty>}
              {done && done.length > 0 && <ul className="cklist">{done.slice(-6).reverse().map((t) => <li key={t.id}><span>{t.title}</span><span className="m">{day(dateISOOf(t.completed_at))}</span></li>)}</ul>}
            </div>
            <div className="cksec">
              <span className="lbl">Training</span>
              {progress.length === 0 ? <Empty>No weekly targets.</Empty> : (
                <ul className="cklist">{progress.map(({ t, done: d, target }) => <li key={t.id}><span>{t.name}</span><span className={d >= target ? 'ok' : 'm'}>{d}/{target}</span></li>)}</ul>
              )}
            </div>
            <div className="cksec">
              <span className="lbl">Missed</span>
              {overdue.length === 0 && missedSessions.length === 0 ? <Empty>Nothing missed.</Empty> : (
                <ul className="cklist">
                  {overdue.map((t) => <li key={t.id}><span>{t.title}</span><span className="m bad">{deadlineLabel(t, data.today)}</span></li>)}
                  {missedSessions.map((c) => <li key={c.id}><span>{data.events.find((e) => e.id === c.event_id)?.title ?? 'Session'}</span><span className="m">missed {day(c.on_date)}</span></li>)}
                </ul>
              )}
            </div>
            <div className="cksec">
              <span className="lbl">Most postponed</span>
              {postponed.length === 0 ? <Empty>Nothing postponed.</Empty> : (
                <ul className="cklist">{postponed.map((t) => <li key={t.id}><span>{t.title}</span><span className="m">{t.postpone_count}× postponed</span></li>)}</ul>
              )}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="cksec">
              <span className="lbl">Deadlines</span>
              {dueAhead.length === 0 ? <Empty>No deadlines in these days.</Empty> : (
                <ul className="cklist">{dueAhead.map((t) => <li key={t.id}><span>{t.title}</span><span className="m">{deadlineLabel(t, data.today)}</span></li>)}</ul>
              )}
            </div>
            <div className="cksec">
              <span className="lbl">Tests</span>
              {testsAhead.length === 0 ? <Empty>No tests.</Empty> : (
                <ul className="cklist">{testsAhead.map((g) => <li key={g.id}><span>{g.title}</span><span className="m">{day(g.target_date!)}</span></li>)}</ul>
              )}
            </div>
            <div className="cksec">
              <span className="lbl">Events</span>
              {eventsAhead.length === 0 ? <Empty>No events besides school.</Empty> : (
                <ul className="cklist">{eventsAhead.map((o) => <li key={o.key}><span>{o.event.title}</span><span className="m">{day(o.date)} {timeRange(o)}</span></li>)}</ul>
              )}
            </div>
            {Object.keys(counts).length > 0 && (
              <div className="cksec">
                <span className="lbl">Sessions per week (e.g. what your coach set)</span>
                <ul className="cklist">
                  {data.targets.filter((t) => counts[t.id] !== undefined).map((t) => (
                    <li key={t.id} style={{ alignItems: 'center' }}>
                      <span>{t.name}</span>
                      <span className="acts" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button className="btn sm" aria-label={`Fewer ${t.name}`} disabled={counts[t.id] <= 0} onClick={() => setCounts((c) => ({ ...c, [t.id]: c[t.id] - 1 }))}>−</button>
                        <span className="mono" style={{ minWidth: 22, textAlign: 'center' }}>{counts[t.id]}</span>
                        <button className="btn sm" aria-label={`More ${t.name}`} disabled={counts[t.id] >= 14} onClick={() => setCounts((c) => ({ ...c, [t.id]: c[t.id] + 1 }))}>+</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <p style={{ color: 'var(--muted)', marginTop: 0 }}>Your top 3 for the week. Ask AI uses them all week, after deadlines, tests and training.</p>
            <div className="formgrid">
              {pri.map((p, i) => (
                <label className="field full" key={i}><span>Priority {i + 1}</span>
                  <input className="input" value={p} maxLength={120} autoFocus={i === 0} onChange={(e) => setPri((x) => x.map((v, j) => (j === i ? e.target.value : v)))} />
                </label>
              ))}
            </div>
            {suggestions.length > 0 && (
              <div className="cksec">
                <span className="lbl">Ideas from your data</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {suggestions.map((s) => (
                    <button key={s} className="btn sm" disabled={pri.includes(s) || !pri.some((p) => !p.trim())}
                      onClick={() => setPri((x) => { const i = x.findIndex((v) => !v.trim()); return x.map((v, j) => (j === i ? s : v)) })}>{s}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div>
            {busy === 'draft' && <div className="state" role="status">Drafting your week around your calendar…</div>}
            {plan && (
              <>
                {plan.notes && <p style={{ color: 'var(--fg-2)', marginTop: 0 }}>{plan.notes}</p>}
                {planNotes.map((n) => <div key={n} className="askwhy">{n}</div>)}
                <div style={{ marginTop: 8 }}>
                  {plan.days.map((d) => (
                    <div className="ckday" key={d.date}>
                      <div className="lbl">{day(d.date)}</div>
                      {d.items.length === 0 && <div className="askwhy">Nothing planned (rest / free)</div>}
                      {d.items.map((it, i) => (
                        <div className="ckitem" key={`${it.id}${i}`}>
                          <span>{it.title}{it.focus && <span className="askfocus"> · {it.focus}</span>}{it.minutes && <span className="mono askmin"> — {it.minutes} min</span>}</span>
                          <span className="acts">
                            <Select ariaLabel={`Move ${it.title} to another day`} size="sm" value={d.date} options={dayOptions} onChange={(v) => moveItem(d.date, i, v)} />
                            <button className="btn sm ghost" aria-label={`Remove ${it.title}`} onClick={() => removeItem(d.date, i)}>✕</button>
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <p className="askwhy" style={{ marginTop: 12 }}>This is a plan, not a change: no tasks move. Adjust it, then confirm.</p>
              </>
            )}
          </div>
        )}

        {error && <div style={{ marginTop: 16 }}><div className="err" role="alert"><span>{error}</span>{step === 3 && !plan && <button className="btn sm" onClick={draft}>Try again</button>}</div></div>}

        <div className="modalfoot">
          {step > 0 && <button className="btn ghost" style={{ marginRight: 'auto' }} disabled={!!busy} onClick={() => { setError(''); setStep(step - 1) }}>Back</button>}
          <button className="btn ghost" disabled={busy === 'save'} onClick={onClose}>Close</button>
          {step === 0 && <button className="btn primary" onClick={() => setStep(1)}>Next</button>}
          {step === 1 && <button className="btn primary" disabled={!!busy} onClick={saveCounts}>{busy === 'counts' ? 'Saving…' : 'Next'}</button>}
          {step === 2 && <button className="btn primary" disabled={!!busy} onClick={savePriorities}>{busy === 'pri' ? 'Saving…' : 'Save & draft my week'}</button>}
          {step === 3 && plan && <button className="btn" disabled={!!busy} onClick={draft}>Redraft</button>}
          {step === 3 && plan && <button className="btn primary" disabled={!!busy} onClick={confirmPlan}>{busy === 'save' ? 'Saving…' : 'Confirm week'}</button>}
        </div>
      </div>
    </div>
  )
}
