'use client'
// This week's sets per muscle group (queue item 6): one bar each (Mon–Sun), the value at the tip, push vs pull under
// it and the one balance suggestion. A primary muscle counts each set, a secondary one half (lib/gym/progress.ts).
import { MUSCLES } from '@/lib/gym/types'
import type { Volume } from '@/lib/gym/progress'
import s from '@/app/training/training.module.css'

const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1))

export default function TrainingVolume({ volume, balance }: { volume: Volume; balance: { ok: boolean; line: string } | null }) {
  const max = Math.max(1, ...MUSCLES.map((m) => volume.muscles[m]))
  return (
    <>
      <div className={s.bars} role="list" aria-label="Sets per muscle group this week">
        {MUSCLES.map((m) => {
          const v = volume.muscles[m]
          return (
            <div key={m} role="listitem" className={`${s.bar} ${v ? '' : s.barzero}`} title={`${m}: ${n(v)} set${v === 1 ? '' : 's'} this week`} aria-label={`${m}: ${n(v)} sets`}>
              <span className={s.barlbl}>{m}</span>
              <span className={s.bartrack}>
                {v > 0 && <span className={s.barfill} style={{ width: `${Math.max(2, (v / max) * 82)}%` }} />}
                <span className={s.barval}>{n(v)}</span>
              </span>
            </div>
          )
        })}
      </div>
      <div className={s.split}>
        <span>Push <b>{n(volume.push)}</b></span><span>Pull <b>{n(volume.pull)}</b></span><span>Legs <b>{n(volume.legs)}</b></span><span>Core <b>{n(volume.core)}</b></span>
        {volume.unknown > 0 && <span>Other <b>{n(volume.unknown)}</b></span>}
      </div>
      {balance && <div className={s.balance}>{balance.ok ? '✓ ' : '⚖️ '}{balance.line}</div>}
    </>
  )
}
