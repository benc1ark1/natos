// Server-only: what the Gmail scripts post to (app/api/mail/incoming). Checked before anything runs: the shared secret
// (MAIL_SECRET, in Vercel and in each script), a size limit, and the shape of every email (lib/mail/rules.ts).
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bearer, secretMatches } from '../telegram/guard'
import { openOwnerSession } from '../telegram/owner-session'
import { readIncoming } from './rules'
import { homeworkFrom, ingest } from './watcher'

/** The senders whose emails the script sends with their text (his homework senders and his school's domain). */
async function bodyFrom(sb: SupabaseClient): Promise<string[]> {
  const planning = await sb.from('profiles').select('planning').maybeSingle().then((r) => r.data?.planning ?? null)
  const f = await homeworkFrom(sb, planning)
  return [...f.listed, ...(f.school ? [`@${f.school}`] : [])].slice(0, 50)
}

const MAX_BYTES = 200_000

/** Returns the reply for the script and, when new mail was stored, the session to sort it with. */
export async function receiveMail(auth: string | null, raw: string): Promise<{ status: number; json: Record<string, unknown>; sb?: SupabaseClient; added?: number }> {
  if (!secretMatches(bearer(auth), process.env.MAIL_SECRET)) return { status: 401, json: { ok: false, error: 'Wrong or missing key.' } }
  if (raw.length > MAX_BYTES) return { status: 413, json: { ok: false, error: 'Too much at once.' } }
  let body: unknown = null
  try { body = JSON.parse(raw) } catch {}
  const input = readIncoming(body)
  if (!input) return { status: 400, json: { ok: false, error: 'That isn’t a list of emails.' } }
  try {
    const sb = await openOwnerSession()
    const added = await ingest(sb, input)
    return { status: 200, json: { ok: true, added, bodyFrom: await bodyFrom(sb).catch(() => []) }, sb, added }
  } catch (e) {
    return { status: 500, json: { ok: false, error: e instanceof Error ? e.message : 'Couldn’t save the emails.' } }
  }
}
