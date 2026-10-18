# Build O: the week optimiser (final overnight build, 11–12 Oct 2026)

Asked 11 Oct, night: "FINAL OVERNIGHT BUILD" (18 parts). Same rules as before: nothing changes without ✅, archive never
delete, only the Life OS calendar is written, secrets via scripts, no Supabase MCP, one test per fix, full suite once.
The week/day planner and the load planner stay ONE system: `planTraining()` (lib/week.ts) now runs the optimiser, and
every path (Your week card, training card, 🔁, knock-on, Owen days, Insights) goes through it.

## What the real data looks like (read-only check, 11 Oct 23:50)
- All SQL up to build-n has run on the real database. `profiles.planning` is `{}` (every setting is a default).
- Own events: School Mon–Fri 08:45–16:00, CS tutor Mon + Thu 17:30–18:30, Maths tutor Wed 17:00–18:00.
- Google copies that repeat: EFA training (Sun 08:30), EFA football (Tue 17:30), Market Road football (Fri 18:30),
  Games (Wed, school), Elena (Sun 12:00), Jessica (Thu 19:00), Adhd (Mon 18:30), and school lessons.
  No football on Mon/Wed in any calendar (the brief says Mon + Wed): the gap finder asks.
- Targets: Upper 3, Lower + plyo 2, SMC 3, Football 4. No places, no journeys, Whoop not connected, no tests.
- Routines: Morning and Night (habits), 39 blocks, 193 steps; no lengths stored.

