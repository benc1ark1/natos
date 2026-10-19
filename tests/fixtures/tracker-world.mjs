// A realistic study world for the planner's tests (plans/contracts.md §3): the real curriculum structure from the
// tracker spreadsheet — 60 Maths + Further Maths topics in the school order and 32 CAIE Physics subtopics,
// with codes, strands, half-terms, taught-from dates, textbook chapters, Bicen sections and PMT refs — plus the four
// real tests (FM HT2 12 Nov, FM HT1 consolidation due 2 Nov 30–60 min/day, Physics mechanics 10 Nov "no momentum",
// Physics waves 12 Nov). Curriculum data + made-up scores: the colours, dates done, mistakes, homework and links are
// made up; the test descriptions are real but non-identifying (no teacher names, no school name — the repo is public).
// Also a tiny simulator: `applyDone` does what ticking a pick does (its `done` hint), so a week can be played day by day.
import { addDays, isoDow } from '../../lib/time.ts'
import { afterRedo } from '../../lib/tracker/rules.ts'

/** Maths + FM, in school order: code, Maths/FM, strand, half-term, taught from, book · ch, topic, Bicen section. */
export const MATHS_ROWS = [
  ['Y1-01', 'Maths', 'Pure', 'HT1', '2026-09-01', 'Y1 red · 1', "Proof", "Bicen Pure → AS: Algebraic Methods (proof)"],
  ['Y1-04', 'Maths', 'Pure', 'HT1', '2026-09-01', 'Y1 red · 4', "Polynomials", "Bicen Pure → AS: Algebraic Methods"],
  ['Y1-02', 'Maths', 'Pure', 'HT1', '2026-09-01', 'Y1 red · 2', "Indices and surds", "Bicen Pure → AS: Algebraic Expressions"],
  ['Y1-03', 'Maths', 'Pure', 'HT1', '2026-09-01', 'Y1 red · 3', "Quadratic functions", "Bicen Pure → AS: Quadratics"],
  ['Y1-06', 'Maths', 'Pure', 'HT1', '2026-09-01', 'Y1 red · 6', "Coordinate geometry (incl. circles)", "Bicen Pure → AS: Straight Line Graphs + Circles"],
  ['PC1-01', 'FM', 'Further Pure', 'HT1', '2026-09-07', 'PC1 blue · 1', "Matrices", "Bicen Core Pure → CP1: Matrices"],
  ['Y1-05', 'Maths', 'Pure', 'HT1', '2026-09-07', 'Y1 red · 5', "Using graphs (intersections, discriminant, transformations, reciprocal/proportion, inequalities)", "Bicen Pure → AS: Graphs & Transformations + Simultaneous Eqns & Inequalities"],
  ['Y1-09', 'Maths', 'Pure', 'HT1', '2026-09-07', 'Y1 red · 9', "Binomial expansion", "Bicen Pure → AS: Binomial Expansion"],
  ['Y1-10', 'Maths', 'Pure', 'HT1', '2026-09-07', 'Y1 red · 10', "Trigonometric functions and equations", "Bicen Pure → AS: Trigonometry – Identities and Equations"],
  ['Y1-13', 'Maths', 'Pure', 'HT1', '2026-09-14', 'Y1 red · 13', "Differentiation", "Bicen Pure → AS: Differentiation"],
  ['PC1-03', 'FM', 'Further Pure', 'HT1', '2026-09-21', 'PC1 blue · 3', "Applications of matrices (invariant lines NOT through origin too)", "Bicen Core Pure → CP1: Linear Transformations"],
  ['Y1-11', 'Maths', 'Pure', 'HT1', '2026-09-21', 'Y1 red · 11', "Triangle geometry", "Bicen Pure → AS: Trigonometry – Sine and Cosine Rules"],
  ['Y1-12', 'Maths', 'Pure', 'HT1', '2026-09-21', 'Y1 red · 12', "Vectors", "Bicen Pure → AS: Vectors"],
  ['Y1-07', 'Maths', 'Pure', 'HT1', '2026-09-21', 'Y1 red · 7', "Logarithms", "Bicen Pure → AS: Exponentials and Logarithms"],
  ['Y1-14', 'Maths', 'Pure', 'HT1', '2026-09-28', 'Y1 red · 14', "Applications of differentiation", "Bicen Pure → AS: Differentiation"],
  ['Y2-07a', 'Maths', 'Pure', 'HT1', '2026-09-28', 'Y2 green · 7', "Radians – basics", "Bicen Pure → A2: Radians"],
  ['Y1-15', 'Maths', 'Pure', 'HT1', '2026-10-05', 'Y1 red · 15', "Integration", "Bicen Pure → AS: Integration"],
  ['PC1-02', 'FM', 'Further Pure', 'HT1', '2026-10-05', 'PC1 blue · 2', "Further vectors", "Bicen Core Pure → CP1: Vectors"],
  ['Y1-08', 'Maths', 'Pure', 'HT1', '2026-10-05', 'Y1 red · 8', "Exponential models", "Bicen Pure → AS: Exponentials and Logarithms"],
  ['Y1-19', 'Maths', 'Mechanics', 'HT1', '2026-10-05', 'Y1 red · 19', "Introduction to kinematics", "Bicen Mechanics → AS: Constant acceleration / kinematics graphs"],
  ['PC1-06', 'FM', 'Further Pure', 'HT2', '2026-11-02', 'PC1 blue · 6', "Mathematical induction", "Bicen Core Pure → CP1: Proof by Induction"],
  ['PC1-04', 'FM', 'Further Pure', 'HT2', '2026-11-02', 'PC1 blue · 4', "Complex numbers", "Bicen Core Pure → CP1: Complex Numbers + Argand Diagrams"],
  ['Y1-16', 'Maths', 'Statistics', 'HT2', '2026-11-02', 'Y1 red · 16', "Working with data", "Bicen Statistics → AS: Data collection / Location & spread / Representations"],
  ['Y1-20', 'Maths', 'Mechanics', 'HT2', '2026-11-02', 'Y1 red · 20', "Motion with constant acceleration", "Bicen Mechanics → AS: Constant acceleration (SUVAT)"],
  ['Y1-17', 'Maths', 'Statistics', 'HT2', '2026-11-09', 'Y1 red · 17', "Probability (incl. binomial)", "Bicen Statistics → AS: Probability + Statistical distributions"],
  ['Y1-21', 'Maths', 'Mechanics', 'HT2', '2026-11-09', 'Y1 red · 21', "Force and motion", "Bicen Mechanics → AS: Forces and motion"],
  ['Y2-01', 'Maths', 'Pure', 'HT2', '2026-11-16', 'Y2 green · 1', "Proof and mathematical communication", "Bicen Pure → A2: Algebraic methods (proof by contradiction)"],
  ['PC1-05', 'FM', 'Further Pure', 'HT2', '2026-11-16', 'PC1 blue · 5', "Roots of polynomials", "Bicen Core Pure → CP1: Roots of Polynomials"],
  ['Y1-18', 'Maths', 'Statistics', 'HT2', '2026-11-23', 'Y1 red · 18', "Statistical hypothesis testing", "Bicen Statistics → AS: Hypothesis testing"],
  ['Y2-04', 'Maths', 'Pure', 'HT2', '2026-11-23', 'Y2 green · 4', "Sequences and series", "Bicen Pure → A2: Sequences and series"],
  ['Y2-05', 'Maths', 'Pure', 'HT2', '2026-11-30', 'Y2 green · 5', "Rational functions and partial fractions", "Bicen Pure → A2: Algebraic methods (partial fractions)"],
  ['Y2-02', 'Maths', 'Pure', 'HT2', '2026-11-30', 'Y2 green · 2', "Functions", "Bicen Pure → A2: Functions and graphs"],
  ['Y1-22', 'Maths', 'Mechanics', 'HT2', '2026-11-30', 'Y1 red · 22', "Connected particles", "Bicen Mechanics → AS: Forces and motion (connected particles)"],
  ['Y2-06', 'Maths', 'Pure', 'HT3', '2027-01-04', 'Y2 green · 6', "General binomial expansion", "Bicen Pure → A2: Binomial expansion"],
  ['Y2-03', 'Maths', 'Pure', 'HT3', '2027-01-04', 'Y2 green · 3', "Further transformations of graphs (+ modulus)", "Bicen Pure → A2: Functions and graphs"],
  ['Y2-16', 'Maths', 'Statistics', 'HT3', '2027-01-04', 'Y2 green · 16', "Conditional probability", "Bicen Statistics → A2: Conditional probability"],
  ['Y2-21', 'Maths', 'Mechanics', 'HT3', '2027-01-04', 'Y2 green · 21', "Forces in context", "Bicen Mechanics → A2: Forces and friction / Applications of forces"],
  ['Y2-07', 'Maths', 'Pure', 'HT3', '2027-02-01', 'Y2 green · 7', "Radian measure", "Bicen Pure → A2: Radians"],
  ['Y2-09', 'Maths', 'Pure', 'HT3', '2027-02-01', 'Y2 green · 9', "Calculus of exponentials and trig functions", "Bicen Pure → A2: Differentiation + Integration"],
  ['Y2-17', 'Maths', 'Statistics', 'HT3', '2027-02-01', 'Y2 green · 17', "Normal distribution", "Bicen Statistics → A2: The Normal distribution"],
  ['Y2-19', 'Maths', 'Mechanics', 'HT3', '2027-02-01', 'Y2 green · 19', "Applications of vectors", "Bicen Mechanics → A2: Further kinematics"],
  ['Y2-08', 'Maths', 'Pure', 'HT4', '2027-02-22', 'Y2 green · 8', "Further trigonometry", "Bicen Pure → A2: Trigonometric functions + Trig and modelling"],
  ['Y2-10', 'Maths', 'Pure', 'HT4', '2027-02-22', 'Y2 green · 10', "Further differentiation", "Bicen Pure → A2: Differentiation + Parametric equations"],
  ['Y2-18', 'Maths', 'Statistics', 'HT4', '2027-02-22', 'Y2 green · 18', "Further hypothesis testing", "Bicen Statistics → A2: Regression, correlation & hypothesis testing"],
  ['Y2-20', 'Maths', 'Mechanics', 'HT4', '2027-02-22', 'Y2 green · 20', "Projectiles", "Bicen Mechanics → A2: Projectiles"],
  ['PC2-01', 'FM', 'Further Pure', 'HT4', '2027-03-08', 'PC2 blue · 1', "Series and induction", "Bicen Core Pure → CP1: Series + Proof by Induction"],
  ['Y2-11', 'Maths', 'Pure', 'HT4', '2027-03-08', 'Y2 green · 11', "Further integration techniques", "Bicen Pure → A2: Integration"],
  ['FS-02', 'FM', 'Further Stats', 'HT4', '2027-03-08', 'Further Stats · 2', "Discrete random variables", "Integral Further Stats"],
  ['Y2-22', 'Maths', 'Mechanics', 'HT4', '2027-03-08', 'Y2 green · 22', "Moments", "Bicen Mechanics → A2: Moments"],
  ['FMe-01', 'FM', 'Further Mech', 'HT4', '2027-03-22', 'Further Mech · 1', "Work, energy and power", "Integral Further Mechanics"],
  ['Y2-12', 'Maths', 'Pure', 'HT5', '2027-05-03', 'Y2 green · 12', "Further applications of calculus", "Bicen Pure → A2: Parametric equations + Integration"],
  ['Y2-13', 'Maths', 'Pure', 'HT5', '2027-05-03', 'Y2 green · 13', "Differential equations", "Bicen Pure → A2: Integration (differential equations)"],
  ['FS-01', 'FM', 'Further Stats', 'HT5', '2027-05-03', 'Further Stats · 1', "Permutations and combinations", "Integral Further Stats"],
  ['FMe-03', 'FM', 'Further Mech', 'HT5', '2027-05-03', 'Further Mech · 3', "Collisions", "Integral Further Mechanics"],
  ['FMe-04', 'FM', 'Further Mech', 'HT5', '2027-05-10', 'Further Mech · 4', "Circular motion 1", "Integral Further Mechanics"],
  ['PC2-02', 'FM', 'Further Pure', 'HT5', '2027-05-17', 'PC2 blue · 2', "Powers and roots of complex numbers", "Bicen Core Pure → CP2: Complex numbers"],
  ['Y2-14', 'Maths', 'Pure', 'HT5', '2027-05-17', 'Y2 green · 14', "Numerical solutions of equations", "Bicen Pure → A2: Numerical methods"],
  ['FS-03', 'FM', 'Further Stats', 'HT5', '2027-05-24', 'Further Stats · 3', "Poisson distribution", "Integral Further Stats"],
  ['Y2-15', 'Maths', 'Pure', 'HT6', '2027-06-07', 'Y2 green · 15', "Numerical integration", "Bicen Pure → A2: Integration (trapezium rule)"],
  ['FMe-02', 'FM', 'Further Mech', 'HT6', '2027-06-07', 'Further Mech · 2', "Dimensional analysis", "Integral Further Mechanics"],
]

