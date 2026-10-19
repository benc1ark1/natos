// Starts the local test stack and keeps it running (stop with Ctrl+C or: node tests/localdb/stop.mjs).
//   node tests/localdb/start.mjs --instances 2 [--fresh]
// One Postgres server, and per instance n: database natos_test_n, a PostgREST and a gateway (see config.mjs
// for ports). Already running? It says so (and adds instances if you asked for more). --fresh empties the
// instance databases first. Windows only for now. Logs: tests/localdb/.data/*.log
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, openSync, closeSync, rmSync, renameSync, readdirSync } from 'node:fs'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { join, dirname } from 'node:path'
import http from 'node:http'
import pg from 'pg'
import {
  HERE, BIN, DATA, PGDATA, STATE, HOST, PG_PORT, CONTROL_PORT, PG_USER, PG_PASSWORD, AUTHENTICATOR_PASSWORD,
  JWT_SECRET, POSTGREST, gatewayPort, postgrestPort, postgrestAdminPort, dbName, parseInstances,
} from './config.mjs'
import { startGateway } from './gateway.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
mkdirSync(DATA, { recursive: true })
const LOG = join(DATA, 'supervisor.log')
const log = (s) => {
  const line = `[${new Date().toISOString()}] ${s}`
  console.log(line)
  try { appendFileSync(LOG, line + '\n') } catch {}
}

const argv = process.argv.slice(2)
const want = parseInstances(argv, 1)
const fresh = argv.includes('--fresh')

async function control(method, path, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.request({ host: HOST, port: CONTROL_PORT, method, path, timeout: timeoutMs }, (res) => {
      let s = ''
      res.on('data', (c) => (s += c))
      res.on('end', () => { try { resolve(JSON.parse(s)) } catch { resolve(null) } })
    })
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error', () => resolve(null))
    req.end()
  })
}

// ---------- already running? ----------
const running = await control('GET', '/status')
if (running) {
  if (fresh) {
    console.log('The stack is already running; --fresh only works on a fresh start. Run: node tests/localdb/stop.mjs')
    process.exit(1)
  }
  if (running.instances < want) {
    console.log(`Running with ${running.instances} instance(s); adding up to ${want}...`)
    const r = await control('POST', `/grow?instances=${want}`, 180_000)
    if (!r?.ok) { console.log(`Could not add instances: ${r?.error ?? 'no answer'} (see ${LOG})`); process.exit(1) }
    console.log(r.summary)
  } else {
    console.log(`Already running (pid ${running.pid}).\n${running.summary}`)
  }
  process.exit(0)
}
if (process.platform !== 'win32' || process.arch !== 'x64') {
  console.log('This local stack is set up for Windows x64 only (Postgres from embedded-postgres, PostgREST windows zip).')
  process.exit(1)
}

// ---------- binaries ----------
const PG_BIN = dirname((await import('@embedded-postgres/windows-x64')).pg_ctl)
const exe = (name) => join(PG_BIN, `${name}.exe`)
const POSTGREST_DIR = join(BIN, `postgrest-${POSTGREST.version}`)
const POSTGREST_EXE = join(POSTGREST_DIR, 'postgrest.exe')

async function ensurePostgrest() {
  if (existsSync(POSTGREST_EXE)) return
  const url = `https://github.com/PostgREST/postgrest/releases/download/${POSTGREST.version}/${POSTGREST.asset}`
  log(`downloading PostgREST ${POSTGREST.version} ...`)
  const r = await fetch(url)
  if (!r.ok) throw new Error(`download failed: HTTP ${r.status} for ${url}`)
  const zip = Buffer.from(await r.arrayBuffer())
  const sha = createHash('sha256').update(zip).digest('hex')
  if (sha !== POSTGREST.sha256) throw new Error(`PostgREST download has the wrong checksum (${sha}); not using it`)
  // its own new, empty folder; extract there; then move into place
  const tmp = join(BIN, `dl-${randomBytes(4).toString('hex')}`)
  mkdirSync(tmp, { recursive: true })
  writeFileSync(join(tmp, POSTGREST.asset), zip)
  execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', join(tmp, POSTGREST.asset), '-C', tmp], { stdio: 'ignore' })
  rmSync(join(tmp, POSTGREST.asset))
  if (!existsSync(join(tmp, 'postgrest.exe'))) throw new Error(`postgrest.exe not found in ${POSTGREST.asset} (found: ${readdirSync(tmp).join(', ')})`)
  rmSync(POSTGREST_DIR, { recursive: true, force: true })
  renameSync(tmp, POSTGREST_DIR)
  log(`PostgREST ready at ${POSTGREST_EXE}`)
}

