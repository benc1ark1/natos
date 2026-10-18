# Stage 1.5 plan

Based on my-spec.md sections 30–38 and 41. Each step is one change: you approve its SQL, I build it,
you test it, then the next step. No step deletes data. Every new table has owner-only RLS
(the same `for all using (auth.uid() = user_id) with check (auth.uid() = user_id)` policy as
before; written out in full when you approve a step).

**Recommended order** (differs from yours in two places, reasons given):

| # | Step | Spec | Schema | Needs AI? |
|---|------|------|--------|-----------|
| 1 | Routines become reference | 30 | none | No |
| 2 | Feel: custom dropdowns, date pickers, Undo everywhere | 37 | none | No |
| 2b | Tasks "By date" view | 32 | none | No |
| 2c | Reminders | 38 | yes | No ("remind me…" by capture = Step 6) |
| A–D | Simplify: quick task form, Due/Nice, target bonus, simple Goals (replaces old step 3) | 42 | yes (`supabase/simplify-c-d.sql`, run) | No |
| 4 | Calendar editing + "just this week" changes + travel minutes (**built 4 Oct**) | 32, 41 | yes (`supabase/stage1.5-4-5.sql`, run) | No (capture of changes = Step 6) |
| 5 | Training week + target Log button (**built 4 Oct**) | 34, 41 | yes (same SQL) | No ("did football" by capture = Step 6) |
| 6 | Tests + prep sessions + Upcoming tweak (**built 4 Oct**) | 35, 41 | yes (`supabase/stage1.5-6-8.sql`, run) | No (rule-based; AI improves plan in Step 7) |
| 7 | No clutter: Archive by week/month/year, summary, filters (**built 4 Oct**) | 36 | one function (same SQL) | No |
| 8 | Projects, Someday, details expander + hand-in (**built 4 Oct**) | 32, 41 | yes (same SQL) | No (AI fills fields = Step 6) |
| 9 | Notion import: Guides + Morning/Night routines (**built 4 Oct**) | 30, 32 | yes (`supabase/stage1.5-9-guides.sql`, run) | No |

Why the order changes:
- **Feel (37) moves to step 2.** Every later step adds forms. Building the custom dropdown and
  date picker first means they're used everywhere once, not retrofitted.
- **Calendar editing moves to step 4.** Training (34) counts calendar sessions, so you need to be
  able to add club football / school football / Owen's sessions in the app first.

---

## 1. Routines become reference (section 30)

**Schema:** none. Old routine ticks in `habit_logs` stay in the database untouched; the app just
stops reading or writing them.

**What you'll see**
- Home: the Routines card is replaced by one small line: `Routines: Morning · Night`.
  No ring, no Done button.
- New page `/routines/<name>`: blocks in order. Tap a block → its steps and an "Open guide" link
  (if it has one). Conditional blocks show a label like "Shave days only", nothing to toggle.
- Learning / Quick view toggle from the design (all steps shown vs titles only).

**Optional 1b:** a simple routine editor (add / rename / reorder blocks and steps) so you don't need
the Supabase Table Editor. Needed before you add prayer and journalling blocks (section 32).

**AI:** not needed.

---

## 2. Feel: custom controls and Undo (section 37)

**Schema:** none.

**What you'll see**
- Custom dropdown and date picker in the design's style replace every native control.
- Undo toast after complete, move, archive (already on complete; added to move and archive).
- Faster feel: a change shows immediately as **pending** (faded), then confirms when the
  database replies; if it fails it snaps back with an error. This keeps the CLAUDE.md rule
  ("never claim a save succeeded unless the database confirms").
- Buttons and spacing made consistent across pages.

**AI:** not needed.

---

## 2b. Tasks "By date" view (section 32)

**Schema:** none. Uses the existing `due_at`, `window_end`, `window_label` and `source` columns.
A task with a window is grouped by its `window_end` (the last OK day).

**What you'll see**
- On Tasks, a third view **By date** next to List and Board (remembered like the others).
- Groups in this order: **Overdue · Today · Tomorrow · This week · Next week · Later (dated) · No date**.
  Empty groups are hidden.
- Each row shows its due date or window (e.g. "Fri" or "this week"), subject and source.
- Tap a row → the same task sheet as the other views. Complete has Undo.
- Routines never appear here, so nothing routine can show as Overdue.
- Weeks run Monday–Sunday, Europe/London.

**AI:** not needed.

