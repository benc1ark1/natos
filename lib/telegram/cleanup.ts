// Server-only: the calendar clean-up card (Build O part 0). Every recurring session the app knows, from his Life OS
// events and his read-only Google calendars, each with ✓ Keep / 🗄 Archive (tap to switch), then one ✅ Apply.
// Archive = archive only: his own sessions are archived (restorable); a read-only Google session stays in Google and
// the app ignores it from then on (planning, lists, questions). ↩️ Undo puts everything back.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEvents, isRepeating } from '../events'
import { ignoredSessions } from '../setup'
import { guessType, trainingTypes } from '../training'
import { addDays, isoDow, todayISO } from '../time'
import type { EventRow } from '../types'
import type { Action } from './actions'
import { editCard, esc, type Button } from './api'
import { plain, say } from './turns'

export type CleanRow = { title: string; when: string; source: 'own' | 'google' | 'lessons'; ids: string[]; titles: string[]; keep: boolean }

const DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const daysWords = (days: number[]) => {
  const d = [...new Set(days)].sort()
  return d.length === 5 && d.join() === '1,2,3,4,5' ? 'Mon–Fri' : d.map((x) => DAY[x - 1]).join(', ')
}

/** Every recurring session: his own weekly events, and Google sessions that come back each week (school lessons as one row). */
export function recurringRows(events: EventRow[], planning: unknown, today: string, archive: string[] = []): CleanRow[] {
  const ignored = new Set(ignoredSessions(planning).map(norm))
  const pre = new Set(archive.map(norm))
  const types = trainingTypes(planning)
  const rows: CleanRow[] = []
  for (const e of events.filter((x) => !x.archived_at && x.external_source !== 'google' && x.external_source !== 'setup' && isRepeating(x))) {
    rows.push({ title: e.title, when: `${daysWords(e.repeat_days!)} ${e.start_time!.slice(0, 5)}${e.end_time ? `–${e.end_time.slice(0, 5)}` : ''}`, source: 'own', ids: [e.id], titles: [e.title], keep: !pre.has(norm(e.title)) })
  }
  // Google copies: the same name coming back on the same weekday = a recurring session
  const occ = expandEvents(events.filter((x) => x.external_source === 'google' && !x.all_day && !x.archived_at), addDays(today, -28), addDays(today, 42), [])
  const by = new Map<string, { title: string; slots: Map<string, number>; days: number[]; ids: string[]; lesson: boolean }>()
  for (const o of occ) {
    if (!o.start || ignored.has(norm(o.event.title))) continue
    const k = norm(o.event.title)
    const x = by.get(k) ?? { title: o.event.title, slots: new Map<string, number>(), days: [] as number[], ids: [] as string[], lesson: true }
    const slot = `${isoDow(o.date)} ${o.start}`
    x.slots.set(slot, (x.slots.get(slot) ?? 0) + 1)
    x.days.push(isoDow(o.date))
    x.ids.push(o.event.id)
    // a lesson: weekdays inside the school day, and not something that looks like training
    if (isoDow(o.date) > 5 || o.start < '08:00' || (o.end ?? o.start) > '16:30' || guessType(o.event.title, types)) x.lesson = false
    by.set(k, x)
  }
  const lessons: string[] = []
  for (const x of by.values()) {
    if (![...x.slots.values()].some((n) => n >= 2)) continue   // a one-off, not recurring
    if (x.lesson) { lessons.push(x.title); continue }
    const top = [...x.slots.entries()].sort((a, b) => b[1] - a[1])
    const times = [...new Set(top.map(([s]) => s.split(' ')[1]))]
    rows.push({ title: x.title, when: `${daysWords(top.map(([s]) => Number(s.split(' ')[0])))} ${times.length === 1 ? times[0] : `${times[0]}…`}`, source: 'google', ids: [...new Set(x.ids)], titles: [x.title], keep: !pre.has(norm(x.title)) })
  }
  if (lessons.length) rows.push({ title: `School lessons (${lessons.length}: ${lessons.slice(0, 4).join(', ')}${lessons.length > 4 ? '…' : ''})`, when: 'Mon–Fri', source: 'lessons', ids: [], titles: lessons, keep: true })
  return rows
}