/** Physics (CAIE 9702 AS, topics 1–11): code, topic, subtopic, taught?, PMT ref. Keep up + review; no learning ahead. */
export const PHYSICS_ROWS = [
  ['P1.1', "Physical quantities & units", "Physical quantities", 'yes', 'PMT topic 1'],
  ['P1.2', "Physical quantities & units", "SI units", 'yes', 'PMT topic 1'],
  ['P1.3', "Physical quantities & units", "Errors and uncertainties", 'yes', 'PMT topic 1'],
  ['P1.4', "Physical quantities & units", "Scalars and vectors", 'yes', 'PMT topic 1'],
  ['P2.1', "Kinematics", "Equations of motion", 'yes', 'PMT topic 2'],
  ['P3.1', "Dynamics", "Newton's laws of motion (momentum part later)", 'yes', 'PMT topic 3'],
  ['P3.2', "Dynamics", "Non-uniform motion", 'yes', 'PMT topic 3'],
  ['P3.3', "Dynamics", "Linear momentum and its conservation", 'not_yet', 'PMT topic 3'],
  ['P4.1', "Forces, density & pressure", "Turning effects of forces", 'not_yet', 'PMT topic 4'],
  ['P4.2', "Forces, density & pressure", "Equilibrium of forces", 'not_yet', 'PMT topic 4'],
  ['P4.3', "Forces, density & pressure", "Density and pressure", 'not_yet', 'PMT topic 4'],
  ['P5.1', "Work, energy & power", "Energy conservation", 'yes', 'PMT topic 5'],
  ['P5.2', "Work, energy & power", "Gravitational PE and kinetic energy", 'yes', 'PMT topic 5'],
  ['P6.1', "Deformation of solids", "Stress and strain", 'not_yet', 'PMT topic 6'],
  ['P6.2', "Deformation of solids", "Elastic and plastic behaviour", 'not_yet', 'PMT topic 6'],
  ['P7.1', "Waves", "Progressive waves", 'in_class', 'PMT topic 7'],
  ['P7.2', "Waves", "Transverse and longitudinal waves", 'in_class', 'PMT topic 7'],
  ['P7.3', "Waves", "Doppler effect for sound waves", 'in_class', 'PMT topic 7'],
  ['P7.4', "Waves", "Electromagnetic spectrum", 'in_class', 'PMT topic 7'],
  ['P7.5', "Waves", "Polarisation", 'in_class', 'PMT topic 7'],
  ['P8.1', "Superposition", "Stationary waves", 'in_class', 'PMT topic 8'],
  ['P8.2', "Superposition", "Diffraction", 'not_yet', 'PMT topic 8'],
  ['P8.3', "Superposition", "Interference", 'not_yet', 'PMT topic 8'],
  ['P8.4', "Superposition", "The diffraction grating", 'not_yet', 'PMT topic 8'],
  ['P9.1', "Electricity", "Electric current", 'not_yet', 'PMT topic 9'],
  ['P9.2', "Electricity", "Potential difference and power", 'not_yet', 'PMT topic 9'],
  ['P9.3', "Electricity", "Resistance and resistivity", 'not_yet', 'PMT topic 9'],
  ['P10.1', "D.C. circuits", "Practical circuits", 'not_yet', 'PMT topic 10'],
  ['P10.2', "D.C. circuits", "Kirchhoff's laws", 'not_yet', 'PMT topic 10'],
  ['P10.3', "D.C. circuits", "Potential dividers", 'not_yet', 'PMT topic 10'],
  ['P11.1', "Particle physics", "Atoms, nuclei and radiation", 'not_yet', 'PMT topic 11'],
  ['P11.2', "Particle physics", "Fundamental particles", 'not_yet', 'PMT topic 11'],
]

