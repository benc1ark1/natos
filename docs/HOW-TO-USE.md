# How to use Nat OS

<!-- Generated from lib/help.ts by scripts/help-doc.mjs. Edit lib/help.ts, then run the script. -->

Talk normally, typos and all. Every change comes back as a card: nothing is saved until you tap ✅.

## Your day

_The default times: yours are in Settings (the Help page in the app shows yours)._

- ☀️ **07:30**: Today: up to 5 things, each with what to open. Tap each when done. On holidays: 09:00.
- 🔔 **18:00**: A “don’t forget” nudge (not on your check-in day: the weekly check replaces it).
- 🌙 **21:00**: Tap what you did. The rest moves to tomorrow by itself.
- 🗓 **Sunday 18:00**: The weekly check, then **Plan next week? ✅** for the Your week card.
- 😴 **21:30**: No plan messages until the morning (reminders and leave alerts still come).

## The 15 most useful messages

| Send | What happens |
|---|---|
| `what next?` | exactly what to open now |
| `matrices 🟢` | sets a topic’s colour and its next review |
| `did Bicen matrices set 8/10` | logs it, colours it, moves you on |
| `finished textbook exercise on logs` | ticks that step, picks the next resource |
| `mistake: PC1-03 Q3b assumed through origin – knowledge` | saves the mistake with a redo date |
| `HT2 practice 38/45` | a test score |
| `pause getting ahead until 25 Oct` | a temporary rule that ends by itself |
| `physics homework due Fri` | a task with its due date |
| `bench 80x5x3` | 80 kg × 5 reps × 3 sets (PRs spotted) |
| `ACT practice: E33 M35 R34` | ACT scores; focus moves to the weakest |
| `out with friends tomorrow 2–9pm` | an event; the plan works around it |
| `move football to Thu 8` | moves one of your events |
| `plan my week` | the Your week card |
| `how was my week?` | the weekly check, any day |
| `export my tracker` | your tracker as a CSV file |

## How ✅ works

**✅** saves · **✏️** type the fix · **❌** drops it · **↩️ Undo** puts it back. Nothing is ever deleted.
Ticking a Today item needs no card: the tap is the ✅ (tap again to untick).

## 💡 Ideas inbox

Can’t do it yet? You get “I can’t do that yet — it needs adding in Claude Code.” and your words go to `/ideas`: paste that block into Claude Code, then `/ideas done 2` · `/ideas drop 2` · `/ideas undo`.

## 📤 Google Sheet backup

1. On a computer (the Sheets phone app has no Import), open **Subjects** → **Export my tracker** in the app.
2. Tap **Download** next to a tab (or **Download all**).
3. In your Google Sheet open the same tab. Select **A4** down to the bottom of the tab and press **Delete**, then click **A4**.
4. **File → Import → Upload** that CSV → **Replace data at selected cell** → **Import data**.
5. **Programmes**: the first time, add a new tab for it (or skip it).

Sending `export my tracker` in Telegram gives you every tab in one file: a copy to keep.

## All commands

**Today**: `/today` your few things (`/today all`: everything) · `/brief` this morning’s message (`/brief full`: the whole day) · `/week` the next 7 days · `/coming` deadlines, tests and events soon · `/free` free time (`/free tomorrow`) · `/inbox` your Inbox · `/postponed` tasks you keep putting off · `/next` a project’s next steps (`/next <project>`) · `/add` add something (`/add PE kit Friday`) · `/pin` refresh the pinned Today

**Study**: `/maths` Maths + FM topics · `/physics` Physics topics · `/tests` tests: days left, scores, mistakes · `/review` reviews due today · `/rules` temporary study rules · `/programmes` programmes (STEP…): next item · `/act` ACT: mode, scores, next chapters

**Training**: `/gym` this week’s lifts, PRs, next sessions · `/lifts` same as /gym · `/owen` a message for Owen: your days and free slots

**Week**: `/weekly` how your week went

**Links**: `/app` open the app inside Telegram · `/dashboard` same as /app · `/google` Google Calendar status · `/sync` sync Google Calendar now · `/whoop` Whoop recovery · `/mail` the email watcher

**Bot**: `/ask` a question only, never a change (`/ask when am I free?`) · `/ideas` things it can’t do yet · `/usage` AI spend · `/cap` the daily AI limit (`/cap 2` = $2) · `/speed` reply times · `/cancel` drop the open card · `/help` this guide (`/help all`: every command) · `/start` same as /help

_The same guide is in the app: More → Help. The long guide: [GUIDE.md](GUIDE.md)._
