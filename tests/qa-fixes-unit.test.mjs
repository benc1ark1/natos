// Final QA: the small bugs the week simulations (tests/qa-weeks-chat.test.mjs) found, pinned down as plain tests.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/qa-fixes-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planStudyDay } from '../lib/tracker/engine.ts'
import { rolledPick } from '../lib/today/load.ts'
import { candidates } from '../lib/today/build.ts'
import { emptyWorld, homework, dayOf } from './fixtures/tracker-world.mjs'

test('homework titles name the subject once (his short name "FM" counts; "Physics: …" isn’t doubled)', () => {
  const hw = [
    homework({ id: 'a', title: 'FM homework: matrices sheet', subject: 'Further Maths', dueAt: '2026-10-20T12:00:00Z' }),
    homework({ id: 'b', title: 'Physics: forces worksheet', subject: 'Physics', dueAt: '2026-10-20T12:00:00Z' }),
    homework({ id: 'c', title: 'Forces sheet', subject: 'Physics', dueAt: '2026-10-20T12:00:00Z' }),
    homework({ id: 'd', title: 'Mathsy puzzle', subject: 'Maths', dueAt: '2026-10-20T12:00:00Z' }),
  ]
  const plan = planStudyDay({ ...emptyWorld(), homework: hw }, dayOf('2026-10-19', 'school', 300), [])
  assert.deepEqual(Object.fromEntries(plan.picks.map((p) => [p.taskId, p.title])), {
    a: 'FM homework: matrices sheet', b: 'Physics homework: forces worksheet', c: 'Physics homework: Forces sheet', d: 'Maths homework: Mathsy puzzle',
  })
})

test('a redo left yesterday rolls on as today’s redo pick (one, not one per day it was left)', () => {
  const block = { id: 'b1', start_time: '17:00', end_time: '17:10', title: 'Redo 1 test mistake', kind: 'light', status: 'planned', task_id: null, goal_id: null, target_id: null,
    pick_key: 'mistakes:2026-10-05:tests', done_hint: { kind: 'mistakes', mistakeIds: ['m1'] } }
  const r = rolledPick(block, '2026-10-06')
  assert.equal(r.key, 'mistakes:2026-10-06:tests')
  assert.equal(rolledPick(block).key, 'mistakes:2026-10-05:tests', 'without a date: as saved')
  // today's planner picks the same redo again: it shows once (the planner's fresh version)
  const fresh = { ...r, tier: 2, why: 'FM HT2 test · redo every wrong question' }
  assert.deepEqual(candidates([fresh], [], [r]).map((p) => p.key), ['mistakes:2026-10-06:tests'])
})
