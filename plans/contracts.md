# Data contracts for the overnight build (19 Oct 2026)

Agreed before any parallel work (plans/overnight-queue.md). Every agent reads this first. If a contract must change,
say so in your report — don't silently change a shared file. Decisions are logged in `plans/overnight-decisions.md`.

## 0. How the work is split

| PR | Branch | What | Builds on |
|---|---|---|---|
| 0 | `pr/0-setup` | Windows test fixes, local test database (`tests/localdb`), the plug-in foundation, these contracts, all SQL schemas | `main` |
| 1 | `pr/1-study-tracker` | Queue item 1 | pr/0 |
| 2 | `pr/2-act` | Queue item 2 | pr/1 |
| 3 | `pr/3-telegram-speed` | Queue item 3 (+ the ideas inbox) | pr/2 |
| 4 | `pr/4-events-by-chat` | Queue item 4 | pr/3 |
| 5 | `pr/5-today` | Queue item 5 | pr/4 |
| 6 | `pr/6-training` | Queue item 6 | pr/5 |
| 7 | `pr/7-weekly-check` | Queue item 7 | pr/6 |
| 8 | `pr/8-how-to-use` | Queue item 8 + the final QA (week simulations, conversation suite, screenshots) | pr/7 |

Agents work on `work/<item>-<part>` branches cut from `pr/0-setup`, each in its own git worktree under
`C:\Users\Nat\natos-wt\<name>` (with a `node_modules` junction to `C:\Users\Nat\natos\node_modules`). The lead merges
them into the PR branches in order. **Only touch the files your part owns (§12).** Shared files have hooks so you
never need to edit the same lines as another part.

**Never**: deploy, push, create `.env.local`, touch the real Supabase project, delete rows (archive), edit Google
calendars other than "Life OS", let the AI change a record without Nat's ✅, hardcode his schedule (it's data:
settings, events, rules — defaults are allowed and marked as guesses).

## 1. The whole point (check every feature against it)
- Today shows **at most 3–5 things**, each with the exact thing to open and one tap / one message to mark it done.
- Simple beats clever. Every feature must **reduce** daily effort; if it adds steps, don't build it.
- The planner decides WHAT and WHICH resource and **advances automatically** when he reports something done.
- Telegram understands normal words (typos, vague, "it/that"), answers anything about his data, and can change any of
  his data — always a short preview + ✅ (✏️ change, ❌ cancel). Anything it can't do: one line + saved to App ideas.

## 2. The plug-in foundation (pr/0) — how a feature joins the bot

Types: `lib/telegram/plugin-types.ts`. Registry: `lib/telegram/plugins/index.ts` (order = fast-path order: act, gym,
tracker, life, today, weekly, help). Each item fills **its own** plug-in file `lib/telegram/plugins/<name>.ts`
(`export const plugin: BotPlugin = { name, ops, prompt, loadRows, check, apply, undo, afterApply, snapshot, fast, commands, tick, taps }`).

- **Changes (ops)**: plug-in ops join `OPS` / the brain's schema automatically. `check()` returns `{ action }` (with
  an HTML-escaped `line`, e.g. `PC1-01 Matrices: 🔴 → 🟡 (Bicen 8/10 = 80%) · review Thu 22 Oct`) or `{ problem }`.
  `apply()` writes (as Nat, RLS) and returns `{ before, after }` so `undo()` can put it back **only if nothing changed it
  since** (return `'skipped'` otherwise). New rows: undo = archive (`archived_at`), never delete. `afterApply()` may add
  one "Next: …" line to the ✅ Done message (this is how "advances automatically" shows).
- **Fast paths**: `fast(message, env)` = strict patterns that need no AI ("matrices 🟢", "bench 80x5x3"). Return
  `{ kind: 'actions', actions }` (→ `checkActions` → the usual ✅ card, no snapshot/AI), `{ kind: 'answer', html }`,
  `{ kind: 'idea', request }` or `null` when unsure (the brain then reads it). If none of the actions pass `check()`,
  the message goes on to the brain. Skipped while a card is being edited.
