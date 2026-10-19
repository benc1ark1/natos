// "Export my tracker" (plans/contracts.md §3.3): his tracker as CSV files laid out like the spreadsheet's tabs, so each
// one pastes into its tab of his Google Sheet backup (click the tab's header cell → File → Import → Upload → Replace
// data at selected cell). RFC 4180 (quotes doubled, CRLF), with a UTF-8 BOM so Excel and Sheets keep the emoji.
// Used by the Subjects page button and the bot ("export my tracker"). Pure: no database, no clock (today is passed in).
import { daysBetween } from '../time'
import { nextReview, pctOf, taughtState } from './rules'
import { splitStepResult } from './import'
import { COLOUR_DOT, STEPS, type Programme, type StudyWorld, type TrackerMistake, type TrackerTest, type TrackerTopic } from './types'

export type CsvValue = string | number | null | undefined
export type CsvFile = { name: string; tab: string; rows: number; csv: string }
export type TrackerExport = { world: StudyWorld; allMistakes: TrackerMistake[]; allProgrammes?: Programme[] }

/** One cell: quoted when it has a comma, quote, line break or edge space; a leading = + - @ is kept as text. */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v)
  // a spreadsheet would run "=…" as a formula: a leading apostrophe keeps it as the text he typed (Sheets hides it)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Rows → CSV text with a BOM and CRLF line ends. */
export const toCsv = (rows: CsvValue[][]): string => `﻿${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`

const KIND_WORD = (k: string | null) => (k ? k.charAt(0).toUpperCase() + k.slice(1) : '')
const PROGRESS_DOT = { done: '✅', doing: '⏳', todo: '❌' } as const
const TAUGHT_WORD = { yes: 'Yes', in_class: 'In class', not_yet: 'Not yet' } as const
const STATE_WORD = { taught: '✅ Taught', next_up: '⏭ Next up', later: 'Later' } as const
const ITEM_WORD = { todo: 'Not started', doing: 'In progress', done: 'Done', skipped: 'Skipped' } as const
const REDONE = ['', 'once', 'twice']

/** The upcoming tests a topic is in ("Further Maths HT2 test + Physics – waves test"). */
const inTests = (t: TrackerTopic, tests: TrackerTest[], today: string) =>
  tests.filter((x) => x.date && x.date >= today && t.code && x.topicCodes.some((c) => c.toUpperCase() === t.code!.toUpperCase())).map((x) => x.title).join(' + ')

const review = (t: TrackerTopic, w: StudyWorld) => {
  const next = nextReview(t, w.reviewDays)
  return { next, due: next && next <= w.today ? 'DUE' : '' }
}

function mathsRows(w: StudyWorld): CsvValue[][] {
  const head = ['Code', 'Maths / FM', 'Strand', 'Teacher', 'HT', 'Taught from', 'Status', 'Book · ch', 'Topic', 'Colour', 'Pipeline step', 'Exam questions (Bicen section)', 'Integral', 'Latest fresh-Q %', 'Last done', 'Next review', 'Review?', 'In test', 'Notes / weak bits']
  const list = w.topics.filter((t) => t.subject === 'Maths' || t.subject === 'Further Maths').sort((a, b) => a.order - b.order)
  return [head, ...list.map((t) => {
    const r = review(t, w)
    return [t.code, t.subject === 'Further Maths' ? 'FM' : 'Maths', t.strand, t.teacher, t.halfTerm, t.taughtFrom, t.taughtFrom ? STATE_WORD[taughtState(t, w.today)] : '',
      t.bookRef, t.name, COLOUR_DOT[t.status], `${t.step} ${STEPS[t.step] ?? ''}`.trim(), t.bicen, t.integralUrl, t.freshPct, t.lastDone, r.next, r.due, inTests(t, w.tests, w.today), t.weakNotes]
  })]
}

function physicsRows(w: StudyWorld): CsvValue[][] {
  const head = ['Code', 'Topic', 'Subtopic', 'Teacher', 'Taught?', 'Colour', 'Booklet Qs', 'PMT Qs', 'Latest fresh-Q %', 'Concepts I don\'t get', 'Last done', 'Next review', 'Review?', 'In test', 'PMT']
  const list = w.topics.filter((t) => t.subject === 'Physics').sort((a, b) => a.order - b.order)
  return [head, ...list.map((t) => {
    const r = review(t, w)
    return [t.code, t.strand, t.name, t.teacher, t.taught ? TAUGHT_WORD[t.taught] : '', COLOUR_DOT[t.status], t.booklet ? PROGRESS_DOT[t.booklet] : '', t.pmt ? PROGRESS_DOT[t.pmt] : '',
      t.freshPct, t.concepts, t.lastDone, r.next, r.due, inTests(t, w.tests, w.today), t.pmtRef]
  })]
}

const mistakeSource = (m: TrackerMistake) => [m.source, m.question].filter(Boolean).join(' ')

