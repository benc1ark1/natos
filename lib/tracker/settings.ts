// Settings for the study tracker (item 1): editable on the Settings page and by chat ("setting" change), stored in profiles.planning.
// Each entry: the usual setting spec plus its default (lib/settings.ts merges these in). The review gaps and links
// are the "Start here" tab's (the import fills them in; his own values win). Pure: no database.
import type { ExtraSpec } from '../settings-extra'
import type { Colour, TrackerLinks } from './types'

/** Review gap settings, by colour (Start here §7): 🔴 +1 · 🟡 +3 · 🟢 +14 · ⚪ +7 days. */
export const REVIEW_KEYS: Record<Colour, string> = { not_secure: 'reviewRedDays', understand: 'reviewYellowDays', exam_ready: 'reviewGreenDays', not_started: 'reviewWhiteDays' }

/** The "Start here" links (yellow cells) → their settings. Empty until he pastes them (or imports the sheet). */
export const LINK_KEYS: Record<keyof TrackerLinks, string> = {
  bicenPure: 'linkBicenPure', bicenStats: 'linkBicenStats', bicenMech: 'linkBicenMech', bicenCorePure: 'linkBicenCorePure',
  bicenMemorise: 'linkBicenMemorise', bicenSummaries: 'linkBicenSummaries', bicenHardest: 'linkBicenHardest',
  integralFurther: 'linkIntegralFurther', integralAssessments: 'linkIntegralAssessments', madas: 'linkMadas', step: 'linkStep',
  pmtPhysics: 'linkPmtPhysics', isaac: 'linkIsaac', amsp: 'linkAmsp',
}

const LINK_SPECS: [keyof TrackerLinks, string, 'study' | 'tests'][] = [
  ['bicenPure', 'Link: Bicen 1 Pure – exam questions', 'study'],
  ['bicenStats', 'Link: Bicen 2 Statistics – exam questions', 'study'],
  ['bicenMech', 'Link: Bicen 3 Mechanics – exam questions', 'study'],
  ['bicenCorePure', 'Link: Bicen 4 Core Pure (FM) – exam questions', 'study'],
  ['bicenMemorise', 'Link: Bicen Everything You Need To Memorise', 'study'],
  ['bicenSummaries', 'Link: Bicen 5 Chapter Summaries', 'study'],
  ['bicenHardest', 'Link: Bicen 9 Hardest Questions (stretch)', 'study'],
  ['integralFurther', 'Link: Integral Further Statistics + Mechanics', 'study'],
  ['integralAssessments', 'Link: Integral Topic Assessments (prove it)', 'tests'],
  ['madas', 'Link: MadAs (stretch)', 'study'],
  ['step', 'Link: STEP Support – Foundation', 'study'],
  ['pmtPhysics', 'Link: PMT CAIE Physics topic questions', 'study'],
  ['isaac', 'Link: Isaac Physics', 'study'],
  ['amsp', 'Link: AMSP Further Maths videos', 'study'],
]

export const TRACKER_SETTINGS: Record<string, ExtraSpec> = {
  reviewRedDays: { label: 'Review a 🔴 topic after (days)', kind: 'number', group: 'study', min: 1, max: 60, default: 1 },
  reviewYellowDays: { label: 'Review a 🟡 topic after (days)', kind: 'number', group: 'study', min: 1, max: 60, default: 3 },
  reviewGreenDays: { label: 'Review a 🟢 topic after (days)', kind: 'number', group: 'study', min: 1, max: 90, default: 14 },
  reviewWhiteDays: { label: 'Review a ⚪ topic after (days)', kind: 'number', group: 'study', min: 1, max: 60, default: 7 },
  nextUpDays: { label: 'A topic is ⏭ Next up when school teaches it within (days)', kind: 'number', group: 'study', min: 1, max: 60, default: 21 },
  testWindowDays: { label: 'A test this close takes over the plan (days)', kind: 'number', group: 'tests', min: 3, max: 42, default: 21 },
  ...Object.fromEntries(LINK_SPECS.map(([k, label, group]) => [LINK_KEYS[k], { label, kind: 'text', group, max: 500, help: 'Paste the link (https://…). Empty = the planner names the resource without a link.', default: '' } satisfies ExtraSpec])),
}

const URL_RE = /^https?:\/\/\S+$/i

/** The links from his settings values (moreSettings(planning)): anything that isn't an http(s) link counts as empty. */
export function linksFrom(values: Record<string, string | number>): TrackerLinks {
  const out = {} as TrackerLinks
  for (const [k, key] of Object.entries(LINK_KEYS) as [keyof TrackerLinks, string][]) {
    const v = typeof values[key] === 'string' ? (values[key] as string).trim() : ''
    out[k] = URL_RE.test(v) ? v : ''
  }
  return out
}

/** The review gaps from his settings values. */
export function reviewDaysFrom(values: Record<string, string | number>): Record<Colour, number> {
  const out = {} as Record<Colour, number>
  for (const [c, key] of Object.entries(REVIEW_KEYS) as [Colour, string][]) out[c] = Number(values[key] ?? TRACKER_SETTINGS[key].default)
  return out
}
