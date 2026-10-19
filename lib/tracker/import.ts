// The spreadsheet import (plans/contracts.md §3.3): the 6 tabs of his study tracker (read by lib/tracker/xlsx.ts) →
// a parsed tracker → an ImportPlan against what the app already has. Nothing is written here: the plan is shown as a
// preview (counts + clashes) and lib/tracker/data.ts applyImport() saves it only after he confirms.
// Rules: match a topic by code → book + chapter → name; keep his colour, step, mistakes and notes (a non-⚪ app colour
// wins; both set and different = a clash, listed); duplicates are archived (never deleted) and their mistakes move to
// the kept topic; tests are created or updated by title/date; mistakes and attempts are never added twice. Importing
// the same file again changes nothing. Pure: no database, no clock (today is passed in).
import type { Cell, Sheet, Workbook } from './xlsx'
import type { AttemptWhat, Colour, MistakeKind, ProgrammeItem, TestKind, TrackerLinks, TrackerTopic } from './types'
import { COLOUR_DOT, STEPS } from './types'
import { afterRedo, DEFAULT_REVIEW_DAYS, firstRedo, parseMistakeKind } from './rules'
import { LINK_KEYS, REVIEW_KEYS } from './settings'
import { parseStatus, sectionOf } from '../maths'
import { addDays, dowShort, shortDate } from '../time'

export type SubjectName = 'Maths' | 'Further Maths' | 'Physics'
export const TRACKER_SUBJECTS: SubjectName[] = ['Maths', 'Further Maths', 'Physics']
type Progress = 'done' | 'doing' | 'todo'

// ---------------------------------------------------------------------------
// Cell values → the tracker's values
// ---------------------------------------------------------------------------

const str = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v).replace(/️/g, '').replace(/\s+/g, ' ').trim())
const opt = (v: Cell | undefined, max: number): string | null => { const s = str(v); return s ? s.slice(0, max) : null }

/** ⚪ 🔴 🟡 🟢 (or red / yellow / green / white) → a colour; blank → null. */
export function parseColour(v: Cell | undefined): Colour | null {
  const s = str(v)
  if (!s) return null
  for (const [k, dot] of Object.entries(COLOUR_DOT)) if (s.includes(dot)) return k as Colour
  return parseStatus(s.replace(/[^\p{L} ]/gu, '').trim()) ?? null
}

/** "3 Mixed exercise" / "Mixed exercise" / 3 → 3; blank → null. */
export function parseStep(v: Cell | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 6 ? v : null
  const s = str(v).toLowerCase()
  if (!s) return null
  const n = /^(\d)\b/.exec(s)
  if (n && Number(n[1]) <= 6) return Number(n[1])
  const i = STEPS.findIndex((x) => s.startsWith(x.toLowerCase().replace(/ ≥85%/, '')))
  return i >= 0 ? i : null
}

/** Physics "Taught?": Yes / In class / Not yet. */
export function parseTaught(v: Cell | undefined): TrackerTopic['taught'] {
  const s = str(v).toLowerCase()
  if (!s) return null
  if (/^(yes|y|✅|done|taught)\b/.test(s)) return 'yes'
  if (/in class|being taught|now|current|⏳/.test(s)) return 'in_class'
  if (/^(no|not|❌|later)/.test(s)) return 'not_yet'
  return null
}

/** ✅ ⏳ ❌ (or done / doing / to do) → done / doing / todo; blank → null. */
export function parseProgress(v: Cell | undefined): Progress | null {
  const s = str(v).toLowerCase()
  if (!s) return null
  if (/✅|✔|☑|^(done|yes|y|finished|complete|completed)\b/.test(s)) return 'done'
  if (/⏳|🟡|^(doing|started|in progress|half|part)/.test(s)) return 'doing'
  if (/❌|⬜|^(todo|to do|no|not|n)\b/.test(s)) return 'todo'
  return null
}

/** STEP / programme item status: "Not started" · "In progress" · "Done" · "Skipped". */
export function parseItemStatus(v: Cell | undefined): ProgrammeItem['status'] {
  const s = str(v).toLowerCase()
  if (!s || /^not\b|^to ?do|❌|⬜/.test(s)) return 'todo'
  if (/skip/.test(s)) return 'skipped'
  if (/✅|^(done|finished|complete|completed|yes)\b/.test(s)) return 'done'
  if (/⏳|progress|doing|started|half/.test(s)) return 'doing'
  return 'todo'
}

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const pad = (n: number) => String(n).padStart(2, '0')
const validDate = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
}
/** A date cell: '2026-10-17' (from the reader), 17/10/2026, 17 Oct 26, Sat 17 Oct 2026, or an Excel serial. */
export function parseDate(v: Cell | undefined, today?: string): string | null {
  if (typeof v === 'number') {
    if (v < 30000 || v > 80000) return null
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10)
  }
  const s = str(v).toLowerCase()
  if (!s) return null
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return validDate(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s)              // UK order: day / month / year
  if (m) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1])
  m = /^(?:[a-z]{3,9},?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:\s+(\d{2}|\d{4}))?$/.exec(s)
  if (m) {
    const mon = MON.indexOf(m[2].slice(0, 3)) + 1
    if (!mon) return null
    if (m[3]) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], mon, +m[1])
    if (!today) return null
    // no year: the one that puts it nearest to today
    const y = +today.slice(0, 4)
    const options = [y - 1, y, y + 1].map((yy) => validDate(yy, mon, +m![1])).filter((x): x is string => !!x)
    const dist = (d: string) => Math.abs(Date.parse(d) - Date.parse(today))
    return options.sort((a, b) => dist(a) - dist(b))[0] ?? null
  }
  return null
}

/** Fresh-question %: 80 · "80%" · 0.8 (a % cell) · "8/10" → 80; blank → null. */
export function parsePct(v: Cell | undefined): number | null {
  if (typeof v === 'number') {
    const n = v > 0 && v < 1 ? v * 100 : v
    return n >= 0 && n <= 100 ? Math.round(n) : null
  }
  const s = str(v)
  if (!s) return null
  const f = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s)
  if (f) return Number(f[2]) > 0 && Number(f[1]) <= Number(f[2]) ? Math.round((Number(f[1]) / Number(f[2])) * 100) : null
  const p = /^(\d+(?:\.\d+)?)\s*%?$/.exec(s)
  if (!p) return null
  const n = Number(p[1])
  return n >= 0 && n <= 100 ? Math.round(n) : null
}

/** A score cell: 38 · "38" · "38/45" (then out of comes with it). */
export function parseScore(v: Cell | undefined): { score: number | null; outOf: number | null } {
  if (typeof v === 'number') return { score: v >= 0 ? v : null, outOf: null }
  const s = str(v)
  const f = /^(\d+(?:\.\d+)?)\s*(?:\/|out of)\s*(\d+(?:\.\d+)?)$/i.exec(s)
  if (f) return { score: Number(f[1]), outOf: Number(f[2]) }
  const n = /^(\d+(?:\.\d+)?)$/.exec(s)
  return { score: n ? Number(n[1]) : null, outOf: null }
}

/** "Maths" / "FM" / "Further Maths" / "Physics". */
export function parseSubject(v: Cell | undefined): SubjectName | null {
  const s = str(v).toLowerCase()
  if (!s) return null
  if (/^(fm|f\.m\.|further( maths?| mathematics)?)$/.test(s)) return 'Further Maths'
  if (/^(maths?|mathematics|m)$/.test(s)) return 'Maths'
  if (/^(physics|phys|p)$/.test(s)) return 'Physics'
  return null
}

/** The "What" of a test attempt → its kind. */
export function parseAttemptWhat(v: Cell | undefined): AttemptWhat {
  const s = str(v).toLowerCase()
  if (/diag/.test(s)) return 'diagnostic'
  if (/real|actual|the test\b|sat it/.test(s)) return 'real'
  if (/booklet/.test(s)) return 'booklet'
  if (/past paper|\bpaper\b/.test(s)) return 'paper'
  if (/timed|practice|mock/.test(s)) return 'timed'
  return 'other'
}

/** "Bicen CP1 Linear Transformations Q3b" → the question ("Q3b") and the rest. */
export function splitSource(v: string): { source: string | null; question: string | null } {
  const m = /^(.*?)[\s,–-]*\b(Q\.?\s?\d+[a-z]{0,3}(?:\s?\([ivx]+\))?)\s*$/i.exec(v.trim())
  if (!m) return { source: v.trim().slice(0, 200) || null, question: null }
  return { source: m[1].trim().slice(0, 200) || null, question: m[2].replace(/\s+/g, '').slice(0, 40) }
}

