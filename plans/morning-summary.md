# Good morning — the overnight run (19 Oct 2026)

The whole queue is done: 8 items + a setup PR. Every PR passes the full test suite on its own. Nothing is deployed.

## What's done
| Pull request | Queue item | What you get |
|---|---|---|
| [#1](https://github.com/benc1ark1/natos/pull/1) | setup | Local test database, the bot's plug-in foundation, the data contracts, all SQL files |
| [#2](https://github.com/benc1ark1/natos/pull/2) | 1 | Your spreadsheet as the study tracker + the planner that follows its rulebook |
| [#3](https://github.com/benc1ark1/natos/pull/3) | 2 | ACT steady/countdown modes, your books, scores and trend, `/act` |
| [#4](https://github.com/benc1ark1/natos/pull/4) | 3 | "typing…" in 0.1 s, simple replies in ~1 s instead of ~5 s, one button style, the ideas inbox (`/ideas`) |
| [#5](https://github.com/benc1ark1/natos/pull/5) | 4 | Events, routines and weekly priorities by chat ("dinner tonight 8", "cancel football Wed") |
| [#6](https://github.com/benc1ark1/natos/pull/6) | 5 | **Today**: 3–5 things, what to open, one tap each; 07:30 morning + 21:00 evening messages; holidays; calmer phone layout |
| [#7](https://github.com/benc1ark1/natos/pull/7) | 6 | Lifts by chat, Hevy CSV import, e1RM/PRs/volume/next-session suggestions, charts, `/gym`, `/owen` |
| [#8](https://github.com/benc1ark1/natos/pull/8) | 7 | Sunday 18:00: one message + "Plan next week? ✅" |
| [#9](https://github.com/benc1ark1/natos/pull/9) | 8 | `/help`, the Help page, docs/HOW-TO-USE.md; the final QA (2 simulated weeks, 70 conversations, screenshots, 4 bugs fixed) |

**Tests on the final branch:** 464 unit + 374 chat, all pass. Each PR was checked on its own too, e.g. #2 (the study tracker): 307 + 174.
Every item had a reviewer, and every finding marked should-fix was fixed.
Decisions I made for you are in `plans/overnight-decisions.md`.

## 1. Merge the PRs in order (GitHub → Pull requests)
Merge **#1, then #2, #3 … #9**, one at a time (titles say 1/9 … 9/9). Each PR is built on the one before it.
1. Open the PR → **Merge pull request** → **Confirm merge**. Use the plain merge, not "Squash" or "Rebase", so the next
   PR stays clean.
2. Click **Delete branch**. GitHub then points the next PR at `main` by itself.
3. Open the next PR and repeat.

## 2. Run the SQL (after merging all 9)
Supabase → SQL Editor → New query → paste the file → **Run**. Do these files in this order:
1. `supabase/tracker.sql`
2. `supabase/act.sql`
3. `supabase/today.sql`
4. `supabase/speed.sql`
5. `supabase/life.sql`
6. `supabase/gym.sql`
7. `supabase/weekly.sql`

All 7 are safe to run twice, add row level security to every new table, and drop or delete nothing.

## 3. Vercel
- **No new environment variables.**
- If your Vercel project is already connected to `benc1ark1/natos`, merging into `main` deploys by itself.
- If it isn't connected yet: Vercel → your project → **Settings → Git → Connect Git Repository** → `benc1ark1/natos`
  → then **Deployments → Redeploy**.

## 4. Things that need you
1. **Make the repo private** (recommended). It's public, and it already had personal files from before.
   GitHub → Settings → General → Danger zone → Change visibility → Private.
2. **Import your tracker:** app → Subjects → Import → choose `Nat-Study-Tracker-FINAL.xlsx` → check the preview →
   **Confirm**. It stays only on your PC and in your database, never in the repo.
3. **Paste your Bicen / Integral links** in Settings (the resource links). Then every "open" line becomes a link.
4. **ACT:** send `/act` in Telegram and tap ✅ on the set-up card. Fix chapter counts by chat if they're wrong
   ("Meltzer has 18 chapters").
5. **Answer the bot's gap questions** when they come (one at a time, never in school or quiet hours).
6. **Check Settings → Holidays.** It starts as this half-term (17 Oct – 1 Nov).
7. **Two small calls only you can make** (details in `plans/overnight-decisions.md` 70–71):
   - Should Home's calendar hide School in half-term?
   - The 07:30 study item on busy school days.
8. ⚠️ **This half-term, steady ACT waits** because 4 tests are close (strict priority). Say "ACT top priority this
   week" if you want it anyway.

## Start your day (5 lines)
1. 07:30: open the pinned **📌 Today** in Telegram (or Home in the app). It's at most 5 things, each with what to open.
2. Do them in order and tap ☐ → ✅ as you finish each one. Tap again if you ticked by mistake.
3. Anything new, just say it ("physics homework due Fri", "bench 80x5x3"). Nothing saves until you tap ✅.
4. Stuck? "what next?". Can't do it? It says so and saves the idea; `/ideas` gives you the list for Claude Code.
5. 21:00: tap what you did. The rest moves to tomorrow by itself. Sunday 18:00: read the weekly check and tap ✅.
