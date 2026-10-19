// The study tracker's fast paths (plans/contracts.md §2, §3.7): messages understood without the AI, each turned into
// the same trk_ changes the brain would send ("matrices 🟢", "did Bicen matrices set 8/10", "finished textbook exercise
// on logs", "mistake: PC1-03 Q3b assumed through origin – knowledge", "HT2 practice 38/45", "redid PC1-03 Q3b", "pause
// getting ahead until 25 Oct", "ACT top priority this week", "maths + physics 45 min/day this week", "done STEP 3",
// "export my tracker", "what next?"). Strict: anything unsure is null, so the brain reads it instead. Pure.
import { addDays } from '../time'
import type { PluginRawAction } from '../telegram/plugin-types'
import type { TrackerData } from './bot-data'
import { attemptWhat, findProgramme, studyProgrammes, findTest, itemFor, logWhat, normTarget, subjectList } from './bot-ops'
import { codesIn, colourOf, endFromWords, findScore, findTopic, findTopics, kvText, norm, questionOf, splitColour, trailingKind, type EndWords } from './bot-parse'
import type { Colour, TrackerTopic } from './types'

export type AskOption = { label: string; action: PluginRawAction }
export type FastIntent =
  | { kind: 'actions'; actions: PluginRawAction[] }
  | { kind: 'ask'; question: string; options: AskOption[] }   // a quick-tap question; each answer is one change
  | { kind: 'export' }
  | { kind: 'next' }
  | { kind: 'idea'; request: string }

export const raw = (op: string, ref: string, value: string, date = '', words = ''): PluginRawAction =>
  ({ op, ref, value, date, date_to: '', time: '', time_to: '', number: 0, words })

