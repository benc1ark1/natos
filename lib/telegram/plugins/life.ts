// Item 4: events and life by chat (plans/contracts.md §7). A bot plug-in (lib/telegram/plugin-types.ts).
// - Events: "out with friends tomorrow 2–9pm", "family dinner Sat 7", "football Wed 7:45" → the built-in event_new
//   (event_weekly only when he says every / weekly) on the usual ✅ card, with what it knocks on in the week; ✅ saves
//   it, the planner works around it (free time, ripple) and the Google sync puts it in Life OS. Cancelling and moving
//   his own events the same way ("cancel family dinner", "dinner's off", "move football to Thu 8", "family dinner is
//   now 7:30"). Copies from his Google calendars are read-only: one line says to change them in Google.
// - Routines (life_routine) and the week's top priorities (life_priority), with ✅ and ↩️ Undo.
// The parsing is plain code (lib/life/*); anything unsure goes to the brain, which knows the same changes.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BotPlugin, FastEnv, FastResult, PluginAction, PluginApplied, PluginRawAction, PluginRef, SnapshotPart } from '../plugin-types'
import { expandEvents, isRepeating } from '../../events'
import { addDays, dowShort, minutesOf, shortDate, timeOf, weekStartISO } from '../../time'
import type { EventException, EventRow } from '../../types'
import { findTime, hm, kindOf, looksLikeOther, parseChange, parseNewEvent, resolveRange, resolveTime, unsupportedRepeat, type NewEvent, type ParsedChange, type Target } from '../../life/parse'
import { closest, matchEvents, nameScore, type EventMatch } from '../../life/match'
import { checkRoutine, daysWords, liveBlocks, parseBlockDays, parseRoutine, type Block, type Routine, type RoutinePatch, type RoutineWorld, type Step } from '../../life/routines'
import { checkPriority, parsePriority } from '../../life/priorities'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`
const raw = (o: Partial<PluginRawAction> & { op: string }): PluginRawAction => ({ ref: '', value: '', date: '', date_to: '', time: '', time_to: '', number: 0, words: '', ...o })
const lengthWords = (min: number) => (min % 60 === 0 ? `${min / 60} h` : min > 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`)
const sessionWords = (m: { session: { date: string; start: string | null; end: string | null } }) => `${day(m.session.date)}${m.session.start ? ` ${m.session.start}${m.session.end ? `–${m.session.end}` : ''}` : ''}`

// ---------------------------------------------------------------------------
// Reading his data (as Nat, under row level security)
// ---------------------------------------------------------------------------

async function loadEvents(sb: SupabaseClient, today: string): Promise<{ events: EventRow[]; changes: EventException[] }> {
  const [ev, ch] = await Promise.all([
    sb.from('events').select('*').is('archived_at', null),
    sb.from('event_exceptions').select('*').gte('on_date', addDays(today, -7)).lte('on_date', addDays(today, 63)),
  ])
  if (ev.error) throw new Error(`Couldn’t read your calendar: ${ev.error.message}`)
  if (ch.error) throw new Error(`Couldn’t read your calendar changes: ${ch.error.message}`)
  return { events: (ev.data ?? []) as EventRow[], changes: (ch.data ?? []) as EventException[] }
}

/** Routines, their blocks and steps (archived ones included: they carry archived_at, once life.sql has run). */
export async function loadRoutineWorld(sb: SupabaseClient, probe = true): Promise<RoutineWorld> {
  const none = Promise.resolve({ error: null })
  const [h, i, s, ia, sa] = await Promise.all([
    sb.from('habits').select('id,name,is_active,sort_order,days_of_week').order('sort_order'),
    sb.from('habit_items').select('*'),
    sb.from('routine_steps').select('*'),
    // the archived_at columns come with supabase/life.sql: until then nothing can be archived (or added and undone)
    probe ? sb.from('habit_items').select('archived_at').limit(1) : none,
    probe ? sb.from('routine_steps').select('archived_at').limit(1) : none,
  ])
  if (h.error) throw new Error(`Couldn’t read your routines: ${h.error.message}`)
  // a failed read must never look like "no blocks yet"
  if (i.error) throw new Error(`Couldn’t read your routine blocks: ${i.error.message}`)
  if (s.error) throw new Error(`Couldn’t read your routine steps: ${s.error.message}`)
  const items = (i.data ?? []) as (Block & Record<string, unknown>)[]
  const steps = (s.data ?? []) as (Step & Record<string, unknown>)[]
  return {
    routines: (h.data ?? []) as Routine[],
    blocks: items,
    steps,
    canArchiveBlocks: !ia.error,
    canArchiveSteps: !sa.error,
  }
}

