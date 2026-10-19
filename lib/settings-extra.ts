// Settings added by the queue items (plans/contracts.md §4), each in its own file so they never edit the same lines.
// lib/settings.ts merges them into SETTINGS (spec) and the defaults, so the Settings page, the bot's "setting" change
// and settingsForAI pick them up with no other change. Pure: no database.
import type { Spec } from './settings'
import { TRACKER_SETTINGS } from './tracker/settings'
import { ACT_SETTINGS } from './act/settings'
import { TODAY_SETTINGS } from './today/settings'
import { GYM_SETTINGS } from './gym/settings'
import { WEEKLY_SETTINGS } from './weekly/settings'
import { MAIL_SETTINGS } from './mail/settings'

export type ExtraSpec = Spec & { default: string | number }

export const EXTRA_SETTINGS: Record<string, ExtraSpec> = { ...TRACKER_SETTINGS, ...ACT_SETTINGS, ...TODAY_SETTINGS, ...GYM_SETTINGS, ...WEEKLY_SETTINGS, ...MAIL_SETTINGS }
