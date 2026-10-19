// His ACT messages in normal words, read without the AI (the bot's fast paths, plans/contracts.md §2): practice and real
// scores ("ACT practice: E33 M35 R34", "act 33 35 34", "english section 30"), the retake date ("ACT retake is 12 Dec"),
// a miss with its rule ("ACT miss: english Q12 comma splice — joined two sentences"), redos, book progress ("finished
// Meltzer chapter 3", "College Panda ch 4 test 12/15"), book edits ("Meltzer has 18 chapters") and the set-up.
// STRICT: anything it isn't sure about returns null, and the brain reads the message instead. Pure: no database, no clock.
import { addDays } from '../time'
import { parseMistakeKind } from '../tracker/rules'
import type { MistakeKind } from '../tracker/types'
import type { ActSection } from './types'

const clean = (s: string) => s.toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim()
const hasAct = (t: string) => /(^|[^a-z])act([^a-z]|$)/.test(t)

export function sectionWord(w: string): ActSection | null {
  const v = w.toLowerCase().replace(/[^a-z]/g, '')
  if (/^(e|eng|engl|english)$/.test(v)) return 'english'
  if (/^(m|mat|math|maths|mathematics)$/.test(v)) return 'maths'
  if (/^(r|rd|read|reading)$/.test(v)) return 'reading'
  if (/^(s|sci|science)$/.test(v)) return 'science'
  return null
}

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export type ParsedScore = { kind: 'real' | 'practice' | 'section'; english: number | null; maths: number | null; reading: number | null; science: number | null; yesterday: boolean }

const SCORE_TOKEN = /(^|[^a-z0-9])(english|engl|eng|e|mathematics|maths|math|m|reading|read|r|science|sci|s)\s*[:=\-]?\s*(\d{1,2})(?:\s*\/\s*36)?(?![0-9])/g
const FILLER = new Set(['act', 'acts', 'test', 'tests', 'full', 'timed', 'my', 'score', 'scores', 'scored', 'result', 'results', 'got', 'get', 'today', 'yesterday',
  'the', 'a', 'an', 'i', 'on', 'in', 'was', 'is', 'of', 'and', 'just', 'did', 'done', 'new', 'latest', 'last', 'section', 'sections', 'paper', 'mock', 'mocks',
  'real', 'actual', 'official', 'composite', 'comp', 'total', 'overall', 'for', 'from', 'it', 'its', "it's", 'with', 'this', 'morning', 'evening', 'tonight'])
const isPractice = (w: string) => /^pra[a-z]{0,7}$/.test(w) || /^prc[a-z]{0,6}$/.test(w)
const REAL = /\b(real|actual|official)\b/

const inRange = (n: number) => Number.isInteger(n) && n >= 1 && n <= 36

/** "ACT practice: E33 M35 R34", "practice test E33 M35 R34 S32", "act 33 35 34", "english section 30", "real ACT: E35 M36 R35 S34". */
export function parseScore(message: string): ParsedScore | null {
  // "english section 30", "timed maths section: 31" → "english 30"
  const t = clean(message).replace(/[!?.]+$/, '').replace(/\b(english|maths?|reading|science)\s+(?:timed\s+)?section\s*[:=\-]?\s*(\d{1,2})(?:\s*\/\s*36)?\b/g, '$1 $2 section')
  if (!t || t.length > 160) return null
  const vals: Record<ActSection, number | null> = { english: null, maths: null, reading: null, science: null }
  let found = 0
  let rest = t.replace(SCORE_TOKEN, (m, pre: string, word: string, num: string) => {
    const s = sectionWord(word)
    const n = Number(num)
    if (!s || vals[s] != null || !inRange(n)) { found = -99; return m }
    vals[s] = n; found++
    return `${pre} `
  })
  if (found < 0) return null
  const words = rest.replace(/[():,;=\-–—/]+/g, ' ').split(' ').filter(Boolean)
  const nums = words.filter((w) => /^\d+$/.test(w)).map(Number)
  const other = words.filter((w) => !/^\d+$/.test(w) && !FILLER.has(w) && !isPractice(w))
  if (other.length) return null
  const yesterday = /\byesterday\b/.test(t)
  const real = REAL.test(t)

  if (found === 0) {
    // bare numbers: "act 33 35 34 (32)" = English, Maths, Reading (, Science), the ACT's order
    if (!hasAct(t) || nums.length < 3 || nums.length > 4 || !nums.every(inRange)) return null
    ;[vals.english, vals.maths, vals.reading, vals.science] = [nums[0], nums[1], nums[2], nums[3] ?? null]
    return { kind: real ? 'real' : 'practice', ...vals, yesterday }
  }
  // one leftover number is allowed only as the composite he worked out ("ACT practice 34: E33 M35 R34")
  const core = [vals.english, vals.maths, vals.reading].filter((v) => v != null).length
  if (nums.length > 1 || (nums.length === 1 && (core < 3 || !inRange(nums[0])))) return null
  // something must say it's the ACT: the word ACT or "practice". Without it, only "english section 30" (a section
  // word + "section") or all three of English, Maths and Reading ("E33 M35 R34") — "maths 23 english 30 on my mocks",
  // "s3 e4", "test: e 20 m 21" are not ACT scores
  if (!hasAct(t) && !words.some(isPractice)) {
    const section = found === 1 && /\bsection\b/.test(t) && /\b(english|maths?|reading|science)\b/.test(t)
    if (!section && core < 3) return null
  }
  const kind = real ? 'real' : found === 1 ? 'section' : 'practice'
  return { kind, ...vals, yesterday }
}

