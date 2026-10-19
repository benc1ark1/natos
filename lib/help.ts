// How to use Nat OS (queue item 8): ONE source for /help in Telegram, the Help page in the app (app/help) and
// docs/HOW-TO-USE.md. The times are HIS settings (profiles.planning; the defaults when it can't be read), so the guide
// can't drift from the code; the commands are checked against every command the bot handles (tests/help-unit.test.mjs).
// Text uses `code` and **bold** only; each renderer turns those into its own format. Pure: no database, no clock.
// After changing anything here: node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs scripts/help-doc.mjs
import { DAYS_OF_WEEK, moreSettings } from './settings'
import { weeklyCheckOn } from './weekly/settings'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export type HelpTimes = {
  morning: string; holidayWake: string; todayItems: number; nudge: string; evening: string
  checkDay: string; weekly: string; quiet: string; weeklyCheck: boolean
}

/** The times the guide quotes: his settings (null / unreadable planning = the defaults). */
export function helpTimes(planning: unknown = null): HelpTimes {
  const s = moreSettings(planning)
  return {
    morning: String(s.briefAt), holidayWake: String(s.holidayWakeAt), todayItems: Number(s.todayItems),
    nudge: String(s.nudgeAt), evening: String(s.endOfDayAt), checkDay: cap(String(s.checkinDay ?? DAYS_OF_WEEK[6])),
    weekly: String(s.resetAt), quiet: String(s.quietFrom), weeklyCheck: weeklyCheckOn(planning),
  }
}

/** The defaults (the doc, and the unit test's comparison). */
export const HELP_TIMES = helpTimes(null)

export const HELP_TITLE = 'How to use Nat OS'
export const HELP_INTRO = 'Talk normally, typos and all. Every change comes back as a card: nothing is saved until you tap ✅.'

/** The daily routine, in time order (short lines: the Help page and the doc; /help packs them into three). */
export function helpRoutine(t: HelpTimes = HELP_TIMES): { icon: string; when: string; what: string }[] {
  return [
    { icon: '☀️', when: t.morning, what: `Today: up to ${t.todayItems} things, each with what to open. Tap each when done. On holidays: ${t.holidayWake}.` },
    { icon: '🔔', when: t.nudge, what: `A “don’t forget” nudge (not on your check-in day${t.weeklyCheck ? ': the weekly check replaces it' : ''}).` },
    { icon: '🌙', when: t.evening, what: 'Tap what you did. The rest moves to tomorrow by itself.' },
    t.weeklyCheck
      ? { icon: '🗓', when: `${t.checkDay} ${t.weekly}`, what: 'The weekly check, then **Plan next week? ✅** for the Your week card.' }
      : { icon: '🗓', when: `${t.checkDay} ${t.weekly}`, what: 'The Your week card: **✅ Apply** saves it.' },
    { icon: '😴', when: t.quiet, what: 'No plan messages until the morning (reminders and leave alerts still come).' },
  ]
}

/** The 15 most useful messages. `short`: the /help line. `by`: the plug-in that understands it without the AI
 *  (checked in the unit test), or 'ai'. */
export const HELP_MESSAGES: { say: string; short: string; does: string; by: 'tracker' | 'gym' | 'act' | 'life' | 'weekly' | 'ai' }[] = [
  { say: 'what next?', short: 'what to open now', does: 'exactly what to open now', by: 'tracker' },
  { say: 'matrices 🟢', short: 'a topic’s colour', does: 'sets a topic’s colour and its next review', by: 'tracker' },
  { say: 'did Bicen matrices set 8/10', short: 'logs it, moves on', does: 'logs it, colours it, moves you on', by: 'tracker' },
  { say: 'finished textbook exercise on logs', short: 'next resource', does: 'ticks that step, picks the next resource', by: 'tracker' },
  { say: 'mistake: PC1-03 Q3b assumed through origin – knowledge', short: '', does: 'saves the mistake with a redo date', by: 'tracker' },
  { say: 'HT2 practice 38/45', short: 'test score', does: 'a test score', by: 'tracker' },
  { say: 'pause getting ahead until 25 Oct', short: 'temporary rule', does: 'a temporary rule that ends by itself', by: 'tracker' },
  { say: 'physics homework due Fri', short: 'a task', does: 'a task with its due date', by: 'ai' },
  { say: 'bench 80x5x3', short: 'a lift', does: '80 kg × 5 reps × 3 sets (PRs spotted)', by: 'gym' },
  { say: 'ACT practice: E33 M35 R34', short: 'ACT scores', does: 'ACT scores; focus moves to the weakest', by: 'act' },
  { say: 'out with friends tomorrow 2–9pm', short: 'an event', does: 'an event; the plan works around it', by: 'life' },
  { say: 'move football to Thu 8', short: 'move an event', does: 'moves one of your events', by: 'life' },
  { say: 'plan my week', short: 'Your week card', does: 'the Your week card', by: 'ai' },
  { say: 'how was my week?', short: 'weekly check', does: 'the weekly check, any day', by: 'weekly' },
  { say: 'export my tracker', short: 'CSV', does: 'your tracker as a CSV file', by: 'tracker' },
]

