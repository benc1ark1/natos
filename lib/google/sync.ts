// Server-only: Google Calendar sync (BUILD-GUIDE step 11, my-spec 25/26/28), run as Nat by the 5-minute tick and
// by "Sync now". Three parts:
// 1. Life OS, app → Google: his calendar sessions (each week's session as its own Google event, so "this week only"
//    changes and per-day leave-by times are exact) and his planned blocks, for the next 4 weeks, with Google
//    reminders: 30 min before, or at leave-by time (and 10 min before it) when there's a journey.
// 2. Life OS, Google → app: a session he moves or deletes in Google moves or is cancelled that week in the app (a
//    one-off moves, or is archived); a planned block moves or is cancelled. Never deleted in the app.
// 3. His other calendars (every 15 min): read-only copies in the app (busy time, Upcoming, the AI); "Assignment: …"
//    events (Google Classroom, or the "Homework feed" his school account copies them into with
//    google-apps-script/homework-feed.gs) become homework tasks, once each. Nothing is ever written to these calendars.
import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserId } from '../data'
import { expandEvents, isRepeating, saveChange, setEventArchived } from '../events'
import { moreSettings } from '../settings'
import { autoStatus } from '../tasks'
import { addDays, dateISOOf, dueAtFromDate, minutesOf, timeOf, todayISO, zonedToUTC } from '../time'
import { leaveBy, withTravel } from '../travel'
import { loadTravel } from '../travel-data'
import type { EventException, EventRow } from '../types'
import { loadConnection, saveTokens, tokensOf, updateConnection, type Connection } from '../integrations/store'
import { MAIL_MARK, ingest } from '../mail/store'
import { readIncoming } from '../mail/rules'
import { GoneError, GoogleCal, ReconnectError, refreshAccess, type EventBody, type GEvent, type GTime } from './api'
import { classroomDetails } from '../tracker/classroom'   // item 1c: test-like assignments keep their description

export const PUSH_DAYS = 28        // Life OS holds the next 4 weeks
export const READ_DAYS = 42        // other calendars: the next 6 weeks
const READ_EVERY_MIN = 15
const MAX_WRITES = 60              // per run, so a first sync never runs out of time (the rest goes next run)
const KEY = 'natos'                // the private tag on every event the app puts in Life OS

export type CalSetting = { id: string; name: string; read: boolean; school: boolean }
export type GoogleSettings = { life_os_id?: string; life_sync?: string; calendars?: CalSetting[]; read_at?: string }
export type SyncResult = { ok: boolean; error?: string; reconnect?: boolean; pushed: number; changed: number; removed: number; pulled: number; read: number; homework: { title: string; due: string; time: string | null; subject: string | null }[] }

type Link = { id?: string; item_key: string; on_date: string; google_id: string | null; hash: string | null; google_updated: string | null }
type Item = { key: string; date: string; summary: string; description: string; location: string | null; start: string; end: string; reminders: number[] }

/** A signed-in Calendar API for Nat, refreshing the access token when it's about to run out. Null if not connected. */
export async function googleSession(sb: SupabaseClient): Promise<{ conn: Connection; token: string } | null> {
  const conn = await loadConnection(sb, 'google')
  if (!conn || conn.status !== 'connected') return null
  const t = tokensOf(conn)
  if (!t) return null
  if (t.expires_at > Date.now() + 120_000) return { conn, token: t.access_token }
  try {
    const fresh = await refreshAccess(t.refresh_token)
    await saveTokens(sb, conn, { access_token: fresh.access_token, refresh_token: fresh.refresh_token ?? t.refresh_token, expires_at: fresh.expires_at })
    return { conn, token: fresh.access_token }
  } catch (e) {
    if (e instanceof ReconnectError) await updateConnection(sb, conn, { status: 'needs_reconnect', last_error: e.message })
    throw e
  }
}

const empty = (): SyncResult => ({ ok: true, pushed: 0, changed: 0, removed: 0, pulled: 0, read: 0, homework: [] })