// ---------------------------------------------------------------------------
// Dates ("12 Dec", "12th of December 2026", "Dec 12", "12/12")
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const DAY_RE = '(?:(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*,?\\s+)?'
const DATE_RES: RegExp[] = [
  new RegExp(`${DAY_RE}(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\.?(?:,?\\s+(\\d{4}))?(?![a-z])`),
  new RegExp(`${DAY_RE}${MONTH_RE}\\.?\\s+(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![a-z0-9])`),
  /(?<![0-9/])(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?![0-9/])/,
]

const pad = (n: number) => String(n).padStart(2, '0')
const valid = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

/** The first date in the words, and the words it came from. No year: the next one from today (this year or next). */
export function parseDate(message: string, today: string): { date: string; words: string } | null {
  const t = clean(message)
  for (const [i, re] of DATE_RES.entries()) {
    const m = t.match(re)
    if (!m) continue
    let d: number, mo: number, y: number | null
    if (i === 0) { d = Number(m[1]); mo = MONTHS.indexOf(m[2].slice(0, 3)) + 1; y = m[3] ? Number(m[3]) : null }
    else if (i === 1) { mo = MONTHS.indexOf(m[1].slice(0, 3)) + 1; d = Number(m[2]); y = m[3] ? Number(m[3]) : null }
    else { d = Number(m[1]); mo = Number(m[2]); y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null }
    if (mo < 1 || mo > 12) return null
    const thisYear = Number(today.slice(0, 4))
    let year = y ?? thisYear
    if (!valid(year, mo, d)) return null
    let iso = `${year}-${pad(mo)}-${pad(d)}`
    if (y == null && iso < today) { year += 1; if (!valid(year, mo, d)) return null; iso = `${year}-${pad(mo)}-${pad(d)}` }
    return { date: iso, words: m[0].trim() }
  }
  if (/\btomorrow\b/.test(t)) return { date: addDays(today, 1), words: 'tomorrow' }
  return null
}

// ---------------------------------------------------------------------------
// The retake date
// ---------------------------------------------------------------------------

export type ParsedRetake = { kind: 'set'; date: string; words: string } | { kind: 'clear' } | { kind: 'ask' } | { kind: 'when' }

const RETAKE_WORDS = /\b(retake|retaking|re-?take|resit|re-?sit|resitting|sitting|again|booked|book|signed up|registered|test date|exam date|date)\b/

