// Gym progress in words (queue item 6): /gym (this week's sessions, PRs, sets per muscle group, the balance check and
// next sessions), "how's my bench going?", and the brain's snapshot lines. Telegram HTML, escaped. Pure: no database.
import { addDays, dowShort, shortDate, weekStartISO } from '../time'
import { DEFAULT_EXERCISES, exerciseOf } from './catalogue'
import { balanceOf, bestsOf, e1rmOf, kgText, nextAll, nextFor, prsIn, r1, sessionsOf, setsText, volumeOf, weightWords, type Volume } from './progress'
import { DEFAULT_PREFS, MUSCLES, type Exercise, type GymPrefs, type LiftRow } from './types'

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
export const weekOf = (today: string) => { const from = weekStartISO(today); return { from, to: addDays(from, 6) } }

/** "chest 6 · back 4.5 · shoulders 3": the muscle groups that got any sets. */
export function volumeWords(v: Volume): string {
  const parts = MUSCLES.filter((m) => v.muscles[m] > 0).map((m) => `${m} ${r1(v.muscles[m])}`)
  return parts.length ? parts.join(' · ') : 'none yet'
}

/** A day's lifts as one line: "Bench press 80 kg × 5 × 3 · Overhead press 50 kg × 6, 6, 5". */
function dayLine(rows: LiftRow[], list: Exercise[]): string {
  const keys = [...new Set(rows.map((r) => r.exercise_key))]
  return keys.map((k) => { const ex = exerciseOf(k, list, rows.find((r) => r.exercise_key === k)?.exercise); return `${esc(ex.name)} ${esc(setsText(rows.filter((r) => r.exercise_key === k), ex))}` }).join(' · ')
}

/** /gym: this week (Mon–Sun) — sessions, PRs, sets per muscle group, the balance check, next sessions. */
export function gymWeekHtml(lifts: LiftRow[], today: string, list: Exercise[] = DEFAULT_EXERCISES, prefs: GymPrefs = DEFAULT_PREFS, opts: { missing?: boolean } = {}): string {
  if (opts.missing) return '🏋️ Lifts can’t be saved yet: run <b>supabase/gym.sql</b> in Supabase (SQL Editor → New query → paste → Run).'
  if (!lifts.length) return '🏋️ <b>No lifts logged yet.</b>\nAfter each exercise, send it like “bench 80x5x3” (80 kg × 5 reps × 3 sets) or “squat 100 5x5”, then ✅. Or import your Hevy history on the Training page.'
  const { from, to } = weekOf(today)
  const week = lifts.filter((l) => l.done_on >= from && l.done_on <= to)
  const lines = [`🏋️ <b>Gym this week</b> · ${day(from)} – ${day(to)}`]
  if (!week.length) lines.push('No lifts logged this week yet.')
  for (const d of [...new Set(week.map((l) => l.done_on))].sort()) lines.push(`<b>${day(d)}</b>: ${dayLine(week.filter((l) => l.done_on === d), list)}`)
  for (const p of prsIn(lifts, from, to, list, prefs)) lines.push(`🏆 ${esc(p.short)} <i>(${day(p.date)})</i>`)
  if (week.length) {
    const v = volumeOf(lifts, from, to, list)
    lines.push(`💪 Sets: ${volumeWords(v)}${v.unknown ? ` <i>(+${v.unknown} not in a muscle group)</i>` : ''}`)
    const b = balanceOf(v)
    if (b) lines.push(`⚖️ ${esc(b.line)}`)
  }
  const next = nextAll(lifts, today, list, prefs)
  if (next.length) lines.push('', '➡️ <b>Next sessions</b>', ...next.map((n) => `• ${esc(n.text)}`))
  return lines.join('\n')
}

