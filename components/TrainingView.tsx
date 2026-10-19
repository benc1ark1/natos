'use client'
// The Training page (queue item 6): what to do next session, this week's sets per muscle group with the balance check,
// one exercise's e1RM over time, his PRs, recent sessions, and the Hevy import. Reads lift_sets as the signed-in user
// (row level security); logging happens in Telegram (“bench 80x5x3”), one message per exercise.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { addDays, dowShort, shortDate, todayISO, weekStartISO } from '@/lib/time'
import { exerciseCatalogue, exerciseOf } from '@/lib/gym/catalogue'
import { loadLifts } from '@/lib/gym/data'
import { balanceOf, bestsOf, e1rmOf, kgText, nextAll, prsIn, sessionsOf, setsText, volumeOf } from '@/lib/gym/progress'
import { gymPrefs } from '@/lib/gym/settings'
import type { LiftRow } from '@/lib/gym/types'
import { Empty, ErrorBox, Loading, useLoad, useToast } from './ui'
import TrainingChart from './TrainingChart'
import TrainingVolume from './TrainingVolume'
import TrainingImport from './TrainingImport'
import s from '@/app/training/training.module.css'

async function loadTraining() {
  const sb = getSupabase()
  const [prof, lifts] = await Promise.all([sb.from('profiles').select('planning').maybeSingle(), loadLifts(sb, { max: 20_000 })])
  return { planning: prof.data?.planning ?? null, lifts: lifts.rows, missing: lifts.missing }
}

