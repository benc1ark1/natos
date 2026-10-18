'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { captureToInbox, loadLookupRows } from '@/lib/data'
import { cleanUrl, loadProjects } from '@/lib/projects'
import { autoStatus } from '@/lib/tasks'
import { activeSources } from '@/lib/lists'
import { usePlanning } from '@/lib/usePlanning'
import { dueAtFromDate, todayISO } from '@/lib/time'
import type { Category, Project, Subject, Task } from '@/lib/types'
import { saveProposal, saveUnsorted } from '@/lib/capture/save'
import type { CaptureResult, Duplicate, Proposal } from '@/lib/capture/types'
import CaptureCard from './CaptureCard'
import DatePicker from './controls/DatePicker'
import Select from './controls/Select'
import Toggle from './controls/Toggle'
import { PlusIcon } from './ui'

type Details = {
  due: string; window_label: string; window_end: string; subject_id: string; duration: string
  origin: Task['origin']; project_id: string; is_key: boolean; hand_in: string; hand_in_url: string
}
const EMPTY: Details = { due: '', window_label: '', window_end: '', subject_id: '', duration: '', origin: 'own', project_id: '', is_key: false, hand_in: '', hand_in_url: '' }

/** Local testing only (acceptance test T07): localStorage 'capture-simulate-ai-failure' = '1'. */
function simulateFailure(): boolean {
  try { return localStorage.getItem('capture-simulate-ai-failure') === '1' } catch { return false }
}

/** Ask the server's AI to sort the text. Never throws: a failure comes back as { ok: false }. */
async function sortWithAI(text: string): Promise<CaptureResult> {
  try {
    const res = await fetch('/api/capture', {
      method: 'POST', cache: 'no-store',
      headers: { 'content-type': 'application/json', ...(simulateFailure() ? { 'x-simulate-ai-failure': '1' } : {}) },
      body: JSON.stringify({ text }),
    })
    const body = await res.json().catch(() => null)
    if (body && typeof body.ok === 'boolean') return body as CaptureResult
    return { ok: false, error: `Server replied ${res.status}.` }
  } catch {
    return { ok: false, error: 'Couldn’t reach the server.' }
  }
}

/**
 * Quick capture. Enter sends the text to the AI, which proposes what it is (task, test, reminder,
 * progress, event change, idea, resource or fact) on an editable card; nothing saves until Confirm.
 * If the AI fails, the raw text goes to Inbox labelled "not sorted yet".
 * "Details" skips the AI: fill the fields yourself and it saves straight away.
 */