- **Refs in fast paths**: put your own identifier in `ref` (topic code `PC1-03`, `test:<uuid>`, …) and resolve it in
  `check()`; fast paths get no snapshot refs.
- **Brain**: `prompt` = a few lines under "Changes" describing your ops and value format (`key=value; key=value`, like
  the built-in ones). `snapshot()` adds compact sections + refs (prefixes: tracker `TS` tests, `PG` programmes,
  `RL` rules, `MK` mistakes, topic codes as their own refs; ACT `AC`; gym `LF`). Keep the snapshot small.
- **Commands**: `commands: [{ command: 'maths', … }]` win over the bot's own (`/maths` today is the old maths view).
- **Scheduled messages**: `tick(env)` runs every 5 minutes after the built-in ones; use `env.once(key, build)` so each
  message goes out once. Respect quiet hours (`quietFrom` → brief time) and school hours like `lib/telegram/schedule.ts`.
- **Buttons**: `taps: [{ prefix: 'tdy', run }]` → callback data `tdy:…` (2–6 lowercase letters; Telegram caps
  callback data at 64 bytes). Built-in single-letter taps are untouched.
- **Settings**: add to your `lib/<area>/settings.ts` (`{ label, kind, group, min?, max?, choices?, help?, default }`).
  They appear on the Settings page, in the brain's "Settings" list and are changeable with the built-in `setting` op.
  Read with `setting<T>(planning, key)` from `lib/settings.ts`. Groups: existing ones + `act`, `gym`. Pure file.
- **SQL**: your item's file in `supabase/` (already in `tests/support/testdb.mjs` SQL_FILES). Schemas for items 1, 2,
  5, 6 are written (below). Add only `add column if not exists` / `create table if not exists`; never drop.
  New tables: RLS owner-only + `set_updated_at` trigger (copy the pattern). Code must keep working before the SQL runs
  (catch the "column/relation does not exist" error and say once "run supabase/<file>.sql").

## 3. Study tracker (item 1)

