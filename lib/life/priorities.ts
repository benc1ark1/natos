// Pure: his top priorities for a week (weekly_reviews.priorities, at most 3, his own words; the Sunday check-in shows
// and sets them, and the brain reads them). By chat: "top priority this week is FM HT2", "my 3 priorities: HT2, ACT,
// gym", "add gym to my priorities", "drop the ACT priority", "clear my priorities". These are words he steers by, not a
// planner rule: "ACT top priority this week" (a temporary rule that changes the plan) belongs to the tracker (trk_rule).
import { addDays, dowShort, shortDate, weekStartISO } from '../time'
import { sameWord, tokens } from './match'

export const MAX_PRIORITIES = 3
export type PriorityChange = { week: string; before: string[]; after: string[]; line: string; dropped: string[] }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const kvOf = (v: string) => Object.fromEntries((v ?? '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? [x.trim().toLowerCase(), ''] : [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()] }).filter((x) => x[0] && x[1]))
const clean = (s: string) => s.replace(/^["“'‘]+|["”'’]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
/** "HT2, ACT and gym" / "HT2 | ACT | gym" → the items. */
export const splitList = (s: string) => s.split(/\s*(?:,|\||;|\band\b|&|\n|\d\)|\d\.)\s*/i).map(clean).filter(Boolean)
const same = (a: string, b: string) => { const x = tokens(a), y = tokens(b); return x.length > 0 && x.length === y.length && x.every((w, i) => sameWord(w, y[i])) }
/** The priority his words point at ("the ACT priority" → "ACT practice"): exact first, then every word of his in it. */
export function findPriority(list: string[], words: string): number {
  const w = tokens(words.replace(/\bpriorit(?:y|ies)\b/gi, ' '))
  if (!w.length) return -1
  const exact = list.findIndex((p) => same(p, words.replace(/\bpriorit(?:y|ies)\b/gi, ' ')))
  if (exact >= 0) return exact
  const close = list.map((p, i) => ({ i, t: tokens(p) })).filter((x) => w.every((a) => x.t.some((b) => sameWord(a, b))))
  return close.length === 1 ? close[0].i : -1
}

/** The Monday of the week he means: "this week", "next week", else the week the Sunday check-in is about (at the weekend: next week). */
export function priorityWeek(today: string, which: string | undefined): string {
  if (/next/i.test(which ?? '')) return addDays(weekStartISO(today), 7)
  if (/this/i.test(which ?? '')) return weekStartISO(today)
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay()
  return dow === 6 || dow === 0 ? addDays(weekStartISO(today), 7) : weekStartISO(today)
}

/** value "do=first|add|set|drop|clear; text=…" (set: "list=a, b, c"; week=this|next) against the week's current list. */
export function checkPriority(value: string, current: (week: string) => string[], today: string): { change?: PriorityChange; problem?: string } {
  const kv = kvOf(value)
  const act = (kv.do ?? '').toLowerCase()
  const week = priorityWeek(today, kv.week)
  const before = current(week)
  const text = clean(kv.text ?? '')
  let after: string[]
  let dropped: string[] = []
  if (act === 'first' || act === 'top') {
    if (!text) return { problem: 'what’s the top priority?' }
    if (before[0] && same(before[0], text)) return { problem: `“${before[0]}” is already your top priority` }
    const rest = before.filter((p) => !same(p, text))
    after = [text, ...rest].slice(0, MAX_PRIORITIES)
    dropped = [text, ...rest].slice(MAX_PRIORITIES)
  } else if (act === 'add') {
    if (!text) return { problem: 'which priority should I add?' }
    if (before.some((p) => same(p, text))) return { problem: `“${text}” is already a priority` }
    if (before.length >= MAX_PRIORITIES) return { problem: `you already have ${MAX_PRIORITIES} priorities (${before.join(', ')}): drop one first, or send all three (“my 3 priorities: …”)` }
    after = [...before, text]
  } else if (act === 'set') {
    const list = splitList(kv.list ?? kv.text ?? '')
    if (!list.length) return { problem: 'which priorities?' }
    if (list.length > MAX_PRIORITIES) return { problem: `at most ${MAX_PRIORITIES} priorities a week (you sent ${list.length})` }
    after = list
  } else if (act === 'drop' || act === 'remove') {
    const i = findPriority(before, text)
    if (i < 0) return { problem: before.length ? `“${text}” isn’t one of that week’s priorities (${before.join(', ')})` : 'that week has no priorities yet' }
    after = before.filter((_, j) => j !== i)
    dropped = [before[i]]
  } else if (act === 'clear') {
    if (!before.length) return { problem: 'that week has no priorities to clear' }
    after = []
  } else return { problem: 'set, add, drop or clear a priority?' }
  if (after.join('|') === before.join('|')) return { problem: 'your priorities are already that' }
  const show = (l: string[]) => (l.length ? l.map((p, i) => `${i + 1}. ${esc(p)}`).join(' · ') : 'none')
  const line = `🎯 Top priorities, week of ${dowShort(week)} ${shortDate(week)}: ${show(before)} → <b>${show(after)}</b>${act === 'first' && dropped.length ? ` <i>(${esc(dropped.join(', '))} drops off: 3 at most)</i>` : ''}`
  return { change: { week, before, after, line, dropped } }
}

/**
 * His words → a life_priority value, or null. "ACT top priority this week" is NOT this (a planner rule: the tracker
 * plug-in's) and gives null, as does anything else unsure.
 */
export function parsePriority(message: string): string | null {
  const t = message.replace(/[’‘]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '')
  if (!t || t.length > 160 || /\?/.test(t)) return null
  const wk = (s: string | undefined) => (s && /next/i.test(s) ? 'next' : s && /this/i.test(s) ? 'this' : undefined)
  const v = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, x]) => x).map(([k, x]) => `${k}=${x!.replace(/[;=]/g, " ").trim()}`).join('; ')
  const W = '(?:\\s+(this week|next week|for (?:this|next) week|for the week))?'
  let m = t.match(new RegExp(`^(?:my )?(?:top|main|number one|#1|no\\.? ?1) priority${W} (?:is|=|:|will be|should be) (.+)$`, 'i'))
  if (m) return v({ do: 'first', text: clean(m[2]), week: wk(m[1]) })
  m = t.match(new RegExp(`^(?:my )?(?:(?:top )?(?:3|three|2|two) )?(?:top )?priorities${W}(?: are| will be|:|=| -)\\s*(.+)$`, 'i'))
  if (m) return splitList(m[2]).length ? v({ do: 'set', list: splitList(m[2]).join(', '), week: wk(m[1]) }) : null
  m = t.match(new RegExp(`^(?:please )?add (.+?) (?:to|as) (?:my |the )?(?:top )?priorit(?:ies|y)${W}$`, 'i'))
  if (m) return v({ do: 'add', text: clean(m[1]), week: wk(m[2]) })
  m = t.match(new RegExp(`^(?:please )?(?:drop|remove|delete|scrap|take off|cross off) (?:the )?(.+?) (?:priority|from (?:my |the )?(?:top )?priorities)${W}$`, 'i'))
  if (m) return v({ do: 'drop', text: clean(m[1]), week: wk(m[2]) })
  m = t.match(new RegExp(`^(?:please )?(?:clear|reset|wipe) (?:my |the )?(?:top )?priorities${W}$`, 'i'))
  if (m) return v({ do: 'clear', week: wk(m[1]) })
  return null
}
