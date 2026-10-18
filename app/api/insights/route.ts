import { getServerSupabase } from '@/lib/supabase/server'
import { todayISO } from '@/lib/time'
import { undoActions, type Applied } from '@/lib/telegram/actions'
import { applySuggestion, dismissSuggestion, weekInsights } from '@/lib/telegram/roi'
import { loadViewData } from '@/lib/telegram/views'

// Insights on Home (Build O part 6): this week's time-saving suggestions and where the week's time goes, worked out
// by the same code the bot uses. Runs as the signed-in user (row level security). POST applies a suggestion (a normal
// checked change, with Undo), puts it off for the week, or undoes one just applied.

export const maxDuration = 60

const fail = (error: string, status = 200) => Response.json({ ok: false, error }, { status })

export async function GET() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)
  try {
    const ins = await weekInsights(sb, await loadViewData(sb, todayISO()))
    return Response.json({ ok: true, ...ins, suggestions: ins.suggestions.map(({ key, title, savesMin, tradeoff }) => ({ key, title, savesMin, tradeoff })) })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Couldn’t work out your week.')
  }
}

export async function POST(request: Request) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)
  const body = await request.json().catch(() => null) as { action?: string; key?: string; applied?: Applied[] } | null
  const key = typeof body?.key === 'string' ? body.key.slice(0, 200) : ''
  try {
    if (body?.action === 'undo' && Array.isArray(body.applied)) {
      const r = await undoActions(sb, body.applied.slice(0, 5))
      return Response.json({ ok: !r.failed.length, error: r.failed.length ? `Couldn’t undo: ${r.failed.join(', ')}` : undefined })
    }
    if (!key) return fail('Which suggestion?', 400)
    const data = await loadViewData(sb, todayISO())
    if (body?.action === 'apply') { const r = await applySuggestion(sb, data, key); return Response.json(r.error ? { ok: false, error: r.error } : { ok: true, applied: r.applied, line: r.line }) }
    if (body?.action === 'dismiss') { const r = await dismissSuggestion(sb, data, key); return Response.json(r.error ? { ok: false, error: r.error } : { ok: true }) }
    return fail('Unknown action.', 400)
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Not saved.')
  }
}