type Review = { id: string; week_start: string; priorities: string[] }
async function loadReviews(sb: SupabaseClient, today: string): Promise<Review[] | 'missing'> {
  const weeks = [weekStartISO(today), addDays(weekStartISO(today), 7)]
  const { data, error } = await sb.from('weekly_reviews').select('id,week_start,priorities').in('week_start', weeks)
  if (error) {
    if (/weekly_reviews|does not exist|schema cache/i.test(error.message)) return 'missing'
    throw new Error(`Couldn’t read your priorities: ${error.message}`)
  }
  return (data ?? []) as Review[]
}

/** Is it one of his other things (a task, test, reminder, plan block, routine, weekly target)? Then the brain decides. */
async function otherRecord(sb: SupabaseClient, name: string, today: string): Promise<boolean> {
  const [t, g, r, b, h, w] = await Promise.all([
    sb.from('tasks').select('title').is('archived_at', null).neq('status', 'completed').limit(500),
    sb.from('goals').select('title').is('archived_at', null),
    sb.from('reminders').select('body').is('done_at', null),
    sb.from('plan_blocks').select('title').eq('status', 'planned').gte('on_date', today).lte('on_date', addDays(today, 14)),
    sb.from('habits').select('name').eq('is_active', true),
    sb.from('weekly_targets').select('name').eq('is_active', true),
  ])
  const titles = [
    ...((t.data ?? []) as { title: string }[]).map((x) => x.title), ...((g.data ?? []) as { title: string }[]).map((x) => x.title),
    ...((r.data ?? []) as { body: string }[]).map((x) => x.body), ...((b.data ?? []) as { title: string }[]).map((x) => x.title),
    ...((h.data ?? []) as { name: string }[]).map((x) => x.name), ...((w.data ?? []) as { name: string }[]).map((x) => x.name),
  ]
  return titles.some((x) => nameScore(name, x) > 0)
}
// words about settings, study or the plan, not a calendar event: the brain reads those
// (and sessions his set-up makes, like the Game or Owen's: the brain changes those with game_week / owen_days)
const NOT_AN_EVENT = /\b(?:brief|check ?-?in|wake|waking|bed|bedtime|alarm|routine|reminder|priorit\w*|rule|setting|homework|test|exam|task|block|plan|study|revision|limit|cap|idea|topic|goal|game|match|fixture|owen|school|lessons?)\b/i

// ---------------------------------------------------------------------------
// Cancelling and moving his own events (refs made here: a fast path has no snapshot)
// ---------------------------------------------------------------------------

type Ask = { question: string; options: { label: string; raw: PluginRawAction[] }[] }

/**
 * Check these built-in changes exactly like the brain's (lib/telegram/actions.ts) and show the usual card with what
 * they knock on in the week (lib/telegram/ripple.ts), or a quick-tap question first. False if nothing passed.
 * (Imported when used: the bot's own files import this plug-in, so a static import would go round in a circle.)
 */
async function eventCard(env: FastEnv, message: string, raws: PluginRawAction[], refs: Map<string, PluginRef>, asks: Ask[] = []): Promise<boolean> {
  const [{ loadRows, checkActions }, { actionCard, planEffect }] = await Promise.all([import('../actions'), import('../cards')])
  const ctx = { today: env.today, weekStart: weekStartISO(env.today), snapshot: '', refs: refs as Map<string, PluginRef & { kind: 'event' }> }
  const rows = await loadRows(env.sb, [...raws, ...asks.flatMap((q) => q.options.flatMap((o) => o.raw))], ctx)
  const { actions, problems } = checkActions(raws, ctx, rows, message, env.today)
  const checked = asks.map((q) => ({ question: q.question, options: q.options.map((o) => ({ label: o.label, actions: checkActions(o.raw, ctx, rows, message, env.today).actions })).filter((o) => o.actions.length) }))
    .filter((q) => q.options.length >= 2)
  if (!actions.length && !checked.length) return false
  await actionCard(env.sb, env.chatId, message, actions, actions.length ? problems : [], { ...(checked.length ? { asks: checked } : {}), ...(actions.length ? await planEffect(env.sb, actions) : {}) })
  return true
}

