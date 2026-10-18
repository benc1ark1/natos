// The made-up week every AI check uses (Sat 10 Oct 2026, 16:05 London): the snapshot the brain reads,
// its refs, and the same calendar as event rows so the app's free-time code can work it out.
const snapshot = `Now: Sat 10 Oct 2026-10-10, 16:05 (Europe/London). Weeks run Mon–Sun; this week started Mon 5 Oct.

## Open tasks (earliest deadline first)
T1 | Physics homework | must · due Fri (Fri 16 Oct) · ~45 min · Physics · from maths/physics tutor (Vlad) · column: This week · added 9 Oct
T2 | SMC past paper 2023 | must · due Wed (Wed 14 Oct) · ~90 min · column: This week · postponed 3× · added 1 Oct
T3 | Email Mr Khan about UCAS | nice · no date · column: Today · added 8 Oct

## Inbox (unsorted captures and dateless ideas)
T4 | Look up the vectors video | nice · no date · column: Inbox · added 10 Oct

## Someday backlog (never urgent; 1 items, newest 15 shown)
T5 | Learn guitar | nice · no date · column: Someday · added 2 Oct
T6 | Book physio | must · due Tue (Tue 13 Oct) · project: Football comeback · column: This week · added 7 Oct

## Projects
P1 | Football comeback

## This week’s training / weekly targets (done/target)
W1 | Football (football) | 1/2 · counted from calendar sessions (fixed, not something to schedule)
W2 | Upper body (gym) | 0/2 · counted from his Log taps / captures
W3 | Lower (gym) | 0/2 · counted from his Log taps / captures

## Goals and tests
G1 | TEST: Physics test: forces | Thu 15 Oct (in 5 days) · priority high · Physics · prep sessions done 1/3

## Calendar, next 14 days (fixed: never move these)
Sat 10 Oct (today): nothing booked
Sun 11 Oct: nothing booked
Mon 12 Oct: 08:40–15:30 School; 17:00–18:00 CS tutor
Tue 13 Oct: 08:40–15:30 School; 18:00–19:30 Owen training (+20 min travel each way) [counts toward Football]
Wed 14 Oct: 08:40–15:30 School; 17:00–18:00 Vlad (maths/physics tutor)
Thu 15 Oct: 08:40–15:30 School; 18:00–19:30 Football (+25 min travel each way) [counts toward Football]
Fri 16 Oct: 08:40–15:30 School
Sat 17 Oct: 10:00–11:30 Match (+30 min travel each way) [counts toward Football]

## Events (refs for changes)
E1 | School | every Mon + Tue + Wed + Thu + Fri 08:40–15:30
E2 | CS tutor | every Mon 17:00–18:00
E3 | Owen training | every Tue 18:00–19:30 · +20 min travel
E4 | Vlad (maths/physics tutor) | every Wed 17:00–18:00
E5 | Football | every Thu 18:00–19:30 · +25 min travel
E6 | Match | one-off Sat 17 Oct 10:00–11:30 · +30 min travel

## Reminders (nudges, not work)
M1 | give back the charger | next time he sees Sam
M2 | Bring PE kit | Fri 16 Oct

## Facts about Nat (these override the default rules)
- Vlad is my maths and physics tutor.`

const refs = new Map([
  ['T1', { kind: 'task', id: 't1', title: 'Physics homework', status: 'this_week', deadline: '2026-10-16' }],
  ['T2', { kind: 'task', id: 't2', title: 'SMC past paper 2023', status: 'this_week', deadline: '2026-10-14' }],
  ['T3', { kind: 'task', id: 't3', title: 'Email Mr Khan about UCAS', status: 'today', deadline: null }],
  ['T4', { kind: 'task', id: 't4', title: 'Look up the vectors video', status: 'inbox', deadline: null }],
  ['T5', { kind: 'task', id: 't5', title: 'Learn guitar', status: 'someday', deadline: null }],
  ['T6', { kind: 'task', id: 't6', title: 'Book physio', status: 'this_week', deadline: '2026-10-13' }],
  ['W1', { kind: 'target', id: 'w1', title: 'Football', status: null, deadline: null }],
  ['W2', { kind: 'target', id: 'w2', title: 'Upper body', status: null, deadline: null }],
  ['W3', { kind: 'target', id: 'w3', title: 'Lower', status: null, deadline: null }],
  ['M1', { kind: 'reminder', id: 'm1', title: 'give back the charger', status: null, deadline: null }],
  ['M2', { kind: 'reminder', id: 'm2', title: 'Bring PE kit', status: null, deadline: null }],
  ['P1', { kind: 'project', id: 'p1', title: 'Football comeback', status: null, deadline: null }],
  ['E1', { kind: 'event', id: 'School', title: 'School', status: null, deadline: null }],
  ['E2', { kind: 'event', id: 'CS tutor', title: 'CS tutor', status: null, deadline: null }],
  ['E3', { kind: 'event', id: 'Owen training', title: 'Owen training', status: null, deadline: null }],
  ['E4', { kind: 'event', id: 'Vlad (maths/physics tutor)', title: 'Vlad (maths/physics tutor)', status: null, deadline: null }],
  ['E5', { kind: 'event', id: 'Football', title: 'Football', status: null, deadline: null }],
  ['E6', { kind: 'event', id: 'Match', title: 'Match', status: null, deadline: null }],
  ['G1', { kind: 'goal', id: 'g1', title: 'Physics test: forces', status: null, deadline: '2026-10-15' }],
])
export const ctx = { today: '2026-10-10', weekStart: '2026-10-05', snapshot, refs }

