// Shared settings for the local test stack. Everything here is LOCAL-ONLY and made up:
// none of these values work anywhere except on this PC's 127.0.0.1 test servers.
import { createHmac } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const HERE = fileURLToPath(new URL('.', import.meta.url))
export const BIN = join(HERE, '.bin')
export const DATA = join(HERE, '.data')
export const PGDATA = join(DATA, 'pg')
export const STATE = join(DATA, 'state.json')

export const HOST = '127.0.0.1'
export const PG_PORT = 25390
export const CONTROL_PORT = 25391
export const MAX_INSTANCES = 50
export const gatewayPort = (n) => 25400 + n
export const postgrestPort = (n) => 25500 + n
export const postgrestAdminPort = (n) => 25600 + n
export const dbName = (n) => `natos_test_${n}`

export const PG_USER = 'postgres'
export const PG_PASSWORD = 'local-test-only-postgres-pw'
export const AUTHENTICATOR_PASSWORD = 'local-test-only-authenticator-pw'
export const JWT_SECRET = 'local-test-only-jwt-secret-not-a-real-key-000'

// v14: v12/v13 fail PATCH ?or=(...)&select=col when the filter uses a column not selected (the bot's queue lock does that)
export const POSTGREST = {
  version: 'v14.18',
  asset: 'postgrest-v14.18-windows-x86-64.zip',
  sha256: 'f24ca175b34d1ec0f3fc6d4c778f279f70577f6b3784b19aaa321e22bc3959b9',
}

const b64url = (b) => Buffer.from(b).toString('base64url')

export function signJwt(payload, secret = JWT_SECRET) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

/** The payload if the token is ours (right signature, not expired), else null. */
export function verifyJwt(token, secret = JWT_SECRET) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const want = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url')
  if (want !== parts[2]) return null
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    if (head.alg !== 'HS256') return null
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    if (typeof p.exp === 'number' && p.exp * 1000 < Date.now()) return null
    return p
  } catch {
    return null
  }
}

// Fixed iat/exp so every copy of this file makes the same keys (exp = 2033).
export const ANON_KEY = signJwt({ iss: 'supabase-local', role: 'anon', iat: 1700000000, exp: 2000000000 })
export const SERVICE_KEY = signJwt({ iss: 'supabase-local', role: 'service_role', iat: 1700000000, exp: 2000000000 })

export function parseInstances(argv, fallback = 1) {
  const i = argv.indexOf('--instances')
  const n = i >= 0 ? Number(argv[i + 1]) : fallback
  if (!Number.isInteger(n) || n < 1 || n > MAX_INSTANCES) throw new Error(`--instances must be 1..${MAX_INSTANCES}`)
  return n
}
