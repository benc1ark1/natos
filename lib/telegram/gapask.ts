// Server-only: the gap questions (Build O part 4). One question at a time, the most important first, with quick-tap
// answers (or he types it); at most gapsPerDay a day, never in his quiet hours or during school. Until he answers,
// plans use the guess and say so. Every answer is a normal checked change (a setting, his set-up, a calendar session
// in Life OS…) with ↩️ Undo, and the week is re-planned after it: the next question comes first, then (once the
// round is done) the Your week card again, or a short "moved X — ✅?" card if the week is already applied.
// The cards are 'type' cards (the kind the training-type question uses), so this works before build-o.sql.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { expandEvents, isSchool } from '../events'
import { findGaps, readAnswer, type Gap } from '../gaps'
import { SETTINGS, currentSettings, moreSettings, parseSetting, showSetting } from '../settings'
import { addDays, dateISOOf, dowShort, minutesOf, timeOf, todayISO, weekStartISO } from '../time'
import { applyActions, type Action } from './actions'
import { checkC2, loadC2Rows, type C2Action } from './actions-c2'
import { esc, type Button } from './api'
import { claim } from './sent'
import { say } from './turns'
import { loadViewData, type ViewData } from './views'

type GapCard = { id: string; payload: { gap: Gap; round?: number; applied?: unknown }; created_at: string; status: string }

const GAP_ASKED = (date: string, key: string) => `gap-asked:${date}:${key}`

/** The question waiting for his answer (asked in the last 6 hours), if any. */
export async function openGap(sb: SupabaseClient): Promise<GapCard | null> {
  const since = new Date(Date.now() - 6 * 3_600_000).toISOString()
  const { data } = await sb.from('telegram_pending').select('id,payload,created_at,status').eq('kind', 'type').eq('status', 'open').gte('created_at', since)
    .order('created_at', { ascending: false }).limit(30)
  return ((data ?? []) as GapCard[]).find((c) => !!c.payload?.gap) ?? null
}

/** The gaps as they are now (his events and settings). */
export async function currentGaps(sb: SupabaseClient, data?: ViewData): Promise<Gap[]> {
  const d = data ?? await loadViewData(sb, todayISO())
  const { data: cleanup } = await sb.from('telegram_sent').select('created_at').eq('key', 'onboard:cleanup').maybeSingle()
  return findGaps({ planning: d.planning, events: d.events, changes: d.changes, today: d.today, createdAfter: cleanup?.created_at ?? new Date(Date.now() - 3 * 86_400_000).toISOString() })
}

/** Can a question go out now? Not in quiet hours, not during school, not over today's number. */
async function mayAsk(sb: SupabaseClient, data: ViewData, now: Date): Promise<{ ok: boolean; why?: string; count: number }> {
  const s = moreSettings(data.planning)
  const t = timeOf(now)
  const today = dateISOOf(now.toISOString())
  const { data: asked } = await sb.from('telegram_sent').select('key').like('key', `gap-asked:${today}:%`)
  const count = asked?.length ?? 0
  if (count >= s.gapsPerDay) return { ok: false, why: 'today’s questions are done', count }
  if (minutesOf(t) >= minutesOf(s.quietFrom) || minutesOf(t) < minutesOf(s.briefAt)) return { ok: false, why: 'quiet hours', count }
  const school = expandEvents(data.events, today, today, data.changes).filter((o) => o.date === today && !o.cancelled && o.event.is_busy && isSchool(o.event) && o.start && o.end)
  if (school.some((o) => minutesOf(t) >= minutesOf(o.start!) - 15 && minutesOf(t) < minutesOf(o.end!) + 15)) return { ok: false, why: 'school', count }
  return { ok: true, count }
}

/**
 * Ask the next question, if one may go out now. `intro`: the first of a round ("I need a few details…").
 * `force`: he asked for them ("ask me now"): school and quiet hours still apply, the daily number doesn't.
 */