const eventRef = (m: EventMatch): PluginRef => ({ kind: 'event', id: m.event.id, title: m.event.title, status: null, deadline: null })

/** Where a session goes: his new day/time, read with what the event is and when it is now ("8" for football = 20:00). */
export function moveTo(m: Pick<EventMatch, 'event' | 'session'>, to: Target, today: string, nowMin: number): { date: string; start: string; end: string } | null {
  const o = m.session
  if (!o.start) return null
  const len = o.end && minutesOf(o.end) > minutesOf(o.start) ? minutesOf(o.end) - minutesOf(o.start) : 60
  let date = o.date, start = minutesOf(o.start), end = start + len
  if (to.shift) { start += to.shift; end += to.shift }
  if (to.nextWeek) { if (isRepeating(m.event)) return null; date = addDays(o.date, 7) }
  if (to.day) date = to.day.date
  if (to.time) {
    const ctx = { part: to.part ?? to.day?.part ?? null, kind: kindOf(m.event.title), near: minutesOf(o.start) }
    if (to.time.b) {
      const r = resolveRange(to.time.a, to.time.b, ctx)
      if (!r) return null
      start = r.start; end = r.end
    } else {
      const s = resolveTime(to.time.a, ctx)
      if (s === null) return null
      start = s; end = s + len
    }
  }
  if (start < 0 || end > 23 * 60 + 59 || end <= start) return null
  if (date < today || (date === today && start <= nowMin)) return null
  return { date, start: hm(start), end: hm(end) }
}

/** The built-in change for one event: cancel or move this session, or every week. */
function changeFor(ch: ParsedChange, m: EventMatch, ref: string, words: string, scope: 'one' | 'every', today: string, nowMin: number): PluginRawAction | null {
  const every = scope === 'every' && isRepeating(m.event)
  if (ch.kind === 'cancel') return raw({ op: 'event_cancel', ref, date: every ? '' : m.session.usualDate, value: every ? 'every' : '' })
  const to = moveTo(m, ch.to, today, nowMin)
  if (!to) return null
  // the day and time come from his own words (parsed above), so his whole message is the grounding
  return raw({ op: 'event_move', ref, date: m.session.usualDate, date_to: to.date, time: to.start, time_to: to.end, words, value: every ? 'every' : '' })
}

