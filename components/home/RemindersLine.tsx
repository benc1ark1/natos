'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { loadReminders, reminderWhen, setReminderDone, splitReminders } from '@/lib/reminders'
import { todayISO } from '@/lib/time'
import type { Reminder } from '@/lib/types'
import { useNow } from '@/lib/useNow'
import ReminderForm from '../ReminderForm'
import { CheckIcon, useLoad, type ShowToast } from '../ui'

/** "Remember today": one small line at the top of Home. Reminders are not tasks. */
export default function RemindersLine({ toast }: { toast: ShowToast }) {
  const { data, error, loading, reload } = useLoad(() => loadReminders(getSupabase()))
  const now = useNow()
  const [form, setForm] = useState<{ reminder: Reminder | null } | null>(null)
  const [showLater, setShowLater] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const today = todayISO()
  const split = data && now ? splitReminders(data, today, now) : null

  async function tick(r: Reminder) {
    const sb = getSupabase()
    setBusy(r.id)
    const err = await setReminderDone(sb, r, true)
    await reload()
    setBusy(null)
    if (err) return toast({ kind: 'error', text: err })
    toast({
      kind: 'ok', text: `Ticked “${r.body}”.`,
      action: { label: 'Undo', run: async () => { const e = await setReminderDone(sb, r, false); if (e) toast({ kind: 'error', text: e }); reload() } },
    })
  }

  const item = (r: Reminder) => {
    const when = reminderWhen(r, today)
    return (
      <li key={r.id} className={`remitem ${busy === r.id ? 'completing' : ''}`}>
        <button className="chkbtn" onClick={() => tick(r)} disabled={busy === r.id} aria-label={`Tick off: ${r.body}`}>
          <span className={`chk ${busy === r.id ? 'on' : ''}`}>{busy === r.id && <CheckIcon />}</span>
        </button>
        <button className="remtext" onClick={() => setForm({ reminder: r })}>
          {when && <span className="remwhen mono">{when}</span>}{r.body}
        </button>
      </li>
    )
  }

  return (
    <section className="card s12 remline" aria-labelledby="rem-h">
      <div className="remhead">
        <span className="lbl" id="rem-h"><span className="n">//</span> Remember today</span>
        {loading && !data && <span className="lbl" role="status">Loading…</span>}
        {split && split.now.length === 0 && <span className="remnone">Nothing today</span>}
        <span className="remacts">
          {split && split.later.length > 0 && (
            <button className="btn sm ghost" aria-expanded={showLater} onClick={() => setShowLater((v) => !v)}>
              {showLater ? 'Hide later' : `${split.later.length} later`}
            </button>
          )}
          <button className="btn sm" onClick={() => setForm({ reminder: null })}>+ Reminder</button>
        </span>
      </div>
      {error && <div className="err" role="alert"><span>{error}</span><button className="btn sm" onClick={reload}>Try again</button></div>}
      {split && split.now.length > 0 && <ul className="remlist">{split.now.map(item)}</ul>}
      {split && showLater && split.later.length > 0 && (
        <>
          <div className="sub lbl">Later</div>
          <ul className="remlist">{split.later.map(item)}</ul>
        </>
      )}
      {form && (
        <ReminderForm reminder={form.reminder} onClose={() => setForm(null)}
          onSaved={() => { toast({ kind: 'ok', text: form.reminder ? 'Reminder saved.' : 'Reminder added.' }); setForm(null); reload() }} />
      )}
    </section>
  )
}
