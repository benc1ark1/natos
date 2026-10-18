'use client'
// A guide's weekly log (BUILD-GUIDE step 10: "Athletic & Lower changes weekly: fixed rules + a dated weekly log").
// The guide's text is the fixed rules; this is what changed each week, newest first. Archive, never delete.
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { addGuideLog, loadGuideLogs, setGuideLogArchived } from '@/lib/guides'
import { addDays, shortDate, todayISO, weekStartISO } from '@/lib/time'
import { Empty, ErrorBox, Loading, useLoad, type ShowToast } from './ui'

export default function GuideLog({ guideId, toast }: { guideId: string; toast: ShowToast }) {
  const { data, error, loading, reload } = useLoad(() => loadGuideLogs(getSupabase(), guideId))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const week = weekStartISO(todayISO())
  const sb = getSupabase()

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data && loading) return <Loading lines={3} />
  const weeks = [...new Set((data ?? []).map((l) => l.week_start))]
  const label = (w: string) => (w === week ? 'This week' : `Week of ${shortDate(w)} – ${shortDate(addDays(w, 6))}`)

  return (
    <section className="card glog" aria-labelledby="glog-h">
      <div className="ch"><span className="lbl" id="glog-h">Weekly log</span></div>
      <form className="formgrid" onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const r = await addGuideLog(sb, guideId, week, text)
        await reload()
        setBusy(false)
        if (r.error) return toast({ kind: 'error', text: r.error })
        setText('')
        toast({ kind: 'ok', text: 'Added to this week’s log.', action: { label: 'Undo', run: async () => { await setGuideLogArchived(sb, r.id!, true); await reload() } } })
      }}>
        <label className="field full"><span>This week ({shortDate(week)} – {shortDate(addDays(week, 6))})</span>
          <textarea className="textarea" rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Coach’s programme this week, what changed, how it went" />
        </label>
        <div className="full"><button className="btn" disabled={busy || !text.trim()}>{busy ? 'Adding…' : 'Add to log'}</button></div>
      </form>
      {!weeks.length && <Empty>Nothing logged yet.</Empty>}
      {weeks.map((w) => (
        <div key={w}>
          <div className="lbl glogweek">{label(w)}</div>
          {(data ?? []).filter((l) => l.week_start === w).map((l) => (
            <div key={l.id} className="glogrow">
              <span>{l.body}</span>
              <button type="button" className="btn sm ghost" onClick={async () => {
                const e = await setGuideLogArchived(sb, l.id, true)
                await reload()
                if (e) return toast({ kind: 'error', text: e })
                toast({ kind: 'ok', text: 'Archived.', action: { label: 'Undo', run: async () => { await setGuideLogArchived(sb, l.id, false); await reload() } } })
              }}>Archive</button>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
