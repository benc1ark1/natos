// The .xlsx reader against crafted files (security review of work/tracker-data): huge row numbers, zip bombs (aliased
// entries, too much in total, sizes that lie), the same sheet listed many times, and XML built to make a regex scan
// quadratically. Each must fail fast with an XlsxError (or be read once and quickly), never hang or eat memory.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-import-limits-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32, deflateRawSync } from 'node:zlib'
import { readXlsx, unzip, attrs, XlsxError, LIMITS } from '../lib/tracker/xlsx.ts'
import { zip } from './tracker-import-fixture.mjs'

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
/** A minimal workbook around raw sheet XML (and optional raw shared strings), so the XML itself can be crafted. */
function book(sheetXmls, { sst = '', sheetList } = {}) {
  const list = sheetList ?? sheetXmls.map((_, i) => i)
  return zip([
    { name: '_rels/.rels', data: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: `<workbook ${NS}><sheets>${list.map((k, i) => `<sheet name="S${i}" sheetId="${i + 1}" r:id="rId${k + 10}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${sheetXmls.map((_, i) => `<Relationship Id="rId${i + 10}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>` },
    { name: 'xl/sharedStrings.xml', data: `<sst ${NS}>${sst}</sst>` },
    ...sheetXmls.map((x, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: `<worksheet ${NS}><sheetData>${x}</sheetData></worksheet>` })),
  ])
}
const timed = (fn) => { const t = Date.now(); let out, err; try { out = fn() } catch (e) { err = e } return { ms: Date.now() - t, out, err } }
const fastFail = (bytes, re, ms = 500) => {
  const r = timed(() => readXlsx(bytes))
  assert.ok(r.err instanceof XlsxError, `expected an XlsxError, got ${r.err ?? 'no error'}`)
  assert.match(r.err.message, re)
  assert.ok(r.ms < ms, `took ${r.ms} ms`)
}

/** One stored entry, listed `n` times in the central directory under different names (all pointing at it). */
function aliased(n, size) {
  const data = Buffer.alloc(size, 0x41)
  const body = deflateRawSync(data)
  const name = Buffer.from('xl/a.xml')
  const lh = Buffer.alloc(30)
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc32(data) >>> 0, 14)
  lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26)
  const centrals = []
  for (let k = 0; k < n; k++) {
    const nm = Buffer.from(`xl/a${k}.xml`)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc32(data) >>> 0, 16)
    ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(0, 42)
    centrals.push(ch, nm)
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(30 + name.length + body.length, 16)
  return Buffer.concat([lh, name, body, cd, end])
}

test('probe 1: a row number past Excel’s last row (in a tiny file) fails fast; a column past XFD too', () => {
  const tiny = book(['<row r="50000000"><c r="A50000000"><v>1</v></c></row>'])
  assert.ok(tiny.length < 2000, String(tiny.length))
  fastFail(tiny, /outside any real spreadsheet/)
  fastFail(book(['<row r="1"><c r="XFE1"><v>1</v></c></row>']), /outside any real spreadsheet/)
  fastFail(book(['<row r="-4"><c><v>1</v></c></row>']), /outside any real spreadsheet/)
})

test('probe 1: rows past 5000 and columns past 255 are ignored; too many cells in a sheet fails', () => {
  const wb = readXlsx(book(['<row r="2"><c r="A2"><v>7</v></c><c r="IU2"><v>8</v></c><c r="IV2"><v>9</v></c></row><row r="5000"><c r="A5000"><v>1</v></c></row><row r="5001"><c r="A5001"><v>2</v></c></row><row r="1000000"><c r="A1000000"><v>3</v></c></row>']))
  const rows = wb.sheets[0].rows
  assert.equal(rows.length, LIMITS.rows)
  assert.deepEqual([rows[1][0], rows[1][254], rows[1].length], [7, 8, 255], "column 255 (IU) is the last one read")
  const many = ('<row>' + '<c/>'.repeat(100) + '</row>').repeat(LIMITS.cells / 100 + 1)
  fastFail(book([many]), /too many cells/, 2000)
})

test('probe 2: one big entry listed 40 times (an alias bomb) is refused before unpacking twice', () => {
  const bomb = aliased(40, 5 * 1024 * 1024)
  assert.ok(bomb.length < 40_000)
  const r = timed(() => unzip(bomb))
  assert.ok(r.err instanceof XlsxError && /listed twice/.test(r.err.message), String(r.err))
  assert.ok(r.ms < 1000, `took ${r.ms} ms`)
})

test('probe 2: one part over 10 MB, or more than 60 MB in total, or a size that lies, is too big', () => {
  fastFail(zip([{ name: 'xl/workbook.xml', data: Buffer.alloc(LIMITS.entry + 1, 0x20) }]), /too big/, 2000)
  // seven 9 MB parts: each is fine, together they're over 60 MB
  const parts = Array.from({ length: 7 }, (_, i) => ({ name: `xl/p${i}.xml`, data: Buffer.alloc(9 * 1024 * 1024, 0x20) }))
  const r = timed(() => unzip(zip(parts)))
  assert.ok(r.err instanceof XlsxError && /too big/.test(r.err.message), String(r.err))
  assert.ok(r.ms < 3000, `took ${r.ms} ms`)
  // declares 100 bytes but unpacks to 20 MB: stopped at the 10 MB cap
  const liar = zip([{ name: 'xl/workbook.xml', data: Buffer.alloc(20 * 1024 * 1024, 0x20) }])
  const cdAt = liar.readUInt32LE(liar.length - 22 + 16)
  liar.writeUInt32LE(100, cdAt + 24)
  const l = timed(() => unzip(liar))
  assert.ok(l.err instanceof XlsxError && /too big/.test(l.err.message), String(l.err))
  assert.ok(l.ms < 2000, `took ${l.ms} ms`)
})

test('probe 2: the same sheet listed 100 times is read once; at most 30 sheets are read', () => {
  const rows = '<row r="1"><c r="A1"><v>1</v></c></row>'.repeat(1)
  const once = timed(() => readXlsx(book([rows], { sheetList: Array(100).fill(0) })))
  assert.equal(once.err, undefined)
  assert.equal(once.out.sheets.length, 1)
  assert.ok(once.ms < 500, `took ${once.ms} ms`)
  const forty = readXlsx(book(Array.from({ length: 40 }, () => rows)))
  assert.equal(forty.sheets.length, LIMITS.sheets)
})

test('probe 3: XML made to defeat a regex scan (no ">", endless attributes, unclosed <rPh>) is read in well under 500 ms', () => {
  const noGt = timed(() => readXlsx(book(['<row r="1">' + '<c '.repeat(200_000)])))
  assert.ok(noGt.ms < 500, `200k "<c " took ${noGt.ms} ms`)
  const longAttr = timed(() => readXlsx(book([`<row r="1"><c ${'a'.repeat(80_000)}><v>1</v></c></row><row r="2"><c r="B2"><v>2</v></c></row>`])))
  assert.ok(longAttr.ms < 500, `an 80k-char attribute run took ${longAttr.ms} ms`)
  assert.equal(longAttr.out.sheets[0].rows[1][1], 2, 'the rest of the sheet still reads')
  const rph = timed(() => readXlsx(book(['<row r="1"><c r="A1" t="s"><v>0</v></c></row>'], { sst: '<si>' + '<rPh '.repeat(100_000) + '</si>' })))
  assert.ok(rph.ms < 500, `100k unclosed <rPh took ${rph.ms} ms`)
  const unclosed = timed(() => readXlsx(book(['<row r="1">' + '<c r="A1"><v>1</v>'.repeat(50_000)])))
  assert.ok(unclosed.ms < 500, `50k unclosed <c> took ${unclosed.ms} ms`)
  const tAttr = timed(() => attrs('x'.repeat(80_000) + ' a="1"'))
  assert.ok(tAttr.ms < 100); assert.deepEqual(tAttr.out, { a: '1' })
})

test('probe 3: phonetic hints are still left out of shared strings, and normal attributes still read', () => {
  const wb = readXlsx(book(['<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'], { sst: '<si><r><t>Bold </t></r><r><t>part</t></r><rPh sb="0" eb="1"><t>ignored</t></rPh></si><si><t xml:space="preserve">x &amp; y</t></si>' }))
  assert.deepEqual(wb.sheets[0].rows[0], ['Bold part', 'x & y'])
  assert.deepEqual(attrs(` r="A1" s='2' t="s"`), { r: 'A1', s: '2', t: 's' })
})