// ---------- a self-signed certificate (so clients asking for SSL get it; nothing verifies it) ----------
function selfSignedCert() {
  const der = (tag, content) => {
    const n = content.length
    const len = n < 0x80 ? Buffer.from([n]) : (() => { let h = n.toString(16); if (h.length % 2) h = '0' + h; const b = Buffer.from(h, 'hex'); return Buffer.concat([Buffer.from([0x80 | b.length]), b]) })()
    return Buffer.concat([Buffer.from([tag]), len, content])
  }
  const seq = (...xs) => der(0x30, Buffer.concat(xs))
  const set = (...xs) => der(0x31, Buffer.concat(xs))
  const int = (b) => der(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b)
  const oid = (s) => {
    const p = s.split('.').map(Number), out = [40 * p[0] + p[1]]
    for (let v of p.slice(2)) { const st = [v & 0x7f]; v = Math.floor(v / 128); while (v) { st.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128) } out.push(...st) }
    return der(0x06, Buffer.from(out))
  }
  const utc = (d) => der(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'))
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const alg = seq(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00])) // sha256WithRSAEncryption
  const name = seq(set(seq(oid('2.5.4.3'), der(0x0c, Buffer.from('localhost')))))
  const serial = randomBytes(8); serial[0] = (serial[0] & 0x7f) | 0x01
  const now = Date.now()
  const tbs = seq(der(0xa0, int(Buffer.from([2]))), int(serial), alg, name, seq(utc(new Date(now - 864e5)), utc(new Date(now + 3650 * 864e5))), name, publicKey.export({ type: 'spki', format: 'der' }))
  const cert = seq(tbs, alg, der(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])))
  return {
    cert: `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  }
}

// ---------- postgres ----------
function run(file, args, label) {
  // output to a file, and wait for 'exit' (pg_ctl's server child keeps inherited pipes open)
  const out = join(DATA, `${label}.log`)
  const fd = openSync(out, 'a')
  return new Promise((resolve, reject) => {
    const p = spawn(file, args, { stdio: ['ignore', fd, fd], windowsHide: true })
    p.on('error', (e) => { closeSync(fd); reject(e) })
    p.on('exit', (code) => { closeSync(fd); code === 0 ? resolve() : reject(new Error(`${label} failed (exit ${code}); see ${out}`)) })
  })
}

async function pgRunning() {
  try { await run(exe('pg_ctl'), ['status', '-D', PGDATA], 'pg_ctl'); return true } catch { return false }
}

async function startPostgres() {
  if (!existsSync(join(PGDATA, 'PG_VERSION'))) {
    log('creating the Postgres data folder (first run) ...')
    rmSync(PGDATA, { recursive: true, force: true })
    const pw = join(DATA, 'pwfile.tmp')
    writeFileSync(pw, PG_PASSWORD)
    try {
      await run(exe('initdb'), ['-D', PGDATA, '-U', PG_USER, `--pwfile=${pw}`, '-A', 'scram-sha-256', '-E', 'UTF8',
        '--locale-provider=builtin', '--builtin-locale=C.UTF-8', '--locale=C', '--no-sync'], 'initdb')
    } finally { rmSync(pw, { force: true }) }
    appendFileSync(join(PGDATA, 'postgresql.conf'), `\ninclude = 'localdb.conf'\n`)
  }
  if (!existsSync(join(PGDATA, 'server.crt')) || !existsSync(join(PGDATA, 'server.key'))) {
    const { cert, key } = selfSignedCert()
    writeFileSync(join(PGDATA, 'server.crt'), cert)
    writeFileSync(join(PGDATA, 'server.key'), key)
  }
  writeFileSync(join(PGDATA, 'localdb.conf'), [
    '# written by tests/localdb/start.mjs on every start (test-only settings: fast, not crash-safe)',
    `listen_addresses = '${HOST}'`, `port = ${PG_PORT}`, "unix_socket_directories = ''",
    'max_connections = 300', 'ssl = on', "ssl_cert_file = 'server.crt'", "ssl_key_file = 'server.key'",
    "timezone = 'UTC'", "log_timezone = 'UTC'", "lc_messages = 'C'",
    'fsync = off', 'synchronous_commit = off', 'full_page_writes = off',
    'log_min_messages = warning', "log_line_prefix = '%m [%p] %d '",
  ].join('\n') + '\n')
  if (await pgRunning()) {
    log('a Postgres from an earlier run is still up: restarting it')
    await run(exe('pg_ctl'), ['stop', '-D', PGDATA, '-m', 'fast', '-w'], 'pg_ctl')
  }
  await run(exe('pg_ctl'), ['start', '-D', PGDATA, '-l', join(DATA, 'postgres.log'), '-w', '-t', '60'], 'pg_ctl')
  log(`Postgres up on ${HOST}:${PG_PORT}`)
}

async function stopPostgres() {
  try { await run(exe('pg_ctl'), ['stop', '-D', PGDATA, '-m', 'fast', '-w', '-t', '60'], 'pg_ctl') } catch (e) { log(`pg_ctl stop: ${e.message}`) }
}

const BOOTSTRAP = readFileSync(join(HERE, 'bootstrap.sql'), 'utf8')
const pgClient = (database) => new pg.Client({ host: HOST, port: PG_PORT, user: PG_USER, password: PG_PASSWORD, database })

async function prepareDatabase(n, wipe) {
  const admin = pgClient('postgres')
  await admin.connect()
  try {
    if (wipe) await admin.query(`drop database if exists ${dbName(n)} with (force)`)
    const { rowCount } = await admin.query(`select 1 from pg_database where datname = $1`, [dbName(n)])
    if (!rowCount) await admin.query(`create database ${dbName(n)}`)
  } finally { await admin.end() }
  const db = pgClient(dbName(n))
  await db.connect()
  try {
    await db.query(BOOTSTRAP)
    await db.query(`alter role authenticator with login password '${AUTHENTICATOR_PASSWORD}'`)
  } finally { await db.end() }
}

// ---------- per instance: PostgREST + gateway ----------
const instances = new Map() // n -> { child, gateway, restarts }
let stopping = false

function writePostgrestConf(n) {
  const file = join(DATA, `postgrest-${n}.conf`)
  writeFileSync(file, [
    `db-uri = "postgres://authenticator:${AUTHENTICATOR_PASSWORD}@${HOST}:${PG_PORT}/${dbName(n)}?sslmode=disable"`,
    'db-schemas = "public"', 'db-anon-role = "anon"', 'db-extra-search-path = "public, extensions"',
    'db-max-rows = 1000', 'db-pool = 10', 'db-channel-enabled = true',
    `jwt-secret = "${JWT_SECRET}"`,
    `server-host = "${HOST}"`, `server-port = ${postgrestPort(n)}`, `admin-server-port = ${postgrestAdminPort(n)}`,
    'log-level = "warn"',
  ].join('\n') + '\n')
  return file
}

function spawnPostgrest(n) {
  const fd = openSync(join(DATA, `postgrest-${n}.log`), 'a')
  const child = spawn(POSTGREST_EXE, [writePostgrestConf(n)], {
    stdio: ['ignore', fd, fd], windowsHide: true,
    env: { ...process.env, PATH: `${PG_BIN};${process.env.PATH ?? ''}` },
  })
  closeSync(fd)
  child.on('exit', (code) => {
    const inst = instances.get(n)
    if (stopping || !inst || inst.child !== child) return
    inst.restarts++
    log(`PostgREST ${n} exited (code ${code}); restarting (#${inst.restarts}), see postgrest-${n}.log`)
    setTimeout(() => { if (!stopping) inst.child = spawnPostgrest(n) }, Math.min(5000, 500 * inst.restarts))
  })
  return child
}