const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`

export default function TrainingView() {
  const { data, error, loading, reload } = useLoad(loadTraining)
  const toast = useToast()
  const [picked, setPicked] = useState<string | null>(null)
  const today = todayISO()

  const v = useMemo(() => {
    if (!data) return null
    const list = exerciseCatalogue(data.planning), prefs = gymPrefs(data.planning)
    const lifts = data.lifts.filter((l) => l.done_on <= today)
    const from = weekStartISO(today), to = addDays(from, 6)
    const volume = volumeOf(lifts, from, to, list)
    const bests = bestsOf(lifts, list, prefs)
    const weekPrs = prsIn(lifts, from, to, list, prefs)
    // exercises with an e1RM to chart, most-logged first
    const charted = bests.filter((b) => b.e1rm != null).sort((a, b) => b.sessions - a.sessions || b.last.localeCompare(a.last))
    const byDay = new Map<string, LiftRow[]>()
    for (const l of [...lifts].reverse()) byDay.set(l.done_on, [...(byDay.get(l.done_on) ?? []), l])
    return { list, prefs, lifts, volume, balance: balanceOf(volume), bests, weekPrs, charted, next: nextAll(lifts, today, list, prefs, 21, 8), days: [...byDay.entries()].slice(0, 8), from, to }
  }, [data, today])

  const key = v ? (picked && v.charted.some((b) => b.key === picked) ? picked : v.charted[0]?.key ?? null) : null
  const chart = useMemo(() => {
    if (!v || !key) return null
    const ex = exerciseOf(key, v.list, v.charted.find((b) => b.key === key)?.name)
    const ss = sessionsOf(v.lifts, key, ex, v.prefs).filter((x) => x.e1rm != null)
    const best = Math.max(...ss.map((x) => x.e1rm!))
    const first = ss[0], last = ss[ss.length - 1]
    return { ex, best, change: ss.length > 1 ? Math.round(((last.e1rm! - first.e1rm!) / first.e1rm!) * 1000) / 10 : null, since: first.date,
      points: ss.map((x) => ({ date: x.date, e1rm: x.e1rm!, top: setsText([x.top], ex) })) }
  }, [v, key])

  return (
    <>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> Training</div>
          <h1 className="pagetitle serif">Gym progress</h1>
        </div>
        <span className="usub">Log in Telegram after each exercise: “bench 80x5x3” → ✅</span>
      </div>

      {error && <ErrorBox message={error} onRetry={reload} />}
      {!data && loading && <div className="card"><Loading lines={6} /></div>}
      {data?.missing && <div className="err" role="alert"><span>Lifts can’t be saved yet: run <b>supabase/gym.sql</b> in Supabase (SQL Editor → New query → paste → Run), then reload.</span></div>}

      {data && !data.missing && v && (
        <div className={s.grid}>
          {!v.lifts.length && (
            <div className={s.wide}>
              <Empty>No lifts yet. After each exercise, send it to the bot like “bench 80x5x3” (80 kg × 5 reps × 3 sets), “squat 100 5x5” or “OHP 50 x 6,6,5”, then tap ✅. Or import your Hevy history below.</Empty>
            </div>
          )}

          {v.next.length > 0 && (
            <section className="card" aria-labelledby="next-h">
              <div className="ch"><span className="lbl" id="next-h"><span className="n">N //</span> Next session</span><span className="lbl">double progression</span></div>
              <ul className={s.list}>
                {v.next.map((n) => (
                  <li key={n.key}>
                    <span className={s.name}>{n.name}</span>
                    <span className={s.value}>{n.text.replace(`${n.name}: `, '').replace(/ \(.*\)$/, '')}</span>
                    <span className={s.why}>{n.kind === 'deload' ? '↓ ' : n.kind === 'weight' ? '↑ ' : ''}{n.why}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {v.lifts.length > 0 && (
            <section className="card" aria-labelledby="week-h">
              <div className="ch"><span className="lbl" id="week-h"><span className="n">W //</span> This week</span><span className="lbl">{shortDate(v.from)} – {shortDate(v.to)}</span></div>
              {v.volume.sets ? <TrainingVolume volume={v.volume} balance={v.balance} /> : <Empty>Nothing logged this week yet.</Empty>}
              {v.weekPrs.length > 0 && <ul className={s.list} style={{ marginTop: 14 }} aria-label="PRs this week">{v.weekPrs.map((p) => <li key={`${p.key}${p.date}`}><span className={s.line}>🏆 {p.short}</span><span className={s.meta}>{day(p.date)}</span></li>)}</ul>}
            </section>
          )}

          {chart && (
            <section className={`card ${s.wide}`} aria-labelledby="prog-h">
              <div className="ch"><span className="lbl" id="prog-h"><span className="n">P //</span> Progress · e1RM</span><span className="lbl">Epley estimate</span></div>
              {v.charted.length > 1 && (
                <div className={s.chips} role="group" aria-label="Exercise">
                  {v.charted.slice(0, 12).map((b) => <button key={b.key} className={s.chip} aria-pressed={b.key === key} onClick={() => setPicked(b.key)}>{b.name}</button>)}
                </div>
              )}
              <div className={s.name}>{chart.ex.name}</div>
              <div className={s.head}>
                <span className={s.big}>{kgText(chart.points[chart.points.length - 1].e1rm)}</span>
                {chart.change != null && <span className={chart.change >= 0 ? s.up : s.down}>{chart.change >= 0 ? '+' : ''}{chart.change}% since {day(chart.since)}</span>}
                <span className={s.meta}>best {kgText(chart.best)}</span>
              </div>
              <TrainingChart name={chart.ex.name} points={chart.points} />
            </section>
          )}

          {v.bests.length > 0 && (
            <section className="card" aria-labelledby="prs-h">
              <div className="ch"><span className="lbl" id="prs-h"><span className="n">R //</span> PRs</span><span className="lbl">best e1RM</span></div>
              <ul className={s.list}>
                {v.bests.slice(0, 15).map((b) => {
                  const ex = exerciseOf(b.key, v.list, b.name)
                  return (
                    <li key={b.key}>
                      <span className={s.name}>{b.name}{v.weekPrs.some((p) => p.key === b.key) ? ' 🏆' : ''}</span>
                      <span className={s.value}>{b.e1rm != null ? kgText(b.e1rm) : setsText([b.top], ex)}</span>
                      <span className={s.why}>{setsText([b.top], ex)} · {day(b.date)}{b.trend != null ? ` · ${b.trend >= 0 ? '+' : ''}${b.trend}% in ~4 weeks` : ''}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {v.days.length > 0 && (
            <section className="card" aria-labelledby="rec-h">
              <div className="ch"><span className="lbl" id="rec-h"><span className="n">S //</span> Recent sessions</span></div>
              {v.days.map(([d, rows]) => {
                const keys = [...new Set(rows.map((r) => r.exercise_key))]
                return (
                  <div key={d} className={s.day}>
                    <div className={s.dayh}>{day(d)}{rows.some((r) => r.source === 'hevy') && <span className={s.src}>Hevy</span>}</div>
                    {keys.map((k) => {
                      const mine = rows.filter((r) => r.exercise_key === k).reverse()
                      const ex = exerciseOf(k, v.list, mine[0].exercise)
                      const es = mine.map((r) => e1rmOf(r, ex, v.prefs)).filter((x): x is number => x != null)
                      return <div key={k} className={s.line}><b style={{ fontWeight: 500, color: 'var(--fg-hi)' }}>{ex.name}</b> {setsText(mine, ex)}{es.length ? <span className={s.meta}> · <span className={s.nowrap}>e1RM {kgText(Math.max(...es))}</span></span> : null}</div>
                    })}
                  </div>
                )
              })}
            </section>
          )}

          <div className={v.lifts.length ? '' : s.wide}><TrainingImport toast={toast.show} onDone={reload} /></div>
          <p className={`${s.note} ${s.wide}`}>Muscle groups count a set for the muscle an exercise trains most and half a set for the ones it helps. Rep ranges, deloads and your bodyweight are in <Link href="/settings">Settings → Gym progress</Link>. Message Owen with /owen in Telegram.</p>
        </div>
      )}
      {toast.node}
    </>
  )
}