/** One sync. Never throws: problems are returned (and saved on the connection, shown in Settings). */
export async function syncGoogle(sb: SupabaseClient, opts: { readOthers?: boolean; now?: Date } = {}): Promise<SyncResult | null> {
  const out = empty()
  let conn: Connection | null = null
  try {
    const s = await googleSession(sb)
    if (!s) return null
    conn = s.conn
    const settings = { ...(conn.settings as GoogleSettings) }
    if (!settings.life_os_id) {
      settings.life_os_id = await GoogleCal.createLifeOs(s.token)
      await updateConnection(sb, conn, { settings: { ...settings } })
    }
    const cal = new GoogleCal(s.token, settings.life_os_id)
    const now = opts.now ?? new Date()
    const today = todayISO()

    const [evs, chs, blocks, links, planning, userId] = await Promise.all([
      sb.from('events').select('*').then((r) => { if (r.error) throw new Error(`Couldn’t read events: ${r.error.message}`); return (r.data ?? []) as EventRow[] }),
      sb.from('event_exceptions').select('*').gte('on_date', addDays(today, -14)).then((r) => (r.data ?? []) as EventException[]),
      sb.from('plan_blocks').select('id,on_date,start_time,end_time,title,status').gte('on_date', today).lte('on_date', addDays(today, PUSH_DAYS - 1)).then((r) => (r.error ? [] : r.data ?? []) as { id: string; on_date: string; start_time: string; end_time: string; title: string; status: string }[]),
      sb.from('google_links').select('*').then((r) => { if (r.error) throw new Error(`Couldn’t read the calendar links: ${r.error.message}`); return new Map(((r.data ?? []) as Link[]).map((l) => [l.item_key, l])) }),
      sb.from('profiles').select('planning').maybeSingle().then((r) => (r.error ? null : r.data?.planning ?? null)),
      getUserId(sb),
    ])
    const saveLink = async (l: Link) => {
      const { data, error } = await sb.from('google_links').upsert({ user_id: userId, item_key: l.item_key, on_date: l.on_date, google_id: l.google_id, hash: l.hash, google_updated: l.google_updated }, { onConflict: 'user_id,item_key' }).select('id').single()
      if (error) throw new Error(`Couldn’t save a calendar link: ${error.message}`)
      links.set(l.item_key, { ...l, id: data.id })
    }

    // ---- 2. Google → app: what he changed in Life OS since last time
    let res: { items: GEvent[]; nextSyncToken?: string }
    try { res = await cal.events(settings.life_os_id, settings.life_sync ? { syncToken: settings.life_sync, showDeleted: true } : { showDeleted: true }) }
    catch (e) {
      if (!(e instanceof GoneError)) throw e
      res = await cal.events(settings.life_os_id, { showDeleted: true })
    }
    settings.life_sync = res.nextSyncToken ?? settings.life_sync
    const byId = new Map(evs.map((e) => [e.id, e]))
    for (const g of res.items) {
      const key = g.extendedProperties?.private?.[KEY]
      const link = key ? links.get(key) : null
      if (!link || link.google_id !== g.id) continue
      if (link.google_updated && g.updated && Date.parse(g.updated) <= Date.parse(link.google_updated)) continue   // our own write
      await fromGoogle(sb, userId, key!, g, byId, chs)
      await saveLink({ ...link, google_updated: g.updated ?? null, google_id: g.status === 'cancelled' ? null : link.google_id })
      out.pulled++
    }
    // re-read what the pull may have changed
    const [evs2, chs2, blocks2] = out.pulled
      ? await Promise.all([
          sb.from('events').select('*').then((r) => (r.data ?? []) as EventRow[]),
          sb.from('event_exceptions').select('*').gte('on_date', addDays(today, -14)).then((r) => (r.data ?? []) as EventException[]),
          sb.from('plan_blocks').select('id,on_date,start_time,end_time,title,status').gte('on_date', today).lte('on_date', addDays(today, PUSH_DAYS - 1)).then((r) => (r.data ?? []) as typeof blocks),
        ])
      : [evs, chs, blocks]

    // ---- 1. app → Google: Life OS as it should be
    const want = await desired(sb, evs2, chs2, blocks2, planning, today)
    let writes = 0
    for (const it of want.values()) {
      if (writes >= MAX_WRITES) break
      const link = links.get(it.key)
      const hash = hashOf(it)
      if (link?.google_id && link.hash === hash) continue
      const body = bodyOf(it)
      let g: GEvent
      if (link?.google_id) {
        try { g = await cal.patch(link.google_id, body); out.changed++ }
        catch (e) { if (!(e instanceof GoneError) && (e as { status?: number }).status !== 404) throw e; g = await cal.insert(body); out.pushed++ }
      } else { g = await cal.insert(body); out.pushed++ }
      writes++
      await saveLink({ item_key: it.key, on_date: it.date, google_id: g.id, hash, google_updated: g.updated ?? null })
    }
    for (const link of [...links.values()]) {
      if (writes >= MAX_WRITES) break
      if (!link.google_id || want.has(link.item_key) || link.on_date < today) continue
      try { await cal.remove(link.google_id) } catch (e) { if (!(e instanceof GoneError) && (e as { status?: number }).status !== 404) throw e }
      writes++
      out.removed++
      await saveLink({ ...link, google_id: null, hash: null })
    }

    // ---- 3. his other calendars, read-only (every 15 minutes, or when asked)
    const due = !settings.read_at || now.getTime() - Date.parse(settings.read_at) >= READ_EVERY_MIN * 60_000
    if (opts.readOthers || due) {
      const r = await readOthers(sb, cal, settings, userId, today)
      out.read = r.read
      out.homework = r.homework
      settings.read_at = now.toISOString()
    }
    await updateConnection(sb, conn, { settings: { ...settings }, last_sync_at: now.toISOString(), last_error: null })
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Google sync failed.'
    if (conn) await updateConnection(sb, conn, { last_error: msg.slice(0, 300) }).catch(() => null)
    // Google refused the access token before it should have run out: get a fresh one next time (if that fails too,
    // the connection is marked "needs reconnect")
    if (conn && e instanceof ReconnectError && conn.status === 'connected') {
      try { const t = tokensOf(conn); if (t) await saveTokens(sb, conn, { ...t, expires_at: 0 }) } catch {}
    }
    return { ...out, ok: false, error: msg, reconnect: e instanceof ReconnectError && conn?.status !== 'connected' }
  }
}

