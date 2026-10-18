// Server-only: the sign-in tokens of connected services (Google, Whoop) are stored encrypted (AES-256-GCM) with
// TOKEN_KEY, which lives only in .env.local and Vercel. The database row alone is useless: anyone who reads it (the
// browser included, since row level security lets Nat read his own rows) gets ciphertext. Errors never show a token.
import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function key(): Buffer {
  const hex = process.env.TOKEN_KEY ?? ''
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('The server isn’t set up to store sign-ins (TOKEN_KEY missing).')
  return Buffer.from(hex, 'hex')
}

/** Encrypt a value (JSON) for one service; the service's name is bound in, so a Google token can't pass as Whoop's. */
export function seal(value: unknown, provider: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key(), iv)
  c.setAAD(Buffer.from(provider))
  const body = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()])
  return `${VERSION}:${Buffer.concat([iv, c.getAuthTag(), body]).toString('base64')}`
}

/** Decrypt; throws a plain message (never the data) if it was changed, made for another service or another key. */
export function open<T>(sealed: string, provider: string): T {
  try {
    const [v, b64] = sealed.split(':')
    if (v !== VERSION || !b64) throw new Error()
    const raw = Buffer.from(b64, 'base64')
    const d = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12))
    d.setAAD(Buffer.from(provider))
    d.setAuthTag(raw.subarray(12, 28))
    return JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8')) as T
  } catch (e) {
    if (e instanceof Error && /TOKEN_KEY/.test(e.message)) throw e
    throw new Error('The saved sign-in couldn’t be read. Connect again in Settings.')
  }
}
