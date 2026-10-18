'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { loadLookupRows, rows } from '@/lib/data'
import { expandEvents } from '@/lib/events'
import { loadProjects } from '@/lib/projects'
import { CAPTURE_KINDS, KIND_LABELS, type CaptureKind, type Duplicate, type Proposal } from '@/lib/capture/types'
import { activeSources } from '@/lib/lists'
import { usePlanning } from '@/lib/usePlanning'
import { loadStudy, type StudyData } from '@/lib/study-data'
import { stagesOf, topicState } from '@/lib/study'
import { TIMES_15, addDays, dowShort, shortDate, todayISO } from '@/lib/time'
import type { EventException, EventRow, Project, Subject, WeeklyTarget } from '@/lib/types'
import DatePicker from './controls/DatePicker'
import Select from './controls/Select'
import Toggle from './controls/Toggle'

type Opts = { subjects: Subject[]; projects: Project[]; targets: WeeklyTarget[]; events: EventRow[]; changes: EventException[]; study: StudyData }

async function loadOpts(): Promise<Opts> {
  const sb = getSupabase()
  const today = todayISO()
  const [lk, projects, targets, events, changes, study] = await Promise.all([
    loadLookupRows(sb), loadProjects(sb),
    sb.from('weekly_targets').select('*').eq('is_active', true).order('sort_order'),
    sb.from('events').select('*').is('archived_at', null).order('title'),
    sb.from('event_exceptions').select('*').gte('on_date', addDays(today, -7)),
    loadStudy(sb),
  ])
  return {
    subjects: lk.subjects, projects,
    targets: rows<WeeklyTarget>(targets, 'targets').filter((t) => t.counts_from !== 'events'),
    events: rows<EventRow>(events, 'events'), changes: rows<EventException>(changes, 'event changes'), study,
  }
}

type Props = {
  text: string
  proposal: Proposal
  duplicates: Duplicate[]
  busy: boolean
  error: string
  onConfirm: (p: Proposal, subjects: Subject[]) => void
  onInbox: () => void
  onCancel: () => void
}

const timeOptions = (v: string | null) => {
  const list = v && !TIMES_15.includes(v) ? [...TIMES_15, v].sort() : TIMES_15
  return [{ value: '', label: 'No time' }, ...list.map((t) => ({ value: t, label: t }))]
}

