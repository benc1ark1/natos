# Fix round: what changed (21 Oct 2026)

The plan was `plans/fix-round.md`. Everything is tested on your real autumn: half-term 17 Oct – 1 Nov, ACT Sun 25 Oct,
school back Mon 2 Nov (`tests/support/nat-real.mjs`). No database changes. Nothing changes without your ✅, nothing is
deleted, and routines weren't touched.

## Do these after it's live (5 minutes)

1. **Send the bot:** `until 25 Oct only ACT` → tap ✅. (This is your focus period. It ends by itself after the 25th.)
2. **Send the bot:** `don't start FM homework, physics SHM, Vlad and HT2 revision before Mon 26 Oct` → tap ✅.
   Your earlier message saying this got swallowed by the waiting week card (bug 10), so it was never saved.
3. **Send the bot:** `in half-term Owen's speed is Wednesday 11:00` → tap ✅ (if you haven't already).
4. **Email:** paste the new `google-apps-script/mail-watcher.gs` into **both** Apps Script projects (school and
   personal; `scripts/mail-script.sh` fills in the three lines). Until you do, "only CC'd" emails and group emails are
   sorted the old way.
5. **Sam:** Settings → "Tutors whose homework expires after their next lesson" starts as `CS tutor`. If Sam's lessons
   are called something else in your calendar (e.g. `Sam`), change it to `Sam, CS tutor`.

## Planner

1. **Not before, Later, focus periods.** A task with "don't start before Mon 26 Oct" is never planned before then.
   Later tasks are only planned if they're due that week. In a focus period ("until 25 Oct only ACT") only that
   subject is planned. The week card shows the focus at the top. Settings shows it too.
2. **Test days.** A test on a day without school (the ACT, Sun 25 Oct) takes the whole day: no homework, no gym. The day
   before is light. A class test on a school day (FM HT2, Wed 4 Nov) is a normal day. Training and study now use the
   same rule.
3. **Holidays.** Everything school-linked is off: school, school football, school gym, free periods, and sessions that
   can only happen at school. Owen's sessions use their holiday days and times in a holiday week.
4. **"Until" rules end by themselves.** "Upper 3× until 1 Nov" goes back to your normal 2× from Mon 2 Nov. A fixed day
   that's full (Tue: school football, then Owen at 18:30) moves the session to another day instead of dropping it.
5. **No doubles.** Never two of the same session in a day (no more upper Fri 12:30 *and* 15:00). One block per task per
   day. A week you typed out and the planned sessions merge.
6. **Today's order.** In a focus period, or before a task's start date, overdue and Later things don't jump to the top.
7. **App ideas** never become tasks or blocks.
8. **Free time.** In the ACT focus, free time becomes ACT blocks (reading, grammar, ACT maths). Otherwise it follows the
   spec order: deadlines → tests/prep → training → this week's priorities → spare-time goals.
9. **"Plan next week" works any day**, and in any word order ("for next week can you sort my plan").

## Bot

10. **A message while a card waits is its own message**, unless it clearly edits that card. "Owen moved to Wed 28 Oct
    11:00" or "add physics homework due Friday" get their own card. "Move upper to Saturday" or "less study Friday"
    still change the week card. After you ✅ a change, the waiting week card re-fits by itself.
11. **/app never applies a card.** I couldn't find any way `/app` applies a card: "Your week is set" only follows a
    ✅ tap. The likely cause is a tap Telegram delivered late. Late taps are now refused, and the bot says
    "⏱ A tap on that card reached me late". If you see that, just tap ✅ again. If it ever happens again without
    that message, tell me.
12. **1️⃣ on a clash with a week note works** (no more "invalid input syntax … week:1"). It takes that item out of
    the week you typed, and Undo puts it back.
13. **Event changes keep your date.** "Owen … Wed 28 Oct 11:00" stays Wed 28 Oct, even over several lines.
14. **Clean titles:** "Upper · PureGym", never "Upper (PureGym Swiss Cottage; type=upper)".
15. **"Owen's days may need updating"** only appears when a genuinely better term week exists (every session placed,
    and clearly better). It's worked out on a normal school week, not half-term. ✅ keeps your own fixed days.
16. **"⚠️ Slipped"** never lists archived tasks.
17. **Small edits don't ask the AI.** Editing the week card re-fits it in code. The AI only runs for a fresh plan, and
    not at all for days that are a focus period or a test. Say "re-plan the week" when you want fresh picks.

## Views

18. **Today** is a numbered list with minutes. Only fixed things show a clock time: calendar events, and sessions at
    a set time (Owen's speed). A session the planner placed (upper 12:30) shows its minutes.
19. **/week** shows the planned study and training blocks too, not just bookings.

## Homework and email

20. **Classroom homework:** the title is the topic, with the real due date and the questions in the notes. Old
    "Homework from …" tasks are renamed on the next sync, unless you renamed them yourself.
21. **Sam's homework** archives itself ("expired", never deleted) once his next lesson has passed. Only homework
    expires. A note like "pay Sam" doesn't.
22. **Emails where you're only CC'd, or between other people:** no card and no alert. They go in "Emails worth a look"
    (Inbox page and `/mail`). Emails to a group you're in (year13@…) still come through. Group homework is a card you
    save yourself, never saved by itself. Homework and deadlines are never hidden. The watcher now sends mail in
    smaller batches, so a big run can't jam it.

## Choices you may want to change

- In a focus period the planner is strict: only that subject, even if a non-ACT task is overdue.
- ACT free-time blocks can make a half-term day long (about 6 h of ACT on Thu 22 Oct).
- `/brief full` (the whole-day timeline) still shows clock times for everything. Only Today was changed.
- "Friday light" is still a weighed rule. In a very full week a heavier Friday session can happen, and the card says so.

## Not in this round

- Your `/ideas` list wasn't pasted, so no App ideas were built. Paste it next time to do them.

## Tests

All 568 unit tests pass. In the full chat suite (422 tests), the only failures are the 9 that already failed before
this round (listed in `plans/known-issues.md`). Each item above has its own test on your real data:
`tests/fixround-{a,b,c,d,e}-unit.test.mjs` and `-chat.test.mjs`.
