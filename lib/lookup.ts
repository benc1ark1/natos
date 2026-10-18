import type { Category, Subject, Task, EventRow } from './types'

// Colours come from the design: one per top-level area. Matched by category
// name; anything else (or renamed) falls back to neutral grey.
const AREA_COLORS: Record<string, string> = {
  study: '#8fb3ff',
  athletic: '#f2a65a',
  personal: '#d9a7ec',
}
export const NEUTRAL = '#9aa6a3'

export function areaColor(name: string | null | undefined): string {
  return (name && AREA_COLORS[name.toLowerCase()]) || NEUTRAL
}

export type Lookup = {
  categories: Category[]
  subjects: Subject[]
  categoryById: Map<string, Category>
  subjectById: Map<string, Subject>
}

export function makeLookup(categories: Category[], subjects: Subject[]): Lookup {
  return {
    categories,
    subjects,
    categoryById: new Map(categories.map((c) => [c.id, c])),
    subjectById: new Map(subjects.map((s) => [s.id, s])),
  }
}

/** Category of a record: its subject's category first, then its own. */
export function categoryOf(lk: Lookup, rec: { subject_id: string | null; category_id: string | null }): Category | undefined {
  const sub = rec.subject_id ? lk.subjectById.get(rec.subject_id) : undefined
  const catId = sub?.category_id ?? rec.category_id
  return catId ? lk.categoryById.get(catId) : undefined
}

export const colorOf = (lk: Lookup, rec: Task | EventRow | { subject_id: string | null; category_id: string | null }) =>
  areaColor(categoryOf(lk, rec)?.name)

export const subjectName = (lk: Lookup, id: string | null) => (id ? lk.subjectById.get(id)?.name ?? '' : '')