export const SUBJECTS = { Maths: 'sub-maths', 'Further Maths': 'sub-fm', Physics: 'sub-physics' }

export const NO_LINKS = { bicenPure: '', bicenStats: '', bicenMech: '', bicenCorePure: '', bicenMemorise: '', bicenSummaries: '', bicenHardest: '', integralFurther: '', integralAssessments: '', madas: '', step: '', pmtPhysics: '', isaac: '', amsp: '' }
/** Some links pasted, some not yet (then the planner names the resource only). */
export const LINKS = { ...NO_LINKS, bicenPure: 'https://example.com/bicen-pure', bicenCorePure: 'https://example.com/bicen-core-pure', integralAssessments: 'https://example.com/integral-assessments', pmtPhysics: 'https://example.com/pmt-caie-physics', isaac: 'https://example.com/isaac' }

/** One topic row (all the tracker's fields). */
export function topic(o) {
  return {
    id: `t-${o.code}`, subjectId: SUBJECTS[o.subject], subject: o.subject, code: o.code, name: o.name, strand: null, teacher: null,
    halfTerm: null, taughtFrom: null, taught: null, status: 'not_started', step: 0, bicen: null, integralUrl: null, freshPct: null,
    lastDone: null, weakNotes: null, concepts: null, booklet: null, pmt: null, pmtRef: null, bookRef: null, order: 0, ...o,
  }
}