export async function askNextGap(sb: SupabaseClient, chatId: number, now = new Date(), opts: { intro?: boolean; force?: boolean; data?: ViewData } = {}): Promise<boolean> {
  if (!opts.force && (await sb.from('telegram_sent').select('key').eq('key', 'gaps:paused').maybeSingle()).data) return false   // "stop asking me questions"
  const data = opts.data ?? await loadViewData(sb, dateISOOf(now.toISOString()), now)
  const may = await mayAsk(sb, data, now)
  if (!may.ok && !(opts.force && may.why === 'today’s questions are done')) return false
  if (!opts.force) {
    const open = await openGap(sb)
    if (open && Date.now() - Date.parse(open.created_at) < 3 * 3_600_000) return false   // waiting for his answer
  }
  const today = data.today
  const gaps = await currentGaps(sb, data)
  // not one he was asked yesterday or today and didn't answer (it comes back later)
  const { data: recent } = await sb.from('telegram_sent').select('key').or(`key.like.gap-asked:${today}:%,key.like.gap-asked:${addDays(today, -1)}:%`)
  const asked = new Set((recent ?? []).map((r) => (r.key as string).split(':').slice(2).join(':')))
  const g = gaps.find((x) => !asked.has(x.key))
  if (!g) return false
  if (!(await claim(sb, GAP_ASKED(today, g.key)))) return false
  const s = moreSettings(data.planning)
  const left = Math.max(1, Math.min(gaps.length, (opts.force ? gaps.length : s.gapsPerDay - may.count)))
  const { data: row, error } = await sb.from('telegram_pending').insert({ kind: 'type', text: g.question.slice(0, 500), payload: { gap: g, round: may.count + 1 } }).select('id').single()
  if (error || !row) throw new Error(`Couldn’t ask: ${error?.message ?? 'not saved'}`)
  const b = (i: number, label: string): Button => ({ text: label, callback_data: `g:${row.id}:o${i}` })
  const rows: Button[][] = []
  for (let i = 0; i < g.options.length; i += 2) rows.push(g.options.slice(i, i + 2).map((o, j) => b(i + j, o.label)))
  rows.push([{ text: '✋ Skip for now', callback_data: `g:${row.id}:skip` }])
  const head = opts.intro ? '🧩 <b>I need a few details to plan your week properly — 2 min.</b>\n\n' : ''
  await say(sb, chatId, `${head}❓ <b>${esc(g.question)}</b>${left > 1 ? ` <i>(${may.count + 1} of ${may.count + left})</i>` : ''}\n<i>Why: ${esc(g.why)}. Until you answer I use: ${esc(g.guess)} (guess).</i>${g.free ? `\n<i>Tap one, ${esc(g.free)}.</i>` : ''}`,
    rows, { pending_id: row.id, intent: 'question' })
  return true
}

// ---------------------------------------------------------------------------
// His answer → checked changes (applied at once: he tapped it), with Undo
// ---------------------------------------------------------------------------