async function eventChange(env: FastEnv, message: string, ch: ParsedChange, nowMin: number): Promise<FastResult | null> {
  const { events, changes } = await loadEvents(env.sb, env.today)
  const list = matchEvents(ch.name, events, changes, env.today, ch.day?.date ?? null, nowMin)
  const own = list.filter((m) => m.own)
  if (!own.length) {
    // "no game this week": his set-up's game (or Owen's days), not a Google copy that happens to share a word
    if (/\b(?:game|games|match|matches|fixture|owen)\b/i.test(ch.name)) return null
    const g = list.find((m) => m.google)
    if (g) return { kind: 'answer', html: `📅 <b>${esc(g.event.title)}</b> is on your Google calendar, so I can’t change it here: change it in Google Calendar and I’ll follow within 15 minutes.` }
    if (list.some((m) => m.setup)) return null
    if (ch.day && ch.kind === 'cancel') {
      // that day's session is already cancelled: say so (not "there's no football then")
      const d0 = ch.day.date
      const gone = expandEvents(events.filter((e) => e.external_source !== 'google' && nameScore(ch.name, e.title) > 0), d0, d0, changes)
        .find((o) => o.cancelled && (o.usualDate === d0 || o.date === d0))
      if (gone) return { kind: 'answer', html: `<b>${esc(gone.event.title)}</b> on ${day(d0)} is already cancelled. Nothing to change.` }
    }
    if (ch.day) {
      // the right event on another day: say when it actually is
      const other = matchEvents(ch.name, events, changes, env.today, null, nowMin).filter((m) => m.own)
      if (other.length === 1) return { kind: 'answer', html: `There’s no <b>${esc(other[0].event.title)}</b> on ${day(ch.day.date)}: it’s ${sessionWords(other[0])}. Did you mean that one? Say it with that day.` }
      if (other.length) return null
    }
    if (NOT_AN_EVENT.test(ch.name) || await otherRecord(env.sb, ch.name, env.today)) return null
    // nothing like it in his calendar ("cancel my gym membership"): not about an event, so the brain reads it
    if (!closest(ch.name, events, changes, env.today, 3, true).length) return null
    const near = closest(ch.name, events, changes, env.today)
    const names = near.map((x) => `${esc(x.title)} (${day(x.session.date)}${x.session.start ? ` ${x.session.start}` : ''})`).join(', ')
    return { kind: 'answer', html: `🔍 I can’t find “${esc(ch.name)}” in your calendar${ch.day ? ` on ${day(ch.day.date)}` : ''}.${near.length ? ` Coming up: ${names}.` : ' Nothing of yours is coming up in the next 2 weeks.'}` }
  }
  const refs = new Map<string, PluginRef>()
  const refOf = (m: EventMatch) => { const r = `E${refs.size + 1}`; refs.set(r, eventRef(m)); return r }
  if (own.length > 1) {
    // two of his events fit: one quick tap says which
    const options = own.slice(0, 4).map((m) => {
      const a = changeFor(ch, m, refOf(m), message, ch.scope ?? 'one', env.today, nowMin)
      return { label: `${m.event.title.slice(0, 16)} · ${dowShort(m.session.date)}${m.session.start ? ` ${m.session.start}` : ''}`, raw: a ? [a] : [] }
    }).filter((o) => o.raw.length)
    if (options.length < 2) return null
    return (await eventCard(env, message, [], refs, [{ question: `Which ${ch.name} do you mean?`, options }])) ? { kind: 'handled' } : null
  }
  const m = own[0]
  const ref = refOf(m)
  // a weekly session: just this one unless he says otherwise; "X is now 8" / "not … any more" could mean for good: ask
  const lasting = ch.scope === null && isRepeating(m.event) && !ch.day
    && (ch.kind === 'move' ? /\b(?:is|has)\s+(?:now|changed to)\b|'s\s+now\b|\bchanged to\b/i.test(message) : /\bany ?more\b/i.test(message))
  if (lasting) {
    const one = changeFor(ch, m, ref, message, 'one', env.today, nowMin), every = changeFor(ch, m, ref, message, 'every', env.today, nowMin)
    if (!one || !every) return null
    const ask: Ask = { question: `Just ${sessionWords(m)}, or every week?`, options: [{ label: `Just ${dowShort(m.session.date)} ${shortDate(m.session.date)}`, raw: [one] }, { label: 'Every week', raw: [every] }] }
    return (await eventCard(env, message, [], refs, [ask])) ? { kind: 'handled' } : null
  }
  const a = changeFor(ch, m, ref, message, ch.scope ?? 'one', env.today, nowMin)
  if (!a) return null
  return (await eventCard(env, message, [a], refs)) ? { kind: 'handled' } : null
}

/** A new event: the built-in event_new / event_weekly on the usual card (checked, with its knock-on, by the bot). */
async function newEvent(env: FastEnv, ev: NewEvent): Promise<FastResult> {
  const action = ev.weekly
    ? raw({ op: 'event_weekly', value: ev.title, time: ev.start, time_to: ev.end, words: ev.weekly.words })
    : raw({ op: 'event_new', value: ev.title, date: ev.date, time: ev.start, time_to: ev.end, words: ev.dateWords })
  // already in his calendar that day under the same name? say so (✅ still adds it: maybe it's a second one)
  let dup: string | null = null
  try {
    const { events, changes } = await loadEvents(env.sb, env.today)
    const same = events.filter((e) => e.external_source !== 'google' && nameScore(ev.title, e.title) === 3)
    const o = expandEvents(same, ev.date, ev.date, changes).find((x) => !x.cancelled)
    if (o) dup = `${o.event.title} ${day(o.date)}${o.start ? ` ${o.start}${o.end ? `–${o.end}` : ''}` : ''}`
  } catch { /* the card still goes out */ }
  const head = [
    `➕ <b>New in your calendar</b>${ev.weekly ? ' <i>(every week)</i>' : ''}`,
    ev.lengthGuess ? `<i>No end time given: ${lengthWords(ev.lengthGuess)} is my guess (✏️ Change to set it).</i>` : '',
    ev.allDay ? `<i>All day: busy ${ev.start}–${ev.end}, nothing else gets planned then.</i>` : '',
    dup ? `⚠️ <i>Already in your calendar: ${esc(dup)}. ✅ adds another one.</i>` : '',
  ].filter(Boolean).join('\n')
  return { kind: 'actions', actions: [action], head }
}

// ---------------------------------------------------------------------------
// Routines and priorities: applied and undone here (never deleted: archived)
// ---------------------------------------------------------------------------

type Rows = { routines?: RoutineWorld; reviews?: Review[] | 'missing' }

async function applyRoutine(sb: SupabaseClient, a: PluginAction, now: string): Promise<PluginApplied> {
  const p = a.patch as unknown as RoutinePatch
  const done = (id: string, before: Record<string, unknown> | null, after: Record<string, unknown>): PluginApplied => ({ op: a.op, table: a.table, id, title: a.title, before, after: { kind: p.kind, ...after } })
  const must = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(`Not saved: ${r.error.message}`) }
  const orders = async (habitId: string) => {
    const { data, error } = await sb.from('habit_items').select('id,sort_order').eq('habit_id', habitId)
    if (error) throw new Error(`Couldn’t read the routine: ${error.message}`)
    return Object.fromEntries(((data ?? []) as { id: string; sort_order: number }[]).map((r) => [r.id, r.sort_order]))
  }
  const setOrders = async (o: Record<string, number>) => { for (const [id, n] of Object.entries(o)) must(await sb.from('habit_items').update({ sort_order: n }).eq('id', id).select('id').single()) }
  switch (p.kind) {
    case 'add_block': {
      const before = await orders(p.habit_id)
      await setOrders(p.orders)
      const { data, error } = await sb.from('habit_items').insert({ habit_id: p.habit_id, name: p.name, sort_order: p.sort_order }).select('id').single()
      if (error || !data) { await setOrders(before); throw new Error(`Not saved: ${error?.message ?? 'unknown error'}`) }
      return done(data.id, { orders: before }, { habit_id: p.habit_id, orders: { ...p.orders, [data.id]: p.sort_order } })
    }
    case 'add_step': {
      const { data, error } = await sb.from('routine_steps').insert({ habit_item_id: p.item_id, title: p.title, sort_order: p.sort_order }).select('id').single()
      if (error || !data) throw new Error(`Not saved: ${error?.message ?? 'unknown error'}`)
      return done(data.id, null, {})
    }
    case 'rename_block':
    case 'rename_routine': {
      const table = p.kind === 'rename_block' ? 'habit_items' : 'habits'
      const { data: was } = await sb.from(table).select('name').eq('id', p.id).single()
      must(await sb.from(table).update({ name: p.name }).eq('id', p.id).select('id').single())
      return done(p.id, { name: (was as { name?: string } | null)?.name ?? null }, { name: p.name })
    }
    case 'order': {
      const before = await orders(p.habit_id)
      await setOrders(p.orders)
      return done(a.id ?? p.habit_id, { orders: before }, { habit_id: p.habit_id, orders: p.orders })
    }
    case 'archive_block':
    case 'archive_step': {
      const table = p.kind === 'archive_block' ? 'habit_items' : 'routine_steps'
      const { error } = await sb.from(table).update({ archived_at: now }).eq('id', p.id).is('archived_at', null).select('id').single()
      if (error) throw new Error(/archived_at/.test(error.message) ? 'Not saved: run supabase/life.sql first (routines archive, never delete)' : `Not saved: ${error.message}`)
      return done(p.id, { archived_at: null }, { archived_at: now })
    }
    case 'routine_days':
    case 'block_days': {
      const table = p.kind === 'routine_days' ? 'habits' : 'habit_items'
      const { data: was } = await sb.from(table).select('days_of_week').eq('id', p.id).single()
      must(await sb.from(table).update({ days_of_week: p.days }).eq('id', p.id).select('id').single())
      return done(p.id, { days_of_week: (was as { days_of_week?: number[] | null } | null)?.days_of_week ?? null }, { days_of_week: p.days })
    }
  }
}