/** All 92 topics, ⚪, with the curriculum fields. */
export function curriculum() {
  const order = { Maths: 0, 'Further Maths': 0, Physics: 0 }
  const maths = MATHS_ROWS.map(([code, fm, strand, halfTerm, taughtFrom, bookRef, name, bicen]) => {
    const subject = fm === 'FM' ? 'Further Maths' : 'Maths'
    return topic({ code, subject, strand, halfTerm, taughtFrom, bookRef, name, bicen, order: order[subject]++ })
  })
  const physics = PHYSICS_ROWS.map(([code, strand, name, taught, pmtRef]) =>
    topic({ code, subject: 'Physics', strand, name, taught, pmtRef, booklet: 'todo', pmt: 'todo', order: order.Physics++ }))
  return [...maths, ...physics]
}

/** Made-up progress as of Mon 19 Oct 2026 (start of half-term). */
export const PROGRESS = {
  'Y1-01': { status: 'exam_ready', step: 5, freshPct: 90, lastDone: '2026-10-10' },
  'Y1-02': { status: 'exam_ready', step: 4, freshPct: 88, lastDone: '2026-10-12' },
  'Y1-03': { status: 'understand', step: 4, freshPct: 78, lastDone: '2026-10-14' },
  'Y1-04': { status: 'understand', step: 3, freshPct: 72, lastDone: '2026-10-17' },
  'Y1-05': { status: 'exam_ready', step: 5, freshPct: 86, lastDone: '2026-10-08' },
  'Y1-09': { status: 'understand', step: 4, freshPct: 70, lastDone: '2026-10-02' },
  'Y1-10': { status: 'not_secure', step: 2, freshPct: 50, lastDone: '2026-10-13' },
  'Y1-13': { status: 'understand', step: 3, freshPct: 75, lastDone: '2026-10-15' },
  'Y1-07': { status: 'not_secure', step: 2, freshPct: 55, lastDone: '2026-10-09' },
  'Y1-08': { status: 'not_secure', step: 1 },
  'Y1-15': { status: 'understand', step: 2, freshPct: 70, lastDone: '2026-10-18' },
  'PC1-01': { status: 'understand', step: 4, freshPct: 80, lastDone: '2026-10-16' },
  'PC1-03': { status: 'not_secure', step: 3, freshPct: 55, lastDone: '2026-10-17', weakNotes: 'invariant lines not through the origin' },
  'P1.1': { status: 'exam_ready', booklet: 'done', pmt: 'done', lastDone: '2026-10-06' },
  'P1.2': { status: 'exam_ready', booklet: 'done', pmt: 'done', lastDone: '2026-10-08' },
  'P1.3': { status: 'understand', booklet: 'done', pmt: 'doing', lastDone: '2026-10-15', concepts: 'combining percentage uncertainties' },
  'P1.4': { status: 'understand', booklet: 'done', pmt: 'todo', lastDone: '2026-10-12' },
  'P2.1': { status: 'understand', booklet: 'doing', lastDone: '2026-10-14' },
  'P3.1': { status: 'not_secure', booklet: 'todo', lastDone: '2026-10-16', concepts: "Newton's third law pairs" },
  'P5.1': { status: 'understand', booklet: 'done', lastDone: '2026-10-09' },
  'P7.1': { status: 'understand', lastDone: '2026-10-16' },
}