/** How ✅ works, in one line (the card buttons; a Today tick needs no card). */
export const HELP_BUTTONS = '**✅** saves · **✏️** type the fix · **❌** drops it · **↩️ Undo** puts it back. Nothing is ever deleted.'

/** The ideas inbox in one line (lib/telegram/ideas.ts, plans/ideas-inbox.md). */
export const HELP_IDEAS = 'Can’t do it yet? You get “I can’t do that yet — it needs adding in Claude Code.” and your words go to `/ideas`: paste that block into Claude Code, then `/ideas done 2` · `/ideas drop 2` · `/ideas undo`.'

/** The Google Sheet backup in one line, and step by step (components/TrackerExport.tsx: one CSV per tab). */
export const HELP_BACKUP_SHORT = 'Backup: **Subjects** → **Export my tracker**'
export const HELP_BACKUP: string[] = [
  'On a computer (the Sheets phone app has no Import), open **Subjects** → **Export my tracker** in the app.',
  'Tap **Download** next to a tab (or **Download all**).',
  'In your Google Sheet open the same tab. Select **A4** down to the bottom of the tab and press **Delete**, then click **A4**.',
  '**File → Import → Upload** that CSV → **Replace data at selected cell** → **Import data**.',
  '**Programmes**: the first time, add a new tab for it (or skip it).',
]
export const HELP_BACKUP_NOTE = 'Sending `export my tracker` in Telegram gives you every tab in one file: a copy to keep.'

/** Every command the bot handles (the unit test checks this against the "/" menu, the plug-ins and lib/telegram/bot.ts). */
export const HELP_COMMANDS: { group: string; commands: { command: string; what: string }[] }[] = [
  { group: 'Today', commands: [
    { command: 'today', what: 'your few things (`/today all`: everything)' },
    { command: 'brief', what: 'this morning’s message (`/brief full`: the whole day)' },
    { command: 'week', what: 'the next 7 days' },
    { command: 'coming', what: 'deadlines, tests and events soon' },
    { command: 'free', what: 'free time (`/free tomorrow`)' },
    { command: 'inbox', what: 'your Inbox' },
    { command: 'postponed', what: 'tasks you keep putting off' },
    { command: 'next', what: 'a project’s next steps (`/next <project>`)' },
    { command: 'add', what: 'add something (`/add PE kit Friday`)' },
    { command: 'pin', what: 'refresh the pinned Today' },
  ] },
  { group: 'Study', commands: [
    { command: 'maths', what: 'Maths + FM topics' },
    { command: 'physics', what: 'Physics topics' },
    { command: 'tests', what: 'tests: days left, scores, mistakes' },
    { command: 'review', what: 'reviews due today' },
    { command: 'rules', what: 'temporary study rules' },
    { command: 'programmes', what: 'programmes (STEP…): next item' },
    { command: 'act', what: 'ACT: mode, scores, next chapters' },
  ] },
  { group: 'Training', commands: [
    { command: 'gym', what: 'this week’s lifts, PRs, next sessions' },
    { command: 'lifts', what: 'same as /gym' },
    { command: 'owen', what: 'a message for Owen: your days and free slots' },
  ] },
  { group: 'Week', commands: [
    { command: 'weekly', what: 'how your week went' },
  ] },
  { group: 'Links', commands: [
    { command: 'app', what: 'open the app inside Telegram' },
    { command: 'dashboard', what: 'same as /app' },
    { command: 'google', what: 'Google Calendar status' },
    { command: 'sync', what: 'sync Google Calendar now' },
    { command: 'whoop', what: 'Whoop recovery' },
    { command: 'mail', what: 'the email watcher' },
  ] },
  { group: 'Bot', commands: [
    { command: 'ask', what: 'a question only, never a change (`/ask when am I free?`)' },
    { command: 'ideas', what: 'things it can’t do yet' },
    { command: 'usage', what: 'AI spend' },
    { command: 'cap', what: 'the daily AI limit (`/cap 2` = $2)' },
    { command: 'speed', what: 'reply times' },
    { command: 'cancel', what: 'drop the open card' },
    { command: 'help', what: 'this guide (`/help all`: every command)' },
    { command: 'start', what: 'same as /help' },
  ] },
]

