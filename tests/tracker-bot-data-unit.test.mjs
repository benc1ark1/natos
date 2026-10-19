// Before supabase/tracker.sql has run (lib/tracker/bot-data.ts): the bot still reads his topics (old columns, with their
// colour), says once how to set the tracker up, and leaves "matrices green" to the old maths flow; every tracker change
// says "run supabase/tracker.sql". A tiny stand-in for the Supabase client returns the "column does not exist" errors.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const { loadTracker, isMissing, weekRulesLine, SQL_NOTE } = await import('../lib/tracker/bot-data.ts')
const { plugin } = await import('../lib/telegram/plugins/tracker.ts')
const TODAY = '2026-10-19'

/** A Supabase client stand-in: every query resolves to handler({ table, cols, filters }). */
function fakeSb(handler) {
  return {
    from(table) {
      const q = { table, cols: '', filters: [] }
      const chain = {
        select(c) { q.cols = c; return chain },
        then(ok, bad) { return Promise.resolve(handler(q)).then(ok, bad) },
      }
      for (const m of ['is', 'eq', 'in', 'gte', 'lte', 'lt', 'not', 'order', 'limit', 'maybeSingle', 'neq']) chain[m] = (...a) => { q.filters.push([m, ...a]); return chain }
      return chain
    },
  }
}
const missingColumn = (table, col) => ({ data: null, error: { code: '42703', message: `column ${table}.${col} does not exist` } })
const missingTable = (table) => ({ data: null, error: { code: 'PGRST205', message: `Could not find the table 'public.${table}' in the schema cache` } })
const before = fakeSb((q) => {
  if (q.table === 'subjects') return { data: [{ id: 's1', name: 'Further Maths' }], error: null }
  if (q.table === 'topics') return q.cols.includes('code') ? missingColumn('topics', 'code') : { data: [{ id: 't1', subject_id: 's1', name: 'Matrices', spec_ref: 'Pure Core 1 · 1', sort_order: 0, status: 'understand' }], error: null }
  if (q.table === 'goals') return missingColumn('goals', 'test_kind')
  if (q.table === 'mistakes') return missingColumn('mistakes', 'redo_stage')
  if (['programmes', 'programme_items', 'plan_rules'].includes(q.table)) return missingTable(q.table)
  if (q.table === 'profiles') return { data: { planning: {} }, error: null }
  throw new Error(`unexpected table ${q.table}`)
})

test('"does not exist" errors are recognised (column, table, schema cache); other errors are not', () => {
  assert.ok(isMissing(missingColumn('topics', 'code').error))
  assert.ok(isMissing(missingTable('plan_rules').error))
  assert.ok(isMissing({ message: 'relation "public.test_attempts" does not exist' }))
  assert.ok(!isMissing({ code: '42501', message: 'permission denied' }))
  assert.ok(!isMissing(null))
})

test('before tracker.sql: his topics with their colour, nothing else, and sqlMissing', async () => {
  const d = await loadTracker(before, TODAY)
  assert.equal(d.sqlMissing, true)
  assert.deepEqual(d.topics.map((t) => [t.name, t.subject, t.status, t.code, t.step, t.bookRef]), [['Matrices', 'Further Maths', 'understand', null, 0, 'Pure Core 1 · 1']])
  assert.deepEqual([d.tests, d.mistakes, d.programmes, d.rules], [[], [], [], []])
})

test('before tracker.sql: fast paths leave "matrices green" to the old flow; export, commands and changes say how to set it up', async () => {
  const env = { sb: before, chatId: 1, today: TODAY, now: new Date(), cardOpen: false, cardEditing: false }
  assert.equal(await plugin.fast('matrices green', env), null, 'the old maths flow (topic_status) answers it')
  assert.deepEqual(await plugin.fast('export my tracker', env), { kind: 'answer', html: SQL_NOTE })
  assert.match(SQL_NOTE, /supabase\/tracker\.sql/)
  for (const name of ['tests', 'review', 'rules', 'programmes', 'physics']) {
    const out = await plugin.commands.find((c) => c.command === name).run({ sb: before, chatId: 1, today: TODAY, now: new Date(), args: '', appUrl: null })
    assert.equal(out.html, SQL_NOTE, `/${name}`)
  }
  const rows = await plugin.loadRows(before, [], TODAY)
  const r = plugin.check('trk_colour', { op: 'trk_colour', ref: 'matrices', value: 'colour=green', date: '', date_to: '', time: '', time_to: '', number: 0, words: '' }, rows, { today: TODAY, said: '', grounded: () => true, ref: undefined, others: [] })
  assert.match(r.problem, /run supabase\/tracker\.sql/)
  assert.deepEqual(await plugin.snapshot(before, TODAY), { sections: [], refs: [] })
  assert.equal(await weekRulesLine(before, TODAY, '2026-10-25'), null, 'no rules line on the Your week card')
})

test('a real read problem is an error (not "set it up")', async () => {
  const broken = fakeSb((q) => (q.table === 'subjects' ? { data: null, error: { code: '08006', message: 'connection lost' } } : { data: [], error: null }))
  await assert.rejects(loadTracker(broken, TODAY), /Couldn’t read your subjects: connection lost/)
})