const ev = (o) => ({
  id: o.title, category_id: null, subject_id: null, location: null, starts_at: null, ends_at: null, repeat_days: null,
  start_time: null, end_time: null, repeat_from: null, repeat_until: null, is_busy: true, travel_minutes: 0, target_id: null, archived_at: null, ...o,
})
export const events = [
  ev({ title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:40', end_time: '15:30' }),
  ev({ title: 'CS tutor', repeat_days: [1], start_time: '17:00', end_time: '18:00' }),
  ev({ title: 'Owen training', repeat_days: [2], start_time: '18:00', end_time: '19:30', travel_minutes: 20 }),
  ev({ title: 'Vlad (maths/physics tutor)', repeat_days: [3], start_time: '17:00', end_time: '18:00' }),
  ev({ title: 'Football', repeat_days: [4], start_time: '18:00', end_time: '19:30', travel_minutes: 25 }),
  ev({ title: 'Match', starts_at: '2026-10-17T09:00:00Z', ends_at: '2026-10-17T10:30:00Z', travel_minutes: 30 }),
]
export const now = new Date('2026-10-10T15:05:00Z')   // 16:05 London

// The same records as rows, so the AI checks can run the real change checks (lib/telegram/actions.ts).
const task = (o) => ({
  user_id: 'u', category_id: null, subject_id: null, details: null, priority: 'medium', status: 'this_week', due_at: null, is_key: false,
  source: 'test', source_text: null, completed_at: null, archived_at: null, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-01T10:00:00Z',
  importance: 'nice', window_start: null, window_end: null, window_label: null, origin: 'own', duration_minutes: null, postpone_count: 0,
  last_postponed_at: null, target_id: null, goal_id: null, is_system: false, session_no: null, archive_reason: null, project_id: null,
  hand_in: null, hand_in_url: null, needs_sorting: false, ...o,
})
export const rows = {
  tasks: new Map([
    task({ id: 't1', title: 'Physics homework', importance: 'must', due_at: '2026-10-16T12:00:00Z', duration_minutes: 45, origin: 'tutor_maths_physics' }),
    task({ id: 't2', title: 'SMC past paper 2023', importance: 'must', due_at: '2026-10-14T12:00:00Z', duration_minutes: 90, postpone_count: 3 }),
    task({ id: 't3', title: 'Email Mr Khan about UCAS', status: 'today' }),
    task({ id: 't4', title: 'Look up the vectors video', status: 'inbox' }),
    task({ id: 't5', title: 'Learn guitar', status: 'someday' }),
    task({ id: 't6', title: 'Book physio', importance: 'must', due_at: '2026-10-13T12:00:00Z', project_id: 'p1' }),
  ].map((t) => [t.id, t])),
  reminders: new Map([
    { id: 'm1', body: 'give back the charger', kind: 'person', person: 'Sam', remind_on: null, remind_at: null, done_at: null, created_at: '' },
    { id: 'm2', body: 'Bring PE kit', kind: 'day', person: null, remind_on: '2026-10-16', remind_at: null, done_at: null, created_at: '' },
  ].map((r) => [r.id, r])),
  projects: new Map([['p1', { id: 'p1', name: 'Football comeback', category_id: null, notes: null, sort_order: 0, archived_at: null, created_at: '' }]]),
  goals: new Map([['g1', { id: 'g1', title: 'Physics test: forces', kind: 'test', target_date: '2026-10-15', topics: null, archived_at: null, priority: 'high', subject_id: null, project_id: null, created_at: '' }]]),
  changes: [],
  targets: new Map([
    ['w1', { id: 'w1', name: 'Football', target_count: 2, counts_from: 'events' }],
    ['w2', { id: 'w2', name: 'Upper body', target_count: 2, counts_from: 'logs' }],
    ['w3', { id: 'w3', name: 'Lower', target_count: 2, counts_from: 'logs' }],
  ]),
}
rows.events = new Map(events.map((e) => [e.id, { ...e, external_source: 'manual' }]))
