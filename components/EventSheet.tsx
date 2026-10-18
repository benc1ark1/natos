'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { isFromGoogle, isRepeating, restoreChange, saveChange, setEventArchived, timeRange, type Occurrence } from '@/lib/events'
import type { Lookup } from '@/lib/lookup'
import { hasEnded } from '@/lib/targets'
import type { WeeklyTarget } from '@/lib/types'
import { TIMES_15, addDays, minutesOf, dowShort, isoDow, shortDate, todayISO, weekStartISO, zonedToUTC } from '@/lib/time'
import DatePicker from './controls/DatePicker'
import TrainingTypeFields, { useTrainingType } from './controls/TrainingType'
import Select, { type Option } from './controls/Select'
import Toggle from './controls/Toggle'
import type { ShowToast } from './ui'

type Props = {
  occ: Occurrence | null   // null = new event
  lookup: Lookup
  targets: WeeklyTarget[]  // active weekly targets (ones that count calendar sessions can be linked)
  userId: string
  onChanged: () => Promise<void>
  toast: ShowToast
  onClose: () => void
}

/** Keep the same length when the start moves: 16:00–17:30 -> 18:00–19:30 (capped at 23:59). */
function shiftEnd(oldStart: string, newStart: string, end: string): string {
  if (!end || !oldStart) return end
  const m = Math.min(23 * 60 + 59, minutesOf(end) - minutesOf(oldStart) + minutesOf(newStart))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** 15-minute steps (after `after`, for end times), plus the current value if it isn't on one (e.g. school 08:40). */
const timeOptions = (current: string, none?: string, after = ''): Option[] => {
  const list = (current && !TIMES_15.includes(current) ? [...TIMES_15, current].sort() : TIMES_15)
    .filter((t) => t > after || t === current)
  return [...(none ? [{ value: '', label: none }] : []), ...list.map((t) => ({ value: t, label: t }))]
}

/** Add or edit an event. A repeating one can be changed "just this week" or "every week". */
export default function EventSheet({ occ, lookup, targets, userId, onChanged, toast, onClose }: Props) {
  const ev = occ?.event ?? null
  const repeating = !!ev && isRepeating(ev)
  const today = todayISO()
  const [scope, setScope] = useState<'week' | 'all'>(repeating ? 'week' : 'all')

  // every-week (or one-off) fields
  const [title, setTitle] = useState(ev?.title ?? '')
  const training = useTrainingType(ev ? { name: ev.title, training_type: ev.training_type, load: ev.load } : null)
  const [areaId, setAreaId] = useState(ev?.category_id ?? '')
  const [subjectId, setSubjectId] = useState(ev?.subject_id ?? '')
  const [place, setPlace] = useState(ev?.location ?? '')
  const [weekly, setWeekly] = useState(repeating)
  const [date, setDate] = useState(occ?.usualDate ?? today)
  const [days, setDays] = useState<number[]>(ev?.repeat_days ?? [isoDow(today)])
  const usualStart = repeating ? ev!.start_time!.slice(0, 5) : occ?.start ?? ''
  const usualEnd = repeating ? (ev!.end_time?.slice(0, 5) ?? '') : occ?.end ?? ''
  const [start, setStart] = useState(usualStart || '16:00')
  const [end, setEnd] = useState(usualEnd)
  const [travel, setTravel] = useState(ev?.travel_minutes ? String(ev.travel_minutes) : '')
  const calTargets = targets.filter((t) => t.counts_from === 'events' || t.id === ev?.target_id)
  const [targetId, setTargetId] = useState(ev?.target_id ?? '')
  // school: sets school nights and "after school"; not set = guessed (anything repeating most weekdays)
  const [school, setSchool] = useState(typeof ev?.is_school === 'boolean' ? (ev.is_school ? 'yes' : 'no') : '')
  const [inGoogle, setInGoogle] = useState(ev?.sync_google !== false)   // shown in his Life OS Google calendar
  const linkedTarget = ev?.target_id ? targets.find((t) => t.id === ev.target_id) : undefined

  // just-this-week fields (start from where it is now, moved or not)
  const [wDate, setWDate] = useState(occ?.date ?? today)
  const [wStart, setWStart] = useState(occ?.start ?? '')
  const [wEnd, setWEnd] = useState(occ?.end ?? '')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const sb = getSupabase()
  const weekDays = occ ? Array.from({ length: 7 }, (_, i) => addDays(weekStartISO(occ.usualDate), i)) : []
  const undo = (run: () => Promise<string | null>) => ({
    label: 'Undo', run: async () => { const e = await run(); if (e) toast({ kind: 'error', text: e }); await onChanged() },
  })

  async function saveAll(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Give the event a name.')
    if (weekly && days.length === 0) return setError('Pick at least one day.')
    if (!weekly && !date) return setError('Pick a date.')
    if (end && end <= start) return setError('The end time must be after the start.')
    const t = travel.trim() ? Number(travel) : 0
    if (!Number.isInteger(t) || t < 0 || t > 240) return setError('Travel must be a whole number of minutes, 0 to 240.')
    const values = {
      title: title.trim().slice(0, 120),
      category_id: areaId || null,
      subject_id: subjectId || null,
      location: place.trim().slice(0, 120) || null,
      travel_minutes: t,
      target_id: targetId || null,
      is_school: school === '' ? null : school === 'yes',
      sync_google: inGoogle,
      ...training.values(),
      ...(weekly
        ? { repeat_days: [...days].sort(), start_time: start, end_time: end || null, starts_at: null, ends_at: null }
        : { starts_at: zonedToUTC(date, start), ends_at: end ? zonedToUTC(date, end) : null, repeat_days: null, start_time: null, end_time: null }),
    }
    setSaving(true)
    setError('')
    const { data, error: err } = ev
      ? await sb.from('events').update(values).eq('id', ev.id).select('id').single()
      : await sb.from('events').insert({ ...values, user_id: userId }).select('id').single()
    setSaving(false)
    if (err || !data) return setError(`Not saved: ${err?.message ?? 'unknown error'}. Your changes are still here.`)
    await onChanged()
    onClose()
    toast({ kind: 'ok', text: ev ? `Saved “${values.title}”${weekly ? ' for every week' : ''}.` : `Added “${values.title}”.` })
  }

  async function saveWeek(e: React.FormEvent) {
    e.preventDefault()
    if (!occ) return
    if (wEnd && wEnd <= wStart) return setError('The end time must be after the start.')
    // only store what differs from the usual day and times
    const fields = {
      cancelled: false,
      new_date: wDate !== occ.usualDate ? wDate : null,
      new_start: wStart !== usualStart ? wStart : null,
      new_end: wEnd !== usualEnd ? wEnd || null : null,
    }
    setSaving(true)
    setError('')
    const err = await saveChange(sb, userId, occ, fields)
    setSaving(false)
    if (err) return setError(`${err}. Your changes are still here.`)
    await onChanged()
    onClose()
    const back = !fields.new_date && !fields.new_start && !fields.new_end
    toast({
      kind: 'ok', text: back ? `${occ.event.title} is back to its usual time this week.` : `${occ.event.title} moved to ${dowShort(wDate)} ${wStart} this week only.`,
      action: undo(() => restoreChange(sb, userId, occ)),
    })
  }

  async function setCancelled(cancelled: boolean) {
    if (!occ) return
    setSaving(true)
    const err = await saveChange(sb, userId, occ, { cancelled, new_date: null, new_start: null, new_end: null })
    setSaving(false)
    if (err) return setError(err)
    await onChanged()
    onClose()
    toast({
      kind: 'ok', text: cancelled ? `${occ.event.title} cancelled for ${dowShort(occ.usualDate)} ${shortDate(occ.usualDate)} only.` : `${occ.event.title} is back on this week.`,
      action: undo(() => restoreChange(sb, userId, occ)),
    })
  }

  async function setMissed(missed: boolean) {
    if (!occ) return
    setSaving(true)
    const err = await saveChange(sb, userId, occ, { missed })
    setSaving(false)
    if (err) return setError(err)
    await onChanged()
    onClose()
    toast({
      kind: 'ok', text: missed ? `Marked missed: ${occ.event.title}, ${dowShort(occ.date)}. It won't count.` : `${occ.event.title}, ${dowShort(occ.date)} counts again.`,
      action: undo(() => restoreChange(sb, userId, occ)),
    })
  }

  async function archive() {
    if (!ev) return
    setSaving(true)
    const err = await setEventArchived(sb, ev, true)
    setSaving(false)
    if (err) return setError(err)
    await onChanged()
    onClose()
    toast({ kind: 'ok', text: `Deleted “${ev.title}”${repeating ? ' (every week)' : ''}.`, action: undo(() => setEventArchived(sb, ev, false)) })
  }

  const subjects = lookup.subjects.filter((s) => !areaId || s.category_id === areaId)

  // the week's game from his set-up (Settings → Week rhythm, or "game is Saturday this week" in the bot)
  if (ev && ev.external_source === 'setup') return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ev-title">
        <h2 id="ev-title">{ev.title}</h2>
        {occ && <p className="usub" style={{ margin: '0 0 12px' }}>{dowShort(occ.date)} {shortDate(occ.date)}{occ.start ? `, ${timeRange(occ)}` : ''}</p>}
        <p style={{ margin: '0 0 8px' }}>This week’s game, from your usual game day (Settings → Week rhythm). Tell the bot if it moves: “game is Saturday this week, leave 9”, or “no game this week”.</p>
        <p className="usub" style={{ margin: 0 }}>Game day is max load: the planner protects the day before and after.</p>
        <div className="modalfoot"><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )

  // a copy of an event from one of his Google calendars: read-only here (my-spec: never edit calendars outside Life OS)
  if (ev && isFromGoogle(ev)) return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ev-title">
        <h2 id="ev-title">{ev.title}</h2>
        {occ && <p className="usub" style={{ margin: '0 0 12px' }}>{dowShort(occ.date)} {shortDate(occ.date)}{occ.start ? `, ${timeRange(occ)}` : ', all day'}{ev.location ? ` · ${ev.location}` : ''}</p>}
        <p style={{ margin: '0 0 8px' }}>From your Google Calendar, so it’s read-only here: change it in Google Calendar and the app follows within 15 minutes.</p>
        <p className="usub" style={{ margin: 0 }}>{ev.is_busy ? 'It counts as busy time when the app plans.' : 'It doesn’t count as busy time.'}{ev.is_school ? ' It’s from your school calendar.' : ''}</p>
        <div className="modalfoot"><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )

  return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ev-title">
        <h2 id="ev-title">{ev ? ev.title : 'New event'}</h2>

        {/* a past training session: counts automatically unless marked missed */}
        {occ && linkedTarget && linkedTarget.counts_from === 'events' && !occ.cancelled && hasEnded(occ, today) && (
          <div className="evmissed">
            <span className="usub">{occ.missed ? `Missed ${dowShort(occ.date)}. Not counted toward ${linkedTarget.name}.` : `Counted toward ${linkedTarget.name}.`}</span>
            <button type="button" className={`btn sm ${occ.missed ? '' : 'danger'}`} disabled={saving} onClick={() => setMissed(!occ.missed)}>
              {occ.missed ? 'I went' : 'Missed'}
            </button>
          </div>
        )}

        {repeating && (
          <div className="radios" role="radiogroup" aria-label="Change" style={{ marginBottom: 18 }}>
            <label className="radio"><input type="radio" name="evscope" checked={scope === 'week'} onChange={() => { setScope('week'); setError('') }} />Just this week</label>
            <label className="radio"><input type="radio" name="evscope" checked={scope === 'all'} onChange={() => { setScope('all'); setError('') }} />Every week</label>
          </div>
        )}

        {scope === 'week' && occ ? (
          <form onSubmit={saveWeek}>
            <p className="usub" style={{ margin: '0 0 14px' }}>
              Usually {dowShort(occ.usualDate)} {shortDate(occ.usualDate)}{usualStart ? `, ${usualStart}${usualEnd ? `–${usualEnd}` : ''}` : ''}.
              {occ.cancelled ? ' Cancelled this week.' : occ.moved ? ' Moved this week.' : ''}
            </p>
            {!occ.cancelled && (
              <div className="formgrid">
                <div className="full">
                  <Select label="Day" value={wDate} onChange={setWDate}
                    options={weekDays.map((d) => ({ value: d, label: `${dowShort(d)} ${shortDate(d)}` }))} />
                </div>
                <Select label="Start" value={wStart} onChange={(v) => { setWEnd(shiftEnd(wStart, v, wEnd)); setWStart(v) }} options={timeOptions(wStart)} />
                <Select label="End" value={wEnd} onChange={setWEnd} options={timeOptions(wEnd, 'No end time', wStart)} />
              </div>
            )}
            {error && <div style={{ marginTop: 16 }}><div className="err" role="alert">{error}</div></div>}
            <div className="modalfoot">
              {occ.cancelled
                ? <button type="button" className="btn" style={{ marginRight: 'auto' }} disabled={saving} onClick={() => setCancelled(false)}>Restore this week</button>
                : <button type="button" className="btn danger" style={{ marginRight: 'auto' }} disabled={saving} onClick={() => setCancelled(true)}>Cancel this week</button>}
              <button type="button" className="btn ghost" onClick={onClose}>Close</button>
              {!occ.cancelled && <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save this week'}</button>}
            </div>
          </form>
        ) : (
          <form onSubmit={saveAll}>
            <div className="formgrid">
              <label className="field full"><span>Name</span>
                <input className="input" value={title} onChange={(e) => { setTitle(e.target.value); training.renamed(e.target.value) }} autoFocus={!ev} maxLength={120} placeholder="Club football" />
              </label>
              <TrainingTypeFields name={title} state={training} />
              <Select label="Area" value={areaId} onChange={(v) => { setAreaId(v); setSubjectId('') }}
                options={[{ value: '', label: 'None' }, ...lookup.categories.map((c) => ({ value: c.id, label: c.name }))]} />
              <Select label="Subject" value={subjectId} onChange={setSubjectId}
                options={[{ value: '', label: 'None' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]} />
              <label className="field full"><span>Place (optional)</span>
                <input className="input" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={120} placeholder="Club ground" />
              </label>
              <div className="field full"><span>Repeats</span>
                <div className="radios" role="radiogroup" aria-label="Repeats">
                  <label className="radio"><input type="radio" name="evrep" checked={!weekly} onChange={() => setWeekly(false)} />One-off</label>
                  <label className="radio"><input type="radio" name="evrep" checked={weekly} onChange={() => setWeekly(true)} />Every week</label>
                </div>
              </div>
              {weekly ? (
                <div className="field full"><span>Days</span>
                  <div className="daypick">
                    {DAYS.map((d, i) => {
                      const on = days.includes(i + 1)
                      return <button key={d} type="button" aria-pressed={on} className={on ? 'on' : ''}
                        onClick={() => setDays(on ? days.filter((x) => x !== i + 1) : [...days, i + 1])}>{d}</button>
                    })}
                  </div>
                </div>
              ) : (
                <div className="full"><DatePicker label="Date" value={date} onChange={setDate} placeholder="Pick a date" /></div>
              )}
              <Select label="Start" value={start} onChange={(v) => { setEnd(shiftEnd(start, v, end)); setStart(v) }} options={timeOptions(start)} />
              <Select label="End" value={end} onChange={setEnd} options={timeOptions(end, 'No end time', start)} />
              <label className="field"><span>Travel (min each way)</span>
                <input className="input" type="number" inputMode="numeric" min={0} max={240} value={travel} onChange={(e) => setTravel(e.target.value)} placeholder="0" />
              </label>
              {calTargets.length > 0 && (
                <Select label="Counts toward" value={targetId} onChange={setTargetId}
                  options={[{ value: '', label: 'Nothing' }, ...calTargets.map((t) => ({ value: t.id, label: t.name }))]} />
              )}
              <div className="full"><Toggle checked={inGoogle} onChange={setInGoogle} label="Also in my Life OS Google calendar" /></div>
              <Select label="School?" value={school} onChange={setSchool}
                options={[{ value: '', label: weekly && days.length >= 5 ? 'Guess: yes (most weekdays)' : 'Guess: no' }, { value: 'yes', label: 'Yes: school nights, “after school”' }, { value: 'no', label: 'No' }]} />
            </div>
            {error && <div style={{ marginTop: 16 }}><div className="err" role="alert">{error}</div></div>}
            <div className="modalfoot">
              {ev && <button type="button" className="btn danger" style={{ marginRight: 'auto' }} disabled={saving} onClick={archive}>{repeating ? 'Delete (every week)' : 'Delete'}</button>}
              <button type="button" className="btn ghost" onClick={onClose}>{ev ? 'Close' : 'Cancel'}</button>
              <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : ev ? (repeating ? 'Save every week' : 'Save') : 'Add event'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
