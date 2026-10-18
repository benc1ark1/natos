# Jarvis plan (my-spec section 44)

Approved 10 Oct 2026. Builds on sections 28, 31, 33/42, 34, 38, 39, 40, 41.
Every CLAUDE.md rule still applies: nothing changes without your ✅, archive never delete, never touch
calendars outside "Life OS", keys server-side only, owner-only row level security on every new table.

## How it works (all phases)

- **One brain per message.** Every Telegram message goes to the stronger model once, with: the last ≤10
  messages from the past 30 minutes, any open card, and a compact view of your data. It returns one of:
  new item · question · correction · instruction (change existing items) · chat · unclear (asks one question).
- **The cheap model only sorts.** A *new item* still goes through today's capture (Haiku 4.5) to fill in
  subject, dates, minutes etc., so the dashboard and the bot keep one sorter.
- **AI proposes, code checks.** Times, free slots, travel, clashes and training rules are worked out by
  plain code, never by the model's arithmetic. Every proposed change must point at a real record. Anything
  that fails a check is dropped or turned into a clash with 2 options.
- **One card per change.** Changes arrive as one message: each line "before → after", then
  ✅ Apply · ✏️ Change · ✖ Cancel. After Apply: "Done" + ↩️ Undo. There is no delete action at all.
  (One existing exception, same as the dashboard today: Undo of a "did football" log removes that log entry.)
- **Usage meter + daily cap.** Every AI call is logged with its cost. `/usage` shows today and this month.
  Past your daily cap the bot switches to rule-based answers and says so.

## Phases (recommended order)

| # | Phase | New SQL | Needs Step 11 / Whoop? |
|---|---|---|---|
| A | Conversation core + the 3 bug fixes | yes | no |
| B | See everything (questions) | none | no (better after 11) |
| C1 | Act on tasks, reminders, projects, logging | yes (small) | no |
| C2 | Act on events, goals, tests | none | no (Google sync after 11) |
| D1 | Plan my day, "I've got 2 hours", ill/tired | yes | no (Whoop later) |
| D2 | Ready for anything: change → ripple → re-plan week, training rules, clashes | yes | no (better after 11; Whoop later) |
| E | Places, travel, leave-by (E1 manual; E2 maps service) | yes | no |
| B2 | Pinned live "Today" message (added 10 Oct) | yes (small) | no |
| F | Telegram Mini App: dashboard inside Telegram (added 10 Oct) | none | no |

Build order: A → B → **B2** → C1 → C2 → D1 → D2 → E1 → E2 → **F**.

Why this order: A is the base everything else uses and fixes the bugs. B is read-only (safe) and builds the
free-time code that D needs. C adds changes with Undo before D starts moving many things at once. E improves
travel accuracy, but D already works with today's per-event travel minutes.

---

### A. Conversation core
**You can say**
- "Physics homework due Friday" → card. Tap ✏️ Edit → "make it Thursday" → the card is corrected (not a new item).
- "Can you move it as a real task" while a card is open → the card becomes a task.
- "That's okay maybe", "thanks", "hmm" → a short reply; never saved.
- Something unclear → one short question ("The Physics test or the Physics homework?").
- `/cancel` drops what's in progress. `/usage` shows AI spend. `/add`, `/ask`, `/brief`, `/help` still work.

**Fixes:** ✏️ Edit now waits for your correction (30 min); meta-messages are never saved (the brain
decides, plus a code guard for "can you…", "that's…", "ok", "maybe", "thanks"); memory for "it / that one".
Messages are handled in the order you send them.

**SQL** (`supabase/jarvis-a.sql`): `telegram_turns` (your messages and the bot's replies, with the records
each one was about); `telegram_pending` gets statuses `editing` and `replaced`; `ai_usage` (one row per AI
call: model, tokens, cost); `profiles.ai_daily_cap_usd`. New tables are added to "Export my data".

**Tests:** your two bug conversations replayed word for word; Edit flow; double-tap; stale card after 30
min; nothing saved before ✅; daily cap reached. AI check: ~40 labelled messages; ≥95% routed right and
**100%** of meta-messages never saved.

### B. See everything
**You can say:** "What should I do now / today / tonight?", "Do I have time for X?", "What's coming up?",
"Am I ahead or behind?", "What have I been postponing?", "What's next on Football comeback?",
"What's in my inbox?", "Show my week", "When am I free tomorrow?"

