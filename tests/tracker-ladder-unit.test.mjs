// The resource ladders and playbooks (plans/contracts.md §3.4 "Ladder"), plain tests (no database): the exact thing to
// open at each maths pipeline step (textbook → exercise → mixed → Bicen section → Integral → stretch on 🟢), Integral
// Further for Further Stats / Mech, links from settings or the name only, the physics ladder (booklet → PMT → concepts
// → retrieval), the 90-min ahead session split and its scaling, the fix-a-🔴 steps.
// Run: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/tracker-ladder-unit.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextResource, examResource, physicsResource, stretchResource, aheadSteps, fixSteps, scaleMinutes, scaleSteps, reviewText, fixingResource, isMaths, isPhysics, furtherApplied, shortName, topicLabel, textbookRef, AHEAD_SPLIT } from '../lib/tracker/ladder.ts'
import { topic, LINKS, NO_LINKS } from './fixtures/tracker-world.mjs'

const matrices = topic({ code: 'PC1-01', subject: 'Further Maths', strand: 'Further Pure', name: 'Matrices', bookRef: 'PC1 blue · 1', bicen: 'Bicen Core Pure → CP1: Matrices' })
const logs = topic({ code: 'Y1-07', subject: 'Maths', strand: 'Pure', name: 'Logarithms', bookRef: 'Y1 red · 7', bicen: 'Bicen Pure → AS: Exponentials and Logarithms' })
const drv = topic({ code: 'FS-02', subject: 'Further Maths', strand: 'Further Stats', name: 'Discrete random variables', bookRef: 'Further Stats · 2', bicen: 'Integral Further Stats' })
const wep = topic({ code: 'FMe-01', subject: 'Further Maths', strand: 'Further Mech', name: 'Work, energy and power', bookRef: 'Further Mech · 1', bicen: 'Integral Further Mechanics' })
const suvat = topic({ code: 'P2.1', subject: 'Physics', strand: 'Kinematics', name: 'Equations of motion', pmtRef: 'PMT topic 2', booklet: 'todo', pmt: 'todo' })

