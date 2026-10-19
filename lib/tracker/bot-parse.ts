// The study tracker bot's word-reading (plans/contracts.md §3.7): colour words (emoji, words, small typos), topic words
// (codes first, then names like lib/maths.ts findTopics, aliases such as "logs", then small typos), scores ("8/10",
// "38 out of 45", "80%"), end dates for temporary rules ("this week", "until 25 Oct", "for 2 weeks", "until I say") and
// key=value lists. Strict: anything unsure is null, so the message goes to the brain instead. Pure: no database, no clock.
import { addDays, daysBetween, isoDow, weekStartISO } from '../time'
import type { Colour, MistakeKind, TrackerTopic } from './types'
import { parseMistakeKind, taughtState } from './rules'

/** Lower-case words only ("Proof & maths" → "proof and maths"). */
export const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Levenshtein distance, stopping early once it's over `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** How many typos a word of this length may have and still count (short words: none). */
export const typoAllowance = (len: number) => (len >= 7 ? 2 : len >= 4 ? 1 : 0)

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const COLOUR_WORDS: [string, Colour][] = [
  ['green', 'exam_ready'], ['yellow', 'understand'], ['amber', 'understand'], ['red', 'not_secure'], ['white', 'not_started'], ['grey', 'not_started'], ['gray', 'not_started'],
]
const COLOUR_PHRASES: [RegExp, Colour][] = [
  [/^🟢$/u, 'exam_ready'], [/^🟡$/u, 'understand'], [/^🔴$/u, 'not_secure'], [/^⚪\uFE0F?$/u, 'not_started'],
  [/^exam ready$/, 'exam_ready'], [/^not secure$/, 'not_secure'], [/^not started$/, 'not_started'], [/^understand(?: but not secure)?$/, 'understand'],
]

/** "🟢" / "green" / "grean" / "yelow" / "exam ready" → a colour; null for anything else. */
export function colourOf(word: string): Colour | null {
  const w = word.trim().toLowerCase().replace(/[.!]+$/, '')
  for (const [re, c] of COLOUR_PHRASES) if (re.test(w)) return c
  if (!/^[a-z]+$/.test(w)) return null
  for (const [name, c] of COLOUR_WORDS) if (w === name) return c
  // a small typo on the longer words ("grean", "yelow"); "red" must be exact
  for (const [name, c] of COLOUR_WORDS) if (name.length >= 5 && w.length >= 4 && editDistance(w, name, 2) <= (name.length >= 6 ? 2 : 1)) return c
  return null
}

