// Settings for ACT (item 2): editable on the Settings page and by chat ("setting" change), stored in profiles.planning.
// Each entry: the usual setting spec plus its default (lib/settings.ts merges these in). Pure: no database.
// The defaults follow his brief (19 Oct 2026); the days are guesses he can change ("ACT sessions Mon, Wed, Fri").
// (No imports from lib/settings.ts here: it imports this file. lib/act/config.ts reads the values.)
import type { ExtraSpec } from '../settings-extra'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

export const ACT_SETTINGS: Record<string, ExtraSpec> = {
  actGoal: { label: 'ACT target composite', kind: 'number', group: 'act', min: 1, max: 36, default: 36 },
  actHalfTermMin: { label: 'ACT a day in the holidays (no retake date; the flashcards included)', kind: 'minutes', group: 'act', min: 20, max: 240, default: 75 },
  actSchoolMin: { label: 'ACT session in school weeks (no retake date; the flashcards on top)', kind: 'minutes', group: 'act', min: 10, max: 120, default: 30 },
  actSchoolDays: { label: 'ACT sessions in school weeks on (a guess)', kind: 'list', group: 'act', max: 80, help: 'Days, separated by commas (“tuesday, thursday, saturday”).', default: 'tuesday, thursday, saturday' },
  actFlashMin: { label: 'Grammar flashcards (Anki) a day (0 = off)', kind: 'minutes', group: 'act', min: 0, max: 60, default: 10 },
  actTestDay: { label: 'Weekly full timed ACT test in the holidays on (review the next day)', kind: 'choice', group: 'act', choices: DAYS, default: 'wednesday' },
  actMockDay: { label: 'Retake countdown: full timed mock on (review the next day)', kind: 'choice', group: 'act', choices: DAYS, default: 'wednesday' },
  actScience: { label: 'Full ACT tests include Science', kind: 'choice', group: 'act', choices: ['yes', 'no'], default: 'yes' },
}
