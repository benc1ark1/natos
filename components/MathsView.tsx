'use client'
import Link from 'next/link'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { loadOpenTasks, rows } from '@/lib/data'
import { loadStudy, setTopicStatus } from '@/lib/study-data'
import { moreSettings } from '@/lib/settings'
import { todayISO, daysBetween, dowShort, shortDate } from '@/lib/time'
import { DOT, STATUSES, STATUS_WORD, courses, modeLine, modeOf, nextBlocks, sectionOf, statusOf, topicsOf, type MathsTopic, type MathsWorld, type Status } from '@/lib/maths'
import type { Goal } from '@/lib/types'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'

async function loadMaths(): Promise<MathsWorld> {
  const sb = getSupabase()
  const [study, subs, tasks, goals, prof] = await Promise.all([
    loadStudy(sb), sb.from('subjects').select('id,name').is('archived_at', null), loadOpenTasks(sb),
    sb.from('goals').select('id,title,kind,subject_id,target_date,topics,archived_at').is('archived_at', null),
    sb.from('profiles').select('planning').maybeSingle(),
  ])
  return {
    today: todayISO(), subjects: rows<{ id: string; name: string }>(subs, 'subjects'), topics: study.topics as MathsTopic[], tasks,
    goals: rows<Pick<Goal, 'id' | 'title' | 'kind' | 'subject_id' | 'target_date' | 'topics' | 'archived_at'>>(goals, 'goals'), settings: moreSettings(prof.data?.planning ?? null),
  }
}

const COLOR: Record<Status, string> = { not_started: 'var(--muted)', not_secure: '#e5484d', understand: '#f5c542', exam_ready: '#3dd68c' }

/** Maths tracker: courses → sections → topics; tap a colour to change it. The mode, the next topic, the next test. */
export default function MathsView() {
  const { data, error, loading, reload } = useLoad(loadMaths)
  const toast = useToast()
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  async function set(t: MathsTopic, s: Status) {
    if (statusOf(t) === s) { setOpen(null); return }
    setSaving(t.id)
    const r = await setTopicStatus(getSupabase(), [t.id], s)
    setSaving(null)
    if (r.error) return toast.show({ kind: 'error', text: r.error })
    toast.show({ kind: 'ok', text: `${t.name}: ${DOT[s]} ${STATUS_WORD[s]}.` })
    setOpen(null); reload()
  }

  const cs = data ? courses(data) : []
  const mode = data ? modeOf(data) : null
  const next = data ? nextBlocks(data, 1)[0] : null
  const test = data?.goals.filter((g) => g.kind === 'test' && g.target_date && g.target_date >= data.today && cs.some((c) => c.id === g.subject_id))
    .sort((a, b) => a.target_date!.localeCompare(b.target_date!))[0]

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> <Link href="/subjects">Subjects</Link></div>
          <h1 className="pagetitle serif">Maths tracker</h1>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <div className="card"><Loading lines={6} /></div>}
      {data && !cs.length && <Empty>No maths courses found. Check “Maths courses” in Settings.</Empty>}
      {data && cs.length > 0 && (
        <>
          <section className="card mnow" aria-label="What's next">
            <div className="lbl">Mode</div>
            <div className="mmode">{mode && modeLine(mode)}</div>
            {next && <><div className="lbl" style={{ marginTop: 10 }}>Next</div><div className="mnext">{next.title} <span className="usub">{next.minutes}m</span></div></>}
            {test && <div className="usub" style={{ marginTop: 8 }}>📝 {test.title}: {dowShort(test.target_date!)} {shortDate(test.target_date!)} (in {daysBetween(data.today, test.target_date!)} days){test.topics ? ` · ${test.topics}` : ''}</div>}
            <div className="usub" style={{ marginTop: 8 }}>Per topic: textbook → questions → set its colour → next. {data.settings.mathsResources}</div>
          </section>
          {cs.map((c) => {
            const list = topicsOf(data, c.id)
            const n = (s: Status) => list.filter((t) => statusOf(t) === s).length
            const sections = [...new Set(list.map((t) => sectionOf(t).section))]
            return (
              <section key={c.id} className="card mcourse" aria-labelledby={`mc-${c.id}`}>
                <div className="ch"><span className="lbl" id={`mc-${c.id}`}>{c.name}</span><span className="usub">{n('exam_ready')}/{list.length} 🟢 · {n('understand')} 🟡 · {n('not_secure')} 🔴</span></div>
                <div className="mbar" role="img" aria-label={`${n('exam_ready')} exam ready, ${n('understand')} understood, ${n('not_secure')} not secure, ${n('not_started')} not started`}>
                  {(['exam_ready', 'understand', 'not_secure'] as Status[]).map((s) => <span key={s} style={{ width: `${(n(s) / Math.max(1, list.length)) * 100}%`, background: COLOR[s] }} />)}
                </div>
                {list.length === 0 && <Empty>No topics yet.</Empty>}
                {sections.map((s) => (
                  <div key={s} className="msec">
                    <div className="lbl">{s}</div>
                    <ul className="mlist">
                      {list.filter((t) => sectionOf(t).section === s).map((t) => (
                        <li key={t.id}>
                          <button className="mtopic" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id} disabled={saving === t.id}>
                            <span className="mn mono">{sectionOf(t).n}</span><span aria-hidden="true">{DOT[statusOf(t)]}</span>
                            <span className="mt">{t.name}</span><span className="usub">{saving === t.id ? 'Saving…' : STATUS_WORD[statusOf(t)]}</span>
                          </button>
                          {open === t.id && (
                            <div className="mpick" role="group" aria-label={`Colour for ${t.name}`}>
                              {STATUSES.map((st) => (
                                <button key={st} className={`btn sm ${statusOf(t) === st ? 'primary' : 'ghost'}`} onClick={() => set(t, st)} disabled={saving === t.id}>{DOT[st]} {STATUS_WORD[st]}</button>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            )
          })}
        </>
      )}
      {toast.node}
    </>
  )
}
