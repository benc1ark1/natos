// Nat's own lists that used to be fixed in code: where tasks come from ("task sources"). Kept in profiles.planning
// (key "sources"), edited on the Settings page or by chat. Nothing is ever removed: a source he stops using is
// archived, so old tasks still show its name. Pure: no database.

export type Source = { key: string; label: string; archived?: boolean }

/** Used until he changes the list. "own" is always there (anything that came from himself). */
export const DEFAULT_SOURCES: Source[] = [
  { key: 'school', label: 'School (Classroom)' },
  { key: 'tutor_maths_physics', label: 'Maths/physics tutor (Vlad)' },
  { key: 'tutor_cs', label: 'CS tutor' },
  { key: 'own', label: 'Own' },
]

const KEY = /^[a-z][a-z0-9_]{0,39}$/
const obj = (raw: unknown) => (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

/** His task sources (archived ones included, flagged), checked; the defaults if he has none. */
export function taskSources(planning: unknown): Source[] {
  const v = obj(planning).sources
  if (!Array.isArray(v)) return DEFAULT_SOURCES
  const seen = new Set<string>()
  const out: Source[] = []
  for (const x of v) {
    const s = obj(x)
    const key = typeof s.key === 'string' ? s.key : ''
    const label = typeof s.label === 'string' ? s.label.trim().slice(0, 60) : ''
    if (!KEY.test(key) || !label || seen.has(key)) continue
    seen.add(key)
    out.push({ key, label, ...(s.archived === true ? { archived: true } : {}) })
  }
  if (!out.some((s) => s.key === 'own')) out.push({ key: 'own', label: 'Own' })
  return out
}

/** The sources to pick from (not archived), plus the one a task already has. */
export const activeSources = (planning: unknown, keep?: string | null) =>
  taskSources(planning).filter((s) => !s.archived || s.key === keep)

export const sourceLabel = (planning: unknown, key: string | null | undefined) =>
  taskSources(planning).find((s) => s.key === key)?.label ?? (key && key !== 'own' ? key : 'Own')

/** A key for a new label ("Physics tutor (Vlad)" -> "physics_tutor_vlad"), unique in the list. */
export function newKey(label: string, taken: string[]): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 's_$1').slice(0, 20) || 'item'
  let key = base, n = 2
  while (taken.includes(key) || key === 'none') key = `${base}_${n++}`
  return key
}

/** Find an item by its key or its label (any case). */
export const findItem = <T extends { key: string; label: string }>(list: T[], name: string): T | null => {
  const n = name.trim().toLowerCase()
  return list.find((x) => x.key === n || x.label.toLowerCase() === n) ?? null
}
