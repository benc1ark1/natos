# Fix round (21 Oct 2026)

Goal: planning the week is one tap and always right. Brief: `assets/my-spec.md` + `CLAUDE.md` (archive never delete,
nothing changes without Nat's ✅, routines are reference only and are not touched).

Real data for every test: `tests/support/nat-real.mjs` (half-term 17 Oct – 1 Nov, ACT Sun 25 Oct, school back Mon 2 Nov).
Three weeks are tested: THIS (19 Oct, the ACT week), NEXT (26 Oct, half-term: Vlad + FM + physics), SCHOOL (2 Nov).

No database changes. New things live in data that already exists:
- **Not before** = the task's `window_start` (already a column). Nothing is planned for a task before that date.
- **Focus period** = a planning setting `focusPeriods: [{ from, until, only }]` ("until 25 Oct only ACT"). The bot sets
  it with a `setting`-style op (`focus_period`, value `until=2026-10-25; only=ACT`, `clear=yes`), shown in Settings
  as a read-only line. It ends by itself after `until`.
- **Later** = status `this_month` (the "Later" column). Later tasks are never planned unless due within the week.

Not in this round: the `/ideas` list (it wasn't pasted). Open App ideas are left as they are.

## Parts (each one is a separate branch, built in parallel, then reviewed)

Files are split so parts don't edit the same code. `lib/telegram/brain.ts` (the bot's instructions) is shared:
each part adds or changes only its own sentences.

### A. Training planner — `lib/optimiser.ts`, `lib/load.ts`, `lib/week.ts`, `lib/setup.ts`, `lib/setup-edit.ts`, `lib/telegram/owen.ts`, `lib/telegram/trainplan.ts`, `lib/telegram/weekread.ts`
- 2 (training half): no gym/training on a test day (ACT Sun 25 Oct); the day before is light only.
- 3: in holidays every school-linked session is off (school football, school gym, `is_school` sessions, free periods),
  and fixed sessions use their holiday version (Owen speed Wed 11:00 in half-term, from `holidayOwenDays`).
- 4: "until <date>" rules expire by themselves: `upperWeeks` 3× until 1 Nov → 2× (Tue + Sat) from 2 Nov; the same for
  any dated rule (holiday days, focus periods, week-only counts).
- 5 (training half): never two of the same session in one day (upper Fri 12:30 *and* 15:00); a week note ("Owen Wed")
  and a planned session for the same thing merge into one.
- 12: tapping 1️⃣ on a clash with a week note fails with `invalid input syntax for type uuid: "week:1"`: week-note
  rows (`week:N` ids from `weekread.ts`) are never sent to the database as ids.
- 15: the "Owen's days may need updating" card only suggests a change that is genuinely better (lower cost, every
  session placed), using the right holiday/term days for that week; no "no room for speed".

### B. Study planner + Your week card — `lib/telegram/yourweek.ts`, `lib/telegram/dayplan.ts`, `lib/telegram/ripple.ts`, `lib/today/*`, `lib/act/*`, `lib/tracker/engine.ts`, `lib/plan.ts`
- 1: respect not-before (`window_start`), Later, and focus periods: nothing for FM/physics/Vlad/HT2 before Mon 26 Oct.
- 2 (study half): a test day (ACT 25 Oct) has nothing but the test; the day before is light.
- 5 (study half): one block per task per day.
- 6: during a focus period, or before a task's not-before date, overdue and Later items don't jump to the top of Today.
- 7: App ideas never become tasks or plan blocks.
- 8: free time in an ACT focus period → ACT blocks (reading, grammar, ACT maths); otherwise free time follows the
  spec order (deadlines → tests/prep → training → this week's priorities → spare-time goals).
- 9: "plan next week" works any day of the week (it refused on a Wednesday).
- 16: "⚠️ Slipped" never lists archived tasks.
- 17: a small edit to the week card re-fits locally (code), without asking the AI again; the AI only runs for a fresh plan.

### C. Bot conversation — `lib/telegram/converse.ts`, `lib/telegram/cards.ts`, `lib/telegram/actions-c2.ts`, `lib/telegram/actions.ts`, `app/api/tg/*`
- 10: a message sent while a card waits is handled on its own, unless it clearly edits that card.
- 11: opening `/app` never applies a waiting card (it said "Your week is set" at 18:19 with no ✅).
- 13: event changes keep the date he gave ("Owen … Wed 28 Oct 11:00" became Tue 27 Oct; "removed a date that wasn't
  in your words").
- 14: clean event titles: "Upper · PureGym", never "Upper (PureGym Swiss Cottage; type=upper)".

### D. Views — `lib/telegram/views.ts`, `lib/today/message.ts`, `lib/today/build.ts` (display only)
- 18: Today is an ordered list with minutes; only fixed events show clock times.
- 19: `/week` shows the planned study and training blocks too (look-ahead), not only bookings.
(Part D only changes how things are shown; part B owns what Today picks.)

### E. Homework and email — `lib/tracker/classroom.ts`, `lib/mail/*`, `google-apps-script/*`, the Inbox page, a `/mail` view
- 20: Classroom homework: the title is the objective/topic (not "Homework from <date>"), the real due date, the
  questions in the notes.
- 21: Sam's homework archives itself (reason `expired`, never deleted) once his next lesson has passed.
- 22: emails where Nat is only CC'd, or that are between other people: no card and no alert; they go in an
  "Emails worth a look" list (Inbox page + `/mail`).

## Tests
Each part adds `tests/fixround-<part>-unit.test.mjs` (and a `-chat` test where the bot is involved) using
`tests/support/nat-real.mjs`, covering every item in that part on THIS / NEXT / SCHOOL weeks. Each part runs its own
tests plus the existing unit tests and the chat tests for the files it touched.

## Order
1. This plan + the shared fixture on `main`.
2. Parts A–E built in parallel (one worktree each); a reviewer checks each part against this plan.
3. Merge all parts, run all unit tests + the relevant chat tests, fix what breaks.
4. Merge to `main`, check the Vercel deploy, write `plans/fix-round-summary.md`.
