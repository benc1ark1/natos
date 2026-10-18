'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { moveTask, undoMove } from '@/lib/data'
import { QUICK_QUESTIONS, type AskAnswer, type AskResult, type PlanItem, type Turn } from '@/lib/ask/types'
import type { Task } from '@/lib/types'
import { ArrowIcon, type ShowToast } from '../ui'

/** Ask the server's planner. Never throws: a failure comes back as { ok: false }. */
async function askAI(question: string, history: Turn[]): Promise<AskResult> {
  try {
    const res = await fetch('/api/ask', {
      method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, history }),
    })
    const body = await res.json().catch(() => null)
    if (body && typeof body.ok === 'boolean') return body as AskResult
    return { ok: false, error: `Server replied ${res.status}.` }
  } catch {
    return { ok: false, error: 'Couldn’t reach the server.' }
  }
}

/** The answer as plain text, so a follow-up question knows what was said. */
const asText = (a: AskAnswer) => [a.answer, ...a.plan.map((p, i) => `${i + 1}. ${p.title}${p.focus ? ` (${p.focus})` : ''}${p.minutes ? ` — ${p.minutes} min` : ''}`)].join('\n')

const KIND_LABEL: Record<PlanItem['kind'], string> = { task: '', target: 'Weekly target', goal: 'Goal', routine: 'Routine', topic: 'Study', mistake: 'Mistake to review' }

/**
 * Ask AI: a planner that answers from Nat's own data. It only recommends.
 * The only changes possible here are taps Nat makes himself: "Move to Today" (with Undo) and "Save fact".
 */
