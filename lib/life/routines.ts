// Pure: changing Nat's routines by chat ("add stretch 10 min to my morning routine", "cold shower after breakfast",
// "remove skincare from my night routine", "night routine every day"). A routine (habits) is an ordered list of blocks
// (habit_items), each with ordered steps (routine_steps). Routines are reference guides: nothing ticks and nothing
// ever becomes overdue. Nothing is deleted: a removed block or step is archived (archived_at, supabase/life.sql).
// The life plug-in (lib/telegram/plugins/life.ts) checks, applies and undoes these; this file only works them out.
import { weekdaysOf } from './parse'
import { sameWord, tokens } from './match'

export type Routine = { id: string; name: string; is_active: boolean; sort_order: number; days_of_week: number[] | null }
export type Block = { id: string; habit_id: string; name: string; sort_order: number; days_of_week: number[] | null; condition_label?: string | null; archived_at?: string | null }
export type Step = { id: string; habit_item_id: string; title: string; sort_order: number; archived_at?: string | null }
/** canArchive*: the archived_at columns exist (supabase/life.sql has been run). */
export type RoutineWorld = { routines: Routine[]; blocks: Block[]; steps: Step[]; canArchiveBlocks: boolean; canArchiveSteps: boolean }

/** The change, ready to apply (lib/telegram/plugins/life.ts). Orders: every live block's new sort_order. */
export type RoutinePatch =
  | { kind: 'add_block'; habit_id: string; name: string; sort_order: number; orders: Record<string, number> }
  | { kind: 'add_step'; item_id: string; title: string; sort_order: number }
  | { kind: 'rename_block'; id: string; name: string }
  | { kind: 'rename_routine'; id: string; name: string }
  | { kind: 'order'; habit_id: string; orders: Record<string, number> }
  | { kind: 'archive_block'; id: string }
  | { kind: 'archive_step'; id: string }
  | { kind: 'routine_days'; id: string; days: number[] }
  | { kind: 'block_days'; id: string; days: number[] | null }

export type RoutineChange = { table: 'habits' | 'habit_items' | 'routine_steps'; id: string | null; title: string; line: string; patch: RoutinePatch }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const kvOf = (v: string) => Object.fromEntries((v ?? '').split(';').map((x) => { const i = x.indexOf('='); return i < 0 ? [x.trim().toLowerCase(), ''] : [x.slice(0, i).trim().toLowerCase(), x.slice(i + 1).trim()] }).filter((x) => x[0] && x[1]))

/** "Mon–Fri", "every day", "Sat + Sun", "Mon, Wed, Fri". */
export function daysWords(days: number[] | null | undefined): string {
  const d = [...new Set(days ?? [])].sort()
  if (!d.length) return 'no days'
  if (d.length === 7) return 'every day'
  if (d.join() === '1,2,3,4,5') return 'Mon–Fri'
  if (d.join() === '6,7') return 'Sat + Sun'
  return d.map((x) => DOW[x - 1]).join(', ')
}

/** His words for days → ISO weekdays: "every day", "weekdays", "weekends", "mon, wed and fri". null if none. */
export function daysFrom(words: string): number[] | null {
  const w = words.toLowerCase()
  if (/\b(?:every ?day|daily|all week|7 days)\b/.test(w)) return [1, 2, 3, 4, 5, 6, 7]
  const d = weekdaysOf(w)
  return d.length ? d : null
}

const words = (s: string) => tokens(s.replace(/\broutine\b/gi, ' '))
/** A routine by his name for it ("morning" = Morning or Morning routine). */
export function findRoutine(w: RoutineWorld, name: string): Routine | null {
  const want = words(name)
  if (!want.length) return null
  const live = w.routines.filter((r) => r.is_active)
  const exact = live.filter((r) => words(r.name).join(' ') === want.join(' '))
  if (exact.length === 1) return exact[0]
  const close = live.filter((r) => { const t = words(r.name); return want.every((x) => t.some((y) => sameWord(x, y))) })
  return close.length === 1 ? close[0] : null
}

