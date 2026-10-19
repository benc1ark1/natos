// His ACT books (his brief, 19 Oct 2026) as programmes (plans/contracts.md §3.5, §5), plus the daily flashcards.
// The real chapter lists aren't known here, so items are honest generic ones ("Chapter 1" …) with a count that is a
// GUESS (said so on the set-up card and in each programme's notes); he fixes them by chat ("Meltzer has 18 chapters",
// "rename Meltzer chapter 3 to Commas"). Never invent chapter titles. Pure: no database.
import type { Programme, ProgrammeItem } from '../tracker/types'
import type { ActSection, BookRole } from './types'

export type BookItemDef = { title: string; details: string; minutes: number }
export type BookDef = {
  role: Exclude<BookRole, 'other'>
  name: string                  // as he wrote it
  short: string                 // in picks and cards: "Meltzer"
  emoji: string
  section: ActSection | null    // what it trains (flashcards: English grammar)
  mode: Programme['mode']
  perWeek: number               // informational (the ACT planner decides the days)
  minutes: number
  items: BookItemDef[]
  guess: string                 // what the item count is ("16 chapters")
  how: string                   // one line for the card and /act
}

/** Positions go up in tens, so chapters can be added between the Reading guide's chapters and its passages. */
export const POSITION_STEP = 10
export const CHAPTER_MIN = 45
export const CP_TEST_MIN = 15          // a College Panda chapter test
export const PASSAGE_MIN = 9           // one timed Reading passage

const chapters = (n: number, details: string, minutes = CHAPTER_MIN): BookItemDef[] =>
  Array.from({ length: n }, (_, i) => ({ title: `Chapter ${i + 1}`, details, minutes }))

export const PASSAGE_SET = 'Timed passage set'
const passageSets = (n: number): BookItemDef[] =>
  Array.from({ length: n }, (_, i) => ({ title: `${PASSAGE_SET} ${i + 1}`, details: `3 passages, ~${PASSAGE_MIN} min each, timed; then check every wrong answer against the text`, minutes: CHAPTER_MIN }))

export const BOOKS: BookDef[] = [
  {
    role: 'english', name: 'Complete Guide to ACT English (Meltzer)', short: 'Meltzer', emoji: '📘', section: 'english', mode: 'in_order', perWeek: 3, minutes: CHAPTER_MIN,
    items: chapters(16, 'The chapter + its exercises: mark straight after, log each miss with its grammar rule'),
    guess: '16 chapters', how: 'chapter by chapter + its exercises; every miss logged against its grammar rule',
  },
  {
    role: 'reading', name: 'Complete Guide to ACT Reading (3rd ed)', short: 'Reading guide', emoji: '📗', section: 'reading', mode: 'in_order', perWeek: 3, minutes: CHAPTER_MIN,
    items: [...chapters(10, 'Method chapter: read it, then its practice questions; check every wrong answer against the text'), ...passageSets(8)],
    guess: '10 method chapters, then 8 timed passage sets', how: `method chapters first, then timed passages (~${PASSAGE_MIN} min each)`,
  },
  {
    role: 'maths_gaps', name: 'College Panda ACT Math + workbook', short: 'College Panda', emoji: '📐', section: 'maths', mode: 'gaps_only', perWeek: 3, minutes: CHAPTER_MIN,
    items: chapters(30, `Chapter test first (~${CP_TEST_MIN} min): full marks → skip the chapter; dropped marks → the chapter + its workbook questions`),
    guess: '30 chapters', how: 'chapter TEST first; only the chapters where you drop marks',
  },
  {
    role: 'maths_hard', name: 'Advanced ACT Math', short: 'Advanced ACT Math', emoji: '📐', section: 'maths', mode: 'in_order', perWeek: 2, minutes: CHAPTER_MIN,
    items: chapters(12, 'Hard questions (like the last 15 of a Maths section): timed, then fix every miss'),
    guess: '12 chapters', how: 'the hard last-15 questions, once the College Panda gaps are closed',
  },
  {
    role: 'reading_extra', name: 'The Critical Reader (5th ed)', short: 'Critical Reader', emoji: '📕', section: 'reading', mode: 'optional', perWeek: 2, minutes: CHAPTER_MIN,
    items: chapters(12, 'The chapter + its questions; check every wrong answer against the text'),
    guess: '12 chapters', how: 'optional: only if your reading stalls (or you ask)',
  },
  {
    role: 'flashcards', name: 'Grammar flashcards (Anki)', short: 'Flashcards', emoji: '🃏', section: 'english', mode: 'in_order', perWeek: 7, minutes: 10,
    items: [], guess: '', how: '10 min a day: your Anki grammar deck',
  },
]

export const bookDef = (role: BookRole) => BOOKS.find((b) => b.role === role) ?? null

/** The notes a set-up programme carries: its role (so a rename keeps it working) and that its count is a guess. */
export const bookNotes = (b: BookDef) =>
  `ACT book · role=${b.role}${b.guess ? ` · ${b.guess} is a guess: tell me the real number (“${b.short} has 18 chapters”)` : ''}`

/** What a programme is for: its notes' role first ("role=english"), else its name and mode. */
export function roleOf(p: Pick<Programme, 'name' | 'notes' | 'mode'>): BookRole {
  const m = (p.notes ?? '').match(/\brole=([a-z_]+)/)
  if (m && BOOKS.some((b) => b.role === m[1])) return m[1] as BookRole
  const n = p.name.toLowerCase()
  if (/flash ?cards?|anki/.test(n)) return 'flashcards'
  if (/college panda|\bpanda\b/.test(n) || p.mode === 'gaps_only') return 'maths_gaps'
  if (/advanced/.test(n) && /math/.test(n)) return 'maths_hard'
  if (/critical reader/.test(n) || (p.mode === 'optional' && /read/.test(n))) return 'reading_extra'
  if (/meltzer|english|grammar/.test(n)) return 'english'
  if (/reading/.test(n)) return 'reading'
  return 'other'
}

/** The section a book trains ('other' books: from its name). */
export function sectionOf(p: Pick<Programme, 'name' | 'notes' | 'mode'>): ActSection | null {
  const def = bookDef(roleOf(p))
  if (def) return def.section
  const n = p.name.toLowerCase()
  return /english|grammar/.test(n) ? 'english' : /read/.test(n) ? 'reading' : /math/.test(n) ? 'maths' : /science/.test(n) ? 'science' : null
}

export const shortName = (p: Pick<Programme, 'name' | 'notes' | 'mode'>) => bookDef(roleOf(p))?.short ?? p.name
export const emojiOf = (p: Pick<Programme, 'name' | 'notes' | 'mode'>) => bookDef(roleOf(p))?.emoji ?? '📚'

/** Live items in order. */
export const itemsOf = (p: Programme) => [...p.items].sort((a, b) => a.position - b.position)

export const isPassage = (i: Pick<ProgrammeItem, 'title'>) => /\bpassage/i.test(i.title)

/** "Chapter 4" → "ch 4", "Chapter 4: Commas" → "ch 4: Commas", "Timed passage set 2" → "timed passage set 2". */
export const itemShort = (i: Pick<ProgrammeItem, 'title'>) =>
  i.title.replace(/^chapter\s+/i, 'ch ').replace(/^timed passage set/i, 'timed passage set')
