// His ACT settings, read from profiles.planning and checked (lib/act/settings.ts has the specs and defaults).
// Pure: no database.
import { DAYS_OF_WEEK, daysOf, moreSettings } from '../settings'
import type { ActSettings } from './types'

export const DEFAULT_ACT_SETTINGS: ActSettings = { halfTermMin: 75, schoolMin: 30, schoolDays: [2, 4, 6], flashMin: 10, fullTestDow: 3, mockDow: 3, science: true }
export const DEFAULT_ACT_GOAL = 36

/** His ACT settings (anything missing or odd is the default) and his target composite. */
export function actSettings(planning: unknown): ActSettings & { goal: number } {
  const s = moreSettings(planning) as unknown as Record<string, string | number>
  const days = [...new Set(daysOf(String(s.actSchoolDays ?? '')))].sort((a, b) => a - b)
  const dow = (v: unknown, d: number) => { const i = DAYS_OF_WEEK.indexOf(String(v)); return i >= 0 ? i + 1 : d }
  const num = (v: unknown, d: number) => (Number.isInteger(v) ? Number(v) : d)
  return {
    goal: num(s.actGoal, DEFAULT_ACT_GOAL),
    halfTermMin: num(s.actHalfTermMin, DEFAULT_ACT_SETTINGS.halfTermMin),
    schoolMin: num(s.actSchoolMin, DEFAULT_ACT_SETTINGS.schoolMin),
    schoolDays: days.length ? days : DEFAULT_ACT_SETTINGS.schoolDays,
    flashMin: num(s.actFlashMin, DEFAULT_ACT_SETTINGS.flashMin),
    fullTestDow: dow(s.actTestDay, DEFAULT_ACT_SETTINGS.fullTestDow),
    mockDow: dow(s.actMockDay, DEFAULT_ACT_SETTINGS.mockDow),
    science: s.actScience !== 'no',
  }
}
