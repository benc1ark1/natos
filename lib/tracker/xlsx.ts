// A small .xlsx reader (plans/contracts.md §3.3): the zip's central directory + node:zlib, then the workbook's XML
// (sheets, shared strings, styles for dates, hyperlinks). Gives each sheet's cells as plain values: text, numbers,
// dates as 'YYYY-MM-DD' (or 'YYYY-MM-DDTHH:MM' with a time), formula cells as their saved result (a HYPERLINK formula
// is its text), errors and empty cells as null. Server-only (node:zlib); no npm dependency.
// Built for files from strangers too: everything is bounded (bytes unpacked, rows, columns, cells, sheets) and the XML
// is read by a single forward scan (no backtracking regexes), so a crafted file fails fast with an XlsxError.
import { inflateRawSync } from 'node:zlib'

export type Cell = string | number | null
export type Sheet = {
  name: string
  rows: Cell[][]                    // rows[r][c]: r = row number − 1, c = column (A = 0); trailing empty cells left out
  links: Record<string, string>     // 'D45' → its hyperlink's address (cell links and HYPERLINK("https://…") formulas)
}
export type Workbook = { sheets: Sheet[] }

export class XlsxError extends Error {}

/** Limits (a tracker is ~80 KB): they stop zip bombs, huge row numbers and endless tags early. */
export const LIMITS = {
  entry: 10 * 1024 * 1024,          // one unpacked part
  total: 60 * 1024 * 1024,          // everything unpacked from one file
  entries: 2000,                    // zip entries
  sheets: 30,                       // sheets read (more are ignored)
  rows: 5000,                       // rows read per sheet (rows further down are ignored)
  cols: 255,                        // columns read per row (further right is ignored)
  cells: 200_000,                   // cells per sheet
  tag: 4096,                        // attributes are only read on tags shorter than this
}
const MAX_ROW = 1_048_576, MAX_COL = 16_383   // Excel's own limits: anything beyond is a crafted file
const TOO_BIG = 'That .xlsx file is too big to be a tracker.'

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

/** The zip's files by name (only the ones `want` asks for are unpacked). */
export function unzip(data: Uint8Array, want: (name: string) => boolean = () => true): Map<string, Uint8Array> {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw new XlsxError('That isn’t an .xlsx file (it isn’t a zip).')
  // the end of central directory record: the last 22+ bytes (a comment can follow it)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new XlsxError('That .xlsx file looks damaged (no zip directory).')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count === 0xffff || p === 0xffffffff) throw new XlsxError('That .xlsx file is too big to read here (zip64).')
  if (count > LIMITS.entries) throw new XlsxError('That .xlsx file has too many parts to be a tracker.')
  const out = new Map<string, Uint8Array>()
  const offsets = new Set<number>()
  let total = 0
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('That .xlsx file looks damaged (bad zip entry).')
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1')
    p += 46 + nameLen + extraLen + commentLen
    if (!want(name) || name.endsWith('/')) continue
    if (flags & 1) throw new XlsxError('That .xlsx file is password-protected. Save a copy without a password and try again.')
    if (usize > LIMITS.entry || total + usize > LIMITS.total) throw new XlsxError(TOO_BIG)
    // one part = one place in the file, listed once (aliases of one big entry would multiply its size)
    if (offsets.has(local) || out.has(name)) throw new XlsxError('That .xlsx file looks damaged (a part is listed twice).')
    offsets.add(local)
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new XlsxError('That .xlsx file looks damaged (bad zip entry).')
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + csize)
    if (raw.length !== csize) throw new XlsxError('That .xlsx file is cut short. Download it again and retry.')
    let bytes: Uint8Array
    if (method === 0) bytes = raw
    else if (method === 8) {
      // never more than the part's own limit or what's left of the file's: a size that lies can't get past this
      const room = Math.max(1, Math.min(LIMITS.entry, LIMITS.total - total))
      try { bytes = inflateRawSync(raw, { maxOutputLength: room }) } catch (e) {
        throw new XlsxError((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' ? TOO_BIG : 'That .xlsx file looks damaged (it won’t unpack).')
      }
    } else throw new XlsxError('That .xlsx file uses a zip format this reader doesn’t know.')
    total += bytes.byteLength
    if (total > LIMITS.total) throw new XlsxError(TOO_BIG)
    out.set(name, bytes)
  }
  return out
}

