// The Telegram Mini App's sign-in check, kept free of other imports so it can be tested on its own.
// Telegram signs the data it hands the Mini App with the bot token (HMAC-SHA256, see core.telegram.org/bots/webapps
// "Validating data received via the Mini App"). Only data that is genuine, fresh, and from Nat (TELEGRAM_OWNER_ID)
// passes. Callers answer every failure the same way, so nobody learns why theirs failed.
import { createHmac, timingSafeEqual } from 'node:crypto'

export const MAX_AGE_SECONDS = 10 * 60   // the Mini App was opened within the last 10 minutes

export function verifyInitData(initData: string | null | undefined, botToken: string | undefined, ownerId: string | undefined, nowMs = Date.now()):
  { ok: true; userId: number; hash: string } | { ok: false } {
  const no = { ok: false as const }
  if (!initData || initData.length > 4096 || !botToken || !ownerId || !/^\d+$/.test(ownerId)) return no
  let params: URLSearchParams
  try { params = new URLSearchParams(initData) } catch { return no }
  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return no
  const keys = [...params.keys()]
  if (new Set(keys).size !== keys.length) return no   // a key twice: refuse rather than guess
  const check = keys.filter((k) => k !== 'hash').sort().map((k) => `${k}=${params.get(k)}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const expected = createHmac('sha256', secret).update(check).digest()
  const given = Buffer.from(hash, 'hex')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return no
  const authDate = Number(params.get('auth_date'))
  if (!Number.isInteger(authDate) || nowMs / 1000 - authDate > MAX_AGE_SECONDS || authDate - nowMs / 1000 > 60) return no
  let user: { id?: unknown }
  try { user = JSON.parse(params.get('user') ?? '') } catch { return no }
  if (user?.id !== Number(ownerId)) return no
  return { ok: true, userId: Number(ownerId), hash }
}
