import type { SupabaseClient } from '@supabase/supabase-js'
import type { Project } from './types'
import { rows } from './data'

const PROJECT_COLS = 'id,name,category_id,notes,sort_order,archived_at,created_at'

/** Projects not archived, in their order. */
export async function loadProjects(sb: SupabaseClient): Promise<Project[]> {
  const res = await sb.from('projects').select(PROJECT_COLS).is('archived_at', null).order('sort_order').order('name')
  return rows<Project>(res, 'projects')
}

export async function saveProject(sb: SupabaseClient, values: Pick<Project, 'name' | 'category_id' | 'notes'>, id?: string): Promise<{ project?: Project; error?: string }> {
  const q = id
    ? sb.from('projects').update(values).eq('id', id).select(PROJECT_COLS).single()
    : sb.from('projects').insert(values).select(PROJECT_COLS).single()
  const { data, error } = await q
  if (error?.code === '23505') return { error: `You already have a project called “${values.name}”.` }
  if (error || !data) return { error: `Not saved: ${error?.message ?? 'unknown error'}` }
  return { project: data as Project }
}

/** Archive (never delete); its tasks keep their link and stay open. */
export async function setProjectArchived(sb: SupabaseClient, p: Project, archived: boolean): Promise<string | null> {
  const { data, error } = await sb.from('projects')
    .update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', p.id).select('id').single()
  return error || !data ? `Couldn't ${archived ? 'archive' : 'restore'} “${p.name}”: ${error?.message ?? 'not saved'}` : null
}

/** Only normal web links can be saved as a hand-in link. Returns the cleaned link, '' for none, or null if invalid. */
export function cleanUrl(s: string): string | null {
  const v = s.trim()
  if (!v) return ''
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`
  try { const u = new URL(withScheme); return u.hostname.includes('.') ? u.toString() : null } catch { return null }
}