---

## 2c. Reminders (section 38)

Reminders are their own table, so they never count as tasks, never go overdue and never reach
Archive.

```sql
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0),
  kind text not null check (kind in ('day','time','person')),
  remind_on date,            -- day reminders
  remind_at timestamptz,     -- time reminders
  person text,               -- person reminders ("next time I see Sam")
  done_at timestamptz,       -- ticked
  created_at timestamptz not null default now(),
  check (kind <> 'day'    or remind_on is not null),
  check (kind <> 'time'   or remind_at is not null),
  check (kind <> 'person' or person is not null)
);
alter table public.reminders enable row level security;
-- + owner-only policy
```

How it behaves:
- Day reminder: shows on its day only, then vanishes (worked out from the date, no job).
- Time reminder: shows on its day from its time; vanishes after that day. Phone notifications come
  with Telegram (Step 9) / Google Calendar.
- Person reminder: stays until you tick it.
- Ticking sets `done_at` (with Undo). Nothing is deleted.

**What you'll see**
- Home: one small **Remember today** line at the top (today's day reminders, time reminders whose
  time has come, all open person reminders). With none it says "Nothing today" on one line; it stays
  so "+ Reminder" always has a home.
- "N later" button expands upcoming reminders (so you can check or edit "PE kit Fri").
- "+ Reminder": text, kind, then a day, a day + time (15-min steps), or a person. Tap a reminder to edit.
- SQL: `supabase/stage1.5-2c-reminders.sql`.
- Inbox stays for unsorted captures and dateless ideas only.

**AI:** not needed. Capture turning "remind me…" / "tell X…" into a reminder is Step 6.

---

## 3. Goals: replaced by Simplify A–D (section 42)

Built 4 Oct 2026. Goals are a name, an optional date and linked tasks (reusing the `goals` table,
`tasks.goal_id`). Weekly targets got `bonus_count`. Modes, priority and the per-week counts table are
dropped. If "Lower count changes week to week" is still wanted, it gets its own small SQL in step 5.
Step 6 (tests): a test becomes a goal with a date; its prep sessions are its linked tasks.

---

## 4. Calendar editing (section 32, calendar bullet). Built 4 Oct 2026

SQL: `supabase/stage1.5-4-5.sql` (run). Adds `event_exceptions` (one row per changed week, keyed by
the event and its usual date: `cancelled`, `new_date` / `new_start` / `new_end`, `missed`; owner-only
RLS; Undo flips fields back, rows never deleted) and `events.travel_minutes` (0–240, each way).

What's built:
- Calendar card: **+ Event**, and tap any event (desktop grid or phone list) to open its sheet.
- Sheet fields: name, area, subject, place, one-off (date) or every week (pick days), start/end in
  15-min steps (end only lists times after the start, and moves with the start), travel.
- Repeating event: **Just this week** (move day within that Mon–Sun week / change times, Cancel this
  week, Restore) or **Every week** (edit the event itself). Undo on move, cancel, restore.
- **Delete** archives the event (Undo). Nothing hard-deleted.
- Travel shows as faded boxes before and after on the grid, "+N min travel" on the phone list.
  Busy-time calculations (step 6) use event + travel.
- Cancelled sessions stay visible (struck through) so they can be restored; Upcoming hides them.
- Fixed along the way: Esc on any dropdown/date picker closed the whole sheet (focus never reached
  the list). Now Esc closes only the list, app-wide.

## 5. Training week (section 34). Built 4 Oct 2026

SQL: same file. `events.target_id` (event counts toward a weekly target) and
`weekly_targets.counts_from` ('logs' | 'events').

How counting works (`lib/targets.ts`):
- **Calendar sessions** target (e.g. Team): target = linked sessions this week, not cancelled;
  done = those that have finished, minus any marked missed.
- **Log button** target (Own football, Upper, Lower, SMC…): done = Log taps this week.
- Lower's changing count: edit the target's "Per week"; it carries on to next week, so "defaults to
  last week's number" needs no extra table. (`goal_week_counts` not used.)

What's built:
- Home "This week" is one compact line (`Team 2/3 · Upper 1/3 · …`); tap to expand (remembered on
  the device).
- Expanded rows: one small **Log** button (Undo in the toast replaces "−"). Calendar targets show
  "Calendar" and no button.
- Target form: **Counts**: Log button / Calendar sessions (per week, bonus and source hidden for
  calendar ones). **Archive** button (is_active off, Undo; logs kept).