export default function AskCard({ reload, toast, onCheckin, checkinDay }: { reload: () => Promise<void>; toast: ShowToast; onCheckin: () => void; checkinDay: boolean }) {
  const [q, setQ] = useState('')
  const [asked, setAsked] = useState('')
  const [state, setState] = useState<'idle' | 'thinking' | 'error'>('idle')
  const [error, setError] = useState('')
  const [answer, setAnswer] = useState<AskAnswer | null>(null)
  const [history, setHistory] = useState<Turn[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [moved, setMoved] = useState<Set<string>>(new Set())
  const [factSaved, setFactSaved] = useState(false)
  // "Move to Today" only makes sense when the question is about today
  const aboutLater = /\b(tomorrow|week|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(asked)

  async function ask(question: string) {
    const text = question.trim()
    if (!text || state === 'thinking') return
    setState('thinking'); setError(''); setAsked(text); setQ('')
    const res = await askAI(text, history)
    if (!res.ok) { setError(res.error); setState('error'); return }
    setAnswer(res.answer); setMoved(new Set()); setFactSaved(false); setState('idle')
    setHistory((h) => [...h, { q: text, a: asText(res.answer) }].slice(-4))
  }

  function reset() { setAnswer(null); setHistory([]); setAsked(''); setState('idle'); setError('') }

  async function toToday(p: PlanItem) {
    setBusy(p.id)
    const sb = getSupabase()
    const { data, error: e1 } = await sb.from('tasks').select('*').eq('id', p.id).single()
    const before = data as Task | null
    const err = e1 || !before ? `Couldn't find “${p.title}”: ${e1?.message ?? 'not found'}` : await moveTask(sb, before, 'today')
    setBusy(null)
    if (err) return toast({ kind: 'error', text: err })
    setMoved((m) => new Set(m).add(p.id))
    reload()
    toast({
      kind: 'ok', text: `Moved “${p.title}” to Today.`,
      action: { label: 'Undo', run: async () => {
        const e = await undoMove(sb, before!)
        if (e) return toast({ kind: 'error', text: e })
        setMoved((m) => { const n = new Set(m); n.delete(p.id); return n })
        toast({ kind: 'ok', text: 'Put back.' }); reload()
      } },
    })
  }

  async function saveFact(fact: string) {
    setBusy('fact')
    const { data, error: e } = await getSupabase().from('context_facts').insert({ fact, source_text: asked }).select('id').single()
    setBusy(null)
    if (e || !data) return toast({ kind: 'error', text: `Fact not saved: ${e?.message ?? 'unknown error'}` })
    setFactSaved(true)
    toast({ kind: 'ok', text: 'Fact saved. The AI will use it from now on.' })
  }

  return (
    <section className="card s12" aria-labelledby="ask-h">
      <div className="ch">
        <span className="lbl" id="ask-h"><span className="n">07 //</span> Ask AI</span>
        <button className={`btn sm ${checkinDay ? 'primary' : 'ghost'}`} onClick={onCheckin}>{checkinDay ? 'Check-in day: plan the week' : 'Weekly check-in'}</button>
      </div>
      <div className="askgrid">
        <div>
          <form className="askbox" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
            <label className="sr" htmlFor="ask">Ask AI</label>
            <input id="ask" className="askin" placeholder={answer ? 'Ask a follow-up…' : 'Ask anything…'} value={q} autoComplete="off"
              onChange={(e) => setQ(e.target.value)} readOnly={state === 'thinking'} maxLength={1000} />
            <button className="askgo" type="submit" aria-label="Ask" disabled={state === 'thinking' || !q.trim()}><ArrowIcon /></button>
          </form>
          <div className="chips">
            {QUICK_QUESTIONS.map((x) => <button key={x} className="chip" disabled={state === 'thinking'} onClick={() => { setHistory([]); ask(x) }}>{x}</button>)}
          </div>
        </div>

        <div className="answer" aria-live="polite">
          <div className="ch" style={{ marginBottom: 8 }}>
            <span className="lbl">{asked ? `“${asked.length > 60 ? `${asked.slice(0, 60)}…` : asked}”` : 'Answer'}</span>
            {answer && state !== 'thinking' && <button className="btn sm ghost" onClick={reset}>Clear</button>}
          </div>

          {state === 'thinking' && <div role="status">Reading your tasks, targets and calendar…</div>}
          {state === 'error' && (
            <div className="err" role="alert">
              <span>{error}</span>
              <button className="btn sm" onClick={() => ask(asked)}>Try again</button>
            </div>
          )}
          {state === 'idle' && !answer && (
            <div>Ask what to do tonight, how a week is going, or what you’re forgetting. It answers from your own tasks, targets and calendar, and only recommends: nothing changes unless you tap it.</div>
          )}

          {state === 'idle' && answer && (
            <div className="askans">
              <p style={{ whiteSpace: 'pre-line', margin: 0, color: 'var(--fg-2)' }}>{answer.answer}</p>
              {answer.plan.length > 0 && (
                <ol className="askplan">
                  {answer.plan.map((p, i) => (
                    <li key={`${p.kind}${p.id}${i}`}>
                      <div className="askitem">
                        <span className="asktitle">
                          {p.title}{p.focus && <span className="askfocus"> · {p.focus}</span>}
                          {p.minutes && <span className="mono askmin"> — {p.minutes} min</span>}
                        </span>
                        {p.kind === 'task' && p.status !== 'today' && !aboutLater && (
                          moved.has(p.id)
                            ? <span className="lbl ok">In Today</span>
                            : <button className="btn sm" disabled={busy === p.id} onClick={() => toToday(p)}>{busy === p.id ? 'Moving…' : 'Move to Today'}</button>
                        )}
                      </div>
                      {(p.why || KIND_LABEL[p.kind]) && <div className="askwhy">{KIND_LABEL[p.kind] && <span className="lbl">{KIND_LABEL[p.kind]} </span>}{p.why}</div>}
                    </li>
                  ))}
                </ol>
              )}
              {answer.unsure && <div className="askwhy" style={{ marginTop: 10 }}><span className="lbl">Not sure · </span>{answer.unsure}</div>}
              {answer.notes.map((n) => <div key={n} className="askwhy">{n}</div>)}
              {answer.fact_to_save && (
                <div className="askfact">
                  <span>Save as a fact about you? “{answer.fact_to_save}”</span>
                  {factSaved
                    ? <span className="lbl ok">Saved</span>
                    : <button className="btn sm primary" disabled={busy === 'fact'} onClick={() => saveFact(answer.fact_to_save!)}>{busy === 'fact' ? 'Saving…' : 'Save fact'}</button>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