/** The AI's proposal as an editable card. Nothing is saved until Confirm. */
export default function CaptureCard({ text, proposal, duplicates, busy, error, onConfirm, onInbox, onCancel }: Props) {
  const planning = usePlanning()
  const [p, setP] = useState<Proposal>(proposal)
  const [opts, setOpts] = useState<Opts | null>(null)
  const [optsError, setOptsError] = useState('')
  const set = <K extends keyof Proposal>(k: K, v: Proposal[K]) => setP((s) => ({ ...s, [k]: v }))
  const today = todayISO()

  useEffect(() => { loadOpts().then(setOpts, (e) => setOptsError(e instanceof Error ? e.message : 'Couldn’t load the options.')) }, [])

  /** Picking another event: aim the change at its next session. */
  function pickEvent(id: string) {
    const ev = opts?.events.find((e) => e.id === id)
    const next = ev ? expandEvents([ev], today, addDays(today, 13), opts!.changes).find((o) => !o.cancelled) : undefined
    setP((s) => ({ ...s, event_id: id || null, event_on_date: next?.usualDate ?? null }))
  }

  const none = { value: '', label: 'None' }
  const subjectSelect = (
    <Select label="Subject" value={p.subject_id ?? ''} onChange={(v) => set('subject_id', v || null)} disabled={!opts} placeholder="Loading…"
      options={opts ? [none, ...opts.subjects.map((s) => ({ value: s.id, label: s.name }))] : []} />
  )
  const k = p.kind

  return (
    <div className="card ccard" role="region" aria-label="Check before saving">
      <div className="ccard-head">
        <span className="lbl">AI suggestion · nothing saved yet</span>
        <span className="ccard-src">“{text}”</span>
      </div>

      {duplicates.length > 0 && (
        <div className="cwarn" role="alert">
          <strong>Looks like a duplicate.</strong>
          {duplicates.map((d, i) => <div key={i}>{d.what}: “{d.title}”</div>)}
        </div>
      )}
      {p.notes.map((n, i) => <div key={i} className="cnote">{n}</div>)}

      <div className="ckinds" role="radiogroup" aria-label="What is it?">
        {CAPTURE_KINDS.map((x) => (
          <button key={x} type="button" role="radio" aria-checked={k === x} className={k === x ? 'on' : ''} onClick={() => set('kind', x as CaptureKind)}>
            {KIND_LABELS[x]}
          </button>
        ))}
      </div>

      <div className="formgrid">
        {optsError && <div className="err full" role="alert">{optsError}</div>}
        {k !== 'fact' && (
          <label className="field full"><span>{k === 'reminder' ? 'Remember' : k === 'goal_progress' || k === 'study' ? 'Note' : k === 'mistake' ? 'The mistake' : 'Title'}</span>
            <input className="input" value={p.title} onChange={(e) => set('title', e.target.value)} maxLength={200} />
          </label>
        )}

        {k === 'task' && <>
          {subjectSelect}
          <div className="field"><span>Must or nice</span>
            <div className="seg2">
              <button type="button" className={p.importance === 'must' ? 'on' : ''} onClick={() => set('importance', 'must')}>Must</button>
              <button type="button" className={p.importance === 'nice' ? 'on' : ''} onClick={() => set('importance', 'nice')}>Nice</button>
            </div>
          </div>
          <DatePicker label="Due date" value={p.due ?? ''} onChange={(v) => set('due', v || null)} />
          <label className="field"><span>Rough minutes</span>
            <input className="input" type="number" inputMode="numeric" min={1} value={p.duration_minutes ?? ''}
              onChange={(e) => set('duration_minutes', e.target.value ? Math.max(1, Math.round(Number(e.target.value))) : null)} />
          </label>
          <label className="field"><span>Or a window (e.g. this weekend)</span>
            <input className="input" value={p.window_label ?? ''} onChange={(e) => set('window_label', e.target.value || null)} />
          </label>
          <DatePicker label="Window ends (last OK day)" value={p.window_end ?? ''} onChange={(v) => set('window_end', v || null)} />
          <Select label="Where it came from" value={p.origin} onChange={(v) => set('origin', v as Proposal['origin'])}
            options={activeSources(planning, p.origin).map((x) => ({ value: x.key, label: x.label }))} />
          <Select label="Project" value={p.project_id ?? ''} onChange={(v) => set('project_id', v || null)} disabled={!opts} placeholder="Loading…"
            options={opts ? [none, ...opts.projects.map((x) => ({ value: x.id, label: x.name }))] : []} />
          <label className="field full"><span>Hand in how/where</span>
            <input className="input" value={p.hand_in ?? ''} onChange={(e) => set('hand_in', e.target.value || null)} maxLength={120} />
          </label>
        </>}

        {k === 'idea' && <>
          {subjectSelect}
          <div className="field moretoggle"><Toggle checked={p.someday} onChange={(v) => set('someday', v)} label="Someday (not Inbox)" /></div>
        </>}

        {k === 'test' && <>
          {subjectSelect}
          <DatePicker label="Test date" value={p.test_date ?? ''} onChange={(v) => set('test_date', v || null)} />
          <Select label="Priority" value={p.priority} onChange={(v) => set('priority', v as Proposal['priority'])}
            options={[{ value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }, { value: 'low', label: 'Low' }]} />
          <label className="field"><span>Topics</span>
            <input className="input" value={p.topics ?? ''} onChange={(e) => set('topics', e.target.value || null)} />
          </label>
        </>}

        {k === 'reminder' && <>
          <Select label="When" value={p.reminder_kind} onChange={(v) => set('reminder_kind', v as Proposal['reminder_kind'])}
            options={[{ value: 'day', label: 'On a day' }, { value: 'time', label: 'At a time' }, { value: 'person', label: 'When I see someone' }]} />
          {p.reminder_kind === 'person'
            ? <label className="field"><span>Person</span><input className="input" value={p.person ?? ''} onChange={(e) => set('person', e.target.value || null)} /></label>
            : <DatePicker label="Day" value={p.remind_day ?? ''} onChange={(v) => set('remind_day', v || null)} />}
          {p.reminder_kind === 'time' && (
            <Select label="Time" value={p.remind_time ?? ''} onChange={(v) => set('remind_time', v || null)} options={timeOptions(p.remind_time)} />
          )}
        </>}

        {k === 'goal_progress' && <>
          <Select label="Counts toward" value={p.target_id ?? ''} onChange={(v) => set('target_id', v || null)} disabled={!opts} placeholder="Loading…"
            options={opts ? [{ value: '', label: 'Pick a target' }, ...opts.targets.map((t) => ({ value: t.id, label: t.name }))] : []} />
          <label className="field"><span>Sessions</span>
            <input className="input" type="number" min={1} max={9} value={p.amount} onChange={(e) => set('amount', Math.min(9, Math.max(1, Number(e.target.value) || 1)))} />
          </label>
          <DatePicker label="Done on" value={p.done_on} onChange={(v) => set('done_on', v || today)} />
        </>}

        {k === 'event_change' && <>
          <Select label="Event" value={p.event_id ?? ''} onChange={pickEvent} disabled={!opts} placeholder="Loading…"
            options={opts ? [{ value: '', label: 'Pick an event' }, ...opts.events.map((e) => ({ value: e.id, label: e.title }))] : []} />
          <div className="field"><span>Change</span>
            <div className="seg2">
              <button type="button" className={p.event_scope === 'week' ? 'on' : ''} onClick={() => set('event_scope', 'week')}>Just this week</button>
              <button type="button" className={p.event_scope === 'every' ? 'on' : ''} onClick={() => set('event_scope', 'every')}>Every week</button>
            </div>
          </div>
          {p.event_on_date && <div className="field full cnote">Session affected: {dowShort(p.event_on_date)} {shortDate(p.event_on_date)}</div>}
          <div className="field full moretoggle"><Toggle checked={p.cancel} onChange={(v) => set('cancel', v)} label={p.event_scope === 'every' ? 'Delete it (every week)' : 'Cancel this session'} /></div>
          {!p.cancel && <>
            <DatePicker label="New day" value={p.new_date ?? ''} onChange={(v) => set('new_date', v || null)} />
            <Select label="New start" value={p.new_start ?? ''} onChange={(v) => set('new_start', v || null)} options={timeOptions(p.new_start)} />
            <Select label="New end" value={p.new_end ?? ''} onChange={(v) => set('new_end', v || null)} options={timeOptions(p.new_end)} />
          </>}
        </>}

        {k === 'resource' && <>
          <label className="field full"><span>Link</span>
            <input className="input" inputMode="url" value={p.url ?? ''} onChange={(e) => set('url', e.target.value || null)} placeholder="https://…" />
          </label>
          <Select label="Kind" value={p.resource_kind} onChange={(v) => set('resource_kind', v as Proposal['resource_kind'])}
            options={['link', 'video', 'goodnotes', 'book', 'article', 'drill', 'other'].map((x) => ({ value: x, label: x[0].toUpperCase() + x.slice(1) }))} />
          {subjectSelect}
        </>}

        {(k === 'study' || k === 'mistake') && <>
          {subjectSelect}
          <Select label="Topic" value={p.topic_id ?? ''} disabled={!opts} placeholder="Loading…"
            onChange={(v) => {
              const t = opts?.study.topics.find((x) => x.id === v)
              // a topic picks its subject, and (study) its next stage
              setP((s) => ({ ...s, topic_id: v || null, subject_id: t?.subject_id ?? s.subject_id, stage_id: k === 'study' && t && opts ? topicState(t, opts.study.stages, opts.study.progress).next?.id ?? null : s.stage_id }))
            }}
            options={opts ? [{ value: '', label: k === 'study' ? 'Pick a topic' : 'None' }, ...opts.study.topics.filter((t) => !t.archived_at && (!p.subject_id || t.subject_id === p.subject_id)).map((t) => ({ value: t.id, label: t.name }))] : []} />
          {k === 'study' && (() => {
            const topic = opts?.study.topics.find((t) => t.id === p.topic_id)
            const stages = topic && opts ? stagesOf(opts.study.stages, topic.subject_id) : []
            return <Select label="Stage done" value={p.stage_id ?? ''} onChange={(v) => set('stage_id', v || null)} disabled={!topic}
              options={[{ value: '', label: topic ? 'Pick a stage' : 'Pick a topic first' }, ...stages.map((x, i) => ({ value: x.id, label: `${i + 1}. ${x.name}` }))]} />
          })()}
          {opts && !opts.study.topics.length && <p className="usub full" style={{ margin: 0 }}>No topics yet: add them on a subject’s page (Subjects).</p>}
        </>}

        {k === 'fact' && (
          <label className="field full"><span>Fact about me</span>
            <textarea className="textarea" value={p.fact ?? p.title} onChange={(e) => set('fact', e.target.value)} maxLength={500} />
          </label>
        )}
      </div>

      {p.reasoning && <p className="cwhy">Why: {p.reasoning}</p>}
      {error && <div className="err" role="alert">{error}</div>}
      <div className="gactions">
        <button className="btn primary" disabled={busy} onClick={() => onConfirm(p, opts?.subjects ?? [])}>{busy ? 'Saving…' : 'Confirm'}</button>
        <button className="btn" disabled={busy} onClick={onInbox}>Just save to Inbox</button>
        <button className="btn ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