// ---------------------------------------------------------------------------
// XML (just enough for SpreadsheetML: elements, attributes, text), one forward scan
// ---------------------------------------------------------------------------

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
/** Entities (&amp; &#8211; &#x2013;) and SpreadsheetML's _x000D_ escapes. */
export function unescapeXml(s: string): string {
  if (!s.includes('&') && !s.includes('_x')) return s
  return s
    .replace(/&(#x[0-9a-f]{1,8}|#\d{1,8}|[a-z]{2,8});/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
      }
      return ENT[e] ?? m
    })
    .replace(/_x([0-9a-f]{4})_/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)))
}

const isNameChar = (c: number) => (c >= 48 && c <= 58) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c === 46   // 0-9 : A-Z a-z _ - .
const isSpace = (c: number) => c === 32 || c === 9 || c === 10 || c === 13

/** name="value" / name='value' pairs, scanned once (only called on short tags). */
export function attrs(tag: string): Record<string, string> {
  const o: Record<string, string> = {}
  let i = 0
  while (i < tag.length) {
    if (!isNameChar(tag.charCodeAt(i))) { i++; continue }
    const s = i
    while (i < tag.length && isNameChar(tag.charCodeAt(i))) i++
    const key = tag.slice(s, i)
    let j = i
    while (j < tag.length && isSpace(tag.charCodeAt(j))) j++
    if (tag[j] !== '=') continue
    j++
    while (j < tag.length && isSpace(tag.charCodeAt(j))) j++
    const q = tag[j]
    if (q !== '"' && q !== "'") { i = j; continue }
    const e = tag.indexOf(q, j + 1)
    if (e < 0) break
    o[key] = unescapeXml(tag.slice(j + 1, e))
    i = e + 1
  }
  return o
}

type El = { a: Record<string, string>; inner: string; start: number; end: number }

/** Every <name …>…</name> or <name …/> (any namespace prefix), with its attributes and inner XML. Linear in the input. */
function* elements(xml: string, name: string): Generator<El> {
  let i = 0
  let gtAt = -2                         // the next '>' at or after the scan (cached so a run of '<' doesn't rescan)
  const noClose = new Set<string>()     // closing tags known to be missing from here on
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    if (lt < 0) return
    let j = lt + 1
    while (j < xml.length && isNameChar(xml.charCodeAt(j))) j++
    const full = xml.slice(lt + 1, j)
    const local = full.slice(full.lastIndexOf(':') + 1)
    const next = j < xml.length ? xml.charCodeAt(j) : 0
    if (local !== name || !(isSpace(next) || next === 47 || next === 62)) { i = lt + 1; continue }
    if (gtAt !== -1 && gtAt < j) gtAt = xml.indexOf('>', j)
    if (gtAt < 0) return                // no '>' anywhere further: no more complete tags
    const nextLt = xml.indexOf('<', j)
    if (nextLt >= 0 && nextLt < gtAt) { i = nextLt; continue }   // a broken tag: carry on from the next one
    const gt = gtAt
    const selfClose = xml.charCodeAt(gt - 1) === 47
    const attrText = xml.slice(j, selfClose ? gt - 1 : gt)
    const a = attrText.length < LIMITS.tag ? attrs(attrText) : {}
    if (selfClose) { yield { a, inner: '', start: lt, end: gt + 1 }; i = gt + 1; continue }
    const closing = `</${full}>`
    const c = noClose.has(closing) ? -1 : xml.indexOf(closing, gt + 1)
    if (c < 0) {                        // never closed: the rest is its content, and nothing follows it
      noClose.add(closing)
      yield { a, inner: xml.slice(gt + 1), start: lt, end: xml.length }
      return
    }
    yield { a, inner: xml.slice(gt + 1, c), start: lt, end: c + closing.length }
    i = c + closing.length
  }
}
const first = (xml: string, name: string): El | undefined => elements(xml, name).next().value ?? undefined

/** The text of a string item: its <t> runs, without phonetic hints (<rPh>). */
const textOf = (inner: string) => {
  const skip = [...elements(inner, 'rPh')]
  let s = ''
  for (const t of elements(inner, 't')) if (!skip.some((r) => t.start >= r.start && t.start < r.end)) s += unescapeXml(t.inner)
  return s
}