- Event sheet: **Counts toward** (targets that count calendar sessions). On a finished linked
  session: **Missed** / **I went**, with Undo. Missed sessions are struck through.
- Phone list also shows earlier training sessions this week, so one can be marked missed.
- Not built (later): training rules as context facts and the "hard day" flag (Step 7 planning).

---

## 6. Tests and prep sessions (section 35). Built 4 Oct 2026

**Changed from the original plan:** goals moved to their own `goals` table in Simplify D, so a
test is a goal with `kind = 'test'` (date required), plus `subject_id`, `topics`, `priority`.
Sessions are tasks linked by the existing `tasks.goal_id`, marked `is_system`, with `session_no`
and `archive_reason` ('done' / 'skipped' / 'expired'). SQL: `supabase/stage1.5-6-8.sql`.

How it works (`lib/prep.ts`, rule-based):
- 2–5 sessions from days left (≤3 → 2, ≤7 → 3, ≤14 → 4, else 5), +1 high priority, −1 low.
- Days: tomorrow to the day before the test (today too if that leaves under 2 days). Split into
  equal slices; each session goes on the least busy day of its slice (events + travel both ways).
- 40 min each (45 high, 30 low). Title "Physics test Fri 9 Oct: session 2/4".
- Done → archived 'done'. Skip → archived 'skipped' and the rest re-spread (with Undo).
  Move = tap the session and change its date. "Re-plan" button on the test re-spreads open ones;
  changing the test's date or name re-plans automatically.
- Only the next session per test reaches Today and Tasks (`nextSessionsOnly` in `lib/data.ts`).
- `archive_expired()` runs on every task load: the day after a test, leftover sessions are archived
  'expired'. The test itself drops out of active views by date (like other goals).
- Upcoming: tests (orange "Test" flag) then due dates first in each day, highlighted; repeating
  events show only their next occurrence; prep sessions don't show in Upcoming.

---

## 7. No clutter (section 36). Built 4 Oct 2026

- `archive_counts()` returns counts per group (this week / weeks earlier this month / months
  earlier this year / older years), London time. The page loads counts; a group's items load
  when tapped.
- Summary line: "This week: 8 done · Study 1 · Other 7".
- Search + area chips + subject and project dropdowns search all history on the server (first 100).
- Prep sessions never show in Archive. Past goals and tests listed underneath.
- Home: "N done today" line under Today. Empty Upcoming and Goals collapse to one line.

---

## 8. Projects, Someday, details expander (section 32). Built 4 Oct 2026

- `projects` table (owner-only RLS). `project_id` on tasks, goals and resources
  (goals instead of weekly_targets, since goals moved). `hand_in` + `hand_in_url` on tasks.
- `someday` status added; moving to Someday counts as postponing (trigger updated; the app's own
  re-plans of prep sessions never count).
- **Projects** page (nav): each project shows "Next:" (its first task by the usual order) and its
  open count; tap for tasks, goals, + Add task, Edit, Archive (with Undo; tasks stay open).
- **Someday** column on the board and a Someday button in Inbox; Someday never feeds Today.
- Capture "Details" expander: due date, window, subject, minutes, source, project, star, hand-in +
  link. Enter still saves; with a date it goes to the right column ("Saved to This week").
- Hand-in shows under the task everywhere ("Hand in: Google Classroom ↗", opens in a new tab).
  Task form and goal/test form have Project; task form has hand-in.

---

## 9. Notion import (sections 30, 32). Built 4 Oct 2026

**Changed from the original plan:** imports the Notion "Life Mastery Dashboard" pages (read
directly through the Notion connection, read only) as **Guides** + the Morning/Night routines,
instead of a tasks CSV. The tasks/projects CSV import is not built (later, if still wanted).

SQL: `supabase/stage1.5-9-guides.sql` (run). Adds `guides` (title, icon, body, sort_order,
`import_key`, `archived_at`; owner-only RLS; never deleted), `habit_items.guide_id`,
`habits.import_key`, and `import_guides_routines(payload)` (one transaction, security invoker,
skips anything already imported, hides an older routine with the same name; deletes nothing).

What's built:
- `/guides`: library (search, open, **+ Guide**, Archive with Undo, show archived + Restore).
  Reached from Home's routines line: `Morning · Night · Guides`.