const HT2_INFO = [
  "50 min · ~45 marks · calculator. Booklets on Classroom ('HT2 Test Information').",
  'PC1-01: Booklet: Matrices and matrix transformations',
  'PC1-03: Same booklet – invariant lines NOT through the origin',
  'PC1-02: Booklet: AS Further Vectors',
  'Y1-08: Booklets: exponential models, log modelling',
  'Y1-13: Booklet: Differentiation',
  'Y1-14: Booklet: Differentiation – optimisation',
].join('\n')

export function test(o) {
  return { id: o.id, title: o.title, date: null, kind: 'test', subjectId: null, subject: null, info: null, topicCodes: [], minutesPerDay: null, minutesMax: null, limits: null, lengthMin: null, marks: null, attempts: [], ...o }
}

/** The four real tests. */
export function realTests() {
  return [
    test({ id: 'g-ht2', title: 'FM HT2 test', date: '2026-11-12', subject: 'Further Maths', subjectId: SUBJECTS['Further Maths'], info: HT2_INFO,
      topicCodes: ['PC1-01', 'PC1-03', 'PC1-02', 'Y1-08', 'Y1-13', 'Y1-14'], lengthMin: 50, marks: 45 }),
    test({ id: 'g-ht1', title: 'FM HT1 Consolidation', date: '2026-11-02', kind: 'consolidation', subject: 'Further Maths', subjectId: SUBJECTS['Further Maths'],
      info: "The topics you lost marks on in the HT1 test. Consolidation booklets on Classroom ('HT1 Consolidation'), 30–60 min/day over half-term.",
      minutesPerDay: 30, minutesMax: 60, attempts: [{ id: 'a-ht1-real', goalId: 'g-ht1', doneOn: '2026-10-08', what: 'real', label: 'HT1 test', score: 31, outOf: 45 }] }),
    test({ id: 'g-mech', title: 'Physics mechanics test', date: '2026-11-10', subject: 'Physics', subjectId: SUBJECTS.Physics,
      info: 'On everything so far on the mechanics side + a measurements/uncertainties question. Learn all required equations. Do every exam question in the mechanics booklet.',
      topicCodes: ['P1.1', 'P1.2', 'P1.3', 'P1.4', 'P5.1', 'P5.2', 'P2.1', 'P3.1', 'P3.2'], limits: 'no momentum' }),
    test({ id: 'g-waves', title: 'Physics waves test', date: '2026-11-12', subject: 'Physics', subjectId: SUBJECTS.Physics,
      info: 'Waves so far + uncertainties. Some content still being taught over the next week or two.',
      topicCodes: ['P1.3', 'P7.1', 'P7.2', 'P7.3', 'P7.4', 'P7.5', 'P8.1'] }),
  ]
}

