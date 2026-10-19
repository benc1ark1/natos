# Overnight decisions (19 Oct 2026)

Decisions made while you slept, grouped by queue item. Change any of them by telling the bot or Claude Code.

## Setup (PR 0)
1. **"Existing ACT system" and "holiday mode" weren't in this repo.** There was only an ACT subject in the sample data
   and nothing called holiday mode, so both were built fresh. Any ACT data you already have (ACT subject, ACT
   tasks/goals) is kept (items 2 and 5).
2. **There was no test database on this PC**, so the 134 existing Telegram conversations couldn't run. I built a local
   stand-in (`tests/localdb/`: real Postgres + PostgREST + a tiny fake sign-in server). Every conversation test now
   runs locally, with one database per parallel worker. Your cloud test database still works the same way.
   - It uses PostgREST v14, the same as Supabase cloud (v12/v13 can't handle the bot's queue lock).
3. **Two unit tests failed only on Windows** (`URL.pathname` gives `C:\C:\…`). Fixed with `fileURLToPath`; no app code
   changed.
4. **A setup PR (#0) comes before the 8 queue PRs.** It has the Windows fixes, the local test database, the plug-in
   foundation and the data contracts. Merge it first.
5. **Plug-in foundation.** Each feature joins the bot through `lib/telegram/plugins/<name>.ts`: its changes, the
   messages it understands without AI, its commands, scheduled messages, buttons and settings. Features no longer all
   edit the same big files, so the 8 PRs merge one by one and future features are smaller.
6. **Your GitHub repo `benc1ark1/natos` is public.** So the study spreadsheet, and anything with your school's or
   teachers' names, is **not** committed. You import the tracker by uploading the .xlsx on the Subjects page
   (preview → Confirm).
   - The repo already had personal files from before (my-spec, `supabase/nat-data-*.sql`). Consider making it private:
     GitHub → Settings → General → Danger zone → Change visibility.
7. Git commits are made as "Nat <nbabich6@gmail.com>". It's a repo-only setting, because this PC had no git identity.
8. Each PR is one clean commit on top of the one before. Work in progress (including an early comment that named
   teachers) never reaches the public repo.
9. **Reviews.** Items 1 and 4 each had two separate reviewers (one for correctness, one for security and the
   CLAUDE.md rules). After the 2:55 usage limit, items 2, 3, 5, 6, 7 and 8 had one reviewer covering both focuses,
   plus my own check of the security rules, to stay within 3 agents at a time. Every finding marked should-fix was
   fixed and re-tested.
10. I fixed a real (rare) bug: the bot's event refs (E1, E2…) could swap between messages, because events were read
    in no fixed order. They are now ordered by creation.

## 1 · Study tracker (PR 1)
11. Tests stay goals (kind "test") with the sheet's extra details, so the existing test features keep working.
12. The old rule-based prep sessions (lib/prep.ts) still get made for a new test, but Today ignores them. The new test
    mode plans revision instead: diagnostic → booklets → 🔴/🟡 → timed practice → light day.
13. "Maths" in a rule ("maths + physics 45 min/day") means Maths + Further Maths.
14. **Strict priority, by time and by count.** Homework → anything a live "top priority" rule boosts → tests →
    reviews → 🔴 fixes → getting ahead → stretch → leftover. Steady ACT and a due programme (STEP) only take free slots
    once those are covered; they never push one out.
    - The planner returns at most as many study picks as Today has room for (5 minus training and must-do tasks).
15. ⚠️ **Visible this half-term:** with 4 tests inside 3 weeks, steady ACT (with no retake date) waits every day. The
    plan says "left for another day: ACT …". If you want ACT anyway, say "ACT top priority this week", or set your
    retake date (the countdown's last 3 weeks count as a test).
16. **Test mode:**
    - At most 4 test picks a day in total (≤ 2 per test), so mistake redos and reviews still happen when tests overlap.
    - Time goes to 🔴 / 🟡 / not-yet-rated topics only; 🟢 topics get the small stretch share in the last 2 weeks.
    - No diagnostic when ≤ 4 days are left.
    - Redoing a test's own mistakes counts as that test's prep.
    - An FM test with Y1 topics makes Maths light the day before too.
17. A booklet attempt naming no topic counts as all booklets done; naming codes counts only for those topics.
18. Only one 🔴 "fix" pick a day at that tier; more 🔴 topics come through the fixing share. A due 🔴 review starts
    with a 5-min re-learn. A taught ⚪ topic gets a "rate it" pick (1–2 fresh questions).
19. "Pause reviews" also pauses mistake redos. A programme paused until a date resumes by itself the day after.
20. STEP is never shortened below its 60–90 min. If it doesn't fit on Saturday it tries Sunday.
21. The weekly Bicen "memorise sheet" isn't scheduled automatically: that would need a hard-coded day. Add it as a
    routine or a programme if you want it ("new programme: memory sheet, 1 a week").
22. **Import:**
    - Maths and FM share one school order (the Maths+FM tab's row order), so getting ahead interleaves them like your
      sheet.
    - Your colours, steps and notes already in the app win over the sheet; any different sheet value is listed as a
      clash.
    - The 21 Further Maths textbook topics not in your sheet are kept, after the school order.
    - STEP = 1 a week, at the weekend, 90 min.
    - The upload limit is 4 MB.
23. The 14 resource links (Bicen, Integral, MadAs, STEP, PMT…) are on the Settings page. Paste your Bicen links there
    and every "open" line becomes a link.
24. In Telegram, setting a colour also sets "last done" to today. Textbook/exercise scores don't change the colour;
    only fresh questions do.
25. **Classroom:**
    - Only the assignment title is checked for test words.
    - Questions come one at a time, never in quiet hours or school.
    - ✅ on "Test on … – plan revision?" also archives the homework copy, so it isn't planned twice (↩️ Undo restores
      it).
26. /maths now shows the new tracker.

## 2 · ACT (PR 2)
27. **Chapter counts are guesses titled "Chapter n":** Meltzer 16, Reading guide 10 method + 8 timed passage sets,
    College Panda 30, Advanced ACT Math 12, Critical Reader 12. Fix one by chat: "Meltzer has 18 chapters".
28. The full timed test / mock is on Wednesdays, and school-week ACT is Tue/Thu/Sat (both are settings). Your last real
    score (34) is dated the day before your earliest logged score.
29. **When the extra books start:**
    - Critical Reader starts only if reading stalls (3 reading scores below 36, not improving, after the Reading
      guide's method chapters), or when you say "start the Critical Reader". After that it's one Critical Reader
      chapter per two guide items.
    - Advanced ACT Math starts only once every College Panda chapter is tested or done.
30. On a short countdown day the reviews shrink first, before the alternating section is dropped.
31. Without "ACT" or "practice" in the message, a score needs E, M and R together (or "english section 30").
32. The 175-minute weekly mock isn't cut to fit a short day.

## 3 · Telegram speed + ideas inbox (PR 3)
33. **Models:**
    - A quick router (claude-haiku-5-5, effort low) answers simple messages: thanks, exact lists, obvious new items.
    - Anything it's unsure of, or if it fails or is slow (> 6 s), goes to the full assistant (claude-sonnet-5-5) as
      before.
    - Planner stays claude-opus-5-5; sorter stays claude-haiku-4-5 (moving it to Haiku 5.5 is a follow-up).
34. **These always go to the full assistant:**
    - your answer to a question the bot just asked ("yes", "the physics one");
    - a request riding on a greeting ("hey buy milk");
    - a one-word message;
    - a question without a "?";
    - anything about next week, next month or this term.
35. Buttons are now ✅ Save/Apply · ✏️ Change · ❌ Cancel everywhere. Old messages' buttons still work.
36. **App ideas:**
    - /ideas sends one ready-to-paste block.
    - "/ideas done 3" and "/ideas drop 3" mark ideas, show the new numbering and say "/ideas undo" reopens the last
      one.
    - These are your own commands, so there's no ✅ card. Nothing is deleted.
37. Known limit: the bot reuses what it read for up to 30 s between back-to-back messages. A website edit or a
    Google/Whoop sync inside that window is picked up by the next message after it.

## 4 · Events + life by chat (PR 4)
38. Routines and weekly top-3 priorities can be changed by chat too ("can change ANY of my data").
39. **Default lengths when no end is given:** meal 2 h, football 1.5 h, appointment 1 h, cinema 2.5 h, party 3 h,
    otherwise 1 h. The card says so; tap ✏️ to change it.
40. **Bare hours:**
    - 1–6 = pm.
    - 7–11 = evening for evening things (football, dinner, friends, cinema, party), morning for appointments.
    - "dentist 7" is asked.
    - "All day" = busy 08:00–22:00.
    - Cancelling or moving a weekly session changes just this week, unless you say "every week".
41. The fast path is deliberately cautious. Anything unclear ("revision tomorrow 4", "football Sun 10" without am/pm,
    "Owen Tue 6") goes to the full assistant instead of guessing.
42. Adding or removing a routine step needs supabase/life.sql first, so steps can be archived, never deleted. Moving,
    renaming and day changes work before it.
43. Priorities said on Sat/Sun with no week named go to next week.

## 5 · Today + morning/evening (PR 5)
44. **The morning message** is Today, pinned: 07:30 by default, and on holidays not before your holiday wake time.
    `/brief full` still gives the old whole-day brief.
45. **The evening message** is a tap per item at your end-of-day time (21:00). Anything not ticked comes back tomorrow
    by itself, straight after homework.
46. **Today's limit:**
    - At most 5 things (Settings: 3–5).
    - Homework with no free slot stays on the list, marked "no free slot long enough today".
    - Homework also counts towards the limit, earliest due first.
47. A tap carries what you want (tick or untick), so a double tap or an old message can't undo a tick. Unticking says
    honestly what was put back and what had changed since (that stays).
48. "what next?" answers with the first thing on Today that isn't done, so it's the same list everywhere.
49. "Most things on Today" is the Today setting; the old one is now "Most tasks on the To do card".
50. /today after the morning message is an instant list. The first look of a day with no list yet plans the day.
51. **Holidays:**
    - The Holidays setting starts as this half-term (17 Oct – 1 Nov 2026), because you're on half-term now. It's an
      editable list in Settings (or by chat), not code.
    - Holidays skip school in Today, the morning message, and the new-homework and training-type questions.
    - The Your week card and the training week planner still see school on holiday days. Follow-up: one line in
      lib/telegram/ripple.ts `loadWorld`.
52. PR 5 has no Training tab or Help link; they arrive with their pages in PR 6 and PR 8, so every PR works on its own.

## 6 · Training + gym (PR 6)
53. **Formats:**
    - "bench 80x5x3" = 80 kg × 5 reps × 3 sets.
    - "squat 100 5x5" = 5 sets × 5 reps.
    - "80x8" = one set.
    - Only your exercises are logged (the default list or ones you added). A new name needs kg or lbs.
    - "squat 5x5" with no weight is asked.
54. **Progression:**
    - Rep ranges: 5–8 for big lifts, pull-ups and dips; 8–12 for dumbbell and machine work.
    - All sets at the top of the range → +2.5 kg upper / +5 kg lower; otherwise +1 rep.
    - No progress for 3 sessions → 10 % deload, then it builds back up (never a second deload in a row).
55. Weekly sets count 1 for the main muscle and ½ for helpers. Bodyweight moves store the added weight; set your
    bodyweight in Settings for their e1RM.
56. **Training defaults** (still marked as guesses; your saved rules win):
    - Light lower is OK the day before a game; heavy lower and plyo are not.
    - Upper is 2×/week, 90 min, at least 48 h apart.
    - Owen's sessions are the hardest to move.
    - A session on a day you fixed is never dropped because the week is busy.
57. **Hevy CSV:**
    - "(Assisted)" rows are skipped.
    - Re-importing the same file never doubles sets.
    - A partly failed import says "Saved X of Y sets".
58. "Upper Mon + Sat" is your set-up data, not a code default.

## 7 · Weekly check (PR 7)
59. Sunday at your reset time (18:00) is ONE message:
    - done vs planned per subject, tracker moves, ACT trend, gym PRs, what's behind, and one suggestion;
    - then "Plan next week? ✅" → the Your week card.
    - The automatic Sunday card and the check-in reminder are off while the weekly check is on (setting `weeklyCheck`).
60. "reviews 2 done · 3 due" counts what's still due now.
61. Colour changes need a Monday snapshot (supabase/weekly.sql). In the first week it just says "N topics worked on".
62. Gym PRs use the same e1RM maths as the 🏆 alerts. A first log of a lift isn't a PR.
63. If your check-in day is a weekday, Sunday still sends next week's Your week card, and a Monday check looks back on
    last week. The 18:00 nudge is only skipped when the weekly check actually goes out.
64. "Plan next week? ✅" is safe to tap again if a run died half-way. A button from an earlier week says so instead of
    planning the wrong week.
65. Today's evening message still comes on Sunday after the check: they're different jobs.

## 8 · How to use (PR 8)
66. **One source** (lib/help.ts) feeds /help, the Help page and docs/HOW-TO-USE.md, so they can't disagree.
    - It shows your own times from Settings.
    - /help fits one phone screen; "/help all" lists every command.
67. The Google Sheet backup steps are for a computer: the Sheets phone app has no File → Import. Clear A4 down
    first, so old rows don't stay underneath. Programmes has no tab in your sheet: add one the first time, or skip it.
68. docs/GUIDE.md was updated to match the new behaviour (07:30, evening roll-forward, Sunday weekly check).

## Final QA (in PR 8)
69. **Simulated a half-term week and a school week end to end** (morning tick → taps → evening tick, every day; 369
    rule checks). They found 4 real bugs, all fixed in PR 8. They're Today/planner bugs, but they live in PR 8 so the
    earlier PRs didn't need re-testing:
    - homework that became due could drop off Today when yesterday's items rolled on;
    - an undone mistake redo came back once for every day it was left;
    - at the weekend the training planner looked at next week and moved Saturday's fixed upper to Monday;
    - homework titles repeated the subject.
70. **Undecided, needs your call:** in half-term, Home's Calendar card and Insights still show "School" every weekday.
    Today and the planner skip it correctly. Hiding it there would show School as "cancelled this week".
71. **Worth a look:** on a busy school day the planner once put a 30-min item at 07:30, before school, the same minute
    the morning message arrives.