async function ready(n, ms = 60_000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const ok = await new Promise((resolve) => {
      const req = http.get({ host: HOST, port: postgrestAdminPort(n), path: '/ready', timeout: 1000 }, (res) => { res.resume(); resolve(res.statusCode === 200) })
      req.on('timeout', () => { req.destroy(); resolve(false) })
      req.on('error', () => resolve(false))
    })
    if (ok) return
    await sleep(250)
  }
  throw new Error(`PostgREST ${n} did not become ready; see ${join(DATA, `postgrest-${n}.log`)}`)
}

async function startInstance(n) {
  await prepareDatabase(n, fresh)
  const inst = { child: null, gateway: null, restarts: 0 }
  instances.set(n, inst)
  inst.child = spawnPostgrest(n)
  await ready(n)
  inst.gateway = await startGateway({ n, log })
  log(`instance ${n}: gateway http://${HOST}:${gatewayPort(n)}  PostgREST ${postgrestPort(n)}  database ${dbName(n)}`)
}

const summary = () => [...instances.keys()].sort((a, b) => a - b)
  .map((n) => `  instance ${n}: http://${HOST}:${gatewayPort(n)}  (PostgREST ${postgrestPort(n)}, database ${dbName(n)} on ${HOST}:${PG_PORT})`)
  .join('\n')

