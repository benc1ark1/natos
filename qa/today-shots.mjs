// QA for queue item 5 (Today + polish): fills the LOCAL test database (tests/localdb, never the real one) with a
// made-up QA account and takes Playwright screenshots of every page at phone (390×844) and desktop (1280×800) width.
//   node qa/today-shots.mjs seed [--today]        empty the test database, add the QA account and its sample data
//                                                 (--today: also a saved Today list, as the morning message leaves it)
//   node qa/today-shots.mjs shots <prefix> [url]  screenshots → qa/<prefix>-<page>-<390|1280>.png (default url http://localhost:3108;
//                                                 ONLY=home,tasks for some pages)
// The dev server must be running against the same local test database (see plans/contracts.md §13).
// Playwright: PLAYWRIGHT=<path to playwright/index.mjs> (default: the npx cache copy); browser: Microsoft Edge.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const env = Object.fromEntries(readFileSync(join(ROOT, '.env.testdb.local'), 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!/^http:\/\/127\.0\.0\.1:/.test(env.TEST_SUPABASE_URL ?? '')) throw new Error('Only the local test database, please.')
const EMAIL = 'nat-qa@example.com'
const PASSWORD = 'qa-local-only-password-1'

const london = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

async function seed(withToday) {
  const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const list = await admin.auth.admin.listUsers({ perPage: 100 })
  let user = list.data.users.find((u) => u.email === EMAIL)
  if (!user) user = (await admin.auth.admin.createUser({ email: EMAIL, email_confirm: true, password: PASSWORD })).data.user
  else await admin.auth.admin.updateUserById(user.id, { password: PASSWORD })
  const uid = user.id
  const db = new pg.Client({ connectionString: env.TEST_DATABASE_URL.replace('[YOUR-PASSWORD]', encodeURIComponent(env.TEST_DB_PASSWORD)) })
  await db.connect()
  const { rows: tables } = await db.query(`select tablename from pg_tables where schemaname = 'public'`)
  await db.query(`truncate ${tables.map((r) => `public."${r.tablename}"`).join(', ')} restart identity cascade`)
  const add = async (table, v) => {
    const o = { user_id: uid, ...v }
    const k = Object.keys(o)
    return (await db.query(`insert into public.${table} (${k.join(',')}) values (${k.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(o))).rows[0]
  }
  const today = london()
  const from = addDays(today, -21)
  await add('profiles', { display_name: 'Nat', planning: { holidays: 'none' } })
  for (const key of ['onboard:gaps', 'onboard:cleanup', 'onboard:owen', 'onboard:week', 'gaps:paused']) await add('telegram_sent', { key })
  const cat = await add('categories', { name: 'Study' })
  const subj = {}
  for (const [i, name] of ['Maths', 'Further Maths', 'Physics', 'Computer Science'].entries()) subj[name] = await add('subjects', { category_id: cat.id, name, sort_order: i })
  await add('events', { title: 'School', repeat_days: [1, 2, 3, 4, 5], start_time: '08:45', end_time: '16:00', repeat_from: from, is_school: true })
  await add('events', { title: 'Football training', repeat_days: [1, 3], start_time: '19:45', end_time: '21:00', repeat_from: from, training_type: 'football', load: 'hard' })
  await add('events', { title: 'Speed session with coach', repeat_days: [2], start_time: '17:00', end_time: '18:00', repeat_from: from, training_type: 'sprint' })
  await add('events', { title: 'CS tutor', repeat_days: [4], start_time: '17:30', end_time: '18:30', repeat_from: from })
  const upper = await add('weekly_targets', { name: 'Upper', target_count: 2 })
  const hw = await add('tasks', { title: 'Physics homework: waves worksheet', status: 'this_week', importance: 'must', due_at: `${addDays(today, 1)}T12:00:00Z`, duration_minutes: 45, subject_id: subj.Physics.id })
  await add('tasks', { title: 'SMC past paper 2019', status: 'today', importance: 'must', due_at: `${today}T12:00:00Z`, duration_minutes: 60, subject_id: subj.Maths.id })
  await add('tasks', { title: 'Return library book', status: 'this_week', importance: 'nice', duration_minutes: 10 })
  await add('tasks', { title: 'Sort out football boots', status: 'inbox', importance: 'nice' })
  await add('tasks', { title: 'Revise for CS mock', status: 'this_month', importance: 'must', due_at: `${addDays(today, 9)}T12:00:00Z`, duration_minutes: 50, subject_id: subj['Computer Science'].id })
  const done = await add('tasks', { title: 'Maths homework: logs', status: 'completed', importance: 'must', completed_at: new Date().toISOString(), archived_at: new Date().toISOString(), archive_reason: 'done' })
  void done
  const test = await add('goals', { title: 'FM HT2 test', period: 'month', kind: 'test', target_date: addDays(today, 24), subject_id: subj['Further Maths'].id, info: '50 min · ~45 marks · calculator', test_kind: 'test', topic_codes: ['PC1-01', 'PC1-03'] })
  await add('goals', { title: 'Bench 100 kg', period: 'month', kind: 'goal', target_date: addDays(today, 60) })
  const proj = await add('projects', { name: 'SMC preparation', notes: 'One past paper a week.' })
  await add('tasks', { title: 'Do 2018 paper Q1–15', status: 'this_week', importance: 'nice', project_id: proj.id, duration_minutes: 60 })
  await add('reminders', { body: 'Bring PE kit', kind: 'day', remind_on: today })
  await add('reminders', { body: 'Ask about the trip form', kind: 'person', person: 'Form tutor' })
  const habit = await add('habits', { name: 'Morning routine', is_active: true })
  void habit
  await add('guides', { title: 'How I revise a topic', icon: '📘', body: '## Steps\n1. Read the section\n2. Worked examples\n3. Exercise, every 2nd question\n4. Exam questions, mark straight after' })
  const topics = {}
  for (const [i, [name, code, status, s]] of [['Matrices', 'PC1-01', 'not_secure', 'Further Maths'], ['Roots of polynomials', 'PC1-03', 'understand', 'Further Maths'], ['Exponential models', 'Y1-08', 'understand', 'Maths'], ['Waves', 'P07', 'not_secure', 'Physics']].entries()) {
    topics[code] = await add('topics', { subject_id: subj[s].id, name, code, status, sort_order: i, step: i === 0 ? 3 : 2, last_done: addDays(today, -4), bicen: code === 'PC1-01' ? 'Bicen Core Pure → CP1: Matrices' : null })
  }
  await add('mistakes', { subject_id: subj['Further Maths'].id, topic_id: topics['PC1-03'].id, body: 'Assumed the graph went through the origin', question: 'Q3b', code: 'PC1-03', kind: 'knowledge', logged_on: addDays(today, -3), review_on: today })
  for (let i = 6; i >= 0; i--) await add('whoop_days', { on_date: addDays(today, -i), recovery: [62, 71, 48, 80, 66, 58, 74][i], sleep_minutes: 430 + i * 6, strain: 9 + i })
  // the week he applied on Sunday: today's upper session
  await add('plan_blocks', { plan_id: '00000000-0000-4000-8000-000000000001', on_date: today, start_time: '16:30', end_time: '18:00', title: 'Upper @ PureGym', kind: 'training', target_id: upper.id, source: 'week' })
  if (withToday) {
    // what the morning message saved for today (the planner's picks, placed in free time)
    const plan = '00000000-0000-4000-8000-0000000000aa'
    const auto = (v) => add('plan_blocks', { plan_id: plan, on_date: today, source: 'auto', ...v })
    await auto({ start_time: '18:10', end_time: '18:55', title: 'Physics homework: waves worksheet', kind: 'focus', task_id: hw.id, pick_key: `task:${hw.id}`, open_text: 'Do it in black · mark green/red/purple · log red/purple as mistakes', why: 'homework · due tomorrow', done_hint: { kind: 'task', taskId: hw.id } })
    await auto({ start_time: '19:05', end_time: '19:35', title: 'PC1-01 Matrices: exam questions', kind: 'focus', topic_id: topics['PC1-01'].id, goal_id: test.id, pick_key: `topic:${topics['PC1-01'].id}:test_topic`, open_text: 'Bicen Core Pure → CP1: Matrices (one 30–45 min set, mark straight after)', why: 'FM HT2 test in 24 days · 🔴', done_hint: { kind: 'topic', topicId: topics['PC1-01'].id, step: 4 } })
    await auto({ start_time: '21:10', end_time: '21:30', title: 'Redo 1 mistake', kind: 'light', pick_key: `mistakes:${today}`, open_text: 'PC1-03 Q3b: redo it without looking, then check', why: 'redo due today', done_hint: { kind: 'mistakes', mistakeIds: [] } })
  }
  await db.end()
  console.log(`seeded ${EMAIL} (${uid}) for ${today}${withToday ? ' with a saved Today' : ''}`)
}

const PAGES = [
  ['login', '/login', false], ['home', '/', true], ['tasks', '/tasks', true], ['inbox', '/inbox', true], ['projects', '/projects', true],
  ['subjects', '/subjects', true], ['subject', 'subject', true], ['maths', '/maths', true], ['archive', '/archive', true],
  ['guides', '/guides', true], ['settings', '/settings', true],
]

async function shots(prefix, base) {
  const pw = await import(process.env.PLAYWRIGHT ? pathToFileURL(process.env.PLAYWRIGHT).href : pathToFileURL(join(process.env.LOCALAPPDATA ?? '', 'npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs')).href)
  const browser = await pw.chromium.launch({ channel: 'msedge', args: ['--disable-web-security'] })   // the local test gateway sends no CORS headers (QA only)
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1, isMobile: w < 500, hasTouch: w < 500, timezoneId: 'Europe/London', locale: 'en-GB' })
    const page = await ctx.newPage()
    const problems = []
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`))
    await page.goto(`${base}/login`)
    await page.waitForLoadState('networkidle')
    if (!process.env.ONLY || process.env.ONLY.split(',').includes('login')) await page.screenshot({ path: join(ROOT, `qa/${prefix}-login-${w}.png`), fullPage: true })
    await page.fill('input[type=email]', EMAIL)
    await page.fill('input[type=password]', PASSWORD)
    await Promise.all([page.waitForURL(`${base}/`, { timeout: 30000 }), page.click('form button')])
    for (const [name, path, signedIn] of PAGES) {
      if (!signedIn || (process.env.ONLY && !process.env.ONLY.split(',').includes(name))) continue
      let url = path
      if (path === 'subject') {
        await page.goto(`${base}/subjects`); await page.waitForLoadState('networkidle')
        const href = await page.locator('a[href^="/subjects/"]').first().getAttribute('href').catch(() => null)
        if (!href) continue
        url = href
      }
      await page.goto(`${base}${url}`)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(1200)   // data loads after the first paint
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      if (sideways > 0) problems.push(`${name} @${w}: scrolls sideways by ${sideways}px`)
      await page.screenshot({ path: join(ROOT, `qa/${prefix}-${name}-${w}.png`), fullPage: true })
    }
    if (problems.length) console.log(problems.join('\n'))
    await ctx.close()
  }
  await browser.close()
  console.log(`screenshots: qa/${prefix}-*.png`)
}

const [cmd, a, b] = process.argv.slice(2)
if (cmd === 'seed') await seed(process.argv.includes('--today'))
else if (cmd === 'shots') await shots(a ?? 'today-after', b ?? 'http://localhost:3108')
else console.log('node qa/today-shots.mjs seed [--today] | shots <prefix> [url]')
