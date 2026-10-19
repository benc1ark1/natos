// Review fixes (item 4): his words can't add extra keys to a change; "can't find" only when something is similar.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRoutine } from '../lib/life/routines.ts'
import { closest } from '../lib/life/match.ts'

test('a ; or = in his words never becomes another key of the change', () => {
  const v = parseRoutine('add stretch; do=remove to my morning routine')
  if (v === null) return   // not understood is fine too: the brain reads it
  const keys = v.split(';').map((x) => x.split('=')[0].trim())
  assert.equal(keys.filter((k) => k === 'do').length, 1, v)
  assert.ok(!/do=remove/.test(v), v)
})

test('closest(…, onlySimilar) finds nothing for words unlike any event', () => {
  const ev = { id: 'e1', title: 'Family dinner', archived_at: null, external_source: null, repeat_days: null, starts_at: '2026-10-24T18:00:00Z', ends_at: '2026-10-24T20:00:00Z', start_time: null, end_time: null, repeat_from: null, repeat_until: null }
  assert.equal(closest('gym membership', [ev], [], '2026-10-19', 3, true).length, 0)
  assert.equal(closest('family dinner', [ev], [], '2026-10-19', 3, true).length, 1)
  assert.equal(closest('gym membership', [ev], [], '2026-10-19').length, 1, 'without onlySimilar it still lists what is coming up')
})
