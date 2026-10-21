// Server-only: the week he sends ("my week: Mon school till 4, football 6–7:30, CS tutor 8pm, Wed maths tutor 5pm,
// Sat game 10am…"). The AI only reads it into dated items (it never plans); the app keeps them for that week
// (week_notes, build-n.sql) and every week plan uses them with his calendars: busy time, and training sessions with a
// recovery cost. Nothing goes into his calendar. Sending the week again replaces it (the old one is archived).
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CHAT_MODEL, type Usage } from '../ai/models'
import { activeTypes, type TypeDef } from '../training'
import { addDays, dowShort, minutesOf, shortDate, zonedToUTC } from '../time'
import { expandEvents } from '../events'
import type { EventException, EventRow } from '../types'

export type WeekItem = {
  date: string; start: string; end: string; title: string
  kind: 'training' | 'school' | 'tutor' | 'other'
  training_type: string; intensity: '' | 'light' | 'moderate' | 'heavy'; travel_minutes: number; guessed_time?: boolean
  note?: WeekNoteRef   // a saved item: its week note (savedWeek), so one item can be left out of it
}
/** Where a saved item came from: the week_notes row, its place in that row's items, and the items as saved. */
export type WeekNoteRef = { id: string; i: number; items: unknown[] }

export const WEEK_READ_PROMPT = `You read the week Nat (a UK sixth-form student who plays football and trains in the gym) has typed out, into dated items. You don't plan anything and you never add things he didn't say.

Rules:
- One item per thing on one day. "Mon and Wed football 6–7:30" = two items. A thing every weekday = one item per day.
- date: one of the dates listed (use the weekday names next to them). Anything you can't pin to one of those days ("weekend games" with no day): leave it out and say so in note.
- start / end: 24-hour HH:MM. "6–7:30" in the evening is 18:00–19:30; "till 4" is an end of 16:00. No end given: "" (the app uses an hour, 90 minutes for a game). No time at all: start "" (the app guesses and says so).
- kind: training (football, matches/games, gym, sprints, any sport), school (lessons, school day), tutor (any tutor or lesson outside school), other (anything else that takes his time: appointments, travel he mentions, plans).
- training_type: for training, the key of one of his training types (listed); a match/game/fixture is the match type. "" for everything else.
- intensity: only if he said it (light / easy = light, moderate / medium = moderate, heavy / hard / max = heavy), else "".
- travel_minutes: only if he gave a journey time for that thing, else 0.
- title: short, his words ("Football training", "CS tutor", "Match").
- note: one short line on anything you left out or weren't sure of, else "".`

const SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'object', properties: {
      date: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, title: { type: 'string' },
      kind: { type: 'string', enum: ['training', 'school', 'tutor', 'other'] }, training_type: { type: 'string' },
      intensity: { type: 'string', enum: ['', 'light', 'moderate', 'heavy'] }, travel_minutes: { type: 'integer' },
    }, required: ['date', 'start', 'end', 'title', 'kind', 'training_type', 'intensity', 'travel_minutes'], additionalProperties: false } },
    note: { type: 'string' },
  },
  required: ['items', 'note'],
  additionalProperties: false,
}

const DAY = /\b(mon|tue|wed|thu|fri|sat|sun)(day|s|sday|nesday|rsday|urday)?\b|\b(today|tomorrow|weekend)\b/gi
const TIME = /\b\d{1,2}([:.]\d{2})?\s*(am|pm)\b|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*[-–]\s*\d{1,2}([:.]\d{2})?\b|\btill \d/gi