/** Where else the guide is (no file paths: they're no use on a phone). */
export const HELP_MORE = 'The same guide is in the app: More → Help.'
export const GUIDE_URL = 'https://github.com/benc1ark1/natos/blob/main/docs/GUIDE.md'

// ---------------------------------------------------------------------------------------------------------------------
// Renderers

/** "send `what next?` **now**" → text / code / bold parts (the Help page renders these). */
export function segments(text: string): { kind: 'text' | 'code' | 'bold'; text: string }[] {
  const out: { kind: 'text' | 'code' | 'bold'; text: string }[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push({ kind: 'text', text: text.slice(at, m.index) })
    out.push(m[1] !== undefined ? { kind: 'code', text: m[1] } : { kind: 'bold', text: m[2] })
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) })
  return out
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const tg = (text: string) => segments(text).map((s) => (s.kind === 'code' ? `<code>${esc(s.text)}</code>` : s.kind === 'bold' ? `<b>${esc(s.text)}</b>` : esc(s.text))).join('')

/** /help in Telegram: one phone screen (HTML). `planning`: his settings, for his times. */
export function helpTelegram(planning: unknown = null): string {
  const t = helpTimes(planning)
  const week = t.weeklyCheck ? 'weekly check → Plan next week? ✅' : 'Your week card → ✅ Apply'
  return [
    '<b>Nat OS on one screen</b>',
    esc(HELP_INTRO),
    '',
    `☀️ <b>${t.morning}</b> Today: up to ${t.todayItems} things, tap each when done (holidays ${t.holidayWake})`,
    `🔔 <b>${t.nudge}</b> nudge · 🌙 <b>${t.evening}</b> tap what you did; the rest moves on by itself`,
    `🗓 <b>${esc(t.checkDay)} ${t.weekly}</b> ${esc(week)} · 😴 quiet from ${t.quiet}`,
    '',
    '<b>Send things like</b> <i>(tap to copy)</i>',
    ...HELP_MESSAGES.map((m) => `<code>${esc(m.say)}</code>${m.short ? ` ${esc(m.short)}` : ''}`),
    '',
    tg(HELP_BUTTONS),
    `💡 Can’t do it yet? It goes to /ideas: paste that block into Claude Code.`,
    `📤 ${tg(HELP_BACKUP_SHORT)} (steps on the Help page).`,
    'All commands: /help all',
  ].join('\n')
}

/** /help all: every command, by group, with what it does. */
export function helpCommandsTelegram(): string {
  return [
    '<b>All commands</b>',
    ...HELP_COMMANDS.flatMap((g) => ['', `<b>${esc(g.group)}</b>`, ...g.commands.map((c) => `/${c.command} ${tg(c.what)}`)]),
    '',
    `<i>${esc(HELP_MORE)}</i>`,
  ].join('\n')
}

/** docs/HOW-TO-USE.md (kept identical to this by the unit test; scripts/help-doc.mjs writes it). The default times. */
export function helpMarkdown(): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|')
  return [
    `# ${HELP_TITLE}`,
    '',
    '<!-- Generated from lib/help.ts by scripts/help-doc.mjs. Edit lib/help.ts, then run the script. -->',
    '',
    HELP_INTRO,
    '',
    '## Your day',
    '',
    '_The default times: yours are in Settings (the Help page in the app shows yours)._',
    '',
    ...helpRoutine(HELP_TIMES).map((r) => `- ${r.icon} **${r.when}**: ${r.what}`),
    '',
    `## The ${HELP_MESSAGES.length} most useful messages`,
    '',
    '| Send | What happens |',
    '|---|---|',
    ...HELP_MESSAGES.map((m) => `| \`${cell(m.say)}\` | ${cell(m.does)} |`),
    '',
    '## How ✅ works',
    '',
    HELP_BUTTONS,
    'Ticking a Today item needs no card: the tap is the ✅ (tap again to untick).',
    '',
    '## 💡 Ideas inbox',
    '',
    HELP_IDEAS,
    '',
    '## 📤 Google Sheet backup',
    '',
    ...HELP_BACKUP.map((s, i) => `${i + 1}. ${s}`),
    '',
    HELP_BACKUP_NOTE,
    '',
    '## All commands',
    '',
    ...HELP_COMMANDS.flatMap((g) => [`**${g.group}**: ${g.commands.map((c) => `\`/${c.command}\` ${c.what}`).join(' · ')}`, '']),
    `_${HELP_MORE} The long guide: [GUIDE.md](GUIDE.md)._`,
    '',
  ].join('\n')
}