export const liveBlocks = (w: RoutineWorld, habitId: string) => w.blocks.filter((b) => b.habit_id === habitId && !b.archived_at).sort((a, b) => a.sort_order - b.sort_order)
const liveSteps = (w: RoutineWorld, itemId: string) => w.steps.filter((s) => s.habit_item_id === itemId && !s.archived_at).sort((a, b) => a.sort_order - b.sort_order)

/** A block of a routine by his name for it (exact first, then every word of his in it). 'many' if two could be it. */
export function findBlock(list: Block[], name: string): Block | 'many' | null {
  const want = tokens(name)
  if (!want.length) return null
  const exact = list.filter((b) => tokens(b.name).join(' ') === want.join(' '))
  if (exact.length === 1) return exact[0]
  const close = list.filter((b) => { const t = tokens(b.name); return want.every((x) => t.some((y) => sameWord(x, y))) })
  return close.length === 1 ? close[0] : close.length > 1 ? 'many' : null
}

/** The routine a block is in, when he names only the block ("cold shower after breakfast"): only if one routine has it. */
export function routineOfBlocks(w: RoutineWorld, names: string[]): Routine | null {
  const hits = w.routines.filter((r) => r.is_active && names.every((n) => { const b = findBlock(liveBlocks(w, r.id), n); return b && b !== 'many' }))
  return hits.length === 1 ? hits[0] : null
}

/** "stretch 10 min" → "Stretch (10 min)"; "Cold shower" stays. */
export function blockName(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim()
  const m = t.match(/^(.+?)\s*[(,-]?\s*(\d{1,3})\s*(?:min|mins|minutes|m)\)?$/i) ?? t.match(/^(\d{1,3})\s*(?:min|mins|minutes)\s+(?:of\s+)?(.+)$/i)
  if (m) {
    const [name, n] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]]
    return `${cap(name.trim())} (${Number(n)} min)`.slice(0, 80)
  }
  return cap(t).slice(0, 80)
}

/** New sort orders 1…n for the blocks in this order. */
const ordersOf = (list: { id: string }[]) => Object.fromEntries(list.map((b, i) => [b.id, i + 1]))
/** "after Breakfast", "at the start", … for the card. */
const whereWords = (list: Block[], i: number) => (i === 0 ? 'at the start' : i === list.length - 1 ? 'at the end' : `after ${list[i - 1].name}`)

/**
 * Check one life_routine change. value "routine=Morning; do=add|rename|move|remove|days; block=…; step=…; name=…;
 * after=… | before=… | at=start|end; days=…". `routineId`: the routine the brain's ref named (R…), if any.
 */