/** Does this message lay out his week (several days with times), rather than just ask about it? Plain code, no AI. */
export function looksLikeWeek(text: string): boolean {
  const days = new Set((text.match(DAY) ?? []).map((d) => d.slice(0, 3).toLowerCase()))
  return text.length >= 40 && days.size >= 2 && (text.match(TIME) ?? []).length >= 2
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const hm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The model's items, checked: real dates in the week, real times, his type keys. */
export function checkItems(raw: unknown, from: string, to: string, types: TypeDef[]): WeekItem[] {
  const list = Array.isArray(raw) ? raw : []
  const keys = new Set(activeTypes(types).map((t) => t.key))
  const out: WeekItem[] = []
  for (const x of list.slice(0, 60) as Record<string, unknown>[]) {
    const date = String(x.date ?? ''), title = String(x.title ?? '').trim().slice(0, 80)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > to || !title) continue
    const kind = (['training', 'school', 'tutor', 'other'].includes(String(x.kind)) ? x.kind : 'other') as WeekItem['kind']
    const type = kind === 'training' && keys.has(String(x.training_type)) ? String(x.training_type) : ''
    let start = HHMM.test(String(x.start)) ? String(x.start) : '', end = HHMM.test(String(x.end)) ? String(x.end) : ''
    const guessed = !start
    if (!start) { if (kind !== 'training') continue; start = type === 'match' ? '10:00' : '18:00' }   // a session with no time: a usual time, said on the card
    if (!end || minutesOf(end) <= minutesOf(start)) end = hm(Math.min(minutesOf(start) + (type === 'match' ? 90 : 60), 23 * 60 + 59))
    const intensity = ['light', 'moderate', 'heavy'].includes(String(x.intensity)) ? x.intensity as WeekItem['intensity'] : ''
    const travel = Number.isInteger(x.travel_minutes) && (x.travel_minutes as number) > 0 && (x.travel_minutes as number) <= 180 ? x.travel_minutes as number : 0
    out.push({ date, start, end, title, kind, training_type: type, intensity, travel_minutes: travel, ...(guessed ? { guessed_time: true } : {}) })
  }
  return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
}

/** Read his week with the AI. */
export async function readWeek(text: string, range: { from: string; to: string }, types: TypeDef[], onUsage?: (model: string, usage: Usage) => Promise<unknown>):
  Promise<{ ok: true; items: WeekItem[]; note: string } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'The AI key isn’t set up (ANTHROPIC_API_KEY).' }
  const dates: string[] = []
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) dates.push(`${d} = ${dowShort(d)} ${shortDate(d)}`)
  const client = new Anthropic({ timeout: 60_000, maxRetries: 1 })
  try {
    const res = await client.messages.create({
      model: CHAT_MODEL, max_tokens: 4000,
      system: WEEK_READ_PROMPT,
      messages: [{ role: 'user', content: `Dates:\n${dates.join('\n')}\n\nHis training types (key: name): ${activeTypes(types).map((t) => `${t.key}: ${t.label}`).join(', ')}\n\n<his_week>\n${text.slice(0, 3000)}\n</his_week>` }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    } as Anthropic.MessageCreateParamsNonStreaming)
    await onUsage?.(res.model ?? CHAT_MODEL, res.usage as Usage)
    const block = res.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') return { ok: false, error: 'I couldn’t read your week.' }
    const raw = JSON.parse(block.text) as { items: unknown; note: string }
    return { ok: true, items: checkItems(raw.items, range.from, range.to, types), note: String(raw.note ?? '').trim().slice(0, 300) }
  } catch (e) {
    return { ok: false, error: e instanceof Anthropic.APIError ? `AI error ${e.status ?? ''}`.trim() : 'I couldn’t read your week.' }
  }
}

/** Keep his week for planning (the older one for the same week is archived). False before build-n.sql runs. */
export async function saveWeek(sb: SupabaseClient, range: { from: string; to: string }, text: string, items: WeekItem[]): Promise<boolean> {
  const { error } = await sb.from('week_notes').insert({ week_from: range.from, week_to: range.to, text: text.slice(0, 4000), items })
  if (error) return false
  await sb.from('week_notes').update({ archived_at: new Date().toISOString() }).is('archived_at', null).lt('week_to', range.from)
  const { data } = await sb.from('week_notes').select('id').is('archived_at', null).eq('week_from', range.from).order('created_at', { ascending: false })
  const older = (data ?? []).slice(1).map((r) => r.id as string)
  if (older.length) await sb.from('week_notes').update({ archived_at: new Date().toISOString() }).in('id', older)
  return true
}