async function undoRoutine(sb: SupabaseClient, a: PluginApplied): Promise<'undone' | 'skipped'> {
  const kind = String(a.after.kind)
  const b = (a.before ?? {}) as Record<string, unknown>
  const must = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message) }
  const ordersNow = async (habitId: string) => Object.fromEntries((((await sb.from('habit_items').select('id,sort_order').eq('habit_id', habitId)).data ?? []) as { id: string; sort_order: number }[]).map((r) => [r.id, r.sort_order]))
  const restoreOrders = async (was: Record<string, number>) => { for (const [id, n] of Object.entries(was)) must(await sb.from('habit_items').update({ sort_order: n }).eq('id', id).select('id').single()) }
  if (kind === 'add_block' || kind === 'add_step') {
    // the new block / step is archived, never deleted
    const table = kind === 'add_block' ? 'habit_items' : 'routine_steps'
    must(await sb.from(table).update({ archived_at: new Date().toISOString() }).eq('id', a.id).select('id').single())
    if (kind === 'add_block') {
      const now = await ordersNow(String(a.after.habit_id))
      if (Object.entries(a.after.orders as Record<string, number>).every(([id, n]) => now[id] === n)) await restoreOrders(b.orders as Record<string, number>)
    }
    return 'undone'
  }
  if (kind === 'order') {
    const now = await ordersNow(String(a.after.habit_id))
    if (!Object.entries(a.after.orders as Record<string, number>).every(([id, n]) => now[id] === n)) return 'skipped'
    await restoreOrders(b.orders as Record<string, number>)
    return 'undone'
  }
  const table = a.table as 'habits' | 'habit_items' | 'routine_steps'
  const field = kind.startsWith('rename') ? 'name' : kind.startsWith('archive') ? 'archived_at' : 'days_of_week'
  const { data } = await sb.from(table).select(field).eq('id', a.id).maybeSingle()
  const cur = (data as Record<string, unknown> | null)?.[field]
  const unchanged = field === 'archived_at'
    ? cur != null && Date.parse(String(cur)) === Date.parse(String(a.after[field]))
    : JSON.stringify(cur ?? null) === JSON.stringify(a.after[field] ?? null)
  if (!data || !unchanged) return 'skipped'   // changed since (e.g. on the dashboard): left alone
  must(await sb.from(table).update({ [field]: b[field] ?? null }).eq('id', a.id).select('id').single())
  return 'undone'
}

