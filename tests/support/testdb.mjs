// The TEST database ("nat-os-test", a second free Supabase project). Never the real one:
// settings come only from .env.testdb.local, and everything stops if its address matches the real app's.
// - applySchema(): runs every SQL file in build order (each is safe to re-run). The 5-minute timer is skipped.
// - ensureUsers(): a made-up owner ("nat-test@example.com") and a stranger, to prove row level security.
// - reset(): empties every table and adds a little made-up data (subjects, a profile).
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const ROOT = new URL('../../', import.meta.url).pathname

export const SQL_FILES = [
  'assets/supabase-schema.sql',
  'supabase/stage1-additions.sql',
  'supabase/simplify-c-d.sql',
  'supabase/stage1.5-2c-reminders.sql',
  'supabase/stage1.5-4-5.sql',
  'supabase/stage1.5-6-8.sql',
  'supabase/stage1.5-9-guides.sql',
  'supabase/step6-capture.sql',
  'supabase/step7-checkin.sql',
  'supabase/step9-telegram.sql',
  'supabase/jarvis-a.sql',
  'supabase/jarvis-b.sql',
  'supabase/jarvis-b2.sql',
  'supabase/jarvis-c1.sql',
  'supabase/jarvis-d1.sql',
  'supabase/jarvis-d2.sql',
  'supabase/jarvis-e.sql',
  'supabase/jarvis-g.sql',
  'supabase/build-h.sql',
  'supabase/step11-google.sql',
  'supabase/step11-whoop.sql',
  'supabase/step12-study.sql',
  'supabase/step10-guides.sql',
  'supabase/build-m-mail.sql',
  'supabase/build-n.sql',
  'supabase/build-o.sql',
  'supabase/maths.sql',
]

function readEnvFile(file) {
  const p = join(ROOT, file)
  if (!existsSync(p)) return {}
  return Object.fromEntries(readFileSync(p, 'utf8').split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
}

/** The test settings, or null (with the reason) if they aren't all there. */
export function testEnv() {
  const e = readEnvFile('.env.testdb.local')
  const need = ['TEST_SUPABASE_URL', 'TEST_SUPABASE_ANON_KEY', 'TEST_SUPABASE_SECRET_KEY', 'TEST_DATABASE_URL', 'TEST_DB_PASSWORD']
  const missing = need.filter((k) => !e[k])
  if (missing.length) return { env: null, why: `test database not set up (missing ${missing.join(', ')} in .env.testdb.local)` }
  e.TEST_SUPABASE_URL = e.TEST_SUPABASE_URL.replace(/\/+$/, '')
  const real = readEnvFile('.env.local').NEXT_PUBLIC_SUPABASE_URL
  const host = (u) => { try { return new URL(u).host } catch { return '' } }
  if (real && host(real) === host(e.TEST_SUPABASE_URL)) throw new Error('STOP: the test settings point at the REAL database. Nothing was run.')
  if (real && e.TEST_DATABASE_URL.includes(host(real).split('.')[0])) throw new Error('STOP: the test connection string points at the REAL database. Nothing was run.')
  return { env: e, why: null }
}

export function connect(env) {
  const url = env.TEST_DATABASE_URL.replace('[YOUR-PASSWORD]', encodeURIComponent(env.TEST_DB_PASSWORD))
  // Supabase's pooler uses its own certificate authority; this is a throwaway test database.
  return new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
}

/** Run each SQL file once (again only if it changed since), remembering what ran in test_meta.applied. */
export async function applySchema(db, files = SQL_FILES) {
  await db.query(`create schema if not exists test_meta; create table if not exists test_meta.applied (file text primary key, sha text not null, at timestamptz not null default now())`)
  const done = new Map((await db.query(`select file, sha from test_meta.applied`)).rows.map((r) => [r.file, r.sha]))
  for (const f of files) {
    let sql = readFileSync(join(ROOT, f), 'utf8')
    // The test database never calls the real app: leave out the 5-minute timer.
    if (f.endsWith('step9-telegram.sql')) sql = sql.slice(0, sql.indexOf('create extension if not exists pg_cron'))
    const sha = createHash('sha256').update(sql).digest('hex')
    if (done.get(f) === sha) continue
    try {
      await db.query(sql)
      await db.query(`insert into test_meta.applied (file, sha) values ($1, $2) on conflict (file) do update set sha = excluded.sha, at = now()`, [f, sha])
    } catch (e) {
      throw new Error(`${f}: ${e.message}`)
    }
  }
}

export const OWNER_EMAIL = 'nat-test@example.com'
export const STRANGER_EMAIL = 'stranger-test@example.com'

export async function ensureUsers(env) {
  const admin = createClient(env.TEST_SUPABASE_URL, env.TEST_SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 100 })
  if (error) throw new Error(`listUsers: ${error.message}`)
  const ids = {}
  for (const email of [OWNER_EMAIL, STRANGER_EMAIL]) {
    let u = data.users.find((x) => x.email === email)
    if (!u) {
      const made = await admin.auth.admin.createUser({ email, email_confirm: true, password: crypto.randomUUID() })
      if (made.error) throw new Error(`createUser: ${made.error.message}`)
      u = made.data.user
    }
    ids[email] = u.id
  }
  return { owner: ids[OWNER_EMAIL], stranger: ids[STRANGER_EMAIL] }
}

/** Empty every app table, then add a small made-up starting point for the owner and the stranger. */
export async function reset(db, users) {
  const { rows } = await db.query(`select tablename from pg_tables where schemaname = 'public'`)
  if (rows.length) await db.query(`truncate ${rows.map((r) => `public."${r.tablename}"`).join(', ')} restart identity cascade`)
  for (const uid of [users.owner, users.stranger]) {
    await db.query(`insert into public.profiles (user_id, display_name) values ($1, 'Test') on conflict do nothing`, [uid])
    const cat = await db.query(`insert into public.categories (user_id, name) values ($1, 'Study') returning id`, [uid])
    for (const [i, name] of ['Physics', 'Maths', 'Further Maths', 'Computer Science'].entries()) {
      await db.query(`insert into public.subjects (user_id, category_id, name, sort_order) values ($1, $2, $3, $4)`, [uid, cat.rows[0].id, name, i])
    }
    // Build O: tests start after the first-morning messages, with the gap questions paused (a test turns them on)
    for (const key of ['onboard:gaps', 'onboard:cleanup', 'onboard:owen', 'onboard:week', 'gaps:paused']) {
      await db.query(`insert into public.telegram_sent (user_id, key) values ($1, $2) on conflict do nothing`, [uid, key])
    }
  }
}
