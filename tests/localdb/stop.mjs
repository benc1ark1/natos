// Stops the local test stack: node tests/localdb/stop.mjs
// Asks the running start.mjs to shut down cleanly; if it is gone, cleans up what it left behind.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import http from 'node:http'
import { HOST, CONTROL_PORT, PGDATA, STATE } from './config.mjs'

const post = (path) => new Promise((resolve) => {
  const req = http.request({ host: HOST, port: CONTROL_PORT, method: 'POST', path, timeout: 90_000 }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode === 200)) })
  req.on('timeout', () => { req.destroy(); resolve(false) })
  req.on('error', () => resolve(false))
  req.end()
})

if (await post('/stop')) {
  console.log('Stopped.')
  process.exit(0)
}

// No supervisor answering: kill leftovers by pid (only if they are still the same programs), then Postgres.
const alive = (pid, image) => {
  try { return new RegExp(image, 'i').test(execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' })) } catch { return false }
}
const kill = (pid) => { try { execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' }) } catch {} }
let state = {}
try { state = JSON.parse(readFileSync(STATE, 'utf8')) } catch {}
if (state.pid && alive(state.pid, 'node\\.exe')) { kill(state.pid); console.log(`killed supervisor (pid ${state.pid})`) }
for (const pid of Object.values(state.postgrest ?? {})) if (pid && alive(pid, 'postgrest\\.exe')) { kill(pid); console.log(`killed PostgREST (pid ${pid})`) }
if (existsSync(join(PGDATA, 'PG_VERSION'))) {
  const pgCtl = (await import('@embedded-postgres/windows-x64')).pg_ctl
  try {
    execFileSync(pgCtl, ['status', '-D', PGDATA], { stdio: 'ignore' })
    execFileSync(pgCtl, ['stop', '-D', PGDATA, '-m', 'fast', '-w'], { stdio: 'ignore' })
    console.log('stopped Postgres')
  } catch {}
}
rmSync(STATE, { force: true })
console.log('Nothing else running.')