## Design (decisions)
- **Everything new is settings or data in `profiles.planning`** (works before any SQL): training places (equipment,
  travel, access), session types (minutes, per week, places, intensity, costs), your day (wake, bed, routine lengths),
  week rhythm (Friday rule, game day + this week's game, Sunday reset), study and travel preferences, mental load
  costs, optimiser weights, ignored read-only sessions, Owen's days. Defaults come from the brief and are marked
  "(guess)" until he answers. All of it is editable by chat (✅ card, ↩️ Undo) and on the Settings page.
- **Card kinds stay the existing ones** (capture/action/plan/type) so nothing needs SQL tonight: gap questions are
  'type' cards, the clean-up / Owen / ROI cards are 'action' cards, Your week / end of day are 'plan' cards.
- **Optimiser** (`lib/optimiser.ts`, pure): day × time × place × intensity for every session type, upper 2× vs 3×,
  scored on recovery (lib/load.ts `assess`), mental load, travel, equipment fit, Friday, routines/sleep, Whoop, his
  rules (weighed). Deterministic, unit-tested on realistic weeks.
- **Mental load** (`lib/mental.ts`, pure): school baseline, tutors, study blocks, tests/mocks, test eves, deadlines.
- **Places**: a session's place goes in its plan block title ("Upper @ PureGym"); leave-by is worked out from the
  setup (no new columns needed).
- **SQL** (`supabase/build-o.sql`): mental cost per session (load_costs.mental), gap answer history, recommendation
  history. The app works before it runs; the 07:00 brief says once to run it.
- **Quiet hours**: nothing new is sent between 21:30 and the brief (except his own reminders and the 21:00 wrap-up).

## Phases
| # | What | Status |
|---|---|---|
| O1 | Setup data + new settings + mental load + ignored sessions + game day + day bounds | built |
| O2 | Optimiser + unit tests (Sunday game, Saturday game, test week, low Whoop, no football) | built |
| O3 | Your week card (Sunday 18:00), ✅ applies all, 🔁 re-fits | built |
| O4 | Gap finder (questions, quick taps, ≤5 a day, guesses, re-optimise after answers) | built |
| O5 | Calendar clean-up card; Owen days card + message | built |
| O6 | Daily: brief + pinned Today timeline with ticks, overload line, 21:00 wrap-up | built |
| O7 | Self-adjusting: low Whoop, homework, cancelled sessions, game moves, answers | built |
| O8 | ROI recommendations, Sunday review lines, Insights on Home, "where can I save time?" | built |
| O9 | Telegram does everything: new changes, views, prompt, audit | built |
| O10 | build-o.sql + reminder | built |
| O11 | Whole-week simulation → qa/WEEK-SIM.md | built (14 issues found and fixed) |
| O12 | Visual check at 390 px | done |
| O13 | Guide + /help | done |
| O14 | Full suite, deploy, handover, morning queue | done |

## Progress

- **O1–O2 (12 Oct, night): built.** `lib/setup.ts` (places with equipment, access and travel; session types with
  minutes, per week, places, needs and wants; Owen's days and Owen's own suggestion; this week's game; ignored
  read-only sessions; each day's shape from wake/bed and the routines), `lib/mental.ts` (🧠 per day),
  `lib/optimiser.ts` (needs from the set-up, place/travel options per day, upper 2× vs 3×, stretching, "vs Owen's
  days", "what other days would cost"), extending `lib/load.ts` (travel and place windows in the search, 🧠, Friday,
  weekend upper, editable weights, a lower bound and an evaluation budget: ~0.2 s a search). `planTraining()` in
  `lib/week.ts` now runs the optimiser, so the training card, Your week, ripple and Owen days are one system.
  Free time everywhere stops at the night routine and starts after the morning one (`PlanningSettings.dayBounds`).
  Guessed "match" sessions that come every week (school Games) count as football until he answers. Recovery: ≥48 h
  between heavy lower, heavy lower and speed never back to back, upper 48 h; football and games count through
  the day/7-day load, CNS spacing and game protection. Going lighter costs 3× for heavy lower / speed / plyo.
- **O3**: the Your week card (`lib/telegram/yourweek.ts`): last week's review, routines, school, events, study
  (planner AI) and training (optimiser) with place and leave-by, 🧠/💪 per day, upper reason, vs Owen; ✅ applies
  everything (and this week's upper count); 🔁 re-fits the rest without another AI call; Sunday at resetAt.
- **O4**: gap finder (`lib/gaps.ts`, `lib/telegram/gapask.ts`): 15+ kinds of question, one at a time, ≤ gapsPerDay,
  never in quiet hours or school, guesses marked, typed answers read strictly (no AI), answers as checked changes
  with Undo, then the next question, then the week again (`lib/telegram/refit.ts`). "stop asking questions" pauses.
- **O5/O7**: clean-up card (`lib/telegram/cleanup.ts`), Owen days card (`lib/telegram/owen.ts`) with re-check.
- **O6/O11/O12**: brief and pinned Today as one timeline (`lib/day.ts`) with ticks (`lib/telegram/ticks.ts`), the
  overload line with a one-tap move, the 21:00 wrap-up, the first-morning queue, low-Whoop and calendar-change
  re-fits, Classroom homework offered a slot (`lib/telegram/schedule.ts`).
- **O8**: suggestions (`lib/roi.ts`, `lib/telegram/roi.ts`), "where can I save time?", Insights on Home
  (`app/api/insights`, `components/home/InsightsCard.tsx`).
- **O9**: new chat changes (setup_set, owen_days, game_week, session_ignore, school_day, upper_week, block_move,
  block_skip, subject_new, target_new, restore, guide_set, load_set mental), plan block (B…) and archived (A…) refs,
  the optimiser's week in every brain call, the load / gaps / savings lists. AI check `tests/ai/build-o.ai.mjs`.
- **O11**: `tests/build-o-weeksim-chat.test.mjs` runs a whole school week through the bot (first-morning queue,
  every brief, ticks, a cancelled session, Classroom homework, a teacher email, a low-Whoop morning, the game moved to
  Saturday, a saving applied, Owen's days, every wrap-up, Sunday's card), checking after every step that nothing
  overlaps, nothing sits on a busy event, the load stays sensible and every message fits a phone. Findings and fixes:
  `qa/WEEK-SIM.md`; every message: `qa/WEEK-SIM-transcript.md`.
- **O12**: visual check at 390 px (Home with Insights, Settings with the new groups and Training set-up, the game).
  See `qa/o-visual.json` and `qa/o-*.png`.
- **O13**: `docs/GUIDE.md` rewritten around the week; `/help` is the one-screen version.
- **O14**: full suite, deploy, this handover.

## Handover (12 Oct, night)

Deployed to production with the Vercel CLI (Nat said go). Nothing was sent overnight: proactive messages wait for
the 07:00 brief, and the first-morning queue only starts after it.

### What arrives at 07:00 on Monday 12 Oct (in this order)
1. The brief (with one line asking to run `build-o.sql`, until it's run).
2. "I need a few details to plan your week properly — 2 min" and the first question (most important first, ≤ 5 today,
   never in school or after 21:30; the rest come later in the day).
3. The calendar clean-up card (EFA training pre-set to Archive).
4. Owen's days (re-sent with your answers if they change the best days; use the newest one).
5. At 07:05: Your week. Re-sent once you've answered the questions, with your answers in.

### Nat to do in the morning
1. **Run `supabase/build-o.sql`** in Supabase → SQL Editor → New query → paste → Run. Safe to re-run; it adds one
   column and two tables, nothing is changed or deleted. Until then the app works, but gap answers aren't kept as
   history, applied/put-off suggestions aren't remembered, and your own 🧠 numbers can't be saved.
2. **Answer the questions** (tap, or type the answer; ✋ Skip for now). The big one: is football really Mon + Wed? Your
   calendars only have EFA football Tue, Market Road football Fri and school Games Wed.
3. **Clean-up card**: Keep or Archive each recurring session (EFA football, Market Road football, Elena, Jessica,
   Adhd, Games, school lessons). Archive on a Google session only means the app ignores it: Google is never edited.
   ✅ Apply (↩️ Undo works).
4. **Owen's days**: ✅ Use these days, then tap the message to copy it and send it to Owen.
5. **Your week**: 🔁 any session you want elsewhere (the rest re-fits), then ✅ Apply → plan, Home, pinned Today,
   Life OS calendar.
6. Anything still a guess is marked "(guess)" in Settings → Training set-up and Your day; "what do you still need to
   know?" lists them.

### Tests (final run, 12 Oct ~02:45)
102 plain + 134 conversations pass (1 skips itself before 07:00), 0 fail; build + 13 Telegram guard tests pass.
The whole-week simulation is one of the conversations (`qa/WEEK-SIM.md`).

### Not changed tonight
No new secrets or keys. Real AI check (`tests/ai/build-o.ai.mjs`) passed 22/22 earlier in the build ($0.91); the
prompts haven't changed since, so it wasn't re-run.
