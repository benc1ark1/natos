// The bot's two gates, kept free of other imports so they can be tested on their own
// (tests/telegram-guard.test.mjs). Every Telegram request passes both before anything else runs.
import { createHash, timingSafeEqual } from 'node:crypto'

/** Does the secret sent with a request match ours? Constant-time; a missing or short secret never matches. */
export function secretMatches(given: string | null | undefined, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 24) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

/** "Bearer abc" -> "abc" */
export const bearer = (header: string | null): string | null => (header?.startsWith('Bearer ') ? header.slice(7) : null)

type TgUser = { id?: number }
type TgChat = { id?: number; type?: string }
export type TgUpdate = {
  update_id?: number
  message?: { from?: TgUser; chat?: TgChat; text?: string; message_id?: number }
  callback_query?: { id?: string; from?: TgUser; data?: string; message?: { chat?: TgChat; message_id?: number } }
  [k: string]: unknown
}

/**
 * Is this update from Nat, in his private chat with the bot? Only plain messages and button taps count;
 * anything else (groups, channels, edits, other people) is ignored. ownerId comes from TELEGRAM_OWNER_ID.
 */
export function isOwnerUpdate(update: TgUpdate | null | undefined, ownerId: string | undefined): boolean {
  if (!update || !ownerId || !/^\d+$/.test(ownerId)) return false
  const owner = Number(ownerId)
  const m = update.message
  if (m) return m.from?.id === owner && m.chat?.id === owner && m.chat?.type === 'private'
  const c = update.callback_query
  if (c) return c.from?.id === owner && c.message?.chat?.id === owner && c.message?.chat?.type === 'private'
  return false
}
