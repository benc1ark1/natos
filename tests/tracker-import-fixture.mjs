// Made-up test data for the tracker import tests (tests/tracker-import-unit.test.mjs, tests/tracker-data-chat.test.mjs).
// The repo is public: no real teacher or school names here — "Teacher A/B/C" only. Curriculum codes and topic names
// are fine. Also: a tiny .xlsx writer (zip + XML, node:zlib) so the reader is tested on real bytes.
import { crc32, deflateRawSync } from 'node:zlib'

// ---------------------------------------------------------------------------
// A small .xlsx writer: sheets of cells → zip bytes
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const col = (c) => { let s = ''; for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s }
const serial = (iso) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000

/** Zip entries ({ name, data: string|Buffer, store? }) → a .zip Buffer (deflate unless store). */
export function zip(entries) {
  const locals = [], centrals = []
  let offset = 0
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8')
    const body = e.store ? data : deflateRawSync(data)
    const name = Buffer.from(e.name, 'utf8')
    const crc = crc32(data) >>> 0
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(e.store ? 0 : 8, 8)
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(e.store ? 0 : 8, 10)
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, body)
    centrals.push(ch, name)
    offset += lh.length + name.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, end])
}

/**
 * Sheets → an .xlsx Buffer. Each sheet: { name, rows: cell[][], links?: { 'D5': url } }. A cell is a string (shared
 * string), a number, null, { date: 'YYYY-MM-DD' }, { inline: 'text' }, { formula, value } (cached string result),
 * { bool: true }, { error: '#N/A' } or { rich: ['a', 'b'] }.
 */