/** What an answer changes: the same checked changes the chat uses (lib/telegram/actions-c2.ts). */
async function changesFor(sb: SupabaseClient, g: Gap, value: string, today: string): Promise<{ actions: C2Action[]; problem?: string }> {
  const rows = await loadC2Rows(sb, 'all', [], today)
  const raw = (op: string, v: string) => ({ op, value: v, date: '', date_to: '', time: '', time_to: '', number: 0, words: 'answer' })
  const one = (op: Parameters<typeof checkC2>[0], v: string, ref?: { kind: string; id: string }) => {
    const r = checkC2(op, raw(op, v), ref, rows, () => true, today)
    return r.action ? { actions: [r.action] } : { actions: [], problem: r.problem ?? 'that didn’t work' }
  }
  const done = (key: string, v: string): { actions: C2Action[] } => {
    const map = { ...(((rows.planning as Record<string, unknown> | null)?.gapsDone ?? {}) as Record<string, string>), [key]: v }
    return { actions: [{ op: 'gap_done', table: 'profiles', id: 'gapsDone', title: 'noted', line: '✓ noted', patch: { gapsDone: map } }] }
  }
  const k = g.key
  if (k.startsWith('game:')) {
    const wk = k.slice(5)
    if (value === 'none') return one('game_week', 'none=yes')
    if (value === 'usual') return one('game_week', 'usual=yes')
    if (value === 'sat' || value === 'sun') return one('game_week', `date=${addDays(wk, value === 'sat' ? 5 : 6)}`)
    const m = value.match(/^day=(\d)(?:;leave=([\d:]{5}))?(?:;back=([\d:]{5}))?$/)
    if (!m) return { actions: [], problem: 'which day?' }
    return one('game_week', `date=${addDays(wk, Number(m[1]) - 1)}${m[2] ? `; leave=${m[2]}` : ''}${m[3] ? `; back=${m[3]}` : ''}`)
  }
  if (k === 'football') {
    if (value === 'none') return one('setting', 'footballDays=none')
    const m = value.match(/^(\d\d:\d\d)–(\d\d:\d\d)$/)
    if (!m) return { actions: [], problem: 'what time?' }
    const days = moreSettings(rows.planning).footballDays.split(',').map((d) => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(d.trim()) + 1).filter((d) => d > 0)
    const r = checkC2('event_weekly', { ...raw('event_weekly', 'Football training'), words: days.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1]).join(' and '), time: m[1], time_to: m[2] }, undefined, rows, () => true, today)
    if (!r.action) return { actions: [], problem: r.problem }
    r.action.patch = { ...r.action.patch, training_type: 'football', load: 'hard' }
    return { actions: [r.action] }
  }
  if (k.startsWith('type:')) {
    // every copy of that session, by its name (like "Games isn't a match")
    const r = checkC2('training_type', { ...raw('training_type', value), words: g.meta?.title ?? '' }, undefined, rows, () => true, today)
    return r.action ? { actions: [r.action] } : { actions: [], problem: r.problem }
  }
  // a setting: saved even when the answer is the same as the guess (then it's his, not a guess any more)
  const setting = (key: string) => {
    const has = !!rows.planning && typeof rows.planning === 'object' && key in (rows.planning as Record<string, unknown>)
    const parsed = parseSetting(key, value, rows.planning)
    if (!has && parsed !== null && currentSettings(rows.planning)[key] === parsed) {
      return { actions: [{ op: 'setting' as const, table: 'profiles' as const, id: key, title: SETTINGS[key].label, line: `⚙️ ${esc(SETTINGS[key].label)}: <b>${esc(showSetting(key, parsed))}</b> <i>(confirmed)</i>`, patch: { [key]: parsed } }] }
    }
    return one('setting', `${key}=${value}`)
  }
  if (k === 'wake') return setting('wakeAt')
  if (k === 'bed') return setting('bedAt')
  if (k === 'morning') return setting('morningMin')
  if (k === 'night') return setting('nightMin')
  if (k === 'focus') return setting('focusBest')
  if (k === 'block') return setting('maxBlockMin')
  if (k === 'travelmax') return setting('maxTravelMin')
  if (k.startsWith('minutes:')) return one('setup_set', `session=${k.slice(8)}; minutes=${value}`)
  if (k === 'travel:owen') return one('setup_set', `place=owen; both=${value}`)
  if (k === 'travel:school_home') return one('setup_set', `place=home; fromSchool=${value}`)
  if (k === 'school') {
    if (value === 'yes') return done('school', today)
    const m = value.match(/^day=(\d);end=(\d\d:\d\d)$/)
    if (!m) return { actions: [], problem: 'which day and time?' }
    return one('school_day', `day=${['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][Number(m[1]) - 1]}; end=${m[2]}`)
  }
  if (k.startsWith('new:')) return value === 'ignore' ? one('session_ignore', `title=${g.meta?.title ?? ''}`) : done(k, today)
  return { actions: [], problem: 'I can’t use that answer' }
}

