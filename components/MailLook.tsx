'use client'
import { getSupabase } from '@/lib/supabase/client'
import { loadWorthALook, lookWhy, LOOK_DAYS } from '@/lib/mail/look'
import { gmailLink } from '@/lib/mail/rules'
import { dateISOOf, dowShort, shortDate } from '@/lib/time'
import { Empty, ErrorBox, Loading, useLoad } from './ui'

async function load() {
  const sb = getSupabase()
  const [emails, accs] = await Promise.all([loadWorthALook(sb), sb.from('mail_accounts').select('account,address')])
  return { emails, address: (a: string) => ((accs.data ?? []).find((x) => x.account === a)?.address as string | null) ?? null }
}

/** "Emails worth a look" under the Inbox (fix round 22): only CC'd, or between other people. No alerts for these. */
export default function MailLook() {
  const { data, error, loading, reload } = useLoad(load)
  return (
    <section className="card" aria-label="Emails worth a look" style={{ marginTop: 20 }}>
      <div className="lbl"><span className="n">//</span> Emails worth a look</div>
      <p style={{ margin: '4px 0 8px', color: 'var(--muted)', fontSize: 13 }}>Only CC’d, or between other people. No alerts for these. Last {LOOK_DAYS} days.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <Loading lines={2} />}
      {data && data.emails.length === 0 && <Empty>Nothing to look at.</Empty>}
      {data && data.emails.length > 0 && (
        <ul className="ilist">
          {data.emails.map((e) => {
            const d = dateISOOf(e.received_at)
            return (
              <li key={e.id}>
                <span>
                  <a href={gmailLink(data.address(e.account), e.thread_id)} target="_blank" rel="noopener noreferrer">
                    {e.from_name ?? e.from_email ?? 'Email'}: {e.subject ?? '(no subject)'} ↗
                  </a>{' '}
                  <span className="itag done">{dowShort(d)} {shortDate(d)} · {lookWhy(e.look)}{e.account === 'school' ? ' · school' : ''}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
