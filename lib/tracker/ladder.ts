// The resource ladders (plans/contracts.md §3.4 "Ladder", the "Start here" pipeline): for any topic, the exact thing to
// open next. Maths: textbook → exercise → mixed exercise + red/blue Qs → Bicen exam Qs (Further Stats / Further Mech:
// Integral Further instead) → Integral topic assessment (≥ 85 % = 🟢) → stretch on 🟢 (Bicen 9 Hardest → MadAs → STEP).
// Physics (keep up, never ahead): school booklet → PMT CAIE topic Qs → "Concepts I don't get" → retrieval reviews.
// Also the playbooks the planner hands out (fix a 🔴, review, keep fresh, the 90-min ahead session).
// Links come from settings (TrackerLinks); empty until he pastes them — then the name only. Pure: no database, no clock.
import type { TrackerLinks, TrackerTopic } from './types'

export type Step = { minutes: number; what: string }

/** The next thing to open for a topic. */
export type Resource = {
  what: 'textbook' | 'exercise' | 'mixed' | 'bicen' | 'integral' | 'stretch' | 'booklet' | 'pmt' | 'concepts' | 'retrieval'
  label: string                 // short, for titles: "exam questions"
  open: string                  // the exact thing to open
  url: string | null
  reaches?: number              // maths: the pipeline step a tick reaches (none for the Integral: that needs ≥ 85 %)
  physics?: 'booklet' | 'pmt'   // physics: what a tick marks done
}

