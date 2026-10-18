'use client'
// Home: the next step in each subject's study pipeline (BUILD-GUIDE step 12: "FM: Complex numbers — exam questions",
// one or two per subject, not a wall) and mistakes due for review. One tap marks a stage done, with Undo.
import Link from 'next/link'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { safeUrl } from '@/lib/data'
import { moreSettings } from '@/lib/settings'
import { dueMistakes, nextActions } from '@/lib/study'
import { markStageDone, setReviewed, undoStage } from '@/lib/study-data'
import type { ShowToast } from '../ui'
import type { HomeData } from './HomeView'

export default function StudyCard({ data, reload, toast }: { data: HomeData; reload: () => Promise<void>; toast: ShowToast }) {
  const [busy, setBusy] = useState<string | null>(null)
  const subjects = data.lookup.subjects
  const next = nextActions(subjects, data.study.stages, data.study.topics, data.study.progress, moreSettings(data.planning).studyPerSubject)
  const due = dueMistakes(data.study.mistakes, data.today).slice(0, 4)
  if (!next.length && !due.length) return null
  const sb = getSupabase()

  async function done(topicId: string, stageId: string, words: string) {
    setBusy(topicId)
    const r = await markStageDone(sb, topicId, stageId)
    await reload()
    setBusy(null)
    if (r.error) return toast({ kind: 'error', text: r.error })
    toast({ kind: 'ok', text: `Done: ${words}.`, action: { label: 'Undo', run: async () => { const e = await undoStage(sb, r.id!); if (e) toast({ kind: 'error', text: e }); await reload() } } })
  }
  async function reviewed(id: string, body: string) {
    setBusy(id)
    const e = await setReviewed(sb, id, true)
    await reload()
    setBusy(null)
    if (e) return toast({ kind: 'error', text: e })
    toast({ kind: 'ok', text: `Reviewed: ${body}`, action: { label: 'Undo', run: async () => { await setReviewed(sb, id, false); await reload() } } })
  }

  return (
    <section className="card" aria-labelledby="study-h">
      <div className="ch"><span className="lbl" id="study-h"><span className="n">S //</span> Study next</span></div>
      {next.map((a) => {
        const notes = safeUrl(a.topic.notes_url)
        return (
          <div key={a.topic.id} className={`studyrow ${busy === a.topic.id ? 'pending' : ''}`}>
            <div style={{ minWidth: 0 }}>
              <Link href={`/subjects/${a.subjectId}`} className="usub">{a.subject}</Link>
              <div><b>{a.topic.name}</b> — {a.stage.name} <span className="usub">({a.stageNo}/{a.total})</span></div>
            </div>
            <span className="studybtns">
              {notes && <a className="btn sm ghost" href={notes} target="_blank" rel="noopener noreferrer" aria-label={`Notes for ${a.topic.name}`}>📓</a>}
              <button type="button" className="btn sm" disabled={busy === a.topic.id} onClick={() => done(a.topic.id, a.stage.id, `${a.topic.name}, ${a.stage.name}`)}>✓ Done</button>
            </span>
          </div>
        )
      })}
      {due.map((m) => (
        <div key={m.id} className={`studyrow ${busy === m.id ? 'pending' : ''}`}>
          <div style={{ minWidth: 0 }}><span className="usub">Mistake to review</span><div>{m.body}</div></div>
          <button type="button" className="btn sm" disabled={busy === m.id} onClick={() => reviewed(m.id, m.body)}>Reviewed</button>
        </div>
      ))}
    </section>
  )
}