export function mistake(o) {
  return { id: o.id, goalId: null, topicId: o.code ? `t-${o.code}` : null, subjectId: null, code: null, question: null, body: 'went wrong', kind: null, rule: null, source: null,
    loggedOn: '2026-10-17', reviewOn: addDays(o.loggedOn ?? '2026-10-17', 3), redoStage: 0, reviewedAt: null, ...o }
}

export function realMistakes() {
  return [
    mistake({ id: 'm-1', code: 'PC1-03', question: 'Q3b', body: 'Assumed the invariant line goes through the origin', kind: 'knowledge', rule: 'Use y = mx + c unless told it passes through O', source: 'Bicen CP1 Linear Transformations', loggedOn: '2026-10-17', reviewOn: '2026-10-20' }),
    mistake({ id: 'm-2', code: 'P3.1', question: 'Q4', body: 'Free-body diagram: missed the normal reaction', kind: 'knowledge', source: 'PMT topic 3', loggedOn: '2026-10-16', reviewOn: '2026-10-19' }),
    mistake({ id: 'm-ht1-1', goalId: 'g-ht1', code: 'PC1-01', question: 'Q2b', body: 'Multiplied the matrices in the wrong order', kind: 'method', loggedOn: '2026-10-09', reviewOn: '2026-10-19', redoStage: 1 }),
    mistake({ id: 'm-ht1-2', goalId: 'g-ht1', code: 'PC1-03', question: 'Q5', body: 'Only found invariant lines through the origin', kind: 'knowledge', loggedOn: '2026-10-09', reviewOn: '2026-10-21' }),
    mistake({ id: 'm-ht1-3', goalId: 'g-ht1', code: 'Y1-10', question: 'Q6', body: 'Lost a solution in the interval', kind: 'method', loggedOn: '2026-10-09', reviewOn: '2026-10-22' }),
  ]
}