async function applyPriority(sb: SupabaseClient, a: PluginAction): Promise<PluginApplied> {
  const { week, priorities } = a.patch as { week: string; priorities: string[] }
  const { data: row, error: e1 } = await sb.from('weekly_reviews').select('id,priorities').eq('week_start', week).maybeSingle()
  if (e1) throw new Error(/weekly_reviews/.test(e1.message) ? 'Not saved: run supabase/step7-checkin.sql first (the weekly check-in table)' : `Couldn’t read your priorities: ${e1.message}`)
  const before = (row?.priorities ?? []) as string[]
  const res = row
    ? await sb.from('weekly_reviews').update({ priorities }).eq('id', row.id).select('id').single()
    : await sb.from('weekly_reviews').insert({ week_start: week, priorities }).select('id').single()
  if (res.error || !res.data) throw new Error(`Not saved: ${res.error?.message ?? 'unknown error'}`)
  return { op: a.op, table: 'weekly_reviews', id: res.data.id, title: a.title, before: { priorities: before, week }, after: { priorities, week } }
}

async function undoPriority(sb: SupabaseClient, a: PluginApplied): Promise<'undone' | 'skipped'> {
  const { data } = await sb.from('weekly_reviews').select('priorities').eq('id', a.id).maybeSingle()
  if (!data || JSON.stringify(data.priorities ?? []) !== JSON.stringify(a.after.priorities ?? [])) return 'skipped'
  // the row stays (it may hold the week's plan too): its list goes back to what it was (empty if there was none)
  const { error } = await sb.from('weekly_reviews').update({ priorities: (a.before?.priorities as string[] | undefined) ?? [] }).eq('id', a.id).select('id').single()
  if (error) throw new Error(error.message)
  return 'undone'
}

// ---------------------------------------------------------------------------
// The fast path: plain code first, the brain for anything unsure
// ---------------------------------------------------------------------------

