// Nat's real autumn 2026 (fix round, 21 Oct): one shared world for the fix-round tests, so every part is tested on the
// same weeks. Half-term Sat 17 Oct – Sun 1 Nov · ACT retake Sun 25 Oct (focus: only ACT until then) · school back Mon 2 Nov.
// Three weeks: THIS (19 Oct, the ACT week) · NEXT (26 Oct, half-term: Vlad + FM + physics, none before Mon 26 Oct) ·
// SCHOOL (2 Nov, the first school week). Plain data only (no database): copy and extend in your own test file; don't
// change what's here (other tests rely on it).
import { addDays } from '../../lib/time.ts'

export const HALF_TERM = { from: '2026-10-17', to: '2026-11-01' }
export const ACT_DAY = '2026-10-25'
export const THIS = '2026-10-19', NEXT = '2026-10-26', SCHOOL = '2026-11-02'
export const TODAY = '2026-10-21'   // Wed of the ACT week
export const day = (mon, i) => addDays(mon, i)   // day(NEXT, 2) = Wed 28 Oct

export const ev = (o) => ({ id: o.id ?? o.title, user_id: 'nat', category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null,
  repeat_days: null, start_time: null, end_time: null, repeat_from: '2026-09-01', repeat_until: null, is_busy: true, travel_minutes: 0,
  target_id: null, archived_at: null, external_source: 'manual', all_day: false, ...o })

/** London clock time on a date → UTC ISO (BST until Sun 25 Oct 01:00 UTC, GMT after). */
export const at = (date, hhmm) => {
  const off = date < '2026-10-25' ? 1 : 0
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10), h - off, m)).toISOString()
}
/** A copy from his school's Google calendar. */
export const g = (title, date, start, end, extra = {}) => ev({ id: `g:${title}:${date}`, title, starts_at: at(date, start), ends_at: at(date, end), external_source: 'google', calendar_id: 'school-cal', ...extra })

const weekdays = (mon) => [0, 1, 2, 3, 4].map((i) => addDays(mon, i))
export const EVENTS = [
  ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:15' }),
  // school football (Tue after school) and the school gym club: school-linked, so off in the holidays
  ev({ id: 'school-football', title: 'School football', repeat_days: [2], start_time: '16:20', end_time: '17:30', training_type: 'football', load: 'hard', is_school: true }),
  ev({ id: 'club-football', title: 'Football training', repeat_days: [1, 3], start_time: '19:00', end_time: '20:30', training_type: 'football', load: 'hard' }),
  ...[addDays(THIS, -7), THIS, NEXT, SCHOOL].flatMap(weekdays).flatMap((d) => [g('School', d, '08:45', '16:15'), g('Maths', d, '08:45', '09:50'), g('Physics', d, '10:05', '11:10')]),
]

export const PLANNING = {
  holidays: `${HALF_TERM.from}..${HALF_TERM.to}`,
  // term: speed Tue 18:30 after school football; half-term: Wed 11:00
  owenDays: { speed: [2], heavy_lower: [4], upper: [2, 6] }, sessionTimes: { speed: { 2: '18:30' } },
  holidayOwenDays: { speed: [3] }, holidaySessionTimes: { speed: { 3: '11:00' } },
  // "upper 3× until 1 Nov" (both half-term weeks), then back to his usual 2× (Tue + Sat)
  upperWeeks: { [THIS]: 3, [NEXT]: 3 },
  // focus period: "until 25 Oct only ACT" (the contract for item 1 / 6 / 8: plans/fix-round.md)
  focusPeriods: [{ from: '2026-10-17', until: ACT_DAY, only: 'ACT' }],
}

export const GOALS = [
  { id: 'act', kind: 'test', title: 'ACT retake', target_date: ACT_DAY, subject_id: 'subj-act' },
  { id: 'ht2', kind: 'test', title: 'FM HT2 test', target_date: '2026-11-04', subject_id: 'subj-fm' },
]

const task = (o) => ({ id: o.id, user_id: 'nat', category_id: null, subject_id: null, title: o.title, details: null, priority: 'medium', status: 'this_week',
  due_at: null, is_key: false, source: 'manual', source_text: null, completed_at: null, archived_at: null, created_at: '2026-10-18T10:00:00Z',
  updated_at: '2026-10-18T10:00:00Z', importance: 'must', window_start: null, window_end: null, window_label: null, origin: 'manual',
  duration_minutes: 60, postpone_count: 0, last_postponed_at: null, target_id: null, goal_id: null, is_system: false, session_no: null,
  archive_reason: null, project_id: null, hand_in: null, hand_in_url: null, needs_sorting: false, ...o })

// "don't start before Mon 26 Oct": window_start = the not-before date
export const TASKS = [
  task({ id: 't-fm', title: 'FM homework: complex numbers ex 2B', subject_id: 'subj-fm', due_at: at('2026-10-30', '23:59'), window_start: NEXT, duration_minutes: 60 }),
  task({ id: 't-phys', title: 'Physics: SHM booklet', subject_id: 'subj-phys', due_at: at('2026-10-29', '23:59'), window_start: NEXT, duration_minutes: 45 }),
  task({ id: 't-vlad', title: 'Vlad: mechanics questions', subject_id: 'subj-phys', due_at: at('2026-10-28', '23:59'), window_start: NEXT, duration_minutes: 60, hand_in: 'email Vlad' }),
  task({ id: 't-ht2', title: 'FM HT2 revision', subject_id: 'subj-fm', goal_id: 'ht2', due_at: at('2026-11-03', '23:59'), window_start: NEXT, duration_minutes: 45 }),
  task({ id: 't-act-read', title: 'ACT reading passage set', subject_id: 'subj-act', due_at: at('2026-10-23', '23:59'), duration_minutes: 40 }),
  task({ id: 't-later', title: 'Sort out UCAS notes', status: 'this_month', importance: 'nice', duration_minutes: 30 }),
  task({ id: 't-overdue', title: 'Chemistry corrections', due_at: at('2026-10-16', '23:59'), duration_minutes: 30 }),   // overdue, but not ACT
  task({ id: 't-archived', title: 'Old essay plan', archived_at: '2026-10-19T09:00:00Z', archive_reason: 'done', postpone_count: 3 }),
]

export const SUBJECTS = [{ id: 'subj-act', name: 'ACT' }, { id: 'subj-fm', name: 'Further Maths' }, { id: 'subj-phys', name: 'Physics' }]