// ---------------------------------------------------------------------------
// Life OS as it should be
// ---------------------------------------------------------------------------

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** Every session (of his own events, unless he turned Google off for one) and planned block for the next 4 weeks. */
export async function desired(sb: SupabaseClient, evs: EventRow[], chs: EventException[], blocks: { id: string; on_date: string; start_time: string; end_time: string; title: string; status: string }[], planning: unknown, today: string): Promise<Map<string, Item>> {
  const mine = evs.filter((e) => !e.archived_at && e.external_source !== 'google' && e.sync_google !== false)
  const travel = await loadTravel(sb, mine, planning)
  const out = new Map<string, Item>()
  const lead = moreSettings(planning).leaveAlertMin || 10
  for (const o of withTravel(expandEvents(mine, today, addDays(today, PUSH_DAYS - 1), chs), travel)) {
    if (o.cancelled || !o.start || o.date < today) continue
    const end = o.end && minutesOf(o.end) > minutesOf(o.start) ? o.end : hhmm(Math.min(minutesOf(o.start) + 60, 23 * 60 + 59))
    const l = leaveBy(o)
    const before = l ? minutesOf(o.start) - minutesOf(l.at) : 0
    const key = `event:${o.event.id}:${o.usualDate}`
    out.set(key, {
      key, date: o.date, summary: o.event.title,
      description: [l ? `Leave by ${l.at}: ${l.words}.` : '', 'From Nat OS: move or delete it here and the app follows (just this week).'].filter(Boolean).join('\n'),
      location: o.event.location ?? null, start: zonedToUTC(o.date, o.start), end: zonedToUTC(o.date, end),
      reminders: before > 0 ? [before, before + lead] : [30],
    })
  }
  for (const b of blocks.filter((x) => x.status === 'planned' && x.on_date >= today)) {
    const key = `block:${b.id}`
    out.set(key, { key, date: b.on_date, summary: `🗓 ${b.title}`, description: 'Planned in Nat OS (plan my day/week). Move it here and the plan follows.', location: null,
      start: zonedToUTC(b.on_date, b.start_time.slice(0, 5)), end: zonedToUTC(b.on_date, b.end_time.slice(0, 5)), reminders: [5] })
  }
  return out
}

const hashOf = (it: Item) => createHash('sha256').update(JSON.stringify([it.summary, it.description, it.location, it.start, it.end, it.reminders])).digest('hex').slice(0, 32)

const bodyOf = (it: Item): EventBody => ({
  summary: it.summary, description: it.description, location: it.location,
  start: { dateTime: it.start, timeZone: 'Europe/London' }, end: { dateTime: it.end, timeZone: 'Europe/London' },
  reminders: { useDefault: false, overrides: [...new Set(it.reminders)].slice(0, 5).map((minutes) => ({ method: 'popup', minutes })) },
  extendedProperties: { private: { [KEY]: it.key } },
})

