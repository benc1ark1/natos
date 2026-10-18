'use client'
// Whoop on Home (BUILD-GUIDE step 11): this morning's recovery, last night's sleep, today's strain, and a week of
// recovery as small bars. Only shown once Whoop has sent something (a card with nothing useful collapses).
import { moreSettings } from '@/lib/settings'
import { dowShort } from '@/lib/time'
import type { HomeData } from './HomeView'

const zone = (r: number | null, low: number) => (r == null ? 'var(--muted)' : r < low ? '#ff7a6b' : r >= 67 ? '#6fd3b2' : '#f2c76e')

export default function RecoveryCard({ data }: { data: HomeData }) {
  const days = data.whoop
  if (!days.length) return null
  const low = moreSettings(data.planning).lowRecovery
  const today = days.find((d) => d.on_date === data.today) ?? null
  const sleep = today?.sleep_minutes != null ? `${Math.floor(today.sleep_minutes / 60)}h ${String(today.sleep_minutes % 60).padStart(2, '0')}m` : null
  return (
    <section className="card reccard" aria-labelledby="rec-h">
      <div className="ch">
        <span className="lbl" id="rec-h"><span className="n">W //</span> Recovery</span>
        {today?.recovery != null && today.recovery < low && <span className="lbl" style={{ color: '#ff7a6b' }}>Low: go lighter today</span>}
      </div>
      <div className="recrow">
        <div className="recbig mono" style={{ color: zone(today?.recovery ?? null, low) }}>{today?.recovery != null ? `${today.recovery}%` : '—'}</div>
        <div className="usub">
          {[sleep && `${sleep} sleep${today?.sleep_performance != null ? ` (${today.sleep_performance}%)` : ''}`, today?.hrv != null && `HRV ${today.hrv}`, today?.resting_hr != null && `RHR ${today.resting_hr}`, today?.strain != null && `strain ${today.strain}`].filter(Boolean).join(' · ') || 'No score yet this morning.'}
        </div>
      </div>
      <div className="recbars" aria-label="Recovery, last 7 days">
        {days.map((d) => (
          <span key={d.on_date} title={`${dowShort(d.on_date)}: ${d.recovery ?? '—'}%`}>
            <i style={{ height: `${Math.max(4, d.recovery ?? 0)}%`, background: zone(d.recovery, low) }} />
            <b className="mono">{dowShort(d.on_date).slice(0, 1)}</b>
          </span>
        ))}
      </div>
    </section>
  )
}
