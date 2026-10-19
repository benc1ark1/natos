// What the study tracker bot shows (plans/contracts.md §3.7): /maths and /physics (topics by strand as colour chips, due
// reviews, next up), /tests (days left, tries, topics, mistakes to redo), /review (what's due today), /rules (temporary
// rules and when they end), /programmes (next item, this week x/y, status); the brain's snapshot lines; the one "Next: …"
// line after ✅; the "📌 Rules this week" line on the Your week card; "what next?" from the planner's top pick.
// Each list stays about one phone screen long. Telegram HTML; pure: no database, no clock.
import { daysBetween } from '../time'
import type { Pick as PlanPick } from '../plan-items'
import { doneThisWeek, leftThisWeek, nextStep, programmeLine } from './programmes'
import { fixSteps, nextResource as ladderNext, reviewText } from './ladder'
import { ruleNote } from './rulesets'
import { testPhase, testsInWindow, type Phase } from './testmode'
import { isDue, nextReview, taughtState } from './rules'
import type { NextHint } from './bot-ops'
import { day, dot, esc, isMathsTopic, label, ruleLabel, studyProgrammes, snapCodeless, snapMistakes, snapProgrammes, snapRules, snapTests } from './bot-ops'
import type { TrackerData } from './bot-data'
import type { PlanRule, Programme, TrackerLinks, TrackerMistake, TrackerTest, TrackerTopic } from './types'

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

// ---------------------------------------------------------------------------
// The resource ladder (lib/tracker/ladder.ts): exactly what to open next
// ---------------------------------------------------------------------------

/** Exactly what to open next for a topic: the ladder's next step; a 🔴 maths topic past the textbook is fixed first. */
export function nextResource(t: TrackerTopic, links: TrackerLinks): string {
  if (isMathsTopic(t) && t.status === 'not_secure' && t.step >= 2) return `fix it: ${fixSteps(t, links, 45).map((x) => x.what).join(' → ')}`
  const r = ladderNext(t, links)
  return `${r.open}${r.url ? ` ${r.url}` : ''}`
}

// ---------------------------------------------------------------------------
// /maths and /physics
// ---------------------------------------------------------------------------

const strandOf = (t: TrackerTopic) => t.strand ?? (t.bookRef ? t.bookRef.replace(/\s*·\s*\d+$/, '') : 'Topics')
const chips = (list: TrackerTopic[]) => list.map((t) => dot(t.status)).join('')
const dueList = (topics: TrackerTopic[], today: string) => topics.filter((t) => isDue(t, today))
  .sort((a, b) => (nextReview(a) ?? '').localeCompare(nextReview(b) ?? '') || (a.status === 'not_secure' ? -1 : 0) - (b.status === 'not_secure' ? -1 : 0))

/** The topic to work on next in this list: a due review (🔴 first), then 🔴 taught, then the first next-up one not 🟡/🟢. */
export function nextTopic(topics: TrackerTopic[], today: string): TrackerTopic | null {
  const due = dueList(topics, today)
  if (due.length) return [...due].sort((a, b) => (a.status === 'not_secure' ? 0 : 1) - (b.status === 'not_secure' ? 0 : 1))[0]
  const red = topics.filter((t) => t.status === 'not_secure' && taughtState(t, today) === 'taught')
  if (red.length) return red[0]
  // getting ahead is maths only (school order); physics keeps up with what's taught
  const up = topics.filter((t) => (isMathsTopic(t) ? taughtState(t, today) !== 'later' : taughtState(t, today) === 'taught') && (t.status === 'not_started' || t.status === 'not_secure'))
  return up[0] ?? null
}