- Instant and free (plain code, no AI): inbox, my week, coming up, free time, project next action,
  postponing list.
- Brain: what to do now/tonight, do I have time, ahead/behind, trade-offs and push-back
  ("Postponed 3×: do it tonight or drop it?"). The morning brief gets one push-back line (rule-based).
- New free-time code: busy = events + travel both ways + 10-min buffers; your evening cut-off and
  school-night limits come from facts (defaults from section 41).

**SQL:** none. **Tests:** free time across moved/cancelled events and clock-change days; each question as a
simulated conversation; every record mentioned must exist. **Step 11:** works on app events now; lessons and
free periods become exact once the school calendar is read in Step 11.

### C1. Act on tasks, reminders, projects, logging
**You can say:** "Move physics homework to tomorrow", "Done with the SMC paper", "Drop the guitar idea",
"Star it", "Make it 45 min", "Add this to Football comeback", "New project: learn music production, someday",
"PE kit reminder Thursday not Friday", "Tick the Sam reminder", "Did football", "Coach set 3 lower this week".

Each change runs through the same code the dashboard uses (move, complete, archive, star, project, reminder,
log), with its own Undo. "Drop" archives the task with reason "dropped" (visible in Archive, never deleted).

**SQL** (`supabase/jarvis-c1.sql`): task archive reason `dropped`; card kind `action`.
**Tests:** every action applied and undone on a real test database (the database must confirm both);
"it/that one" resolution; a stranger's record can never be touched; no delete code anywhere.

### C2. Act on events, goals, tests
**You can say:** "Owen moved training to Thursday 6pm this week", "Match cancelled Saturday",
"CS tutor is off this week", "Dentist Tuesday 3pm", "Physics test moved to Monday" (its prep sessions
re-plan), "Add topics to the Physics test", "Archive the SMC goal".

Only changes the event itself here; re-planning around it is D2. **SQL:** none.
**Step 11:** until then these are app events only. After Step 11, changes sync to "Life OS"; school and
other calendars stay read-only ("That's on your school calendar, so I can't change it").

### D1. Plan my day
**You can say:** "Plan my day", "Plan my evening", "I've got 2 hours now", "I'm ill today",
"I'm wrecked after training", "Free period cancelled", "I'm behind, re-plan tonight".

The brain picks *what* (deadlines → tests → training → priorities); code places it into real free slots
(buffers, ~2–3 h focused work on school nights, nothing heavy after ~21:30) and checks the rules. The card
shows a timeline. Apply saves the plan, moves those tasks to Today, and Home + the morning brief show it.
"Ill/tired" is saved for that day and makes the plan lighter.

**SQL** (`supabase/jarvis-d1.sql`): `plan_blocks` (date, start, end, what, status) and `day_state`
(date, energy, note). **Tests:** no overlaps with events + travel (100%), cut-offs respected (100%),
clock-change days. **Whoop:** later replaces "I'm tired" with recovery data.

### D2. Ready for anything
**You can say:** "Owen moved training to Thursday 6pm", "Match cancelled Saturday", "Physics test moved to
Monday", "Vlad set extra homework due Wednesday", "I'm ill", "CS tutor off this week".

One card shows the change **and** everything it knocks on (gym sessions, prep sessions, homework blocks),
each with a reason. A clash says so and offers 2 options as buttons. Training rules from section 31 become
editable data that code enforces (no heavy lower the day before a sprint or match; one hard session a day;
lighter day after a double; sprint/plyo when fresh; Upper OK on football days). You can change a rule by
saying it ("no plyo within 24 h of a match") → card. "TBC" sessions are allowed without forcing a day.

**SQL** (`supabase/jarvis-d2.sql`): training type + load on targets and events (match, sprint, football,
upper, lower, plyo…; hard/light), `training_rules` (seeded with the 5 rules above as editable defaults).
**Tests:** every spec example as a conversation; each rule broken on purpose and caught; clash → 2 options;
~15 scripted weeks, 100% rule-compliant after the checks. **Step 11:** afterwards, a change Owen makes in
Google Calendar can trigger "Owen moved Tuesday's session, re-plan?". **Whoop:** low recovery → lighter swap.