test('maths ladder, step by step: textbook → exercise → mixed → Bicen section → Integral', () => {
  const at = (step) => nextResource({ ...logs, step }, LINKS)
  assert.equal(at(0).what, 'textbook')
  assert.match(at(0).open, /^Textbook Y1 red · 7 \(Logarithms\): read the section \+ do the worked examples yourself \(only if it doesn't click → Bicen video\)$/)
  assert.equal(at(0).reaches, 1)
  assert.equal(at(1).what, 'exercise')
  assert.match(at(1).open, /exercise, every 2nd question/)
  assert.equal(at(1).reaches, 2)
  assert.equal(at(2).what, 'mixed')
  assert.match(at(2).open, /MIXED exercise \+ the red\/blue problem-solving questions \(answers: Cambridge GO worked solutions\)/)
  assert.equal(at(2).reaches, 3)
  assert.equal(at(3).what, 'bicen')
  assert.match(at(3).open, /^Bicen Pure → AS: Exponentials and Logarithms: one 30–45 min set, mark straight after/)
  assert.equal(at(3).url, 'https://example.com/bicen-pure')
  assert.equal(at(3).reaches, 4)
  assert.equal(at(4).what, 'integral')
  assert.match(at(4).open, /Integral topic assessment: Logarithms – timed, closed book \(≥ 85 % = 🟢\)/)
  assert.equal(at(4).url, 'https://example.com/integral-assessments', 'the assessments folder from settings')
  assert.equal(at(4).reaches, undefined, 'the Integral only moves the step with ≥ 85 % (a score)')
})

test('FM learning help is AMSP; a topic\'s own Integral link wins over the folder', () => {
  assert.match(nextResource({ ...matrices, step: 0 }, LINKS).open, /AMSP video \(OCR A\)/)
  assert.equal(nextResource({ ...matrices, step: 4, integralUrl: 'https://example.com/integral/matrices' }, LINKS).url, 'https://example.com/integral/matrices')
})

test('Further Stats / Further Mech use Integral Further, not Bicen', () => {
  assert.equal(furtherApplied(drv), 'Statistics')
  assert.equal(furtherApplied(wep), 'Mechanics')
  assert.equal(furtherApplied(matrices), null)
  assert.equal(examResource(drv, LINKS).name, 'Integral Further Statistics: Discrete random variables')
  assert.equal(examResource(wep, LINKS).name, 'Integral Further Mechanics: Work, energy and power')
  assert.match(nextResource({ ...wep, step: 3 }, LINKS).open, /^Integral Further Mechanics: Work, energy and power: one 30–45 min set/)
  assert.equal(furtherApplied({ strand: null, code: 'FMe-03' }), 'Mechanics', 'from the code when the strand is missing')
})

test('links not pasted yet → the name only (no url)', () => {
  assert.equal(nextResource({ ...logs, step: 3 }, NO_LINKS).url, null)
  assert.match(nextResource({ ...logs, step: 3 }, NO_LINKS).open, /Bicen Pure → AS: Exponentials and Logarithms/)
  assert.equal(examResource({ ...logs, bicen: null }, NO_LINKS).name, 'Bicen Pure: Logarithms', 'no section typed → the bank + topic')
  assert.equal(examResource({ ...matrices, bicen: null }, NO_LINKS).name, 'Bicen Core Pure: Matrices')
})

test('stretch only on 🟢: Bicen 9 Hardest → MadAs (Further Stats / Mech: MadAs); not 🟢 at step 5 → exam questions again', () => {
  const green = { ...logs, step: 5, status: 'exam_ready' }
  assert.equal(nextResource(green, LINKS).what, 'stretch')
  assert.match(nextResource(green, LINKS).open, /^Bicen 9 Hardest Questions: Pure → AS: Exponentials and Logarithms$/)
  assert.match(stretchResource({ ...green, step: 6 }, LINKS).open, /^MadAs: Logarithms/)
  assert.match(stretchResource({ ...drv, step: 5, status: 'exam_ready' }, LINKS).open, /^MadAs:/)
  const dropped = { ...logs, step: 5, status: 'understand' }
  assert.equal(nextResource(dropped, LINKS).what, 'bicen')
})

test('physics ladder: school booklet → PMT CAIE topic questions → concepts I don\'t get → retrieval', () => {
  assert.equal(physicsResource(suvat, LINKS).what, 'booklet')
  assert.equal(physicsResource(suvat, LINKS).physics, 'booklet')
  assert.match(physicsResource(suvat, LINKS).open, /^School booklet: Kinematics → Equations of motion/)
  const b = { ...suvat, booklet: 'done' }
  assert.equal(physicsResource(b, LINKS).what, 'pmt')
  assert.equal(physicsResource(b, LINKS).physics, 'pmt')
  assert.equal(physicsResource(b, LINKS).open, 'PMT CAIE topic questions: PMT topic 2 → Equations of motion')
  assert.equal(physicsResource(b, LINKS).url, 'https://example.com/pmt-caie-physics')
  const c = { ...b, pmt: 'done', concepts: 'suvat sign conventions' }
  assert.equal(physicsResource(c, LINKS).what, 'concepts')
  assert.match(physicsResource(c, LINKS).open, /suvat sign conventions.*explain it out loud in 3 sentences → Isaac Physics/)
  assert.equal(physicsResource(c, LINKS).url, 'https://example.com/isaac')
  assert.equal(physicsResource({ ...c, concepts: null }, LINKS).what, 'retrieval')
  assert.equal(nextResource(suvat, LINKS).what, 'booklet', 'nextResource routes physics to its own ladder')
})

test('ahead session: 10 prerequisite · 25 textbook · 25 textbook Qs · 20 fresh exam Qs · 10 mark + colour; scaled, sums exact', () => {
  assert.deepEqual(AHEAD_SPLIT, [10, 25, 25, 20, 10])
  const prereq = topic({ code: 'Y1-02', subject: 'Maths', name: 'Indices and surds' })
  const s = aheadSteps(logs, prereq, LINKS)
  assert.deepEqual(s.map((x) => x.minutes), [10, 25, 25, 20, 10])
  assert.match(s[0].what, /prerequisite: Y1-02 Indices and surds/)
  assert.match(s[1].what, /Textbook Y1 red · 7/)
  assert.match(s[3].what, /fresh exam questions: Bicen Pure → AS: Exponentials and Logarithms/)
  assert.match(s[4].what, /🟡 ≈ 75 %\? move on/)
  for (const m of [45, 50, 60, 67, 75, 89]) {
    const x = aheadSteps(logs, null, LINKS, m)
    assert.equal(x.reduce((a, b) => a + b.minutes, 0), m, `sum for ${m}`)
    assert.ok(x.every((y) => Number.isInteger(y.minutes) && y.minutes > 0))
  }
  assert.deepEqual(aheadSteps(logs, null, LINKS, 45).map((x) => x.minutes), [5, 13, 12, 10, 5])
})

test('fix a 🔴: 10 re-learn → 5 textbook Qs → Bicen exam Qs (physics: PMT notes / video → explain → Isaac)', () => {
  const s = fixSteps(logs, LINKS, 45)
  assert.deepEqual(s.map((x) => x.minutes), [10, 10, 25])
  assert.match(s[0].what, /re-learn: your notes \/ the Bicen chapter summary/)
  assert.match(s[1].what, /5 questions from Textbook Y1 red · 7/)
  assert.match(s[2].what, /≥ 80 % = 🟡/)
  const p = fixSteps({ ...suvat, concepts: 'sign conventions' }, LINKS, 40)
  assert.equal(p.reduce((a, b) => a + b.minutes, 0), 40)
  assert.match(p[0].what, /PMT notes \/ one video on sign conventions/)
  assert.match(p[1].what, /explain it out loud in 3 sentences/)
  assert.match(p[2].what, /Isaac Physics/)
})

test('review text: 3–4 Bicen questions + redo its mistakes; a 🔴 is re-learnt first; physics = retrieval', () => {
  assert.match(reviewText({ ...logs, status: 'understand' }, LINKS, 2), /^3–4 questions from Bicen Pure → AS: Exponentials and Logarithms \+ redo its 2 mistakes · clean → colour up, wrong → colour down$/)
  assert.match(reviewText({ ...logs, status: 'not_secure' }, LINKS), /^re-learn: notes \/ Bicen chapter summary \(5 min\) → 3–4 questions/)
  assert.match(reviewText({ ...suvat, status: 'understand' }, LINKS), /^Retrieval: 3–4 PMT CAIE questions on Equations of motion \(PMT topic 2\) from memory/)
})

test('fixing a 🟡: exam questions + its mistakes (physics: PMT, then Isaac)', () => {
  assert.equal(fixingResource({ ...logs, status: 'understand' }, LINKS).what, 'bicen')
  assert.equal(fixingResource({ ...suvat, booklet: 'done', status: 'understand' }, LINKS).what, 'pmt')
  assert.match(fixingResource({ ...suvat, booklet: 'done', pmt: 'done', status: 'understand' }, LINKS).open, /^Isaac Physics: questions on Equations of motion/)
})

test('small helpers: subjects, names, minutes split', () => {
  assert.ok(isMaths('Maths') && isMaths('Further Maths') && isMaths('FM') && !isMaths('Physics') && !isMaths('ACT'))
  assert.ok(isPhysics('physics') && !isPhysics('Maths'))
  assert.equal(shortName({ name: 'Applications of matrices (invariant lines NOT through origin too)' }), 'Applications of matrices')
  assert.equal(topicLabel(matrices), 'PC1-01 Matrices')
  assert.equal(textbookRef({ bookRef: null, name: 'Proof' }), 'Textbook: Proof')
  assert.deepEqual(scaleMinutes([10, 25, 25, 20, 10], 90), [10, 25, 25, 20, 10])
  assert.equal(scaleMinutes([1, 1, 1], 10).reduce((a, b) => a + b, 0), 10)
  assert.deepEqual(scaleMinutes([1, 2], 0), [0, 0])
  assert.deepEqual(scaleSteps([{ minutes: 50, what: 'a' }, { minutes: 1, what: 'b' }], 20), [{ minutes: 20, what: 'a' }], 'a step scaled to 0 minutes is dropped')
})