function subjectView(d: TrackerData, subjects: string[], head: string, hint: string): string {
  const topics = d.topics.filter((t) => subjects.includes(t.subject)).sort((a, b) => subjects.indexOf(a.subject) - subjects.indexOf(b.subject) || a.order - b.order)
  if (!topics.length) return `${head}\nNo topics yet. Upload your tracker spreadsheet on the Subjects page, or say “add topics …”.`
  const green = topics.filter((t) => t.status === 'exam_ready').length
  const lines = [`${head} · ${green}/${topics.length} 🟢`]
  for (const s of subjects) {
    const list = topics.filter((t) => t.subject === s)
    if (!list.length) continue
    if (subjects.length > 1) lines.push(`<b>${esc(s)}</b>`)
    const strands = [...new Set(list.map(strandOf))]
    for (const st of strands) {
      const these = list.filter((t) => strandOf(t) === st)
      const taught = these.filter((t) => taughtState(t, d.today) === 'taught').length
      lines.push(`${esc(st)} ${chips(these)} <i>${these.filter((t) => t.status === 'exam_ready').length}/${these.length} 🟢${taught && taught < these.length ? ` · ${taught} taught` : ''}</i>`)
    }
  }
  const due = dueList(topics, d.today)
  if (due.length) lines.push('', `🔁 <b>Due</b>: ${due.slice(0, 3).map((t) => `${dot(t.status)} ${esc(label(t))}`).join(' · ')}${due.length > 3 ? ` <i>(+${due.length - 3}: /review)</i>` : ''}`)
  const upNext = topics.filter((t) => taughtState(t, d.today) === 'next_up').slice(0, 3)
  if (upNext.length) lines.push(`⏭ <b>Next up</b>: ${upNext.map((t) => `${esc(label(t))}${t.taughtFrom ? ` (${day(t.taughtFrom)})` : ''}`).join(' · ')}`)
  const tests = d.tests.filter((t) => t.date && t.date >= d.today && daysBetween(d.today, t.date) <= 21 && (!t.subject || subjects.includes(t.subject)))
  for (const t of tests.slice(0, 2)) {
    const tt = t.topicCodes.map((c) => topics.find((x) => x.code?.toUpperCase() === c.toUpperCase())).filter((x): x is TrackerTopic => !!x)
    lines.push(`🔥 <b>${esc(t.title)}</b> in ${plural(daysBetween(d.today, t.date!), 'day')}${tt.length ? `: ${tt.slice(0, 6).map((x) => `${dot(x.status)} ${esc(x.code!)}`).join(' ')}` : ''}`)
  }
  const n = nextTopic(topics, d.today)
  if (n) lines.push('', `👉 <b>Next</b>: ${esc(label(n))} → ${esc(nextResource(n, d.links))}`)
  lines.push(`<i>${hint}</i>`)
  return lines.join('\n')
}

export const mathsView = (d: TrackerData) => subjectView(d, ['Maths', 'Further Maths'].filter((s) => d.subjects.some((x) => x.name === s)), '📐 <b>Maths + Further Maths</b>',
  '“PC1-01 green” · “did Bicen matrices 8/10” · /review · /tests')
