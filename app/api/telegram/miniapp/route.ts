import { verifyInitData } from '@/lib/telegram/miniapp'
import { claim } from '@/lib/telegram/sent'
import { openOwnerSession, ownerSessionTokens } from '@/lib/telegram/owner-session'

// Signs Nat into the dashboard when he opens it from the bot (Telegram Mini App).
// Only if Telegram's signed launch data is genuine, under 10 minutes old, and his (TELEGRAM_OWNER_ID); each launch
// works once. Every failure gets the same answer, so nobody can learn why theirs failed.

const NO = () => Response.json({ ok: false }, { status: 401 })

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { initData?: unknown } | null
  const check = verifyInitData(typeof body?.initData === 'string' ? body.initData : null, process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_OWNER_ID)
  if (!check.ok) return NO()
  try {
    // one sign-in per launch: the same signed data can't be used twice
    if (!(await claim(await openOwnerSession(), `miniapp:${check.hash}`))) return NO()
    return Response.json({ ok: true, ...(await ownerSessionTokens()) }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NO()
  }
}
