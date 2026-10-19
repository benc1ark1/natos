// Queue item 8, how to use (lib/help.ts → /help, "/help all", the Help page, docs/HOW-TO-USE.md): every command the bot
// handles (the "/" menu, every plug-in, lib/telegram/bot.ts itself) is in the full list (a new command without a help
// line fails here), /help is one phone screen, the times are HIS settings (defaults otherwise), the 15 messages are
// really understood, the backup steps match the export, and the doc is the same text. Pure: no database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { world } from './support/tracker-bot.mjs'

const ROOT = new URL('../', import.meta.url)
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8')
const help = await import('../lib/help.ts')
const { HELP, COMMANDS } = await import('../lib/telegram/bot.ts')
const { PLUGINS } = await import('../lib/telegram/plugins/index.ts')
const ALL = help.helpCommandsTelegram()
const listed = help.HELP_COMMANDS.flatMap((g) => g.commands.map((c) => c.command))
const visible = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Every "/name" lib/telegram/bot.ts answers itself: its /^\/(a|b)\b/ and /^\/name\b/ patterns. */
function botHandled() {
  const src = read('lib/telegram/bot.ts')
  const out = new Set()
  for (const m of src.matchAll(/\/\^\\\/\(?([a-z|]+)\)?\\b/g)) for (const c of m[1].split('|')) out.add(c)
  return [...out]
}

test('every command the bot handles (the “/” menu, every plug-in, bot.ts itself) is in the full list and in /help all; none made up', () => {
  const menu = COMMANDS.map((c) => c.command)
  const handled = botHandled()
  for (const c of ['add', 'ask', 'cap', 'postponed', 'next', 'dashboard', 'start', 'help', 'sync']) assert.ok(handled.includes(c), `the bot.ts scan finds /${c}`)
  const real = new Set([...menu, ...handled, ...PLUGINS.flatMap((p) => (p.commands ?? []).map((c) => c.command))])
  for (const c of real) {
    assert.ok(listed.includes(c), `/${c} is a command but lib/help.ts HELP_COMMANDS doesn’t list it: add a line`)
    assert.match(ALL, new RegExp(`/${c}(?![a-z0-9_])`), `/help all doesn’t show /${c}`)
  }
  for (const c of listed) assert.ok(real.has(c), `/${c} is in the list but the bot doesn’t handle it`)
  assert.equal(new Set(listed).size, listed.length, 'each command once')
  for (const g of help.HELP_COMMANDS) for (const c of g.commands) assert.ok(c.what.trim(), `/${c.command} has a description`)
  assert.ok(ALL.length < 4096, `/help all fits one message: ${ALL.length}`)
})