- `/guides/<id>`: reads the guide (headings, lists, tables, `[[Guide title]]` links), "Used in"
  routine blocks, **Edit** (icon, title, text) and Archive.
- `/guides/import`: preview (new / already imported / skipped) → **Confirm**. Nothing saves before
  Confirm. Content lives server-side only (`lib/import/notion-life-mastery.ts`, served by
  `app/api/import/notion/route.ts` to the signed-in user), never in browser code.
- Routine blocks link to their guide ("Open guide →", in-app).
- Imported: 18 guides; Morning (9 blocks) and Night (17 blocks), in order, no clock times.
  The sample Morning/Night were hidden (is_active off), not deleted.
- Left out: Injections & Peptides and PE Enhancement (never opened), every injection line,
  prescription-only drugs (ordinary supplements only, per my-spec), tick boxes and scores,
  the skincare reference photo (stays in Notion), the unrecognised "Osstivia" line.

---

## Covered elsewhere (not in Stage 1.5)
- AI fills subject/source/date/minutes from natural text, recurring homework capture: **Step 6**.
- "The AI manages my time", "do 30 min SMC": **Step 7**.
- Reading / prayer / journalling: data you add once steps 1b and 3 exist (routine blocks or goals).

## Later stages
- **Step 6 (AI capture)** follows section 39: one capture box decides task / test / reminder /
  goal progress / event change / idea / fact, fills the details and shows a confirm card. Nothing
  saves until you confirm; it never invents dates.
  **Built and re-checked 6 Oct** (task, duplicate warning, "did football" + Undo, idea to Inbox,
  AI-failure fallback all pass).
- **Step 7 (AI planning)** includes section 40 (Sunday weekly check-in, top 3 priorities, AI drafts
  the week) and section 41's planning rules (editable) and ahead/behind.
  **Built 6 Oct** (`supabase/step7-checkin.sql`, run): Ask AI on Home (Claude Sonnet 5.5, answers only
  from your data, max 4 items with minutes, refs checked server-side, read-only) with the 4 one-tap
  questions, "Move to Today" (+ Undo) and "Save fact" taps; Sunday check-in (look back, look ahead +
  session counts, top 3 priorities, AI-drafted week you adjust and confirm; saving it changes no tasks).
- **Step 8 (secure + ship)** **done 6 Oct.** Security checklist passes (Telegram lines wait for Step 9).
  T21 pass (no keys in browser code, local or live). T02 pass. Sign-ups turned off in Supabase.
  "Export my data" button (all 21 tables, date + source + checked counts). PWA icons; added to phone
  and iPad. Code on GitHub (private, nb52/personal-os). Live on Vercel via the CLI (GitHub can't
  authorise Vercel): https://personal-os-roan-rho.vercel.app. Separate Anthropic key for production.
  `.vercelignore` keeps `.env*` and `assets/` out of uploads. **T24 (restore test) skipped for now.**
  Redeploy after changes: `npx vercel deploy --prod` from the project folder.
- **Step 9 (Telegram)** includes section 41's Telegram line: Add anything + Ask ("what should I do
  now", "what's coming up", "am I ahead or behind"), plus time-reminder notifications from 2c and the
  Sunday check-in reminder.
  **Live 10 Oct** as @nbplannerbot. SQL: `supabase/step9-telegram.sql` (run: `telegram_sent`,
  `telegram_pending`, 5-minute pg_cron job, cron job id 1) + `supabase/step9-vault.local.sql` (run; never
  committed). Tick secret rotated 10 Oct after it was shared. Keys in `.env.local` + Vercel: bot token,
  owner Telegram ID, Supabase secret key (`sb_secret_`, used only in `lib/telegram/owner-session.ts`).
  Checked by Claude: 10 local guard tests; live: missing/wrong secret refused (webhook + tick), stranger,
  stranger's button tap and group chat ignored, tick opens the session; Supabase timer reaches the app
  (200); T21 live (no keys in browser JS); Telegram security-checklist lines pass.
  Checked by Nat: the 3 test replies arrived; Action Button opens the bot. **Still to check:** real task
  → ✅ → shows once on the dashboard (result not reported yet); a friend's account is ignored; 07:00
  brief (Sun 11 Oct). Voice notes not built (keyboard dictation instead).
  Known bugs (fixed in the section 44 plan): a reply after ✏️ Edit is captured as a new item; meta-messages
  ("can you move it as a real task") become tasks; no conversation memory.