export const physicsView = (d: TrackerData) => {
  const base = subjectView(d, ['Physics'], '⚛️ <b>Physics</b>', '“kinematics booklet done” · “pmt waves 7/10” · /review · /tests')
  const ph = d.topics.filter((t) => t.subject === 'Physics')
  const concepts = ph.filter((t) => t.concepts).length
  const booklets = ph.filter((t) => taughtState(t, d.today) === 'taught')
  if (!booklets.length) return base
  const extra = `📘 Booklets ${booklets.filter((t) => t.booklet === 'done').length}/${booklets.length} · PMT ${booklets.filter((t) => t.pmt === 'done').length}/${booklets.length} (taught topics)${concepts ? ` · ${concepts} with concepts to fix` : ''}`
  const lines = base.split('\n')
  const at = lines.findIndex((l) => l === '')
  lines.splice(at < 0 ? lines.length - 1 : at, 0, extra)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// /tests, /review, /rules, /programmes
// ---------------------------------------------------------------------------

const attemptText = (t: TrackerTest) => t.attempts.slice(-3).map((a) => `${a.what === 'other' ? clip(a.label ?? 'try', 20) : a.what} ${a.score ?? '?'}/${a.outOf ?? '?'}${a.score !== null && a.outOf ? ` ${Math.round((a.score / a.outOf) * 100)}%` : ''}`).join(' · ')

/** Where a test within 3 weeks is (lib/tracker/testmode.ts testPhase), in words. */
const PHASE: Record<Phase, string> = {
  test_day: 'today: good luck – sleep well, eat, bring the formula booklet', light: 'light day: its mistakes + the formula booklet, then sleep',
  consolidation: 'the daily consolidation slot', timed: 'timed practice at the real length', diagnostic: 'diagnostic first: 1–2 fresh Qs a topic, no notes → colour each',
  booklet: 'the teacher booklet first', topics: 'topic work: 🔴 → 🟡 → ⚪, then exam questions',
}

export function testsView(d: TrackerData): string {
  const list = d.tests.filter((t) => t.date && t.date >= d.today).slice(0, 6)
  if (!list.length) return '📝 No tests coming up. Say “FM test on 12 Nov: matrices, vectors” to add one.'
  const windows = testsInWindow(d, d.today)
  const lines = ['📝 <b>Tests</b>']
  for (const t of list) {
    const left = daysBetween(d.today, t.date!)
    lines.push('', `<b>${esc(t.title)}</b> · ${day(t.date!)} · <b>${left === 0 ? 'today' : left === 1 ? 'tomorrow' : `${left} days`}</b>`)
    const w = windows.find((x) => x.test.id === t.id)
    if (w) lines.push(`  now: ${esc(PHASE[testPhase(w, d.today)])}`)
    lines.push(t.attempts.length ? `  tries: ${esc(attemptText(t))}` : w ? '  no tries yet' : '  no tries yet: it starts with a diagnostic 3 weeks before')
    const tt = t.topicCodes.map((c) => d.topics.find((x) => x.code?.toUpperCase() === c.toUpperCase())).filter((x): x is TrackerTopic => !!x)
    if (tt.length) lines.push(`  topics: ${tt.slice(0, 8).map((x) => `${dot(x.status)} ${esc(x.code!)}`).join(' · ')}${tt.length > 8 ? ` +${tt.length - 8}` : ''}`)
    const mk = d.mistakes.filter((m) => m.goalId === t.id || (m.code && t.topicCodes.some((c) => c.toUpperCase() === m.code!.toUpperCase())))
    const bits = [mk.length ? `${plural(mk.length, 'mistake')} to redo (next ${day(mk.map((m) => m.reviewOn).sort()[0])})` : '', t.limits ? esc(t.limits) : '',
      t.minutesPerDay ? `${t.minutesPerDay}${t.minutesMax ? `–${t.minutesMax}` : ''} min/day` : ''].filter(Boolean)
    if (bits.length) lines.push(`  ${bits.join(' · ')}`)
  }
  lines.push('', '<i>“HT2 practice 38/45” logs a try · “mistake: PC1-03 Q3b … – method”</i>')
  return lines.join('\n')
}

const mistakeName = (m: TrackerMistake) => [m.code, m.question].filter(Boolean).join(' ')

export function reviewView(d: TrackerData): string {
  const due = dueList(d.topics, d.today)
  const redo = d.mistakes.filter((m) => m.reviewOn <= d.today)
  if (!due.length && !redo.length) {
    const nextT = d.topics.map((t) => ({ t, r: nextReview(t) })).filter((x) => x.r).sort((a, b) => a.r!.localeCompare(b.r!))[0]
    const nextM = [...d.mistakes].sort((a, b) => a.reviewOn.localeCompare(b.reviewOn))[0]
    const soon = [nextT ? `${day(nextT.r!)} (${esc(label(nextT.t))})` : '', nextM ? `a mistake redo ${day(nextM.reviewOn)}` : ''].filter(Boolean)
    return `✅ Nothing due today.${soon.length ? ` Next: ${soon.join(' · ')}.` : ''}`
  }
  const lines = [`🔁 <b>Due today</b> (${day(d.today)})`]
  for (const t of due.slice(0, 6)) {
    const late = daysBetween(nextReview(t)!, d.today)
    const how = reviewText(t, d.links, d.mistakes.filter((m) => m.topicId === t.id).length)
    lines.push(`• ${dot(t.status)} <b>${esc(label(t))}</b>${late > 0 ? ` <i>(${plural(late, 'day')} late)</i>` : ''}: ${esc(how)}`)
  }
  if (due.length > 6) lines.push(`<i>+${due.length - 6} more (most overdue first; the plan takes 2 a day)</i>`)
  if (redo.length) {
    lines.push('', '🧠 <b>Mistakes to redo</b> (without looking)')
    for (const m of redo.slice(0, 6)) lines.push(`• ${mistakeName(m) ? `<b>${esc(mistakeName(m))}</b>: ` : ''}${esc(clip(m.body, 60))} <i>(redo ${m.redoStage + 1} of 2)</i>`)
    if (redo.length > 6) lines.push(`<i>+${redo.length - 6} more</i>`)
  }
  lines.push('', '<i>Done? “reviewed matrices 4/4” · “redid PC1-03 Q3b”</i>')
  return lines.join('\n')
}

export function rulesView(d: TrackerData): string {
  const live = d.rules.filter((r) => r.endsOn >= d.today).sort((a, b) => a.endsOn.localeCompare(b.endsOn))
  if (!live.length) return '📌 No temporary rules right now. Try “ACT top priority this week”, “pause getting ahead until 25 Oct” or “maths + physics 45 min/day this week”.'
  const lines = ['📌 <b>Rules</b>', ...live.map((r) => `• ${r.startsOn > d.today ? `from ${day(r.startsOn)}: ` : ''}${esc(ruleNote(r))}`)]
  lines.push('', '<i>They end by themselves. “end the ACT rule” ends one now.</i>')
  return lines.join('\n')
}

const STATUS = (p: Programme, today: string) => p.status === 'stopped' ? '⏹' : p.status === 'done' ? '✓'
  : (p.status === 'paused' && (!p.pausedUntil || p.pausedUntil >= today)) || (!!p.pausedUntil && p.pausedUntil >= today) ? '⏸' : '▶️'

export function programmesView(d: TrackerData): string {
  const list = studyProgrammes(d).filter((p) => p.status !== 'stopped' || p.items.some((i) => i.status === 'done'))
  if (!list.length) return '📚 No programmes yet. Say “new programme …” with its items, or import your tracker (STEP comes with it).'
  const lines = ['📚 <b>Programmes</b>']
  for (const p of list.slice(0, 8)) {
    // "1 a week · weekend · 3/28 done · next: …" (lib/tracker/programmes.ts programmeLine), with this week's count
    const n = nextStep(p)
    lines.push('', `${STATUS(p, d.today)} <b>${esc(p.name)}</b> · this week ${doneThisWeek(p, d.today)}/${p.perWeek}`, `  ${esc(programmeLine(p, d.today))}${n ? ` (#${n.item.position})` : ''}`)
  }
  lines.push('', '<i>“done STEP 3, with hints, idea: …” · “pause STEP until 1 Nov” · “STEP 2 a week”</i>')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// The brain's snapshot (compact: one line a record)
// ---------------------------------------------------------------------------

const TAUGHT_WORD = { taught: 'taught', next_up: 'next up', later: 'later' } as const
export function snapshotSections(d: TrackerData): { title: string; lines: string[] }[] {
  if (d.sqlMissing) return []
  const coded = d.topics.filter((t) => t.code)
  const codeless = snapCodeless(d)
  const topicLine = (t: TrackerTopic, ref: string) => {
    const r = nextReview(t)
    return `${ref} | ${t.name} | ${t.subject}${t.strand ? ` · ${t.strand}` : ''} | ${dot(t.status)}${isMathsTopic(t) ? ` step ${t.step}` : ` booklet ${t.booklet ?? 'todo'} · pmt ${t.pmt ?? 'todo'}`} | ${TAUGHT_WORD[taughtState(t, d.today)]}${t.taughtFrom && taughtState(t, d.today) !== 'taught' ? ` ${t.taughtFrom}` : ''}${r ? ` | review ${r <= d.today ? 'due' : r}` : ''}`
  }
  const out = [{
    title: 'Study tracker topics (ref | name | subject · strand | colour, maths pipeline step 0–6 | taught / next up / later | next review). Refs are the codes; change with the trk_ ops',
    lines: [...coded.map((t) => topicLine(t, t.code!)), ...codeless.map((t, i) => topicLine(t, `TP${i + 1}`))],
  }]
  out.push({ title: 'Tests and papers (TS…)', lines: snapTests(d).map((t, i) => `TS${i + 1} | ${t.title} | ${t.date ? `${t.date} (${daysBetween(d.today, t.date)} days)` : 'no date'} | ${t.kind}${t.subject ? ` · ${t.subject}` : ''}${t.topicCodes.length ? ` | topics ${t.topicCodes.join(', ')}` : ''}${t.attempts.length ? ` | tries: ${attemptText(t)}` : ''}${t.limits ? ` | ${t.limits}` : ''}${t.minutesPerDay ? ` | ${t.minutesPerDay}${t.minutesMax ? `-${t.minutesMax}` : ''} min/day` : ''}`) })
  out.push({ title: 'Mistakes to redo (MK…)', lines: snapMistakes(d).map((m, i) => `MK${i + 1} | ${mistakeName(m) || '-'} | ${clip(m.body, 80)}${m.kind ? ` | ${m.kind}` : ''} | redo ${m.redoStage + 1} of 2 ${m.reviewOn <= d.today ? 'due' : m.reviewOn}`) })
  out.push({ title: 'Programmes (PG…; trk_item "item" = the number after #)', lines: snapProgrammes(d).map((p, i) => { const n = nextStep(p); return `PG${i + 1} | ${p.name} | ${p.status}${p.pausedUntil ? ` until ${p.pausedUntil}` : ''} · ${p.perWeek}/week${p.days ? ` · ${p.days}` : ''} · this week ${doneThisWeek(p, d.today)}/${p.perWeek}${p.mode !== 'in_order' ? ` · ${p.mode}` : ''} | next ${n ? `#${n.item.position} ${clip(n.item.title, 60)}${n.action === 'test' ? ' (chapter test first)' : ''}` : 'none'}` }) })
  out.push({ title: 'Temporary study rules (RL…; they end by themselves)', lines: snapRules(d).map((r, i) => `RL${i + 1} | ${ruleLabel(r)} | ${r.startsOn} to ${r.endsOn} | his words: ${clip(r.words, 80)}`) })
  return out.filter((s) => s.lines.length)
}

// ---------------------------------------------------------------------------
// After ✅: "Next: …"; the Your week card's rules line; "what next?"
// ---------------------------------------------------------------------------

/** One line saying exactly what to open next, for the first topic / programme / test the change was about. */
export function nextLine(d: TrackerData, hints: NextHint[]): string | null {
  for (const h of hints) {
    if (h.topicId) {
      const t = d.topics.find((x) => x.id === h.topicId)
      if (t) return `👉 <b>Next for ${esc(label(t))}</b>: ${esc(nextResource(t, d.links))}`
    }
    if (h.programmeId) {
      const p = d.programmes.find((x) => x.id === h.programmeId)
      if (!p) continue
      const n = nextStep(p)
      if (!n) return `🎉 <b>${esc(p.name)}</b>: every item done.`
      const met = leftThisWeek(p, d.today) === 0
      return `👉 <b>Next</b>: ${esc(p.name)} #${n.item.position} ${esc(clip(n.item.title, 60))}${n.action === 'test' ? ' – its chapter test first' : ''}${met ? ' <i>(next week: this week’s target is met)</i>' : ''}`
    }
    if (h.testId) {
      const t = d.tests.find((x) => x.id === h.testId)
      if (!t || !t.date) continue
      const left = daysBetween(d.today, t.date)
      const tt = t.topicCodes.map((c) => d.topics.find((x) => x.code?.toUpperCase() === c.toUpperCase())).filter((x): x is TrackerTopic => !!x)
      const red = tt.find((x) => x.status === 'not_secure') ?? tt.find((x) => x.status === 'understand')
      if (!t.attempts.some((a) => a.what === 'diagnostic')) return `👉 <b>Next for ${esc(t.title)}</b>: a diagnostic, 1–2 fresh questions per topic, no notes`
      if (left >= 3 && left <= 4 && !t.attempts.some((a) => a.what === 'timed' && daysBetween(a.doneOn, d.today) <= 3)) return `👉 <b>Next for ${esc(t.title)}</b>: timed practice${t.lengthMin ? ` (${t.lengthMin} min)` : ''}`
      if (red) return `👉 <b>Next for ${esc(t.title)}</b>: ${esc(label(red))} → ${esc(nextResource(red, d.links))}`
    }
    if (h.mistakeId) {
      const m = d.mistakes.find((x) => x.id === h.mistakeId)
      if (m) return `👉 Redo it ${m.reviewOn <= d.today ? 'today' : day(m.reviewOn)} without looking (it’ll be on /review).`
    }
  }
  return null
}

/** "📌 Rules this week: top priority: ACT until Sun 25 Oct · paused: getting ahead until Sun 25 Oct" (null if none). */
export function rulesWeekLine(rules: PlanRule[], from: string, to: string): string | null {
  const list = rules.filter((r) => r.startsOn <= to && r.endsOn >= from).sort((a, b) => a.endsOn.localeCompare(b.endsOn))
  if (!list.length) return null
  return `📌 <b>Rules this week</b>: ${list.slice(0, 4).map((r) => esc(ruleNote(r))).join(' · ')}${list.length > 4 ? ` +${list.length - 4}` : ''}`
}

/** How to report a pick done, in one message the fast paths read (its DoneHint, lib/plan-items.ts). */
export function doneHint(pick: PlanPick, d: TrackerData | null): string {
  const h = pick.done
  const t = d && pick.topicId ? d.topics.find((x) => x.id === pick.topicId) ?? null : null
  const name = t?.code ?? (t?.name ?? 'the topic').toLowerCase()   // a code always reads back
  if (h.kind === 'topic') {
    if (h.physics === 'booklet') return `Done? “${name} booklet done”`
    if (h.physics === 'pmt') return `Done? “pmt ${name} 7/10”`
    if (pick.kind === 'review') return `Done? “reviewed ${name} 4/4”`
    return `Done? Send the score (“bicen ${name} 8/10”) or the colour (“${name} 🟡”)`
  }
  if (h.kind === 'mistakes') {
    const m = d?.mistakes.find((x) => h.mistakeIds.includes(x.id))
    return `Done? “redid ${m ? [m.code, m.question].filter(Boolean).join(' ') : 'PC1-03 Q3b'}” for each one`
  }
  if (h.kind === 'attempt') return `Done? Send the score: “${d?.tests.find((x) => x.id === h.goalId)?.title ?? 'the test'} ${h.what === 'other' ? '' : `${h.what} `}${h.label ? `${h.label} ` : ''}30/45”`   // label: the booklet's topic code
  if (h.kind === 'programme_item') {
    const p = d?.programmes.find((x) => x.items.some((i) => i.id === h.itemId))
    const it = p?.items.find((i) => i.id === h.itemId)
    const ref = p && it ? `${p.name} ${it.position}` : 'STEP 3'
    return h.score ? `Done? Send the chapter-test score: “done ${ref} 12/15” (full marks skips that chapter)` : `Done? “done ${ref}” (add “with hints, idea: …”)`
  }
  if (h.kind === 'task') return 'Done? “done with it” (or tick it on the pinned Today)'
  return 'Done? Tell me how it went and I’ll move it on.'
}

/** "what next?": the planner's top pick not done yet, with exactly what to open. */
export function whatNextText(pick: PlanPick, more: PlanPick[], d: TrackerData | null = null): string {
  const lines = [`👉 <b>${esc(pick.title)}</b> · ${pick.minutes} min`, `📖 ${esc(pick.open)}${pick.url ? ` ${esc(pick.url)}` : ''}`]
  if (pick.steps?.length) lines.push(...pick.steps.map((s) => `  ${s.minutes}′ ${esc(s.what)}`))
  if (pick.why) lines.push(`<i>${esc(pick.why)}</i>`)
  if (more.length) lines.push('', `Then: ${more.slice(0, 2).map((p) => esc(p.title)).join(' · ')}`)
  lines.push('', `<i>${esc(doneHint(pick, d))}</i>`)
  return lines.join('\n')
}