test('/help is one phone screen (≤ 1,400 characters you see), well-formed HTML, no file paths, ends with “All commands: /help all”', () => {
  assert.equal(HELP, help.helpTelegram())
  for (const [name, html] of [['/help', HELP], ['/help all', ALL]]) {
    const tags = [...html.matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[1])
    for (const t of tags) assert.ok(['b', 'i', 'code'].includes(t), `${name}: unexpected tag <${t}>`)
    for (const t of ['b', 'i', 'code']) assert.equal((html.match(new RegExp(`<${t}>`, 'g')) ?? []).length, (html.match(new RegExp(`</${t}>`, 'g')) ?? []).length, `${name}: <${t}> balanced`)
    const text = html.replace(/<\/?(b|i|code)>/g, '')
    assert.ok(!/[<>]/.test(text), `${name}: no raw < or >`)
    assert.ok(!/&(?!amp;|lt;|gt;)/.test(text), `${name}: no raw &`)
    assert.ok(!/\*\*|`/.test(html), `${name}: the markdown marks became tags`)
    assert.ok(!/docs\/|\.md\b|github/i.test(html), `${name}: no file paths or links to the code (no use on a phone)`)
  }
  assert.ok(visible(HELP).length <= 1400, `one screen: ${visible(HELP).length} characters`)
  assert.ok(HELP.trimEnd().endsWith('All commands: /help all'))
  const lines = HELP.split('\n')
  assert.equal(lines.filter((l) => /^(☀️|🔔|🗓)/.test(l)).length, 3, 'the day in three lines')
  assert.equal(lines.filter((l) => l.startsWith('<b>✅</b>')).length, 1, '✅ ✏️ ❌ ↩️ in one line')
  assert.equal(lines.filter((l) => l.startsWith('💡')).length, 1, 'the ideas inbox in one line')
  assert.equal(lines.filter((l) => l.startsWith('📤')).length, 1, 'the backup in one line')
  assert.ok(lines.some((l) => l.startsWith('📤') && l.includes('Export my tracker') && l.includes('Help page')))
})

test('the times are his settings (defaults when unknown): morning, holiday wake, nudge, evening, weekly check, quiet hours', async () => {
  const { moreSettings } = await import('../lib/settings.ts')
  const { morningAt, isHoliday } = await import('../lib/today/holidays.ts')
  const { checkDue } = await import('../lib/telegram/plugins/weekly.ts')
  const d = moreSettings({})
  const t = help.HELP_TIMES
  assert.equal(t.morning, d.briefAt); assert.equal(t.morning, '07:30')
  assert.equal(t.holidayWake, d.holidayWakeAt)
  assert.equal(t.todayItems, d.todayItems); assert.ok(t.todayItems <= 5)
  assert.equal(t.nudge, d.nudgeAt)
  assert.equal(t.evening, d.endOfDayAt)
  assert.equal(t.weekly, d.resetAt)
  assert.equal(t.checkDay.toLowerCase(), d.checkinDay); assert.equal(t.checkDay, 'Sunday')
  assert.equal(t.quiet, d.quietFrom)
  assert.equal(t.weeklyCheck, true)
  // what the code does with them
  const school = '2026-11-09', holiday = '2026-10-21'   // a Monday after half-term; a day in the default half-term
  assert.ok(!isHoliday({}, school) && isHoliday({}, holiday))
  assert.equal(morningAt({}, school), t.morning)
  assert.equal(morningAt({}, holiday), t.holidayWake)
  assert.ok(checkDue({}, '2026-11-08', t.weekly), 'the weekly check goes on Sunday at the reset time')
  assert.ok(!checkDue({}, '2026-11-07', t.weekly), 'not on Saturday')
  for (const s of [`<b>${t.morning}</b>`, `holidays ${t.holidayWake}`, `<b>${t.nudge}</b> nudge`, `<b>${t.evening}</b>`, `<b>${t.checkDay} ${t.weekly}</b> weekly check`, `quiet from ${t.quiet}`, `up to ${t.todayItems} things`]) assert.ok(HELP.includes(s), s)
  // his own settings win
  const mine = { briefAt: '07:05', holidayWakeAt: '10:15', nudgeAt: '17:40', endOfDayAt: '21:45', checkinDay: 'saturday', resetAt: '19:10', quietFrom: '22:20', todayItems: 4 }
  const h = help.helpTelegram(mine)
  for (const s of ['<b>07:05</b>', 'holidays 10:15', '<b>17:40</b> nudge', '<b>21:45</b>', '<b>Saturday 19:10</b>', 'quiet from 22:20', 'up to 4 things']) assert.ok(h.includes(s), `his time: ${s}`)
  assert.ok(!h.includes('07:30'))
  const r = help.helpRoutine(help.helpTimes(mine))
  assert.deepEqual(r.map((x) => x.when), ['07:05', '17:40', '21:45', 'Saturday 19:10', '22:20'])
  // the weekly check off: Sunday is the Your week card by itself, and the nudge isn't replaced
  const off = help.helpTelegram({ weeklyCheck: 'off' })
  assert.ok(off.includes('Your week card → ✅ Apply') && !off.includes('Plan next week'))
  assert.ok(!help.helpRoutine(help.helpTimes({ weeklyCheck: 'off' }))[1].what.includes('replaces'))
})

test('the routine wording: the nudge isn’t on the check-in day; quiet hours stop plan messages, not reminders', () => {
  const r = help.helpRoutine()
  assert.match(r[1].what, /not on your check-in day: the weekly check replaces it/)
  assert.match(r[2].what, /moves to tomorrow by itself/)
  assert.match(r[3].what, /Plan next week\? ✅/)
  assert.match(r[4].what, /^No plan messages until the morning \(reminders and leave alerts still come\)/)
})

test('the 15 messages: each is understood without the AI by the plug-in it names (two go to the AI on purpose)', async () => {
  assert.equal(help.HELP_MESSAGES.length, 15)
  assert.equal(new Set(help.HELP_MESSAGES.map((m) => m.say)).size, 15)
  const TODAY = '2026-10-19'
  const W = world(TODAY)
  const { parseFast } = await import('../lib/tracker/bot-fast.ts')
  const { parseLifts } = await import('../lib/gym/parse.ts')
  const { parseScore } = await import('../lib/act/parse.ts')
  const { parseNewEvent, parseChange } = await import('../lib/life/parse.ts')
  const { WEEKLY_WORDS } = await import('../lib/telegram/plugins/weekly.ts')
  const norm = (m) => m.toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()
  const understood = {
    tracker: (m) => parseFast(m, W, TODAY) !== null,
    gym: (m) => parseLifts(m, TODAY)?.kind === 'lift',
    act: (m) => parseScore(m) !== null,
    life: (m) => parseNewEvent(m, TODAY) !== null || parseChange(m, TODAY) !== null,
    weekly: (m) => WEEKLY_WORDS.test(norm(m)),
  }
  for (const m of help.HELP_MESSAGES) {
    assert.ok(m.does.trim(), m.say)
    assert.ok(HELP.includes(`<code>${m.say}</code>`), `/help shows “${m.say}”`)
    if (m.by === 'ai') continue
    assert.ok(understood[m.by](m.say), `“${m.say}” isn’t understood by the ${m.by} fast path any more: change the example`)
  }
  assert.equal(help.HELP_MESSAGES.filter((m) => m.by === 'ai').length, 2)
})

test('✅ / ✏️ / ❌ / ↩️ are the real buttons; the ideas line matches /ideas and the “can’t do” reply', async () => {
  const cards = read('lib/telegram/cards.ts')
  for (const label of ['✅ Apply', '✅ Save', '✏️ Change', '❌ Cancel', '↩️ Undo']) assert.ok(cards.includes(`'${label}'`), `${label} is a real button`)
  for (const mark of ['✅', '✏️', '❌', '↩️ Undo']) assert.ok(help.HELP_BUTTONS.includes(mark))
  assert.ok(read('lib/weekly/summary.ts').includes(`'Plan next week? ✅'`))
  const { CANT, ideasCommand } = await import('../lib/telegram/ideas.ts')
  assert.ok(help.HELP_IDEAS.includes(CANT), 'the exact “I can’t do that yet” line')
  const hint = await ideasCommand(null, 'what?')   // the usage line (no database needed)
  for (const form of ['/ideas done 2', '/ideas drop 2', '/ideas undo']) {
    assert.ok(hint.includes(form), `/ideas understands ${form}`)
    assert.ok(help.HELP_IDEAS.includes(`\`${form}\``), `the guide shows ${form}`)
  }
})

