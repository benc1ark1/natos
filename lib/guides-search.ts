// Which of his guides a message is about ("what's my recovery-night skincare?" → Skincare & Grooming), so the AI can
// answer from the guide's own words. Plain word matching, no AI: title words count most. Pure: no database.

const STOP = new Set(('a an the and or but of to in on at for with my me i is are was do does did what whats how when where which who should can could '
  + 'would will it its this that these those your you about from be have has had am im ive tonight today tomorrow now again please').split(' '))

const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w))
const stem = (w: string) => w.replace(/(ing|ings|ed|es|s)$/, '')

export type GuideText = { id: string; title: string; body: string }

/** Up to `max` guides that match the message (title words ×5, words in the text ×1, or ×3 if only that guide has them). */
export function relevantGuides<T extends GuideText>(guides: T[], message: string, max = 2): T[] {
  const asked = [...new Set(words(message).map(stem))]
  if (!asked.length) return []
  const bodies = guides.map((g) => new Set(words(g.body).map(stem)))
  // a word only one guide uses says a lot about which guide it is ("upper" → Gym); a common one says little
  const rare = (w: string) => bodies.filter((b) => b.has(w)).length <= 1
  const scored = guides.map((g, i) => {
    const title = new Set(words(g.title).map(stem))
    const score = asked.reduce((n, w) => n + (title.has(w) ? 5 : 0) + (bodies[i].has(w) ? (rare(w) ? 3 : 1) : 0), 0)
    return { g, score, titleHit: asked.some((w) => title.has(w)) }
  })
  // a title match, a word only it has, or several words from the text; never one shared common word
  return scored.filter((x) => x.titleHit || x.score >= 3).sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.g)
}

/** The guides as the AI reads them (each cut to a sensible length). */
export const guidesForAI = (list: GuideText[], maxChars = 6000) =>
  list.map((g) => `<guide title="${g.title.replace(/"/g, "'")}">\n${g.body.slice(0, maxChars)}${g.body.length > maxChars ? '\n…(cut short)' : ''}\n</guide>`).join('\n')