/** The card waiting for his tap is about this name ("family dinner Sat 8" while the dinner card waits = a correction). */
async function cardIsAbout(sb: SupabaseClient, title: string): Promise<boolean> {
  const since = new Date(Date.now() - 30 * 60_000).toISOString()
  const { data } = await sb.from('telegram_pending').select('text,payload').in('kind', ['capture', 'action', 'plan']).in('status', ['open', 'editing'])
    .gte('updated_at', since).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (!data) return false
  const p = (data.payload ?? {}) as { summary?: string; actions?: { title?: string }[] }
  return [data.text as string, p.summary ?? '', ...(p.actions ?? []).map((a) => a.title ?? '')].some((x) => !!x && (nameScore(title, x) > 0 || nameScore(x, title) > 0))
}

async function fast(message: string, env: FastEnv): Promise<FastResult | null> {
  if (env.cardEditing) return null   // his message is the correction to the card (fast paths are skipped then anyway)
  const text = message.trim()
  if (!text || text.startsWith('/') || text.length > 160) return null
  const nowMin = minutesOf(timeOf(env.now))
  if (env.cardOpen) {
    // a card is waiting for his tap: only a clearly new event gets its own card; anything else may be a change to
    // that card, so the brain reads it (with the card)
    const ev = parseNewEvent(text, env.today, nowMin)
    if (!ev || await cardIsAbout(env.sb, ev.title)) return null
    return newEvent(env, ev)
  }

  // 1. the week's top priorities ("top priority this week is FM HT2"); "ACT top priority this week" is the tracker's
  const pv = parsePriority(text)
  if (pv) {
    const reviews = await loadReviews(env.sb, env.today)
    if (reviews === 'missing') return { kind: 'answer', html: 'Priorities need the weekly check-in table first: run <code>supabase/step7-checkin.sql</code> in Supabase.' }
    const r = checkPriority(pv, (w) => reviews.find((x) => x.week_start === w)?.priorities ?? [], env.today)
    if (r.problem) return { kind: 'answer', html: `Nothing to change: ${esc(r.problem)}.` }
    return { kind: 'actions', actions: [raw({ op: 'life_priority', value: pv })] }
  }

  // 2. routines ("add stretch 10 min to my morning routine", "cold shower after breakfast")
  const blockDays = parseBlockDays(text)
  const rv = parseRoutine(text) ?? (blockDays ? `do=days; block=${blockDays.block}; days=${blockDays.days}` : null)
  if (rv) {
    const w = await loadRoutineWorld(env.sb)
    const r = checkRoutine(rv, null, w)
    if (r.change) return { kind: 'actions', actions: [raw({ op: 'life_routine', value: rv })] }
    // a clear routine message about a routine he has, that can't be done as asked: say why (no AI needed)
    const named = /\broutine\b/i.test(text) && /routine=/.test(rv) && !/^which routine/.test(r.problem ?? '')
    return named ? { kind: 'answer', html: `Nothing to change: ${esc(r.problem ?? 'I couldn’t work that out')}.` } : null
  }

  // 3. repeats the app can't do yet → App ideas
  // ("should I do gym every other day at 7?" is a question, not a request: the brain answers it)
  // (and a reminder, test, mock, log or change that mentions a repeat isn't one either: "monthly mock Sat 9am")
  const idea = /\?|^(?:what|when|where|which|who|why|how|should|shall|is|are|can|could|do|does|am)\b/i.test(text.trim()) || looksLikeOther(text) ? null : unsupportedRepeat(text)
  if (idea) {
    const t = findTime(text.replace(/\b(?:every (?:other|second) days?|alternate days?|every other|every second|every (?:2|two) weeks|fortnightly|bi-?weekly|monthly|every month|once a month)\b/gi, ' '))
    return t && t !== 'bad' ? { kind: 'idea', request: idea } : null
  }

  // 4. a new event ("family dinner Sat 7")
  const ev = parseNewEvent(text, env.today, nowMin)
  if (ev) return newEvent(env, ev)

  // 5. cancelling or moving one of his events ("dinner's off", "move football to Thu 8")
  const ch = parseChange(text, env.today)
  if (ch) return eventChange(env, text, ch, nowMin)
  return null
}

// ---------------------------------------------------------------------------
// The plug-in
// ---------------------------------------------------------------------------

