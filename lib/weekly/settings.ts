// Settings for the weekly check (item 7): editable on the Settings page and by chat ("setting" change), stored in profiles.planning.
// Each entry: the usual setting spec plus its default (lib/settings.ts merges these in). Pure: no database.
import type { ExtraSpec } from '../settings-extra'

export const WEEKLY_SETTINGS: Record<string, ExtraSpec> = {
  weeklyCheck: {
    label: 'Weekly check on your check-in day at the week-reset time (“Plan next week? ✅” then sends Your week)',
    kind: 'choice', group: 'messages', choices: ['on', 'off'], default: 'on',
    help: 'Off = the old way: the Your week card comes by itself on Sunday, plus a check-in reminder.',
  },
}

/** Is the weekly check on? It replaces the automatic Sunday Your week card and the check-in reminder. Read straight
 * from profiles.planning (anything but "off" = on), so lib/settings.ts and this file don't import each other. */
export const weeklyCheckOn = (planning: unknown): boolean =>
  !(planning && typeof planning === 'object' && (planning as Record<string, unknown>).weeklyCheck === 'off')
