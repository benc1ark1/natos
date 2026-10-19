import { getServerSupabase } from '@/lib/supabase/server'
import { loadToday } from '@/lib/today/load'
import { toggleBlock, toggleTask } from '@/lib/today/done'

// Today on Home (queue item 5): the same list as the 07:30 morning message (lib/today), worked out on the server as the
// signed-in user (row level security). GET saves today's list the first time it's opened that day (unless his own plan
// is applied). POST ticks or unticks one item (a block, or a task that had no time today): the tap is the confirmation;
// a second tap puts back exactly what the first changed.

export const maxDuration = 60

const fail = (error: string, status = 200) => Response.json({ ok: false, error }, { status })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)
  try {
    const t = await loadToday(sb, { save: true })
    return Response.json({ ok: true, plan: t.plan, sqlMissing: t.sqlMissing })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Couldn’t work out today.')
  }
}

export async function POST(request: Request) {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)
  const body = await request.json().catch(() => null) as { blockId?: unknown; taskId?: unknown; done?: unknown } | null
  const blockId = typeof body?.blockId === 'string' && UUID.test(body.blockId) ? body.blockId : null
  const taskId = typeof body?.taskId === 'string' && UUID.test(body.taskId) ? body.taskId : null
  if (!blockId && !taskId) return fail('Which item?', 400)
  try {
    // done: the state he wants (a double tap or a stale page never flips it back); left out = toggle
    const want = typeof body?.done === 'boolean' ? body.done : undefined
    const r = blockId ? await toggleBlock(sb, blockId, new Date(), want) : await toggleTask(sb, taskId!, new Date(), want)
    if (!r.ok) return fail(r.error)
    const t = await loadToday(sb, { date: r.date })
    return Response.json({ ok: true, done: r.done, title: r.title, ask: r.ask, changed: r.changed, note: r.note ?? null, same: !!r.same, plan: t.plan })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Not saved.')
  }
}