export function programme(o) {
  return { id: o.id, name: o.name, area: 'study', subjectId: null, perWeek: 1, minutes: 60, days: null, startsOn: null, endsOn: null, status: 'active', pausedUntil: null, mode: 'in_order', notes: null, items: [], ...o }
}
export function item(programmeId, position, o = {}) {
  return { id: `${programmeId}-${position}`, programmeId, position, title: `Item ${position}`, details: null, url: null, minutes: null, status: 'todo', doneOn: null, result: null, score: null, outOf: null, ...o }
}

/** STEP Support Foundation: 25 assignments + 3 mixed STEP 1 sets, 1 a week at the weekend; 1–2 done. */
export function stepProgramme(o = {}) {
  const titles = [...Array.from({ length: 25 }, (_, i) => `STEP Support – Assignment ${i + 1}`), 'Mixed Pure STEP 1 questions', 'Mixed Mechanics STEP 1 questions', 'Mixed Statistics STEP 1 questions']
  return programme({ id: 'p-step', name: 'STEP', subjectId: SUBJECTS.Maths, perWeek: 1, minutes: 75, days: 'weekend',
    notes: "Attempt properly first (30+ min, no hints) → the module's hints → then the solution",
    items: titles.map((title, i) => item('p-step', i + 1, i < 2 ? { title, status: 'done', doneOn: i === 0 ? '2026-10-10' : '2026-10-17' } : { title })), ...o })
}

export function rule(o) {
  return { id: o.id ?? `r-${o.kind}-${o.target}`, words: o.words ?? `${o.kind} ${o.target}`, kind: o.kind, target: o.target, minutes: o.minutes ?? null, startsOn: o.startsOn ?? '2026-10-19', endsOn: o.endsOn ?? '2026-10-25' }
}

export function homework(o) {
  return { id: o.id, title: o.title ?? 'Worksheet', subjectId: o.subject ? SUBJECTS[o.subject] ?? null : null, subject: o.subject ?? null, dueAt: o.dueAt ?? null, minutes: o.minutes ?? null }
}

/** The whole world as of `today` (default Mon 19 Oct 2026, half-term). */
export function realWorld(o = {}) {
  const topics = curriculum().map((t) => (PROGRESS[t.code] ? { ...t, ...PROGRESS[t.code] } : t))
  return {
    today: '2026-10-19', topics, tests: realTests(), mistakes: realMistakes(), programmes: [stepProgramme()], rules: [],
    homework: [homework({ id: 'h-kin', title: 'Kinematics worksheet', subject: 'Physics', dueAt: '2026-10-21T12:00:00Z', minutes: 40 })],
    links: LINKS, reviewDays: { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 }, doneToday: [], ...o,
  }
}