export default function CaptureBox({ onSaved, label = '02 //' }: { onSaved?: (t?: Task) => void; label?: string }) {
  const planning = usePlanning()
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sorting' | 'saving' | 'saved' | 'error'>('idle')
  const [card, setCard] = useState<{ proposal: Proposal; duplicates: Duplicate[] } | null>(null)
  const [cardError, setCardError] = useState('')
  const [warn, setWarn] = useState('')
  const [undo, setUndo] = useState<(() => Promise<string | null>) | null>(null)
  const [error, setError] = useState('')
  const [savedTo, setSavedTo] = useState('Inbox')
  const [open, setOpen] = useState(false)
  const [d, setD] = useState<Details>(EMPTY)
  const [opts, setOpts] = useState<{ subjects: Subject[]; categories: Category[]; projects: Project[] } | null>(null)
  const [optsError, setOptsError] = useState('')
  const set = <K extends keyof Details>(k: K, v: Details[K]) => setD((s) => ({ ...s, [k]: v }))

  async function toggleDetails() {
    setOpen((o) => !o)
    if (opts) return
    try {
      const sb = getSupabase()
      const [lk, projects] = await Promise.all([loadLookupRows(sb), loadProjects(sb)])
      setOpts({ ...lk, projects }); setOptsError('')
    } catch (e) { setOptsError(e instanceof Error ? e.message : 'Couldn’t load the options.') }
  }

  function detailsToSave(): Partial<Task> | string {
    if (!open) return {}
    const mins = d.duration ? Number(d.duration) : null
    if (mins !== null && (!Number.isInteger(mins) || mins <= 0)) return 'Minutes must be a whole number.'
    const link = cleanUrl(d.hand_in_url)
    if (link === null) return 'The hand-in link must be a web address.'
    const sub = opts?.subjects.find((s) => s.id === d.subject_id)
    return {
      status: autoStatus(d.due || d.window_end || null, todayISO()),
      due_at: d.due ? dueAtFromDate(d.due) : null,
      window_label: d.window_label.trim() || null,
      window_end: d.window_end || null,
      subject_id: d.subject_id || null,
      category_id: sub?.category_id ?? null,
      duration_minutes: mins,
      origin: d.origin,
      project_id: d.project_id || null,
      is_key: d.is_key,
      hand_in: d.hand_in.trim() || null,
      hand_in_url: link || null,
    }
  }

  function done(message: string, task?: Task, warning = '', undoFn?: () => Promise<string | null>) {
    setSavedTo(message)
    setUndo(() => undoFn ?? null)
    setWarn(warning)
    setText('')
    setCard(null)
    setCardError('')
    setState('saved')
    onSaved?.(task)
    setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), warning || undoFn ? 8000 : 3000)
  }

  async function submit() {
    if (!text.trim() || state === 'saving' || state === 'sorting' || card) return
    if (open) return save()
    setState('sorting'); setError(''); setWarn('')
    const res = await sortWithAI(text)
    if (res.ok) { setCard({ proposal: res.proposal, duplicates: res.duplicates }); setState('idle'); return }
    // The AI failed: keep the words safe in Inbox, clearly labelled.
    const saved = await saveUnsorted(getSupabase(), text)
    if (saved.error) { setError(`Couldn’t sort it (${res.error}) and couldn’t save it: ${saved.error}`); setState('error'); return }
    done('Inbox', saved.task, `Couldn’t sort it: ${res.error} Saved to Inbox as “not sorted yet”.`)
  }

  async function confirm(p: Proposal, subjects: Subject[]) {
    setState('saving'); setCardError('')
    const res = await saveProposal(getSupabase(), p, text, subjects).catch((e) => ({ error: e instanceof Error ? e.message : 'Not saved.', message: undefined, task: undefined }))
    if (res.error || !res.message) { setCardError(res.error ?? 'Not saved.'); setState('idle'); return }
    done(res.message, res.task, '', res.undo)
  }

  async function runUndo() {
    if (!undo) return
    const e = await undo()
    setUndo(null)
    if (e) { setError(e); setState('error'); return }
    setSavedTo('Undone.')
    onSaved?.()
  }

  async function justInbox() {
    setState('saving'); setCardError('')
    const res = await captureToInbox(getSupabase(), text)
    if (res.error || !res.task) { setCardError(`${res.error} Your text is still in the box.`); setState('idle'); return }
    done('Saved to Inbox.', res.task)
  }

  async function save() {
    if (!text.trim() || state === 'saving') return
    const details = detailsToSave()
    if (typeof details === 'string') { setError(details); setState('error'); return }
    setState('saving')
    const res = await captureToInbox(getSupabase(), text, details)
    if (res.error || !res.task) {
      setError(`${res.error} Your text is still in the box.`)
      setState('error')
      return
    }
    const where: Record<string, string> = { inbox: 'Inbox', today: 'Today', this_week: 'This week', this_month: 'Later' }
    setD(EMPTY)
    setOpen(false)
    done(`Saved to ${where[res.task.status] ?? 'Tasks'}.`, res.task)
  }

  return (
    <div className="cap">
      <div className="lbl"><span className="n">{label}</span> Capture</div>
      <form className="capbox" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <PlusIcon />
        <label className="sr" htmlFor="capture">Capture anything</label>
        <input id="capture" className="capin" placeholder="Add anything…" value={text} autoComplete="off" readOnly={!!card || state === 'sorting'}
          onChange={(e) => { setText(e.target.value); if (state === 'error') setState('idle') }} />
        <span className="kbd mono" aria-hidden="true">↵</span>
        <button className="capbtn" type="submit" disabled={state === 'saving' || state === 'sorting' || !!card || !text.trim()}>
          {state === 'sorting' ? 'Sorting…' : state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Capture'}
        </button>
      </form>
      <div className="capmsg" aria-live="polite" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span>
          {state === 'sorting' && <span>Sorting it… nothing is saved until you confirm.</span>}
          {state === 'saved' && (warn ? <span className="bad">{warn}</span> : <span className="ok">{savedTo} {undo && <button type="button" className="btn sm" onClick={runUndo}>Undo</button>}</span>)}
          {state === 'error' && <span className="bad">{error}</span>}
        </span>
        <button type="button" className="btn sm ghost" disabled={!!card} aria-expanded={open} aria-controls="capdetails" onClick={toggleDetails}>
          {open ? 'Hide details' : 'Details'}
        </button>
      </div>
      {card && (
        <CaptureCard key={JSON.stringify(card.proposal)} text={text} proposal={card.proposal} duplicates={card.duplicates}
          busy={state === 'saving'} error={cardError} onConfirm={confirm} onInbox={justInbox}
          onCancel={() => { setCard(null); setCardError('') }} />
      )}
      {open && (
        <div id="capdetails" className="formgrid capdetails"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); save() } }}>
          {optsError && <div className="err full" role="alert">{optsError}</div>}
          <DatePicker label="Due date" value={d.due} onChange={(v) => set('due', v)} />
          <Select label="Subject" value={d.subject_id} onChange={(v) => set('subject_id', v)} disabled={!opts} placeholder="Loading…"
            options={opts ? [{ value: '', label: 'None' }, ...opts.subjects.map((s) => ({ value: s.id, label: s.name }))] : []} />
          <label className="field"><span>Or a window (e.g. this weekend)</span>
            <input className="input" value={d.window_label} onChange={(e) => set('window_label', e.target.value)} placeholder="before Wed" />
          </label>
          <DatePicker label="Window ends (last OK day)" value={d.window_end} onChange={(v) => set('window_end', v)} />
          <label className="field"><span>Rough minutes</span>
            <input className="input" type="number" inputMode="numeric" min={1} value={d.duration} onChange={(e) => set('duration', e.target.value)} />
          </label>
          <Select label="Where it came from" value={d.origin} onChange={(v) => set('origin', v as Task['origin'])}
            options={activeSources(planning, d.origin).map((x) => ({ value: x.key, label: x.label }))} />
          <Select label="Project" value={d.project_id} onChange={(v) => set('project_id', v)} disabled={!opts} placeholder="Loading…"
            options={opts ? [{ value: '', label: 'None' }, ...opts.projects.map((p) => ({ value: p.id, label: p.name }))] : []} />
          <div className="field moretoggle"><Toggle checked={d.is_key} onChange={(v) => set('is_key', v)} label="Star it (always on Home)" /></div>
          <label className="field"><span>Hand in how/where</span>
            <input className="input" value={d.hand_in} onChange={(e) => set('hand_in', e.target.value)} maxLength={120} placeholder="Google Classroom" />
          </label>
          <label className="field"><span>Hand-in link (optional)</span>
            <input className="input" inputMode="url" value={d.hand_in_url} onChange={(e) => set('hand_in_url', e.target.value)} placeholder="https://…" />
          </label>
        </div>
      )}
    </div>
  )
}