/** "ACT retake is 12 Dec" → set · "I'm retaking the ACT" → ask for the date · "no ACT retake" → clear · "when's my ACT?" → when. */
export function parseRetake(message: string, today: string): ParsedRetake | null {
  const t = clean(message).replace(/[!.]+$/, '')
  if (!hasAct(t) || t.length > 140) return null
  if (/^(?:when(?:'s| is)|what(?:'s| is) the date of)\s+(?:my |the )?act(?: retake| test)?\??$/.test(t)) return { kind: 'when' }
  if (/\b(no|not|cancel(?:led)?|scrap(?:ped)?|drop(?:ped)?|clear|off|isn'?t|won'?t|never mind)\b/.test(t) && /\b(retake|retaking|resit|again|date|act test)\b/.test(t)) {
    if (/\b(moved|move|now|instead|changed?)\b/.test(t)) return null   // "not 12 Dec, it's 13 Feb now": the brain reads it
    return /^(?:(?:there'?s |i have |i'?ve got )?no act retake(?: date)?(?: any ?more)?|(?:i'?m )?not (?:retaking|doing|sitting|resitting) the act(?: again)?(?: any ?more| after all)?|(?:the |my )?act retake(?: is)? (?:cancelled|off|scrapped|dropped)|cancel (?:the |my )?act retake|clear (?:the |my )?act(?: retake)? date|no (?:more )?act retake)$/.test(t) ? { kind: 'clear' } : null
  }
  const d = parseDate(t, today)
  if (d) {
    // the date must be about the ACT: "act/retake … <date>" with nothing else going on
    if (!RETAKE_WORDS.test(t) && !/\bact (?:is|on|test(?: is)?)\b/.test(t)) return null
    const rest = t.replace(d.words, ' ').replace(/'/g, '').replace(/[,:;()–—-]+/g, ' ')
      .replace(/\b(my|the|act|test|retake|retaking|re-?take|resit|re-?sit|resitting|is|its|on|for|at|now|moved|move|to|changed|change|date|exam|booked|book|im|i|am|have|got|sitting|doing|again|signed|up|registered|new|real|official|next|one|an|a|in|will|be|going)\b/g, ' ').trim()
    return rest ? null : { kind: 'set', date: d.date, words: d.words }
  }
  if (/^(?:(?:so |ok |okay )?i'?m |i am |i will be |i'?ll be |i'?m going to be |going to be )?(?:retaking|resitting|re-?sitting|doing|sitting|taking) the act(?: again| test again)?(?: soon)?$|^(?:i )?(?:booked|signed up for|registered for) (?:an |the |my )?act(?: retake| again| test)?$|^(?:my )?act retake\??$|^(?:i )?(?:want|need|plan) to (?:retake|resit) the act$/.test(t)) return { kind: 'ask' }
  return null
}

/** A bare date answer ("12 Dec", "it's the 12th of December", "on Dec 12"), after the bot asked when the retake is. */
export function parseBareDate(message: string, today: string): { date: string; words: string } | null {
  const t = clean(message).replace(/[!.]+$/, '')
  const d = parseDate(t, today)
  if (!d) return null
  const rest = t.replace(d.words, ' ').replace(/\b(it'?s|its|it is|on|the|that'?s|i think|probably|saturday|sat)\b/g, ' ').replace(/[,:;()–—-]+/g, ' ').trim()
  return rest ? null : d
}

// ---------------------------------------------------------------------------
// Misses and redos
// ---------------------------------------------------------------------------

export type ParsedMiss = { section: ActSection; question: string | null; rule: string; what: string; kind: MistakeKind | null }

/** "ACT miss: english Q12 comma splice — joined two sentences with a comma – careless" */
export function parseMiss(message: string): ParsedMiss | null {
  const raw = message.replace(/\s+/g, ' ').trim()
  if (raw.length > 400) return null
  const head = raw.match(/^(?:i\s+)?(?:(?:act\s+(?:miss|mistake|error|wrong)|(?:missed|got wrong|mistake on|wrong on)\s+(?:an?\s+|the\s+|my\s+)?act)|act\s+(english|maths?|reading|science)\s+(?:miss|mistake|error|wrong))\b\s*[:\-–—]?\s*/i)
  if (!head) return null
  let rest = raw.slice(head[0].length)
  let section = head[1] ? sectionWord(head[1]) : null
  if (!section) {
    const s = rest.match(/^(english|eng|e|maths|math|m|reading|read|r|science|sci|s)\b\s*[:,\-–—]?\s*/i)
    if (!s) return null
    section = sectionWord(s[1])
    rest = rest.slice(s[0].length)
  }
  if (!section) return null
  let question: string | null = null
  const q = rest.match(/^(?:q|question|qn|no\.?)\s*(\d{1,2}[a-z]?)\b\s*[:,\-–—]?\s*/i)
  if (q) { question = `Q${q[1].toUpperCase()}`; rest = rest.slice(q[0].length) }
  rest = rest.replace(/^(?:rule\s*[:=]?\s*)/i, '').trim()
  if (!rest) return null
  const parts = rest.split(/\s+[—–-]\s+|\s*;\s*|:\s+/).map((x) => x.trim()).filter(Boolean)
  let kind: MistakeKind | null = null
  if (parts.length > 1) {
    const last = parts.at(-1)!
    const k = last.split(' ').length <= 2 ? parseMistakeKind(last) : null
    if (k) { kind = k; parts.pop() }
  }
  const rule = parts[0].replace(/^rule\s*[:=]?\s*/i, '').slice(0, 300)
  const what = parts.slice(1).join(' — ').replace(/^(?:what went wrong|i)\s*[:=]?\s*/i, '').slice(0, 500)
  if (!rule) return null
  return { section, question, rule, what, kind }
}

/** "redid ACT Q12", "redid ACT english Q12", "redid my ACT misses", "redid the comma splice miss" (needs ACT). */
export function parseRedo(message: string): { section: ActSection | null; question: string | null; all: boolean } | null {
  const t = clean(message).replace(/[!.]+$/, '')
  if (!hasAct(t)) return null
  const m = t.match(/^(?:i\s+)?(?:redid|redone|re-?did|did the redos? (?:of|for)|done the redos? (?:of|for))\s+(?:my\s+|the\s+)?act\s+(?:(english|maths?|reading|science)\s+)?(?:(?:q|question)\s*(\d{1,2}[a-z]?)|(misses|mistakes|redos?|due misses|due ones|ones due))$/)
  if (!m) return /^(?:i\s+)?did (?:my |the )?act redos?$/.test(t) ? { section: null, question: null, all: true } : null
  return { section: m[1] ? sectionWord(m[1]) : null, question: m[2] ? `Q${m[2].toUpperCase()}` : null, all: !m[2] }
}

// ---------------------------------------------------------------------------
// The books
// ---------------------------------------------------------------------------

export type BookKey = 'english' | 'reading' | 'maths_gaps' | 'maths_hard' | 'reading_extra' | 'flashcards'
export type ParsedBook =
  | { do: 'done' | 'skip'; book: BookKey; item: { kind: 'chapter' | 'passage'; n: number }; score: number | null; outOf: number | null }
  | { do: 'score'; book: BookKey; item: { kind: 'chapter' | 'passage'; n: number }; score: number | null; outOf: number | null; full: boolean }
  | { do: 'count'; book: BookKey; kind: 'chapter' | 'passage'; count: number }
  | { do: 'rename'; book: BookKey; item: { kind: 'chapter' | 'passage'; n: number }; title: string }
  | { do: 'start' | 'stop'; book: BookKey }

const BOOK_RES: [RegExp, BookKey][] = [
  [/\b(?:meltzer'?s? (?:act )?reading(?: guide| book)?|(?:the )?(?:complete guide to )?act reading(?: guide| book)?(?: \(?3rd(?: ed(?:ition)?)?\)?)?|(?:the )?reading guide)\b/, 'reading'],
  [/\b(?:(?:the )?critical reader(?: \(?5th(?: ed(?:ition)?)?\)?)?)\b/, 'reading_extra'],
  [/\b(?:advanced act maths?|advanced maths?)\b/, 'maths_hard'],
  [/\b(?:(?:the )?college ?panda(?:'s)?(?: act maths?)?(?: \+? ?workbook)?|cp)\b/, 'maths_gaps'],
  [/\b(?:meltzer(?:'s)?(?: act english)?(?: book| guide)?|(?:the )?(?:complete guide to )?act english(?: guide| book)?|(?:the )?english guide)\b/, 'english'],
  [/\b(?:(?:my )?(?:act )?(?:grammar )?flash ?cards|anki(?: deck)?)\b/, 'flashcards'],
]

export function findBook(t: string): { book: BookKey; words: string } | null {
  for (const [re, book] of BOOK_RES) { const m = t.match(re); if (m) return { book, words: m[0] } }
  return null
}

const ITEM_RE = /\b(?:(?:chapter|chap|ch)\.?\s*(\d{1,3})|(?:timed\s+)?(?:passage\s+set|passage|set)\s*(\d{1,3}))\b/
const BOOK_FILLER = /\b(i|i've|ive|just|the|my|of|its|it's|and|with|today|act|chapter test|test|tests|exercises?|questions?|qs|workbook|all|in|on|for|now|got|scored|marks?|out of|book|guide|section)\b/g

/** "finished Meltzer chapter 3", "done meltzer ch 3", "College Panda ch 4 test 12/15", "skip college panda ch 6",
 *  "Meltzer has 18 chapters", "rename Meltzer chapter 3 to Commas", "start the Critical Reader". */
export function parseBook(message: string): ParsedBook | null {
  const t = clean(message).replace(/[!.]+$/, '')
  if (t.length > 160) return null
  const b = findBook(t)
  if (!b) return null
  // rename: "rename Meltzer ch 3 to Commas" / "call Meltzer chapter 3 Commas"
  const ren = message.trim().match(/^(?:rename|call)\s+(.+?)\s+(?:ch(?:apter|ap)?\.?\s*(\d{1,3})|(?:timed\s+)?passage(?:\s+set)?\s*(\d{1,3}))\s+(?:to\s+|as\s+)?["“]?(.+?)["”]?\s*$/i)
  if (ren && findBook(clean(ren[1]))?.book === b.book) {
    const title = ren[4].trim()
    if (!title || title.length > 150) return null
    return { do: 'rename', book: b.book, item: { kind: ren[2] ? 'chapter' : 'passage', n: Number(ren[2] ?? ren[3]) }, title }
  }
  // count: "Meltzer has 18 chapters", "the reading guide has 12 passage sets"
  const cnt = t.match(/\b(?:has|have|got|is)\s+(\d{1,3})\s+(chapters|passage sets|passages|sets)\b/)
  if (cnt) {
    const rest = t.replace(b.words, ' ').replace(cnt[0], ' ').replace(/\b(the|actually|really|only|in total|total|it|book)\b/g, ' ').replace(/[,:;()]/g, ' ').trim()
    const n = Number(cnt[1])
    return rest || n < 1 || n > 200 ? null : { do: 'count', book: b.book, kind: /chapter/.test(cnt[2]) ? 'chapter' : 'passage', count: n }
  }
  // start / stop an optional book (the Critical Reader)
  const ss = t.match(/^(?:let'?s\s+|please\s+)?(start|use|begin|switch on|turn on|add|stop|drop|switch off|turn off|pause)\s+(?:using\s+)?(?:the\s+)?(.+?)(?:\s+now)?$/)
  if (ss && b.book === 'reading_extra' && findBook(ss[2])?.book === 'reading_extra' && !ITEM_RE.test(t)) {
    return { do: /^(stop|drop|switch off|turn off|pause)$/.test(ss[1]) ? 'stop' : 'start', book: b.book }
  }
  const it = t.match(ITEM_RE)
  if (!it) return null
  const item = { kind: it[1] ? 'chapter' as const : 'passage' as const, n: Number(it[1] ?? it[2]) }
  if (item.n < 1 || item.n > 300) return null
  const sc = t.match(/\b(\d{1,3})\s*(?:\/|out of)\s*(\d{1,3})\b/)
  const score = sc ? Number(sc[1]) : null, outOf = sc ? Number(sc[2]) : null
  if (sc && (outOf! < 1 || score! > outOf!)) return null
  const full = /\bfull marks\b/.test(t)
  const skip = /\bskip(?:ped|ping)?\b/.test(t)
  const done = /\b(finished|finish|done|did|completed|complete|read|through)\b/.test(t)
  const verbs = /\b(finished|finish|done|did|completed|complete|read|through|skip(?:ped|ping)?|full marks|got|scored)\b/g
  const rest = t.replace(b.words, ' ').replace(it[0], ' ').replace(sc?.[0] ?? '\u0000', ' ').replace(verbs, ' ').replace(BOOK_FILLER, ' ').replace(/[,:;()\-–—=+]/g, ' ').trim()
  if (rest) return null
  if (skip) return { do: 'skip', book: b.book, item, score, outOf }
  if (sc || full) return { do: 'score', book: b.book, item, score, outOf, full: full || (score != null && score === outOf) }
  if (done) return { do: 'done', book: b.book, item, score: null, outOf: null }
  return null
}

// ---------------------------------------------------------------------------
// Set-up and "how's my ACT?"
// ---------------------------------------------------------------------------

export const isSetup = (message: string) =>
  /^(?:please\s+|can you\s+|could you\s+|ok\s+|okay\s+)?(?:set\s*-?up|setup|start|add|make)\s+(?:my\s+|the\s+)?act(?:\s+(?:books?|plan|prep(?:aration)?|system|stuff|programmes?|tracking))?(?:\s+(?:please|for me|now))?\s*[.!?]*$/i.test(message.trim())
  || /^act\s+set\s*-?up\s*[.!?]*$/i.test(message.trim())

export const isActQuestion = (message: string) =>
  /^(?:act|act\?|how(?:'?s| is| are) (?:my )?act(?: going| prep(?:aration)?| scores?)?|act (?:status|progress|plan|summary|next|update|scores?)|what(?:'?s| is) (?:my |the )?(?:next )?act(?: plan| today| next)?|what act (?:should i do|today|next|now)(?: today| now)?|(?:show )?(?:my )?act scores?|what(?:'?s| is) next for (?:the )?act)\s*\??$/i.test(clean(message))