/** "how's my bench going?": best, the trend over the last sessions, the last one and the next suggestion. */
export function exerciseHtml(lifts: LiftRow[], ex: Exercise, today: string, prefs: GymPrefs = DEFAULT_PREFS): string {
  const ss = sessionsOf(lifts, ex.key, ex, prefs)
  if (!ss.length) return `No ${esc(ex.name.toLowerCase())} logged yet. After your next session send it like “${esc(ex.aliases[0] ?? ex.name.toLowerCase())} 80x5x3” (kg × reps × sets).`
  const best = [...ss].sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))[0]
  const last = ss[ss.length - 1]
  const lines = [`📈 <b>${esc(ex.name)}</b>`]
  lines.push(best.e1rm != null
    ? `Best: e1RM <b>${kgText(best.e1rm)}</b> — ${esc(setsText([best.top], ex))} (${day(best.date)})${best.date >= weekOf(today).from ? ' 🏆 this week' : ''}`
    : `Best: ${esc(setsText([best.top], ex))} (${day(best.date)})`)
  const recent = ss.slice(-6)
  if (recent.length >= 2 && recent.every((s) => s.e1rm != null)) {
    const first = recent[0], end = recent[recent.length - 1]
    const pct = Math.round(((end.e1rm! - first.e1rm!) / first.e1rm!) * 1000) / 10
    lines.push(`Last ${recent.length} sessions (e1RM): ${recent.map((s) => r1(s.e1rm!).toFixed(1)).join(' → ')} kg <i>(${pct >= 0 ? '+' : ''}${pct}% since ${day(first.date)})</i>`)
  } else if (recent.length >= 2) lines.push(`Last ${recent.length} sessions: ${recent.map((s) => esc(setsText([s.top], ex))).join(' → ')}`)
  lines.push(`Last: ${esc(setsText(last.rows, ex))} (${day(last.date)})`)
  const n = nextFor(lifts, ex.key, ex, prefs)
  if (n) lines.push(`➡️ Next: ${esc(n.text.replace(`${ex.name}: `, ''))}`)
  if (ex.bodyweight && !prefs.bodyweightKg) lines.push('<i>Tell me your bodyweight (“my bodyweight is 70kg”) to get an e1RM for bodyweight moves.</i>')
  return lines.join('\n')
}

/** The brain's view of his gym: recent lifts (refs LF1…), bests with trends and next sessions, this week's volume. */
export function gymSnapshot(lifts: LiftRow[], recent: LiftRow[], today: string, list: Exercise[] = DEFAULT_EXERCISES, prefs: GymPrefs = DEFAULT_PREFS, missing = false) {
  const refs: [string, { kind: string; id: string; title: string; status: string | null; deadline: string | null }][] = []
  if (missing) return { sections: [{ title: 'Gym (lifts)', lines: ['Not set up yet: lift_sets needs supabase/gym.sql (lift_log changes say so).'] }], refs }
  if (!lifts.length && !recent.length) return { sections: [{ title: 'Gym (lifts; new ones with lift_log)', lines: ['No lifts logged yet.'] }], refs }
  const lines = recent.slice(0, 10).map((r, i) => {
    const ex = exerciseOf(r.exercise_key, list, r.exercise)
    const ref = `LF${i + 1}`
    const what = `${ex.name} ${setsText([r], ex)}`
    refs.push([ref, { kind: 'lift', id: r.id, title: `${what} (${day(r.done_on)})`, status: null, deadline: null }])
    const e = e1rmOf(r, ex, prefs)
    return `${ref} | ${day(r.done_on)} | ${what}${e != null ? ` | e1RM ${kgText(e)}` : ''}${r.source === 'hevy' ? ' | from Hevy' : ''}`
  })
  const bests = bestsOf(lifts, list, prefs).slice(0, 8).map((b) => {
    const ex = exerciseOf(b.key, list, b.name)
    const n = nextFor(lifts, b.key, ex, prefs)
    return `${b.name}: best ${b.e1rm != null ? `e1RM ${kgText(b.e1rm)} (${setsText([b.top], ex)}, ${day(b.date)})` : `${setsText([b.top], ex)} (${day(b.date)})`} · ${b.sessions} session${b.sessions === 1 ? '' : 's'}, last ${day(b.last)}${b.trend != null ? ` · ${b.trend >= 0 ? '+' : ''}${b.trend}% over ~4 weeks` : ''}${n ? ` · next ${n.text.replace(`${b.name}: `, '')}` : ''}`
  })
  const { from, to } = weekOf(today)
  const v = volumeOf(lifts, from, to, list)
  const b = balanceOf(v)
  const prs = prsIn(lifts, addDays(today, -27), today, list, prefs)
  const week = [`Sets per muscle group this week (Mon–Sun): ${volumeWords(v)}`, ...(b ? [`Balance: ${b.line}`] : []),
    `PRs in the last 4 weeks: ${prs.length ? prs.slice(-6).map((p) => `${p.short} on ${day(p.date)}`).join('; ') : 'none'}`]
  return {
    sections: [
      { title: 'Gym: recent lifts (refs LF…: lift_edit / lift_archive change one; lift_log adds new ones)', lines: lines.length ? lines : ['(none recently)'] },
      { title: 'Gym: bests, trends and next sessions (e1RM = Epley estimate)', lines: bests },
      { title: 'Gym: this week', lines: week },
    ],
    refs,
  }
}

export { weightWords }
