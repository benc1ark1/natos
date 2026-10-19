// A small made-up study tracker for the tracker bot's tests (item 1c): topics in Maths, Further Maths and Physics with
// codes, colours, steps and review dates; three tests; two open mistakes; the STEP programme; one live rule. Dates are
// relative to `today`, so the same data works for the unit tests (a fixed day) and the chat tests (the real day).
// world(today) → the TrackerData the pure code reads; seed(chat) → the same rows in the TEST database.
const add = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const sundayOf = (iso) => { const d = new Date(`${iso}T12:00:00Z`); const dow = (d.getUTCDay() + 6) % 7; return add(iso, 6 - dow) }

export function spec(today) {
  const T = (code, subject, strand, name, o = {}) => ({ code, subject, strand, name, status: 'not_started', step: 0, taught_from: null, taught: null, last_done: null, booklet: null, pmt: null, ...o })
  const topics = [
    T('Y1-01', 'Maths', 'Pure', 'Proof & mathematical communication', { taught_from: add(today, -45), status: 'exam_ready', step: 5, last_done: add(today, -9) }),
    T('Y1-04', 'Maths', 'Pure', 'Polynomials', { taught_from: add(today, -30), status: 'understand', step: 3, last_done: add(today, -4) }),
    T('Y1-07', 'Maths', 'Pure', 'Logarithms', { taught_from: add(today, -14) }),
    T('Y1-10', 'Maths', 'Pure', 'Trigonometric functions & equations', { taught_from: add(today, 14) }),
    T('Y1-12', 'Maths', 'Pure', 'Vectors', { taught_from: add(today, -20), status: 'understand', step: 2, last_done: add(today, -1) }),
    T('Y1-13', 'Maths', 'Pure', 'Differentiation', { taught_from: add(today, 60) }),
    T('Y1-14', 'Maths', 'Pure', 'Applications of differentiation', { taught_from: add(today, 67) }),
    T('Y1-16', 'Maths', 'Statistics', 'Working with data', { taught_from: add(today, -29), status: 'not_secure', step: 2, last_done: add(today, -2) }),
    T('Y2-01', 'Maths', 'Pure', 'Proof', { taught_from: add(today, 320) }),
    T('PC1-01', 'Further Maths', 'Further Pure', 'Matrices', { taught_from: add(today, -40), status: 'not_secure', step: 3, last_done: add(today, -3), bicen: 'Bicen Core Pure → CP1: Matrices' }),
    T('PC1-02', 'Further Maths', 'Further Pure', 'Further vectors', { taught_from: add(today, -25) }),
    T('PC1-03', 'Further Maths', 'Further Pure', 'Applications of matrices', { taught_from: add(today, -10), status: 'understand', step: 2, last_done: add(today, -1) }),
    T('FS-01', 'Further Maths', 'Further Stats', 'Counting principles & probability', { taught_from: add(today, 21) }),
    T('P1.1', 'Physics', 'Mechanics', 'Kinematics', { taught: 'yes', status: 'understand', booklet: 'todo', pmt: 'todo', last_done: add(today, -2) }),
    T('P3.1', 'Physics', 'Mechanics', 'Momentum', { taught: 'not_yet', taught_from: add(today, 12) }),
    T('P7.3', 'Physics', 'Waves', 'Stationary waves', { taught: 'in_class' }),
  ]
  const tests = [
    { title: 'FM HT2 test', subject: 'Further Maths', date: add(today, 24), test_kind: 'test', topic_codes: ['PC1-01', 'PC1-02', 'PC1-03'], marks: 45, length_min: 50, info: '50 min · ~45 marks · calculator' },
    { title: 'Physics mechanics test', subject: 'Physics', date: add(today, 22), test_kind: 'test', topic_codes: ['P1.1'], limits: 'no momentum' },
    { title: 'FM HT1 consolidation', subject: 'Further Maths', date: add(today, 14), test_kind: 'consolidation', topic_codes: ['PC1-01'], minutes_per_day: 30, minutes_max: 60 },
  ]
  const mistakes = [
    { code: 'PC1-03', question: 'Q3b', body: 'assumed it went through the origin', kind: 'knowledge', logged_on: add(today, -3), review_on: today, redo_stage: 0 },
    { code: 'Y1-04', question: 'Q5', body: 'sign error expanding', kind: 'careless', logged_on: add(today, -5), review_on: add(today, 6), redo_stage: 1 },
  ]
  const stepItems = [...Array.from({ length: 25 }, (_, i) => `STEP Support – Assignment ${i + 1}`), 'Mixed Pure STEP 1 questions', 'Mixed Mechanics STEP 1 questions', 'Mixed Statistics STEP 1 questions']
  const programmes = [{ name: 'STEP', per_week: 1, days: 'weekend', minutes: 75, items: stepItems.map((title, i) => ({ title, position: i + 1, status: i < 2 ? 'done' : 'todo', done_on: i < 2 ? add(today, -14 + i * 7) : null })) }]
  const rules = [
    { words: 'no stretch for a while', kind: 'pause', target: 'stretch', starts_on: add(today, -10), ends_on: add(today, -3) },   // ended
    { words: 'no reviews this week', kind: 'pause', target: 'reviews', starts_on: add(today, -1), ends_on: sundayOf(today) },
  ]
  return { topics, tests, mistakes, programmes, rules }
}

const SUBJECTS = [{ id: 's-maths', name: 'Maths' }, { id: 's-fm', name: 'Further Maths' }, { id: 's-phys', name: 'Physics' }]

