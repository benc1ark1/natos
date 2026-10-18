import { bearer, secretMatches } from '@/lib/telegram/guard'
import { OwnerSessionError, openOwnerSession } from '@/lib/telegram/owner-session'
import { runTick } from '@/lib/telegram/tick'

// Called every 5 minutes by Supabase (pg_cron) with "Authorization: Bearer <TELEGRAM_TICK_SECRET>".
// Without the secret: 401 and nothing happens. With it: sends whatever is due to Nat only.

export const maxDuration = 300   // the Sunday and first-morning cards plan a whole week (an AI call); Vercel allows 300 s

export async function POST(request: Request) {
  if (!secretMatches(bearer(request.headers.get('authorization')), process.env.TELEGRAM_TICK_SECRET)) {
    return new Response('Unauthorized', { status: 401 })
  }
  const owner = process.env.TELEGRAM_OWNER_ID
  if (!owner || !/^\d+$/.test(owner)) return Response.json({ ok: false, error: 'TELEGRAM_OWNER_ID isn’t set up.' })
  try {
    const sb = await openOwnerSession()
    return Response.json({ ok: true, ...(await runTick(sb, Number(owner))) })
  } catch (e) {
    // safe messages only: OwnerSessionError and our own errors never contain keys
    return Response.json({ ok: false, error: e instanceof OwnerSessionError || e instanceof Error ? e.message : 'Tick failed.' })
  }
}
