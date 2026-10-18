'use client'
// A subject's study pipeline (BUILD-GUIDE step 12): its stages (add, rename, reorder, archive: progress is kept),
// its topics (paste the spec's list; each shows its stages done and the next one, with a GoodNotes link), and the
// mistakes he logged (they come back for review). Every change is confirmed by the database, with Undo.
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { safeUrl } from '@/lib/data'
import { dueMistakes, stagesOf, topicState, type Stage, type Topic } from '@/lib/study'
import { addTopics, logMistake, markStageDone, setReviewed, undoStage, type StudyData } from '@/lib/study-data'
import { shortDate, dowShort, todayISO } from '@/lib/time'
import Select from './controls/Select'
import { Empty, type ShowToast } from './ui'

type Props = { subjectId: string; subject: string; study: StudyData; reload: () => Promise<void>; toast: ShowToast }

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`

export default function StudyPipeline(p: Props) {
  return (
    <>
      <Pipeline {...p} />
      <Topics {...p} />
      <Mistakes {...p} />
    </>
  )
}

function Pipeline({ subjectId, subject, study, reload, toast }: Props) {
  const stages = stagesOf(study.stages, subjectId)
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const sb = getSupabase()
  const run = async (work: () => PromiseLike<{ error: { message: string } | null }>, ok: string, undo?: () => PromiseLike<unknown>) => {
    setBusy(true)
    const { error } = await work()
    await reload()
    setBusy(false)
    if (error) return toast({ kind: 'error', text: `Not saved: ${error.message}` })
    toast({ kind: 'ok', text: ok, ...(undo ? { action: { label: 'Undo', run: async () => { await undo(); await reload() } } } : {}) })
  }
  const move = (i: number, by: number) => {
    const a = stages[i], b = stages[i + by]
    if (!b) return
    // swap places (sort_order), so their progress goes with them
    run(async () => {
      const r1 = await sb.from('pipeline_stages').update({ sort_order: i + by }).eq('id', a.id)
      const r2 = await sb.from('pipeline_stages').update({ sort_order: i }).eq('id', b.id)
      // the others get tidy numbers too
      await Promise.all(stages.map((s, j) => (s.id === a.id || s.id === b.id || s.sort_order === j ? null : sb.from('pipeline_stages').update({ sort_order: j }).eq('id', s.id))))
      return { error: r1.error ?? r2.error }
    }, `Moved “${a.name}”.`)
  }
  return (
    <section className="card s12" aria-labelledby="pipe-h">
      <div className="ch"><span className="lbl" id="pipe-h">Pipeline: how you learn {subject}</span><span className="lbl">{stages.length} stages</span></div>
      {stages.length === 0 && <Empty>No stages yet. Add them in order, e.g. Video → Notes in GoodNotes → Textbook questions → Exam questions → Past papers → Review mistakes.</Empty>}
      <ol className="pipe">
        {stages.map((s, i) => (
          <li key={s.id}>
            {editing === s.id
              ? <form className="pipeedit" onSubmit={(e) => { e.preventDefault(); const n = draft.trim().slice(0, 80); if (!n) return; setEditing(null); run(() => sb.from('pipeline_stages').update({ name: n }).eq('id', s.id), `Renamed to “${n}”.`, () => sb.from('pipeline_stages').update({ name: s.name }).eq('id', s.id)) }}>
                  <input className="input" value={draft} autoFocus maxLength={80} onChange={(e) => setDraft(e.target.value)} />
                  <button className="btn sm primary">Save</button><button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              : <>
                  <span className="pipeno mono">{i + 1}</span><span className="pipename">{s.name}</span>
                  <span className="pipebtns">
                    <button type="button" className="btn sm ghost" aria-label={`Move ${s.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button type="button" className="btn sm ghost" aria-label={`Move ${s.name} down`} disabled={busy || i === stages.length - 1} onClick={() => move(i, 1)}>↓</button>
                    <button type="button" className="btn sm ghost" disabled={busy} onClick={() => { setEditing(s.id); setDraft(s.name) }}>Rename</button>
                    <button type="button" className="btn sm ghost" disabled={busy} onClick={() => run(() => sb.from('pipeline_stages').update({ archived_at: new Date().toISOString() }).eq('id', s.id), `Archived “${s.name}” (its progress stays).`, () => sb.from('pipeline_stages').update({ archived_at: null }).eq('id', s.id))}>Archive</button>
                  </span>
                </>}
          </li>
        ))}
      </ol>
      <form className="gadd" style={{ marginTop: 10 }} onSubmit={async (e) => {
        e.preventDefault()
        const n = name.trim().slice(0, 80)
        if (!n) return
        const { data: u } = await sb.auth.getUser()
        await run(() => sb.from('pipeline_stages').insert({ user_id: u.user?.id, subject_id: subjectId, name: n, sort_order: stages.length }).select('id').single(), `Added stage “${n}”.`)
        setName('')
      }}>
        <label className="field"><span>Add a stage (at the end)</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bicen Maths video" /></label>
        <button className="btn" disabled={busy || !name.trim()}>Add</button>
      </form>
    </section>
  )
}