function saveState() {
  writeFileSync(STATE, JSON.stringify({
    pid: process.pid, instances: instances.size, pgPort: PG_PORT,
    postgrest: Object.fromEntries([...instances].map(([n, i]) => [n, i.child?.pid])),
    startedAt: new Date().toISOString(),
  }, null, 2))
}

/** PostgREST processes left over from an earlier run whose supervisor was killed. */
function killLeftovers() {
  let prev
  try { prev = JSON.parse(readFileSync(STATE, 'utf8')) } catch { return }
  for (const pid of Object.values(prev.postgrest ?? {})) {
    if (!pid) continue
    try {
      const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })
      if (/postgrest\.exe/i.test(out)) { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' }); log(`stopped leftover PostgREST (pid ${pid})`) }
    } catch {}
  }
}

let queue = Promise.resolve()
const serial = (fn) => (queue = queue.then(fn, fn))

async function shutdown(why) {
  if (stopping) return
  stopping = true
  log(`stopping (${why}) ...`)
  for (const [, inst] of instances) {
    try { inst.child?.kill() } catch {}
    try { await inst.gateway?.close() } catch {}
  }
  await stopPostgres()
  rmSync(STATE, { force: true })
  log('stopped')
}

// ---------- go ----------
try {
  killLeftovers()
  await ensurePostgrest()
  await startPostgres()
  for (let n = 1; n <= want; n++) await startInstance(n)
} catch (e) {
  log(`start failed: ${e.message}`)
  await shutdown('start failed')
  process.exit(1)
}

const controlServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`)
  const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.method === 'GET' && url.pathname === '/status') return reply(200, { pid: process.pid, instances: instances.size, summary: summary() })
  if (req.method === 'POST' && url.pathname === '/grow') {
    let to
    try { to = parseInstances(['--instances', url.searchParams.get('instances')]) } catch (e) { return reply(400, { ok: false, error: e.message }) }
    return serial(async () => {
      try {
        for (let n = instances.size + 1; n <= to; n++) await startInstance(n)
        saveState()
        reply(200, { ok: true, summary: summary() })
      } catch (e) { log(`grow failed: ${e.message}`); reply(500, { ok: false, error: e.message }) }
    })
  }
  if (req.method === 'POST' && url.pathname === '/stop') {
    return serial(async () => { await shutdown('stop requested'); reply(200, { ok: true }); setTimeout(() => process.exit(0), 100) })
  }
  reply(404, { error: 'not found' })
})
controlServer.listen(CONTROL_PORT, HOST)
saveState()
log(`ready (pid ${process.pid}). Keep this running; stop with Ctrl+C or: node tests/localdb/stop.mjs\n${summary()}`)

for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
  process.on(sig, () => serial(async () => { await shutdown(sig); process.exit(0) }))
}
