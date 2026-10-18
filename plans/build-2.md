# Build 2: editable settings, then the rest of the build (from 10 Oct 2026)

Asked 10 Oct: audit what's hardcoded and make the likely-to-change things editable (bot + dashboard), then build
what's left of my-spec / BUILD-GUIDE in order. Same rules as plans/jarvis.md: SQL goes to the test database only
(Nat runs it on the real one before a deploy), one test per fix, full suite once per phase, commit per phase,
no deploys until Nat says go.

## What's left (my-spec + BUILD-GUIDE vs what's built)

| # | What | Source | Plan |
|---|---|---|---|
| H | Hardcoded things → editable (settings, lists, prompts read his data) | Nat, 10 Oct | built |
| I | Google Calendar: "Life OS" calendar (two-way), read other calendars, Classroom "Assignment:" → homework, Google reminders + leave-by | Step 11, my-spec 25/26/28 | built; Nat does the Google Cloud clicks |
| J | Whoop: recovery, sleep, strain, workouts; Recovery card; low recovery → lighter; workouts count toward targets | Step 11, my-spec 25/31 | built; Nat does the Whoop developer clicks |
| K | Study pipelines + GoodNotes: stages per subject, topics, next action, topic links, mistakes come back | Step 12, my-spec 26/27 | built |
| L | Life Mastery guides: grouped by area, the AI reads them, Athletic & Lower = fixed rules + weekly log | Step 10 | built |
| N | Load-based weekly training planner | Nat, 11 Oct (final polish) | built |
| – | Hevy sync (official API, Pro key) | my-spec 29 | **next** (needs Nat's Hevy Pro key) |
| – | TrainHeroic CSV import | my-spec 29 | **next** |
| – | Supplement stock tracker | my-spec 20 ("later stage") | **next** |
| – | Notion tasks/projects CSV import | my-spec 32 | later, if still wanted |
| – | Restore test (T24) | Step 8 | Nat's choice (skipped so far) |
| – | Evening journal, football session generator, voice notes | BUILD-GUIDE "later" | later |
| – | First brain dump (homework, facts, resources) | Step 13 | Nat |

## Progress

- **H (11 Oct): built, not deployed.** SQL `supabase/build-h.sql`.
  - New **Settings** page (nav) + the bot can change all of it (✅ card, ↩️ Undo): About you (the AI reads it instead
    of a bio fixed in 4 prompts), free-time times/buffers/school-night focus (were bot-only), hard-thinking subjects,
    Today size (6), push-back after N postponements (3), brief time (07:00), nudge time (18:00), check-in day
    (Sunday), "leave in …" lead (10 min), gym start time (15:00), prep session length (40), travel settings.
  - **Training types** are his list (Settings, or "add swimming as a training type"): name, the words that spot it in
    a session's name (the "Owen" → sprint guess is now data), hard/light, whether the planner may place it. The rules,
    the week planner, the type question and the dropdowns all use it. DB checks now accept any type key.
  - **Task sources** ("Where it came from") are his list too (was school / maths-physics tutor / CS tutor / own;
    "Vlad" is no longer in code). Capture, cards, forms and the AI use it. DB check widened.
  - **School** is a per-event answer (event form "School?", or "holiday camp is not school"); unset = the old guess
    (repeats 5+ days). School nights and "after school" follow it.
  - Bot can now also rename an event, say it is/isn't school (`event_set`) and change a target's name, weekly number,
    bonus or session length (`target_set`; session length is also on the target form). Renaming an event was an App idea.
  - Prompts no longer state numbers or rules that are settings (buffers, 2–3 h, 21:30, training rules): they point
    at the Settings and Training rules sections, so a change can't leave the AI contradicting it.
  - Calendar grid stretches to fit events before 08:00 or after 22:00 (they used to be cut off).
  - Tests: 3 plain + 5 conversations (`tests/build-h-*.test.mjs`), full suite 82 plain + 97 conversations + 12 guard
    pass; AI check `tests/ai/build-h.ai.mjs` 11/11 ($0.27); routing re-check 41/41, 0 meta saved ($0.14).
    Two old tests adjusted: a label is now "Sprint" (his list's name), and "I've got 2 hours now" skips before 07:00.

- **I (11 Oct): built, not deployed.** SQL `supabase/step11-google.sql`. Needs Nat's Google Cloud setup (client ID +
  secret), then Settings → Google Calendar → Connect. `TOKEN_KEY` made (scripts/gen-token-key.sh; .env.local + Vercel).
  - Connect (Settings): Google's consent page with a one-time state + PKCE secret in an httpOnly cookie; refused if
    the state doesn't match or a box was left unticked. Permissions: make and change **only** the app's own "Life OS"
    calendar (calendar.app.created), list calendars, read events. Tokens encrypted (AES-256-GCM, TOKEN_KEY) before
    they're stored in `integrations`; never in a backup; the page only ever sees the public columns.
  - Life OS, app → Google (every 5-min tick): each week's session of his own events and his planned blocks for 4 weeks,
    with reminders: 30 min before, or at leave-by time and 10 min before it when there's a journey (exact per day:
    Uber Wednesday vs Monday). Unchanged items aren't re-sent (`google_links`). Per event "Also in my Life OS Google
    calendar" (form) / "don't put the match in Google" (bot).
  - Life OS, Google → app: moving a session there = "just this week" here; deleting = cancelled this week (a one-off is
    archived); planned blocks move or cancel. Nothing deleted in the app.
  - Other calendars (every 15 min): read-only copies (busy unless "free" or all-day), lessons from a calendar marked
    school count as school (one line a day for the AI; hidden from Upcoming), "Assignment: …" (Google Classroom) →
    a must-do homework task (school, hand in Google Classroom, subject guessed from the calendar's name), once each;
    a date change follows; one Telegram message per new batch. Never written to (tests prove 0 writes).
  - Google copies are read-only everywhere: event sheet says so; the bot has no ref for them and says "change it in
    Google". A sign-in Google stops accepting → "needs connecting again", one message, sync pauses.
  - Bot: /google (status, calendars), /sync, "stop reading the Family calendar", "the timetable calendar is school".
  - Tests: 2 plain (encryption; only-Life-OS writes, checked in the code), 6 conversations on a fake Google
    (`tests/build-i-chat.test.mjs`); full suite 84 plain + 103 conversations + 12 guard pass; AI check
    `tests/ai/build-i.ai.mjs` 6/6 ($0.13). Fixed on the way: an instruction the bot answered with no change was being
    saved as an App idea; now it replies (chat). The old C2 "Google event never changed" test now proves there's no
    ref to point at.
  - Decide later: new homework is added straight away (with a message) rather than as a ✅ card; events Nat makes
    directly in Life OS are read as copies (make them in the app to edit them here); repeating events created in Google
    come in as separate copies.

- **J (11 Oct): built, not deployed.** SQL `supabase/step11-whoop.sql`. Needs Nat's Whoop developer app (client ID +
  secret), then Settings → Whoop → Connect.
  - Connect like Google (one-time state in an httpOnly cookie; tokens encrypted). Read-only scopes + offline.
    Whoop rotates the refresh token on every refresh: the new one is saved at once; a refresh that loses a race takes
    the token the other run saved. A refused sign-in → "needs connecting again", one message.
  - Every 30 min (tick), after connecting (last 14 days) and on Sync now: `whoop_days` (recovery %, HRV, resting HR,
    sleep minus awake time, sleep performance, the day's strain; the day = the morning he woke, London) and
    `whoop_workouts`.
  - Workouts count toward a target only if he picks its Whoop activities (target form "Whoop workouts that count", or
    "count weightlifting toward Upper"); each workout once (target_logs source whoop + its id); one message per batch.
  - Low recovery (setting "Whoop recovery below this %", 34 = Whoop's red zone): the brief says so (🔴 + "lighter
    training, protect sleep"); "plan my day" treats today as tired ("Whoop recovery 21%: a lighter day") unless he said
    how he feels; the week planner places no gym today; the AI gets 7 days of Whoop data and the rule.
  - Home: Recovery card (today's %, sleep, HRV, RHR, strain; 7-day bars), only once Whoop has data. /whoop in the bot.
  - Tests: 5 conversations on a fake Whoop (`tests/build-j-chat.test.mjs`, incl. 31 workouts over 2 pages, rotation,
    revoked); full suite 84 plain + 108 conversations + 12 guard pass; AI check `tests/ai/build-j.ai.mjs` 2/2 ($0.05).
  - Decide: which Whoop activities count toward which targets (none until you choose; careful not to double count
    with Log taps).

- **K (11 Oct): built, not deployed.** SQL `supabase/step12-study.sql`. No setup needed.
  - Each subject's page: **Pipeline** (stages in order; add, rename, ↑↓ reorder, archive: progress belongs to the stage,
    so nothing is lost), **Topics** (paste the spec's list, one per line; "4.2" numbering kept as the spec ref; dots for
    stages done; "Next: …" with ✓ Done + Undo; 📓 GoodNotes link per topic = the PDF's Google Drive link; archive),
    **Mistakes to review** (log one; it comes back after N days, setting "3"; Reviewed + Undo).
  - Next action per topic = the first stage after the furthest one done (a stage added before it doesn't send him
    back). Home "Study next": up to 2 per subject (setting), started topics first, plus mistakes due; ✓ Done there too.
  - Capture (dashboard box and Telegram, same sorter): "finished the Bicen video on matrices" → Study progress card
    (subject · topic: stage ✓) → ✅ marks it done, ↩️ Undo; "Q5 wrong on moments: forgot the sign" → Mistake card.
  - Bot: "my physics pipeline is video, notes, textbook, exam questions" (stage_set: whole list; a stage renamed in
    place keeps its progress; Undo restores), "add vectors and moments to physics" (topic_new), "my series notes are
    <link>" (topic_set), "I've gone over the Q5 mistake" (mistake_done). The AI sees next actions (ST refs) and mistakes
    due (X refs) and can put them in "what should I do tonight" and day plans. The brief has "Study next" + reviews.
  - Tests: 3 plain + 3 conversations; full suite 87 plain + 111 conversations + 12 guard pass; AI check
    `tests/ai/build-k.ai.mjs` (sorter + brain) 12/12 after fixing 2 wrong expectations in the check itself ($0.21 total).
    Fixed on the way: a partial topic name ("ma") picked one of two matches; now only a unique match counts.
  - Decide: exam boards (paste each subject's topic list); the stages for each subject (examples only so far).

- **L (11 Oct): built, not deployed.** SQL `supabase/step10-guides.sql`. No setup needed.
  - Guides page grouped Study / Athletic / Personal (each guide's Area in its Edit; empty = guessed from the title).
  - "Weekly log" per guide (Edit → toggle; on for Athletic & Lower): the guide text is the fixed rules; underneath, a
    dated log per week (add, archive + Undo). By chat: "coach set 3x5 squats this week" → card → this week's log.
  - The AI answers from his guides: guide titles are in the snapshot, and the guides a message is about (word
    matching, no AI) go with it in full; "what's my recovery-night skincare?" is answered in the guide's own steps.
    Works in the bot and Ask AI. "Add magnesium before bed to my sleep guide" → card → added at the end (Undo).
  - Tests: 2 plain + 2 conversations; full suite 89 plain + 113 conversations + 12 guard pass; AI check
    `tests/ai/build-l.ai.mjs` 4/4 ($0.10). Fixed on the way: a word only one guide uses ("upper") now finds it.

- **Homework feed (11 Oct): built and deployed.** No SQL. Classroom calendars live in the school account and can't
  be shared, so `google-apps-script/homework-feed.gs` runs hourly there (Nat pastes it into Apps Script): it copies
  "Assignment: …" events (next 30 days) from the 8 Classroom calendars (list at the top, with each one's subject) into
  the "Homework feed" calendar, shared to his Gmail. Each copy keeps title, due time (or all-day), the teacher's
  description; adds "Class:", "Subject:", "Classroom: <link>" at the top and a "Ref:" (fingerprint of the Classroom
  event) at the bottom; hidden tags so it updates in place, removes copies the teacher deleted (future only; past
  copies and his own events stay), never writes to Classroom calendars, no Google pop-ups.
  - App: an assignment is keyed by its Ref (`classroom:<ref>`), so a copy that's remade is never new homework; subject
    from the "Subject:" line, else every word of a subject's name in the class name ("Maths Further Mf1a" → Further
    Maths, "Single Maths" → Maths); Classroom link → the task's hand-in link; details "class · Due 08:30"; a date change
    moves the task and its column. Telegram: "• Further Maths: Integration sheet (due Fri 16 Oct, 08:30)".
  - Tests: script run against a fake CalendarApp (`tests/homework-feed-unit.test.mjs`) + 1 conversation in
    `tests/build-i-chat.test.mjs`; full suite 90 plain + 114 conversations + 12 guard pass. No AI check (no prompt change).
  - Decided (11 Oct): when a teacher deletes an assignment the task stays as it is (no auto-archive).
  - Deployed 11 Oct (no SQL).

- **M: Email watcher (11 Oct): built and deployed (SQL run).** SQL `supabase/build-m-mail.sql`. Needs Nat to paste a script into
  each Gmail account (`scripts/mail-script.sh school|personal manifest|code` puts each part on the clipboard).
  - `google-apps-script/mail-watcher.gs`, every 15 min in each account: new emails' sender, subject and Gmail's preview
    line (format "metadata": never the body), oldest first, 40 a run, each once (cursor + last 300 ids), plus a check-in
    even with no mail. Its manifest gives it READ-ONLY Gmail (gmail.readonly), so it can't send, delete or mark anything.
    First run looks back 12 h. `checkConnection` (run once) says whether the account can reach the app.
  - School fallback if calls out are blocked: each email goes into the Homework feed calendar as data
    ("natos-mail {json}", removed after 2 days) plus one check-in event; the Google sync reads those (never as busy
    time) and stores them like posted ones (`via` calendar).
  - App: POST /api/mail/incoming (MAIL_SECRET bearer, made by scripts/gen-mail-secret.sh; 200 KB cap; each field
    checked). Stored once (`emails`, unique per account + Gmail id). Sorting: his rules first (`mail_rules`: an address,
    @domain incl. subdomains, or words; most exact wins; flag beats ignore at the same level), then automated mail
    (List-Unsubscribe/List-Id/bulk/auto-submitted, Promotions/Social/Forums tabs, no-reply senders) ignored free unless
    flagged, then Haiku in batches of 12: homework / reply / event / ignore + a one-line summary. Over the daily AI cap,
    they wait (no cost).
  - Telegram (5 per run, oldest first, only mail from the last 3 days): homework → the normal task card (capture sorter,
    "📧 Sam Smith: CS homework" on top, ✅ Save); event → a calendar card (event_new, date words must be in the email,
    ✅ Apply / ↩️ Undo); needs a reply → "✉️ sender: subject / summary" with ✍️ Draft a reply (Sonnet, from the preview
    only; placeholders for what only he knows; shown to copy, never sent) and Open in Gmail (right account, the thread);
    a flagged sender the AI would ignore → 📌 alert. A watcher quiet for 2 h → one warning a day.
  - Bot: mail_rule ("always flag emails from @ucs.org.uk teachers", "ignore the Hudl newsletter", "stop ignoring hudl":
    card, Apply, Undo = archived); /mail (each account's last check-in, today's counts, rules, AI cost per day for 7 days);
    the snapshot has his rules and the last 3 days' flagged emails; asked to send/delete email it says it only reads.
    Settings → Email watcher: the same, plus add/remove rules. /usage shows "email watcher" as its own line.
  - Tests: 2 plain (`tests/mail-watcher-unit.test.mjs`: the script against fake Gmail/UrlFetch/Calendar incl. read-only
    permissions and the fallback; the rules) + 4 conversations (`tests/build-m-chat.test.mjs`) + 1 guard (the route
    refuses without the key, never shows the key); full suite 92 plain + 118 conversations + 13 guard pass. AI check
    `tests/ai/build-m.ai.mjs` 10/10 ($0.10): 6 real emails sorted right (incl. one trying to give the AI orders), 4 rule
    phrases. Fixed on the way: the bot's memory didn't allow an "email" message type (SQL widens it).
  - Decide: none needed. Defaults: first run 12 h back; 5 Telegram messages per 5 minutes.

- **Final polish + N (11 Oct night): built.** SQL `supabase/build-n.sql` (Nat runs it; the app works before it with
  default costs). Handover: `plans/final-polish.md`.
  - Errors: production logs (1 h kept on this plan) were all 200, but the bot's own turns showed the "What type of
    training is Games / EFA football / Market Road football?" question every 5 minutes since 17:50, once per Google
    copy. Now once per session name; the answer covers every copy and later copies inherit it. Typecheck clean (no
    linter is configured: Next 16 has no `next lint`).
  - Visual QA at 390 px: 12 layout fixes (sideways scroll on every page, Upcoming overlap, task row controls, board,
    toasts, guide edit, archive, settings, sign-in, /tg, bad links) + 6 bot message layouts. `qa/REPORT.md`, `qa/*.png`.
  - **N: load-based training planner.** `lib/load.ts` (pure): every session costs legs / upper / CNS (0–10 each at
    heavy; light 35%, moderate 65%), from its type (+ any other type its name mentions: "Lower + plyo") or his own
    number for that type or one session (weekday optional) in `load_costs`. The planner searches day × intensity for
    each gym session and picks the cheapest week: day limit, any-7-days limit, high-CNS days back to back, days
    before/after a game (only legs + CNS above a limit count, so light lower the day before is fine), legs/upper
    recovery hours, tired / low-Whoop days light only (strain yesterday lowers today's limit), his training rules
    weighed (avoid 15 / prefer 4; rules can apply from an intensity up and be in hours), going lighter costs 5 a step,
    leaving it out 40. Nothing is a hard block; each session gets one "why" line. All limits are settings (Settings →
    Training load; bot `setting`); costs are data (Settings → Training load; bot `load_set`).
  - Bot: "when's best for upper body and Owen lower/plyo?" → 🏋️ Training plan card (sessions + why, load view
    🟢/🟡/🔴 per day, Whoop / back-to-back warnings, which sessions counted as games, the week he sent). 🔁 per
    session → other days best first / Lighter / Leave it out / Keep; or say "upper on Thursday". ✅ saves training
    plan blocks only (the study plan stays), with the intensity in the name; the tick puts them in Life OS. ↩️ Undo.
    "my week: Mon football 6–7:30, CS tutor 8pm…" → the AI reads it (Sonnet, `lib/telegram/weekread.ts`), kept in
    `week_notes` for that week; every week plan uses it with the calendars (duplicates of calendar events dropped).
    "Games isn't a match" now works for Google sessions (by name, every copy). "plan my week" uses the load planner
    for its gym sessions too.
  - /help: one screen by time of day; commands in Telegram's "/" menu. `docs/GUIDE.md`: the everyday guide.
  - Tests: 3 plain (`tests/build-n-unit.test.mjs`) + 6 conversations (`tests/build-n-chat.test.mjs`) + 1 in
    `tests/jarvis-g-chat.test.mjs`; AI check `tests/ai/build-n.ai.mjs` 17/17 (routing of the new phrases + the week
    reader on a real week), $0.46 over two runs.

### Still fixed on purpose (decide later)
| What | Where | Why it's fixed for now |
|---|---|---|
| Task columns (Inbox/Today/This week/Later/Someday) and must/nice | lib/tasks.ts, DB checks | The app's logic (Today, postponing, archive) is built on them; renaming is cosmetic. Ask if you want different names. |
| Areas Study/Athletic/Personal | `categories` table | Already data; there's no edit screen and colours are keyed by name (a new area is grey). |
| Resource kinds, reminder kinds, goal priority, energy (normal/tired/ill), plan block kinds | lib/types.ts | Structural: each one drives different behaviour. |
| Timezone Europe/London | lib/time.ts | Used everywhere; only matters if you live elsewhere. `profiles.timezone` exists but isn't used. |
| Upcoming = 14 days; Inbox list 15; check-in "top 3" | several files | Cosmetic sizes. |
| Events with no end = 60 min; new event from the bot = 1 h | freetime, actions-c2 | Say an end time to change it. |
| Prep sessions: 2–5 by days left | lib/prep.ts | Rule from my-spec 35; length is now a setting. |
| Tired = 60% of the focus budget, no training; ill = light only | lib/plan.ts, lib/week.ts | Could become settings. |
| "Evening" = 17:00 when you say "plan my evening" | brain prompt | Say a time to override. |
| Conversation memory 10 messages / 30 min | lib/telegram/turns.ts | Technical. |
| Models (Sonnet chat, Opus planning, Haiku sorting) | lib/ai/models.ts | One line each; change by asking. |
| Calendar grid default 08:00–22:00 | lib/events.ts | Now stretches to fit anything outside it. |