### 3.1 The planner's output: `Pick` (`lib/plan-items.ts`)
Every planner returns `Pick[]`: `{ key, kind, tier, subject, title, open, url?, minutes, steps?, why, done, … }`.
`key` is stable for the day (`task:<id>`, `topic:<id>:<kind>`, `test:<goalId>:<kind>`, `mistakes:<date>`,
`prog:<itemId>`, `act:<section>:<kind>`). `open` is the exact thing to open (book + exercise, Bicen section, Integral
link, booklet). `done` says what ticking it moves forward. `TIER`: homework 1 · boost 1.5 · test 2 · review 3 · fix 4 ·
ahead 5 · stretch 6 · leftover 7 · training 8. `DayContext = { date, dow, mode: 'half_term'|'school', studyMinutes, maxPicks? }`.
`maxPicks` (default 5) is how many study picks Today has room for after training and must-do tasks: Today passes
`5 − training − tasks`, and the planner never returns more (so Today never has to cut a pick). Extra `DoneHint`
fields: `topic.physics: 'booklet' | 'pmt'` (a done tick sets that topic's booklet / PMT to done) and
`programme_item.score: true` (a done tick asks for the chapter-test score: full marks = chapter skipped, else it stays
to do). Pick keys also: `test:<goalId>:topic:<topicId>`, `test:<goalId>:booklet:<topicId>`.

### 3.2 Rules (`lib/tracker/rules.ts`, written in pr/0 — use these, don't re-implement)
- Colour from fresh-Q %: 🔴 < 65 · 🟡 65–84 · 🟢 ≥ 85 **without notes** (with notes → 🟡). `colourFromPct(pct, withNotes)`.
- Review after last done: 🔴 +1 · 🟡 +3 · 🟢 +14 · ⚪ +7 days (`nextReview`, `isDue`); editable (tracker settings).
- Status: ✅ Taught (taught_from ≤ today, or physics taught yes/in class) · ⏭ Next up (≤ 21 days) · Later (`taughtState`).
- Mistakes: redo +3 days after logging, then +7 after the first redo, then done (`firstRedo`, `afterRedo`).
  Types: Knowledge, Method, Algebra, Misread, Calculator, Time, Careless (`parseMistakeKind`).
- Step reached by a report (`stepAfter`): textbook 1 · exercise 2 · mixed 3 · bicen 4 · integral 5 (only ≥ 85 %,
  then also 🟢) · stretch 6. Steps never go back from a report; colours can.

### 3.3 Data (`supabase/tracker.sql`, `lib/tracker/types.ts`, `lib/tracker/data.ts`)
- **topics** + code, strand, teacher, half_term, taught_from, taught, step, bicen, integral_url, fresh_pct, last_done,
  weak_notes, concepts, booklet, pmt, pmt_ref, book_ref. Colour stays `topics.status`. School order = `sort_order`.
  One live topic per code.
- **goals** (kind 'test') + info, test_kind, topic_codes[], minutes_per_day, minutes_max, limits, length_min, marks,
  source, source_ref. **test_attempts** (goal, done_on, what, label, score, out_of). **mistakes** + goal_id, question,
  code, kind, rule, source, redo_stage (review_on = next redo date). **programmes** + **programme_items**. **plan_rules**.
- `loadStudyWorld(sb, today): Promise<StudyWorld>` — everything the planner needs; works before tracker.sql (empty
  extras). Subjects: 'Maths', 'Further Maths' (the sheet's "FM"), 'Physics' (matched by name, case-insensitive).
- **Import** (privacy: the GitHub repo is public — never commit the spreadsheet or a seed with teacher/school names):
  `lib/tracker/xlsx.ts` reads an .xlsx (zip + XML, no new dependency) → `lib/tracker/import.ts` maps the 6 tabs to
  rows and builds an `ImportPlan` against his current data: new topics, matched topics (keep his colour, step,
  mistakes, notes — a non-⚪ app colour wins; both set and different = a **clash**, listed), duplicates (archived; their
  mistakes move to the kept topic), tests (FM HT2 12 Nov, FM HT1 + consolidation due 2 Nov 30–60 min/day, Physics
  mechanics 10 Nov, Physics waves 12 Nov) with topic codes, mistakes rows, the STEP programme (28 items, 1 a week,
  weekend). Upload on the Subjects page → preview (counts + clashes) → Confirm → applied → result. Matching order:
  code → (subject + book + chapter: "Book 1 · n" = "Y1 red · n", "Book 2" = "Y2 green", "Pure Core 1" = "PC1 blue",
  "Pure Core 2" = "PC2", FM "Statistics"/"Mechanics") → normalised name. Re-importing later is safe (idempotent).
- **Export**: "Export my tracker" → one CSV per tab (or one CSV with a tab column) for his Google Sheet backup:
  `lib/tracker/csv.ts` (pure) used by the Subjects page button and by the bot ("export my tracker" → sendDocument).

### 3.4 The planner (`lib/tracker/engine.ts` `planStudyDay(world, day, extra) → StudyPlan`)
Strict order, then the leftover split. All minutes are integers; the result is normally ≤ 6 picks (Today shows ≤ 5).
1. **Homework** (tier 1): open homework tasks due within 7 days or overdue, earliest first; minutes = task's or 45;
   `open` = "Do it in black · mark green/red/purple · log red/purple as mistakes". Never dropped for time.
2. **Boost** (1.5): picks matching a live `boost` rule move here (homework stays first).
3. **Tests** (2) within 21 days (`test`, `consolidation`, `paper`, `mock`; ACT comes in `extra`). Per test per day ≤ 2
   picks. Day before: only `test_light` (20 min: that test's mistakes + formula booklet, sleep) and nothing heavy in
   its subject. No diagnostic attempt yet → `test_diagnostic` (1–2 fresh Qs per topic, no notes → colour each; 5 min a
   topic, 15–60). 3–4 days before and no timed attempt in the last 3 days → `test_timed` (real length). Otherwise
   topic work on its topics 🔴 → 🟡 → ⚪ → 🟢, **teacher booklet first** (`test_booklet` until a `booklet` attempt
   exists / physics booklet done), then that topic's exam resource. Consolidation with minutes_per_day → one daily
   `consolidation` pick (half-term: the max, school: the min). Limits ("no momentum") are shown in `why`/`open`.
4. **Reviews** (3): due topics (most overdue, 🔴 first) ≤ 2 a day, 20–30 min: "3–4 Bicen questions on <topic> + redo its
   mistakes" (physics: retrieval Qs); plus one `mistake_redo` pick for all redos due ("redo without looking"), ≤ 30 min.
5. **Fix 🔴** (4): taught 🔴 topics: "10 min re-learn (notes / Bicen chapter summary) → 5 textbook Qs → Bicen exam Qs →
   ≥ 80 % = 🟡" (physics: concepts list → PMT notes / one video → explain out loud → Isaac Physics).
6. **Leftover** = studyMinutes − the above (if > 0), split: half-term **55 % ahead / 25 % fixing / 20 % old**; school
   week **40 % current / 30 % old / 30 % ahead**. Fixed commitments come out first: steady ACT (`extra`, tier 7) and
   due programmes (`isDueToday`) — they take the first free pick slots after tiers 1–4 (never displacing a tier 1–4
   pick: strict priority), before the shares. A share < 20 min is merged into the next share. One pick per share:
   - **ahead** (5): maths only (Maths + FM), the first ⏭ Next up topic in school order that is ⚪/🔴 (move on at 🟡).
     90-min session (scale if the share is smaller, min 45): 10 prerequisite check · 25 learn from the textbook ·
     25 textbook questions · 20 fresh exam Qs · 10 mark + colour (`steps`). No candidate → its share goes to fixing.
   - **fixing**: 🟡 taught topics → exam Qs + fix mistakes (or more 🔴).
   - **current** (school weeks): topics taught in the last 14 days / in class, not 🟢 → their next ladder step.
   - **old**: taught 🟡/🟢 topics not yet due, oldest last_done first → mixed exam Qs to keep them fresh.
   - **stretch** (6): only 🟢 topics, only if time is still left: Bicen 9 Hardest → MadAs → STEP.
   Physics: keep up + review only (never ahead): booklet → PMT CAIE topic Qs → concepts → retrieval reviews.
7. **Rules**: `pause` removes matching picks (targets: `ahead`, `stretch`, `reviews`, `act`, `physics`,
   `subject:<name>`, `programme:<name>`); `cap` limits the day's minutes for `subjects:Maths,Further Maths,Physics`
   (lowest tier trimmed first); `note` only shows. Only rules with starts_on ≤ date ≤ ends_on count (auto-expire).
- **Ladder** (`lib/tracker/ladder.ts` `nextResource(topic, links)`): step 0 → textbook section + worked examples
  (book_ref) · 1 → textbook exercise, every 2nd question · 2 → mixed exercise + red/blue Qs · 3 → Bicen exam Qs (its
  `bicen` section; **Further Stats / Further Mech: Integral Further** instead) · 4 → Integral topic assessment, timed,
  closed book (≥ 85 % = 🟢) · 5+ and 🟢 → stretch (Bicen hardest → MadAs → STEP). Links from settings (`TrackerLinks`;
  empty until he pastes them — then the name only).
- `testMode` = the nearest test within 21 days (for "🔥 Test mode" lines).

### 3.5 Programmes (`lib/tracker/programmes.ts`)
Ordered items + `per_week` + optional `ends_on`, `days` ('weekend', 'weekdays', 'mon, wed'), `status`
(active/paused/stopped/done), `paused_until`, `mode`: `in_order` · `gaps_only` (test the chapter first; only do it if
marks were dropped — College Panda) · `optional` (only when boosted/asked — Critical Reader). Pause / resume / change
per week / end date / stop / add items — all by chat (✅). New programmes need no code. **STEP** = 28 items (STEP Support
Foundation Assignments 1–25 + Mixed Pure / Mechanics / Statistics STEP 1), 1 a week, weekend, 60–90 min; per item
"solved without help?" (yes / with hints / no) and "idea I learnt" go in `result`.

### 3.6 Temporary rules (`plan_rules`)
`{ words, kind: boost|pause|cap|note, target, minutes, starts_on, ends_on }`. "this week" ends Sunday; "until 25 Oct"
ends that day; no end given → ask (quick-tap: this week / 2 weeks / until I say — "until I say" = 8 weeks, he can end
it). "maths" = Maths + Further Maths. Shown on the Your week card ("📌 Rules this week") and in /rules; expired ones
just stop counting (no delete).

### 3.7 The bot (item 1's plug-in, `lib/telegram/plugins/tracker.ts`)
Ops (prefix `trk_`, values `key=value; …`): `trk_colour`, `trk_log` (what=textbook|exercise|mixed|bicen|integral|stretch|
booklet|pmt|review|diagnostic; score; out_of; notes=yes), `trk_mistake`, `trk_redo`, `trk_attempt`, `trk_test`,
`trk_topic` (edit fields), `trk_programme` (new / pause / resume / stop / per_week / end / items), `trk_item`
(done / skip / result), `trk_rule` (add / end). Fast paths at least: "matrices 🟢", "PC1-01 green", "did Bicen matrices set
8/10", "finished textbook exercise on logs", "mistake: PC1-03 Q3b assumed through origin – knowledge", "HT2 practice
38/45", "redid PC1-03 Q3b", "pause getting ahead until 25 Oct", "ACT top priority this week", "maths + physics 45 min/day
this week", "done STEP 3", "export my tracker". Commands: /maths /physics /tests /review /rules /programmes (and
/ideas stays the bot's). "what next?" = exactly what to open (the top pick not done). Classroom: a test assignment
("test", "assessment", "exam", "consolidation", "mock") → the AI reads its description (SORT_MODEL, structured: date,
topics/codes, limits, length, marks, minutes per day) → asks **once** (source_ref): "📝 Test on Thu 12 Nov – plan
revision? ✅" → ✅ saves the test (trk_test). Your week card: one "📌 Rules this week" line.

## 4. (reserved)

## 5. ACT (item 2) — `lib/act/`, plug-in `act`, `supabase/act.sql`
- Keep everything that exists (the ACT subject, any ACT tasks/goals). Last real test 34 (E34 M34 R35 S35), goal 36,
  enhanced ACT: composite = round(mean of English, Maths, Reading); Science reported separately.
- `loadActWorld(sb, today)`, `actPicks(world, day): Pick[]` (signatures fixed in pr/0). Retake date = a test goal with
  `test_kind = 'act'` (and the ACT subject). Books = programmes with `area = 'act'`: Complete Guide to ACT English
  (in_order, chapter by chapter + exercises, misses logged to grammar rules), Complete Guide to ACT Reading 3rd ed
  (method chapters, then timed passages ~8–9 min), College Panda ACT Math + workbook (`gaps_only`: chapter test first),
  Advanced ACT Math (only once gaps are closed: hard last-15 questions), The Critical Reader 5th ed (`optional`: only
  if reading stalls). Daily 10-min grammar flashcards (Anki) — a small item attached to the ACT pick (one Today line).
- **Steady** (no date): half-term ~75 min/day rotating English / Reading / Maths; 1 full timed test a week + review the
  next day; school weeks 30 min × 3. **Countdown** ("ACT retake is <date>"): daily timed English section + review every
  miss against its rule; alternate timed Reading / Maths; one full timed mock mid-week; day before light (rules +
  misses list + sleep). Countdown picks are tier 2 in the last 21 days, else tier 7. Mention of a test without a date →
  ask for the date. "ACT practice: E33 M35 R34" → `act_score`; focus shifts to the weakest section (vs goal).
- Ops (prefix `act_`): `act_score`, `act_date` (set / clear), `act_miss` (section, rule, question, what), `act_setup`
  (one ✅ card that creates the books, flashcards and the last real score), `act_book` (a book chapter / passage /
  chapter test done, skipped or scored: "finished Meltzer chapter 3", "College Panda ch 4 test 12/15"). ACT owns its
  book phrases; `trk_item` stays for generic programmes (STEP).

## 6. Telegram speed + feel (item 3)
Measure first (a timing harness with the fake Telegram/AI and realistic delays: DB round trip, Telegram, each model),
then: "typing…" as the very first thing; fast paths (§2) before any AI; a quick model to route simple messages; the full
model only when needed; parallel reads; cache per message/drain; fewer round trips. Target simple replies < ~3 s
(simulated). Short, friendly replies; buttons everywhere ✅ / ✏️ / ❌. Before/after table in the PR. Also the **ideas
inbox**: app_ideas keeps his exact words + what's needed; `/ideas` sends one ready-to-paste block for Claude Code;
`plans/ideas-inbox.md` explains the routine. Use the `claude-api` skill for model ids/prices before changing models.

## 7. Events + life by chat (item 4)
"out with friends tomorrow 2–9pm", "family dinner Sat 7", "football Wed 7:45" → a Life OS event (built-in `event_new` /
`event_weekly`; casual times read as he means them) → preview + ✅ → the planner works around it (free time, ripple on
the week). Cancelling / moving the same way. A fast path for the common shapes; the brain for the rest. Never edit a
Google event outside Life OS (read-only copies → "change it in Google").

## 8. Today + morning/evening (item 5) — `lib/today/`, plug-in `today`, `supabase/today.sql`
- One Today list for web + Telegram: ≤ 5 items (homework/tests/study picks from `planStudyDay` + `actPicks`,
  today's training session from the week optimiser, must-do tasks), each with a time, the exact resource (`open`) and
  one tap to mark done (web button; Telegram `tdy:` tap). Fixed commitments (school, football) are one short line.
  Everything else hidden ("+3 more" → `/today all`).
- The morning message at **07:30** (setting; on holidays not before his holiday wake time). Today's items are saved
  as plan blocks (`source='auto'`, `pick_key`, `open_text`…) unless he already applied a plan for today.
- Done → the pick's `done` hint moves things forward (topic last_done/step, programme item, mistake redo stage, task
  complete). Evening message: ticks for today's items; whatever isn't done **rolls forward automatically** (marked
  `rolled_from`, re-picked tomorrow — no ✅ needed: it only moves his plan, not his records).
- Holidays: a `holidays` setting (date ranges, default this half-term as a guess) → `mode = 'half_term'`, no school,
  `holidayWakeAt`. Polish the whole app's look (calm, consistent spacing/type, great at 390 px).

## 9. Training + gym progress (item 6) — `lib/gym/`, plug-in `gym`, `supabase/gym.sql`
"bench 80x5x3" = 80 kg × 5 reps × 3 sets; "squat 100 5x5" = 100 kg, 5 sets × 5 reps; "80x8" = 1 set. One message
per exercise, one ✅. Hevy CSV import (web upload, preview + confirm, imports once by source_ref). Epley e1RM =
w × (1 + reps/30) (1 rep = w). PR alerts (best e1RM per exercise; also best weight at a rep count). Weekly sets per
muscle group (keep upper balanced). Next-session suggestion (double progression: all sets at the top of the range →
+2.5 kg upper / +5 kg lower, else +1 rep). Progress charts (web, SVG). `/owen` = ready-to-send message to Owen with this
week's training days and free slots (reuse lib/telegram/owen.ts). Respect the existing rules (Owen's days fixed,
upper 2×/week heavy ~90 min Mon PureGym + Sat, Mon/Wed club football, Tue school football then Owen, Sunday games, light
lower ok the day before a game, no heavy lower/plyo) — as settings/rules data, not code.

## 10. Weekly check (item 7)
Sunday, one message: done vs planned per subject, ACT trend, gym PRs, what's behind, one suggestion, then "Plan next
week? ✅" → the Your week card. No dashboard to maintain.

## 11. How to use (item 8)
`docs/HOW-TO-USE.md`, `/help`, a Help page: daily routine, the 15 most useful messages, how ✅ works, the ideas inbox,
how to update the Google Sheet backup. Plain English, one screen.

## 12. File ownership (edit only yours; ask the lead for anything else)
| Part | Owns |
|---|---|
| 1a tracker data | `supabase/tracker.sql` (extend only), `lib/tracker/data.ts`, `xlsx.ts`, `import.ts`, `csv.ts`, `lib/tracker/settings.ts`, `components/Subjects*.tsx`, `components/Tracker*.tsx`, `app/subjects/**`, `app/api/tracker/**` |
| 1b tracker planner | `lib/tracker/engine.ts`, `ladder.ts`, `testmode.ts`, `leftover.ts`, `programmes.ts`, `rulesets.ts` (temp-rule logic), tests `tests/tracker-*-unit.test.mjs` |
| 1c tracker bot | `lib/telegram/plugins/tracker.ts`, `lib/tracker/bot-*.ts`, `lib/tracker/classroom.ts`, the Classroom hook in `lib/google/sync.ts`, the rules line in `lib/telegram/yourweek.ts`, `sendDocument` in `lib/telegram/api.ts`, `tests/tracker-*-chat.test.mjs` |
| 2 ACT | `lib/act/**`, `lib/telegram/plugins/act.ts`, `supabase/act.sql`, `tests/act-*.test.mjs` |
| 3 speed | `lib/telegram/{bot,converse,brain,turns,api,ideas}.ts`, `lib/ai/models.ts`, `supabase/speed.sql`, `tests/speed-*`, `plans/ideas-inbox.md` |
| 4 life | `lib/telegram/plugins/life.ts`, `lib/life/**`, `supabase/life.sql`, `tests/life-*` |
| 5 today | `lib/today/**`, `lib/telegram/plugins/today.ts`, `supabase/today.sql`, `components/home/**`, `app/page.tsx`, `app/globals.css`, `components/Shell.tsx`, `tests/today-*` |
| 6 gym | `lib/gym/**`, `lib/telegram/plugins/gym.ts`, `supabase/gym.sql`, `app/training/**`, `components/Training*.tsx`, `app/api/gym/**`, `tests/gym-*` |
| 7 weekly | `lib/weekly/**`, `lib/telegram/plugins/weekly.ts`, `tests/weekly-*` |
| 8 help | `docs/HOW-TO-USE.md`, `lib/telegram/plugins/help.ts`, `app/help/**`, HELP in `lib/telegram/bot.ts`, `tests/help-*` |

## 13. Tests
- `npm run test:unit` (pure, no DB) and `npm run test:chat` (real bot code + fake Telegram + scripted AI + a local
  test database: `tests/localdb/README.md`; each worktree gets its **own instance** — the lead tells you which; write
  it with `node tests/localdb/env.mjs <n> <worktree dir>`). Unit test every rule you write; chat-test every message
  shape you add (typos, vague, "it/that", changes, cancels, can't-do → App ideas). `c.noSurprises()` after each chat.
- Run only your tests while building, then the **whole** existing suite before you report (both must be green; a test
  that expected the old behaviour Nat asked to change is updated, not deleted).
- Typecheck: `npx tsc --noEmit -p .` must be clean.
- Local DB instances (10 running; `node tests/localdb/env.mjs <n> .` in your worktree): 1 main checkout · 2 tracker
  data · 3 tracker bot · 4 ACT · 5 gym · 6 life · 7 speed · 8 today · 9 tracker planner · 10 the lead. The real
  Supabase must run PostgREST v14+ (v12/v13 break the queue lock's PATCH; Supabase is already on 14).
