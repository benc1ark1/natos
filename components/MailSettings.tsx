'use client'
// Settings → Email watcher: whether each Gmail script is checking in, his flag/ignore rules (add, remove = archive),
// today's emails and what the watcher's AI cost per day. The bot can do all of this too (/mail, "ignore X").
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { cleanPattern, ruleWords, type MailRule } from '@/lib/mail/rules'
import { addDays, dowShort, shortDate, todayISO, zonedToUTC, dateISOOf } from '@/lib/time'
import { ErrorBox, Loading, useLoad, type ShowToast } from './ui'
import Select from './controls/Select'

type Acc = { account: string; address: string | null; via: string; last_seen_at: string | null }
type Data = { accounts: Acc[]; rules: MailRule[]; today: { kind: string | null }[]; cost: { date: string; cost: number }[] }

async function load(): Promise<Data> {
  const sb = getSupabase()
  const today = todayISO()
  const [a, r, t, u] = await Promise.all([
    sb.from('mail_accounts').select('account,address,via,last_seen_at'),
    sb.from('mail_rules').select('id,pattern,action,label,archived_at').is('archived_at', null).order('created_at'),
    sb.from('emails').select('kind').gte('received_at', zonedToUTC(today, '00:00')),
    sb.from('ai_usage').select('cost_usd,created_at').eq('feature', 'mail').gte('created_at', zonedToUTC(addDays(today, -6), '00:00')).limit(5000),
  ])
  for (const x of [a, r, t, u]) if (x.error) throw new Error(`Couldn’t read the email watcher: ${x.error.message}`)
  const cost = Array.from({ length: 7 }, (_, i) => ({ date: addDays(today, -i), cost: 0 }))
  for (const row of (u.data ?? []) as { cost_usd: number | string; created_at: string }[]) {
    const d = cost.find((c) => c.date === dateISOOf(row.created_at))
    if (d) d.cost += Number(row.cost_usd || 0)
  }
  return { accounts: (a.data ?? []) as Acc[], rules: (r.data ?? []) as MailRule[], today: (t.data ?? []) as { kind: string | null }[], cost }
}

const ago = (iso: string | null) => {
  if (!iso) return 'never'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  return m < 1 ? 'just now' : m < 120 ? `${m} min ago` : `${Math.round(m / 60)} h ago`
}
const usd = (n: number) => `$${n < 0.1 && n > 0 ? n.toFixed(3) : n.toFixed(2)}`

export default function MailSettings({ toast }: { toast: ShowToast }) {
  const { data, error, loading, reload } = useLoad(load)
  const [pattern, setPattern] = useState('')
  const [action, setAction] = useState<'flag' | 'ignore'>('flag')
  const [busy, setBusy] = useState(false)

  async function addRule() {
    const p = cleanPattern(pattern)
    if (!p) { toast({ kind: 'error', text: 'Type an address, a domain like @ucs.org.uk, or some words.' }); return }
    if (data?.rules.some((r) => r.pattern.toLowerCase() === p.toLowerCase())) { toast({ kind: 'error', text: `There’s already a rule for ${p}. Remove it first to change it.` }); return }
    setBusy(true)
    const { error: e } = await getSupabase().from('mail_rules').insert({ pattern: p, action }).select('id').single()
    setBusy(false)
    if (e) { toast({ kind: 'error', text: `Not saved: ${e.message}` }); return }
    setPattern('')
    await reload()
    toast({ kind: 'ok', text: `Saved: ${ruleWords({ pattern: p, action, label: null })}.` })
  }

  async function removeRule(r: MailRule) {
    setBusy(true)
    const { error: e } = await getSupabase().from('mail_rules').update({ archived_at: new Date().toISOString() }).eq('id', r.id).select('id').single()
    setBusy(false)
    if (e) { toast({ kind: 'error', text: `Not removed: ${e.message}` }); return }
    await reload()
    toast({ kind: 'ok', text: `Removed: ${ruleWords(r)}.` })
  }

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (loading && !data) return <Loading lines={3} />
  const d = data!
  const n = (k: string) => d.today.filter((x) => x.kind === k).length
  return (
    <div className="setlist">
      <p className="usub" style={{ margin: '0 0 10px' }}>
        A script in each Gmail account sends new emails’ sender, subject and preview line (never the whole email) every 15 minutes.
        Homework becomes a task card, events a calendar card, and emails that need a reply an alert on Telegram. It only reads: it never sends, deletes or marks emails.
      </p>
      {(['school', 'personal'] as const).map((k) => {
        const a = d.accounts.find((x) => x.account === k)
        return (
          <p key={k} style={{ margin: '0 0 6px' }}>
            <b>{k === 'school' ? 'School' : 'Personal'}</b>
            {a ? ` (${a.address ?? 'Gmail'}): checked ${ago(a.last_seen_at)}${a.via === 'calendar' ? ' · via the Homework feed calendar' : ''}` : ': not set up yet'}
          </p>
        )
      })}
      <p className="usub" style={{ margin: '4px 0 12px' }}>
        Today: {d.today.length} email{d.today.length === 1 ? '' : 's'} · {n('homework')} homework · {n('event')} events · {n('reply')} to reply · {n('ignore')} ignored
      </p>

      <div className="lbl" style={{ marginBottom: 6 }}>Rules</div>
      {d.rules.length === 0 && <p className="usub" style={{ margin: '0 0 8px' }}>None yet. Automated mail (newsletters, promos, no-reply) is ignored anyway.</p>}
      {d.rules.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span>{ruleWords(r)}</span>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => removeRule(r)}>Remove</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 14px' }}>
        <input className="input" style={{ flex: '1 1 180px' }} value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="@ucs.org.uk, sam@…, or words" aria-label="Sender, domain or words" />
        <Select value={action} onChange={(v) => setAction(v as 'flag' | 'ignore')} ariaLabel="What to do"
          options={[{ value: 'flag', label: 'Always flag' }, { value: 'ignore', label: 'Ignore' }]} />
        <button type="button" className="btn primary" disabled={busy || !pattern.trim()} onClick={addRule}>{busy ? 'Saving…' : 'Add rule'}</button>
      </div>

      <div className="lbl" style={{ marginBottom: 6 }}>AI cost per day</div>
      {d.cost.map((c) => (
        <div key={c.date} style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 260 }}>
          <span>{dowShort(c.date)} {shortDate(c.date)}</span><span>{usd(c.cost)}</span>
        </div>
      ))}
    </div>
  )
}