export const plugin: BotPlugin = {
  name: 'life',
  ops: ['life_routine', 'life_priority'],
  prompt: `- Events by chat: plans and appointments he mentions are one-off events (event_new) unless he says every / weekly (event_weekly). Dinner, friends, the cinema and parties are evening times like football ("dinner Sat 7" = 19:00, "8-11" = 20:00–23:00). With no end, time_to = a sensible length (meal 2 h, football 1.5 h, cinema 2.5 h, party 3 h, else 1 h).
- Routines (see "Routines" and "Routine blocks"): life_routine (ref R… or value routine=<its name>). value "routine=Morning; do=add; block=Stretch (10 min); after=Shower" (or before=…, at=start; default: at the end) · "do=add; block=Teeth; step=Floss" (a step inside a block) · "do=move; block=Cold shower; after=Breakfast" (or before=…, at=start|end) · "do=rename; block=Teeth; name=Teeth + floss" (no block: renames the routine) · "do=remove; block=Skincare" (archived, never deleted; add step=… to remove one step) · "do=days; days=every day | weekdays | weekends | mon, wed" (the routine's days; with block=… only that block's days). Routines are guides: never overdue, nothing to tick.
- Weekly priorities (see "Top priorities"): life_priority. value "do=first; text=FM HT2" ("top priority this week is FM HT2": goes first, at most 3) · "do=set; list=HT2, ACT, gym" (the whole list, at most 3) · "do=add; text=gym" · "do=drop; text=ACT" · "do=clear"; add "; week=next" for next week's. Words he steers by, shown in the Sunday check-in; not a planner rule ("ACT top priority this week", which changes what gets planned, is not this).`,

  async loadRows(sb, list, today) {
    const rows: Rows = {}
    if (list.some((a) => a.op === 'life_routine')) rows.routines = await loadRoutineWorld(sb)
    if (list.some((a) => a.op === 'life_priority')) rows.reviews = await loadReviews(sb, today)
    return rows
  },

  check(op, a, rows, env) {
    const r = (rows ?? {}) as Rows
    if (op === 'life_routine') {
      if (!r.routines) return { problem: 'couldn’t read your routines' }
      const c = checkRoutine(a.value, env.ref?.kind === 'routine' ? env.ref.id : null, r.routines)
      if (!c.change) return { problem: c.problem ?? 'nothing to change in your routines' }
      return { action: { op, table: c.change.table, id: c.change.id, title: c.change.title, line: c.change.line, patch: c.change.patch as unknown as Record<string, unknown> } }
    }
    if (op === 'life_priority') {
      if (!r.reviews) return { problem: 'couldn’t read your priorities' }
      if (r.reviews === 'missing') return { problem: 'priorities need supabase/step7-checkin.sql first' }
      const reviews = r.reviews
      const c = checkPriority(a.value, (w) => reviews.find((x) => x.week_start === w)?.priorities ?? [], env.today)
      if (!c.change) return { problem: c.problem ?? 'nothing to change in your priorities' }
      const week = c.change.week
      return { action: { op, table: 'weekly_reviews', id: reviews.find((x) => x.week_start === week)?.id ?? null, title: 'Top priorities', line: c.change.line, patch: { week, priorities: c.change.after } } }
    }
    return { problem: `“${op}” isn’t a life change` }
  },

  apply: (sb, a, now) => (a.op === 'life_priority' ? applyPriority(sb, a) : applyRoutine(sb, a, now)),
  undo: (sb, a) => (a.op === 'life_priority' ? undoPriority(sb, a) : undoRoutine(sb, a)),

  async snapshot(sb): Promise<SnapshotPart> {
    // his routines' blocks in order (the names life_routine uses); the routines themselves are in the main snapshot (R…)
    const w = await loadRoutineWorld(sb, false)
    const lines = w.routines.filter((r) => r.is_active).map((r) => {
      const blocks = liveBlocks(w, r.id).map((b) => `${b.name}${b.days_of_week?.length ? ` (${daysWords(b.days_of_week)} only)` : b.condition_label ? ` (${b.condition_label})` : ''}`)
      return `${r.name} (${daysWords(r.days_of_week)}): ${blocks.join(' → ') || 'no blocks yet'}`
    })
    return { sections: lines.length ? [{ title: 'Routine blocks (in order; change with life_routine)', lines }] : [], refs: [] }
  },

  fast,
}
