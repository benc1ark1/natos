// Settings for the weekly check (item 7): editable on the Settings page and by chat ("setting" change), stored in profiles.planning.
// Each entry: the usual setting spec plus its default (lib/settings.ts merges these in). Pure: no database.
import type { ExtraSpec } from '../settings-extra'

export const WEEKLY_SETTINGS: Record<string, ExtraSpec> = {}
