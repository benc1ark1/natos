import { after } from 'next/server'
import { handleUpdate } from '@/lib/telegram/bot'
import { isOwnerUpdate, secretMatches, type TgUpdate } from '@/lib/telegram/guard'

// Telegram webhook. Two gates before anything else runs:
// 1. Telegram must send our secret (X-Telegram-Bot-Api-Secret-Token); otherwise 401 and nothing happens.
// 2. The update must be from Nat (TELEGRAM_OWNER_ID) in his private chat; otherwise it's silently ignored.
// Telegram gets its 200 straight away; the work runs just after, so Telegram never retries.

export const maxDuration = 180   // messages are handled one at a time, so a run may wait for the one before it

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'), process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }
  const update = (await request.json().catch(() => null)) as TgUpdate | null
  if (isOwnerUpdate(update, process.env.TELEGRAM_OWNER_ID)) after(() => handleUpdate(update!))
  // Same answer either way, so nobody can tell whether an update was used.
  return Response.json({ ok: true })
}