const utf8 = (b: Uint8Array | undefined) => (b ? Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('utf8').replace(/^\uFEFF/, '') : '')

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

/** 'AB12' → { c: 27, r: 11 } (0-based). */
export function cellRef(ref: string): { c: number; r: number } | null {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,9})$/i.exec(ref)
  if (!m) return null
  let c = 0
  for (const ch of m[1].toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { c: c - 1, r: Number(m[2]) - 1 }
}
/** 0-based column → 'A', 'AB'. */
export function colName(c: number): string {
  let s = ''
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

// built-in number formats that are dates or times (ECMA-376 §18.8.30)
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
/** Is a custom format code a date/time? ("d mmm yy" yes; "0%", "0\%", "General", "#,##0" no) */
export function isDateFormat(code: string): boolean {
  const c = code.slice(0, 200).replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '').replace(/_.|\*./g, '')
  return /[dmyhs]/i.test(c) && !/^general$/i.test(c.trim())
}

/** An Excel serial date → 'YYYY-MM-DD' (or 'YYYY-MM-DDTHH:MM' if it has a time). */
export function serialToISO(serial: number, date1904 = false): string | null {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2958465) return null
  const days = Math.floor(serial), frac = serial - days
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)   // 1899-12-30 absorbs Excel's 1900 leap-year bug
  const d = new Date(base + days * 86400000)
  const iso = d.toISOString().slice(0, 10)
  const mins = Math.round(frac * 1440)
  if (mins <= 0 || mins >= 1440) return iso
  return `${iso}T${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// The workbook
// ---------------------------------------------------------------------------

const resolvePath = (base: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}
const relsOf = (files: Map<string, Uint8Array>, part: string) => {
  const dir = part.split('/').slice(0, -1).join('/')
  const file = `${dir ? `${dir}/` : ''}_rels/${part.split('/').pop()}.rels`
  const out = new Map<string, { type: string; target: string; external: boolean }>()
  for (const r of elements(utf8(files.get(file)), 'Relationship')) {
    out.set(r.a.Id, { type: r.a.Type ?? '', target: r.a.Target ?? '', external: r.a.TargetMode === 'External' })
  }
  return out
}

/** Read an .xlsx file. Throws XlsxError with a message he can act on. */
export function readXlsx(data: Uint8Array): Workbook {
  const files = unzip(data, (n) => n.endsWith('.xml') || n.endsWith('.rels'))
  const root = [...relsOf(files, '').values()].find((r) => r.type.endsWith('/officeDocument'))
  const wbPath = root ? resolvePath('', root.target) : 'xl/workbook.xml'
  const wbXml = utf8(files.get(wbPath))
  if (!wbXml) throw new XlsxError('That file has no workbook inside. Is it an .xlsx spreadsheet?')
  const wbRels = relsOf(files, wbPath)
  const date1904 = /^(1|true)$/i.test(first(wbXml, 'workbookPr')?.a.date1904 ?? '')

  // shared strings
  const ssRel = [...wbRels.values()].find((r) => r.type.endsWith('/sharedStrings'))
  const strings: string[] = []
  if (ssRel) for (const si of elements(utf8(files.get(resolvePath(wbPath, ssRel.target))), 'si')) strings.push(textOf(si.inner))

  // which cell styles are dates
  const stRel = [...wbRels.values()].find((r) => r.type.endsWith('/styles'))
  const stXml = stRel ? utf8(files.get(resolvePath(wbPath, stRel.target))) : ''
  const custom = new Map<number, string>()
  for (const f of elements(stXml, 'numFmt')) custom.set(Number(f.a.numFmtId), f.a.formatCode ?? '')
  const dateStyle: boolean[] = []
  const xfs = first(stXml, 'cellXfs')
  if (xfs) for (const xf of elements(xfs.inner, 'xf')) {
    const id = Number(xf.a.numFmtId ?? 0)
    dateStyle.push(DATE_IDS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!)))
  }

  const sheets: Sheet[] = []
  const read = new Set<string>()        // each sheet part once, however often the workbook lists it
  for (const s of elements(wbXml, 'sheet')) {
    if (sheets.length >= LIMITS.sheets) break
    const rel = wbRels.get(s.a['r:id'] ?? s.a.id ?? '')
    if (!rel) continue
    const path = resolvePath(wbPath, rel.target)
    if (read.has(path)) continue
    read.add(path)
    const xml = utf8(files.get(path))
    if (!xml) continue
    sheets.push(readSheet(s.a.name ?? `Sheet${sheets.length + 1}`, xml, relsOf(files, path), strings, dateStyle, date1904))
  }
  if (!sheets.length) throw new XlsxError('That spreadsheet has no sheets I can read.')
  return { sheets }
}

function readSheet(name: string, xml: string, rels: Map<string, { target: string; external: boolean }>, strings: string[], dateStyle: boolean[], date1904: boolean): Sheet {
  const rows: Cell[][] = []
  const formulaLinks: Record<string, string> = {}
  const data = first(xml, 'sheetData')?.inner ?? ''
  const bad = () => new XlsxError(`The “${name}” tab has a cell outside any real spreadsheet. Is the file damaged?`)
  let rowNo = 0, cellCount = 0
  for (const row of elements(data, 'row')) {
    rowNo = row.a.r !== undefined ? Number(row.a.r) : rowNo + 1
    if (!Number.isInteger(rowNo) || rowNo < 1 || rowNo > MAX_ROW) throw bad()
    if (rowNo > LIMITS.rows) break      // a tracker is a few hundred rows: anything further down is ignored
    const r = rowNo - 1
    const cells: Cell[] = []
    let col = -1
    for (const c of elements(row.inner, 'c')) {
      if (++cellCount > LIMITS.cells) throw new XlsxError(`The “${name}” tab has too many cells to be a tracker.`)
      const at = c.a.r ? cellRef(c.a.r) : null
      col = at ? at.c : col + 1
      if (col > MAX_COL || (at && at.r > MAX_ROW)) throw bad()
      if (col >= LIMITS.cols) continue
      const v = cellValue(c.a, c.inner, strings, dateStyle, date1904)
      if (v !== null) cells[col] = v
      // =HYPERLINK("https://…", "text"): the text is the value; the address counts as the cell's link
      const f = c.inner.includes('HYPERLINK') ? /HYPERLINK\(\s*"(https?:\/\/[^"]{1,2000})"/i.exec(unescapeXml(first(c.inner, 'f')?.inner ?? '')) : null
      if (f) formulaLinks[`${colName(col)}${rowNo}`] = f[1]
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null
    if (cells.length) rows[r] = cells
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = []
  const links: Record<string, string> = { ...formulaLinks }
  for (const h of elements(xml, 'hyperlink')) {
    const target = h.a['r:id'] ? rels.get(h.a['r:id'])?.target : undefined
    if (!h.a.ref || !target) continue
    // a range ("A1:B2") gives every cell in it the link; here the first cell is enough
    links[h.a.ref.split(':')[0].replace(/\$/g, '').toUpperCase()] = target
  }
  return { name, rows, links }
}

function cellValue(a: Record<string, string>, inner: string, strings: string[], dateStyle: boolean[], date1904: boolean): Cell {
  const t = a.t ?? 'n'
  const vEl = first(inner, 'v')
  const raw = vEl ? unescapeXml(vEl.inner) : null
  let out: Cell = null
  if (t === 's') out = raw !== null ? strings[Number(raw)] ?? null : null
  else if (t === 'inlineStr') { const is = first(inner, 'is'); out = is ? textOf(is.inner) : raw }
  else if (t === 'str') out = raw
  else if (t === 'b') out = raw === null ? null : raw === '1' || raw.toLowerCase() === 'true' ? 'TRUE' : 'FALSE'
  else if (t === 'e') out = null
  else if (t === 'd') out = raw ? (/T(?!00:00)\d\d:\d\d/.test(raw) ? raw.slice(0, 16) : raw.slice(0, 10)) : null   // an ISO date cell
  else if (raw !== null && raw.trim() !== '') {
    const n = Number(raw)
    if (!Number.isFinite(n)) out = raw
    else out = dateStyle[Number(a.s ?? 0)] ? serialToISO(n, date1904) ?? n : n
  }
  if (typeof out === 'string' && out.trim() === '') return null
  return out
}

/** A cell's text, trimmed ('' if empty). */
export const text = (v: Cell | undefined): string => (v === null || v === undefined ? '' : String(v).trim())