/** One section per test, like the "Tests & papers" tab: heading, info, topics, attempts, mistakes. */
function testRows(w: StudyWorld, mistakes: TrackerMistake[]): CsvValue[][] {
  const out: CsvValue[][] = []
  const byCode = new Map(w.topics.filter((t) => t.code).map((t) => [t.code!.toUpperCase(), t]))
  const tests = [...w.tests].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  for (const t of tests) {
    const left = t.date ? (t.date < w.today ? 'done' : `${daysBetween(w.today, t.date)} days left`) : ''
    out.push([t.title.toUpperCase(), '', '', '', '', t.date, left])
    out.push([t.info?.split('\n')[0] ?? ''])
    out.push(['Code', 'Topic', 'Colour', 'Teacher booklet', 'Notes'])
    for (const code of t.topicCodes) {
      const topic = byCode.get(code.toUpperCase())
      out.push([code, topic?.name ?? '', topic ? COLOUR_DOT[topic.status] : '', topic?.booklet ? PROGRESS_DOT[topic.booklet] : '', ''])
    }
    out.push([])
    out.push(['Date', 'What (booklet / timed practice / past paper / REAL TEST)', 'Score', 'Out of', 'Notes', '%'])
    for (const a of t.attempts) out.push([a.doneOn, a.label ?? KIND_WORD(a.what), a.score, a.outOf, '', a.score !== null && a.outOf ? `${pctOf(a.score, a.outOf)}%` : ''])
    out.push([])
    out.push(['Question', 'What went wrong', 'Code', 'Type', 'Rule for next time', 'Redo on', '', 'Redone?'])
    for (const m of mistakes.filter((x) => x.goalId === t.id)) out.push([m.question, m.body, m.code, KIND_WORD(m.kind), m.rule, m.redoStage < 2 ? m.reviewOn : '', '', REDONE[m.redoStage] ?? ''])
    out.push([], [])
  }
  return out.length ? out : [['No tests yet.']]
}

function mistakeRows(w: StudyWorld, mistakes: TrackerMistake[]): CsvValue[][] {
  const head = ['Date', 'Code', 'Topic', 'Source (sheet + Q)', 'What went wrong', 'Type', 'Rule for next time', 'Redo on', 'Redone?']
  const name = new Map(w.topics.map((t) => [t.id, t.name]))
  const list = mistakes.filter((m) => !m.goalId).sort((a, b) => a.loggedOn.localeCompare(b.loggedOn))
  return [head, ...list.map((m) => [m.loggedOn, m.code, m.topicId ? name.get(m.topicId) ?? '' : '', mistakeSource(m), m.body, KIND_WORD(m.kind), m.rule, m.redoStage < 2 ? m.reviewOn : '', REDONE[m.redoStage] ?? ''])]
}

/** STEP, like its tab. */
function stepRows(p: Programme): CsvValue[][] {
  const head = ['#', 'Assignment', 'Status', 'Date', 'Minutes', 'Solved without help?', 'Idea I learnt']
  return [head, ...[...p.items].sort((a, b) => a.position - b.position).map((i) => {
    const r = splitStepResult(i.result)
    return [i.position, i.title, ITEM_WORD[i.status], i.doneOn, i.minutes, r.solved, r.idea]
  })]
}

/** Every programme (STEP, the ACT books…), one row per item. */
function programmeRows(list: Programme[]): CsvValue[][] {
  const head = ['Programme', 'Per week', 'Days', 'Status', 'Ends', '#', 'Item', 'Item status', 'Date', 'Minutes', 'Result', 'Score', 'Out of']
  return [head, ...list.flatMap((p) => [...p.items].sort((a, b) => a.position - b.position).map((i) =>
    [p.name, p.perWeek, p.days, p.status, p.endsOn, i.position, i.title, ITEM_WORD[i.status], i.doneOn, i.minutes, i.result, i.score, i.outOf]))]
}

/** All the CSV files, one per tab of his sheet (STEP only if he has it). */
export function trackerCsvFiles(data: TrackerExport): CsvFile[] {
  const w = data.world
  const file = (slug: string, tab: string, rows: CsvValue[][], headerRows = 1): CsvFile => ({ name: `tracker-${slug}-${w.today}.csv`, tab, rows: Math.max(0, rows.length - headerRows), csv: toCsv(rows) })
  const step = w.programmes.find((p) => /^step\b/i.test(p.name.trim()))
  const tests = testRows(w, data.allMistakes)
  return [
    file('maths-fm', 'Maths+FM', mathsRows(w)),
    file('physics', 'Physics', physicsRows(w)),
    { ...file('tests', 'Tests & papers', tests, 0), rows: w.tests.length },
    file('mistakes', 'Mistakes – practice', mistakeRows(w, data.allMistakes)),
    ...(step ? [file('step', 'STEP', stepRows(step))] : []),
    file('programmes', 'Programmes', programmeRows(data.allProgrammes ?? w.programmes)),
  ]
}

/** Everything in one CSV (for one Telegram document): each tab under a "## <tab>" line. */
export function trackerCsvAll(data: TrackerExport): CsvFile {
  const files = trackerCsvFiles(data)
  const body = files.map((f) => `${csvCell(`## ${f.tab}`)}\r\n${f.csv.replace(/^﻿/, '')}`).join('\r\n')
  return { name: `tracker-${data.world.today}.csv`, tab: 'All tabs', rows: files.reduce((n, f) => n + f.rows, 0), csv: `﻿${body}` }
}