test('the Google Sheet steps: on a computer, clear A4 down first, Programmes needs its own tab; the Subjects page says the same', () => {
  const view = read('components/SubjectsView.tsx'), exp = read('components/TrackerExport.tsx')
  assert.ok(view.includes('>Export my tracker</button>'))
  const steps = help.HELP_BACKUP.join(' ')
  for (const s of ['On a computer', '**Subjects**', '**Export my tracker**', '**Download**', '**Download all**', 'Select **A4** down to the bottom of the tab and press **Delete**', '**File → Import → Upload**', '**Replace data at selected cell**', '**Programmes**: the first time, add a new tab for it (or skip it)']) assert.ok(steps.includes(s), s)
  const page = exp.replace(/<\/?b>/g, '')
  for (const s of ['On a computer (the Sheets phone app has no Import)', 'Select A4 down to the bottom of the tab and press Delete', 'File → Import → Upload', 'Replace data at selected cell', 'Programmes: the first time, add a new tab for it (or skip it)', 'Download all', "'Download'"]) assert.ok(page.includes(s), `TrackerExport says ${s}`)
  assert.ok(read('lib/tracker/csv.ts').includes("'Programmes'"), 'the export has a Programmes file')
  assert.ok(read('lib/tracker/bot-fast.ts').includes('"export my tracker"'), 'the bot’s export message')
})