/** The colour at the end of a message ("matrices 🟢", "PC1-01 green now") and what comes before it. */
export function splitColour(message: string): { rest: string; colour: Colour } | null {
  const t = message.trim().replace(/[.!]+$/, '').replace(/\s+(?:now|please|pls|thanks)$/i, '')
  const m = t.match(/^(.*?)[\s:=,–—-]*(?:\s(?:is|to|as|at|now|→|->|=)\s*)*((?:🟢|🟡|🔴|⚪\uFE0F?)|exam ready|not secure|not started|[A-Za-z]+)$/u)
  if (!m) return null
  const colour = colourOf(m[2])
  if (!colour) return null
  const rest = m[1].trim().replace(/\s+(?:is|to|as|at|now)$/i, '').replace(/[\s:=,–—-]+$/, '').trim()
  return rest ? { rest, colour } : null
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

/** Short words he uses for topics whose names say it differently. */
const ALIASES: [RegExp, string][] = [
  [/^logs?$/, 'logarithms'], [/^trig$/, 'trigonometric'], [/^diff$/, 'differentiation'], [/^integrat(?:e|ing)$/, 'integration'],
  [/^suvat$/, 'motion with constant acceleration'], [/^hyp(?:othesis)? tests?$/, 'hypothesis testing'], [/^binomial$/, 'binomial expansion'],
  [/^complex$/, 'complex numbers'], [/^des$/, 'differential equations'], [/^stats$/, 'statistics'], [/^mechs$/, 'mechanics'],
  [/^partial fractions$/, 'rational functions and partial fractions'], [/^polar$/, 'polar coordinates'], [/^hyperbolics?$/, 'hyperbolic functions'],
]

/** "PC1-03", "p1.3", "Y1-07" (the tracker's codes). */
export const CODE_RE = /^[a-z]{1,4}\d?[-.]\d{1,2}$/i

const SUBJECT_HINT: [RegExp, (t: TrackerTopic) => boolean][] = [
  [/^(?:further maths|further math|fm)\s+/, (t) => t.subject.toLowerCase() === 'further maths'],
  [/^(?:physics|phys)\s+/, (t) => t.subject.toLowerCase() === 'physics'],
  [/^(?:maths|math)\s+/, (t) => t.subject.toLowerCase() === 'maths' || t.subject.toLowerCase() === 'further maths'],
]

export type TopicMatch = { hit: TrackerTopic } | { options: TrackerTopic[] } | null

/** The topics among `cands` he most likely means: one that's taught / next up, then an exact name; else all of them. */
function narrow(cands: TrackerTopic[], n: string, today: string): TrackerTopic[] {
  if (cands.length <= 1) return cands
  const now = cands.filter((t) => taughtState(t, today) !== 'later')
  const pool = now.length ? now : cands
  if (pool.length === 1) return pool
  const exact = pool.filter((t) => norm(t.name) === n)
  return exact.length === 1 ? exact : pool
}

/** Topics whose names fit his words, best tier first (like lib/maths.ts findTopics). */
function byName(pool: TrackerTopic[], n: string): TrackerTopic[] {
  if (!n) return []
  const starts = pool.filter((t) => norm(t.name).startsWith(n))
  if (starts.length) return starts
  const word = pool.filter((t) => n.length >= 4 && norm(t.name).split(' ').some((x) => x.startsWith(n)))
  if (word.length) return word
  if (n.length >= 4) {
    const inside = pool.filter((t) => norm(t.name).includes(n))
    if (inside.length) return inside
  }
  return []
}

/** His words for a topic → the topic (or the options when it could be several). Strict: null when nothing fits. */
export function findTopic(pool: TrackerTopic[], said: string, today: string): TopicMatch {
  let s = said.trim().replace(/^(?:the|my|on|for|in)\s+/i, '').replace(/\s+(?:topic|chapter)$/i, '').trim()
  if (!s) return null
  if (CODE_RE.test(s)) {
    const t = pool.find((x) => x.code && x.code.toUpperCase() === s.toUpperCase())
    return t ? { hit: t } : null
  }
  let list = pool
  let n = norm(s)
  for (const [re, keep] of SUBJECT_HINT) {
    const m = n.match(re)
    if (m && n.length > m[0].length) { const only = pool.filter(keep); if (only.length) { list = only; n = n.slice(m[0].length) } break }
  }
  if (n.length < 3) return null
  for (const [re, to] of ALIASES) if (re.test(n)) { n = to; break }
  let cands = byName(list, n)
  // plurals ("vectors" → "Vector …"), then small typos ("matrics", "diferentiation")
  if (!cands.length && /s$/.test(n)) cands = byName(list, n.replace(/(?:es|s)$/, ''))
  if (!cands.length) cands = fuzzy(list, n)
  if (!cands.length) return null
  const best = narrow(cands, n, today)
  return best.length === 1 ? { hit: best[0] } : { options: best.slice(0, 4) }
}

/** Topics whose name, or one word of it, is within a small typo of his words. */
function fuzzy(pool: TrackerTopic[], n: string): TrackerTopic[] {
  const allow = typoAllowance(n.replace(/ /g, '').length)
  if (!allow) return []
  const whole = pool.filter((t) => editDistance(norm(t.name), n, allow) <= allow)
  if (whole.length) return whole
  if (n.includes(' ')) return []
  return pool.filter((t) => norm(t.name).split(' ').some((w) => w.length >= 4 && editDistance(w, n, allow) <= allow))
}

/** Several topics in one go ("matrices and vectors", "PC1-01, PC1-02"); null if any part doesn't fit exactly one. */
export function findTopics(pool: TrackerTopic[], said: string, today: string): TrackerTopic[] | null {
  const parts = said.split(/\s*(?:,|\+|&|\band\b)\s*/i).map((x) => x.trim()).filter(Boolean)
  if (!parts.length) return null
  const out: TrackerTopic[] = []
  for (const p of parts) {
    const m = findTopic(pool, p, today)
    if (!m || !('hit' in m)) return null
    if (!out.includes(m.hit)) out.push(m.hit)
  }
  return out
}

/** The code tokens in a text that are real topic codes. */
export const codesIn = (pool: TrackerTopic[], text: string): TrackerTopic[] => {
  const seen = new Set<string>()
  const out: TrackerTopic[] = []
  for (const tok of text.match(/\b[A-Za-z]{1,4}\d?[-.]\d{1,2}\b/g) ?? []) {
    const t = pool.find((x) => x.code && x.code.toUpperCase() === tok.toUpperCase())
    if (t && !seen.has(t.id)) { seen.add(t.id); out.push(t) }
  }
  return out
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export type Score = { score: number; outOf: number; pct: number; text: string }

/** "8/10", "8 / 10", "38 out of 45", "80%" → the score (null if none, or impossible). */
export function findScore(text: string): Score | null {
  const m = text.match(/(\d+(?:\.\d)?)\s*(?:\/|out of|outta)\s*(\d+(?:\.\d)?)/i)
  if (m) {
    const score = Number(m[1]), outOf = Number(m[2])
    if (!(outOf > 0) || score > outOf || outOf > 1000) return null
    return { score, outOf, pct: Math.round((score / outOf) * 100), text: m[0] }
  }
  const p = text.match(/(\d{1,3})\s*%/)
  if (p) {
    const pct = Number(p[1])
    return pct <= 100 ? { score: pct, outOf: 100, pct, text: p[0] } : null
  }
  return null
}

// ---------------------------------------------------------------------------
// Dates and end dates
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const valid = (s: string) => { const d = new Date(`${s}T12:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s }

/** "25 Oct", "25th October", "Oct 25", "25/10", "Sunday", "next Fri", "tomorrow", "the 25th" → a date on or after today. */
export function dateFromWords(words: string, today: string): string | null {
  const w = words.trim().toLowerCase().replace(/[.,]$/, '').replace(/^(?:on|the)\s+/, '').trim()
  if (!w) return null
  if (w === 'today' || w === 'tonight') return today
  if (w === 'tomorrow' || w === 'tmrw' || w === 'tmr') return addDays(today, 1)
  const y = Number(today.slice(0, 4))
  const later = (m: number, d: number) => {
    let s = iso(y, m, d)
    if (!valid(s)) return null
    if (s < today) s = iso(y + 1, m, d)
    return valid(s) ? s : null
  }
  let m = w.match(/^(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+([a-z]{3,9})$/)
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3)); return mo >= 0 ? later(mo + 1, Number(m[1])) : null }
  m = w.match(/^([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?$/)
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3)); return mo >= 0 ? later(mo + 1, Number(m[2])) : null }
  m = w.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) {
    if (m[3]) { const yy = Number(m[3].length === 2 ? `20${m[3]}` : m[3]); const s = iso(yy, Number(m[2]), Number(m[1])); return valid(s) && s >= today ? s : null }
    return later(Number(m[2]), Number(m[1]))
  }
  m = w.match(/^(\d{1,2})(?:st|nd|rd|th)$/)
  if (m) {
    const d = Number(m[1]), mo = Number(today.slice(5, 7))
    const s = iso(y, mo, d)
    if (valid(s) && s >= today) return s
    const nm = mo === 12 ? iso(y + 1, 1, d) : iso(y, mo + 1, d)
    return valid(nm) ? nm : null
  }
  m = w.match(/^(next |this )?([a-z]{3,9})$/)
  if (m) {
    const dow = DAY_NAMES[m[2]]
    if (!dow) return null
    let d = today
    while (isoDow(d) !== dow) d = addDays(d, 1)
    if (m[1] === 'next ' && weekStartISO(d) === weekStartISO(today)) d = addDays(d, 7)
    return d
  }
  return null
}

const DAY_NAMES: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
}

export type EndWords = { ends: string; starts?: string; words: string; untilISay?: boolean }

/** The 8 weeks "until I say" stands for (he can end it any time). */
export const UNTIL_I_SAY_DAYS = 56

/** When a temporary rule ends, from his words: "this week" = Sunday, "until 25 Oct", "for 2 weeks", "until I say" = 8 weeks. */
export function endFromWords(text: string, today: string): EndWords | null {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
  if (!t) return null
  const sunday = addDays(weekStartISO(today), 6)
  if (/^(?:for |all |during )?(?:the rest of )?this week$|^(?:until|till|til|to) (?:the )?end of (?:the |this )?week$|^(?:until|till|til) sunday$|^for the week$/.test(t)) {
    return { ends: sunday, words: t }
  }
  if (/^(?:for |all |during )?next week$/.test(t)) return { starts: addDays(sunday, 1), ends: addDays(sunday, 7), words: t }
  if (/^(?:for )?today$|^(?:for )?tonight$|^just today$/.test(t)) return { ends: today, words: t }
  if (/^(?:for )?tomorrow$/.test(t)) return { starts: addDays(today, 1), ends: addDays(today, 1), words: t }
  if (/^(?:until|till|til|unless) i say(?: otherwise| so)?$|^until further notice$|^for now$|^indefinitely$|^until i tell you$/.test(t)) {
    return { ends: addDays(today, UNTIL_I_SAY_DAYS - 1), words: t, untilISay: true }
  }
  const NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2, 'a couple of': 2 }
  let m = t.match(/^for (?:the next )?(\d+|a couple of|a|an|one|two|three|four|five|six|seven|eight) (day|days|week|weeks|fortnight)$/)
  if (m) {
    const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM[m[1]]
    const days = m[2].startsWith('fortnight') ? 14 * n : m[2].startsWith('week') ? 7 * n : n
    if (!days || days > 120) return null
    return { ends: addDays(today, days - 1), words: t }
  }
  m = t.match(/^(?:until|till|til|up to|to|through|thru|by)(?: the end of)? (.+)$/)
  if (m) {
    const d = m[1] === 'the end of the month' || m[1] === 'end of the month' || m[1] === 'month' ? null : dateFromWords(m[1], today)
    if (d) return { ends: d, words: t }
  }
  return null
}

// ---------------------------------------------------------------------------
// key=value lists (the ops' value format)
// ---------------------------------------------------------------------------

/** "what=bicen; score=8; out_of=10" → { what: 'bicen', score: '8', out_of: '10' } (keys lower-case; empty values dropped). */
export function kv(value: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (value ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim().toLowerCase().replace(/[\s-]+/g, '_')
    const v = part.slice(i + 1).trim()
    if (k && v) out[k] = v
  }
  return out
}

/** The other way: { what: 'bicen', score: 8 } → "what=bicen; score=8" (";" in a value becomes ","). */
export const kvText = (o: Record<string, string | number | null | undefined | boolean>) =>
  Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== false)
    .map(([k, v]) => `${k}=${String(v === true ? 'yes' : v).replace(/;/g, ',')}`).join('; ')

/** "Q3b", "q 3b", "Q12(a)(ii)", "question 4" → "Q3b" (null if none). */
export function questionOf(text: string): string | null {
  const m = text.match(/\b(?:q(?:uestion)?\s?)(\d{1,2}(?:\s?[a-z]\b|\([a-z]\))?(?:\s?\((?:i|ii|iii|iv|v|vi)\)|\s(?:i|ii|iii|iv|v|vi)\b)?)/i)
  return m ? `Q${m[1].replace(/\s+/g, '').toLowerCase()}` : null
}

/** "– knowledge", "(method)", ", careless" at the end → the mistake type and the text before it. */
export function trailingKind(text: string): { rest: string; kind: MistakeKind | null } {
  // the last separator whose words run to the end ("…origin – knowledge", "…sign, careless", "…(method)")
  const m = /(?:\s+[–—-]+\s*|\s*[(,;:]\s*|\s+type:?\s*)([a-z][a-z ]{2,30}?)\)?\s*(?:mistake|error|slip)?\s*$/i.exec(text)
  if (m) {
    const kind = parseMistakeKind(m[1])
    const rest = text.slice(0, m.index).trim()
    if (kind && rest) return { rest, kind }
  }
  return { rest: text.trim(), kind: null }
}

/** Days from today to a date (negative = past). */
export const daysTo = (today: string, date: string) => daysBetween(today, date)
