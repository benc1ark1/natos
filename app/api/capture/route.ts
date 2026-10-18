import { sortCapture } from '@/lib/capture/sort'
import type { CaptureResult } from '@/lib/capture/types'
import { getServerSupabase } from '@/lib/supabase/server'

// AI capture: sorts one note and returns a proposal for Nat to confirm.
// Saves nothing. The Anthropic key is read on the server only (lib/capture/sort.ts).

const fail = (error: string, status = 200) => Response.json({ ok: false, error } satisfies CaptureResult, { status })

export async function POST(request: Request) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)

  const body = await request.json().catch(() => null)
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 1000) : ''
  if (!text) return fail('Nothing to sort.', 400)

  // Local testing only: pretend the AI failed (acceptance test T07). Ignored in production.
  if (process.env.NODE_ENV !== 'production' && request.headers.get('x-simulate-ai-failure') === '1') {
    return fail('Simulated AI failure (test switch).')
  }

  return Response.json(await sortCapture(sb, text))
}
