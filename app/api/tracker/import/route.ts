import { getServerSupabase } from '@/lib/supabase/server'
import { todayISO } from '@/lib/time'
import { MAX_BYTES, runImport } from './run'

// Import tracker (.xlsx), signed-in user only, as him (row level security; never the service role).
// POST the file's bytes: ?mode=preview → what would change (nothing saved);
// ?mode=confirm&fp=<the preview's fingerprint> → saves exactly that, and says what the database confirmed.

const fail = (error: string, status: number) => Response.json({ ok: false, error }, { status })

/** The body, but never more than `max` bytes (a missing or wrong Content-Length can't get past this). */
async function readLimited(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) { await reader.cancel().catch(() => {}); return null }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.byteLength }
  return out
}

export async function POST(request: Request) {
  let sb
  try { sb = await getServerSupabase() } catch { return fail('The app isn’t set up yet (Supabase keys missing).', 500) }
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return fail('Not signed in.', 401)

  const url = new URL(request.url)
  const mode = url.searchParams.get('mode') === 'confirm' ? 'confirm' : 'preview'
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES) return fail('That file is too big (4 MB at most). Is it the tracker?', 413)
  const bytes = await readLimited(request, MAX_BYTES)
  if (!bytes) return fail('That file is too big (4 MB at most). Is it the tracker?', 413)

  try {
    const r = await runImport(sb, bytes, mode, url.searchParams.get('fp'), todayISO())
    return Response.json(r.body, { status: r.status })
  } catch (e) {
    // it may have stopped part-way: importing again is safe (it skips whatever is already saved)
    console.error('[tracker] import:', e instanceof Error ? e.message : e)
    return fail(`Something went wrong while importing. Open the tracker to see what’s there, then import again — it skips anything already saved.`, 500)
  }
}
