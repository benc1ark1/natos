// Jarvis phase D2, plain tests: the training rules (my-spec 31) as data, and placing the week's gym sessions
// around fixed sessions. Each rule is broken on purpose and must be caught; ~15 scripted weeks must come out
// 100% rule-compliant. Run: npm run test:unit
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_RULES, ruleProblems, placeWeek, guessType } from '../lib/training.ts'

// Mon 12 – Sun 18 Oct 2026
const D = (n) => `2026-10-${String(12 + n).padStart(2, '0')}`
const fixed = (n, type, title = type, start = '18:00') => ({ date: D(n), start, type, load: 'hard', title, fixed: true })
const flex = (n, type, title = type, start = '16:30') => ({ date: D(n), start, type, load: 'hard', title, fixed: false, key: `${title}@${n}` })
const rooms = (dates = [0, 1, 2, 3, 4, 5, 6]) => dates.map((n) => ({ date: D(n), slots: [{ start: '16:10', end: '17:50' }, { start: '20:00', end: '22:30' }] }))
const need = (key, type, minutes = 60, preferred = null) => ({ key, title: key.split('#')[0], type, load: 'hard', minutes, preferred })
const rules = DEFAULT_RULES

test('each rule, broken on purpose, is caught (and the allowed pair is not)', () => {
  const p = (sessions) => ruleProblems(sessions, rules).map((x) => x.rule)
  assert.match(p([flex(1, 'lower', 'Lower'), fixed(2, 'sprint', 'Owen')]).join(), /No (?:Lower|plyo) the day before/)
  assert.match(p([flex(4, 'plyo', 'Plyo'), fixed(5, 'match', 'Match')]).join(), /No (?:Lower|plyo) the day before/)
  assert.match(p([flex(0, 'lower', 'Lower'), fixed(1, 'sprint', 'Owen')]).join(), /Sprint and plyo when fresh|day before/)
  assert.match(p([flex(0, 'lower', 'Lower', '07:00'), fixed(0, 'sprint', 'Owen', '18:00')]).join(), /day before|when fresh/, 'Lower earlier the same day as a sprint')
  assert.match(p([fixed(2, 'football', 'Football'), flex(2, 'lower', 'Lower')]).join(), /At most one hard session a day/)
  assert.deepEqual(p([fixed(2, 'football', 'Football'), flex(2, 'upper', 'Upper')]), [], 'Upper is fine on football days')
  assert.match(p([fixed(2, 'football', 'Football'), flex(2, 'upper', 'Upper'), flex(3, 'lower', 'Lower')]).join(), /After a double-session day/)
  assert.deepEqual(p([flex(0, 'lower', 'Lower'), flex(2, 'upper', 'Upper'), fixed(4, 'sprint', 'Owen')]), [], 'a fine week')
})

test('rules are data: switching one off, or a new one ("no plyo within 1 day of a match, either side")', () => {
  const off = rules.map((r) => (r.kind === 'max_hard' ? { ...r, enabled: false } : r))
  assert.deepEqual(ruleProblems([fixed(2, 'football', 'Football'), flex(2, 'lower', 'Lower')], off), [])
  const mine = [{ kind: 'gap', what: ['plyo'], near: ['match'], side: 'both', days: 1, label: 'No plyo within 24 h of a match', enabled: true }]
  assert.equal(ruleProblems([fixed(5, 'match', 'Match'), flex(6, 'plyo', 'Plyo')], mine).length, 1, 'the day after')
  assert.equal(ruleProblems([fixed(5, 'match', 'Match'), flex(4, 'plyo', 'Plyo')], mine).length, 1, 'the day before')
  assert.equal(ruleProblems([fixed(5, 'match', 'Match'), flex(3, 'plyo', 'Plyo')], mine).length, 0, 'two days before is fine')
})

test('placing: around Owen’s sprint and the match; Upper may share a football day; nothing breaks a rule', () => {
  const fx = [fixed(1, 'football', 'Football'), fixed(3, 'sprint', 'Owen'), fixed(5, 'match', 'Match')]
  const { placed, tbc } = placeWeek([need('Lower#1', 'lower'), need('Upper#1', 'upper'), need('Upper#2', 'upper')], fx, rooms(), rules, '21:30')
  assert.deepEqual(tbc, [])
  const all = [...fx, ...placed.map((p) => ({ ...p, fixed: false }))]
  assert.deepEqual(ruleProblems(all, rules), [])
  const lower = placed.find((p) => p.title === 'Lower')
  assert.notEqual(lower.date, D(2), 'not the day before the sprint')
  assert.notEqual(lower.date, D(4), 'not the day before the match')
})

test('the day it already had is kept when it still works (fewest changes)', () => {
  const fx = [fixed(3, 'sprint', 'Owen')]
  const { placed } = placeWeek([need('Upper#1', 'upper', 60, D(4))], fx, rooms(), rules, '21:30')
  assert.equal(placed[0].date, D(4))
})