export function xlsx(sheets, { store = false } = {}) {
  const strings = [], index = new Map()
  const sst = (s) => { if (!index.has(s)) { index.set(s, strings.length); strings.push(s) } return index.get(s) }
  const files = []
  sheets.forEach((sh, i) => {
    const rows = sh.rows.map((row, r) => {
      const cells = row.map((v, c) => {
        const ref = `${col(c)}${r + 1}`
        if (v === null || v === undefined) return ''
        if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`
        if (typeof v === 'string') return `<c r="${ref}" t="s"><v>${sst(v)}</v></c>`
        if (v.date) return `<c r="${ref}" s="1"><v>${serial(v.date)}</v></c>`
        if (v.builtinDate) return `<c r="${ref}" s="2"><v>${serial(v.builtinDate)}</v></c>`
        if (v.inline !== undefined) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(v.inline)}</t></is></c>`
        if (v.formula !== undefined) return `<c r="${ref}" t="str"><f>${esc(v.formula)}</f><v>${esc(v.value ?? '')}</v></c>`
        if (v.bool !== undefined) return `<c r="${ref}" t="b"><v>${v.bool ? 1 : 0}</v></c>`
        if (v.error) return `<c r="${ref}" t="e"><v>${esc(v.error)}</v></c>`
        if (v.rich) { const k = `\u0000rich${strings.length}`; index.set(k, strings.length); strings.push({ rich: v.rich }); return `<c r="${ref}" t="s"><v>${index.get(k)}</v></c>` }
        throw new Error(`bad cell ${JSON.stringify(v)}`)
      }).join('')
      return `<row r="${r + 1}">${cells}</row>`
    }).join('')
    const links = Object.entries(sh.links ?? {})
    const hl = links.length ? `<hyperlinks>${links.map(([ref], k) => `<hyperlink ref="${ref}" r:id="rId${k + 1}"/>`).join('')}</hyperlinks>` : ''
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${rows}</sheetData>${hl}</worksheet>` })
    if (links.length) files.push({ name: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map(([, url], k) => `<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(url)}" TargetMode="External"/>`).join('')}</Relationships>` })
  })
  const si = strings.map((s) => (typeof s === 'string' ? `<si><t xml:space="preserve">${esc(s)}</t></si>` : `<si>${s.rich.map((t) => `<r><rPr><b/></rPr><t xml:space="preserve">${esc(t)}</t></r>`).join('')}<rPh><t>ignored</t></rPh></si>`)).join('')
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>', store },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>', store },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 10}"/>`).join('')}</sheets></workbook>`, store },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${sheets.map((_, i) => `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`, store },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}">${si}</sst>`, store },
    { name: 'xl/styles.xml', data: '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="165" formatCode="d\\ mmm\\ yy"/><numFmt numFmtId="166" formatCode="0\\%"/></numFmts><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="165"/><xf numFmtId="14"/><xf numFmtId="166"/></cellXfs></styleSheet>', store },
    ...files.map((f) => ({ ...f, store })),
  ])
}

// ---------------------------------------------------------------------------
// The made-up tracker (laid out like the real one)
// ---------------------------------------------------------------------------

const D = (date) => ({ date })
export const MATHS_HEAD = ['Code', 'Maths / FM', 'Strand', 'Teacher', 'HT', 'Taught from', 'Status', 'Book · ch', 'Topic', 'Colour', 'Pipeline step', 'Exam questions (Bicen section)', 'Integral', 'Latest fresh-Q %', 'Last done', 'Next review', 'Review?', 'In test', 'Notes / weak bits']
export const PHYSICS_HEAD = ['Code', 'Topic', 'Subtopic', 'Teacher', 'Taught?', 'Colour', 'Booklet Qs', 'PMT Qs', 'Latest fresh-Q %', "Concepts I don't get", 'Last done', 'Next review', 'Review?', 'In test', 'PMT']
const m = (code, sub, strand, teacher, ht, from, book, name, colour = '⚪', step = '0 Not started', bicen = '', extra = {}) =>
  [code, sub, strand, teacher, ht, D(from), { formula: 'IF(F5="","",…)', value: '✅ Taught' }, book, name, colour, step, { formula: 'IF(…,HYPERLINK(…))', value: bicen }, 'Integral', extra.pct ?? null, extra.last ? D(extra.last) : null, null, null, null, extra.notes ?? null]

export const INTEGRAL_URL = 'https://example.org/integral/pure'

/** The made-up workbook as sheets (for xlsx()). */
export function fixtureSheets() {
  const maths = [
    ['Maths + Further Maths – every topic in school order'],
    ['Yellow = you fill in.'],
    [],
    MATHS_HEAD,
    m('Y1-01', 'Maths', 'Pure', 'Teacher A', 'HT1', '2026-09-01', 'Y1 red · 1', 'Proof', '⚪', '0 Not started', 'Bicen Pure → AS: Algebraic Methods (proof)'),
    m('Y1-13', 'Maths', 'Pure', 'Teacher B', 'HT1', '2026-09-14', 'Y1 red · 13', 'Differentiation', '🟡', '3 Mixed exercise', 'Bicen Pure → AS: Differentiation', { pct: 70, last: '2026-10-10', notes: 'chain rule signs' }),
    m('PC1-01', 'FM', 'Further Pure', 'Teacher A', 'HT1', '2026-09-07', 'PC1 blue · 1', 'Matrices', '🟢', '0 Not started', 'Bicen Core Pure → CP1: Matrices'),
    m('PC1-03', 'FM', 'Further Pure', 'Teacher A', 'HT1', '2026-09-21', 'PC1 blue · 3', 'Applications of matrices (invariant lines NOT through origin too)', '⚪', '0 Not started', 'Bicen Core Pure → CP1: Linear Transformations'),
    m('Y2-07a', 'Maths', 'Pure', 'Teacher B', 'HT1', '2026-09-28', 'Y2 green · 7', 'Radians – basics', '⚪', '0 Not started', 'Bicen Pure → A2: Radians'),
    m('PC1-06', 'FM', 'Further Pure', 'Teacher A', 'HT2', '2026-11-02', 'PC1 blue · 6', 'Mathematical induction', '⚪', '0 Not started', 'Bicen Core Pure → CP1: Proof by Induction'),
    m('Y2-07', 'Maths', 'Pure', 'Teacher A', 'HT3', '2027-02-01', 'Y2 green · 7', 'Radian measure', '⚪', '0 Not started', 'Bicen Pure → A2: Radians'),
    m('FS-02', 'FM', 'Further Stats', 'Teacher C', 'HT4', '2027-03-08', 'Further Stats · 2', 'Discrete random variables', '⚪', '0 Not started', 'Integral Further Stats'),
    // blank template rows at the bottom (formulas with empty results)
    [null, null, null, null, null, null, { formula: 'IF(F13="","",…)', value: '' }],
  ]
  const physics = [
    ['Physics – topics 1–11. Keep up + review.'], [], [],
    PHYSICS_HEAD,
    ['P1.3', 'Physical quantities & units', 'Errors and uncertainties', 'Teacher C', 'Yes', '⚪', '✅', '⏳', null, null, null, null, null, 'Mechanics + Waves', 'PMT topic 1'],
    ['P3.1', 'Dynamics', "Newton's laws of motion (momentum part later)", 'Teacher C', 'Yes', '🔴', '⏳', null, 55, 'resultant force vs net', D('2026-10-12'), null, null, 'Mechanics', 'PMT topic 3'],
    ['P7.1', 'Waves', 'Progressive waves', 'Teacher D', 'In class', '⚪', null, null, null, null, null, null, null, 'Waves', 'PMT topic 7'],
    ['P9.1', 'Electricity', 'Electric current', 'TBC', 'Not yet', '⚪'],
  ]
  const attemptHead = ['Date', 'What (booklet / timed practice / past paper / REAL TEST)', 'Score', 'Out of', 'Notes', '%']
  const mistakeHead = ['Question', 'What went wrong', 'Code', 'Type', 'Rule for next time', 'Redo on', null, 'Redone?']
  const tests = [
    ['Tests & past papers – one section each'], [], [],
    ['FURTHER MATHS HT2 TEST', null, null, null, null, D('2026-11-12'), { formula: 'IF(…)', value: '24 days left' }],
    ['50 min · ~45 marks · calculator · booklets on Classroom.'],
    ['Code', 'Topic', 'Colour', 'Teacher booklet', 'Notes'],
    ['PC1-01', 'Matrices', '🟢', null, 'Booklet: Matrices'],
    ['PC1-03', 'Applications of matrices', '⚪', null, 'Same booklet – invariant lines NOT through origin'],
    ['Y1-13', 'Differentiation', '🟡'],
    [], [],
    attemptHead,
    [D('2026-10-15'), 'Timed practice', 30, 45, 'ran out of time'],
    [null, 'REAL TEST'],
    [],
    mistakeHead,
    ['Q3b', 'Missed the invariant line that is not through O', 'PC1-03', 'Knowledge', 'Use y = mx + c', D('2026-10-18')],
    ['Q5', 'Dropped a minus sign', 'Y1-13', 'Careless', null, D('2026-10-18'), null, 'Yes'],
    [], [],
    ['FURTHER MATHS HT1 TEST (already sat) → HT1 Consolidation', null, null, null, null, D('2026-11-02'), { formula: 'IF(…)', value: '14 days left' }],
    ['Put your HT1 score + every mistake here (30–60 min/day over half-term).'],
    ['Code', 'Topic', 'Colour', 'Teacher booklet', 'Notes'],
    [], [],
    attemptHead,
    [null, 'REAL TEST – HT1'],
    [],
    mistakeHead,
    ['Q4', 'Forgot (AB)^-1 = B^-1 A^-1 reverses the order', 'PC1-01', 'Knowledge', 'Reverse the order', D('2026-10-20')],
    [], [],
    ['PHYSICS – MECHANICS TEST (Teacher C side)', null, null, null, null, D('2026-11-10')],
    ['Everything so far + an uncertainties question.'],
    ['Code', 'Topic', 'Colour', 'Teacher booklet', 'Notes'],
    ['P1.3', 'Errors and uncertainties', '⚪', null, 'Uncertainties question guaranteed'],
    ['P3.1', "Newton's laws of motion", '🔴', null, "Newton's laws only – no momentum"],
    [],
    attemptHead,
    [],
    mistakeHead,
    [], [],
    ['PAST PAPER / NEXT TEST #1 – type its name here'],
    ['Paper name · board · year · time allowed:'],
    ['Code', 'Topic', 'Colour', 'Teacher booklet', 'Notes'],
    [null, { formula: 'IF(A…)', value: '' }],
    attemptHead,
    [],
    mistakeHead,
    [],
  ]
  const practice = [
    ['Mistakes from homework, Bicen sets – anything that isn’t a test.'],
    ['Row 5 is an example – overwrite it.'], [],
    ['Date', 'Code', 'Topic', 'Source (sheet + Q)', 'What went wrong', 'Type', 'Rule for next time', 'Redo on', 'Redone?'],
    [D('2026-10-17'), 'PC1-03', { formula: 'INDEX(…)', value: 'Applications of matrices' }, 'Bicen CP1 Linear Transformations Q3b', 'Assumed the invariant line goes through the origin', 'Knowledge', 'Use y = mx + c unless told it passes through O', D('2026-10-20')],
    [null, null, { formula: 'IF(B6="",…)', value: '' }, null, null, null, null, { formula: 'IF(A6="","",A6+3)', value: '' }],
  ]
  const step = [
    ['STEP Support – Foundation modules, in order. 1 a week (60–90 min).'],
    ['Attempt properly first (30+ min, no hints) → hints → solution.'], [],
    ['#', 'Assignment', 'Status', 'Date', 'Minutes', 'Solved without help?', 'Idea I learnt'],
    [1, 'STEP Support – Assignment 1', 'Done', D('2026-10-11'), 75, 'with hints', 'factor theorem trick'],
    [2, 'STEP Support – Assignment 2', 'Not started'],
    ['M', 'Mixed Pure STEP 1 questions', 'Not started'],
  ]
  const start = [
    [null, 'My Maths · Further Maths · Physics system'],
    [null, '4. Your sites (paste your Bicen links into the yellow cells)'],
    [null, 'For', 'Source', 'Link'],
    [null, 'Main exam bank – Pure', 'Bicen: 1 Pure – Exam Questions', null, '← paste the link'],
    [null, 'Main exam bank – Statistics', 'Bicen: 2 Statistics – Exam Questions', 'open'],
    [null, 'Stretch', 'MadAs (school page)', 'open'],
    [null, 'Challenge', 'STEP Support – Foundation', 'open'],
    [],
    [null, '7. Review gaps (days) – change if you like'],
    [null, '🔴 review after (days)', 2],
    [null, '🟡 review after (days)', 3],
    [null, '🟢 review after (days)', 14],
    [null, '⚪ review after (days)', 7],
  ]
  return [
    { name: 'Start here', rows: start, links: { D5: 'https://example.org/bicen/stats', D6: 'https://example.org/madas', D7: 'https://example.org/step' } },
    { name: 'Maths+FM', rows: maths, links: { M5: INTEGRAL_URL, M6: INTEGRAL_URL } },
    { name: 'Physics', rows: physics, links: {} },
    { name: 'Tests & papers', rows: tests, links: {} },
    { name: 'Mistakes – practice', rows: practice, links: {} },
    { name: 'STEP', rows: step, links: { B5: 'https://example.org/step/1', B6: 'https://example.org/step/2' } },
  ]
}

/** The same sheets as the reader would give them (cells as plain values), for pure tests without a zip. */
export function fixtureWorkbook() {
  const plain = (v) => (v === null || v === undefined ? null : typeof v !== 'object' ? (v === '' ? null : v) : v.date ?? v.builtinDate ?? (v.formula !== undefined ? (v.value || null) : v.inline ?? null))
  return { sheets: fixtureSheets().map((s) => ({ name: s.name, rows: s.rows.map((r) => r.map(plain)), links: s.links ?? {} })) }
}

// ---------------------------------------------------------------------------
// "What the app has": a few seeded textbook topics + a duplicate made by chat
// ---------------------------------------------------------------------------

export const IDS = { maths: 'sub-maths', fm: 'sub-fm', physics: 'sub-physics', cat: 'cat-study' }
const topic = (id, subjectId, name, specRef, sortOrder, more = {}) => ({
  id, subjectId, name, specRef, sortOrder, status: 'not_started', notesUrl: null, code: null, strand: null, teacher: null, halfTerm: null, taughtFrom: null, taught: null,
  step: 0, bicen: null, integralUrl: null, freshPct: null, lastDone: null, weakNotes: null, concepts: null, booklet: null, pmt: null, pmtRef: null, bookRef: null, statusAt: null, ...more,
})
/** His data before the import (in ImportCurrent's shape). */
export function fixtureCurrent() {
  return {
    ready: true,
    subjects: [{ id: IDS.maths, name: 'Maths', categoryId: IDS.cat, archived: false }, { id: IDS.fm, name: 'Further Maths', categoryId: IDS.cat, archived: false }, { id: IDS.physics, name: 'Physics', categoryId: IDS.cat, archived: false }],
    categories: [{ id: IDS.cat, name: 'Study' }],
    topics: [
      topic('t-proof', IDS.maths, 'Proof & mathematical communication', 'Book 1 · 1', 0),
      topic('t-diff', IDS.maths, 'Differentiation', 'Book 1 · 13', 12, { status: 'not_secure', statusAt: '2026-10-01T10:00:00Z', weakNotes: 'my own note' }),
      topic('t-rad', IDS.maths, 'Radian measure', 'Book 2 · 7', 28),
      topic('t-mat', IDS.fm, 'Matrices', 'Pure Core 1 · 1', 0, { notesUrl: 'https://example.org/goodnotes/matrices' }),
      topic('t-mat-dup', IDS.fm, 'Matrices', null, 40, { status: 'understand', statusAt: '2026-10-05T10:00:00Z', lastDone: '2026-10-05' }),
      topic('t-app', IDS.fm, 'Applications of matrices', 'Pure Core 1 · 3', 2),
      topic('t-hyp', IDS.fm, 'Hyperbolic functions', 'Pure Core 2 · 6', 11),
    ],
    tests: [],
    attempts: [],
    mistakes: [
      { id: 'm-dup', goalId: null, topicId: 't-mat-dup', code: null, question: null, body: 'det sign wrong', source: null },
      // logged by chat earlier: the same as the practice tab's example (same code + question)
      { id: 'm-chat', goalId: null, topicId: 't-app', code: 'PC1-03', question: 'Q3b', body: 'assumed through origin', source: null },
    ],
    programmes: [],
    planning: { linkBicenStats: 'https://example.org/my-own-stats-link' },
  }
}

/**
 * Apply a plan to an ImportCurrent in memory (what applyImport does in the database), so idempotency can be checked
 * without a database: importing the same file into the result must change nothing.
 */
export function simulateApply(cur, plan) {
  const next = structuredClone(cur)
  let n = 0
  const id = (p) => `${p}-new-${++n}`
  const camel = (k) => k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  const MAP = { sort_order: 'sortOrder', spec_ref: 'specRef', notes_url: 'notesUrl', status_at: 'statusAt', subject_id: 'subjectId' }
  const put = (obj, row) => { for (const [k, v] of Object.entries(row)) obj[MAP[k] ?? camel(k)] = v === 'now' && k.endsWith('_at') ? '2026-10-19T12:00:00Z' : v }
  for (const s of plan.subjects) next.subjects.push({ id: s.restoreId ?? id('sub'), name: s.name, categoryId: s.categoryId, archived: false })
  for (const a of plan.topics.archive) {
    next.topics = next.topics.filter((t) => t.id !== a.id)
    for (const m of next.mistakes) if (a.mistakeIds.includes(m.id)) m.topicId = a.keptId
  }
  for (const u of plan.topics.update) put(next.topics.find((t) => t.id === u.id), u.patch)
  const created = new Map()
  for (const c of plan.topics.create) {
    const t = topic(id('t'), c.row.subject_id ?? next.subjects.find((s) => s.name === c.subject).id, '', null, 0)
    put(t, c.row)
    next.topics.push(t)
    created.set(c.code.toUpperCase(), t.id)
  }
  const testId = new Map()
  for (const c of plan.tests.create) {
    const t = { id: id('g'), title: '', date: null, subjectId: null, testKind: null, info: null, topicCodes: [], topics: null, minutesPerDay: null, minutesMax: null, limits: null, lengthMin: null, marks: null, source: null, sourceRef: null }
    put(t, { ...c.row, target_date: undefined, test_kind: undefined, topic_codes: undefined, source_ref: undefined })
    Object.assign(t, { date: c.row.target_date, testKind: c.row.test_kind, topicCodes: c.row.topic_codes, sourceRef: c.row.source_ref })
    next.tests.push(t)
    testId.set(c.key, t.id)
  }
  for (const u of plan.tests.update) {
    const t = next.tests.find((x) => x.id === u.id)
    const { target_date, test_kind, topic_codes, source_ref, ...rest } = u.patch
    put(t, rest)
    if (test_kind !== undefined) t.testKind = test_kind
    if (topic_codes !== undefined) t.topicCodes = topic_codes
    if (source_ref !== undefined) t.sourceRef = source_ref
    if (target_date !== undefined) t.date = target_date
  }
  for (const a of plan.attempts) next.attempts.push({ id: id('a'), goalId: a.goalId ?? testId.get(a.testKey), doneOn: a.row.done_on, what: a.row.what, score: a.row.score, outOf: a.row.out_of })
  for (const m of plan.mistakes) {
    next.mistakes.push({ id: id('m'), goalId: m.goalId ?? (m.testKey ? testId.get(m.testKey) : null), topicId: m.topicId ?? (m.code ? created.get(m.code) ?? null : null), code: m.row.code, question: m.row.question, body: m.row.body, source: m.row.source })
  }
  for (const p of plan.programmes.create) next.programmes.push({ id: id('p'), name: p.name, items: p.items.map((i) => ({ id: id('i'), position: i.position, title: i.title, status: i.status, doneOn: i.done_on, minutes: i.minutes, result: i.result, url: i.url })) })
  for (const a of plan.programmes.addItems) next.programmes.find((p) => p.id === a.id).items.push(...a.items.map((i) => ({ id: id('i'), position: i.position, title: i.title, status: i.status, doneOn: i.done_on, minutes: i.minutes, result: i.result, url: i.url })))
  for (const u of plan.programmes.updateItems) for (const p of next.programmes) { const i = p.items.find((x) => x.id === u.id); if (i) put(i, u.patch) }
  for (const s of plan.settings) next.planning[s.key] = s.value
  return next
}
