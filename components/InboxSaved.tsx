'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { safeUrl } from '@/lib/data'
import type { ContextFact, Resource } from '@/lib/types'
import type { ShowToast } from './ui'

type Props = { facts: ContextFact[]; resources: Resource[]; reload: () => void; toast: ShowToast }

/**
 * Two small lines under the Inbox: facts the AI knows about you, and saved links.
 * Collapsed by default so they never clutter. Archive (with Undo); nothing is deleted.
 */
export default function InboxSaved({ facts, resources, reload, toast }: Props) {
  const [open, setOpen] = useState<'facts' | 'links' | null>(null)

  async function archiveFact(f: ContextFact, active: boolean) {
    const sb = getSupabase()
    const { data, error } = await sb.from('context_facts').update({ is_active: active }).eq('id', f.id).select('id').single()
    reload()
    if (error || !data) return toast({ kind: 'error', text: `Not saved: ${error?.message ?? 'unknown error'}` })
    if (!active) toast({ kind: 'ok', text: 'Fact archived. The AI won’t use it.', action: { label: 'Undo', run: () => archiveFact(f, true) } })
  }

  async function archiveLink(r: Resource, archived: boolean) {
    const sb = getSupabase()
    const { data, error } = await sb.from('resources').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', r.id).select('id').single()
    reload()
    if (error || !data) return toast({ kind: 'error', text: `Not saved: ${error?.message ?? 'unknown error'}` })
    if (archived) toast({ kind: 'ok', text: `Archived “${r.title}”.`, action: { label: 'Undo', run: () => archiveLink(r, false) } })
  }

  const toggle = (k: 'facts' | 'links') => setOpen((o) => (o === k ? null : k))
  return (
    <section className="card isaved" aria-label="Facts and saved links">
      <div className="isaved-row">
        <button className="btn sm ghost" aria-expanded={open === 'facts'} onClick={() => toggle('facts')}>Facts about me ({facts.length})</button>
        <button className="btn sm ghost" aria-expanded={open === 'links'} onClick={() => toggle('links')}>Saved links ({resources.length})</button>
      </div>
      {open === 'facts' && (
        <ul className="ilist">
          {facts.length === 0 && <li><span>No facts yet. Capture one, e.g. “SMC is 7 October”.</span></li>}
          {facts.map((f) => (
            <li key={f.id}><span>{f.fact}</span><button className="btn sm ghost" onClick={() => archiveFact(f, false)}>Archive</button></li>
          ))}
        </ul>
      )}
      {open === 'links' && (
        <ul className="ilist">
          {resources.length === 0 && <li><span>No saved links yet. Capture a link, video or book.</span></li>}
          {resources.map((r) => {
            const url = safeUrl(r.url)
            return (
              <li key={r.id}>
                <span>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{r.title} ↗</a> : r.title} <span className="itag done">{r.kind}</span></span>
                <button className="btn sm ghost" onClick={() => archiveLink(r, true)}>Archive</button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
