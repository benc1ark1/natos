'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { dayOf } from '@/lib/reminders'
import { TIMES_15, timeOf, todayISO, zonedParts, zonedToUTC } from '@/lib/time'
import type { Reminder, ReminderKind } from '@/lib/types'
import DatePicker from './controls/DatePicker'
import Select from './controls/Select'

type Props = { reminder?: Reminder | null; onSaved: () => void; onClose: () => void }

const pad = (n: number) => String(n).padStart(2, '0')

function nextHour(): string {
  const h = zonedParts(new Date()).hh + 1
  return h > 23 ? '23:45' : `${pad(h)}:00`
}

const KINDS: { kind: ReminderKind; label: string }[] = [
  { kind: 'day', label: 'On a day' },
  { kind: 'time', label: 'At a time' },
  { kind: 'person', label: 'When I see…' },
]

export default function ReminderForm({ reminder, onSaved, onClose }: Props) {
  const r = reminder
  const [body, setBody] = useState(r?.body ?? '')
  const [kind, setKind] = useState<ReminderKind>(r?.kind ?? 'day')
  const [day, setDay] = useState((r && dayOf(r)) ?? todayISO())
  const [time, setTime] = useState(r?.remind_at ? timeOf(r.remind_at) : nextHour())
  const [person, setPerson] = useState(r?.person ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim()) return setError('Write what to remember.')
    if (kind !== 'person' && !day) return setError('Pick a day.')
    if (kind !== 'person' && day < todayISO()) return setError('That day has passed. Pick today or later.')
    if (kind === 'person' && !person.trim()) return setError('Who is it about?')
    setSaving(true)
    setError('')
    const values = {
      body: body.trim().slice(0, 300),
      kind,
      remind_on: kind === 'day' ? day : null,
      remind_at: kind === 'time' ? zonedToUTC(day, time) : null,
      person: kind === 'person' ? person.trim().slice(0, 80) : null,
    }
    const sb = getSupabase()
    const q = r
      ? sb.from('reminders').update(values).eq('id', r.id).select('id').single()
      : sb.from('reminders').insert(values).select('id').single()
    const { data, error: err } = await q
    setSaving(false)
    if (err || !data) return setError(`Not saved: ${err?.message ?? 'unknown error'}. Your text is still here.`)
    onSaved()
  }

  return (
    <div className="modalback" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="remform-title">
        <h2 id="remform-title">{r ? 'Edit reminder' : 'New reminder'}</h2>
        <form onSubmit={save}>
          <div className="formgrid">
            <label className="field full"><span>Remember to…</span>
              <input className="input" value={body} onChange={(e) => setBody(e.target.value)} autoFocus maxLength={300} placeholder="bring PE kit" />
            </label>
            <div className="field full"><span>When</span>
              <div className="radios" role="radiogroup" aria-label="When">
                {KINDS.map((k) => (
                  <label key={k.kind} className="radio"><input type="radio" name="remkind" checked={kind === k.kind} onChange={() => setKind(k.kind)} />{k.label}</label>
                ))}
              </div>
            </div>
            {kind !== 'person' && <DatePicker label="Day" value={day} onChange={setDay} placeholder="Pick a day" />}
            {kind === 'time' && <Select label="Time" value={time} onChange={setTime} options={TIMES_15.map((t) => ({ value: t, label: t }))} />}
            {kind === 'person' && (
              <label className="field full"><span>Next time I see</span>
                <input className="input" value={person} onChange={(e) => setPerson(e.target.value)} maxLength={80} placeholder="Sam" />
              </label>
            )}
          </div>
          {error && <div style={{ marginTop: 16 }}><div className="err" role="alert">{error}</div></div>}
          <div className="modalfoot">
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
