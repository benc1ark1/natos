import { GUIDES, LEFT_OUT_NOTE, ROUTINES, SKIPPED_PAGES } from '@/lib/import/notion-life-mastery'
import { getServerSupabase } from '@/lib/supabase/server'

// Notion import. GET = preview (what would be added); POST = import, all or nothing.
// The guide content stays on the server until it is saved to your database.

async function signedIn() {
  const sb = await getServerSupabase()
  const { data: { user } } = await sb.auth.getUser()
  return user ? sb : null
}

export async function GET() {
  const sb = await signedIn()
  if (!sb) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const [g, h] = await Promise.all([
    sb.from('guides').select('import_key').not('import_key', 'is', null),
    sb.from('habits').select('name,import_key,is_active'),
  ])
  if (g.error || h.error) return Response.json({ error: (g.error ?? h.error)!.message }, { status: 500 })
  const haveGuides = new Set(g.data.map((r) => r.import_key))
  const haveRoutines = new Set(h.data.map((r) => r.import_key).filter(Boolean))
  return Response.json({
    guides: GUIDES.map((x) => ({ key: x.key, title: x.title, icon: x.icon, done: haveGuides.has(x.key) })),
    routines: ROUTINES.map((r) => ({
      key: r.key, name: r.name, blocks: r.blocks.length, done: haveRoutines.has(r.key),
      replaces: h.data.some((o) => o.is_active && !o.import_key && o.name.toLowerCase() === r.name.toLowerCase()),
    })),
    skipped: SKIPPED_PAGES,
    note: LEFT_OUT_NOTE,
  })
}

export async function POST() {
  const sb = await signedIn()
  if (!sb) return Response.json({ error: 'Not signed in' }, { status: 401 })
  const { data, error } = await sb.rpc('import_guides_routines', { payload: { guides: GUIDES, routines: ROUTINES } })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