export function checkRoutine(value: string, routineId: string | null, w: RoutineWorld): { change?: RoutineChange; problem?: string } {
  const kv = kvOf(value)
  const act = (kv.do ?? '').toLowerCase()
  if (!['add', 'rename', 'move', 'remove', 'days'].includes(act)) return { problem: 'add, rename, move or remove a routine block, or change a routine’s days?' }
  let r = routineId ? w.routines.find((x) => x.id === routineId && x.is_active) ?? null : kv.routine ? findRoutine(w, kv.routine) : null
  if (!r && !kv.routine && !routineId) r = routineOfBlocks(w, [kv.block, kv.after, kv.before].filter(Boolean) as string[])
  if (!r) {
    const names = w.routines.filter((x) => x.is_active).map((x) => x.name)
    return { problem: `which routine${kv.routine ? ` (you have no routine called “${kv.routine}”` : ' ('}${names.length ? `${kv.routine ? '; ' : ''}yours: ${names.join(', ')})` : `${kv.routine ? '' : 'you have none yet'})`}?` }
  }
  const list = liveBlocks(w, r.id)
  const name = `<b>${esc(r.name)}</b>`
  const block = (n: string | undefined) => (n ? findBlock(list, n) : null)
  const missing = (n: string) => `“${n}” isn’t in your ${r!.name} routine (${list.map((b) => b.name).join(', ') || 'no blocks yet'})`

  if (act === 'days') {
    const days = kv.days ? daysFrom(kv.days) : null
    if (kv.block) {
      const b = block(kv.block)
      if (!b) return { problem: missing(kv.block) }
      if (b === 'many') return { problem: `which “${kv.block}”?` }
      const next = days && days.length === 7 ? null : days
      if (!days && !/^(?:always|every ?day)$/i.test(kv.days ?? '')) return { problem: `which days for ${b.name}?` }
      const was = b.days_of_week?.length ? daysWords(b.days_of_week) : 'every routine day'
      const now = next?.length ? daysWords(next) : 'every routine day'
      if (was === now) return { problem: `${b.name} is already ${now}` }
      return { change: { table: 'habit_items', id: b.id, title: b.name, line: `🔁 ${name} · ${esc(b.name)}: ${esc(was)} → <b>${esc(now)}</b>`, patch: { kind: 'block_days', id: b.id, days: next } } }
    }
    if (!days) return { problem: `which days for your ${r.name} routine?` }
    if (daysWords(days) === daysWords(r.days_of_week)) return { problem: `your ${r.name} routine is already ${daysWords(days)}` }
    return { change: { table: 'habits', id: r.id, title: r.name, line: `🔁 ${name} routine: ${esc(daysWords(r.days_of_week))} → <b>${esc(daysWords(days))}</b>`, patch: { kind: 'routine_days', id: r.id, days } } }
  }

  if (act === 'rename') {
    const to = (kv.name ?? '').trim().slice(0, 80)
    if (!to) return { problem: 'what should it be called?' }
    if (!kv.block) {
      if (to.toLowerCase() === r.name.toLowerCase()) return { problem: `it’s already called ${r.name}` }
      return { change: { table: 'habits', id: r.id, title: r.name, line: `🔁 Routine ${name} → <b>${esc(cap(to))}</b> <i>(renamed)</i>`, patch: { kind: 'rename_routine', id: r.id, name: cap(to) } } }
    }
    const b = block(kv.block)
    if (!b) return { problem: missing(kv.block) }
    if (b === 'many') return { problem: `which “${kv.block}”?` }
    if (to.toLowerCase() === b.name.toLowerCase()) return { problem: `it’s already called ${b.name}` }
    return { change: { table: 'habit_items', id: b.id, title: b.name, line: `🔁 ${name}: ${esc(b.name)} → <b>${esc(cap(to))}</b> <i>(renamed)</i>`, patch: { kind: 'rename_block', id: b.id, name: cap(to) } } }
  }

  if (act === 'remove') {
    if (kv.step) {
      const b = block(kv.block)
      if (!b || b === 'many') return { problem: kv.block ? missing(kv.block) : `which block of your ${r.name} routine is “${kv.step}” in?` }
      const s = findBlock(liveSteps(w, b.id).map((x) => ({ ...x, habit_id: b.id, name: x.title, days_of_week: null })), kv.step)
      if (!s || s === 'many') return { problem: `“${kv.step}” isn’t a step of ${b.name} (${liveSteps(w, b.id).map((x) => x.title).join(', ') || 'no steps'})` }
      if (!w.canArchiveSteps) return { problem: 'run supabase/life.sql first (it lets a routine step be archived instead of deleted)' }
      return { change: { table: 'routine_steps', id: s.id, title: s.name, line: `🔁 ${name} · ${esc(b.name)}: − ${esc(s.name)} <i>(archived, can be restored)</i>`, patch: { kind: 'archive_step', id: s.id } } }
    }
    const b = block(kv.block)
    if (!b) return { problem: kv.block ? missing(kv.block) : `which block of your ${r.name} routine?` }
    if (b === 'many') return { problem: `which “${kv.block}”?` }
    if (!w.canArchiveBlocks) return { problem: 'run supabase/life.sql first (it lets a routine block be archived instead of deleted)' }
    return { change: { table: 'habit_items', id: b.id, title: b.name, line: `🔁 ${name}: − ${esc(b.name)} <i>(archived, can be restored)</i>`, patch: { kind: 'archive_block', id: b.id } } }
  }

  // add / move: where it goes
  const place = (without: Block[]): number | { problem: string } => {
    if (kv.after || kv.before) {
      const ref = block(kv.after ?? kv.before)
      if (!ref) return { problem: missing((kv.after ?? kv.before)!) }
      if (ref === 'many') return { problem: `which “${kv.after ?? kv.before}”?` }
      const i = without.findIndex((x) => x.id === ref.id)
      if (i < 0) return { problem: 'it can’t go next to itself' }
      return kv.after ? i + 1 : i
    }
    if (/^(?:start|first|top|beginning)$/i.test(kv.at ?? '')) return 0
    return without.length
  }

  if (act === 'add') {
    if (kv.step) {
      const b = block(kv.block)
      if (!b || b === 'many') return { problem: kv.block ? missing(kv.block) : `which block of your ${r.name} routine should “${kv.step}” go in?` }
      const title = cap(kv.step.trim()).slice(0, 120)
      const steps = liveSteps(w, b.id)
      if (!w.canArchiveSteps) return { problem: 'run supabase/life.sql first (so a step added by chat can be undone without deleting it)' }
      if (steps.some((s) => s.title.toLowerCase() === title.toLowerCase())) return { problem: `${b.name} already has “${title}”` }
      return { change: { table: 'routine_steps', id: null, title, line: `🔁 ${name} · ${esc(b.name)}: + <b>${esc(title)}</b> <i>(last step)</i>`, patch: { kind: 'add_step', item_id: b.id, title, sort_order: (steps.at(-1)?.sort_order ?? 0) + 1 } } }
    }
    const nm = blockName(kv.block ?? '')
    if (!nm) return { problem: `what should I add to your ${r.name} routine?` }
    if (list.some((b) => b.name.toLowerCase() === nm.toLowerCase())) return { problem: `your ${r.name} routine already has ${nm}` }
    if (!w.canArchiveBlocks) return { problem: 'run supabase/life.sql first (so a block added by chat can be undone without deleting it)' }
    const at = place(list)
    if (typeof at !== 'number') return at
    const placeholder = { id: '__new__', habit_id: r.id, name: nm, sort_order: 0, days_of_week: null }
    const next = [...list.slice(0, at), placeholder, ...list.slice(at)]
    const orders = ordersOf(next)
    const { __new__: order, ...rest } = orders
    return { change: { table: 'habit_items', id: null, title: nm, line: `🔁 ${name} routine: + <b>${esc(nm)}</b> ${esc(whereWords(next, at))}`, patch: { kind: 'add_block', habit_id: r.id, name: nm, sort_order: order, orders: rest } } }
  }

  // move
  const b = block(kv.block)
  if (!b) return { problem: kv.block ? missing(kv.block) : `which block of your ${r.name} routine?` }
  if (b === 'many') return { problem: `which “${kv.block}”?` }
  if (!kv.after && !kv.before && !kv.at) return { problem: `where should ${b.name} go?` }
  const without = list.filter((x) => x.id !== b.id)
  const at = place(without)
  if (typeof at !== 'number') return at
  const next = [...without.slice(0, at), b, ...without.slice(at)]
  if (next.map((x) => x.id).join() === list.map((x) => x.id).join()) return { problem: `${b.name} is already there` }
  return { change: { table: 'habit_items', id: b.id, title: b.name, line: `🔁 ${name}: ${esc(b.name)} → <b>${esc(whereWords(next, at))}</b> <i>(${esc(next.map((x) => x.name).join(' → '))})</i>`, patch: { kind: 'order', habit_id: r.id, orders: ordersOf(next) } } }
}

