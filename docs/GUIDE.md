# Nat OS: your day, and everything you can say

Two places, one set of data:
- **Telegram bot.** Talk to it normally. Anything that changes your data comes back as a **card**, and nothing changes until you tap **✅**. Every saved change has **↩️ Undo**. Archiving never deletes anything. You can describe several things in one message ("training Monday 8 get there to 10 at Christchurch Finchley College, Uber back; Wednesday same club 7:45 be there…"): they all go on one card, and anything unclear is a quick-tap question on that card (✋ Skip leaves that part out).
- **Dashboard.** On your phone's home screen, or **Dashboard** at the bottom of the bot chat: Home (with **Insights**), Tasks, Projects, Subjects, Inbox, Archive, Settings.

The bot can do anything the dashboard can (except connecting Google/Whoop, the Notion import and Export, which need the browser). If it can't do something yet, it says *"I can't do that yet — it needs adding in Claude Code"* and saves your request to **/ideas**.

---

## Your day

### ☀️ Morning (07:00)
- **The brief** is your day in time order: **☀️ morning routine → 🏫 school → 📚 study → 🏋️ training (where, and when to leave) → 🌙 night routine**, with each day's **🧠 mental** and **💪 physical** load (🟢 low · 🟡 medium · 🔴 high).
- **Tick things off** with the buttons under the brief or the **📌 pinned Today** at the top of the chat. Ticking a training session also counts it toward its weekly target. Tap again to untick.
- If the day is **overloaded** (🧠 high and 💪 high, or over your day limit), one line says so and offers to move the easiest thing to tomorrow (one tap).
- **Low Whoop recovery?** The brief says so, and a short card offers to move today's hard session or make it light.

### 📥 During the day
Send anything; it becomes a card (✅ Save / 📥 Inbox / ✏️ Edit / ✖ Cancel):

| You send | You get |
|---|---|
| `physics homework due Friday` | A task (subject, due date, column guessed) |
| `did upper` · `did football today` | A log toward that weekly target |
| `remind me PE kit Friday` | A reminder |
| `finished the Bicen video on matrices` | Study progress |
| `Q5 wrong on moments: forgot the sign` | A mistake to review |

New Classroom homework arrives by itself; if this week is planned, the bot offers it a slot before it's due.

### 🌙 Night (21:00)
One message: **what's done**, and what isn't **moved to tomorrow's free time** with one **✅ Move to tomorrow** (or ✖ Leave them). Nothing new comes after 21:30 until the next brief.

### 🗓 Sunday reset (18:00)
One **"Your week"** card:
1. **Last week** in 2–3 lines (sessions done, sleep, recovery, what slipped) and the **top 1–2 time savings**.
2. **Each day** in order: school, your events, study blocks and homework (picked by the planner AI), every training session with **its place and leave-by time**, and 🧠/💪 per day.
3. **Upper 2× or 3×** and why, and **how it compares with Owen's current days**.
4. **✅ Apply** saves the whole week (Home, the pinned Today, your Life OS calendar). **🔁** under a session moves it and the rest re-fits; or just say it: `upper Sat at PureGym`, `lower light on Fri`, `upper 3x this week`.
You can ask for it any time: `plan my week`.