/** The pure code's view of the fixture (TrackerData), with made-up ids. */
export function world(today) {
  const s = spec(today)
  const sid = (name) => SUBJECTS.find((x) => x.name === name).id
  const topics = s.topics.map((t, i) => ({
    id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, subjectId: sid(t.subject), subject: t.subject, code: t.code, name: t.name, strand: t.strand,
    teacher: null, halfTerm: null, taughtFrom: t.taught_from, taught: t.taught, status: t.status, step: t.step, bicen: t.bicen ?? null, integralUrl: null,
    freshPct: null, lastDone: t.last_done, weakNotes: null, concepts: null, booklet: t.booklet, pmt: t.pmt, pmtRef: null, bookRef: null, order: i,
  }))
  const tests = s.tests.map((t, i) => ({
    id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, title: t.title, date: t.date, kind: t.test_kind, subjectId: sid(t.subject), subject: t.subject,
    info: t.info ?? null, topicCodes: t.topic_codes, minutesPerDay: t.minutes_per_day ?? null, minutesMax: t.minutes_max ?? null, limits: t.limits ?? null,
    lengthMin: t.length_min ?? null, marks: t.marks ?? null, attempts: [],
  }))
  const mistakes = s.mistakes.map((m, i) => ({
    id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, goalId: null, topicId: topics.find((t) => t.code === m.code)?.id ?? null, subjectId: null,
    code: m.code, question: m.question, body: m.body, kind: m.kind, rule: null, source: null, loggedOn: m.logged_on, reviewOn: m.review_on, redoStage: m.redo_stage, reviewedAt: null,
  }))
  const programmes = s.programmes.map((p, i) => {
    const id = `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
    return { id, name: p.name, area: 'study', subjectId: null, perWeek: p.per_week, minutes: p.minutes, days: p.days, startsOn: null, endsOn: null, status: 'active', pausedUntil: null, mode: 'in_order', notes: null,
      items: p.items.map((it, k) => ({ id: `31000000-0000-4000-8000-${String(k + 1).padStart(12, '0')}`, programmeId: id, position: it.position, title: it.title, details: null, url: null, minutes: null, status: it.status, doneOn: it.done_on, result: null, score: null, outOf: null })) }
  })
  const rules = s.rules.map((r, i) => ({ id: `40000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, words: r.words, kind: r.kind, target: r.target, minutes: r.minutes ?? null, startsOn: r.starts_on, endsOn: r.ends_on }))
  const links = { bicenPure: '', bicenStats: '', bicenMech: '', bicenCorePure: '', bicenMemorise: '', bicenSummaries: '', bicenHardest: '', integralFurther: '', integralAssessments: '', madas: '', step: '', pmtPhysics: '', isaac: '', amsp: '' }
  return { today, sqlMissing: false, subjects: SUBJECTS, topics, tests, mistakes, programmes, rules, links }
}

/** A check() env for the pure tests: his words are `said`. */
export const env = (today, said = '', ref) => ({ today, said, grounded: (w) => { const n = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); return n(w).length >= 3 && n(said).includes(n(w)) }, ref, others: [] })

/** The fixture in the TEST database, as the owner. Returns ids by code / title / name. */
export async function seed(chat) {
  const today = chat.time.todayISO()
  const s = spec(today)
  const subj = new Map((await chat.q(`select id, name from subjects where user_id = $1`, [chat.users.owner])).map((r) => [r.name, r.id]))
  const ids = { topics: {}, tests: {}, mistakes: {}, programmes: {}, items: {}, rules: [] }
  for (const [i, t] of s.topics.entries()) {
    const row = await chat.add('topics', { subject_id: subj.get(t.subject), name: t.name, sort_order: i, code: t.code, strand: t.strand, status: t.status, step: t.step,
      taught_from: t.taught_from, taught: t.taught, last_done: t.last_done, booklet: t.booklet, pmt: t.pmt, bicen: t.bicen ?? null })
    ids.topics[t.code] = row.id
  }
  for (const t of s.tests) {
    const row = await chat.add('goals', { title: t.title, kind: 'test', target_date: t.date, subject_id: subj.get(t.subject), test_kind: t.test_kind, topic_codes: t.topic_codes,
      marks: t.marks ?? null, length_min: t.length_min ?? null, info: t.info ?? null, limits: t.limits ?? null, minutes_per_day: t.minutes_per_day ?? null, minutes_max: t.minutes_max ?? null, source: 'sheet' })
    ids.tests[t.title] = row.id
  }
  for (const m of s.mistakes) {
    const row = await chat.add('mistakes', { topic_id: ids.topics[m.code], code: m.code, question: m.question, body: m.body, kind: m.kind, logged_on: m.logged_on, review_on: m.review_on, redo_stage: m.redo_stage })
    ids.mistakes[`${m.code} ${m.question}`] = row.id
  }
  for (const p of s.programmes) {
    const row = await chat.add('programmes', { name: p.name, per_week: p.per_week, days: p.days, minutes: p.minutes })
    ids.programmes[p.name] = row.id
    for (const it of p.items) ids.items[`${p.name} ${it.position}`] = (await chat.add('programme_items', { programme_id: row.id, position: it.position, title: it.title, status: it.status, done_on: it.done_on })).id
  }
  for (const r of s.rules) ids.rules.push((await chat.add('plan_rules', r)).id)
  return ids
}