// ---------------------------------------------------------------------------
// Google → app (Life OS only)
// ---------------------------------------------------------------------------

/** London date and HH:MM of a Google time; null for all-day. */
const local = (t?: GTime) => (t?.dateTime ? { date: dateISOOf(t.dateTime), time: timeOf(t.dateTime) } : null)

async function fromGoogle(sb: SupabaseClient, userId: string, key: string, g: GEvent, events: Map<string, EventRow>, changes: EventException[]) {
  const cancelled = g.status === 'cancelled'
  const [kind, id, usual] = key.split(':')
  if (kind === 'block') {
    const s = local(g.start), e = local(g.end)
    const patch = cancelled ? { status: 'cancelled' } : s && e && e.date === s.date ? { on_date: s.date, start_time: s.time, end_time: e.time } : null
    if (patch) await sb.from('plan_blocks').update(patch).eq('id', id)
    return
  }
  const ev = events.get(id)
  if (!ev || ev.archived_at) return
  if (!isRepeating(ev)) {
    if (cancelled) { await setEventArchived(sb, ev, true); return }   // archived, never deleted
    const s = local(g.start), e = local(g.end)
    if (!s) return
    const patch: Record<string, unknown> = { starts_at: zonedToUTC(s.date, s.time), ends_at: e ? zonedToUTC(e.date, e.time) : null }
    if (g.summary && g.summary.trim() && g.summary !== ev.title) patch.title = g.summary.trim().slice(0, 120)
    await sb.from('events').update(patch).eq('id', ev.id)
    return
  }
  // a weekly session: that week only
  const o = expandEvents([ev], addDays(usual, -7), addDays(usual, 7), changes.filter((c) => c.event_id === ev.id)).find((x) => x.usualDate === usual)
  if (!o) return
  if (cancelled) { await saveChange(sb, userId, o, { cancelled: true, new_date: null, new_start: null, new_end: null }); return }
  const s = local(g.start), e = local(g.end)
  if (!s) return
  const usualStart = ev.start_time!.slice(0, 5), usualEnd = ev.end_time?.slice(0, 5) ?? null
  await saveChange(sb, userId, o, {
    cancelled: false, new_date: s.date !== usual ? s.date : null,
    new_start: s.time !== usualStart ? s.time : null, new_end: e && e.time !== usualEnd ? e.time : null,
  })
}

// ---------------------------------------------------------------------------
// His other calendars (read-only)
// ---------------------------------------------------------------------------

const ASSIGNMENT = /^\s*assignment\s*:\s*/i

