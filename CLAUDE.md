# Nat's personal AI OS

Nat is a UK sixth-form student (A-levels: Maths, Further Maths, Physics; Computer Science independently; SMC preparation; football and gym). New to coding: give exact commands and clicks, keep explanations short.

## Read first
- `assets/my-spec.md` is the real brief. If it conflicts with any course file in `assets/`, my-spec.md wins.
- `BUILD-GUIDE.pdf` is the step order. Build ONE stage at a time, then stop so Nat can test the checkpoint.
- `assets/ideas.md` holds decisions and open ideas. Don't build open ideas unless Nat asks; when he does, propose a plan first and wait for "go".
- Course files in `assets/` (schema, prompts, tests, security checklist) are for structure, security and testing only.
- Plans will change. Keep the design modular so features can be added, changed or removed without rebuilding.

## Stack
Next.js + Supabase (auth, database, row level security) + Anthropic API (server-side only). Hosting on Vercel. Integrations: Telegram, Google Calendar, Whoop. Timezone: Europe/London.

## Rules
- Secrets only in `.env.local` (git-ignored) and Vercel env settings. Service role key, API keys and OAuth tokens never reach browser code.
- Every table has row level security scoped to the owner.
- Completing a task archives it; never delete. Ask before destructive schema changes.
- Routines never become "overdue".
- Mobile-first and installable on a phone home screen; capture must take seconds.
- Show loading, empty, success and error states. Never claim a save succeeded unless the database confirms it.
- Never hardcode my schedule or routines. They're editable data; Google Calendar is the source of truth for events.
- Integrations: Hevy via official API only; TrainHeroic via capture or CSV import only.
- The AI only recommends; it never edits records without Nat confirming.
- Never edit or delete Google Calendar events outside the "Life OS" calendar.
- One change at a time.
- Never hardcode my schedule. Events are editable data; Google Calendar is the source of truth.
- Standing rule (Telegram bot): it handles any request about schedule, tasks, training or settings, incl. recurring events and rule changes. Anything new the app can do, the bot must be able to do too. If it can't, it says "I can't do that yet — it needs adding in Claude Code" and saves the request to App ideas (`app_ideas` table, `/ideas` in Telegram). Open App ideas are Nat's requests: check them when planning work, but build one only when Nat asks.

## Speed rules
- Small changes: write the change, run only the tests for the files you touched, deploy. Aim for under 10 minutes.
- If a test fails because it expects the OLD behaviour Nat asked to change, update it and move on.
- If a test was already failing before your change, don't investigate it. Note it in `plans/known-issues.md` and deploy.
- Never spend more than 5 minutes on a test problem without telling Nat. Ask "fix or skip?" in one line.
- Full suite only for big builds or when Nat says "full test".
- Don't do extra cleanups, refactors or polish Nat didn't ask for.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