### E. Places, travel, leave-by
**E1 (free, no key):** saved places (home, school, football, Owen's track, tutors) and minutes between them,
entered once by message ("school to football is 25 min by bus"). Travel then comes from where you'll actually
be before each event. "Leave by 17:05 for football" in the brief and as a Telegram alert. "Do I have time for
SMC before training?" uses it. **SQL** (`supabase/jarvis-e.sql`): `places`, `travel_times`, `events.place_id`.

**E2: Uber or tube/bus?** For each trip, compare an Uber (Mapbox driving time with traffic + ~5 min pickup wait)
with TfL public transport, recommend one, and base "leave by" on it. Public transport wins if it's as fast or
"nearly as fast": within 10 min of the Uber, an editable setting. Asked once per pair of places and time of day,
refreshed monthly (a few dozen requests a month, so £0 on the free tiers). Uber's own price/ETA API isn't open to
personal apps, so the Uber time is an estimate:

| Service | Covers | Free tier | Card needed | Key |
|---|---|---|---|---|
| TfL Unified API | London public transport | free (500 req/min with a free key) | no | free app key |
| Mapbox Directions | walk, cycle, drive (no public transport) | 100,000/month | no | access token |
| Google Routes API | walk, drive, public transport | 10,000/month basic, 5,000 traffic-aware (public transport's tier not confirmed yet) | **yes** (billing account) | API key, Routes only |

**Decided:** Mapbox (driving with traffic) + TfL (tube/bus): both free, no card. All keys server-side only,
in `.env.local` and Vercel. **Changed 10 Oct:** Mapbox's terms say Directions results may only be used with a
Mapbox map and may not be stored, so it can't be used for a text bot. Built instead: TfL (open data, may be
stored) + postcodes.io (free, no key, open data) for positions; Uber times from your own estimates
("an Uber to the match is 20 min") for now. Driving service still to decide (see Progress, E).

### B2. Pinned "Today" message (added 10 Oct; straight after B)
One message pinned at the top of the chat that the bot keeps editing: **next thing** (and when), **today's
tasks** (musts first), **leave-by** for the next event with travel. Fits right after B because it is B's
"now / today / free time" code shown live. D1 later adds the planned blocks; E adds better leave-by times.
- Updates whenever something changes: straight after any ✅ in the bot, and on the 5-minute tick (which also
  catches dashboard changes and the clock moving the "next thing" on). It's only edited if the text changed,
  and editing never makes your phone buzz.
- A fresh one is pinned with the 07:00 brief each morning (yesterday's is unpinned, never deleted).
- **SQL:** 3 columns on `telegram_state` (pinned message number, date, last text's fingerprint). **AI:** none,
  so free. **Tests:** simulated chat checks pin/edit calls, "only edits when changed", day rollover, BST/GMT.

### F. Telegram Mini App (added 10 Oct; after E, or earlier if you want it sooner: it doesn't depend on B–E)
An "Open dashboard" button (menu button + under the brief) opens the app inside Telegram, already signed in.
- Owner-only: Telegram signs the data it hands the Mini App with the bot token. The server checks that
  signature, that it is under 5 minutes old, and that the Telegram user is you (TELEGRAM_OWNER_ID). Then it
  opens your normal session (the same way the bot does). Anyone else just sees the normal login page.
- The service key still lives only in `lib/telegram/owner-session.ts`. No new keys; no SQL.
- **Tests:** forged, tampered, expired and other-person data all refused (and they never reveal why);
  your data gets a session; the guard test still finds the service key in exactly one file.
- One BotFather step for you (set the Mini App / menu button URL), or the bot sets its own menu button.

---

## Models and cost (estimates; Phase A's meter shows the real numbers)

**Decided:** Sonnet 5.5 for chat, Opus 5.5 for planning, Haiku 4.5 for sorting; daily cap $1.50. The models
are one line each in `lib/ai/models.ts`, so either can be switched later.

| Job | Model | Price per million tokens (in / out) |
|---|---|---|
| Brain: every message (routing, answers, action cards) | **Sonnet 5.5** | $2 / $10 |
| Planning (D1, D2: plan my day/week, re-plans) | **Opus 5.5** (medium effort) | $4 / $20 |
| Quick sorting of new items (as now) | Haiku 4.5 | $1 / $5 |

Both Opus 5.5 and Sonnet 5.5 read cached input at $0.20 per million, so back-to-back messages are cheap.
Assumptions: ~8k tokens in and ~600 out per message (half within 5 min of the last, so cached),
~15k in / 3k out per plan (+30% for one fix-up), ~5 new items a day.

| Typical day (20 messages, 2 plans) | Per day | Per month |
|---|---|---|
| Opus brain + Opus planning | ~$1.05 | ~$32 |
| **Sonnet brain + Opus planning (chosen)** | **~$0.70** | **~$21** |
| Sonnet brain + Sonnet planning | ~$0.55 | ~$16 |

A busy day (50 messages, 5 plans) is about 2.5× that. Per phase: A–C cost the per-message figure; D adds the
plan calls; B's instant answers and all of E are free. Building and testing: AI test runs cost about $2 each
on Opus; I'll keep it under $10 per phase and report the actual spend.

## Testing (every phase)

1. **Plain tests** (free, run every change): routing clean-up, checks, free time, scheduler, rules, travel.
2. **Simulated Telegram conversations** (free): the real bot code against a fake Telegram and a scripted
   model, on a **test database** (a second free Supabase project, "nat-os-test"): messages and taps in,
   replies and database state checked.
3. **AI checks** (small cost, end of each phase): real model, labelled phrases and scripted weeks, pass marks
   as listed per phase.

The existing guard tests (secret, owner-only, service key in one file, no keys in browser code) keep running.

## Working rhythm after you approve

- I build A → B → B2 → C1 → C2 → D1 → D2 → E1 → E2 → F in order. After each phase: tests pass, then a commit. No deploys.
- SQL: I write each phase's file and apply it **only to the test database** myself. You review and run all of
  it on the real database once, at the end, right before deploy.
- I stop only for: SQL you need to run, a decision only you can make, or tests still failing after 2 tries.
- At the end: one short list of things to try on your phone, then deploy only after you say go.

## Progress

- **A (10 Oct): built, not deployed.** Brain = `lib/telegram/brain.ts` (Sonnet 5.5, one call per message, cached
  prompt + snapshot), memory + in-order queue = `lib/telegram/turns.ts`, cards + taps = `lib/telegram/cards.ts`,
  routing = `lib/telegram/converse.ts`, models = `lib/ai/models.ts`, meter + cap = `lib/ai/usage.ts`.
  SQL `supabase/jarvis-a.sql` (applied to the test database only). ✏️ Edit now keeps the card waiting
  (status `editing`) with ✅ Save as is / ✖ Cancel; a correction replaces the card (`replaced`).
  New commands: /cancel, /usage, /cap. Tests: `npm run test:unit` (15), `npm run test:chat` (20 simulated
  conversations on the test database), `npm run test:ai` (real model, 41 labelled messages: 41/41 routed
  right on two runs, 0 meta-messages saved, ~$0.09 a run). Also: a captured task with no date now goes to
  Later, not Inbox (my-spec 38: Inbox is only for unsorted captures and dateless ideas).
- **B (10 Oct): built, not deployed.** Free time = `lib/freetime.ts` (busy = event + travel both ways +
  buffers; cancelled/moved sessions; school nights; London wall-clock, so clock changes need nothing special).
  Instant lists, no AI = `lib/telegram/views.ts`: inbox, week, coming up, free time, postponed (push-back at 3×),
  a project's next step, today; spotted word for word or by /inbox /week /coming /free /postponed /next /today,
  and they work past the daily cap. Other wording goes to the brain, which gets 7 days of computed free time
  and can ask for an exact list ("show"). Morning brief: one push-back line. The AI's snapshot now includes
  projects. SQL `supabase/jarvis-b.sql` (one column: `profiles.planning`, the free-time settings; empty = the
  my-spec 41 defaults). Tests: 16 plain, 12 conversations, AI check 8/8 lists + every "do I have time" right.
- **B2 (10 Oct): built, not deployed.** `lib/telegram/pinned.ts`: one pinned "Today" message a day (now / next
  event / leave-by as a fixed time / to-do, musts first), edited in place only when its text changes: after a
  ✅ in the bot, on /pin, and on the 5-minute tick (dashboard changes, events passing). A new day's message
  starts from 07:00 (or when you do something); yesterday's is unpinned, never deleted. If you delete it, a new
  one is pinned. SQL `supabase/jarvis-b2.sql` (3 columns on `telegram_state`). No AI, so free.
  Tests: 5 plain, 7 conversations (each deliberately broken once to prove the tests catch it).
- **C1 (10 Oct): built, not deployed.** `lib/telegram/actions.ts`: the brain proposes changes by ref (tasks T…,
  reminders M…, projects P…, targets W…); plain code checks each one (real record, dates from your words, sane
  values) and shows one "before → after" card. ✅ Apply uses the dashboard's own functions, all or nothing;
  ↩️ Undo puts back exactly what changed, unless it was changed again since. Changes: complete, drop (archived
  as "Dropped", never deleted), move, due date (column follows the date), star, minutes, must/nice, project,
  rename, new project (Undo archives it), tick a reminder, move a reminder (day/time/person), archive a project,
  this-week-only target number ("coach set 3 lower this week": new `target_weeks`, the usual number unchanged).
  "Did football" logs get ↩️ Undo (removes just that log, as on the dashboard). ✏️ Change corrects the list.
  Archive labels dropped tasks and leaves them out of "done". SQL `supabase/jarvis-c1.sql`.
  Tests: 9 plain, 14 conversations (each change applied and undone on the test database; stranger's task
  untouchable; rollback; double taps), AI check 16/16 right, 0 wrong records finished.
- **C2 (10 Oct): built, not deployed.** `lib/telegram/actions-c2.ts`, same card / ✅ Apply / ↩️ Undo as C1:
  move a session this week only (or every week), cancel a session this week (a one-off or "stop it" is
  archived), new one-off events ("dentist Tuesday 3pm", 1 h unless you say), move a test (prep sessions
  re-plan: shared `replanTest` in lib/prep.ts, now also used by the test sheet), topics, archive a goal.
  Events get refs (E…) in the AI's snapshot; Google events are read-only. Fixed on the way: a session moved to
  another day couldn't be found again, and a failed card whose put-back also failed would have said
  "Nothing changed": it now names what couldn't be put back. SQL: none.
  Tests: 7 plain, 8 conversations (+1 for the put-back message), AI check 10/10, 0 wrong events cancelled.
- **D1 (10 Oct): built, not deployed.** "Plan my day / evening / tomorrow", "I've got 2 hours now", "I'm ill",
  "I'm wrecked". Sonnet spots it; the planner (`lib/telegram/planner.ts`, Opus 5.5) picks what, in order, from
  your records; `lib/plan.ts` places it into real free time (buffers, nothing heavy after 21:30, school-night
  focus limit, less when tired, only light things when ill, rest at the end of the day, after school on school
  days unless you ask for the morning) and re-checks every rule. One timeline card; ✅ saves the blocks
  (`plan_blocks`; an older plan becomes 'replaced'), moves today's tasks to Today, saves how you feel
  (`day_state`); ↩️ Undo puts it all back. ✏️ Change re-plans with your words. Shown on Home (Today card), in
  the morning brief, the pinned Today and /today. "Plan my week" comes in D2. SQL `supabase/jarvis-d1.sql`.
  Tests: 10 plain (incl. a 300-day fuzz test: 0 rule breaks), 9 conversations, AI check 12/12 with 0 rules
  broken (~$0.20 a run, Opus).
- **D2 (10 Oct): built, not deployed.** Training rules (my-spec 31) as data that code enforces
  (`lib/training.ts`; the 5 defaults until you change one, then saved in `training_rules`, never deleted, only
  switched off). Session types guessed from names (Owen → sprint, Match → match, Lower, Upper…) until you set
  them ("Owen's sessions are sprints"). Rules by chat ("no plyo within 24 h of a match", "switch off the
  double-day rule"). "Plan my week": code places the gym sessions by the rules (afternoon/evening first; TBC if
  no valid day), Opus picks the study, code places it (after school on school days, nothing after its deadline).
  Knock-on (`lib/week.ts`, `lib/telegram/ripple.ts`): a change is simulated on the week, and the same card shows
  what moves in your plan, each with the reason; a clash (a session on top of another) gives 1️⃣ do it and cancel
  the other that day / 2️⃣ the nearest free time; a fixed session that breaks a rule is flagged. New homework due
  this week gets a slot offer; "I'm ill" moves that day's gym session. Undo covers the knock-on too.
  SQL `supabase/jarvis-d2.sql`. Tests: 8 plain (each rule broken and caught, 15 scripted weeks 100% compliant),
  10 conversations, AI check 6/6; all earlier checks still pass.
- **E (10 Oct): built, not deployed.** Places (`places`, one home), journeys (`travel_times`), events' place
  (`events.place_id`). By chat: "school to football is 25 min by bus", "football is at Hackney Marshes",
  "home is N1 6AA", "an Uber to the match is 20 min" (a new place named like an event becomes its place).
  `lib/travel.ts`: travel from where you'll actually be (the previous event's place, else home); your bus/tube/
  walk times always win; otherwise Uber (your estimate + 5 min pickup) vs tube/bus (TfL): tube/bus if within
  10 min (both editable). Free time, plans, knock-ons, /free, the brief ("leave 17:35: 25 min by bus from
  School"), the pinned Today and the leave alert all use it; events without a place keep their own minutes.
  E2 (`lib/telegram/maps.ts`): once a day the tick turns postcodes into positions (postcodes.io) and gets TfL
  times for today's and tomorrow's journeys (cached per hour, refreshed after 30 days, max 12 a day). Needs a
  free TfL key in production (works without one at low volume). SQL `supabase/jarvis-e.sql`.
  Tests: 7 plain, 7 conversations (fake TfL + postcodes), AI check 5/5.
- **F (10 Oct): built, not deployed.** Telegram Mini App: the bot sets its own menu button "Dashboard" (and
  `/app` sends an "📱 Open dashboard" button) that opens `/tg` inside Telegram. The page sends Telegram's signed
  launch data to `/api/telegram/miniapp`, which checks the signature (bot token), that it is under 10 minutes
  old, that it is you (TELEGRAM_OWNER_ID) and that this launch hasn't been used before; then it returns a new
  session and the dashboard opens signed in. Every failure gets the same 401. The service key is still only in
  `lib/telegram/owner-session.ts`. No SQL, no new keys, no BotFather step.
  Tests: 2 plain (every forged/stale/other-person case), 2 security tests on the built app, 1 on the test
  database (a working session for you; the same launch can't be reused).
- **G follow-ups (10 Oct): built, not deployed.** SQL `supabase/jarvis-g.sql`.
  1. Journeys as ranges, per weekday if needed: "an Uber to Wednesday training is 15–20 min + 0–8 min wait" is saved
     as drive 15–20 + wait 0–8 for Wednesdays only (`travel_times.minutes_low / wait_low / wait_high / weekday`;
     a weekday journey beats an every-day one). Leave-by and free time use the slow end (20 + 8 = 28 min); the
     setting `travelEnd` (slow / middle / fast) can change that. The brief, alerts and pinned Today show the range.
     A new place called "Home" becomes his home if he has none.
  2. Standing rule (CLAUDE.md + the bot's instructions): any request about schedule, tasks, training or settings is
     handled; if it can't be, the bot says "I can’t do that yet — it needs adding in Claude Code" and saves it to
     App ideas (`app_ideas`, `/ideas`, ↩️ Undo marks it dropped, in Export). New by chat to fill the obvious gaps:
     recurring events ("football training every Monday and Wednesday 6–7:30", days taken from his own words) and
     settings ("nothing after 10pm" → dayEnd, travel settings; `lib/settings.ts`), both with ✅ / ↩️ Undo.
  3. Training type asked once: a session or target with no type whose name looks like training gets "What type of
     training is …?" with buttons (the name's guess first, marked as a guess; "Not training" stored as 'none').
     Straight after the bot adds a session; otherwise the tick asks (07:00–21:30, one at a time), which catches
     dashboard adds and renames. Once per name (`telegram_sent`), so a rename asks again. Until he answers, the
     planner still uses the guess so rules protect the session. Dashboard: "Training type" + "Load" dropdowns on the
     event and weekly-target forms; renaming clears a type you didn't just pick.
  Tests: 3 new conversations (one per fix, `tests/jarvis-g-chat.test.mjs`); full suite 79 plain + 92 conversations
  + 12 guard pass; AI check `tests/ai/jarvis-g.ai.mjs` 10/10 ($0.22); phase A routing re-check 41/41, 0 meta saved.
  Also fixed a late-evening skip guard in a D1 test (heavy work can't be placed after 21:30).
