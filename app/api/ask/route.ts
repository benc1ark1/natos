import { runAsk } from '@/lib/ask/run'
import type { AskResult, Turn } from '@/lib/ask/types'
import { getServerSupabase } from '@/lib/supabase/server'

// Ask AI: answers a question from Nat's own data, or drafts the week for the Sunday check-in.
// Read-only: saves nothing and changes no records. The Anthropic key is read on the server only (lib/ask/run.ts).

export const maxDuration = 60

const fail = (error: string, status = 200) => Response.json({ ok: false, error } satisfies AskResult, { status })

export async function POST(request: Request) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)

  const body = await request.json().catch(() => null)
  if (body?.mode === 'week') return Response.json(await runAsk(sb, { mode: 'week' }))
  const question = typeof body?.question === 'string' ? body.question.trim().slice(0, 1000) : ''
  if (!question) return fail('Ask a question first.', 400)
  const history: Turn[] = Array.isArray(body?.history)
    ? body.history.filter((t: Turn) => typeof t?.q === 'string' && typeof t?.a === 'string')
    : []
  return Response.json(await runAsk(sb, { mode: 'ask', question, history }))
}
