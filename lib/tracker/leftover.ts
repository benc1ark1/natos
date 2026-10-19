// The leftover split (plans/contracts.md §3.4 step 6, "Start here" §5 MODES): the study time left after homework, test
// prep, reviews and fixing 🔴 (and after the fixed commitments: steady ACT, due programmes) is shared out
//   half-term:   55 % ahead · 25 % fixing 🔴/🟡 · 20 % keeping old topics fresh
//   school week: 40 % current topics → 🟢 · 30 % keeping old topics fresh · 30 % ahead
// A share under 20 min is merged into the next one (the last into the one before). One pick per share. The ahead
// session is ≈ 90 min (scaled when its share is smaller, never under 45): a smaller share, or no ahead candidate
// (paused, nothing ⏭ Next up), goes to fixing. A share's unused minutes flow on to the next share; whatever is still
// left at the end goes to stretch (🟢 only) — else it's free time. Pure: no database, no clock.

export type ShareKind = 'ahead' | 'fixing' | 'current' | 'old'
export type Share = { kind: ShareKind; minutes: number }

export const SPLIT: Record<'half_term' | 'school', [ShareKind, number][]> = {
  half_term: [['ahead', 55], ['fixing', 25], ['old', 20]],
  school: [['current', 40], ['old', 30], ['ahead', 30]],
}
/** No share (and no leftover pick) is shorter than this. */
export const MIN_SHARE = 20
/** The ahead session: 90 min, scaled down to 45 at the least. */
export const AHEAD_MAX = 90
export const AHEAD_MIN = 45
/** The longest single pick per share (the rest flows on). */
export const SHARE_MAX: Record<ShareKind | 'stretch', number> = { ahead: AHEAD_MAX, fixing: 60, current: 60, old: 45, stretch: 60 }

/** The leftover minutes split by the mode's percentages (integers, the sum is exact), shares < 20 min merged on. */
export function splitLeftover(minutes: number, mode: 'half_term' | 'school'): Share[] {
  const total = Math.max(0, Math.floor(minutes))
  if (total < MIN_SHARE) return []
  const split = SPLIT[mode]
  const raw = split.map(([, pct]) => Math.floor((total * pct) / 100))
  raw[0] += total - raw.reduce((a, b) => a + b, 0)
  const shares: Share[] = split.map(([kind], i) => ({ kind, minutes: raw[i] }))
  // merge small shares into the next one; a small last share joins the one before
  const out: Share[] = []
  let carry = 0
  shares.forEach((s, i) => {
    const m = s.minutes + carry
    if (m < MIN_SHARE && i < shares.length - 1) { carry = m; return }
    carry = 0
    if (m < MIN_SHARE && out.length) out[out.length - 1].minutes += m
    else out.push({ kind: s.kind, minutes: m })
  })
  return out
}

/** What a share actually got: its kind and the minutes used (a pick), or 0 (nothing to do / no room). */
export type Taken = { kind: ShareKind | 'stretch'; minutes: number }

/**
 * Runs the shares in order. `take(kind, minutes)` places at most `minutes` (it's always ≥ MIN_SHARE, ahead ≥ AHEAD_MIN)
 * and returns how many it used (0 = no candidate / no room). Returns what was taken and the minutes left free.
 */
export function runShares(minutes: number, mode: 'half_term' | 'school', take: (kind: ShareKind | 'stretch', minutes: number) => number): { taken: Taken[]; free: number } {
  const shares = splitLeftover(minutes, mode)
  const taken: Taken[] = []
  let carry = 0
  const toFixing = (i: number, m: number) => {
    const later = shares.slice(i + 1).find((s) => s.kind === 'fixing')
    if (later) later.minutes += m
    else shares.splice(i + 1, 0, { kind: 'fixing', minutes: m })
  }
  for (let i = 0; i < shares.length; i++) {
    const s = shares[i]
    const m = s.minutes + carry
    carry = 0
    if (s.kind === 'ahead') {
      if (m < AHEAD_MIN) { toFixing(i, m); continue }
      const used = clampUse(take('ahead', Math.min(m, AHEAD_MAX)), Math.min(m, AHEAD_MAX))
      if (!used) { toFixing(i, m); continue }
      taken.push({ kind: 'ahead', minutes: used })
      carry = m - used
      continue
    }
    if (m < MIN_SHARE) { carry = m; continue }
    const cap = Math.min(m, SHARE_MAX[s.kind])
    const used = clampUse(take(s.kind, cap), cap)
    if (used) taken.push({ kind: s.kind, minutes: used })
    carry = m - used
  }
  if (carry >= MIN_SHARE) {
    const cap = Math.min(carry, SHARE_MAX.stretch)
    const used = clampUse(take('stretch', cap), cap)
    if (used) taken.push({ kind: 'stretch', minutes: used })
    carry -= used
  }
  return { taken, free: carry }
}

const clampUse = (used: number, max: number) => Math.max(0, Math.min(Math.floor(used || 0), max))
