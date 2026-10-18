# Final polish (11 Oct 2026, night): handover

Deployed to production on 11 Oct (Nat said go). Details per phase: `plans/build-2.md` ("Final polish + N").

## Done
1. **Errors.** Production logs (Vercel keeps 1 h on this plan) were all 200. The bot's own history showed the real bug:
   the "What type of training is Games / EFA football / Market Road football?" question was sent every 5 minutes,
   once per Google copy. It's now asked once per session name, the answer covers every copy, and later copies inherit
   it. Mail, Google sync and the morning brief were healthy. Typecheck clean; no linter is configured.
2. **Visual QA at 390 px.** 12 layout fixes and 6 bot-message layout fixes. See `qa/REPORT.md` and `qa/*.png`.
3. **Weekly planner, load-based** (your two mid-session asks):
   - "when's best for upper body and Owen lower/plyo?" → 🏋️ card: a why-line per session, a 🟢/🟡/🔴 load view per
     day, 🔁 to move any session, ✅ → plan + Life OS.
   - Every session costs legs / upper / CNS (0–10). Intensity is light / moderate / heavy.
   - Limits, game protection, recovery hours and the Whoop strain level are settings. Costs are data
     (`load_costs`). Your rules are guidelines the planner weighs, not hard blocks. All of it can be changed by chat
     and in Settings → Training load.
   - "my week: …" is read and kept for that week.
4. **Guide.** `docs/GUIDE.md`; `/help` is the one-screen version, and the commands are in Telegram's "/" menu.
5. **Tests.** 95 plain + 121 conversations (3 skip themselves late at night) + 13 guard pass. AI check
   `tests/ai/build-n.ai.mjs` 17/17, $0.46 over two runs.

## Nat to do
1. Run `supabase/build-n.sql` in Supabase → SQL Editor. Until then the planner uses default costs, can't save your
   own costs or "moderate" on events/targets, and only uses a sent week in that one message.
2. Answer the type questions once each (Games, EFA football, EFA training, Market Road football). If school Games
   isn't a match, say "Games isn't a match"; otherwise Tuesdays get protected as game eves.
3. Your saved rule TR1 ("No Lower or plyo the day before a sprint session or match") still covers light sessions.
   Say "light lower is ok the day before a game" to change it.

## Next steps (not tonight)
| What | Source | Needs |
|---|---|---|
| Hevy sync (official API only): workouts count toward targets and load | my-spec 29 | Nat's Hevy Pro API key |
| TrainHeroic import (CSV or capture only): sessions and coach's programme into the weekly log / load | my-spec 29 | An exported CSV to build against |
| Supplement stock tracker (stock, daily use, "running low" in the brief) | my-spec 20 | What you take and how much |
| Load from real workouts: Whoop strain per workout → actual load per day (now: planned costs only) | this build | Nothing (Whoop is connected once you connect it) |
| Notion CSV import, restore test, evening journal, football session generator, voice notes | build-2 list | Later |
