# Visual QA at phone width (390 px): 11 Oct 2026

How: Playwright + Chrome at 390 × 844 (2× pixels, touch, mobile), against the **test** database with a separate
QA account filled with sample data (a project, reminders, guides, a pipeline with topics, a mistake due, 7 days of
Whoop data, goals). The same pages were then checked again with an **empty** account. Each page was checked by eye and
by a script: no sideways scroll (`scrollWidth` = 390) and nothing past the screen edge. The app has one (dark) theme,
so there's no separate light/dark pass.

## Pages checked

| Page | Screenshot | Result |
|---|---|---|
| Home | `home.png`, `empty-home.png` | fixed (top bar, tab bar, Upcoming) |
| Tasks: list / board / by date | `tasks.png`, `state-board.png`, `state-bydate.png`, `empty-tasks.png` | fixed (row controls, board columns) |
| Inbox | `inbox.png`, `empty-inbox.png` | fixed (Today/Week/Later buttons) |
| Projects | `projects.png`, `empty-projects.png` | clean |
| Subjects + one subject (pipeline, topics, mistakes, resources) | `subjects.png`, `subject.png`, `empty-subjects.png` | clean |
| Routine | `routine.png` | clean |
| Guides, a guide, guide edit, Notion import | `guides.png`, `guide.png`, `state-guide-edit.png`, `guides-import.png`, `empty-guides.png` | fixed (edit form) |
| Archive | `archive.png`, `empty-archive.png` | fixed (double empty message) |
| Settings (incl. the new Training load section) | `settings.png`, `settings-load.png` | fixed (About you box, email rule dropdown) |
| Sign in | `login.png` | fixed (band at the top) |
| Mini App entry `/tg` (opened outside Telegram) | `tg-signedout.png` | fixed (showed the full app menu) |
| Forms and sheets: new/edit task, event, reminder, goal, test, weekly target, capture details | `state-form-*.png`, `state-task-edit.png`, `state-capture-details.png`, `state-week-open.png` | clean |
| Error states: capture and Ask AI with no AI key | `state-capture-error.png`, `state-ask-error.png` | clean (clear message, Try again; capture still saved to Inbox) |
| Old or mistyped links (`/subjects/abc`, `/guides/abc`, `/routines/abc`) | – | fixed (showed a raw database error) |

Console errors: none from the app. The only one is `/tg` failing to load Telegram's script in a normal browser,
and the page handles that with its "open it from the bot" message. The signed Telegram launch itself can't be
driven from a normal browser: its security is covered by the existing guard tests.

## Fixes

| What was wrong | Fix | File |
|---|---|---|
| Every signed-in page scrolled sideways (414–451 px): the top bar ("Export my data" + "Sign out") and the 7-tab bar were wider than the phone | Tab columns can shrink (`minmax(0, 1fr)`, no letter spacing); on phones the top bar says "Export", in a smaller font | `app/globals.css`, `components/ExportButton.tsx` |
| Home → Upcoming: a homework "Due" row was drawn on top of the date column | Two rules shared `.hl` (the calendar's absolutely positioned hour labels); the calendar rule is now scoped to `.gut .hl` | `app/globals.css` |
| Tasks/Inbox rows: star, column dropdown and Today/Week/Later/Someday pushed off the left edge (an empty tag cell took their slot) | On phones the actions sit on their own line under the title; the tag cell has a class so it hides | `components/TaskRow.tsx`, `app/globals.css` |
| Board on a phone: 240 px columns, titles one word per line | Columns are 80% of the screen with snap scrolling | `app/globals.css` |
| Toasts squeezed to half the screen | `width: max-content` (capped at screen − 32 px) | `app/globals.css` |
| Guide edit: "Weekly log" label squeezed one word per line | Area dropdown and switch wrap onto separate lines | `app/globals.css` |
| Archive with nothing done: two empty messages | One message; "Nothing done yet this week" only when older weeks exist | `components/ArchiveView.tsx` |
| Settings → About you: 3-line box cut the text mid-line | 5 lines | `components/SettingsView.tsx` |
| Settings → Email watcher: the browser's own white dropdown | The app's dropdown | `components/MailSettings.tsx` |
| Sign in: dark band across the top | The top gap is padding, not a margin (it leaked through `body`) | `app/globals.css` |
| `/tg` outside Telegram showed the app menu, Export and Sign out | Bare sign-in layout, like `/login` | `components/Shell.tsx` |
| A bad link showed "invalid input syntax for type uuid" plus a useless Try again | "That subject/guide/routine doesn't exist" with a link back | `app/{subjects,routines,guides}/[id]/page.tsx` |

## Bot messages (how they read on a phone)

Real messages built by the bot's code from sample data, drawn as Telegram bubbles at 390 px: `bot-messages.png`.
All six suggestions were applied:

| What read badly | Fix | File |
|---|---|---|
| /week wrapped times mid-range ("18:00–" / "19:30") because a day's events were joined on one line | One thing per line under each day | `lib/telegram/views.ts` |
| The brief showed two italic bits per task (`~45 min (nice)`) | One: `(~45 min · nice)` | `lib/telegram/brief.ts` |
| The brief said "You forgot this" at 07:00 for things only due today | "Don't forget" | `lib/telegram/brief.ts` |
| /today said "Nothing else booked" when nothing was booked at all | "Nothing booked" | `lib/telegram/views.ts` |
| /coming started lines with lower-case "tomorrow" | Capitalised | `lib/telegram/views.ts` |
| /today's Free line ran to 3 lines | "School night: …" on its own italic line | `lib/telegram/views.ts` |
| /help was a wall of text | One screen, by time of day (the short version of `docs/GUIDE.md`); the commands are now in Telegram's "/" menu | `lib/telegram/bot.ts` |
| The new 🏋️ Training plan card | A date-free line per session, then a dim "↳ why" line, then the load view (🟢/🟡/🔴 one line a day); 🔁 buttons two per row | `lib/telegram/trainplan.ts` |

## Left as it is

- Home card numbers skip and mix ("01, 03, S, W, 04…") because cards only show when they have data. Cosmetic.
- The "N" badge in some screenshots belongs to the dev server; it isn't in the real app.