async function readOthers(sb: SupabaseClient, cal: GoogleCal, settings: GoogleSettings, userId: string, today: string) {
  const life = settings.life_os_id!
  const list = await cal.calendars()
  const known = new Map((settings.calendars ?? []).map((c) => [c.id, c]))
  settings.calendars = list.filter((c) => c.id !== life).map((c) => {
    const k = known.get(c.id)
    return { id: c.id, name: c.summary, read: k ? k.read : c.selected !== false && c.accessRole !== 'freeBusyReader', school: k?.school ?? false }
  })
  const reading = settings.calendars.filter((c) => c.read)
  const timeMin = zonedToUTC(addDays(today, -1), '00:00'), timeMax = zonedToUTC(addDays(today, READ_DAYS), '00:00')

  const seen = new Map<string, Record<string, unknown>>()
  const homework: { cal: CalSetting; g: GEvent }[] = []
  const mail: string[] = []   // the email watcher's fallback (lib/mail): emails the school script couldn't post to the app
  // Life OS too: events he made there himself (not the app's) are read like any other calendar
  for (const c of [...reading, { id: life, name: 'Life OS', read: true, school: false }]) {
    const { items } = await cal.events(c.id, { timeMin, timeMax, singleEvents: true })
    for (const g of items) {
      if (g.status === 'cancelled' || !g.start) continue
      if (c.id === life && g.extendedProperties?.private?.[KEY]) continue
      if (g.attendees?.some((a) => a.self && a.responseStatus === 'declined')) continue
      if (g.description?.startsWith(MAIL_MARK)) { mail.push(g.description.slice(MAIL_MARK.length)); continue }
      if (ASSIGNMENT.test(g.summary ?? '')) { homework.push({ cal: c, g }); continue }
      seen.set(`${c.id}|${g.id}`, rowOf(c, g))
    }
  }

  // copies: add new, update changed, archive what's gone (archived, never deleted)
  const { data: have, error } = await sb.from('events').select('id,external_id,title,starts_at,ends_at,all_day,is_busy,is_school,calendar_id,location,archived_at').eq('external_source', 'google')
  if (error) throw new Error(`Couldn’t read the copied events: ${error.message}`)
  const byExt = new Map((have ?? []).map((r) => [r.external_id as string, r as Record<string, unknown>]))
  const fresh: Record<string, unknown>[] = []
  const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null) || (typeof a === 'string' && typeof b === 'string' && Date.parse(a) === Date.parse(b))
  for (const [ext, row] of seen) {
    const old = byExt.get(ext)
    if (!old) { fresh.push(row); continue }
    const changed = Object.keys(row).some((k) => k !== 'external_source' && k !== 'external_id' && k !== 'sync_google' && !same(old[k], row[k]))
    if (changed || old.archived_at) await sb.from('events').update({ ...row, archived_at: null }).eq('id', old.id as string)
  }
  for (let i = 0; i < fresh.length; i += 200) {
    const { error: e } = await sb.from('events').insert(fresh.slice(i, i + 200).map((r) => ({ ...r, user_id: userId })))
    if (e) throw new Error(`Couldn’t copy your Google events: ${e.message}`)
  }
  const readIds = new Set([...reading.map((c) => c.id), life])
  const gone = (have ?? []).filter((r) => !r.archived_at && !seen.has(r.external_id as string)
    && (!readIds.has(r.calendar_id as string) || (r.starts_at as string) >= timeMin))
  if (gone.length) await sb.from('events').update({ archived_at: new Date().toISOString() }).in('id', gone.map((r) => r.id as string))

  if (mail.length) await readMail(sb, mail)
  return { read: seen.size, homework: await importHomework(sb, homework, userId, today) }
}

/** The fallback: one event per email (and one check-in event), each "natos-mail {json}". Stored like posted mail; a
 *  problem here never stops the calendar sync. */
async function readMail(sb: SupabaseClient, list: string[]) {
  const byAccount = new Map<string, NonNullable<ReturnType<typeof readIncoming>>>()
  for (const raw of list) {
    let input: ReturnType<typeof readIncoming> = null
    try { input = readIncoming({ ...JSON.parse(raw), via: 'calendar' }) } catch {}
    if (!input) continue
    const had = byAccount.get(input.account)
    if (!had) { byAccount.set(input.account, input); continue }
    had.messages.push(...input.messages)
    if (input.sent && (!had.sent || input.sent > had.sent)) had.sent = input.sent
    had.address ??= input.address
  }
  for (const input of byAccount.values()) await ingest(sb, input).catch(() => 0)
}

function rowOf(c: CalSetting, g: GEvent): Record<string, unknown> {
  const allDay = !!g.start!.date
  const start = allDay ? zonedToUTC(g.start!.date!, '00:00') : new Date(g.start!.dateTime!).toISOString()
  const end = allDay ? zonedToUTC(g.end?.date ?? addDays(g.start!.date!, 1), '00:00') : g.end?.dateTime ? new Date(g.end.dateTime).toISOString() : null
  return {
    title: (g.summary?.trim() || 'Busy').slice(0, 120), starts_at: start, ends_at: end, all_day: allDay,
    is_busy: !allDay && g.transparency !== 'transparent', is_school: c.school ? true : null, calendar_id: c.id,
    location: g.location?.trim().slice(0, 120) || null, external_source: 'google', external_id: `${c.id}|${g.id}`, sync_google: false,
  }
}

/** What the Homework feed script (google-apps-script/homework-feed.gs) writes at the top of each copy: the class, the
 *  subject, the Classroom link, and a Ref that stays the same for one assignment even if its copy is made again. */
