// Server-only: this week's time savings and better returns (Build O part 6), for the Sunday card, "where can I save
// time?" in the bot, and Insights on Home. lib/roi.ts works them out; this file loads the week, keeps what he applied
// or put off this week (telegram_sent keys, and the recommendations table after build-o.sql), and turns a
// suggestion into a normal checked change (✅ Apply / ✋ Not now, ↩️ Undo).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { optimise } from '../optimiser'
import { suggest, timeSplit, hours, type Suggestion, type TimeSplit } from '../roi'
import { activePlaces, activeSessions } from '../setup'
import { typeOf } from '../training-data'
import { trainingTypes } from '../training'
import { weekStartISO } from '../time'
import { optWorldOf } from '../week'
import { applyActions, type Action, type Applied } from './actions'
import { checkC2, loadC2Rows } from './actions-c2'
import { esc, type Button } from './api'
import { claim } from './sent'
import { loadWorld, weekRange } from './ripple'
import type { Ref } from './turns'
import type { ViewData } from './views'

export type { Suggestion }
export type Insights = { range: { from: string; to: string }; suggestions: Suggestion[]; split: TimeSplit; upper: string | null; compare: string | null }

const yesKey = (wk: string, key: string) => `roi-yes:${wk}:${key}`
const noKey = (wk: string, key: string) => `roi-no:${wk}:${key}`

/** The week's suggestions (minus what he applied or put off this week) and where its time goes. */
export async function weekInsights(sb: SupabaseClient, data: ViewData, range = weekRange(data.today)): Promise<Insights> {
  const world = await loadWorld(sb, data, range)
  const ow = optWorldOf(world)
  const plan = optimise(ow, { compare: true })
  const wk = weekStartISO(range.from)
  const { data: seen } = await sb.from('telegram_sent').select('key').or(`key.like.roi-yes:${wk}:%,key.like.roi-no:${wk}:%`)
  const done = new Set((seen ?? []).map((r) => (r.key as string).split(':').slice(2).join(':')))
  const suggestions = suggest(ow, plan, world.mental ?? []).filter((s) => !done.has(s.key))
  const types = trainingTypes(data.planning)
  const split = timeSplit({ from: range.from, to: range.to, events: world.events, changes: world.changes, blocks: world.planned, plan, shapes: data.shapes,
    sessions: activeSessions(data.planning), places: activePlaces(data.planning), isTraining: (e) => !!typeOf(e as never, types) })
  return { range, suggestions, split, upper: plan.upper?.reason ?? null, compare: plan.compare }
}

/** The top suggestions in one line each (the Sunday card's opening lines). */
export async function recommendations(sb: SupabaseClient, data: ViewData, range: { from: string; to: string }): Promise<Suggestion[]> {
  return (await weekInsights(sb, data, range)).suggestions
}

/** A suggestion as checked changes (the same checks the chat uses). */
export async function suggestionActions(sb: SupabaseClient, s: Suggestion, today: string): Promise<{ actions: Action[]; problem?: string }> {
  const rows = await loadC2Rows(sb, [], [], today)
  const raw = (op: string, value: string) => ({ op, value, date: '', date_to: '', time: '', time_to: '', number: 0, words: 'suggestion' })
  const r = s.change.op === 'upper_week' ? checkC2('upper_week', raw('upper_week', `count=${s.change.count}`), undefined, rows, () => true, today)
    : checkC2('setup_set', raw('setup_set', s.change.value), undefined, rows, () => true, today)
  return r.action ? { actions: [r.action as Action] } : { actions: [], problem: r.problem }
}

/** Remember what he did with it this week (and in the history table, once build-o.sql has run). */
export async function recordSuggestion(sb: SupabaseClient, s: Pick<Suggestion, 'key' | 'title' | 'savesMin'>, weekStart: string, status: 'applied' | 'dismissed') {
  await claim(sb, status === 'applied' ? yesKey(weekStart, s.key) : noKey(weekStart, s.key)).catch(() => false)
  await sb.from('recommendations').upsert({ week_start: weekStart, key: s.key.slice(0, 120), title: s.title.slice(0, 300), saves_min: Math.min(2000, s.savesMin), status }, { onConflict: 'user_id,week_start,key' }).then(() => null, () => null)
}

/** Apply one (the dashboard's ✅): the changes, recorded. Returns what Undo needs. */
export async function applySuggestion(sb: SupabaseClient, data: ViewData, key: string): Promise<{ applied?: Applied[]; line?: string; error?: string }> {
  const ins = await weekInsights(sb, data)
  const s = ins.suggestions.find((x) => x.key === key)
  if (!s) return { error: 'That suggestion isn’t there any more.' }
  const { actions, problem } = await suggestionActions(sb, s, data.today)
  if (!actions.length) return { error: problem ?? 'Nothing to change.' }
  const res = await applyActions(sb, actions)
  if (res.error) return { error: res.error }
  await recordSuggestion(sb, s, weekStartISO(ins.range.from), 'applied')
  return { applied: res.applied, line: actions.map((a) => a.line.replace(/<[^>]+>/g, '')).join('; ') }
}

export async function dismissSuggestion(sb: SupabaseClient, data: ViewData, key: string): Promise<{ error?: string }> {
  const ins = await weekInsights(sb, data)
  const s = ins.suggestions.find((x) => x.key === key)
  if (!s) return { error: 'That suggestion isn’t there any more.' }
  await recordSuggestion(sb, s, weekStartISO(ins.range.from), 'dismissed')
  return {}
}

const LABELS: Record<keyof TimeSplit, string> = { school: '🏫 School', study: '📚 Study', training: '🏋️ Training', travel: '🚌 Travel', routines: '☀️🌙 Routines', free: '🕊 Free' }

/** "where can I save time?": each suggestion with what it saves and the catch, ✅ Apply / ✋ Not now under it. */
export async function savingsText(sb: SupabaseClient, d: ViewData): Promise<{ html: string; refs: Ref[]; buttons?: Button[][] }> {
  const ins = await weekInsights(sb, d)
  const wk = weekStartISO(ins.range.from)
  const lines = ['⏱ <b>Where you can save time this week</b>']
  const total = ins.suggestions.reduce((a, s) => a + s.savesMin, 0)
  const buttons: Button[][] = []
  if (!ins.suggestions.length) lines.push('Nothing worth changing: your week is already lean.')
  for (const [i, s] of ins.suggestions.slice(0, 4).entries()) {
    lines.push('', `${i + 1}. ${esc(s.title)}`, `   <i>Saves ${s.savesMin} min/week · trade-off: ${esc(s.tradeoff)}</i>`)
    const { actions } = await suggestionActions(sb, s, d.today)
    if (!actions.length) continue
    const { data: row } = await sb.from('telegram_pending').insert({ kind: 'action', text: s.short.slice(0, 500), payload: { actions, problems: [], summary: s.title, roi: { key: s.key, title: s.title, savesMin: s.savesMin, weekStart: wk } } }).select('id').single()
    if (row) buttons.push([{ text: `✅ Apply ${i + 1}`, callback_data: `a:${row.id}` }, { text: `✋ Not now ${i + 1}`, callback_data: `x:${row.id}` }])
  }
  if (total) lines.push('', `<i>Up to ${hours(total)} a week to win back.</i>`)
  const sp = ins.split
  lines.push('', '<b>Where this week goes</b>', (Object.keys(LABELS) as (keyof TimeSplit)[]).map((k) => `${LABELS[k]} ${hours(sp[k])}`).join(' · '))
  return { html: lines.join('\n'), refs: [], buttons: buttons.length ? buttons : undefined }
}