test('docs/HOW-TO-USE.md is the same guide (run scripts/help-doc.mjs after changing lib/help.ts)', () => {
  assert.equal(read('docs/HOW-TO-USE.md').replace(/\r\n/g, '\n'), help.helpMarkdown(), 'docs/HOW-TO-USE.md is out of date: run node --experimental-strip-types --no-warnings --import ./tests/support/register.mjs scripts/help-doc.mjs')
})

test('the Help page reads his settings (server component), folds the details away, and is linked in the header and More', () => {
  assert.ok(existsSync(new URL('app/help/page.tsx', ROOT)))
  const page = read('app/help/page.tsx')
  assert.ok(!page.includes("'use client'"), 'a server component')
  assert.match(page, /getServerSupabase/)
  assert.match(page, /await connection\(\)/, 'rendered per request (never prerendered with the default times)')
  assert.match(page, /from\('profiles'\)\.select\('planning'\)/)
  assert.equal((page.match(/<details /g) ?? []).length, 2, 'the backup steps and all commands are folded')
  assert.ok(!/service_role|SERVICE_ROLE/.test(page))
  const shell = read('components/Shell.tsx')
  assert.match(shell, /href="\/help">Help<\/Link>/)
  assert.match(shell, /\{ href: '\/help', label: 'Help'/)
  assert.match(shell, /pathname\.startsWith\('\/help'\) \? 'Help'/)
})

test('“help”, “what can you do?” get the guide (his times), “commands” every command, with no AI; anything more goes to the brain', async () => {
  const { plugin } = await import('../lib/telegram/plugins/help.ts')
  const planning = { briefAt: '06:55' }
  const sb = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: { planning }, error: null }) }) }) }
  const broken = { from: () => { throw new Error('offline') } }
  for (const m of ['help', 'Help!', 'help me', 'what can you do?', 'What can I say', 'how do I use this?', 'How does this work?', 'hey help']) {
    const r = await plugin.fast(m, { sb })
    assert.equal(r?.kind, 'answer', m)
    assert.equal(r.html, help.helpTelegram(planning))
  }
  assert.equal((await plugin.fast('help', { sb: broken })).html, HELP, 'the default times when his settings can’t be read')
  for (const m of ['commands', 'all commands', 'show me the commands', 'list commands']) assert.equal((await plugin.fast(m, { sb })).html, ALL, m)
  for (const m of ['help me with matrices', 'physics homework help', 'can you help me plan tonight', 'what can you do about my week?', 'helpful', 'commands for the gym']) {
    assert.equal(await plugin.fast(m, { sb }), null, m)
  }
})

test('segments: `code` and **bold** split out; plain text untouched', () => {
  assert.deepEqual(help.segments('send `what next?` **now** ok'), [
    { kind: 'text', text: 'send ' }, { kind: 'code', text: 'what next?' }, { kind: 'text', text: ' ' }, { kind: 'bold', text: 'now' }, { kind: 'text', text: ' ok' },
  ])
  assert.deepEqual(help.segments('plain'), [{ kind: 'text', text: 'plain' }])
})