/** STEP items: "solved without help?" and "idea I learnt" share programme_items.result. The bot uses the same shape. */
export const stepResult = (solved: string | null, idea: string | null): string | null => {
  const parts = [solved ? `solved: ${solved}` : '', idea ? `idea: ${idea}` : ''].filter(Boolean)
  return parts.length ? parts.join(' · ').slice(0, 300) : null
}
export function splitStepResult(result: string | null): { solved: string; idea: string } {
  const r = result ?? ''
  const solved = /(?:^|·\s*)solved:\s*([^·]*)/i.exec(r)?.[1]?.trim() ?? ''
  const idea = /(?:^|·\s*)idea:\s*(.*)$/i.exec(r)?.[1]?.trim() ?? ''
  return solved || idea ? { solved, idea } : { solved: '', idea: r }
}

// ---------------------------------------------------------------------------
// Names and book chapters
// ---------------------------------------------------------------------------

/** For matching names: lower case, & = and, no brackets or punctuation. */
export const normName = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** "Y1 red · 5" → Book 1 · 5 ("Book 2" = "Y2 green", "Pure Core 1" = "PC1 blue", "Pure Core 2" = "PC2", FM "Statistics" / "Mechanics"). */
export function bookSection(ref: string | null): { section: string; n: number } | null {
  const m = /^(.*?)\s*[·•.:-]\s*(\d+)\s*[a-z]?$/i.exec((ref ?? '').trim())
  if (!m) return null
  const b = m[1].toLowerCase().replace(/\s+/g, ' ')
  const n = Number(m[2])
  const section = /^(y1|year 1|book 1)\b/.test(b) ? 'Book 1' : /^(y2|year 2|book 2)\b/.test(b) ? 'Book 2'
    : /^(pc1|pure core 1|core pure 1)\b/.test(b) ? 'Pure Core 1' : /^(pc2|pure core 2|core pure 2)\b/.test(b) ? 'Pure Core 2'
    : /^(further stat|fs\b|statistics)/.test(b) ? 'Statistics' : /^(further mech|fme?\b|mechanics)/.test(b) ? 'Mechanics' : null
  return section ? { section, n } : null
}
/** A topic already in the app: its book section from spec_ref ("Book 1 · 3") or book_ref. */
const sectionOfCurrent = (t: Pick<CurrentTopic, 'specRef' | 'bookRef' | 'sortOrder'>) => {
  if (t.specRef && /·\s*\d+$/.test(t.specRef)) { const s = sectionOf({ spec_ref: t.specRef, sort_order: t.sortOrder }); return bookSection(`${s.section} · ${s.n}`) ?? s }
  return bookSection(t.bookRef)
}
const sameSection = (a: { section: string; n: number } | null, b: { section: string; n: number } | null) => !!a && !!b && a.section === b.section && a.n === b.n
/** FM sections → their strand, for app topics the sheet doesn't list. */
const STRAND_OF_SECTION: Record<string, string> = { 'Pure Core 1': 'Further Pure', 'Pure Core 2': 'Further Pure', Statistics: 'Further Stats', Mechanics: 'Further Mech' }

// ---------------------------------------------------------------------------
// The parsed spreadsheet
// ---------------------------------------------------------------------------

export type SheetTopic = {
  tab: string; row: number                  // where it is in the sheet (1-based row), for messages
  subject: SubjectName
  code: string; name: string
  strand: string | null; teacher: string | null; halfTerm: string | null
  taughtFrom: string | null; taught: TrackerTopic['taught']
  bookRef: string | null; section: { section: string; n: number } | null
  status: Colour | null; step: number | null
  bicen: string | null; integralUrl: string | null; freshPct: number | null; lastDone: string | null
  weakNotes: string | null; concepts: string | null
  booklet: Progress | null; pmt: Progress | null; pmtRef: string | null
  order: number                             // school order: the row order in its tab
}
export type SheetAttempt = { row: number; doneOn: string | null; what: AttemptWhat; label: string | null; score: number; outOf: number | null; notes: string | null }
export type SheetMistake = {
  tab: string; row: number
  loggedOn: string | null; code: string | null; question: string | null; body: string
  kind: MistakeKind | null; rule: string | null; source: string | null; redoOn: string | null; redone: 0 | 1 | 2
}
export type SheetTest = {
  row: number; heading: string; title: string; date: string | null; kind: TestKind; subject: SubjectName | null
  info: string | null; topicCodes: string[]; topicNames: string[]
  minutesPerDay: number | null; minutesMax: number | null; limits: string | null; lengthMin: number | null; marks: number | null
  attempts: SheetAttempt[]; mistakes: SheetMistake[]
}
export type SheetItem = { row: number; position: number; title: string; url: string | null; status: ProgrammeItem['status']; doneOn: string | null; minutes: number | null; result: string | null }
export type SheetProgramme = { name: string; perWeek: number; minutes: number; days: string | null; notes: string | null; subject: SubjectName | null; items: SheetItem[] }
export type ParsedTracker = {
  topics: SheetTopic[]
  tests: SheetTest[]
  mistakes: SheetMistake[]                  // "Mistakes – practice" (tests' own mistakes are on each test)
  programmes: SheetProgramme[]              // the STEP tab
  links: Partial<TrackerLinks>
  reviewDays: Partial<Record<Colour, number>>
  warnings: string[]
  tabs: string[]                            // the tabs it read
}

