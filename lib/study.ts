// Study pipelines (BUILD-GUIDE step 12, my-spec 26): each subject's stages in order, its topics, and what's done.
// The next action for a topic is the first stage after the furthest one he's done, so adding, removing or reordering
// stages never loses progress (a stage slipped in before his furthest one just doesn't hold him back).
// Pure: no database.

export type Stage = { id: string; subject_id: string; name: string; sort_order: number; archived_at: string | null }
export type Topic = { id: string; subject_id: string; name: string; spec_ref: string | null; notes_url: string | null; sort_order: number; archived_at: string | null
  status?: 'not_started' | 'not_secure' | 'understand' | 'exam_ready' | null }   // the colour (lib/maths.ts; supabase/maths.sql)
export type Progress = { id: string; topic_id: string; stage_id: string; done_at: string; undone_at: string | null }
export type Mistake = { id: string; subject_id: string | null; topic_id: string | null; body: string; logged_on: string; review_on: string; reviewed_at: string | null; archived_at: string | null }

/** A subject's live stages, in order. */
export const stagesOf = (stages: Stage[], subjectId: string) =>
  stages.filter((s) => s.subject_id === subjectId && !s.archived_at).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))

export type TopicState = { done: Set<string>; furthest: number; next: Stage | null; stageNo: number; total: number; finished: boolean; started: boolean }

/** Where a topic is: which stages are done, and the next one (null once the last stage is done). */
export function topicState(topic: Topic, stages: Stage[], progress: Progress[]): TopicState {
  const list = stagesOf(stages, topic.subject_id)
  const done = new Set(progress.filter((p) => p.topic_id === topic.id && !p.undone_at).map((p) => p.stage_id))
  let furthest = -1
  list.forEach((s, i) => { if (done.has(s.id)) furthest = i })
  const next = list[furthest + 1] ?? null
  return { done, furthest, next, stageNo: furthest + 2, total: list.length, finished: list.length > 0 && !next, started: furthest >= 0 }
}

export type NextAction = { subjectId: string; subject: string; topic: Topic; stage: Stage; stageNo: number; total: number }

/** What to do next in each subject: topics already started first (in the spec's order), then the next new topic. */
export function nextActions(subjects: { id: string; name: string }[], stages: Stage[], topics: Topic[], progress: Progress[], perSubject = 2): NextAction[] {
  const out: NextAction[] = []
  for (const sub of subjects) {
    const live = topics.filter((t) => t.subject_id === sub.id && !t.archived_at).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const states = live.map((t) => ({ t, s: topicState(t, stages, progress) })).filter((x) => x.s.next)
    const ordered = [...states.filter((x) => x.s.started), ...states.filter((x) => !x.s.started)]
    for (const x of ordered.slice(0, perSubject)) out.push({ subjectId: sub.id, subject: sub.name, topic: x.t, stage: x.s.next!, stageNo: x.s.stageNo, total: x.s.total })
  }
  return out
}

/** "Further Maths: Complex numbers — exam questions (stage 4/6)" */
export const actionWords = (a: NextAction) => `${a.subject}: ${a.topic.name} — ${a.stage.name} (stage ${a.stageNo}/${a.total})`

/** Mistakes due for review (on or before today), oldest first. */
export const dueMistakes = (mistakes: Mistake[], today: string) =>
  mistakes.filter((m) => !m.reviewed_at && !m.archived_at && m.review_on <= today).sort((a, b) => a.review_on.localeCompare(b.review_on))

/** Topics from pasted lines ("1.2 Complex numbers", "- Matrices"): bullets and numbering become the spec ref. */
export function parseTopicLines(text: string): { name: string; spec_ref: string | null }[] {
  const seen = new Set<string>()
  const out: { name: string; spec_ref: string | null }[] = []
  for (const raw of text.split(/\r?\n|;/)) {
    const line = raw.replace(/^\s*[-•*·]\s*/, '').trim()
    if (!line) continue
    const m = line.match(/^((?:\d+\.)*\d+[a-z]?)[.):]?\s+(.+)$/i)
    const name = (m ? m[2] : line).trim().slice(0, 120)
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, spec_ref: m ? m[1].slice(0, 40) : null })
  }
  return out.slice(0, 200)
}

/** The best match for a name he typed ("matrices" -> "Matrices"; "complex" -> "Complex numbers"). */
export function matchName<T extends { name: string }>(list: T[], said: string): T | null {
  const n = said.trim().toLowerCase()
  if (!n) return null
  const exact = list.find((x) => x.name.toLowerCase() === n)
  if (exact || n.length < 3) return exact ?? null
  // a partial match only if it's the only one (never a guess between two)
  const only = (f: (x: string) => boolean) => { const hits = list.filter((x) => f(x.name.toLowerCase())); return hits.length === 1 ? hits[0] : null }
  return only((x) => x.startsWith(n) || n.startsWith(x)) ?? only((x) => x.includes(n) || n.includes(x))
}
