# Telegram speed: before and after (queue item 3)

Measured with `tests/speed-timing-chat.test.mjs` (run: `node --experimental-strip-types --no-warnings --import
./tests/support/register.mjs --test --test-concurrency=1 tests/speed-timing-chat.test.mjs`; `SPEED_BEFORE=1` only
measures, `SPEED_OUT=<file>` writes the table, `SPEED_TRACE=1` prints every call). It runs the **real bot code** with
the local test database, the fake Telegram and the fake AI; only the network is simulated, and every call takes **at
least** its assumed time:

| What | Assumed time per call |
|---|---|
| Supabase (Vercel → Supabase, PostgREST or auth) | 40 ms |
| Telegram Bot API | 100 ms |
| Haiku (4.5 sorter, 5.5 router: small prompt, little or no thinking) | 0.8 s |
| Sonnet 5.5 (the brain: big prompt, effort medium) | 4 s |
| Opus 5.5 (planning) | 8 s |

A warm instance (the owner session already open; a cold start adds three auth calls once). Times are from the moment
the webhook hands the message over. "DB waves" = sequential rounds of database calls (calls that overlap count once);
"waited for" = the waves before the first reply that Nat actually waits for (not hidden behind an AI call).

## Before → after (first reply)

| Message | First “typing…” | First reply | Path after | AI calls before → after |
|---|---|---|---|---|
| “thanks” | 0.40 s → **0.10 s** | 5.05 s → **1.07 s** | quick | Sonnet → Haiku 5.5 router |
| /today | — → **0.10 s** | 0.43 s → **0.34 s** | list | none |
| “what’s in my inbox” | — → **0.11 s** | 0.44 s → **0.34 s** | list | none |
| “what’s due this week?” | 0.34 s → **0.10 s** | 5.05 s → **1.06 s** | quick (exact list) | Sonnet → Haiku 5.5 router |
| “maths homework due Fri” (new item) | 0.39 s → **0.10 s** | 6.11 s → **2.04 s** | quick → sorter card | Sonnet + Haiku 4.5 → Haiku 5.5 + Haiku 4.5 |
| “move physics homework to tomorrow” | 0.34 s → **0.10 s** | 5.31 s → **4.77 s** | brain | Sonnet (unchanged) |
| tap ✅ Apply | — → **0.11 s** | 0.65 s → **0.39 s** | tap | none |
| plug-in fast path | — → **0.10 s** | 0.39 s → **0.25 s** | fast | none |

Targets: simple replies < ~3 s ✔ (all under 2.1 s); first “typing…” < 0.3 s ✔ (0.10–0.11 s, every message).
Messages that need the full brain are bound by Sonnet's ~4 s; the overhead around it went from ~1.3 s to ~0.8 s.

### Before (full table)

| Message | Path | First “typing…” | First reply | Total | DB calls | DB waves (waited for) | AI calls (≈ prompt tokens) |
|---|---|---|---|---|---|---|---|
| “thanks” | — | 0.40 s | 5.05 s | 5.29 s | 73 | 15 (10) | sonnet 5.5 (12,357) |
| /today | — | — | 0.43 s | 0.66 s | 30 | 12 (7) | none |
| “what’s in my inbox” | — | — | 0.44 s | 0.67 s | 30 | 12 (7) | none |
| “what’s due this week?” | — | 0.34 s | 5.05 s | 5.28 s | 72 | 15 (10) | sonnet 5.5 (12,361) |
| “maths homework due Fri” | — | 0.39 s | 6.11 s | 6.39 s | 93 | 21 (15) | sonnet 5.5 (12,361) + haiku 4.5 (1,700) |
| “move physics homework to tomorrow” | — | 0.34 s | 5.31 s | 5.59 s | 94 | 20 (14) | sonnet 5.5 (12,364) |
| tap ✅ Apply | tap | — | 0.65 s | 1.16 s | 28 | 13 (8) | none |
| plug-in fast path | — | — | 0.39 s | 0.62 s | 14 | 11 (6) | none |

### After (full table)