// ---------------------------------------------------------------------------
// His words → a change (fast path; the brain does the rest)
// ---------------------------------------------------------------------------

const R = "(?:my |the |his )?(.+?)(?:\\s+routine)"
const DAYLIST = '(?:(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*(?:\\s*(?:,|and|&|\\+|\\/)\\s*(?:mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*)*)'
const DAYWORDS = `(?:every ?day|daily|weekdays?|weekends?|${DAYLIST})`

/** "add stretch 10 min to my morning routine" → "routine=morning; do=add; block=stretch 10 min". null if not that shape. */
export function parseRoutine(message: string): string | null {
  const t = message.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '')
  if (!t || t.length > 140 || /\?/.test(t)) return null
  const lead = '^(?:(?:ok(?:ay)?|so|also|btw)[,\\s]+)*(?:(?:can you|could you|please|pls)\\s+)?'
  const v = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, x]) => x).map(([k, x]) => `${k}=${x!.replace(/[;=]/g, " ").trim()}`).join('; ')
  let m: RegExpMatchArray | null
  // a step inside a block: "add floss to teeth in my night routine"
  m = t.match(new RegExp(`${lead}add (.+?) to (?:the )?(.+?)(?: block| step)? in ${R}$`, 'i'))
  if (m) return v({ routine: m[3], do: 'add', step: m[1], block: m[2] })
  m = t.match(new RegExp(`${lead}add (.+?) (after|before) (.+?) (?:in|to|into) ${R}$`, 'i'))
  if (m) return v({ routine: m[4], do: 'add', block: m[1], [m[2].toLowerCase()]: m[3] })
  m = t.match(new RegExp(`${lead}add (.+?) (?:to|into|in) (?:the (start|beginning|end) of )?${R}(?: at the (start|beginning|end|top))?$`, 'i'))
  if (m) return v({ routine: m[3], do: 'add', block: m[1], at: /start|beginning|top/i.test(m[2] ?? m[4] ?? '') ? 'start' : undefined })
  m = t.match(new RegExp(`${lead}(?:remove|take|drop|delete|scrap|get rid of) (.+?) (?:from|out of|off) ${R}$`, 'i'))
  if (m) return v({ routine: m[2], do: 'remove', block: m[1] })
  m = t.match(new RegExp(`${lead}rename (.+?) to (.+?) in ${R}$`, 'i'))
  if (m) return v({ routine: m[3], do: 'rename', block: m[1], name: m[2] })
  m = t.match(new RegExp(`${lead}(?:rename|call) ${R} (?:to |as )?(.+)$`, 'i'))
  if (m) return v({ routine: m[1], do: 'rename', name: m[2] })
  m = t.match(new RegExp(`${lead}(?:move |put )?(.+?) to the (start|beginning|top|end) of ${R}$`, 'i'))
  if (m) return v({ routine: m[3], do: 'move', block: m[1], at: /end/i.test(m[2]) ? 'end' : 'start' })
  m = t.match(new RegExp(`${lead}(?:move |put |do )?(.+?) (after|before) (.+?)(?: in ${R})?$`, 'i'))
  // "cold shower after breakfast": short block names only (anything longer is a sentence for the brain)
  const short = (s: string) => s.trim().split(/\s+/).length <= 3
  if (m && !/\d/.test(t) && (m[4] || (short(m[1]) && short(m[3])))) return v({ ...(m[4] ? { routine: m[4] } : {}), do: 'move', block: m[1], [m[2].toLowerCase()]: m[3] })
  // days: "night routine every day", "morning routine on weekdays only", "only do my morning routine on weekdays"
  m = t.match(new RegExp(`${lead}(?:only )?(?:do )?${R}(?: is| should be| on| runs?)?(?: only)?(?: on)? (${DAYWORDS})(?: only)?$`, 'i'))
  if (m) return v({ routine: m[1], do: 'days', days: m[2] })
  return null
}

/** A block's days when he names only the block ("shave on mon, wed and fri only"): the value, or null. */
export function parseBlockDays(message: string): { block: string; days: string } | null {
  const t = message.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '')
  const m = t.match(new RegExp(`^(?:only )?(?:do )?(?:my |the )?([a-z][a-z ]{1,30}?) (?:only )?(?:on )?(${DAYWORDS})(?: only)?$`, 'i'))
  if (!m || /\b(?:routine|every week|weekly)\b/i.test(t)) return null
  // "cancel football on Wednesday", "no football on Wed", "skip …", "not going to …", "football is off on Wed": a
  // cancelled session, not a block's days
  if (/\b(?:cancel\w*|no|skip\w*|not|off|can'?t|cannot|won'?t|isn'?t|scrap|drop|move\w*|push\w*|is|was|are)\b/i.test(t)) return null
  if (!/\bonly\b|\bon\b/i.test(t) && !/every ?day|daily/i.test(m[2])) return null
  return { block: m[1], days: m[2] }
}