/** The week he sent for this range, if any (none before build-n.sql runs). */
export async function savedWeek(sb: SupabaseClient, range: { from: string; to: string }, types: TypeDef[]): Promise<WeekItem[]> {
  const { data, error } = await sb.from('week_notes').select('id,items,week_from,week_to').is('archived_at', null)
    .lte('week_from', range.to).gte('week_to', range.from).order('created_at', { ascending: false }).limit(1)
  if (error || !data?.length) return []
  // each item remembers its note and its place in it (1️⃣ on a clash with it leaves just that item out)
  const raw = Array.isArray(data[0].items) ? data[0].items as unknown[] : []
  return raw.flatMap((x, i) => checkItems([x], range.from, range.to, types).map((it) => ({ ...it, note: { id: data[0].id as string, i, items: raw } })))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
}

/** A row of his typed week in the planner (weekEvents "week:N"): in memory only, never a database id. */
export const isWeekRow = (id: string | null | undefined) => !!id && id.startsWith('week:')

/** His week note without the item a "week:N" row is (1️⃣ on a clash with it): every other item kept; ↩️ Undo puts the
 *  note back as it was. null when the row isn't a saved item. */
export function weekNoteWithout(rowId: string, sent: { note?: WeekNoteRef }[]): { id: string; items: unknown[] } | null {
  const note = isWeekRow(rowId) ? sent[Number(rowId.slice(5))]?.note : null
  return note ? { id: note.id, items: note.items.filter((_, k) => k !== note.i) } : null
}

/** His week as calendar-like events (in memory only), leaving out what his calendar already has at that time. Row
 *  "week:N" is items[N]. */
export function weekEvents(items: WeekItem[], calendar: EventRow[], changes: EventException[]): EventRow[] {
  return items.map((it, i) => ({ it, i })).filter(({ it }) => !expandEvents(calendar, it.date, it.date, changes).some((o) => o.start && o.event.is_busy && minutesOf(o.start) < minutesOf(it.end) && minutesOf(o.end ?? o.start) > minutesOf(it.start)
    && sameThing(o.event.title, it.title, o.event.training_type ?? null, it.training_type)))
    .map(({ it, i }) => ({
      id: `week:${i}`, title: it.title, category_id: null, subject_id: null, location: null,
      starts_at: zonedToUTC(it.date, it.start), ends_at: zonedToUTC(it.date, it.end), repeat_days: null, start_time: null, end_time: null, repeat_from: null, repeat_until: null,
      is_busy: true, travel_minutes: it.travel_minutes, target_id: null, archived_at: null,
      training_type: it.training_type || (it.kind === 'training' ? null : 'none'), load: it.intensity === 'heavy' ? 'hard' : it.intensity || null,
      is_school: it.kind === 'school', external_source: 'week',
    }))
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2))
/** The same session by its type or a shared word ("Owen training" and his typed "Owen"). */
export function sameThing(a: string, b: string, ta: string | null, tb: string): boolean {
  if (ta && tb && ta === tb) return true
  const x = words(a), y = words(b)
  return [...x].some((w) => y.has(w))
}

/** "Mon: Football training 18:00–19:30 · CS tutor 20:00–21:00" lines for the card. */
export function weekLines(items: WeekItem[]): string[] {
  const out: string[] = []
  for (const d of [...new Set(items.map((i) => i.date))]) {
    out.push(`${dowShort(d)}: ${items.filter((i) => i.date === d).map((i) => `${i.title} ${i.start}–${i.end}${i.guessed_time ? ' (time guessed)' : ''}`).join(' · ')}`)
  }
  return out
}
