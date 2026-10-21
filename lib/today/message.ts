// The Today list as a Telegram message (the 07:30 morning message, which is also the pinned Today) and the evening
// "tap what you did" message, with one tap per item. Callback data: `tdy:<view><target><want>:<id>` (≤ 64 bytes; want 1/0 = done/not done, missing in older messages = toggle):
// view m = the Today list, e = the evening message; target b = a saved plan block, t = a task (not saved as a block).
// Pure: no database, no clock.
import type { TodayItem, TodayPlan } from './build'
import { longDate } from '../time'

export type Button = { text: string; callback_data?: string; url?: string }
export type TodayView = 'm' | 'e'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`)
const icon = (it: TodayItem) => (it.kind === 'training' ? '🏋️' : it.kind === 'task' ? '📌' : '📚')

/** Item 18: Today is an ordered list with minutes. Only a booked training session shows its clock time (he has to be
 *  there then); study and tasks are done in the list's order, so they show no time. (School and events: the fixed line.) */
export const clockOf = (it: Pick<TodayItem, 'kind' | 'at'>): string | null => (it.kind === 'training' ? it.at : null)

/** The tap for one item: its first saved block, else its task; null when there's nothing to tick yet. */
export function tapData(view: TodayView, it: TodayItem): string | null {
  // the state the tap wants (1 = done, 0 = not done), so a double tap or an old message never flips it back
  const want = it.isDone ? 0 : 1
  if (it.blockIds[0]) return `tdy:${view}b${want}:${it.blockIds[0]}`
  if (it.taskId) return `tdy:${view}t${want}:${it.taskId}`
  return null
}

/** One button per item, one per row: "☐ Physics homework" / "☐ 16:30 Upper" / "✅ …" (tap again to undo). */
export function todayButtons(plan: Pick<TodayPlan, 'items'>, view: TodayView = 'm'): Button[][] {
  return plan.items.flatMap((it) => {
    const data = tapData(view, it)
    if (!data) return []
    return [[{ text: `${it.isDone ? '✅' : '☐'} ${clockOf(it) ? `${clockOf(it)} ` : ''}${it.title}`.slice(0, 48), callback_data: data }]]
  })
}

/** One item: "2. 📚 Physics homework · 45m" ("3. <b>16:30</b> 🏋️ Upper …" for training) and, under it, exactly what to open. */
export function itemLines(it: TodayItem, n?: number): string[] {
  const head = `${n ? `${n}. ` : ''}${clockOf(it) ? `<b>${clockOf(it)}</b> ` : ''}${icon(it)} ${esc(it.title)} <i>· ${mins(it.minutes)}</i>`
  const open = it.open ? `     ↳ ${it.url ? `<a href="${esc(it.url)}">${esc(it.open)}</a>` : esc(it.open)}` : ''
  if (it.isDone) return [`✅ <s>${head.replace(/<\/?[bi]>/g, '')}</s>`]
  return open ? [head, open] : [head]
}

/** The morning message / pinned Today: the date, the fixed line, the items, "+N more". Nothing else. */
export function todayHtml(plan: TodayPlan, opts: { all?: boolean } = {}): string {
  // (📌 like the pinned Today has always started: it is the pinned Today)
  const lines = [`📌 <b>Today · ${esc(longDate(plan.date))}</b>${plan.mode === 'half_term' ? ' · <i>half-term</i>' : ''}`]
  if (plan.fixed) lines.push(`<i>${esc(plan.fixed)}</i>`)
  lines.push('')
  if (plan.note) lines.push(`<i>${esc(plan.note)}</i>`)
  if (!plan.items.length && !plan.note) lines.push('<i>Nothing planned today: enjoy it, or say “what next?”.</i>')
  plan.items.forEach((it, i) => lines.push(...itemLines(it, i + 1)))
  if (plan.more) {
    if (opts.all) lines.push('', `<b>Also on the list</b> (${plan.more})`, ...plan.hidden.map((h) => `• ${esc(h.title)} <i>· ${mins(h.minutes)}</i>${h.open ? `\n     ↳ ${esc(h.open)}` : ''}`))
    else lines.push('', `<i>+${plan.more} more · /today all</i>`)
  }
  return lines.join('\n')
}

/** The evening message: today's items with a tap each; what isn't ticked moves on by itself. null if nothing was planned. */
export function eveningHtml(plan: TodayPlan): string | null {
  if (!plan.items.length) return null
  const done = plan.items.filter((it) => it.isDone).length
  const lines = [done === plan.items.length ? `🌙 <b>All ${done} done today.</b> 👏` : `🌙 <b>Tap what you did today</b> <i>(${done}/${plan.items.length} so far)</i>`]
  for (const it of plan.items) lines.push(it.isDone ? `✅ ${esc(it.title)}` : `☐ ${esc(it.title)}`)
  const study = plan.items.filter((it) => !it.isDone && it.kind !== 'training')
  if (study.length) lines.push('', '<i>Anything not ticked moves to tomorrow by itself.</i>')
  else if (plan.items.some((it) => !it.isDone)) lines.push('', '<i>Training not ticked stays with your week plan.</i>')
  return lines.join('\n')
}
