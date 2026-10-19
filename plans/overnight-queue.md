# Overnight queue (saved verbatim from Nat, 19 Oct 2026)

OVERNIGHT RUN – I'm asleep. Don't stop to ask me anything: make sensible decisions, write each one in plans/overnight-decisions.md, and keep going until the whole queue is done. If you hit a usage limit, wait and continue when it resets. Quality over speed – I want this finished, fully tested and polished.

SETUP
- New repo benc1ark1/natos (moved from the old one), Windows PC, no .env.local. Write code + tests without secrets. Database changes go in new supabase/*.sql files for me to run. Don't deploy.
- Save this whole prompt to plans/overnight-queue.md first.
- Agree data contracts first (plans/contracts.md), then use parallel subagents in separate git worktrees for independent parts. Two reviewer subagents check correctness, security and CLAUDE.md rules before each pull request. One pull request per queue item, so I can merge them one by one.
- Keep everything that already works (ACT, holiday mode, homework/Classroom feed, Your week card, Owen's fixed days, Life OS calendar, Jarvis). Extend, never break. Run the existing test suite after every item.
- CLAUDE.md rules stay: secrets server-only, archive never delete, nothing changes without my ✅, never edit calendars outside "Life OS".

THE WHOLE POINT OF NAT OS – every item must follow this
- I wake up and know exactly what to do, without thinking or organising. Today shows at most 3–5 things, each with the exact thing to open, and one tap or one message to mark it done.
- Simple beats clever. My biggest risk is getting lost optimising the system instead of doing the work. Every feature must REDUCE my daily effort. If it adds steps, don't build it.
- A. The planner always decides WHAT to do and WHICH resource, and advances automatically when I report something done. "What next?" = exactly what to open.
- B. Telegram is a full assistant like ChatGPT, not a command list: it understands anything in normal words, answers anything about my plan/topics/tests/training/ACT, and can change ANY of my data or settings (topics, colours, tests, rules, programmes, plan, routines, training, priorities, events) – short preview + my ✅ before saving. Flexible and creative.
- C. Ideas inbox: anything it can't do yet → one-line reply + saved to app ideas with my exact words and what's needed. "/ideas" sends one ready-to-paste block for Claude Code. Add plans/ideas-inbox.md explaining the routine.

QUEUE (in this order)

1. STUDY TRACKER from assets/Nat-Study-Tracker-FINAL.xlsx (read all 6 tabs; "Start here" is the rulebook). Replaces the old "RAG sheet import" and "test revision assignments" ideas.
 - Import Maths+FM (60) + Physics (32) topics: code, subject, strand, teacher, half-term, taught-from date, colour, pipeline step, Bicen section, Integral link, latest fresh-Q %, last done, notes, tests. Keep existing colours/mistakes, archive duplicates, log clashes.
 - Status: Taught / Next up (≤21 days) / Later. Getting ahead follows the school order only, maths only (physics = keep up + review).
 - Colours: 🔴 <65% fresh Qs, 🟡 65–84%, 🟢 ≥85% no notes. Reviews: +1 day 🔴, +3 🟡, +14 🟢, +7 ⚪.
 - Maths resource ladder (auto-picked): textbook → mixed exercise + red/blue Qs → Bicen section → Integral topic assessment (≥85% = 🟢) → stretch only on 🟢: Bicen hardest → MadAs → STEP. Further Stats/Mech: Integral Further instead of Bicen. Physics ladder: school booklet → PMT CAIE topic Qs → "concepts I don't get" list → retrieval reviews.
 - Tests & papers: name, date, info, topic codes, attempts (date, what, score, out of, %), mistakes (question, code, what went wrong, type, rule, redo date, redone). Import FM HT2 12 Nov, FM HT1 + Consolidation due 2 Nov (30–60 min/day), Physics mechanics 10 Nov, Physics waves 12 Nov.
 - Mistake types: Knowledge, Method, Algebra, Misread, Calculator, Time, Careless. Redo +3 days then ~1 week.
 - Programmes: ordered series + weekly target + optional end date, pause/change/stop by chat, no code needed for new ones. STEP = 28-item programme, 1 a week at the weekend.
 - Priority STRICT: homework → tests/consolidation (≤3 weeks, incl. ACT) → due reviews → 🔴 taught → getting ahead → stretch. Leftover time: half-term 55% ahead / 25% fixing / 20% old; school week 40% current / 30% old / 30% ahead.
 - Test mode: diagnostic first (1–2 fresh Qs per topic) → time goes to 🔴/🟡; teacher booklet first; timed practice 3–4 days before; light day before.
 - Ahead session 90 min: 10 prerequisite, 25 textbook, 25 textbook Qs, 20 exam Qs, 10 mark + colour. Move on at 🟡.
 - Classroom: detect test assignments, read the description with the AI (date, topics, limits like "no momentum", length), ask me once "Test on <date> – plan revision? ✅". "Consolidation… X min/day" = daily slot.
 - Temporary rules by chat with end dates ("ACT top priority this week", "pause getting ahead until 25 Oct", "maths + physics 45 min/day this week"), shown on Your week card, auto-expire.
 - Telegram understands e.g. "matrices 🟢", "did Bicen matrices set 8/10", "finished textbook exercise on logs", "mistake: PC1-03 Q3b assumed through origin – knowledge", "HT2 practice 38/45". Shortcuts too: /maths /physics /tests /review /rules /programmes /ideas.
 - Subjects page: Maths/FM/Physics → strand, colour chips, teacher filter, tests with days left. "Export my tracker" → CSV for my Google Sheet backup.

2. ACT UPGRADE (extend the existing ACT system, keep its data). My last real test: 34 composite (E34 M34 R35 S35); goal 36. Enhanced ACT format.
 - Books as programmes: Complete Guide to ACT English (Meltzer) – chapter by chapter, exercises, log misses to grammar rules; Complete Guide to ACT Reading 3rd ed – method chapters then timed passages (~8–9 min); College Panda ACT Math + workbook – chapter TEST first, only do chapters where I drop marks; Advanced ACT Math – hard last-15 questions once gaps are closed; The Critical Reader 5th ed – optional, only if reading stalls.
 - Daily 10 min grammar flashcards (I have an Anki deck).
 - Steady mode (no date): half-term ~75 min/day rotating English / Reading / Maths, 1 full timed test a week + review next day; school weeks 30 min × 3.
 - Countdown mode when I say "ACT retake is <date>": daily timed English section + review every miss against its rule; alternate timed Reading / Maths sections; one full timed mock mid-week; day before light (rules + misses list + sleep). Ask me for the date if I mention a test without one.
 - "ACT practice: E33 M35 R34" logs scores and adjusts focus to the weakest section.

3. TELEGRAM SPEED + FEEL: measure current reply times first, then make it fast – instant "typing…", quick model for classifying, full model only when needed, parallel DB calls, caching, fewer round trips. Target simple replies < ~3 s. Short, friendly, clear replies; consistent buttons (✅ / ✏️ / ❌). Log before/after times in the PR.

4. EVENTS + LIFE BY CHAT: "out with friends tomorrow 2–9pm", "family dinner Sat 7", "football Wed 7:45" → Life OS calendar event + planner works around it (preview + ✅). Same for cancelling/moving.

5. TODAY SCREEN + MORNING MESSAGE: one clean Today view (web + 7:30 Telegram message, holiday wake time respected) – max 3–5 items with time, exact resource and one-tap done; everything else hidden. Evening message: tick what got done, roll the rest forward automatically. Polish the whole app's look: calm, clean, consistent spacing/type, great on phone.

6. TRAINING + GYM PROGRESS (respect existing rules: Owen's days fixed, his sessions vary; upper 2×/week heavy ~90 min Mon PureGym + Sat; Mon/Wed club football, Tue school football then Owen, Sunday games; light lower ok day before a game, no heavy lower/plyo).
 - Log lifts by chat ("bench 80x5x3", "squat 100 5x5") or Hevy CSV import. Estimated 1RM (Epley), PR alerts, weekly volume per muscle group (keep upper balanced for physique), simple progressive-overload suggestion for next session, progress charts.
 - "/owen" writes a ready-to-send message to Owen with my week's training days and free slots.
 - One message per exercise max – no extra logging.

7. WEEKLY CHECK (Sunday, one message): done vs planned per subject, ACT trend, gym PRs, what's behind, one suggestion, then offers "plan next week?" ✅. No dashboards to maintain.

8. HOW TO USE: docs/HOW-TO-USE.md + /help in Telegram + a Help page in the app: one screen – daily routine, the 15 most useful messages, how ✅ works, ideas inbox, how to update the Google Sheet backup. Plain English, short.

TESTING – NOTHING IS DONE UNTIL ALL OF THIS PASSES
- Unit tests for every rule above (priority order, colours, review dates, test mode, ahead session, programmes, rules expiry, ACT modes, training spacing, 1RM maths).
- A simulated half-term week and a simulated school week with realistic data: check the plans follow every rule (homework first, ACT countdown, Owen's days, upper 2×, no heavy lower before games, 3–5 items/day, events respected).
- At least 50 simulated Telegram conversations (normal words, typos, vague requests, changes, cancels, things it can't do → ideas inbox) with expected outcomes.
- Playwright screenshots of every page at phone + desktop width; fix anything ugly or broken.
- Full existing test suite green. Fix everything the reviewers find.

At the end write plans/morning-summary.md: what's done, which PRs to merge in what order, which SQL files to run in Supabase, Vercel steps, anything that needs me, and a 5-line "start your day" guide.
