'use client'
// Today on Home (queue item 5): the same list as the 07:30 morning message. At most 5 things, in time order, each with
// exactly what to open and one tap to mark it done (a second tap puts it back); the fixed commitments in one line;
// "+N more" collapsed. Worked out and saved on the server (app/api/today, lib/today). A tick only shows once the
// database has confirmed it.
import { useCallback, useEffect, useState } from 'react'
import { CheckIcon, ErrorBox, Loading, type ShowToast } from '../ui'

type Item = {
  key: string; at: string | null; end: string | null; title: string; open: string; url: string | null; minutes: number; why: string
  kind: 'study' | 'task' | 'training'; isDone: boolean; blockIds: string[]; taskId: string | null; rolledFrom: string | null; shortened?: boolean
}
type Hidden = { key: string; title: string; open: string; minutes: number; why: string }
type Plan = { date: string; mode: 'half_term' | 'school'; items: Item[]; fixed: string; more: number; hidden: Hidden[]; noTime: boolean; note: string | null }

const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
const target = (it: Item) => (it.blockIds[0] ? { blockId: it.blockIds[0] } : it.taskId ? { taskId: it.taskId } : null)
/** The bot's HTML question as plain words (the titles in it are escaped). */
const plainText = (h: string) => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const KIND: Record<Item['kind'], string> = { study: 'Study', task: 'To do', training: 'Training' }

export default function TodayView({ toast, onChanged }: { toast: ShowToast; onChanged?: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await fetch('/api/today', { cache: 'no-store' })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error ?? 'Couldn’t work out today.')
      setPlan(j.plan)
    } catch (e) { setError(e instanceof Error ? e.message : 'Couldn’t work out today.') }
  }, [])
  useEffect(() => { load() }, [load])

  async function tick(it: Item, undo = false) {
    const t = target(it)
    if (!t || busy) return
    setBusy(it.key)
    try {
      // the state he wants, so a double tap (or a page left open) never flips it back
      const r = await fetch('/api/today', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...t, done: !it.isDone }) })
      const j = await r.json().catch(() => ({ ok: false, error: 'Not saved.' }))
      if (!j.ok) { toast({ kind: 'error', text: j.error ?? 'Not saved.' }); return }
      setPlan(j.plan)
      onChanged?.()
      if (j.same) return   // it already was (another tap or the bot got there first): nothing changed
      // only what the database confirmed: "put back", or what stayed because it was changed since
      if (undo || !j.done) { toast({ kind: 'ok', text: j.note ?? (undo ? `Put back: ${j.title}.` : `Not done: ${j.title}.`) }); return }
      if (j.ask) { toast({ kind: 'ok', text: plainText(j.ask).replace(/^📝 /, '') }); return }
      toast({ kind: 'ok', text: `Done: ${j.title}${j.changed ? ` · ${j.changed}` : ''}.`, action: { label: 'Undo', run: () => tick({ ...it, isDone: true }, true) } })
    } catch {
      toast({ kind: 'error', text: 'Not saved: check your connection and try again.' })
    } finally { setBusy(null) }
  }

  const done = plan?.items.filter((i) => i.isDone).length ?? 0
  return (
    <section className="card s8 todaycard" aria-labelledby="today-h" aria-busy={!plan && !error}>
      <div className="ch">
        <h2 className="lbl" id="today-h">Today{plan?.mode === 'half_term' ? <span className="tmode"> · half-term</span> : null}</h2>
        {plan && plan.items.length > 0 && <span className="lbl">{done}/{plan.items.length} done</span>}
      </div>
      {plan?.fixed && <p className="tfixed">{plan.fixed}</p>}
      {error && <ErrorBox message={error} onRetry={load} />}
      {!plan && !error && <Loading lines={4} />}
      {plan && (
        <>
          {plan.note && <p className="tnote">{plan.note}</p>}
          {plan.items.length === 0 ? (
            <div className="empty">Nothing planned for today. Enjoy it, or capture something above and it’ll be planned in.</div>
          ) : (
            <ol className="tlist">
              {plan.items.map((it) => {
                const t = target(it)
                return (
                  <li key={it.key} className={`titem ${it.isDone ? 'done' : ''} ${busy === it.key ? 'pending' : ''}`}>
                    <button className="tcheck" disabled={!t || !!busy} aria-pressed={it.isDone}
                      aria-label={t ? `${it.isDone ? 'Mark not done' : 'Mark done'}: ${it.title}` : `${it.title} (no time today)`} onClick={() => tick(it)}>
                      <span className={`chk ${it.isDone ? 'on' : ''}`}>{it.isDone && <CheckIcon />}</span>
                    </button>
                    <div className="tbody">
                      <div className="ttop">
                        <span className="ttime mono">{it.at ?? 'any time'}</span>
                        <span className="tkind">{KIND[it.kind]}</span>
                        <span className="tdur">{mins(it.minutes)}</span>
                      </div>
                      <div className="ttl">{it.title}</div>
                      {it.open && !it.isDone && <div className="topen">{it.url ? <a href={it.url} target="_blank" rel="noreferrer">{it.open}</a> : it.open}</div>}
                      {it.why && !it.isDone && <div className="twhy">{it.why}</div>}
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          {plan.more > 0 && (
            <div className="tmore">
              <button className="btn ghost sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : `+${plan.more} more`}</button>
              {open && (
                <ul className="thidden">
                  {plan.hidden.map((h) => (
                    <li key={h.key}><span className="ttl">{h.title}</span> <span className="tdur">{mins(h.minutes)}</span>{h.open && <div className="topen">{h.open}</div>}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
