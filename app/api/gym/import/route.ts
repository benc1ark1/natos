import { getServerSupabase } from '@/lib/supabase/server'
import { exerciseCatalogue } from '@/lib/gym/catalogue'
import { importLifts, knownRefs, loadLifts, RUN_SQL } from '@/lib/gym/data'
import { importSummary, MAX_BYTES, readCapped, readHevy } from '@/lib/gym/hevy'
import { gymPrefs } from '@/lib/gym/settings'

// Hevy CSV import (queue item 6). POST { csv } = preview (nothing saved): workouts, sets, what's skipped, what's
// already there, new PRs. POST { csv, confirm: true } = import: each set once (source_ref), as the signed-in user
// (row level security), never the service role. Hevy is read from its own export file only.

export const maxDuration = 60

const fail = (error: string, status = 200) => Response.json({ ok: false, error }, { status })

export async function POST(request: Request) {
  // the CSV text plus a little JSON around it; anything bigger is refused before it's read
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES * 1.2) return fail(`That file is too big (over ${MAX_BYTES / 1_000_000} MB). Export a shorter date range from Hevy.`, 413)
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)
  // read the body with a byte counter: a missing or wrong content-length can't get past the cap
  const text = await readCapped(request, Math.round(MAX_BYTES * 1.2))
  if (text === null) return fail(`That file is too big (over ${MAX_BYTES / 1_000_000} MB). Export a shorter date range from Hevy.`, 413)
  let body: { csv?: unknown; confirm?: unknown } | null = null
  try { body = JSON.parse(text) } catch { body = null }
  if (!body || typeof body.csv !== 'string' || !body.csv.trim()) return fail('Choose your Hevy CSV file first.', 400)
  if (body.csv.length > MAX_BYTES) return fail(`That file is too big (over ${MAX_BYTES / 1_000_000} MB). Export a shorter date range from Hevy.`, 413)
  try {
    const { data: prof } = await sb.from('profiles').select('planning').maybeSingle()
    const planning = prof?.planning ?? null
    const list = exerciseCatalogue(planning)
    const preview = readHevy(body.csv, list)
    if (preview.problem) return fail(preview.problem, 400)
    if (!preview.rows.length) return fail('No lifting sets in that file (warm-ups and cardio are skipped).', 400)
    if (body.confirm === true) {
      const r = await importLifts(sb, preview.rows)
      return Response.json({ ok: true, imported: r })
    }
    const keys = [...new Set(preview.rows.map((r) => r.exercise_key))]
    const [existing, refs] = await Promise.all([loadLifts(sb, { keys, max: 20_000 }), knownRefs(sb)])
    if (existing.missing) return fail(RUN_SQL)
    return Response.json({ ok: true, preview: importSummary(preview, existing.rows, refs, list, gymPrefs(planning)) })
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Couldn’t read that file.')
  }
}