/** An empty world (for focused rule tests). */
export function emptyWorld(o = {}) {
  return { today: '2026-10-19', topics: [], tests: [], mistakes: [], programmes: [], rules: [], homework: [], links: NO_LINKS,
    reviewDays: { not_secure: 1, understand: 3, exam_ready: 14, not_started: 7 }, doneToday: [], ...o }
}

export const dayOf = (date, mode, studyMinutes) => ({ date, dow: isoDow(date), mode, studyMinutes })

// ---------------------------------------------------------------------------
// The simulator: what ticking a pick does (lib/plan-items.ts DoneHint), so a week can be played day by day.
// Colours move the simple, realistic way: a diagnostic colours each ⚪ test topic (🟡 / 🔴 alternately), fixing or
// reviewing a 🔴 makes it 🟡, an ahead session reaches 🟡 (move on), a timed practice logs one mistake.
// ---------------------------------------------------------------------------

export function applyDone(world, pick, date) {
  const h = pick.done
  const topicById = (id) => world.topics.find((t) => t.id === id)
  if (h.kind === 'task') world.homework = world.homework.filter((x) => x.id !== h.taskId)
  if (h.kind === 'topic') {
    const t = topicById(h.topicId)
    if (t) {
      t.lastDone = date
      if (h.step != null) t.step = Math.max(t.step, h.step)
      if (h.physics === 'booklet') t.booklet = 'done'
      if (h.physics === 'pmt') t.pmt = 'done'
      if ((pick.kind === 'fix' || pick.kind === 'test_topic' || pick.kind === 'review') && t.status === 'not_secure') t.status = 'understand'
      if (pick.kind === 'ahead' && (t.status === 'not_started' || t.status === 'not_secure')) t.status = 'understand'
    }
  }
  if (h.kind === 'mistakes') {
    for (const id of h.mistakeIds) {
      const m = world.mistakes.find((x) => x.id === id)
      if (!m) continue
      const next = afterRedo(m.redoStage, date)
      m.redoStage = next.stage
      m.reviewOn = next.reviewOn ?? m.reviewOn
      m.reviewedAt = date
    }
    world.mistakes = world.mistakes.filter((m) => m.redoStage < 2)
  }
  if (h.kind === 'attempt') {
    const g = world.tests.find((x) => x.id === h.goalId)
    if (g) {
      g.attempts = [...g.attempts, { id: `a-${g.id}-${h.what}-${date}-${h.label ?? ''}`, goalId: g.id, doneOn: date, what: h.what, label: h.label ?? null, score: null, outOf: null }]
      if (h.what === 'diagnostic') {
        g.topicCodes.forEach((code, i) => {
          const t = world.topics.find((x) => x.code === code)
          if (t && t.status === 'not_started') { t.status = i % 2 ? 'not_secure' : 'understand'; t.lastDone = date }
        })
      }
      if (h.what === 'timed') {
        const code = g.topicCodes[0]
        world.mistakes = [...world.mistakes, mistake({ id: `m-${g.id}-timed-${date}`, goalId: g.id, code, question: 'Q1', body: 'timed practice slip', loggedOn: date, reviewOn: addDays(date, 3) })]
      }
    }
  }
  if (h.kind === 'programme_item') {
    for (const p of world.programmes) {
      const it = p.items.find((i) => i.id === h.itemId)
      if (it) { it.status = 'done'; it.doneOn = date }
    }
  }
}

/** Plays the days: plan each day (`planFor(world, day)`), tick every pick, move on. Returns [{ day, plan }]. */
export function simulate(world, days, planFor) {
  const out = []
  for (const day of days) {
    world.today = day.date
    world.doneToday = []
    const plan = planFor(world, day)
    out.push({ day, plan, snapshot: JSON.parse(JSON.stringify(world)) })
    for (const p of plan.picks) applyDone(world, p, day.date)
  }
  return out
}
