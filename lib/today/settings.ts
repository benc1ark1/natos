// Settings for Today and the morning/evening messages (item 5): editable on the Settings page and by chat ("setting" change), stored in profiles.planning.
// Each entry: the usual setting spec plus its default (lib/settings.ts merges these in). Pure: no database.
// (The morning message's time is the core setting briefAt, 07:30; the evening one is endOfDayAt, 21:00.)
import type { ExtraSpec } from '../settings-extra'

export const TODAY_SETTINGS: Record<string, ExtraSpec> = {
  todayItems: { label: 'Things on Today (the morning message and Home)', kind: 'number', group: 'planning', min: 3, max: 5, default: 5,
    help: 'At most this many: the rest waits (“+2 more”).' },
  // a guess (marked): this half-term, 17 Oct – 1 Nov 2026. He changes it on Settings or by chat ("half-term is 24 Oct to 1 Nov").
  holidays: { label: 'Holidays (no school: half-term mode)', kind: 'list', group: 'day', max: 300, default: '2026-10-17..2026-11-01',
    help: 'Date ranges, separated by commas (“2026-10-17..2026-11-01, 2026-12-19..2027-01-03”), or “none”. The default is a guess.' },
  holidayWakeAt: { label: 'Wake up on holidays (the morning message waits until then)', kind: 'time', group: 'day', default: '09:00' },
  holidayTrainingFrom: { label: 'On holidays, gym can be from (never earlier; your usual gym time is still preferred)', kind: 'time', group: 'training', default: '12:00' },
}
