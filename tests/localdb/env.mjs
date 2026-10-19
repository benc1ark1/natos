// Writes .env.testdb.local for local instance n:  node tests/localdb/env.mjs <n> [folder]
// The folder defaults to the repo root. Won't replace a file that points somewhere else (use --force).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { HERE, HOST, PG_PORT, PG_PASSWORD, ANON_KEY, SERVICE_KEY, MAX_INSTANCES, gatewayPort, dbName } from './config.mjs'

const args = process.argv.slice(2).filter((a) => a !== '--force')
const force = process.argv.includes('--force')
const n = Number(args[0])
if (!Number.isInteger(n) || n < 1 || n > MAX_INSTANCES) {
  console.log('Usage: node tests/localdb/env.mjs <instance number> [folder]')
  process.exit(1)
}
const dir = resolve(args[1] ?? join(HERE, '..', '..'))
const file = join(dir, '.env.testdb.local')

if (existsSync(file) && !force) {
  const url = /^TEST_SUPABASE_URL=(.*)$/m.exec(readFileSync(file, 'utf8'))?.[1]?.trim()
  let host = ''
  try { host = new URL(url).hostname } catch {}
  if (url && host !== HOST && host !== 'localhost') {
    console.log(`${file} points at ${url}, not this PC. Not replacing it (add --force to replace).`)
    process.exit(1)
  }
}

writeFileSync(file, [
  `# Local test stack (tests/localdb), instance ${n}. Made-up, local-only keys: nothing here works off this PC.`,
  `TEST_SUPABASE_URL=http://${HOST}:${gatewayPort(n)}`,
  `TEST_SUPABASE_ANON_KEY=${ANON_KEY}`,
  `TEST_SUPABASE_SECRET_KEY=${SERVICE_KEY}`,
  `TEST_DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@${HOST}:${PG_PORT}/${dbName(n)}`,
  `TEST_DB_PASSWORD=${PG_PASSWORD}`,
  '',
].join('\n'))
console.log(`Wrote ${file} (instance ${n}: http://${HOST}:${gatewayPort(n)}, database ${dbName(n)})`)

const up = await fetch(`http://${HOST}:${gatewayPort(n)}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false)
if (!up) console.log(`Note: instance ${n} isn't running yet. Start it with: node tests/localdb/start.mjs --instances ${n}`)