function Topics({ subjectId, study, reload, toast }: Props) {
  const stages = stagesOf(study.stages, subjectId)
  const topics = study.topics.filter((t) => t.subject_id === subjectId && !t.archived_at).sort((a, b) => a.sort_order - b.sort_order)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [linking, setLinking] = useState<string | null>(null)
  const [link, setLink] = useState('')
  const sb = getSupabase()

  async function done(t: Topic, s: Stage) {
    setBusy(t.id)
    const r = await markStageDone(sb, t.id, s.id)
    await reload()
    setBusy(null)
    if (r.error) return toast({ kind: 'error', text: r.error })
    toast({ kind: 'ok', text: `${t.name}: “${s.name}” done.`, action: { label: 'Undo', run: async () => { const e = await undoStage(sb, r.id!); if (e) toast({ kind: 'error', text: e }); await reload() } } })
  }
  async function saveLink(t: Topic) {
    const url = link.trim()
    if (url && !safeUrl(url)) return toast({ kind: 'error', text: 'The link must start with https:// (your GoodNotes PDF’s Google Drive link).' })
    setBusy(t.id)
    const { error } = await sb.from('topics').update({ notes_url: url || null }).eq('id', t.id).select('id').single()
    await reload()
    setBusy(null)
    setLinking(null)
    if (error) return toast({ kind: 'error', text: `Not saved: ${error.message}` })
    toast({ kind: 'ok', text: url ? 'Notes linked.' : 'Link removed.', action: { label: 'Undo', run: async () => { await sb.from('topics').update({ notes_url: t.notes_url }).eq('id', t.id); await reload() } } })
  }
  async function archive(t: Topic) {
    setBusy(t.id)
    const { error } = await sb.from('topics').update({ archived_at: new Date().toISOString() }).eq('id', t.id).select('id').single()
    await reload()
    setBusy(null)
    if (error) return toast({ kind: 'error', text: `Not saved: ${error.message}` })
    toast({ kind: 'ok', text: `Archived “${t.name}”.`, action: { label: 'Undo', run: async () => { await sb.from('topics').update({ archived_at: null }).eq('id', t.id); await reload() } } })
  }

  return (
    <section className="card s7" aria-labelledby="topics-h">
      <div className="ch"><span className="lbl" id="topics-h">Topics</span><span className="lbl">{topics.length}</span></div>
      {topics.length === 0 && <Empty>No topics yet. Paste your exam board’s topic list below, one per line.</Empty>}
      {topics.map((t) => {
        const st = topicState(t, study.stages, study.progress)
        const notes = safeUrl(t.notes_url)
        return (
          <div key={t.id} className={`topic ${busy === t.id ? 'pending' : ''}`}>
            <div className="topichead">
              <b>{t.spec_ref ? <span className="mono usub">{t.spec_ref} </span> : null}{t.name}</b>
              <span className="dots" aria-label={`${st.done.size} of ${stages.length} stages done`}>
                {stages.map((s) => <i key={s.id} className={st.done.has(s.id) ? 'on' : ''} title={s.name} />)}
              </span>
            </div>
            <div className="topicrow">
              {st.next
                ? <><span className="usub">Next: {st.next.name}</span><button type="button" className="btn sm" disabled={busy === t.id} onClick={() => done(t, st.next!)}>✓ Done</button></>
                : <span className="usub">{stages.length ? 'All stages done ✓' : 'Add stages to the pipeline first'}</span>}
              {notes ? <a className="btn sm ghost" href={notes} target="_blank" rel="noopener noreferrer">📓 Notes</a> : null}
              <button type="button" className="btn sm ghost" onClick={() => { setLinking(linking === t.id ? null : t.id); setLink(t.notes_url ?? '') }}>{t.notes_url ? 'Change link' : 'Link notes'}</button>
              <button type="button" className="btn sm ghost" disabled={busy === t.id} onClick={() => archive(t)}>Archive</button>
            </div>
            {linking === t.id && (
              <form className="pipeedit" onSubmit={(e) => { e.preventDefault(); saveLink(t) }}>
                <input className="input" inputMode="url" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="GoodNotes PDF link from Google Drive (https://…)" />
                <button className="btn sm primary">Save</button>
              </form>
            )}
          </div>
        )
      })}
      <form className="formgrid" style={{ marginTop: 16 }} onSubmit={async (e) => {
        e.preventDefault()
        setBusy('add')
        const r = await addTopics(sb, subjectId, paste)
        await reload()
        setBusy(null)
        if (r.error) return toast({ kind: 'error', text: r.error })
        setPaste('')
        toast({ kind: 'ok', text: `Added ${r.added!.length} topic${r.added!.length === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} already there)` : ''}.`,
          action: r.added!.length ? { label: 'Undo', run: async () => { await sb.from('topics').update({ archived_at: new Date().toISOString() }).in('id', r.added!); await reload() } } : undefined })
      }}>
        <label className="field full"><span>Add topics (one per line; numbers like “4.2” are kept as the spec reference)</span>
          <textarea className="textarea" rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'1.1 Complex numbers\n1.2 Matrices\n1.3 Further algebra'} />
        </label>
        <div className="full"><button className="btn primary" disabled={busy === 'add' || !paste.trim()}>{busy === 'add' ? 'Adding…' : 'Add topics'}</button></div>
      </form>
    </section>
  )
}

function Mistakes({ subjectId, study, reload, toast }: Props) {
  const today = todayISO()
  const topics = study.topics.filter((t) => t.subject_id === subjectId && !t.archived_at)
  const mine = study.mistakes.filter((m) => m.subject_id === subjectId && !m.reviewed_at)
  const due = dueMistakes(mine, today)
  const later = mine.filter((m) => !due.includes(m))
  const [body, setBody] = useState('')
  const [topicId, setTopicId] = useState('')
  const [busy, setBusy] = useState(false)
  const sb = getSupabase()
  const reviewed = async (id: string, text: string) => {
    setBusy(true)
    const e = await setReviewed(sb, id, true)
    await reload()
    setBusy(false)
    if (e) return toast({ kind: 'error', text: e })
    toast({ kind: 'ok', text: `Reviewed: ${text}`, action: { label: 'Undo', run: async () => { await setReviewed(sb, id, false); await reload() } } })
  }
  const name = (id: string | null) => topics.find((t) => t.id === id)?.name
  return (
    <section className="card s5" aria-labelledby="mis-h">
      <div className="ch"><span className="lbl" id="mis-h">Mistakes to review</span><span className="lbl">{due.length} due</span></div>
      {!mine.length && <Empty>Nothing to review. Log a mistake below (or tell the bot “Q5 wrong: sign error”).</Empty>}
      {[...due, ...later].map((m) => (
        <div key={m.id} className="res">
          <div style={{ minWidth: 0 }}>{m.body}<div className="kind">{name(m.topic_id) ? `${name(m.topic_id)} · ` : ''}{m.review_on <= today ? 'review now' : `back ${day(m.review_on)}`}</div></div>
          <button type="button" className="btn sm" disabled={busy} onClick={() => reviewed(m.id, m.body)}>Reviewed</button>
        </div>
      ))}
      <form className="formgrid" style={{ marginTop: 16 }} onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const r = await logMistake(sb, { subject_id: subjectId, topic_id: topicId || null, body })
        await reload()
        setBusy(false)
        if (r.error) return toast({ kind: 'error', text: r.error })
        setBody('')
        toast({ kind: 'ok', text: `Logged. It comes back on ${day(r.review_on!)}.`, action: { label: 'Undo', run: async () => { await sb.from('mistakes').update({ archived_at: new Date().toISOString() }).eq('id', r.id!); await reload() } } })
      }}>
        <label className="field full"><span>Log a mistake</span><input className="input" value={body} maxLength={500} onChange={(e) => setBody(e.target.value)} placeholder="Q5 wrong: sign error in the moments" /></label>
        {topics.length > 0 && <Select label="Topic (optional)" value={topicId} onChange={setTopicId} options={[{ value: '', label: 'None' }, ...topics.map((t) => ({ value: t.id, label: t.name }))]} />}
        <div className="full"><button className="btn" disabled={busy || !body.trim()}>Log it</button></div>
      </form>
    </section>
  )
}