const findSheet = (wb: Workbook, re: RegExp) => wb.sheets.find((s) => re.test(s.name.toLowerCase()))
const cellAt = (s: Sheet, r: number, c: number): Cell => s.rows[r]?.[c] ?? null
const hnorm = (v: Cell) => str(v).toLowerCase().replace(/[’']/g, "'")

/** The row (0-based) that starts with `first` (e.g. "Code") within the first 30 rows, and its columns by name. */
function header(s: Sheet, first: RegExp, spec: Record<string, RegExp>): { at: number; col: Record<string, number> } | null {
  for (let r = 0; r < Math.min(30, s.rows.length); r++) {
    if (!first.test(hnorm(cellAt(s, r, 0)))) continue
    const col: Record<string, number> = {}
    s.rows[r].forEach((v, c) => { const h = hnorm(v); for (const [k, re] of Object.entries(spec)) if (col[k] === undefined && h && re.test(h)) col[k] = c })
    return { at: r, col }
  }
  return null
}
const get = (s: Sheet, r: number, col: Record<string, number>, k: string): Cell => (col[k] === undefined ? null : cellAt(s, r, col[k]))
const linkAt = (s: Sheet, r: number, c: number | undefined): string | null => {
  if (c === undefined) return null
  const href = s.links[`${colLetter(c)}${r + 1}`]
  const v = href ?? str(cellAt(s, r, c))
  return /^https?:\/\/\S+$/i.test(v) ? v.slice(0, 500) : null
}
const colLetter = (c: number) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const CODE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,15}$/

const MATHS_COLS = {
  code: /^code$/, subject: /^(maths ?\/ ?fm|subject|course)$/, strand: /^strand$/, teacher: /^teacher$/, ht: /^(ht|half.?term)$/,
  taughtFrom: /^taught from/, book: /^book/, name: /^(topic|chapter|name)$/, colour: /^colou?r$/, step: /pipeline|^step$/,
  bicen: /exam questions|bicen/, integral: /^integral/, fresh: /fresh/, lastDone: /^last done/, notes: /^notes/,
}
const PHYSICS_COLS = {
  code: /^code$/, strand: /^topic$/, name: /^subtopic$/, teacher: /^teacher$/, taught: /^taught/, colour: /^colou?r$/,
  booklet: /^booklet/, pmtQs: /^pmt q/, fresh: /fresh/, concepts: /concepts/, lastDone: /^last done/, pmt: /^pmt$/,
}

/** Read the 6 tabs. Unknown or missing tabs are skipped with a warning; nothing here throws on odd cells. */
export function parseTracker(wb: Workbook, today: string): ParsedTracker {
  const out: ParsedTracker = { topics: [], tests: [], mistakes: [], programmes: [], links: {}, reviewDays: {}, warnings: [], tabs: [] }
  const seen = new Map<string, SheetTopic>()
  const addTopic = (t: SheetTopic) => {
    const k = t.code.toUpperCase()
    const had = seen.get(k)
    if (had) { out.warnings.push(`${t.tab} row ${t.row}: code ${t.code} is also on ${had.tab} row ${had.row} — used the first one.`); return }
    seen.set(k, t)
    out.topics.push(t)
  }

  // Maths + Further Maths
  const ms = findSheet(wb, /^math|maths ?\+ ?fm|^m\+fm/)
  if (ms) {
    out.tabs.push(ms.name)
    const h = header(ms, /^code$/, MATHS_COLS)
    if (!h) out.warnings.push(`${ms.name}: no “Code” header row found, so its topics were skipped.`)
    else {
      let order = 1   // the row number in its tab (Maths+FM: one sequence across both subjects, 1…60)
      for (let r = h.at + 1; r < ms.rows.length; r++) {
        const code = str(get(ms, r, h.col, 'code')), name = str(get(ms, r, h.col, 'name'))
        if (!code && !name) continue
        if (!CODE.test(code)) { out.warnings.push(`${ms.name} row ${r + 1}: “${code || name}” has no valid code, so it was skipped.`); continue }
        const subject = parseSubject(get(ms, r, h.col, 'subject'))
        if (!subject || subject === 'Physics') { out.warnings.push(`${ms.name} row ${r + 1}: ${code} isn’t marked Maths or FM, so it was skipped.`); continue }
        if (!name) { out.warnings.push(`${ms.name} row ${r + 1}: ${code} has no topic name, so it was skipped.`); continue }
        const bookRef = opt(get(ms, r, h.col, 'book'), 40)
        const ht = str(get(ms, r, h.col, 'ht')).toUpperCase()
        const integralUrl = linkAt(ms, r, h.col.integral)
        addTopic({
          tab: ms.name, row: r + 1, subject, code, name: name.slice(0, 120),
          strand: opt(get(ms, r, h.col, 'strand'), 60), teacher: opt(get(ms, r, h.col, 'teacher'), 60), halfTerm: /^HT[1-6]$/.test(ht) ? ht : null,
          taughtFrom: parseDate(get(ms, r, h.col, 'taughtFrom'), today), taught: null,
          bookRef, section: bookSection(bookRef),
          status: parseColour(get(ms, r, h.col, 'colour')), step: parseStep(get(ms, r, h.col, 'step')),
          bicen: opt(get(ms, r, h.col, 'bicen'), 200), integralUrl, freshPct: parsePct(get(ms, r, h.col, 'fresh')),
          lastDone: parseDate(get(ms, r, h.col, 'lastDone'), today), weakNotes: opt(get(ms, r, h.col, 'notes'), 1000), concepts: null,
          booklet: null, pmt: null, pmtRef: null, order: order++,
        })
      }
    }
  } else out.warnings.push('No “Maths+FM” tab found.')

  // Physics
  const ps = findSheet(wb, /^phys/)
  if (ps) {
    out.tabs.push(ps.name)
    const h = header(ps, /^code$/, PHYSICS_COLS)
    if (!h) out.warnings.push(`${ps.name}: no “Code” header row found, so its topics were skipped.`)
    else {
      let order = 1   // the row number in its tab (Physics: its own sequence)
      for (let r = h.at + 1; r < ps.rows.length; r++) {
        const code = str(get(ps, r, h.col, 'code')), name = str(get(ps, r, h.col, 'name')) || str(get(ps, r, h.col, 'strand'))
        if (!code && !name) continue
        if (!CODE.test(code)) { out.warnings.push(`${ps.name} row ${r + 1}: “${code || name}” has no valid code, so it was skipped.`); continue }
        if (!name) { out.warnings.push(`${ps.name} row ${r + 1}: ${code} has no subtopic name, so it was skipped.`); continue }
        addTopic({
          tab: ps.name, row: r + 1, subject: 'Physics', code, name: name.slice(0, 120),
          strand: opt(get(ps, r, h.col, 'strand'), 60), teacher: opt(get(ps, r, h.col, 'teacher'), 60), halfTerm: null,
          taughtFrom: null, taught: parseTaught(get(ps, r, h.col, 'taught')), bookRef: null, section: null,
          status: parseColour(get(ps, r, h.col, 'colour')), step: null, bicen: null, integralUrl: null,
          freshPct: parsePct(get(ps, r, h.col, 'fresh')), lastDone: parseDate(get(ps, r, h.col, 'lastDone'), today),
          weakNotes: null, concepts: opt(get(ps, r, h.col, 'concepts'), 1000),
          booklet: parseProgress(get(ps, r, h.col, 'booklet')), pmt: parseProgress(get(ps, r, h.col, 'pmtQs')),
          pmtRef: opt(get(ps, r, h.col, 'pmt'), 40), order: order++,
        })
      }
    }
  } else out.warnings.push('No “Physics” tab found.')

  const subjectOfCode = (code: string | null) => (code ? seen.get(code.toUpperCase())?.subject ?? null : null)
  const nameOfCode = (code: string) => seen.get(code.toUpperCase())?.name ?? null

  // Tests & papers
  const ts = findSheet(wb, /^test/)
  if (ts) { out.tabs.push(ts.name); out.tests = parseTests(ts, today, subjectOfCode, nameOfCode, out.warnings) }
  else out.warnings.push('No “Tests & papers” tab found.')

  // Mistakes – practice
  const mk = findSheet(wb, /^mistake/)
  if (mk) {
    out.tabs.push(mk.name)
    const h = header(mk, /^date$/, { date: /^date$/, code: /^code$/, source: /^source/, body: /went wrong/, kind: /^type$/, rule: /^rule/, redoOn: /^redo on/, redone: /^redone/ })
    if (h) for (let r = h.at + 1; r < mk.rows.length; r++) {
      const m = mistakeRow(mk, r, h.col, today)
      if (m) out.mistakes.push(m)
    }
  }

  // STEP
  const st = findSheet(wb, /^step/)
  if (st) {
    out.tabs.push(st.name)
    const h = header(st, /^#$|^no\.?$/, { title: /^(assignment|item|title)$/, status: /^status$/, date: /^date$/, minutes: /^min/, solved: /solved/, idea: /idea/ })
    if (h && h.col.title !== undefined) {
      const intro = [str(cellAt(st, 0, 0)), str(cellAt(st, 1, 0))].filter(Boolean).join(' ')
      const per = /(\d+)\s*(?:a|per|\/)\s*week/i.exec(intro)
      const mins = /(\d+)\s*[–-]\s*(\d+)\s*min/i.exec(intro) ?? /(\d+)\s*min/i.exec(intro)
      const items: SheetItem[] = []
      for (let r = h.at + 1; r < st.rows.length; r++) {
        const title = str(get(st, r, h.col, 'title'))
        if (!title) continue
        const solved = opt(get(st, r, h.col, 'solved'), 60), idea = opt(get(st, r, h.col, 'idea'), 230)
        const m = get(st, r, h.col, 'minutes')
        items.push({
          row: r + 1, position: items.length + 1, title: title.slice(0, 200), url: linkAt(st, r, h.col.title), status: parseItemStatus(get(st, r, h.col, 'status')),
          doneOn: parseDate(get(st, r, h.col, 'date'), today), minutes: typeof m === 'number' && m >= 5 && m <= 300 ? Math.round(m) : null,
          result: stepResult(solved, idea),
        })
      }
      const perWeek = per ? Math.min(14, Math.max(1, Number(per[1]))) : 1
      const minutes = Math.min(300, Math.max(5, mins ? Number(mins[2] ?? mins[1]) : 90))
      if (items.length) out.programmes.push({ name: 'STEP', perWeek, minutes, days: 'weekend', notes: intro.slice(0, 1000) || null, subject: 'Maths', items })
    } else out.warnings.push(`${st.name}: no “# · Assignment” header row found, so STEP was skipped.`)
  }

  // Start here: the links (yellow cells) and the review gaps
  const sh = findSheet(wb, /^start/)
  if (sh) {
    out.tabs.push(sh.name)
    for (let r = 0; r < sh.rows.length; r++) {
      const row = sh.rows[r] ?? []
      const words = row.map(str).join(' | ').toLowerCase()
      for (const [key, re] of LINK_ROWS) {
        // the first row naming the source that has a link (rows that only mention it, or empty yellow cells, don't count)
        if (out.links[key] || !re.test(words)) continue
        let url: string | null = null
        for (let c = 0; c < Math.max(row.length, 6) && !url; c++) url = linkAt(sh, r, c)
        if (url) out.links[key] = url
      }
      const gap = /^(⚪|🔴|🟡|🟢)\s*review after/.exec(str(row[1]) || str(row[0]))
      if (gap) {
        const n = row.find((v) => typeof v === 'number')
        if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 60) out.reviewDays[parseColour(gap[1])!] = n
      }
    }
  }
  return out
}

/** "Start here" rows → the link settings (matched on the row's words, so rows can move). */
const LINK_ROWS: [keyof TrackerLinks, RegExp][] = [
  ['bicenPure', /bicen:?\s*1 pure/], ['bicenStats', /bicen:?\s*2 statistics/], ['bicenMech', /bicen:?\s*3 mechanics/],
  ['bicenCorePure', /bicen:?\s*4 core pure/], ['bicenMemorise', /bicen:?\s*2 everything you need to memorise|memory sheets/],
  ['bicenSummaries', /bicen:?\s*5 chapter summaries/], ['bicenHardest', /bicen:?\s*9 hardest/],
  ['integralFurther', /integral further statistics|integral – further stats\/mech/], ['integralAssessments', /integral – topic assessments|topic assessments/],
  ['amsp', /amsp/], ['madas', /madas/], ['step', /step support/], ['pmtPhysics', /pmt – caie physics|caie physics topic questions/],
  ['isaac', /isaac physics/],
]

/** Sections on "Tests & papers": a heading (name + date), an info line, then topics → attempts → mistakes tables. */
function parseTests(s: Sheet, today: string, subjectOfCode: (c: string | null) => SubjectName | null, nameOfCode: (c: string) => string | null, warnings: string[]): SheetTest[] {
  const A = (r: number) => hnorm(cellAt(s, r, 0)), B = (r: number) => hnorm(cellAt(s, r, 1))
  const tops: number[] = []
  for (let r = 0; r < s.rows.length; r++) if (A(r) === 'code' && B(r) === 'topic') tops.push(r)
  const out: SheetTest[] = []
  const rowDate = (r: number) => { for (let c = 1; c < (s.rows[r]?.length ?? 0); c++) { const d = parseDate(cellAt(s, r, c), today); if (d) return d } return null }
  // pass 1: each section's heading (+ info line): the 1–2 text rows just above its topics header
  const heads = tops.map((h, i) => {
    const prevEnd = i === 0 ? 0 : tops[i - 1] + 1
    const above: number[] = []
    for (let r = h - 1; r >= prevEnd && above.length < 2; r--) {
      if (!str(cellAt(s, r, 0))) { if (above.length) break; else continue }
      if (/^(question|date|code)$/.test(A(r))) break
      above.unshift(r)
    }
    // two rows where only the lower one has the date: the upper one belongs to the section before
    if (above.length === 2 && !rowDate(above[0]) && rowDate(above[1])) above.shift()
    return { h, headRow: above[0] ?? null, infoRow: above.length > 1 ? above[1] : null }
  })
  heads.forEach(({ h, headRow, infoRow }, i) => {
    if (headRow === null) return
    const end = heads.slice(i + 1).find((x) => x.headRow !== null)?.headRow ?? (i + 1 < heads.length ? heads[i + 1].h : s.rows.length)
    const heading = str(cellAt(s, headRow, 0))
    const template = /type its name here/i.test(heading)
    let info = infoRow !== null ? str(cellAt(s, infoRow, 0)) : ''
    if (/^paper name · board · year · time allowed:?$/i.test(info)) info = ''
    const date = rowDate(headRow)
    // tables
    let att = -1, mis = -1
    for (let r = h + 1; r < end; r++) {
      if (att < 0 && A(r) === 'date' && /^what/.test(B(r))) att = r
      if (mis < 0 && A(r) === 'question' && /went wrong/.test(B(r))) mis = r
    }
    const topicsEnd = att > 0 ? att : mis > 0 ? mis : end
    const codes: string[] = [], names: string[] = [], notes: string[] = [], limits: string[] = []
    let lastBooklet: string | null = null
    for (let r = h + 1; r < topicsEnd; r++) {
      const code = str(cellAt(s, r, 0))
      if (!code || !CODE.test(code)) continue
      if (!codes.some((c) => c.toUpperCase() === code.toUpperCase())) codes.push(code)
      const name = str(cellAt(s, r, 1))
      if (name && !/^\(type a code/i.test(name)) names.push(name)
      // one line per topic note; booklets as "CODE: Booklet: <name>" (the planner reads the booklet names from these)
      const booklet = str(cellAt(s, r, 3)), note = str(cellAt(s, r, 4))
      for (const line of topicNoteLines(code, booklet, note, lastBooklet)) { notes.push(line.text); if (line.booklet) lastBooklet = line.booklet }
      if (note &&/\bonly\b|\bno [a-z]|\bnot in\b|\bexcept\b|\bwithout\b|\bexcluding\b/i.test(note)) limits.push(`${code}: ${note}`)
    }
    const attempts: SheetAttempt[] = []
    if (att > 0) for (let r = att + 1; r < (mis > att ? mis : end); r++) {
      const { score, outOf: inline } = parseScore(cellAt(s, r, 2))
      const label = opt(cellAt(s, r, 1), 200)
      if (score === null) continue                      // a row still to fill in ("REAL TEST – HT1" with no score yet)
      const out2 = parseScore(cellAt(s, r, 3)).score ?? inline
      if (out2 !== null && (out2 <= 0 || score > out2)) { warnings.push(`${s.name} row ${r + 1}: score ${score} is more than “out of” ${out2}, so it was skipped.`); continue }
      attempts.push({ row: r + 1, doneOn: parseDate(cellAt(s, r, 0), today), what: parseAttemptWhat(cellAt(s, r, 1)), label, score, outOf: out2, notes: opt(cellAt(s, r, 4), 1000) })
    }
    const mistakes: SheetMistake[] = []
    if (mis > 0) {
      const col = { question: 0, body: 1, code: 2, kind: 3, rule: 4, redoOn: 5, redone: 7 }
      const hdr = s.rows[mis] ?? []
      hdr.forEach((v, c) => { const x = hnorm(v); if (/^redo on/.test(x)) col.redoOn = c; if (/^redone/.test(x)) col.redone = c; if (/^rule/.test(x)) col.rule = c; if (/^type$/.test(x)) col.kind = c; if (/^code$/.test(x)) col.code = c })
      for (let r = mis + 1; r < end; r++) {
        const m = mistakeRow(s, r, col, today)
        if (m) mistakes.push(m)
      }
    }
    if (template && !codes.length && !attempts.length && !mistakes.length) return
    // a consolidation's topics are the ones he lost marks on: its mistakes' codes count too (and alone, if it lists none)
    if (/consolidation/i.test(heading) || !codes.length) {
      for (const m of mistakes) {
        if (!m.code || codes.some((c) => c.toUpperCase() === m.code!.toUpperCase())) continue
        codes.push(m.code)
        const name = nameOfCode(m.code)
        if (name) names.push(name)
      }
    }
    if (!date) { warnings.push(`${s.name} row ${headRow + 1}: “${heading}” has no date, so it wasn’t imported (add the date in column F, or tell the bot).`); return }

    // the name: "FURTHER MATHS HT1 TEST (already sat) → HT1 Consolidation" → "Further Maths HT1 consolidation"
    const parts = heading.split(/\s*→\s*/)
    const main = parts.length > 1 ? parts[parts.length - 1] : parts[0]
    const asides = [...heading.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter(Boolean)
    const subject = /further maths|\bfm\b/i.test(heading) ? 'Further Maths' : /physics/i.test(heading) ? 'Physics' : /\bmaths?\b/i.test(heading) ? 'Maths'
      : majority(codes.map(subjectOfCode))
    let title = niceTitle(main.replace(/\([^)]*\)/g, ' ').replace(/\s*–\s*type its name here/i, '').trim())
    if (subject && !title.toLowerCase().includes(subject.toLowerCase()) && !(subject === 'Further Maths' && /\bfm\b/i.test(title))) {
      title = `${subject} ${KEEP_WORD(title.split(' ')[0]) ? title : title.charAt(0).toLowerCase() + title.slice(1)}`
    }
    const kind: TestKind = /consolidation/i.test(heading) ? 'consolidation' : /\bmock\b/i.test(heading) ? 'mock' : /past paper|\bpaper\b/i.test(main) ? 'paper' : 'test'
    const all = [heading, info].join(' ')
    const perDay = /(\d+)\s*(?:[–-]\s*(\d+)\s*)?min(?:ute)?s?\s*(?:\/|a|per)\s*day/i.exec(all)
    const length = [...info.matchAll(/(\d+)\s*(?:min|mins|minutes)\b(?!\s*(?:\/|a|per)\s*day)/gi)].find((m) => !/[–-]\s*$/.test(info.slice(0, m.index)))
    const hours = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)\b/i.exec(info)
    const marks = /~?\s*(\d+)\s*marks?\b/i.exec(info)
    const lengthMin = length ? Number(length[1]) : hours ? Math.round(Number(hours[1]) * 60) : null
    const extra = [parts.length > 1 ? `${niceTitle(parts[0].replace(/\([^)]*\)/g, ' ').trim())}${asides.length ? ` (${asides.join('; ')})` : ''}` : asides.join('; ')].filter(Boolean)
    const fullInfo = [info, ...extra, ...notes].filter(Boolean).join('\n').slice(0, 2000)
    out.push({
      row: headRow + 1, heading, title: title.slice(0, 200), date, kind, subject, info: fullInfo || null,
      topicCodes: codes.slice(0, 60), topicNames: names,
      minutesPerDay: perDay ? clampMin(Number(perDay[1])) : null, minutesMax: perDay?.[2] ? clampMin(Number(perDay[2])) : perDay ? clampMin(Number(perDay[1])) : null,
      limits: limits.length ? limits.join('; ').slice(0, 300) : null,
      lengthMin: lengthMin && lengthMin >= 5 && lengthMin <= 600 ? lengthMin : null,
      marks: marks && Number(marks[1]) >= 1 && Number(marks[1]) <= 1000 ? Number(marks[1]) : null,
      attempts, mistakes,
    })
  })
  return out
}
const clampMin = (n: number) => (n >= 5 && n <= 240 ? n : null)

/** A test topic's notes as info lines: "PC1-01: Booklet: Matrices…" ("Booklets:" too; "Same booklet – x" names the one before). */
export function topicNoteLines(code: string, booklet: string, note: string, last: string | null): { text: string; booklet: string | null }[] {
  const out: { text: string; booklet: string | null }[] = []
  const add = (name: string) => { const n = name.trim(); if (n) out.push({ text: `${code}: Booklet: ${n}`, booklet: n }) }
  // the "Teacher booklet" column: a name (✅ / ⏳ / ❌ there are progress marks, not names)
  if (booklet && parseProgress(booklet) === null) add(booklet.replace(/^booklets?\s*:\s*/i, ''))
  if (!note) return out
  const named = /^booklets?\s*:\s*(.+)$/i.exec(note)
  const same = /^same booklet\b\s*[–:,-]?\s*(.*)$/i.exec(note)
  if (named) add(named[1])
  else if (same && last) { add(last); if (same[1]) out.push({ text: `${code}: ${same[1]}`, booklet: null }) }
  else out.push({ text: `${code}: ${note}`, booklet: null })
  return out
}
const majority = <T>(xs: (T | null)[]): T | null => {
  const n = new Map<T, number>()
  for (const x of xs) if (x !== null) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}
/** "FURTHER MATHS HT2 TEST" → "Further Maths HT2 test"; "PHYSICS – WAVES TEST" → "Physics – waves test". */
const KEEP_WORD = (w: string) => /\d/.test(w) || /^(FM|ACT|STEP|SMC|AS|A2|OCR|CAIE|AQA|PMT|MAT|TMUA)$/.test(w)
export function niceTitle(s: string): string {
  const words = s.replace(/\s+/g, ' ').trim().split(' ')
  const shouty = s === s.toUpperCase()
  const out = words.map((w, i) => {
    if (KEEP_WORD(w)) return w
    const lw = shouty ? w.toLowerCase() : w
    return i === 0 ? lw.charAt(0).toUpperCase() + lw.slice(1) : lw
  }).join(' ')
  return out.replace(/\bfurther maths\b/gi, 'Further Maths').replace(/\bmaths\b/g, 'Maths').replace(/\bphysics\b/g, 'Physics')
}

/** One mistakes-table row (a test's or the practice tab's); blank rows → null. */
function mistakeRow(s: Sheet, r: number, col: Record<string, number>, today: string): SheetMistake | null {
  const g = (k: string) => (col[k] === undefined ? null : cellAt(s, r, col[k]))
  const body = str(g('body')), rule = opt(g('rule'), 300)
  const src = str(g('source'))
  const split = src ? splitSource(src) : { source: null, question: null }
  const question = opt(g('question'), 40) ?? split.question
  if (!body && !rule && !question) return null
  const code = str(g('code'))
  const redone = str(g('redone')).toLowerCase()
  return {
    tab: s.name, row: r + 1, loggedOn: parseDate(g('date'), today), code: CODE.test(code) ? code : null, question,
    body: (body || rule || `Question ${question}`).slice(0, 500), kind: parseMistakeKind(str(g('kind'))), rule, source: split.source,
    redoOn: parseDate(g('redoOn'), today),
    redone: !redone ? 0 : /\b2\b|twice|both/.test(redone) ? 2 : /^(no|n|not|❌)/.test(redone) ? 0 : 1,
  }
}

// ---------------------------------------------------------------------------
// What the app has now (lib/tracker/data.ts loadImportCurrent)
// ---------------------------------------------------------------------------

export type CurrentTopic = {
  id: string; subjectId: string; name: string; specRef: string | null; sortOrder: number; status: Colour; notesUrl: string | null
  code: string | null; strand: string | null; teacher: string | null; halfTerm: string | null; taughtFrom: string | null; taught: TrackerTopic['taught']
  step: number; bicen: string | null; integralUrl: string | null; freshPct: number | null; lastDone: string | null; weakNotes: string | null
  concepts: string | null; booklet: Progress | null; pmt: Progress | null; pmtRef: string | null; bookRef: string | null; statusAt: string | null
}
export type CurrentTest = {
  id: string; title: string; date: string | null; subjectId: string | null; testKind: TestKind | null; info: string | null; topicCodes: string[]
  topics: string | null; minutesPerDay: number | null; minutesMax: number | null; limits: string | null; lengthMin: number | null; marks: number | null
  source: string | null; sourceRef: string | null
}
export type CurrentAttempt = { id: string; goalId: string; doneOn: string; what: AttemptWhat; score: number | null; outOf: number | null }
export type CurrentMistake = { id: string; goalId: string | null; topicId: string | null; code: string | null; question: string | null; body: string; source: string | null }
export type CurrentProgramme = { id: string; name: string; items: Pick<ProgrammeItem, 'id' | 'position' | 'title' | 'status' | 'doneOn' | 'minutes' | 'result' | 'url'>[] }
export type ImportCurrent = {
  ready: boolean                            // supabase/tracker.sql has run (the topics have their tracker columns)
  subjects: { id: string; name: string; categoryId: string | null; archived: boolean }[]   // archived ones too (names are unique)
  categories: { id: string; name: string }[]
  topics: CurrentTopic[]                    // live ones (not archived)
  tests: CurrentTest[]                      // live goals with kind 'test'
  attempts: CurrentAttempt[]
  mistakes: CurrentMistake[]                // live ones
  programmes: CurrentProgramme[]
  planning: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** Column values for topics / goals / mistakes rows (snake_case, as stored). */
export type Row = Record<string, string | number | boolean | string[] | null>

export type ImportPlan = {
  subjects: { name: SubjectName; categoryId: string | null; restoreId: string | null }[]   // subjects to add or bring back (normally none)
  topics: {
    create: { code: string; subject: SubjectName; label: string; row: Row }[]
    update: { id: string; label: string; patch: Row; reorderOnly: boolean }[]
    archive: { id: string; label: string; keptId: string; keptLabel: string; mistakeIds: string[] }[]
    same: number
  }
  tests: {
    create: { key: string; subject: SubjectName | null; label: string; row: Row }[]
    update: { id: string; key: string; label: string; patch: Row }[]
    same: number
  }
  attempts: { testKey: string; goalId: string | null; label: string; row: Row }[]          // goalId: a test he has; else the new one with testKey
  mistakes: { testKey: string | null; goalId: string | null; code: string | null; topicId: string | null; subject: SubjectName | null; label: string; row: Row }[]
  programmes: {
    create: { name: string; subject: SubjectName | null; row: Row; items: Row[] }[]
    addItems: { id: string; name: string; items: Row[] }[]
    updateItems: { id: string; label: string; patch: Row }[]
  }
  settings: { key: string; value: string | number; label: string }[]
  clashes: string[]
  warnings: string[]
  counts: ImportCounts
}
export type ImportCounts = {
  topicsNew: number; topicsUpdated: number; topicsSame: number; topicsReordered: number; duplicatesArchived: number; mistakesMoved: number
  testsNew: number; testsUpdated: number; attemptsNew: number; mistakesNew: number
  programmesNew: number; programmeItemsNew: number; programmeItemsUpdated: number; settings: number; subjectsNew: number
}

const ORDER_OFFSET = 1000   // app topics the sheet doesn't list go after the school order

const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? '').trim() === (b ?? '').trim()
const PROGRESS: Record<Progress, number> = { todo: 0, doing: 1, done: 2 }
const TAUGHT: Record<NonNullable<TrackerTopic['taught']>, number> = { not_yet: 0, in_class: 1, yes: 2 }
const ITEM: Record<ProgrammeItem['status'], number> = { todo: 0, skipped: 0, doing: 1, done: 2 }
const day = (iso: string | null) => (iso ? `${dowShort(iso)} ${shortDate(iso)}` : 'none')
const label = (t: { code: string | null; name: string }) => (t.code ? `${t.code} ${t.name}` : t.name)

/** Build the plan: what importing this file would change. Pure; the same file against the same data → the same plan. */
export function buildImportPlan(p: ParsedTracker, cur: ImportCurrent, today: string): ImportPlan {
  const plan: ImportPlan = {
    subjects: [], topics: { create: [], update: [], archive: [], same: 0 }, tests: { create: [], update: [], same: 0 },
    attempts: [], mistakes: [], programmes: { create: [], addItems: [], updateItems: [] }, settings: [], clashes: [], warnings: [...p.warnings],
    counts: { topicsNew: 0, topicsUpdated: 0, topicsSame: 0, topicsReordered: 0, duplicatesArchived: 0, mistakesMoved: 0, testsNew: 0, testsUpdated: 0, attemptsNew: 0, mistakesNew: 0, programmesNew: 0, programmeItemsNew: 0, programmeItemsUpdated: 0, settings: 0, subjectsNew: 0 },
  }

  // subjects (Maths, Further Maths, Physics — matched by name, any case)
  const subjectId = new Map<SubjectName, string>()
  const needed = new Set<SubjectName>([...p.topics.map((t) => t.subject), ...p.tests.map((t) => t.subject).filter((s): s is SubjectName => !!s), ...p.programmes.map((x) => x.subject).filter((s): s is SubjectName => !!s)])
  const study = cur.categories.find((c) => normName(c.name) === 'study')?.id ?? null
  for (const name of TRACKER_SUBJECTS) {
    const s = cur.subjects.find((x) => !x.archived && normName(x.name) === normName(name))
    const old = cur.subjects.find((x) => x.archived && normName(x.name) === normName(name))
    if (s) subjectId.set(name, s.id)
    else if (needed.has(name)) {
      plan.subjects.push({ name, restoreId: old?.id ?? null, categoryId: old?.categoryId ?? study ?? cur.subjects.find((x) => !x.archived && TRACKER_SUBJECTS.some((n) => normName(n) === normName(x.name)))?.categoryId ?? null })
      if (old) subjectId.set(name, old.id)   // brought back, so its topics count
    }
  }
  const subjectName = (id: string | null) => TRACKER_SUBJECTS.find((n) => subjectId.get(n) === id) ?? null

  // ---- topics: match code → book + chapter → name
  const live = cur.topics.filter((t) => subjectName(t.subjectId))
  const used = new Set<string>()
  const match = new Map<SheetTopic, CurrentTopic>()
  for (const s of p.topics) {
    const t = live.find((x) => !used.has(x.id) && x.code && x.code.toUpperCase() === s.code.toUpperCase())
    if (t) { match.set(s, t); used.add(t.id) }
  }
  // book + chapter: where two sheet rows share a chapter (Y2-07a / Y2-07), the closer name wins
  const pairs: { s: SheetTopic; t: CurrentTopic; score: number }[] = []
  for (const s of p.topics) {
    if (match.has(s) || !s.section) continue
    for (const t of live) {
      if (used.has(t.id) || subjectName(t.subjectId) !== s.subject || (t.code && t.code.toUpperCase() !== s.code.toUpperCase())) continue
      if (sameSection(s.section, sectionOfCurrent(t))) pairs.push({ s, t, score: nameScore(s.name, t.name) })
    }
  }
  for (const x of pairs.sort((a, b) => b.score - a.score)) {
    if (match.has(x.s) || used.has(x.t.id)) continue
    match.set(x.s, x.t); used.add(x.t.id)
  }
  for (const s of p.topics) {
    if (match.has(s)) continue
    const t = live.find((x) => !used.has(x.id) && !x.code && subjectName(x.subjectId) === s.subject && normName(x.name) === normName(s.name))
    if (t) { match.set(s, t); used.add(t.id) }
  }

  // duplicates: other live topics in the same subject with the same name as a kept one → archived, mistakes moved
  const dupsOf = new Map<string, CurrentTopic[]>()
  for (const [s, k] of match) {
    const names = new Set([normName(s.name), normName(k.name)])
    const dups = live.filter((x) => !used.has(x.id) && x.subjectId === k.subjectId && !x.code && names.has(normName(x.name)))
    for (const d of dups) used.add(d.id)
    if (dups.length) dupsOf.set(k.id, dups)
  }

  const codeToTopicId = new Map<string, string>()       // existing topics, by their (sheet) code
  for (const s of p.topics) {
    const k = match.get(s)
    if (!k) {
      const sid = subjectId.get(s.subject) ?? null
      plan.topics.create.push({ code: s.code, subject: s.subject, label: label(s), row: { ...topicRow(s), subject_id: sid } })
      continue
    }
    codeToTopicId.set(s.code.toUpperCase(), k.id)
    const dups = dupsOf.get(k.id) ?? []
    const base = mergeDuplicates(k, dups)
    for (const d of dups) {
      const mistakeIds = cur.mistakes.filter((m) => m.topicId === d.id).map((m) => m.id)
      plan.topics.archive.push({ id: d.id, label: label(d), keptId: k.id, keptLabel: label({ code: s.code, name: s.name }), mistakeIds })
    }
    const patch = topicPatch(s, k, base, plan.clashes)
    if (Object.keys(patch).length) plan.topics.update.push({ id: k.id, label: label({ code: s.code, name: s.name }), patch, reorderOnly: Object.keys(patch).every((x) => x === 'sort_order') })
    else plan.topics.same++
  }
  // app topics the sheet doesn't list (e.g. the rest of Pure Core 2): after the school order; FM ones get their strand
  const sheetSubjects = new Set(p.topics.map((t) => t.subject))
  for (const t of live) {
    if (used.has(t.id) || !sheetSubjects.has(subjectName(t.subjectId)!)) continue
    const patch: Row = {}
    if (t.sortOrder < ORDER_OFFSET) patch.sort_order = ORDER_OFFSET + t.sortOrder
    const sec = sectionOfCurrent(t)
    if (!t.strand && subjectName(t.subjectId) === 'Further Maths' && sec && STRAND_OF_SECTION[sec.section]) patch.strand = STRAND_OF_SECTION[sec.section]
    if (Object.keys(patch).length) plan.topics.update.push({ id: t.id, label: label(t), patch, reorderOnly: true })
  }

  // ---- tests
  const testKeyToId = new Map<string, string>()
  const usedTests = new Set<string>()
  for (const s of p.tests) {
    const key = `sheet:${normKey(s.heading)}`.slice(0, 300)
    const sid = s.subject ? subjectId.get(s.subject) ?? null : null
    const m = cur.tests.find((t) => !usedTests.has(t.id) && t.sourceRef === key)
      ?? cur.tests.find((t) => !usedTests.has(t.id) && normName(t.title) === normName(s.title))
      ?? cur.tests.find((t) => !usedTests.has(t.id) && t.date === s.date && !!sid && t.subjectId === sid && (t.testKind ?? 'test') === s.kind)
    const codes = s.topicCodes   // as the sheet writes them ('FMe-01'); compared ignoring case
    if (!m) {
      plan.tests.create.push({
        key, subject: s.subject, label: `${s.title} (${day(s.date)})`,
        row: {
          title: s.title, kind: 'test', target_date: s.date, subject_id: sid, topics: s.topicNames.join(', ').slice(0, 500) || null,
          priority: 'normal', status: 'active', test_kind: s.kind, info: s.info, topic_codes: codes, minutes_per_day: s.minutesPerDay,
          minutes_max: s.minutesMax, limits: s.limits, length_min: s.lengthMin, marks: s.marks, source: 'sheet', source_ref: key,
        },
      })
      continue
    }
    usedTests.add(m.id)
    testKeyToId.set(key, m.id)
    const patch: Row = {}
    if (s.date && m.date !== s.date) plan.clashes.push(`${m.title}: date — app ${day(m.date)}, sheet ${day(s.date)} → kept the app’s`)
    if (!m.subjectId && sid) patch.subject_id = sid
    if (!m.testKind) patch.test_kind = s.kind
    if (!m.info && s.info) patch.info = s.info
    const union = [...m.topicCodes]
    for (const c of codes) if (!union.some((u) => u.toUpperCase() === c.toUpperCase())) union.push(c)
    if (union.length !== m.topicCodes.length) patch.topic_codes = union.slice(0, 60)
    if (!m.topics && s.topicNames.length) patch.topics = s.topicNames.join(', ').slice(0, 500)
    if (m.minutesPerDay === null && s.minutesPerDay !== null) patch.minutes_per_day = s.minutesPerDay
    if (m.minutesMax === null && s.minutesMax !== null) patch.minutes_max = s.minutesMax
    if (!m.limits && s.limits) patch.limits = s.limits
    if (m.lengthMin === null && s.lengthMin !== null) patch.length_min = s.lengthMin
    if (m.marks === null && s.marks !== null) patch.marks = s.marks
    if (!m.source) patch.source = 'sheet'
    if (!m.sourceRef && !cur.tests.some((t) => t.sourceRef === key)) patch.source_ref = key
    if (Object.keys(patch).length) plan.tests.update.push({ id: m.id, key, label: `${m.title} (${day(m.date)})`, patch })
    else plan.tests.same++
  }

  // ---- attempts (never twice: same test, day, kind and score)
  for (const s of p.tests) {
    const key = `sheet:${normKey(s.heading)}`.slice(0, 300)
    const goalId = testKeyToId.get(key)
    const had = goalId ? cur.attempts.filter((a) => a.goalId === goalId) : []
    const batch: Row[] = []
    for (const a of s.attempts) {
      const doneOn = a.doneOn ?? (a.what === 'real' && s.date && s.date <= today ? s.date : today)
      const dup = (x: { doneOn: string; what: string; score: number | null; outOf: number | null }) => x.doneOn === doneOn && x.what === a.what && Number(x.score) === a.score && (x.outOf === null ? null : Number(x.outOf)) === a.outOf
      if (had.some(dup) || batch.some((b) => dup({ doneOn: b.done_on as string, what: b.what as string, score: b.score as number, outOf: b.out_of as number | null }))) continue
      const row: Row = { done_on: doneOn, what: a.what, label: a.label, score: a.score, out_of: a.outOf, notes: a.notes }
      batch.push(row)
      plan.attempts.push({ testKey: key, goalId: goalId ?? null, label: `${s.title}: ${a.label ?? a.what} ${a.score}${a.outOf ? `/${a.outOf}` : ''}`, row })
    }
  }

  // ---- mistakes (tests' and practice), never twice
  const sheetSubject = new Map(p.topics.map((t) => [t.code.toUpperCase(), t.subject]))
  const planned: { goal: string | null; topic: string | null; code: string | null; question: string | null; body: string; source: string | null }[] = []
  const existing = cur.mistakes.map((m) => ({ goal: m.goalId, topic: m.topicId, code: m.code, question: m.question, body: m.body, source: m.source }))
  const addMistake = (m: SheetMistake, test: SheetTest | null) => {
    const key = test ? `sheet:${normKey(test.heading)}`.slice(0, 300) : null
    const code = m.code?.toUpperCase() ?? null
    const topicId = code ? codeToTopicId.get(code) ?? null : null
    const goal = key ? testKeyToId.get(key) ?? key : null
    const me = { goal, topic: topicId, code, question: m.question, body: m.body, source: m.source }
    if ([...existing, ...planned].some((x) => sameMistake(x, me))) return
    planned.push(me)
    const loggedOn = m.loggedOn ?? (m.redoOn ? addDays(m.redoOn, -3) : today)
    const stage = m.redone
    const reviewOn = stage === 0 ? m.redoOn ?? firstRedo(loggedOn) : stage === 1 ? afterRedo(0, m.redoOn ?? today).reviewOn! : m.redoOn ?? loggedOn
    const subject = (code && sheetSubject.get(code)) || test?.subject || null
    plan.mistakes.push({
      testKey: key, goalId: key ? testKeyToId.get(key) ?? null : null, code, topicId, subject, label: `${code ?? test?.title ?? 'Mistake'}${m.question ? ` ${m.question}` : ''}: ${m.body.slice(0, 60)}`,
      row: {
        subject_id: subject ? subjectId.get(subject) ?? null : null,
        body: m.body, question: m.question, code: m.code, kind: m.kind, rule: m.rule, source: m.source, logged_on: loggedOn,
        review_on: reviewOn, redo_stage: stage, reviewed_at: stage === 2 ? `${reviewOn}T12:00:00Z` : null, source_text: `sheet: ${m.tab} row ${m.row}`.slice(0, 1000),
      },
    })
  }
  for (const t of p.tests) for (const m of t.mistakes) addMistake(m, t)
  for (const m of p.mistakes) addMistake(m, null)

  // ---- programmes (STEP): created once; later imports only add missing items or move items forward
  for (const s of p.programmes) {
    const m = cur.programmes.find((x) => normName(x.name) === normName(s.name) || (normName(s.name) === 'step' && /^step\b/i.test(x.name.trim())))
    const itemRow = (i: SheetItem): Row => ({ position: i.position, title: i.title, url: i.url, minutes: i.minutes, status: i.status, done_on: i.status === 'done' ? i.doneOn ?? today : i.doneOn, result: i.result })
    if (!m) {
      plan.programmes.create.push({
        name: s.name, subject: s.subject,
        row: { name: s.name, area: 'study', subject_id: s.subject ? subjectId.get(s.subject) ?? null : null, per_week: s.perWeek, minutes: s.minutes, days: s.days, status: 'active', mode: 'in_order', notes: s.notes },
        items: s.items.map(itemRow),
      })
      continue
    }
    const add: Row[] = []
    let next = Math.max(0, ...m.items.map((i) => i.position)) + 1
    for (const i of s.items) {
      const have = m.items.find((x) => normName(x.title) === normName(i.title)) ?? m.items.find((x) => x.position === i.position && !s.items.some((y) => normName(y.title) === normName(x.title)))
      if (!have) { add.push({ ...itemRow(i), position: next++ }); continue }
      const patch: Row = {}
      if (ITEM[i.status] > ITEM[have.status]) { patch.status = i.status; if (i.status === 'done' || i.doneOn) patch.done_on = i.doneOn ?? today }
      if (!have.result && i.result) patch.result = i.result
      if (have.minutes === null && i.minutes !== null) patch.minutes = i.minutes
      if (!have.url && i.url) patch.url = i.url
      if (Object.keys(patch).length) plan.programmes.updateItems.push({ id: have.id, label: `${m.name}: ${have.title}`, patch })
    }
    if (add.length) plan.programmes.addItems.push({ id: m.id, name: m.name, items: add })
  }

  // ---- settings: links and review gaps fill what he hasn't set; his own values win
  const mine = (k: string) => cur.planning[k]
  for (const [lk, url] of Object.entries(p.links) as [keyof TrackerLinks, string][]) {
    const key = LINK_KEYS[lk]
    if (!url) continue
    const have = typeof mine(key) === 'string' ? (mine(key) as string).trim() : ''
    if (!have) plan.settings.push({ key, value: url, label: `Link: ${LINK_LABEL[lk]}` })
    else if (have !== url) plan.clashes.push(`Link “${LINK_LABEL[lk]}”: the app’s is different from the sheet’s → kept the app’s`)
  }
  for (const [colour, n] of Object.entries(p.reviewDays) as [Colour, number][]) {
    const key = REVIEW_KEYS[colour]
    const have = mine(key)
    if (have === undefined || have === null) { if (n !== DEFAULT_REVIEW_DAYS[colour]) plan.settings.push({ key, value: n, label: `${COLOUR_DOT[colour]} review after ${n} days` }) }
    else if (have !== n) plan.clashes.push(`${COLOUR_DOT[colour]} review gap: app ${have} days, sheet ${n} → kept the app’s`)
  }

  const c = plan.counts
  c.subjectsNew = plan.subjects.length
  c.topicsNew = plan.topics.create.length
  c.topicsUpdated = plan.topics.update.filter((u) => !u.reorderOnly).length
  c.topicsReordered = plan.topics.update.filter((u) => u.reorderOnly).length
  c.topicsSame = plan.topics.same
  c.duplicatesArchived = plan.topics.archive.length
  c.mistakesMoved = plan.topics.archive.reduce((n, a) => n + a.mistakeIds.length, 0)
  c.testsNew = plan.tests.create.length
  c.testsUpdated = plan.tests.update.length
  c.attemptsNew = plan.attempts.length
  c.mistakesNew = plan.mistakes.length
  c.programmesNew = plan.programmes.create.length
  c.programmeItemsNew = plan.programmes.create.reduce((n, x) => n + x.items.length, 0) + plan.programmes.addItems.reduce((n, x) => n + x.items.length, 0)
  c.programmeItemsUpdated = plan.programmes.updateItems.length
  c.settings = plan.settings.length
  return plan
}

export const LINK_LABEL: Record<keyof TrackerLinks, string> = {
  bicenPure: 'Bicen: 1 Pure', bicenStats: 'Bicen: 2 Statistics', bicenMech: 'Bicen: 3 Mechanics', bicenCorePure: 'Bicen: 4 Core Pure',
  bicenMemorise: 'Bicen: Everything You Need To Memorise', bicenSummaries: 'Bicen: 5 Chapter Summaries', bicenHardest: 'Bicen: 9 Hardest Questions',
  integralFurther: 'Integral Further Stats/Mech', integralAssessments: 'Integral Topic Assessments', madas: 'MadAs', step: 'STEP Support',
  pmtPhysics: 'PMT CAIE Physics', isaac: 'Isaac Physics', amsp: 'AMSP FM videos',
}

/** How alike two names are (for two sheet rows on one chapter): 3 same, 2 one starts the other, 1 a shared word, 0 none. */
function nameScore(a: string, b: string): number {
  const x = normName(a), y = normName(b)
  if (x === y) return 3
  if (x.startsWith(y) || y.startsWith(x)) return 2
  const wa = new Set(x.split(' ').filter((w) => w.length > 3))
  return y.split(' ').some((w) => wa.has(w)) ? 1 : 0
}

const sameMistake = (a: { goal: string | null; topic: string | null; code: string | null; question: string | null; body: string; source: string | null },
  b: typeof a) => {
  const where = (a.code && b.code && a.code.toUpperCase() === b.code.toUpperCase()) || (a.topic && b.topic && a.topic === b.topic) || (!a.code && !b.code && !a.topic && !b.topic && a.goal === b.goal)
  if (!where) return false
  if (a.goal && b.goal && a.goal !== b.goal) return false              // two different tests
  if (normName(a.body) === normName(b.body)) return true
  if (!!a.goal !== !!b.goal) return false                              // a test's mistake and a practice one: only the same words count
  return !!a.question && !!b.question && normName(a.question) === normName(b.question) && (!a.source || !b.source || normName(a.source) === normName(b.source))
}

/** The kept topic with what its duplicates knew (colour, notes, dates) folded in: the starting point for the sheet's values. */
function mergeDuplicates(k: CurrentTopic, dups: CurrentTopic[]): CurrentTopic {
  if (!dups.length) return k
  const m = { ...k }
  const coloured = [k, ...dups].filter((x) => x.status !== 'not_started').sort((a, b) => (b.statusAt ?? '').localeCompare(a.statusAt ?? ''))
  if (k.status === 'not_started' && coloured.length) m.status = coloured[0].status
  for (const d of dups) {
    m.step = Math.max(m.step, d.step)
    if (d.lastDone && (!m.lastDone || d.lastDone > m.lastDone)) { m.lastDone = d.lastDone; if (d.freshPct !== null) m.freshPct = d.freshPct }
    if (m.freshPct === null) m.freshPct = d.freshPct
    m.weakNotes ??= d.weakNotes
    m.concepts ??= d.concepts
    m.notesUrl ??= d.notesUrl
  }
  return m
}

/** A new topic's row. */
function topicRow(s: SheetTopic): Row {
  return {
    name: s.name, code: s.code, spec_ref: s.section ? `${s.section.section} · ${s.section.n}` : null, sort_order: s.order,
    status: s.status ?? 'not_started', status_at: s.status && s.status !== 'not_started' ? 'now' : null, step: s.step ?? 0,
    strand: s.strand, teacher: s.teacher, half_term: s.halfTerm, taught_from: s.taughtFrom, taught: s.taught,
    bicen: s.bicen, integral_url: s.integralUrl, fresh_pct: s.freshPct, last_done: s.lastDone, weak_notes: s.weakNotes,
    concepts: s.concepts, booklet: s.booklet, pmt: s.pmt, pmt_ref: s.pmtRef, book_ref: s.bookRef,
  }
}

/** What to change on a matched topic. `k` is the row as it is; `base` has its duplicates folded in. */
function topicPatch(s: SheetTopic, k: CurrentTopic, base: CurrentTopic, clashes: string[]): Row {
  const patch: Row = {}
  const name = label({ code: s.code, name: s.name })
  const clash = (what: string, app: string, sheet: string) => clashes.push(`${name}: ${what} — app ${app}, sheet ${sheet} → kept the app’s`)
  const first = !k.code   // never imported before: the sheet names it (the textbook seed's name goes)

  if (first) { if (k.name !== s.name) patch.name = s.name; patch.code = s.code }
  else if (k.code!.toUpperCase() !== s.code.toUpperCase()) clash('code', k.code!, s.code)
  else if (!sameText(k.name, s.name)) clash('name', `“${k.name}”`, `“${s.name}”`)

  // the colour: a non-⚪ app colour wins
  const sheetColour = s.status ?? 'not_started'
  if (base.status !== 'not_started') {
    if (sheetColour !== 'not_started' && sheetColour !== base.status) clash('colour', COLOUR_DOT[base.status], COLOUR_DOT[sheetColour])
    if (base.status !== k.status) { patch.status = base.status; patch.status_at = 'now' }
  } else if (sheetColour !== 'not_started') { patch.status = sheetColour; patch.status_at = 'now' }

  // the step: his wins once set
  const sheetStep = s.step ?? 0
  if (base.step > 0) { if (sheetStep > 0 && sheetStep !== base.step) clash('step', STEPS[base.step], STEPS[sheetStep]) }
  else if (sheetStep > 0) patch.step = sheetStep
  if (base.step !== k.step && !('step' in patch)) patch.step = base.step

  // filled when the app has none; his own values win
  const fill = (col: string, what: string, app: string | null, sheet: string | null, show = (v: string) => `“${v}”`) => {
    if (sheet === null || sheet === '') { return }
    if (app === null || app === '') patch[col] = sheet
    else if (!sameText(app, sheet)) clash(what, show(app), show(sheet))
  }
  fill('strand', 'strand', k.strand, s.strand)
  fill('teacher', 'teacher', k.teacher, s.teacher)
  fill('half_term', 'half-term', k.halfTerm, s.halfTerm)
  fill('taught_from', 'taught from', k.taughtFrom, s.taughtFrom, day)
  fill('bicen', 'Bicen section', k.bicen, s.bicen)
  fill('integral_url', 'Integral link', k.integralUrl, s.integralUrl, () => 'link')
  fill('pmt_ref', 'PMT', k.pmtRef, s.pmtRef)
  fill('book_ref', 'book', k.bookRef, s.bookRef)
  if (!k.specRef && s.section) patch.spec_ref = `${s.section.section} · ${s.section.n}`
  // notes: his first (a duplicate's notes count as his)
  const notes = (col: 'weak_notes' | 'concepts', what: string, have: string | null, own: string | null, sheet: string | null) => {
    if (have && have !== own) patch[col] = have
    if (!sheet) return
    if (!have) patch[col] = sheet
    else if (!sameText(have, sheet)) clash(what, 'has its own', 'differs')
  }
  notes('weak_notes', 'notes', base.weakNotes, k.weakNotes, s.weakNotes)
  notes('concepts', 'concepts', base.concepts, k.concepts, s.concepts)
  if (base.notesUrl && !k.notesUrl) patch.notes_url = base.notesUrl

  // progress: the further one wins (no clash)
  if (s.taught && (!k.taught || TAUGHT[s.taught] > TAUGHT[k.taught])) patch.taught = s.taught
  if (s.booklet && (!k.booklet || PROGRESS[s.booklet] > PROGRESS[k.booklet])) patch.booklet = s.booklet
  if (s.pmt && (!k.pmt || PROGRESS[s.pmt] > PROGRESS[k.pmt])) patch.pmt = s.pmt
  // last done: the later one, with its fresh-question %
  const lastDone = [base.lastDone, s.lastDone].filter((x): x is string => !!x).sort().at(-1) ?? null
  if (lastDone !== k.lastDone) patch.last_done = lastDone
  const pct = s.lastDone && (!base.lastDone || s.lastDone > base.lastDone) && s.freshPct !== null ? s.freshPct : base.freshPct ?? s.freshPct
  if (pct !== k.freshPct && pct !== null) patch.fresh_pct = pct
  // school order
  if (k.sortOrder !== s.order) patch.sort_order = s.order
  return patch
}

// ---------------------------------------------------------------------------
// Words for the preview
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The preview's lines: what would change (empty when nothing would). */
export function planSummary(plan: ImportPlan): string[] {
  const c = plan.counts
  const out: string[] = []
  if (c.subjectsNew) out.push(`Add ${plural(c.subjectsNew, 'subject')}: ${plan.subjects.map((s) => `${s.name}${s.restoreId ? ' (brought back from the archive)' : ''}`).join(', ')}`)
  if (c.topicsNew) out.push(`Add ${plural(c.topicsNew, 'new topic')}`)
  if (c.topicsUpdated) out.push(`Update ${plural(c.topicsUpdated, 'topic')} (codes, teachers, dates, Bicen sections — your colours and notes stay)`)
  if (c.topicsReordered) out.push(`Put ${plural(c.topicsReordered, 'topic')} in school order`)
  if (c.duplicatesArchived) out.push(`Archive ${plural(c.duplicatesArchived, 'duplicate topic')}${c.mistakesMoved ? ` (their ${plural(c.mistakesMoved, 'mistake')} move to the kept topic)` : ''}`)
  if (c.testsNew) out.push(`Add ${plural(c.testsNew, 'test')}: ${plan.tests.create.map((t) => t.label).join(' · ')}`)
  if (c.testsUpdated) out.push(`Fill in ${plural(c.testsUpdated, 'test')} you already have: ${plan.tests.update.map((t) => t.label).join(' · ')}`)
  if (c.attemptsNew) out.push(`Add ${plural(c.attemptsNew, 'test score')}`)
  if (c.mistakesNew) out.push(`Add ${plural(c.mistakesNew, 'mistake')} to redo`)
  if (c.programmesNew) out.push(`Add the ${plan.programmes.create.map((p) => `${p.name} programme (${plural(p.items.length, 'item')}, ${p.row.per_week} a week${p.row.days ? `, ${p.row.days}` : ''})`).join(', ')}`)
  const extraItems = plan.programmes.addItems.reduce((n, x) => n + x.items.length, 0)
  if (extraItems) out.push(`Add ${plural(extraItems, 'programme item')}`)
  if (c.programmeItemsUpdated) out.push(`Move ${plural(c.programmeItemsUpdated, 'programme item')} forward`)
  if (c.settings) out.push(`Save ${plural(c.settings, 'setting')}: ${plan.settings.map((s) => s.label).join(' · ')}`)
  return out
}

/** Nothing would change. */
export const planIsEmpty = (plan: ImportPlan) => planSummary(plan).length === 0