| Message | Path | First “typing…” | First reply | Total | DB calls | DB waves (waited for) | AI calls (≈ prompt tokens) |
|---|---|---|---|---|---|---|---|
| “thanks” | quick | 0.10 s | 1.07 s | 1.21 s | 73 | 9 (5) | haiku 5.5 (1,051) |
| /today | list | 0.10 s | 0.34 s | 0.48 s | 30 | 7 (5) | none |
| “what’s in my inbox” | list | 0.11 s | 0.34 s | 0.48 s | 30 | 7 (5) | none |
| “what’s due this week?” | quick | 0.10 s | 1.06 s | 1.20 s | 72 | 10 (5) | haiku 5.5 (1,055) |
| “maths homework due Fri” | quick | 0.10 s | 2.04 s | 2.18 s | 93 | 13 (8) | haiku 5.5 (1,055) + haiku 4.5 (1,700) |
| “move physics homework to tomorrow” | brain | 0.10 s | 4.77 s | 4.91 s | 94 | 13 (10) | sonnet 5.5 (12,529) |
| tap ✅ Apply | tap | 0.11 s | 0.39 s | 0.84 s | 28 | 11 (6) | none |
| plug-in fast path | fast | 0.10 s | 0.25 s | 0.39 s | 14 | 5 (3) | none |

(The quick-path messages still read the brain's context in the background while the router runs — that's why their
DB call count stays high — so a message the router hands on to the brain doesn't wait for it.)

## What changed

- **“typing…” first** (`lib/telegram/bot.ts`, `api.ts keepTyping`): sent before the session, the queue or anything
  else, and refreshed every 4 s while the bot works (never right after a reply). Taps that do work (✅, Save, Undo,
  ✍️ draft, slot options) get it too; taps that redraw in place don't.
- **Cheapest first** (`converse.ts`): exact lists (no AI) → plain-code answers and plug-in fast paths (no AI) → the
  **quick router** → the full brain. The plug-in hooks (`runFast`, `pluginCommand`, `pluginPrompt`, `pluginFor`,
  `pluginTap`, `pluginAfterApply`, `pluginSnapshots`, `runPluginTicks`) all work as before.
- **The quick router** (`brain.ts triage()` + `route()`): plain code first decides if a message *could* be simple
  (short, no card waiting, no change/time/advice/training/score words); only those go to **Claude Haiku 5.5**
  (`claude-haiku-5-5`, thinking off, effort low, a ~700-token cached prompt, the last 4 messages, no snapshot) which
  picks: chat (a short reply), one exact list (today, week, coming, inbox, free on a day, postponed, load, gaps, savings,
  maths), an obvious new item (→ the usual sorter card), or brain. Plain code double-checks its answer (anything
  pointing back at the conversation, a question, a change or an event → brain). If the router isn't sure, errors, is
  slow (6 s timeout, no retries) or refuses, the brain reads the message exactly as before: no capability lost.
- **The brain's context is read early** (the ~30-read snapshot, the day, the optimiser's week) alongside the router,
  and reused for the next message in the same run (messages sent back to back) unless anything may have changed:
  forgotten after any tap, command, gap answer, plug-in "handled" path or non-read-only outcome, after 30 s, at the end
  of the run, and whenever a card was saved or undone anywhere since it was read (checked with the next message's
  first reads, no extra wait).
- **Fewer round trips in the queue** (`bot.ts`, `turns.ts`): enqueue + lock together; "working" alongside the turn's
  first reads; "done" + lock renewal + the next message in one round. Memory rows, a card's message number, the AI
  meter, answering a tap and clearing old buttons are **background writes** (`lib/telegram/speed.ts soon()`): in order,
  never thrown, and always finished before the next message is read and before the run ends.
- **Cards** (`cards.ts`): the week's knock-on world is read once per message (and started while Sonnet thinks when a
  change is likely); the tap's spinner stops without waiting.
- **CPU**: `lib/time.ts` keeps one `Intl.DateTimeFormat` per timezone and remembers `addDays` answers (the week
  optimiser calls them thousands of times): the optimiser's week for the brain went from ~80 ms to ~40 ms of CPU.
- **Reply times in production**: every message logs `path`, `ms_total` (arrival → done) and `ms_first` (arrival → first
  reply) on `telegram_turns` once **`supabase/speed.sql`** has run (the bot works without it). **`/speed`** shows the
  last 20 with the typical first reply per path.
- **Buttons everywhere**: ✅ (Save / Apply) · ✏️ Change · ❌ Cancel (✖ → ❌ on every card; the capture card's
  “✏️ Edit” is “✏️ Change”, with 📥 Inbox instead on its own row). Callback data is unchanged, so old messages still work.