type T = Pick<TrackerTopic, 'subject' | 'code' | 'name' | 'strand' | 'step' | 'status' | 'bicen' | 'integralUrl' | 'bookRef' | 'booklet' | 'pmt' | 'pmtRef' | 'concepts'>

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
/** Escapes text for use inside a RegExp (topic codes like "P1.3", "Y2-07a"). */
export const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')
/** A pasted link, or null (empty / not a web link → the name only). */
export const linkOf = (s: string | null | undefined) => (s && /^https?:\/\//i.test(s.trim()) ? s.trim() : null)

export const isPhysics = (subject: string | null | undefined) => norm(subject) === 'physics'
export const isFurther = (subject: string | null | undefined) => /^(further maths|further mathematics|fm)$/.test(norm(subject))
/** Maths + Further Maths (getting ahead and stretch are maths only). */
export const isMaths = (subject: string | null | undefined) => /^(maths|math|mathematics)$/.test(norm(subject)) || isFurther(subject)

/** "Applications of matrices (invariant lines NOT through origin too)" → "Applications of matrices". */
export const shortName = (t: Pick<TrackerTopic, 'name'>) => t.name.replace(/\s*\(.*\)\s*$/, '').trim() || t.name
/** "PC1-01 Matrices" */
export const topicLabel = (t: Pick<TrackerTopic, 'code' | 'name'>) => (t.code ? `${t.code} ${shortName(t)}` : shortName(t))

/** Further Stats / Further Mech use Integral Further instead of Bicen. */
export function furtherApplied(t: Pick<TrackerTopic, 'strand' | 'code'>): 'Statistics' | 'Mechanics' | null {
  const s = norm(t.strand), c = norm(t.code)
  if (/further stat/.test(s) || /^fs-/.test(c)) return 'Statistics'
  if (/further mech/.test(s) || /^fme-/.test(c)) return 'Mechanics'
  return null
}

/** Which Bicen bank a topic's exam questions are in. */
export function bicenBank(t: Pick<TrackerTopic, 'strand' | 'subject'>): 'Pure' | 'Statistics' | 'Mechanics' | 'Core Pure' {
  const s = norm(t.strand)
  if (/further pure|core pure/.test(s) || (!s && isFurther(t.subject))) return 'Core Pure'
  if (/stat/.test(s)) return 'Statistics'
  if (/mech/.test(s)) return 'Mechanics'
  return 'Pure'
}

/** The exam-question resource: its Bicen section (as on the Maths+FM tab), or Integral Further for Further Stats / Mech. */
export function examResource(t: T, links: TrackerLinks): { name: string; url: string | null } {
  const fa = furtherApplied(t)
  if (fa) return { name: `Integral Further ${fa}: ${shortName(t)}`, url: linkOf(links.integralFurther) }
  const bank = bicenBank(t)
  const url = linkOf(bank === 'Core Pure' ? links.bicenCorePure : bank === 'Statistics' ? links.bicenStats : bank === 'Mechanics' ? links.bicenMech : links.bicenPure)
  return { name: t.bicen?.trim() || `Bicen ${bank}: ${shortName(t)}`, url }
}

/** "Textbook Y1 red · 1 (Proof)" */
export const textbookRef = (t: Pick<TrackerTopic, 'bookRef' | 'name'>) => (t.bookRef ? `Textbook ${t.bookRef} (${shortName(t)})` : `Textbook: ${shortName(t)}`)

/** Integral topic assessment: his link for that topic, else the folder from settings. */
export const integralUrl = (t: T, links: TrackerLinks) => linkOf(t.integralUrl) ?? linkOf(furtherApplied(t) ? links.integralFurther : links.integralAssessments)

/** Stretch on a 🟢 topic: Bicen 9 Hardest → MadAs (then STEP, its own programme). Further Stats / Mech: MadAs. */
export function stretchResource(t: T, links: TrackerLinks): Resource {
  if (t.step >= 6 || furtherApplied(t)) {
    return { what: 'stretch', label: 'stretch (MadAs)', open: `MadAs: ${shortName(t)} – the harder questions (5★ isn't needed for 🟢), then STEP`, url: linkOf(links.madas), reaches: 6 }
  }
  const sec = examResource(t, links).name.replace(/^Bicen\s+/i, '')
  return { what: 'stretch', label: 'stretch (Bicen hardest)', open: `Bicen 9 Hardest Questions: ${sec}`, url: linkOf(links.bicenHardest), reaches: 6 }
}

/** Physics ladder: booklet → PMT CAIE topic Qs → concepts I don't get → retrieval. */
export function physicsResource(t: T, links: TrackerLinks): Resource {
  const where = t.strand ? `${t.strand} → ${t.name}` : t.name
  if (t.booklet !== 'done') return { what: 'booklet', label: 'school booklet', open: `School booklet: ${where} (notes + explanations + questions)`, url: null, physics: 'booklet' }
  if (t.pmt !== 'done') return { what: 'pmt', label: 'PMT questions', open: `PMT CAIE topic questions: ${t.pmtRef ? `${t.pmtRef} → ` : ''}${t.name}`, url: linkOf(links.pmtPhysics), physics: 'pmt' }
  if (t.concepts?.trim()) return { what: 'concepts', label: 'concepts', open: conceptsText(t), url: linkOf(links.isaac) }
  return { what: 'retrieval', label: 'retrieval', open: retrievalText(t), url: linkOf(links.pmtPhysics) }
}

const conceptsText = (t: T) => `Concepts I don't get${t.concepts?.trim() ? ` (${t.concepts.trim()})` : ` – write down what you don't get in ${t.name}`}: PMT notes / one video → explain it out loud in 3 sentences → Isaac Physics`
const retrievalText = (t: T) => `Retrieval: 3–4 PMT CAIE questions on ${t.name}${t.pmtRef ? ` (${t.pmtRef})` : ''} from memory, no notes`

/** The topic's next ladder step (plans/contracts.md §3.4). */
export function nextResource(t: T, links: TrackerLinks): Resource {
  if (isPhysics(t.subject)) return physicsResource(t, links)
  const book = textbookRef(t)
  const stuck = isFurther(t.subject) ? 'AMSP video (OCR A)' : 'Bicen video'
  switch (Math.max(0, t.step)) {
    case 0: return { what: 'textbook', label: 'learn from the textbook', open: `${book}: read the section + do the worked examples yourself (only if it doesn't click → ${stuck})`, url: null, reaches: 1 }
    case 1: return { what: 'exercise', label: 'textbook exercise', open: `${book}: the exercise, every 2nd question → mark it (≥ 80 % right)`, url: null, reaches: 2 }
    case 2: return { what: 'mixed', label: 'mixed exercise', open: `${book}: the MIXED exercise + the red/blue problem-solving questions (answers: Cambridge GO worked solutions) → ≥ 80 %`, url: null, reaches: 3 }
    case 3: {
      const ex = examResource(t, links)
      return { what: 'bicen', label: 'exam questions', open: `${ex.name}: one 30–45 min set, mark straight after (two clean sets → the Integral)`, url: ex.url, reaches: 4 }
    }
    case 4: return { what: 'integral', label: 'Integral assessment', open: `Integral topic assessment: ${shortName(t)} – timed, closed book (≥ 85 % = 🟢)`, url: integralUrl(t, links) }
    default: {
      if (t.status === 'exam_ready') return stretchResource(t, links)
      const ex = examResource(t, links)
      return { what: 'bicen', label: 'exam questions', open: `${ex.name}: one 30–45 min set + redo its mistakes (≥ 85 % without notes = 🟢)`, url: ex.url, reaches: 4 }
    }
  }
}

// ---------------------------------------------------------------------------
// Playbooks ("Start here" §5)
// ---------------------------------------------------------------------------

/** Split `minutes` over `parts` in proportion (integers, the sum is exact: largest remainders get the spare minutes). */
export function scaleMinutes(parts: number[], minutes: number): number[] {
  const total = parts.reduce((a, b) => a + b, 0)
  if (!total || minutes <= 0) return parts.map(() => 0)
  const raw = parts.map((p) => (p * minutes) / total)
  const out = raw.map(Math.floor)
  let left = minutes - out.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, rest: r - Math.floor(r) })).sort((a, b) => b.rest - a.rest || a.i - b.i)
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++
  return out
}