test('no valid day: the session is TBC (allowed, never forced)', () => {
  // every day has a hard fixed session, so Lower can't go anywhere
  const fx = [0, 1, 2, 3, 4, 5, 6].map((n) => fixed(n, n % 2 ? 'football' : 'sprint', `S${n}`))
  const { placed, tbc } = placeWeek([need('Lower#1', 'lower')], fx, rooms(), rules, '21:30')
  assert.deepEqual(placed, [])
  assert.match(tbc[0].reason, /no day this week/)
})

test('hard sessions go before the cut-off; too little free time means TBC', () => {
  const late = [{ date: D(0), slots: [{ start: '21:00', end: '22:30' }] }]
  assert.equal(placeWeek([need('Upper#1', 'upper')], [], late, rules, '21:30').tbc.length, 1)
  const tight = [{ date: D(0), slots: [{ start: '16:10', end: '16:40' }] }]
  assert.equal(placeWeek([need('Upper#1', 'upper', 60)], [], tight, rules, '21:30').tbc.length, 1)
})

test('15 scripted weeks: every placed plan is 100% rule-compliant, and as full as the rules allow', () => {
  const weeks = [
    [], [fixed(0, 'football')], [fixed(1, 'sprint'), fixed(5, 'match')], [fixed(0, 'football'), fixed(2, 'football'), fixed(4, 'sprint')],
    [fixed(5, 'match'), fixed(6, 'football')], [fixed(1, 'football'), fixed(1, 'sprint', 'Owen double')], [fixed(3, 'sprint'), fixed(4, 'sprint')],
    [fixed(0, 'match')], [fixed(2, 'sprint'), fixed(2, 'football')], [fixed(0, 'football'), fixed(3, 'football'), fixed(5, 'match')],
    [fixed(6, 'match')], [fixed(1, 'sprint'), fixed(3, 'sprint'), fixed(5, 'sprint')], [fixed(4, 'football'), fixed(5, 'match')],
    [fixed(0, 'sprint'), fixed(2, 'match'), fixed(4, 'sprint')], [fixed(2, 'football'), fixed(6, 'sprint')],
  ]
  const needs = [need('Lower#1', 'lower'), need('Lower#2', 'lower'), need('Upper#1', 'upper'), need('Upper#2', 'upper'), need('Plyo#1', 'plyo', 30)]
  weeks.forEach((fx, i) => {
    const { placed, tbc } = placeWeek(needs, fx, rooms(), rules, '21:30')
    const broken = ruleProblems([...fx, ...placed.map((p) => ({ ...p, fixed: false }))], rules).filter((p) => p.keys.some((k) => needs.some((n) => n.key === k)))
    assert.deepEqual(broken, [], `week ${i + 1}`)
    assert.equal(placed.length + tbc.length, needs.length, `week ${i + 1}: every session placed or TBC`)
  })
})

test('training types are guessed from names until set', () => {
  assert.deepEqual(guessType('Owen training'), { type: 'sprint', load: 'hard' })
  assert.deepEqual(guessType('Match vs Eton'), { type: 'match', load: 'hard' })
  assert.deepEqual(guessType('Lower (coach)'), { type: 'lower', load: 'hard' })
  assert.deepEqual(guessType('Upper body'), { type: 'upper', load: 'hard' })
  assert.deepEqual(guessType('Football'), { type: 'football', load: 'hard' })
  assert.equal(guessType('CS tutor'), null)
  assert.deepEqual(guessType('Lower + plyo'), { type: 'lower', load: 'hard' }, 'a Lower day, so the Lower rules apply')
})

test('the planner places only the sessions in his set-up: never football, matches or other targets (Build O)', async () => {
  const { weekNeeds } = await import('../lib/week.ts')
  const t = (name, n) => ({ id: name, name, target_count: n, counts_from: 'logs', is_active: true, activity_type: null, subject_id: null, bonus_count: null, sync_source: 'manual', sort_order: 0 })
  const w = { today: D(0), nowMin: 0, from: D(0), to: D(6), settings: { bufferMin: 10 }, events: [], changes: [], logs: [], weekCounts: [], rules, energy: new Map(), planned: [],
    targets: [t('Football', 4), t('Upper', 3), t('Lower + plyo', 2), t('SMC', 3)] }
  const titles = [...new Set(weekNeeds(w).map((n) => n.title))].sort()
  assert.deepEqual(titles, ['Core', 'Heavy lower', 'Injury prevention', 'Speed + circuits', 'Upper'])
  // his set-up says Heavy lower counts toward the "Lower + plyo" target, Upper toward "Upper"
  assert.equal(weekNeeds(w).find((n) => n.title === 'Heavy lower').key, 'heavy_lower#1')
})
