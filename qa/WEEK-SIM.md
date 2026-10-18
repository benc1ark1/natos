# Whole-week simulation (Build O, part 15)

**Test:** `tests/build-o-weeksim-chat.test.mjs` · **Transcript:** `qa/WEEK-SIM-transcript.md` (every message the bot
sent, in order) · **Result:** passes (12 Oct, after the fixes below).

Run it: `SIM_OUT=qa/WEEK-SIM-transcript.md node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs --test tests/build-o-weeksim-chat.test.mjs`

## What it does
The TEST database, a fake Telegram, a scripted AI, and the clock moved to a real school week (Mon 5 – Sun 11 Oct).
Nat's real set-up: school Mon–Fri 08:45–16:00, CS tutor Mon + Thu, maths tutor Wed, EFA football Tue, Market Road
football Fri, Games Wed, EFA training Sun, targets Upper 3 / Lower + plyo 2, Morning and Night routines.

| When | What happens |
|---|---|
| Mon 07:00 | First brief + "I need a few details to plan your week properly — 2 min" + question 1; the clean-up card, Owen's days, Your week |
| Mon 07:01–07:09 | Gap questions answered (taps and typed: wake 06:50, bed 22:30, football Mon + Wed, …); the week card and the Owen card re-sent with the answers |
| Mon 07:10–07:12 | Clean-up (EFA training pre-set to Archive) ✅, Owen's days ✅, Your week ✅ |
| Every day 07:00 | Brief + pinned Today as one timeline, with tick buttons |
| Tue | Football cancelled (re-fit card), new Classroom homework (offered a slot before it's due) |
| Wed | A teacher email ("Read chapter 5", must, before Fri) saved and fitted in |
| Thu | Whoop 25% → "lighter training today" card; "game moved to Saturday, leave 9, back 3" ✅ → the week re-fits |
| Fri | "where can I save time?" → 40-min upper applied; "which days should I give Owen?" |
| Every day 21:05 | The wrap-up (done, not done → tomorrow with one ✅) |
| Sun 18:05 | Your week for the coming week: last week's review, suggestions, every day, upper 2×/3×, vs Owen; ✅ |

**Checked after every step:** every message fits Telegram (≤ 4000 chars), nothing like `undefined` / `NaN` / `null`
leaks into a message, no error messages, no two plan blocks overlap, no plan block sits on a busy event, no day's
load goes far over the limit. Plus the specific checks per step (questions asked, answers saved as settings, the
week card re-sent after the answers, ignored sessions, Owen's days saved, the low-Whoop card, the slot offer before
the deadline, Sunday's card starting with last week).

## What it found (all fixed)
1. **An answer that confirmed a guess wasn't saved as confirmed**, so the same question came back. Fixed.
2. **Owen's days forced a session onto a busy slot.** Now they're a strong preference: a day with no room puts it
   elsewhere.
3. **A typed instruction was taken as a correction to an open add-only card** (e.g. the wrap-up). Only re-plannable
   cards take corrections now.
4. **"where can I save time?" was blocked by an open card.** Lists always answer at once.
5. **Old "what type is this session?" questions repeated** alongside the new gap questions. They stop once the gap
   finder starts.
6. **The 7-day load limit was counted once per overlapping window** (one heavy day counted 7 times). Now only the
   worst window counts.
7. **School "Games" counted as a match in the typical week** used for Owen's days. Only sessions that repeat weekly
   (checked over ±4 weeks) count.
8. **Re-fit noise**: after a change, past blocks and stretching were "moved" too. Now only future blocks that are
   actually broken (or on the changed day) move.
9. **Speed + circuits landed on game day.** Game day now costs a lot for anything but mobility.
10. **The wrap-up moved homework past its deadline.** Never after it's due (overdue: tomorrow only); test prep only
    before the test; otherwise "⚠️ No free time before it's needed for: …".
11. **Owen's days card sent twice on Friday** (asked at 16:42, re-check at 21:05). No re-check while a card is open,
    or for the same days he was just offered.
12. **The wrap-up listed a task twice** (still open + moved). Once now.
13. **Week card reasons**: raw decimals ("31.7") and an over-limit warning shown as the reason. Whole numbers now,
    the good reason first, warnings marked ⚠️, said once on the Owen card.
14. **"Owen's current days would score better"** appeared on a week card. The optimiser now starts from Owen's
    current days (the saved ones, else his suggestion) and keeps them when they score better; the comparison is
    with the days Owen actually has now.

15. **After a change, a session could sit on top of another** (football cancelled → Upper moved into Tuesday's slot
    while Core stayed at its old time there). A session left in place now takes its new time when a moved one lands
    on it ("to make room"), and study blocks move off moved sessions too.
16. **The 07:00 Owen card was worked out before his answers** (football Mon + Wed changes the best days). A waiting
    Owen card is sent again, with his answers in, after the gap round and after the clean-up (only if the days
    changed; the old card's buttons go).
17. **Knock-on lines showed the old place** ("Upper @ PureGym … → Tue 16:10" when it moved to the school gym). The
    new place or intensity is shown ("…, as Upper @ School gym").
18. **Settings listed poor kit twice** at the school gym ("upper-body machines" as kit and as poor). Once now.

## Worth knowing (not bugs)
- With football on Mon **and** Wed (as answered in the sim) plus Tue, Wed Games, Fri and the game, no day suits a
  heavy speed session: the Owen card says so plainly and suggests fewer football sessions or a light Owen session.
  With the real calendars (no Mon/Wed football yet), Owen's days come out differently. The gap finder asks about it.
- Upper comes out 2× in a full week (the 7-day load is just over the limit) and 3× in a lighter one.
- Injury prevention stayed on the Saturday after the game moved there (a moderate home session after a game is
  allowed; the rules are weighted, not hard).
- The study part of the week card comes from the planner AI, scripted in the sim (so "0 study blocks" there).
