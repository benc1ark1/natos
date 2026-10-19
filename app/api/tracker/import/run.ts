// The tracker import, run for the signed-in user (app/api/tracker/import/route.ts): read the .xlsx, compare it with his
// data, and either return a preview (nothing saved) or — only with the preview's fingerprint, so he confirms exactly
// what he saw — save it. Server-only (the reader uses node:zlib). Never the service role: `sb` is his session.
import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readXlsx, XlsxError } from '@/lib/tracker/xlsx'
import { buildImportPlan, parseTracker, planIsEmpty, planSummary, type ImportCounts, type ImportPlan } from '@/lib/tracker/import'
import { applyImport, loadImportCurrent, logged, RUN_SQL } from '@/lib/tracker/data'

/** Vercel takes request bodies up to 4.5 MB; his tracker is ~80 KB. */
export const MAX_BYTES = 4 * 1024 * 1024

export type ImportPreview = {
  ok: true; mode: 'preview'; ready: boolean; empty: boolean; fingerprint: string
  summary: string[]; clashes: string[]; warnings: string[]; counts: ImportCounts
  found: { tabs: string[]; topics: number; tests: number; mistakes: number; items: number }
}
export type ImportSaved = { ok: true; mode: 'confirm'; saved: ImportCounts; lines: string[] }
export type ImportFailed = { ok: false; error: string; saved?: ImportCounts; lines?: string[]; preview?: ImportPreview }
export type ImportReply = ImportPreview | ImportSaved | ImportFailed

const fingerprintOf = (plan: ImportPlan) => createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0, 32)

/** What was saved, in words (only counts the database confirmed). */
export function savedLines(c: ImportCounts): string[] {
  const p = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
  const out: string[] = []
  if (c.subjectsNew) out.push(`${p(c.subjectsNew, 'subject')} added`)
  if (c.topicsNew) out.push(`${p(c.topicsNew, 'new topic')}`)
  if (c.topicsUpdated) out.push(`${p(c.topicsUpdated, 'topic')} updated`)
  if (c.topicsReordered) out.push(`${p(c.topicsReordered, 'topic')} put in school order`)
  if (c.duplicatesArchived) out.push(`${p(c.duplicatesArchived, 'duplicate')} archived`)
  if (c.mistakesMoved) out.push(`${p(c.mistakesMoved, 'mistake')} moved to the kept topic`)
  if (c.testsNew) out.push(`${p(c.testsNew, 'new test')}`)
  if (c.testsUpdated) out.push(`${p(c.testsUpdated, 'test')} filled in`)
  if (c.attemptsNew) out.push(`${p(c.attemptsNew, 'test score')}`)
  if (c.mistakesNew) out.push(`${p(c.mistakesNew, 'mistake')} to redo`)
  if (c.programmesNew) out.push(`${p(c.programmesNew, 'programme')}`)
  if (c.programmeItemsNew) out.push(`${p(c.programmeItemsNew, 'programme item')}`)
  if (c.programmeItemsUpdated) out.push(`${p(c.programmeItemsUpdated, 'programme item')} moved forward`)
  if (c.settings) out.push(`${p(c.settings, 'setting')}`)
  return out
}

/** Preview (mode 'preview') or save (mode 'confirm' + the preview's fingerprint). */
export async function runImport(sb: SupabaseClient, bytes: Uint8Array, mode: 'preview' | 'confirm', fingerprint: string | null, today: string): Promise<{ status: number; body: ImportReply }> {
  if (!bytes.byteLength) return { status: 400, body: { ok: false, error: 'That file is empty.' } }
  if (bytes.byteLength > MAX_BYTES) return { status: 413, body: { ok: false, error: 'That file is too big (4 MB at most). Is it the tracker?' } }
  let parsed
  try {
    parsed = parseTracker(readXlsx(bytes), today)
  } catch (e) {
    return { status: 400, body: { ok: false, error: e instanceof XlsxError ? e.message : 'That file couldn’t be read as a spreadsheet. Download it again as .xlsx and retry.' } }
  }
  if (!parsed.topics.length && !parsed.tests.length && !parsed.mistakes.length && !parsed.programmes.length) {
    return { status: 400, body: { ok: false, error: `Nothing to import: no Maths+FM, Physics, Tests & papers, Mistakes or STEP rows found${parsed.tabs.length ? ` (tabs read: ${parsed.tabs.join(', ')})` : ''}.` } }
  }
  let current
  try { current = await loadImportCurrent(sb) } catch (e) { logged('reading your tracker for the import', e); return { status: 500, body: { ok: false, error: 'Couldn’t read your tracker to compare it with the file. Nothing was saved; try again in a minute.' } } }
  const plan = buildImportPlan(parsed, current, today)
  const preview: ImportPreview = {
    ok: true, mode: 'preview', ready: current.ready, empty: planIsEmpty(plan), fingerprint: fingerprintOf(plan),
    summary: planSummary(plan), clashes: plan.clashes, warnings: plan.warnings, counts: plan.counts,
    found: { tabs: parsed.tabs, topics: parsed.topics.length, tests: parsed.tests.length, mistakes: parsed.mistakes.length + parsed.tests.reduce((n, t) => n + t.mistakes.length, 0), items: parsed.programmes.reduce((n, p) => n + p.items.length, 0) },
  }
  if (mode === 'preview') return { status: 200, body: preview }
  if (!current.ready) return { status: 409, body: { ok: false, error: RUN_SQL, preview } }
  if (!fingerprint || fingerprint !== preview.fingerprint) {
    return { status: 409, body: { ok: false, error: 'Your tracker changed since that preview (or the file did), so nothing was saved. Check the new preview and confirm again.', preview } }
  }
  if (preview.empty) return { status: 200, body: { ok: true, mode: 'confirm', saved: plan.counts, lines: [] } }
  const r = await applyImport(sb, plan, current.ready)
  if (!r.ok) return { status: 500, body: { ok: false, error: r.error ?? 'Not saved.', saved: r.saved, lines: savedLines(r.saved) } }
  return { status: 200, body: { ok: true, mode: 'confirm', saved: r.saved, lines: savedLines(r.saved) } }
}