/** The same steps, scaled to `minutes` (steps under a minute are dropped). */
export const scaleSteps = (steps: Step[], minutes: number): Step[] =>
  scaleMinutes(steps.map((s) => s.minutes), minutes).map((m, i) => ({ minutes: m, what: steps[i].what })).filter((s) => s.minutes > 0)

/** The ahead session (≈ 90 min): 10 prerequisite · 25 learn from the textbook · 25 textbook Qs · 20 fresh exam Qs · 10 mark + colour. */
export const AHEAD_SPLIT = [10, 25, 25, 20, 10]
export function aheadSteps(t: T, prereq: Pick<TrackerTopic, 'code' | 'name'> | null, links: TrackerLinks, minutes = 90): Step[] {
  const book = textbookRef(t)
  const ex = examResource(t, links)
  const what = [
    prereq ? `check the prerequisite: ${topicLabel(prereq)} (2 quick questions)` : `check the prerequisite (the chapter's "before you start")`,
    `learn: ${book} – read the section + do the worked examples`,
    `${book}: exercise, every 2nd question`,
    `fresh exam questions: ${ex.name}`,
    'mark + set its colour (🟡 ≈ 75 %? move on – class makes it 🟢)',
  ]
  return scaleSteps(AHEAD_SPLIT.map((m, i) => ({ minutes: m, what: what[i] })), minutes)
}

/** FIX A 🔴: 10 min re-learn → 5 textbook Qs → Bicen exam Qs → ≥ 80 % = 🟡 (physics: concepts → PMT notes / video → explain → Isaac). */
export function fixSteps(t: T, links: TrackerLinks, minutes: number): Step[] {
  if (isPhysics(t.subject)) {
    return scaleSteps([
      { minutes: 15, what: `PMT notes / one video on ${t.concepts?.trim() || t.name} (add it to "Concepts I don't get")` },
      { minutes: 5, what: 'explain it out loud in 3 sentences' },
      { minutes: 20, what: `Isaac Physics / PMT CAIE questions on ${t.name}` },
    ], minutes)
  }
  const ex = examResource(t, links)
  return scaleSteps([
    { minutes: 10, what: `re-learn: your notes / the Bicen chapter summary for ${shortName(t)}` },
    { minutes: 10, what: `5 questions from ${textbookRef(t)}` },
    { minutes: 25, what: `${ex.name} exam questions → ≥ 80 % = 🟡` },
  ], minutes)
}

/** REVIEW (due): 3–4 Bicen questions + redo its mistakes (physics: retrieval). */
export function reviewText(t: T, links: TrackerLinks, mistakes = 0): string {
  const redo = mistakes ? ` + redo its ${mistakes} mistake${mistakes > 1 ? 's' : ''}` : ' + redo its mistakes'
  // a 🔴 is re-learnt first ("🔴 → relearn + routine Qs + fresh Qs, review next day")
  const relearn = t.status === 'not_secure' ? (isPhysics(t.subject) ? `PMT notes${t.concepts?.trim() ? ` on ${t.concepts.trim()}` : ''} (5 min) → ` : `re-learn: notes / Bicen chapter summary (5 min) → `) : ''
  const verdict = t.status === 'not_secure' ? '≥ 80 % = 🟡, wrong → stays 🔴' : 'clean → colour up, wrong → colour down'
  if (isPhysics(t.subject)) return `${relearn}${retrievalText(t)}${redo} · ${verdict}`
  return `${relearn}3–4 questions from ${examResource(t, links).name}${redo} · ${verdict}`
}

/** Keeping an old topic fresh: a few mixed exam questions, no notes (physics: retrieval). */
export function freshText(t: T, links: TrackerLinks): string {
  if (isPhysics(t.subject)) return retrievalText(t)
  return `Mixed exam questions to keep it fresh: 2–3 from ${examResource(t, links).name}, no notes`
}

/** 🟡 → exam questions + fix its mistakes (physics: PMT questions, then retrieval / Isaac). */
export function fixingResource(t: T, links: TrackerLinks): Resource {
  if (isPhysics(t.subject)) {
    const r = physicsResource(t, links)
    if (r.what !== 'retrieval') return r
    return { what: 'concepts', label: 'Isaac Physics', open: `Isaac Physics: questions on ${t.name} + redo its mistakes (≥ 85 % without notes = 🟢)`, url: linkOf(links.isaac) }
  }
  const ex = examResource(t, links)
  return { what: 'bicen', label: 'exam questions', open: `${ex.name}: one 30–45 min set + redo its mistakes (≥ 85 % without notes = 🟢)`, url: ex.url, reaches: 4 }
}