### ❓ The questions (filling the gaps)
The planner tells you what it doesn't know yet, **one question at a time**, with quick-tap answers (or type it: `6:50`, `45 min`, `Sat, leave 9:30`). At most 5 a day, never at night or in school. Until you answer, plans use a sensible guess marked **(guess)**. Every answer is a normal setting you can change later, and the week **re-plans after each one**.
- `what do you still need to know?` lists the rest (and what it's guessing).
- `ask me now` goes through them; `stop asking questions` pauses them.

### 🗓 Owen's days
`which days should I give Owen?` plans a **typical week** (school, the sessions that come every week, your usual game day) and picks the best days for **speed, heavy lower, injury prevention and core**. You get the reasons, a comparison with Owen's current days (the ones you saved, else his own suggestion), and a **message to copy** for Owen. If you answer questions or clean up your calendar while the card is waiting and the best days change, you get a fresh card: use the newest. **✅ Use these days** saves them: the planner keeps his sessions there. If your weekly pattern changes later, the bot re-checks and tells you if you should update him.

### ⏱ Time savings
`where can I save time?` (or **Insights** on Home) shows this week's suggestions, each with **the time it saves and the trade-off**, e.g. *"Upper is 75 min. A 50 min version keeps ~90% of the benefit and saves 50 min a week"*, *"Train at the school gym on Thu instead of PureGym: saves 35 min of travel"*, *"Stack core onto injury prevention"*, *"Test-heavy week, so upper 2×"*. **✅ Apply** changes your set-up (↩️ Undo); **✋ Not now** hides it for the week. Insights also shows **where your week goes**: school, study, training, travel, routines, free.

---

## How the optimiser decides
Everything below is a setting or your data (Settings, or tell the bot); nothing is a hard block, it's all weighed.

- **Your set-up.** Places (Home, School gym, PureGym Swiss Cottage, Owen) with their **equipment** and **travel** (from school, from home, back home). Sessions you need each week: **speed + circuits** (Owen), **heavy lower**, **injury prevention**, **core**, **stretching** units (2+), **upper** 2–3×. Each lists the kit it needs and where it can go (first = preferred).
- **It searches** every day × time × place × intensity for every session (and upper 2× vs 3×), and scores each week:
  - recovery per body area: **≥48 h between heavy lower**, **heavy lower and speed not back to back**, **upper 48 h apart**, high-CNS days spread;
  - **the days around the game** (game day is max load; light work the day before is fine, heavy isn't);
  - the day's and any 7 days' total load;
  - **🧠 mental load**: no hard training on high days or the eve of a test (tests, mocks, tutors, study and deadlines add up);
  - **travel time and equipment fit** (PureGym is best straight after school; the school gym is fine for chest, cables and free weights);
  - **Friday**: only light earlier, the evening free;
  - **sleep and routines**: nothing in your morning/night routines; earlier nights before tests and games;
  - **Whoop**: low recovery means light;
  - your **training rules**, weighed.
- **Upper 3×** only when it fits without hurting heavy lower and speed. One weekend upper gets a small bonus.
- Each session says **why** it's there; ask `why is lower on Thursday?` and it tells you what other days would have cost.

---

## Everything you can say

**Questions** (answered from your data, never invented)
- `what's today?` · `what's next?` · `when am I free Thursday?` · `what homework is due?` · `what's coming up?`
- `how's my load this week?` · `where should I train today?` · `should I do upper 2x or 3x?` · `why is lower on Thursday?`
- `did Sam email?` · `what do you still need to know?` · `where can I save time?` · `which days should I give Owen?`

**Your calendar** (your own sessions change here; Google ones change in Google)
- `dentist Tuesday 3pm` · `football training every Mon and Wed 6–7:30` · `rename CS tutor to Computing tutor`
- `cancel football Wednesday` · `football is Thursday this week` · `football moved to Tue 7pm` (for good)
- `EFA training is over` (a Google session: the app ignores it) · `bring back EFA training`
- `the timetable calendar is school` · `stop reading the Family calendar`

**Your week and plans**
- `plan my week` · `plan my day` · `plan my evening` · `I've got 2 hours` · `I'm ill, lighten today` · `I'm wrecked`
- `move study to 5pm` · `physics homework to Thursday` · `skip gym today`
- `game is Saturday this week, leave 9` · `no game this week` · `do upper 3x this week`

**Your set-up**
- Places: `PureGym is 25 min by bus from home` · `home has a kettlebell now` · `add the climbing wall, 20 min away`
- Sessions: `upper takes 50 min` · `upper 2-3 times a week` · `upper at PureGym or the school gym` · `stack core onto injury prevention`
- Owen: `Owen's days are Tue and Thu` · `let the planner pick Owen's days`
- Your day: `I wake at 6:30` · `bed at 10:15` · `my morning routine takes 20 min` · `Friday evening free from 7pm` · `games are usually Saturday now` · `football is Tue and Thu now` · `school ends 15:30 on Wednesdays`
- Study and travel: `I focus best in the evening` · `study blocks 45 min max` · `I'll travel 30 min max to train`
- Load: `games are max load` · `Wednesday training is high CNS` · `the SMC mock is max mental` · `light lower is ok the day before a game` · `most load in a day is 25` · `travel matters more` (optimiser weights are settings too)

**Everything else**
- Tasks: `done with the SMC paper` · `drop the guitar idea` · `bring back the guitar idea` · `star it` · `45 min`
- Study: `my physics pipeline is video, notes, exam questions` · `add vectors and moments to physics`
- Targets and subjects: `swimming twice a week as a target` · `coach set 3 lower this week` · `add ACT as a subject`
- Guides: `add magnesium before bed to my sleep guide` · `archive the fragrance guide`
- Email: `always flag emails from @ucs.org.uk` · `ignore Hudl`
- Settings: anything in Settings by name: `brief at 7:30`, `nothing after 10pm`, `ask me 3 questions a day`

---

## 📋 Commands

| Command | What it does |
|---|---|
| `/today` · `/week` · `/coming` · `/free tomorrow` · `/inbox` · `/postponed` · `/next <project>` | Instant lists (free, work over the AI limit) |
| `/add <anything>` | Always a card |
| `/ask <question>` | Always a question |
| `/brief` · `/pin` | Today's brief again · refresh the pinned Today |
| `/app` | The dashboard inside Telegram |
| `/google` · `/sync` · `/whoop` · `/mail` | Connections and their status |
| `/ideas` · `/usage` · `/cap 2` | App ideas · AI spend · the daily AI limit |
| `/cancel` · `/help` | Drop the waiting card · the short guide |

## 🛠 Troubleshooting

| What you see | What to do |
|---|---|
| The bot doesn't answer | Wait a minute (one message at a time), then `/help` (no AI). Check `/usage`; raise with `/cap 3`. |
| A plan uses a guess you know is wrong | Say the real value (`upper takes 50 min`) or answer the question; the week re-plans. |
| A Google event is wrong | Change it in Google (the app follows within 15 min), or `/sync`. The app only ever writes your Life OS calendar. |
| A session is in the wrong place | Before ✅: 🔁 or `upper Sat at PureGym`. After: ↩️ Undo, or `move upper to Friday`. |
| "Not saved: run supabase/build-o.sql first" | Paste that file into Supabase → SQL Editor → Run. |
| The pinned Today is old | `/pin` |