/** The changes the card's choices mean (recomputed on every tap). */
export function cleanupActions(rows: CleanRow[], planning: unknown): Action[] {
  const out: Action[] = []
  for (const r of rows.filter((x) => !x.keep && x.source === 'own')) {
    out.push({ op: 'event_cancel', table: 'events', id: r.ids[0], title: r.title, line: `🗄 <b>${esc(r.title)}</b>: archived <i>(can be restored)</i>`, patch: { archived_at: '__now__' } })
  }
  const google = rows.filter((x) => !x.keep && x.source !== 'own').flatMap((x) => x.titles)
  if (google.length) {
    const list = [...new Set([...ignoredSessions(planning), ...google])]
    out.push({ op: 'session_ignore', table: 'profiles', id: 'ignoredSessions', title: google.join(', '), line: `🗄 <b>${esc(google.join(', '))}</b>: ignored by the app <i>(stays in Google)</i>`, patch: { ignoredSessions: list } })
  }
  return out
}

export const cleanupText = (rows: CleanRow[]) => [
  '🧹 <b>Calendar clean-up</b>: what still happens?',
  '<i>Tap a session below to switch it between ✓ Keep and 🗄 Archive, then ✅ Apply. Archive is archive only: your own sessions can be restored; Google ones stay in Google and the app just ignores them.</i>',
  '',
  ...rows.map((r, i) => `${r.keep ? '✓' : '🗄'} ${i + 1}. <b>${esc(r.title)}</b> · ${esc(r.when)} · ${r.source === 'own' ? 'Life OS' : 'Google'}${r.keep ? '' : ' → <b>archive</b>'}`),
].join('\n')

export const cleanupButtons = (id: string, rows: CleanRow[]): Button[][] => {
  const per = rows.map((r, i): Button => ({ text: `${r.keep ? '✓' : '🗄'} ${i + 1} ${r.title}`.slice(0, 36), callback_data: `c:${id}:r${i}` }))
  const out: Button[][] = []
  for (let i = 0; i < per.length; i += 2) out.push(per.slice(i, i + 2))
  out.push([{ text: '✅ Apply', callback_data: `a:${id}` }, { text: '❌ Not now', callback_data: `x:${id}` }])
  return out
}

/** Send the card. `archive`: sessions pre-set to Archive (his words: "EFA training no longer happens"). */
export async function sendCleanup(sb: SupabaseClient, chatId: number, archive: string[] = []): Promise<boolean> {
  const [{ data: evs }, { data: prof }] = await Promise.all([
    sb.from('events').select('*').is('archived_at', null),
    sb.from('profiles').select('planning').maybeSingle(),
  ])
  const planning = prof?.planning ?? null
  const today = todayISO()
  const rows = recurringRows((evs ?? []) as EventRow[], planning, today, archive)
  if (!rows.length) return false
  const body = cleanupText(rows)
  const actions = cleanupActions(rows, planning)
  const { data: row, error } = await sb.from('telegram_pending').insert({ kind: 'action', text: 'calendar clean-up', payload: { cleanup: rows, actions, problems: [], summary: plain(body) } }).select('id').single()
  if (error || !row) throw new Error(`Couldn’t hold the card: ${error?.message ?? 'not saved'}`)
  const msgId = await say(sb, chatId, body, cleanupButtons(row.id, rows), { pending_id: row.id, intent: 'instruction' })
  if (msgId) await sb.from('telegram_pending').update({ payload: { cleanup: rows, actions, problems: [], summary: plain(body), card_message_id: msgId } }).eq('id', row.id)
  return true
}

/** A tap on one session: switch it, and redraw the card in place. */
export async function toggleCleanup(sb: SupabaseClient, chatId: number, card: { id: string; payload: Record<string, unknown> }, arg: string, messageId?: number) {
  const rows = (card.payload.cleanup ?? []) as CleanRow[]
  const i = Number(arg.slice(1))
  if (!rows[i]) return
  rows[i] = { ...rows[i], keep: !rows[i].keep }
  const { data: prof } = await sb.from('profiles').select('planning').maybeSingle()
  const actions = cleanupActions(rows, prof?.planning ?? null)
  const body = cleanupText(rows)
  await sb.from('telegram_pending').update({ payload: { ...card.payload, cleanup: rows, actions, summary: plain(body) } }).eq('id', card.id)
  const msg = messageId ?? (card.payload.card_message_id as number | undefined)
  if (msg) await editCard(chatId, msg, body, cleanupButtons(card.id, rows)).catch(() => null)
}
