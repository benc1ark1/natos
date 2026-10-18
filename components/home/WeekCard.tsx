'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { areaColor, categoryOf } from '@/lib/lookup'
import { targetProgress } from '@/lib/targets'
import type { WeeklyTarget } from '@/lib/types'
import Select from '../controls/Select'
import TrainingTypeFields, { useTrainingType } from '../controls/TrainingType'
import { Empty, type ShowToast } from '../ui'
import type { HomeData } from './HomeView'

const SOURCE_LABEL: Record<WeeklyTarget['sync_source'], string> = { manual: '', hevy: 'Hevy', trainheroic: 'TrainHeroic', whoop: 'Whoop' }
type Toast = ShowToast

const OPEN_KEY = 'weekcard-open'

/**
 * Weekly targets (Mon–Sun), shown as one compact line ("Team 2/3 · Upper 1/3"); tap to expand.
 * Progress = Log taps this week, or linked calendar sessions that have happened (Team). Nothing ever needs resetting.
 */
export default function WeekCard({ data, reload, toast }: { data: HomeData; reload: () => Promise<void>; toast: Toast }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  // remember expanded/collapsed on this device
  useEffect(() => { try { setOpen(localStorage.getItem(OPEN_KEY) === '1') } catch {} }, [])
  const toggle = () => setOpen((o) => { try { localStorage.setItem(OPEN_KEY, o ? '0' : '1') } catch {} return !o })

  const progress = (t: WeeklyTarget) => targetProgress(t, data)
  const summary = data.targets.map((t) => { const p = progress(t); return `${t.name} ${p.done}/${p.target}` }).join(' · ')

  async function logOne(t: WeeklyTarget) {
    setBusy(t.id)
    const sb = getSupabase()
    const { data: row, error } = await sb.from('target_logs')
      .insert({ user_id: data.userId, target_id: t.id, done_on: data.today, source: 'manual' }).select('id').single()
    await reload()
    setBusy(null)
    if (error || !row) return toast({ kind: 'error', text: `Not logged: ${error?.message ?? 'not saved'}` })
    toast({
      kind: 'ok', text: `${t.name}: +1 logged.`,
      action: { label: 'Undo', run: async () => {
        const r = await sb.from('target_logs').delete().eq('id', row.id).select('id').single()
        if (r.error) toast({ kind: 'error', text: `Couldn't undo: ${r.error.message}` })
        reload()
      } },
    })
  }

  return (
    <section className="card" aria-labelledby="week-h">
      <div className="ch" style={{ marginBottom: 8 }}>
        <span className="lbl" id="week-h"><span className="n">04 //</span> This week</span>
        <button className="btn sm ghost" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>{adding ? 'Close' : '+ Target'}</button>
      </div>
      {adding && <TargetForm data={data} onCancel={() => setAdding(false)} onDone={async (msg) => { setAdding(false); await reload(); toast({ kind: 'ok', text: msg }) }} toast={toast} />}
      {data.targets.length === 0 && !adding && <Empty>No weekly targets yet. Add one, e.g. Football 4 a week.</Empty>}
      {data.targets.length > 0 && (
        <button className="wsum mono" onClick={toggle} aria-expanded={open}>
          <span>{summary}</span><span className="wsumchev" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>
      )}
      {open && data.targets.map((t) => {
        const { done, target } = progress(t)
        const fromCal = t.counts_from === 'events'
        const color = areaColor(categoryOf(data.lookup, { subject_id: t.subject_id, category_id: null })?.name)
        // bar runs to the bonus if there is one; segments past the target are the bonus
        const top = Math.max(1, fromCal ? target : t.bonus_count ?? target)
        const segs = Math.min(top, 14)
        const filled = Math.round((Math.min(done, top) / top) * segs)
        const targetSegs = Math.round((target / top) * segs)
        const extra = fromCal ? 0 : Math.max(0, done - target)
        if (editing === t.id) return <TargetForm key={t.id} data={data} target={t} toast={toast}
          onCancel={() => setEditing(null)} onDone={async (msg, undo) => {
            setEditing(null); await reload()
            toast({ kind: 'ok', text: msg, action: undo && { label: 'Undo', run: async () => { await undo(); reload() } } })
          }} />
        return (
          <div className="wrow" key={t.id}>
            <div className="wtop">
              <span className="dot" style={{ background: color }} />
              <button className="wn" onClick={() => setEditing(t.id)} aria-label={`Edit ${t.name}`}>{t.name}</button>
              {fromCal ? <span className="wsub mono">Calendar</span> : SOURCE_LABEL[t.sync_source] && <span className="wsub mono">{SOURCE_LABEL[t.sync_source]}</span>}
              <span className="wc mono" aria-label={`${done} of ${target}${!fromCal && t.bonus_count ? `, bonus ${t.bonus_count}` : ''}`}>
                {Math.min(done, target)}/{target}{target > 0 && done >= target ? ' ✓' : ''}
                {extra > 0 && <span className="wbonus"> +{extra} bonus</span>}
              </span>
              {!fromCal && <button className="btn sm logbtn" onClick={() => logOne(t)} disabled={busy === t.id} aria-label={`Log a ${t.name} session`}>Log</button>}
            </div>
            <div className="segs" aria-hidden="true">
              {Array.from({ length: segs }, (_, i) => (
                <span key={i} className={`seg ${i >= targetSegs ? 'bonus' : ''}`} style={{ background: i < filled ? color : undefined }} />
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

function TargetForm({ data, target, onDone, onCancel, toast }: {
  data: HomeData; target?: WeeklyTarget; onDone: (msg: string, undo?: () => Promise<void>) => void; onCancel: () => void; toast: Toast
}) {
  const [name, setName] = useState(target?.name ?? '')
  const training = useTrainingType(target ?? null)
  const [count, setCount] = useState(String(target?.target_count ?? 3))
  const [bonus, setBonus] = useState(target?.bonus_count ? String(target.bonus_count) : '')
  // how long one session is: the week planner places sessions this long (60 min if not set)
  const [minutes, setMinutes] = useState(target?.session_minutes ? String(target.session_minutes) : '')
  // which Whoop workouts count toward it (Whoop's activity names, e.g. "Weightlifting"); empty = none
  const [whoop, setWhoop] = useState((target?.whoop_sports ?? []).join(', '))
  const [subjectId, setSubjectId] = useState(target?.subject_id ?? '')
  const [source, setSource] = useState<WeeklyTarget['sync_source']>(target?.sync_source ?? 'manual')
  const [countsFrom, setCountsFrom] = useState<WeeklyTarget['counts_from']>(target?.counts_from ?? 'logs')
  const fromCal = countsFrom === 'events'
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    // calendar targets count their linked sessions, so per week / bonus aren't used (stored value kept)
    const n = fromCal ? target?.target_count ?? 1 : Number(count)
    if (!name.trim() || !Number.isInteger(n) || n < 1) { toast({ kind: 'error', text: 'Give the target a name and a whole number per week.' }); return }
    const b = fromCal ? target?.bonus_count ?? null : bonus.trim() ? Number(bonus) : null
    if (!fromCal && b !== null && (!Number.isInteger(b) || b <= n)) { toast({ kind: 'error', text: `Bonus must be a whole number above ${n}, or left empty.` }); return }
    const m = fromCal || !minutes.trim() ? target?.session_minutes ?? null : Number(minutes)
    if (m !== null && (!Number.isInteger(m) || m < 10 || m > 240)) { toast({ kind: 'error', text: 'A session must be 10 to 240 minutes, or left empty (60).' }); return }
    setSaving(true)
    const whoopSports = whoop.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 10)
    const values = { name: name.trim(), target_count: n, bonus_count: b, session_minutes: m, ...(whoopSports.length || target?.whoop_sports?.length ? { whoop_sports: whoopSports } : {}), subject_id: subjectId || null, sync_source: fromCal ? 'manual' : source, counts_from: countsFrom, ...training.values() }
    const sb = getSupabase()
    const { error } = target
      ? await sb.from('weekly_targets').update(values).eq('id', target.id).select('id').single()
      : await sb.from('weekly_targets').insert({ ...values, sort_order: data.targets.length }).select('id').single()
    setSaving(false)
    if (error) toast({ kind: 'error', text: `Target not saved: ${error.message}` })
    else onDone(target ? `Saved ${values.name}.` : fromCal ? `Added ${values.name}. Link its sessions on the calendar.` : `Added ${values.name} (${n} a week${b ? `, bonus ${b}` : ''}).`)
  }

  // archive = hide it (is_active off); its logs stay. Undo turns it back on.
  async function archive() {
    if (!target) return
    const sb = getSupabase()
    const set = (on: boolean) => sb.from('weekly_targets').update({ is_active: on }).eq('id', target.id).select('id').single()
    setSaving(true)
    const { error } = await set(false)
    setSaving(false)
    if (error) return toast({ kind: 'error', text: `Not archived: ${error.message}` })
    onDone(`Archived ${target.name}.`, async () => {
      const r = await set(true)
      if (r.error) toast({ kind: 'error', text: `Couldn't undo: ${r.error.message}` })
    })
  }

  return (
    <form onSubmit={save} className="formgrid" style={{ margin: '4px 0 14px' }}>
      <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => { setName(e.target.value); training.renamed(e.target.value) }} placeholder="Reading" /></label>
      <Select label="Counts" value={countsFrom} onChange={(v) => setCountsFrom(v as WeeklyTarget['counts_from'])}
        options={[{ value: 'logs', label: 'Log button' }, { value: 'events', label: 'Calendar sessions' }]} />
      {!fromCal && <label className="field"><span>Per week</span><input className="input" type="number" inputMode="numeric" min={1} value={count} onChange={(e) => setCount(e.target.value)} /></label>}
      {!fromCal && <label className="field"><span>Bonus (optional)</span><input className="input" type="number" inputMode="numeric" min={2} value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="e.g. 3" /></label>}
      {!fromCal && <label className="field"><span>Session (min)</span><input className="input" type="number" inputMode="numeric" min={10} max={240} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="60" /></label>}
      <Select label="Subject" value={subjectId} onChange={setSubjectId}
        options={[{ value: '', label: 'None' }, ...data.lookup.subjects.map((s) => ({ value: s.id, label: s.name }))]} />
      {!fromCal && <Select label="Progress from" value={source} onChange={(v) => setSource(v as WeeklyTarget['sync_source'])}
        options={[{ value: 'manual', label: 'Manual' }, { value: 'hevy', label: 'Hevy' }, { value: 'trainheroic', label: 'TrainHeroic' }, { value: 'whoop', label: 'Whoop' }]} />}
      <TrainingTypeFields name={name} state={training} />
      {!fromCal && <label className="field full"><span>Whoop workouts that count (optional)</span><input className="input" value={whoop} onChange={(e) => setWhoop(e.target.value)} placeholder="e.g. Weightlifting" /></label>}
      {fromCal && <p className="usub full" style={{ margin: 0 }}>Counts sessions linked to it on the calendar once they’ve happened, unless marked missed. Open an event to link it.</p>}
      <div className="full" style={{ display: 'flex', gap: 10 }}>
        <button className="btn primary" disabled={saving}>{saving ? 'Saving…' : target ? 'Save' : 'Add target'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        {target && <button type="button" className="btn ghost" style={{ marginLeft: 'auto' }} disabled={saving} onClick={archive}>Archive</button>}
      </div>
    </form>
  )
}