const COLOUR_WORD: Record<Colour, string> = { exam_ready: 'green', understand: 'yellow', not_secure: 'red', not_started: 'white' }
const topicRef = (t: TrackerTopic) => t.code ?? `topic:${t.id}`
const tidy = (s: string) => s.trim().replace(/^[\s:,;–—-]+|[\s:,;–—-]+$/g, '').replace(/\s+/g, ' ')
const lower = (s: string) => s.toLowerCase().replace(/[’']/g, "'")

/** Cheap first look (no database): could this be a tracker message at all? */
export function mightBeTracker(message: string): boolean {
  const t = lower(message.trim())
  if (!t || t.length > 300 || t.startsWith('/')) return false
  if (/(🟢|🟡|🔴|⚪)/u.test(t)) return true
  if (/\d+\s*(?:\/|out of)\s*\d+|\d+\s*%/.test(t)) return true
  if (/\b(did|done|finished|completed|redid|redone|redo|mistake|wrong|pause|paused|resume|unpause|priority|prioriti[sz]e|focus|min(?:ute)?s?\s*(?:\/|a|per)\s*day|rule|export|tracker|what next|what should i|what shall i|what do i|what now|next study|skip|stop|reviewed|booklet|bicen|textbook|integral|pmt|exercise|step|stretch|ahead)\b/.test(t)) return true
  const last = t.replace(/[.!?]+$/, '').split(/\s+/).at(-1) ?? ''
  return !!colourOf(last)
}

type Ctx = { recent: string[]; cardOpen: boolean }

/** The tracker change(s) his message means, or null when unsure. */
export function parseFast(message: string, d: TrackerData, today: string, ctx: Ctx = { recent: [], cardOpen: false }): FastIntent | null {
  const m = message.trim().replace(/\s+/g, ' ')
  const t = lower(m).replace(/[.!]+$/, '')
  if (!t || t.length > 300) return null
  return exportOrIdea(t) ?? whatNext(t) ?? programmeItem(m, t, d) ?? programmeControl(t, d, today) ?? mistake(m, d, today)
    // (with a card waiting, "no physics tonight" may be a change to that card, e.g. a day plan: the brain decides)
    ?? redo(t, d) ?? attempt(m, t, d, today) ?? (ctx.cardOpen ? null : rule(m, t, d, today)) ?? log(m, t, d, today) ?? colour(m, d, today, ctx)
}

// ---------------------------------------------------------------------------

function exportOrIdea(t: string): FastIntent | null {
  if (/^(?:(?:can you |could you |please |pls )*)(?:export|download|send(?: me)?|back ?up|give me|get me)\s+(?:a copy of\s+|a backup of\s+)?(?:my |the )?(?:study )?tracker(?:\s+(?:as|to|in|into)\s+(?:a\s+)?(?:csv|spreadsheet|sheet|file|google sheets?|excel))?(?: please| pls)?[?]?$/.test(t)
    || /^(?:tracker export|export (?:my )?(?:study )?tracker csv|csv of my tracker)$/.test(t)) return { kind: 'export' }
  if (/\b(?:auto(?:matically)?|every (?:day|week|night)|keep)\b.*\b(?:sync|export|back ?up|update)\b.*\b(?:google sheets?|spreadsheet|sheet)\b/.test(t)
    || /^sync (?:my )?(?:study )?tracker (?:to|with) (?:my )?(?:google sheets?|spreadsheet|sheet)/.test(t)) {
    return { kind: 'idea', request: 'Sync the study tracker to his Google Sheet automatically (today: “export my tracker” sends a CSV to import)' }
  }
  return null
}

function whatNext(t: string): FastIntent | null {
  return /^(?:ok |okay |so |right |and )?(?:what(?:'s| is)? next(?: to (?:do|study|revise))?(?: for (?:study|revision))?|what (?:should|shall|do|can) i (?:do|study|revise|work on)(?: now| next| today| tonight| first)?|what to (?:study|revise|do) (?:now|next)|next study|study next|what study now)\s*\??$/.test(t)
    ? { kind: 'next' } : null
}

/** "done STEP 3", "did STEP assignment 3 with hints, idea: …", "STEP 3 done", "skip STEP 4", "done STEP". */
function programmeItem(m: string, t: string, d: TrackerData): FastIntent | null {
  if (!studyProgrammes(d).length) return null
  const ITEMWORD = '(?:assignment|item|chapter|module|number|no\\.?|ch\\.?|#)?'
  let doing: 'done' | 'skip' = 'done'
  let name = '', num = '', rest = ''
  let x = t.match(new RegExp(`^(?:i )?(?:just )?(?:did|done|finished|completed|have done)\\s+(?:the\\s+|my\\s+)?(.+?)\\s+${ITEMWORD}\\s*(\\d{1,3})\\b(.*)$`))
    ?? t.match(new RegExp(`^(.+?)\\s+${ITEMWORD}\\s*(\\d{1,3})\\s+(?:done|finished|complete|completed)\\b(.*)$`))
  if (x) { [, name, num, rest] = x }
  else if ((x = t.match(new RegExp(`^skip(?:ped)?\\s+(?:the\\s+)?(.+?)(?:\\s+${ITEMWORD}\\s*(\\d{1,3}))?(?:\\s+(this week|today))?$`)))) { doing = 'skip'; name = x[1]; num = x[2] ?? '' }
  else if ((x = t.match(/^(?:i )?(?:just )?(?:did|done|finished|completed)\s+(?:the\s+|my\s+)?(?:next\s+)?(.+?)(?:\s+one)?$/))) { name = x[1] }
  else return null
  const p = findProgramme(studyProgrammes(d), name)
  if (!p) return null
  const item = itemFor(p, num)
  if (!item) return null
  const found = findScore(rest)
  const sc = found && /\/|out of/.test(found.text) ? found : null
  return { kind: 'actions', actions: [raw('trk_item', `prog:${p.id}`, kvText({ do: doing, item: item.position, result: resultOf(m, rest), score: sc?.score, out_of: sc?.outOf }))] }
}

/** ", with hints, idea: modular arithmetic" → "solved with hints · idea: modular arithmetic" (the idea in his own case). */
function resultOf(original: string, rest: string): string | null {
  const r = rest.replace(/^[\s,:;–—-]+/, '')
  if (!r) return null
  const solved = /\b(without (?:any )?help|no help|on my own|by myself|solved it)\b/.test(r) ? 'solved without help'
    : /\b(with (?:a )?(?:hint|hints|help)|hints?)\b/.test(r) ? 'solved with hints'
      : /\b(didn'?t (?:solve|get)|couldn'?t|not solved|no luck|stuck)\b/.test(r) ? 'not solved' : null
  const idea = original.match(/\b(?:idea(?: i learn[te]d)?|learn[te]d|takeaway|key idea)\s*[:\-–]\s*(.+)$/i)?.[1]?.trim()
  const out = [solved, idea ? `idea: ${idea.replace(/[.!]+$/, '')}` : ''].filter(Boolean).join(' · ')
  return out || null
}

/** "pause STEP until 1 Nov", "resume STEP", "stop STEP", "STEP 2 a week". */
function programmeControl(t: string, d: TrackerData, today: string): FastIntent | null {
  if (!studyProgrammes(d).length) return null
  let x = t.match(/^(pause|resume|restart|unpause|stop|end|finish with)\s+(?:the\s+|my\s+)?(.+?)(?:\s+(?:programme|program))?(?:\s+((?:until|till|til|for|to) .+|this week|next week))?$/)
  if (x) {
    const p = findProgramme(studyProgrammes(d), x[2])
    if (!p) return null
    const verb = x[1]
    if (verb === 'pause') {
      if (!x[3]) return { kind: 'actions', actions: [raw('trk_programme', `prog:${p.id}`, 'do=pause')] }
      const end = endFromWords(x[3], today)
      if (!end) return null
      return { kind: 'actions', actions: [raw('trk_programme', `prog:${p.id}`, 'do=pause', end.ends, end.words)] }
    }
    if (x[3]) return null
    return { kind: 'actions', actions: [raw('trk_programme', `prog:${p.id}`, verb === 'stop' || verb === 'end' || verb === 'finish with' ? 'do=stop' : 'do=resume')] }
  }
  x = t.match(/^(?:do\s+)?(?:the\s+)?(.+?)\s+(\d{1,2}|once|twice|three times)\s*(?:x\s*)?(?:times\s+)?(?:a|per|\/|each)\s*week$/)
  if (x) {
    const p = findProgramme(studyProgrammes(d), x[1])
    if (!p) return null
    const n = x[2] === 'once' ? 1 : x[2] === 'twice' ? 2 : x[2] === 'three times' ? 3 : Number(x[2])
    return { kind: 'actions', actions: [raw('trk_programme', `prog:${p.id}`, kvText({ do: 'change', per_week: n }))] }
  }
  return null
}

/** "mistake: PC1-03 Q3b assumed through origin – knowledge", "mistake: matrices Q4 sign error (careless), rule: check signs". */
function mistake(m: string, d: TrackerData, today: string): FastIntent | null {
  const x = m.match(/^(?:mistake|mistakes|error|log (?:a )?mistake|wrong)\s*[:\-–—]\s*(.+)$/i) ?? m.match(/^(?:mistake on|got wrong(?: on)?)\s+(.+)$/i)
  if (!x) return null
  let text = x[1].trim()
  let rule: string | null = null
  const r = text.match(/^(.*?)[\s,;.–—-]*\b(?:rule|next time|fix)\s*[:\-–]\s*(.+)$/i)
  if (r) { text = r[1].trim(); rule = r[2].trim().replace(/[.!]+$/, '') }
  const { rest, kind } = trailingKind(text)
  text = rest
  const q = questionOf(text)
  let topic: TrackerTopic | null = null
  let test: string | null = null
  let body = text
  const codes = codesIn(d.topics, text)
  const firstTok = text.split(/\s+/)[0] ?? ''
  if (codes.length && codes[0].code?.toUpperCase() === firstTok.toUpperCase().replace(/[:,]$/, '')) {
    topic = codes[0]
    body = text.slice(firstTok.length)
  } else if (q) {
    const before = text.slice(0, text.search(/\bq(?:uestion)?\s?\d/i)).trim().replace(/[:,–-]+$/, '').trim()
    if (before) {
      const hit = findTopic(d.topics, before, today)
      if (hit && 'hit' in hit) { topic = hit.hit; body = text.slice(text.indexOf(before) + before.length) }
      else {
        const tt = findTest(d.tests, before)
        if (!tt) return null
        test = tt.title
        body = text.slice(text.indexOf(before) + before.length)
      }
    }
  } else return null
  if (q) body = body.replace(/\bq(?:uestion)?\s?\d{1,2}(?:\s?[a-z]\b|\([a-z]\))?(?:\s?\((?:i|ii|iii|iv|v|vi)\)|\s(?:i|ii|iii|iv|v|vi)\b)?/i, '')
  body = tidy(body)
  if (!body) return null
  return { kind: 'actions', actions: [raw('trk_mistake', topic ? topicRef(topic) : '', kvText({ question: q, what: body, kind, rule, test }))] }
}

/** "redid PC1-03 Q3b", "redid the matrices Q4 one – still wrong". */
function redo(t: string, d: TrackerData): FastIntent | null {
  const x = t.match(/^(?:i )?(?:just )?(?:redid|redone|re-did|re-done|did the redo (?:of|on|for)|redo done(?: on| for)?)\s+(?:the\s+)?(.+?)$/)
  if (!x || !d.mistakes.length) return null
  let text = x[1]
  const wrong = /\b(still wrong|wrong again|got it wrong|wrong|❌)\s*$/.test(text)
  text = tidy(text.replace(/\b(again|right|correct|✅|❌|fine|got it|still wrong|wrong again|got it wrong|wrong|one|mistake)\b/g, ' '))
  const q = questionOf(text)
  const codes = codesIn(d.topics, text)
  const qq = (s: string | null) => (s ?? '').replace(/\s+/g, '').toLowerCase()
  let list = d.mistakes.filter((mk) => !q || qq(mk.question) === qq(q))
  if (codes.length === 1) list = list.filter((mk) => mk.topicId === codes[0].id || (mk.code ?? '').toUpperCase() === codes[0].code!.toUpperCase())
  else if (codes.length > 1) return null
  else {
    const words = tidy(q ? text.replace(/\bq(?:uestion)?\s?\d\S*/i, '') : text)
    if (words) {
      const hit = findTopic(d.topics, words, d.today)
      if (!hit || !('hit' in hit)) return null
      list = list.filter((mk) => mk.topicId === hit.hit.id)
    } else if (!q) return null
  }
  if (list.length !== 1) return null
  return { kind: 'actions', actions: [raw('trk_redo', `mistake:${list[0].id}`, kvText({ result: wrong ? 'wrong' : 'right' }))] }
}

const FILLER = new Set(['got', 'i', 'scored', 'score', 'did', 'done', 'sat', 'had', 'my', 'the', 'a', 'an', 'on', 'in', 'for', 'at', 'today', 'yesterday', 'out', 'of', 'was', 'it', 'just', 'marks', 'mark', 'back', 'result', 'results', 'with', 'and', 'from', 'try'])

/** "HT2 practice 38/45", "got 31/45 on the HT1 test", "mechanics test diagnostic 12/20 yesterday". */
function attempt(m: string, t: string, d: TrackerData, today: string): FastIntent | null {
  if (!d.tests.length) return null
  const s = findScore(t)
  if (!s || !/\/|out of/.test(s.text)) return null
  if (!/\b(test|paper|practice|mock|diagnostic|booklet|exam|consolidation|ht\d)\b/.test(t)) return null
  // a topic code ("HT2 booklet PC1-01 30/45") stays in the label (the booklet for that topic), not in the test's name
  let rest = t.replace(s.text, ' ')
  for (const c of codesIn(d.topics, rest)) rest = rest.split(c.code!.toLowerCase()).join(' ')
  const words = norm(rest).split(' ').filter((w) => w && !FILLER.has(w))
  const test = findTest(d.tests, words.join(' '))
  if (!test) return null
  const whatWord = ['diagnostic', 'booklet', 'timed', 'practice', 'mock', 'paper', 'real', 'actual'].find((w) => new RegExp(`\\b${w}\\b`).test(t))
  const what = whatWord ? attemptWhat(whatWord === 'mock' ? 'mock' : whatWord) ?? 'other' : /\b(got back|results?|the test|real)\b/.test(t) ? 'real' : 'other'
  const yesterday = /\byesterday\b/.test(t)
  const label = tidy(m.replace(new RegExp(s.text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'), ' ').replace(/\b(today|yesterday)\b/gi, ' ')).slice(0, 80)
  return { kind: 'actions', actions: [raw('trk_attempt', `test:${test.id}`, kvText({ what, score: s.score, out_of: s.outOf, label }), yesterday ? addDays(today, -1) : '', yesterday ? 'yesterday' : '')] }
}

// ---------------------------------------------------------------------------
// Temporary rules
// ---------------------------------------------------------------------------

const ASK_END = 'When should it end?'
function ruleIntent(value: Record<string, string | number | null>, phrase: string, message: string, today: string): FastIntent | null {
  const words = message.slice(0, 300)
  if (!phrase.trim()) {
    // no end given: a quick-tap ask (this week / 2 weeks / until I say)
    return { kind: 'ask', question: ASK_END, options: [
      { label: 'This week', action: raw('trk_rule', '', kvText({ ...value, ends: 'week', words })) },
      { label: '2 weeks', action: raw('trk_rule', '', kvText({ ...value, ends: '2weeks', words })) },
      { label: 'Until I say', action: raw('trk_rule', '', kvText({ ...value, ends: 'until_i_say', words })) },
    ] }
  }
  const end: EndWords | null = endFromWords(phrase, today)
  if (!end) return null
  const v = { ...value, words, ...(end.starts ? { starts: end.starts } : {}), ...(end.untilISay ? { ends: 'until_i_say' } : {}) }
  return { kind: 'actions', actions: [raw('trk_rule', '', kvText(v), end.untilISay ? '' : end.ends, end.untilISay ? '' : end.words)] }
}

const END_TAIL = '(?:\\s+((?:until|till|til|up to|to|through|for|by) .+|(?:for |all |during )?(?:the rest of )?(?:this|next) week|today|tonight|tomorrow|for now|indefinitely))?'

function rule(m: string, t: string, d: TrackerData, today: string): FastIntent | null {
  // a time cap: "maths + physics 45 min/day this week"
  let x = t.match(new RegExp(`^(.+?)\\s+(?:(?:at most|max(?:imum)?|only|capped at|cap at|cap|limit(?:ed)? to|no more than)\\s+)?(\\d{1,3})\\s*(?:min(?:ute)?s?|m)\\s*(?:\\/|a|per|each)\\s*day${END_TAIL}$`))
  if (x) {
    const list = subjectList(x[1].replace(/^(?:cap|limit|keep)\s+/, ''), d.subjects)
    if (!list) return null
    return ruleIntent({ do: 'add', kind: 'cap', target: `subjects:${list.join(',')}`, minutes: Number(x[2]) }, x[3] ?? '', m, today)
  }
  // top priority: "ACT top priority this week", "prioritise physics until Friday"
  x = t.match(new RegExp(`^(?:make\\s+)?(.+?)\\s+(?:is\\s+|my\\s+|the\\s+)*(?:top|first|main|number one|#1)\\s+priority${END_TAIL}$`))
    ?? t.match(new RegExp(`^(?:prioriti[sz]e|focus on|boost)\\s+(.+?)(?:\\s+first)?${END_TAIL}$`))
  if (x) {
    const target = boostTarget(x[1], d)
    if (!target) return null
    return ruleIntent({ do: 'add', kind: 'boost', target }, x[2] ?? '', m, today)
  }
  // a pause: "pause getting ahead until 25 Oct", "no stretch this week", "skip reviews today"
  x = t.match(new RegExp(`^(?:pause|stop|no|skip|drop|hold off(?: on)?|no more|park)\\s+(?:the\\s+|my\\s+)?(getting ahead|learning ahead|going ahead|ahead|new topics|stretch|stretching|reviews?|mistake redos|redos|old topics|fixing|physics|act|maths|further maths|fm)${END_TAIL}$`))
  if (x) {
    const target = normTarget(x[1].replace(/^(?:learning|going) ahead$/, 'ahead').replace(/^stretching$/, 'stretch').replace(/^review$/, 'reviews').replace(/^new topics$/, 'ahead'), d.subjects)
    if (!target) return null
    return ruleIntent({ do: 'add', kind: 'pause', target }, x[2] ?? '', m, today)
  }
  // ending one early: "end the ACT rule", "resume getting ahead"
  x = t.match(/^(?:end|stop|cancel|remove|drop|lift|undo|scrap)\s+(?:the\s+|my\s+)?(.+?)\s+(?:rule|priority|pause|cap|limit)$/)
    ?? t.match(/^(?:resume|unpause|restart|back to)\s+(getting ahead|ahead|learning ahead|stretch|reviews|physics|act)$/)
  if (x) {
    const target = normTarget(x[1].replace(/^learning ahead$/, 'ahead'), d.subjects) ?? (findProgramme(studyProgrammes(d), x[1]) ? `programme:${findProgramme(studyProgrammes(d), x[1])!.name}` : null)
    if (!target) return null
    const live = d.rules.filter((r) => r.endsOn >= today && (r.target.toLowerCase() === target.toLowerCase() || (target.startsWith('subject:') && r.target.toLowerCase().includes(target.slice(8).toLowerCase())))
      && (!/^(resume|unpause|restart|back to)/.test(t) || r.kind === 'pause'))
    if (live.length !== 1) return null
    return { kind: 'actions', actions: [raw('trk_rule', `rule:${live[0].id}`, 'do=end')] }
  }
  return null
}

/** What "X top priority" is about: ACT, a subject (maths = Maths + FM), test prep (a test), a programme, a topic. */
function boostTarget(words: string, d: TrackerData): string | null {
  const w = words.trim()
  const fixed = normTarget(w, d.subjects)
  if (fixed) return fixed
  if (findTest(d.tests, w)) return 'tests'
  const p = findProgramme(studyProgrammes(d), w)
  if (p) return `programme:${p.name}`
  const t = findTopic(d.topics, w, d.today)
  return t && 'hit' in t && t.hit.code ? `topic:${t.hit.code}` : null
}

// ---------------------------------------------------------------------------
// Work done on a topic, and colours
// ---------------------------------------------------------------------------

const WHAT_PHRASES: [RegExp, string][] = [
  [/\btextbook exercises?\b|\btextbook (?:qs|questions)\b/, 'exercise'], [/\bmixed exercises?\b|\bred ?(?:\/|and|&) ?blue(?: questions| qs)?\b/, 'mixed'],
  [/\bbicen (?:9 )?hardest\b|\bmadas\b|\bstep questions\b|\bstretch\b/, 'stretch'], [/\bbicen\b/, 'bicen'],
  [/\bintegral(?: topic)?(?: assessment| test)?\b|\btopic assessment\b/, 'integral'], [/\bpmt\b|\bcaie\b/, 'pmt'], [/\bbooklet\b/, 'booklet'],
  [/\bdiagnostic\b/, 'diagnostic'], [/\breviewed\b|\breview(?:ed)? (?:of|on)\b|\bretrieval\b|\brecap(?:ped)?\b/, 'review'],
  [/\bworked examples\b|\btextbook(?: section| chapter| reading)?\b|\bread (?:the )?(?:section|chapter)\b|\blearnt\b|\blearned\b/, 'textbook'], [/\bexercises?\b/, 'exercise'],
]
const LOG_FILLER = /\b(i|just|today|did|done|finished|completed|have|read|went through|worked through|marked|reviewed|revised|sat|had|the|my|on|for|of|a|an|set|sets|questions?|qs|section|chapter|exercises?|assessment|test|all|with notes|used (?:my )?notes|open book|it|and|in|from|got|scored|topic|some)\b/g

function log(m: string, t: string, d: TrackerData, today: string): FastIntent | null {
  const hit = WHAT_PHRASES.find(([re]) => re.test(t))
  if (!hit) return null
  const what = logWhat(hit[1])
  if (!what) return null
  // it must read as a report: a verb, a score, or "<topic> <what> done"
  const s = findScore(t)
  if (!s && !/\b(did|done|finished|completed|read|learnt|learned|went through|worked through|marked|reviewed|sat|had a go)\b/.test(t)) return null
  const notes = /\b(with notes|used (?:my )?notes|open book)\b/.test(t)
  let rest = t
  if (s) rest = rest.replace(s.text, ' ')
  rest = rest.replace(hit[0], ' ').replace(/\b(?:pmt|caie|bicen|integral|booklet|textbook|diagnostic|madas|stretch|mixed|red ?(?:\/|and|&) ?blue|worked examples)\b/g, ' ').replace(LOG_FILLER, ' ')
  const words = tidy(rest.replace(/[^\p{L}\p{N}\s.&-]/gu, ' '))
  if (!words) return null
  const found = findTopic(d.topics, words, today)
  if (!found) return null
  const value = (tp: TrackerTopic) => raw('trk_log', topicRef(tp), kvText({ what, ...(s ? (/\/|out of/.test(s.text) ? { score: s.score, out_of: s.outOf } : { pct: s.pct }) : {}), notes: notes || null }))
  if ('hit' in found) return { kind: 'actions', actions: [value(found.hit)] }
  return { kind: 'ask', question: 'Which topic?', options: found.options.map((tp) => ({ label: (tp.code ?? tp.name).slice(0, 30), action: value(tp) })) }
}

const VAGUE = /^(?:it|that|this|this one|that one|it's|its|that's|thats|it is|that is)$/

function colour(m: string, d: TrackerData, today: string, ctx: Ctx): FastIntent | null {
  const sp = splitColour(m)
  if (!sp) return null
  let rest = sp.rest.toLowerCase().replace(/[’']/g, "'")
    .replace(/^(?:ok |okay |so |actually |now )?(?:please |pls )?(?:set|mark|make|put|change|turn|move|colour|color)\s+/, '').replace(/\s+(?:to|as|is|=)$/, '').trim()
  rest = rest.replace(/\s+(?:is|are)\s+now$|\s+now$/, '').trim()
  if (!rest || /\d+\s*(?:\/|out of)\s*\d+/.test(rest)) return null
  const value = kvText({ colour: COLOUR_WORD[sp.colour] })
  if (VAGUE.test(rest)) {
    if (ctx.cardOpen) return null   // "make it green" with a card waiting is a change to that card: the brain reads it
    const t = recentTopic(d, ctx.recent)
    return t ? { kind: 'actions', actions: [raw('trk_colour', topicRef(t), value)] } : null
  }
  const many = findTopics(d.topics, rest, today)
  if (many?.length) return { kind: 'actions', actions: many.map((tp) => raw('trk_colour', topicRef(tp), value)) }
  const one = findTopic(d.topics, rest, today)
  if (one && 'options' in one) return { kind: 'ask', question: 'Which topic?', options: one.options.map((tp) => ({ label: (tp.code ?? tp.name).slice(0, 30), action: raw('trk_colour', topicRef(tp), value) })) }
  return null
}

/** The one topic the last few messages were about ("make it green" right after talking about PC1-01). */
export function recentTopic(d: TrackerData, recent: string[]): TrackerTopic | null {
  for (const text of recent) {
    const codes = codesIn(d.topics, text)
    if (codes.length === 1) return codes[0]
    if (codes.length > 1) return null
    const n = ` ${norm(text)} `
    const named = d.topics.filter((t) => t.name.length >= 5 && n.includes(` ${norm(t.name)} `))
    const longest = named.filter((t) => !named.some((o) => o !== t && norm(o.name).includes(norm(t.name))))
    if (longest.length === 1) return longest[0]
    if (longest.length > 1) return null
  }
  return null
}