export function feedInfo(description?: string) {
  const raw = description ?? ''
  const text = raw.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  const line = (k: string) => text.match(new RegExp(`^[ \\t]*${k}:[ \\t]*(.+?)[ \\t]*$`, 'mi'))?.[1] ?? null
  const link = (s: string | null) => s?.match(/https:\/\/classroom\.google\.com\/[^\s<>"')\]]+/)?.[0] ?? null
  return {
    className: line('Class'), subject: line('Subject'), link: link(line('Classroom')) ?? link(raw),
    ref: text.match(/^[ \t]*Ref:[ \t]*([0-9a-f]{16,40})[ \t]*$/mi)?.[1] ?? null,
  }
}

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? [])

/** "Assignment: Physics worksheet" → a homework task (school, must), due that day; once per assignment. */
async function importHomework(sb: SupabaseClient, list: { cal: CalSetting; g: GEvent }[], userId: string, today: string) {
  if (!list.length) return []
  const [{ data: have }, { data: subjects }] = await Promise.all([
    sb.from('tasks').select('id,external_id,due_at,archived_at,status,subject_id,hand_in_url').not('external_id', 'is', null),
    sb.from('subjects').select('id,name').is('archived_at', null),
  ])
  const byExt = new Map((have ?? []).map((t) => [t.external_id as string, t]))
  // the subject the feed names, else the one all of whose words are in the class, calendar or title
  // ("Maths Further Mf1a" → Further Maths; most words first, so "Further Maths" before "Maths")
  const subs = [...(subjects ?? [])].map((s) => ({ ...s, w: words(s.name) })).sort((a, b) => b.w.size - a.w.size || b.name.length - a.name.length)
  const subjectOf = (named: string | null, text: string) => {
    const exact = named && subs.find((s) => s.name.toLowerCase() === named.trim().toLowerCase())
    if (exact) return exact
    const w = words(text)
    return subs.find((s) => s.w.size && [...s.w].every((x) => w.has(x))) ?? null
  }
  // one per assignment: the feed's Ref (so a copy made again isn't new homework), else the Google event; newest wins
  const items = new Map<string, { cal: CalSetting; g: GEvent; info: ReturnType<typeof feedInfo> }>()
  for (const { cal, g } of list) {
    const info = feedInfo(g.description)
    const ext = info.ref ? `classroom:${info.ref}` : `${cal.id}|${g.id}`
    const prev = items.get(ext)
    if (!prev || (g.updated ?? '') > (prev.g.updated ?? '')) items.set(ext, { cal, g, info })
  }
  const added: { title: string; due: string; time: string | null; subject: string | null }[] = []
  for (const [ext, { cal, g, info }] of items) {
    const due = g.start!.date ?? dateISOOf(g.start!.dateTime!)
    const time = g.start!.dateTime ? timeOf(g.start!.dateTime) : null
    const title = (g.summary ?? '').replace(ASSIGNMENT, '').trim().slice(0, 120) || 'Assignment'
    const subject = subjectOf(info.subject, `${info.className ?? ''} ${cal.name} ${title}`)
    const old = byExt.get(ext)
    if (!old) {
      const { error } = await sb.from('tasks').insert({
        user_id: userId, title, origin: 'school', importance: 'must', due_at: dueAtFromDate(due), status: autoStatus(due, today),
        source: 'import', source_text: g.summary ?? null, external_id: ext, subject_id: subject?.id ?? null,
        // study tracker (item 1c): a test-like assignment also keeps the teacher's description, so the bot can read it
        // once and ask "Test on <date> – plan revision? ✅" (lib/tracker/classroom.ts)
        details: classroomDetails([info.className, time ? `Due ${time}` : null].filter(Boolean).join(' · ') || null, title, g.description),
        hand_in: 'Google Classroom', hand_in_url: info.link,
      })
      if (error) throw new Error(`Couldn’t add homework “${title}”: ${error.message}`)
      added.push({ title, due, time, subject: subject?.name ?? null })
    } else if (!old.archived_at && old.status !== 'completed') {
      const patch: Record<string, unknown> = {}
      if (old.due_at && dateISOOf(old.due_at) !== due) {   // the teacher moved the date
        patch.due_at = dueAtFromDate(due)
        if (['inbox', 'today', 'this_week', 'this_month'].includes(old.status)) patch.status = autoStatus(due, today)
      }
      if (!old.subject_id && subject) patch.subject_id = subject.id
      if (!old.hand_in_url && info.link) patch.hand_in_url = info.link
      if (Object.keys(patch).length) {
        const { error } = await sb.from('tasks').update(patch).eq('id', old.id)
        if (error) throw new Error(`Couldn’t update homework “${title}”: ${error.message}`)
      }
    }
  }
  return added
}