- **Ideas inbox**: see `plans/ideas-inbox.md` (one-line reply, his exact words + what's needed, `/ideas` as one block,
  `/ideas done|drop <n>`).

## Model choices (checked with the claude-api skill, 19 Oct 2026)

- Router: **`claude-haiku-5-5`** — $0.10 / $0.50 per million tokens (prompts ≤ 100K; $0.50 / $2.50 above, now in
  `PRICES` as a second rate card), cache reads 0.1×. Adaptive thinking is on by default on Haiku 5.5, so the router sends
  `thinking: {type: "disabled"}` (allowed at effort ≤ high) with `effort: "low"`. No `fallbacks` parameter (Haiku 5.5
  has no server-side fallback); a refusal just hands the message to the brain. Its cost is on the meter as `chat`.
- Unchanged: brain `claude-sonnet-5-5` (effort medium), planner `claude-opus-5-5`, sorter `claude-haiku-4-5`. Moving
  the sorter to Haiku 5.5 would be ~10× cheaper but needs `lib/capture/sort.ts` to turn thinking off (not this item's
  file) and every chat test scripts the sorter by its model name; left for a follow-up.

## Tests

- `tests/speed-timing-chat.test.mjs`: the table above; fails if typing > 0.3 s, a simple reply > 3 s, a brain reply
  > 5.5 s, a tap > 1.5 s, if a message uses different AI models than expected, or if Nat waits for more DB waves than
  today + 1 (always fewer than before this build).
- `tests/speed-route-unit.test.mjs`: which messages may take the quick path, the checks on the router's answer, the
  router's prompt, Haiku 5.5's prices, the /ideas block, background writes and the turn clock.
- `tests/speed-quick-chat.test.mjs`: the quick paths end to end, router not sure / down, cards never routed, typing
  first, /speed, the context reuse (and re-read after a saved card), the unified buttons, plug-in refs.
- `tests/speed-ideas-chat.test.mjs`: the ideas inbox (can't-do, /ideas block, Undo / done / drop, vague, typos,
  can't-map instruction, plug-in idea).

## For the other parts (plug-ins and their tests)

- **Plug-in API** (`lib/telegram/plugin-types.ts`, both optional): `{ kind: 'actions', refs: [['E1', ref], …] }` lets a
  fast path use built-in ops that need a ref (`event_move`, `event_cancel`, …) without the brain's snapshot;
  `{ kind: 'handled', intent: 'instruction' }` logs what a self-handled message was (default `'question'`, as before).
- **Chat tests**: `tests/support/chat.mjs` exports `ROUTE = 'claude-haiku-5-5'`. Unscripted, the router answers 529 and
  the brain reads the message exactly as before, so existing conversations need no changes, and those fallback calls
  are left out of `chat.ai.requests` (`byModel(ROUTE)` still shows them). To test a quick path, script
  `chat.ai.script(ROUTE, routed({ route: 'chat' | 'list' | 'new' | 'brain', … }))` (`routed` is in
  `tests/support/fakes.mjs`).
- **Buttons**: `❌ Cancel` (was `✖ Cancel`), the capture card's `✏️ Change` (was `✏️ Edit`) and `📥 Inbox instead`.
  `button(m, 'Cancel')` still finds them; exact-label assertions need the new text.
- **Replies**: the can't-do reply is one line: `I can’t do that yet — it needs adding in Claude Code. 💡 Saved to your
  App ideas (/ideas).` The brain's schema has `needs` (scripted `brain()` replies may leave it out).
- The chat model's `ai_usage` row is written in the background, so its order against other rows can differ.
- Changed old tests (each expected the old wording, or was fragile): `jarvis-chat` (tap `Change`, not `Edit`),
  `multi-part-chat` (`❌ Cancel`), `jarvis-g-chat` (one-line can't-do reply, the `/ideas` block), `jarvis-d1-chat`
  (usage rows in any order), `build-h-chat` (the second change takes its event ref from the snapshot sent with that
  message: after a rename and Undo the events can come back in another order, which made it flaky).
- `/speed` is a new command; `HELP` in `lib/telegram/bot.ts` (owned by item 8) doesn't list it yet.