/** Save his answer (a tap or typed words), then re-plan and ask the next one. */
export async function answerGap(sb: SupabaseClient, chatId: number, card: GapCard, value: string): Promise<void> {
  const g = card.payload.gap
  const today = todayISO()
  const { actions, problem } = await changesFor(sb, g, value, today)
  if (!actions.length) {
    await sb.from('telegram_pending').update({ status: 'open' }).eq('id', card.id)
    await say(sb, chatId, `⚠️ ${esc(problem ?? 'That didn’t work')}. Tap an answer, or type it again.`, undefined, { pending_id: card.id })
    return
  }
  const res = await applyActions(sb, actions as Action[])
  if (res.error) {
    await sb.from('telegram_pending').update({ status: 'open' }).eq('id', card.id)
    await say(sb, chatId, `⚠️ Not saved: ${esc(res.error)}`, undefined, { pending_id: card.id })
    return
  }
  await sb.from('telegram_pending').update({ status: 'saved', payload: { ...card.payload, applied: res.applied, answer: value } }).eq('id', card.id)
  await sb.from('gap_answers').insert({ gap_key: g.key, question: g.question.slice(0, 500), answer: value.slice(0, 200) }).then(() => null, () => null)   // history (build-o.sql)
  const line = actions.filter((a) => a.op !== 'gap_done').map((a) => a.line).join('\n') || `✓ <b>${esc(g.question.replace(/\?$/, ''))}</b>: noted`
  await say(sb, chatId, `✅ ${line}\n<i>Saved; change it any time in Settings or by telling me.</i>`, [[{ text: '↩️ Undo', callback_data: `u:${card.id}` }]], { pending_id: card.id })
  await afterAnswer(sb, chatId)
}

/** After an answer: the next question first; once the round is done, the week again (re-planned with what he said). */
export async function afterAnswer(sb: SupabaseClient, chatId: number): Promise<void> {
  if (await askNextGap(sb, chatId, new Date()).catch(() => false)) return
  const { refitAfterChange } = await import('./refit')
  await refitAfterChange(sb, chatId, 'with your answers').catch(() => null)
  // the Owen days card from the first morning, if he hasn't answered it yet, with his answers in
  const { refreshOwenCard } = await import('./owen')
  await refreshOwenCard(sb, chatId).catch(() => null)
}

/** He typed instead of tapping: if a question is waiting and his words answer it, that's the answer (no AI needed). */
export async function typedGapAnswer(sb: SupabaseClient, chatId: number, text: string): Promise<boolean> {
  const t = text.trim()
  if (t.length > 60 || /\?/.test(t) || /^(what|when|where|why|how|plan|did|done|remind|add|move|cancel|drop|show|ask|tell|can|could|should)\b/i.test(t)) return false
  const card = await openGap(sb)
  if (!card) return false
  const value = readAnswer(card.payload.gap, t)
  if (value == null) return false
  const { data: mine } = await sb.from('telegram_pending').update({ status: 'saved' }).eq('id', card.id).eq('status', 'open').select('id').maybeSingle()
  if (!mine) return false
  await answerGap(sb, chatId, card, value)
  return true
}

/** "what do you still need to know?": every gap with the guess in use. */
export async function gapsText(sb: SupabaseClient, data: ViewData): Promise<string> {
  const gaps = await currentGaps(sb, data)
  if (!gaps.length) return '🧩 Nothing: I know everything I need to plan your week. (Change anything by telling me, or in Settings.)'
  const s = moreSettings(data.planning)
  return [`🧩 <b>Still to find out</b> (${gaps.length})`, ...gaps.slice(0, 15).map((g, i) => `${i + 1}. ${esc(g.question)} <i>(using: ${esc(g.guess)})</i>`),
    gaps.length > 15 ? `<i>…and ${gaps.length - 15} more.</i>` : '',
    `<i>I ask ${s.gapsPerDay} a day, never at night or in school. Say “ask me now” to go through them.</i>`].filter(Boolean).join('\n')
}

export { weekStartISO, dowShort }
