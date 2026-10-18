import type { SupabaseClient } from '@supabase/supabase-js'
import type { Guide } from './types'
import { rows } from './data'

// Guides: reference pages (skincare, sleep, supplements...). Archived, never deleted.

export const GUIDE_COLS = 'id,title,icon,body,sort_order,import_key,archived_at,updated_at,category_id,has_log'

/** All guides (open and archived), in their order. */
export async function loadGuides(sb: SupabaseClient): Promise<Guide[]> {
  const res = await sb.from('guides').select(GUIDE_COLS).order('sort_order').order('title')
  return rows<Guide>(res, 'guides')
}

export async function saveGuide(sb: SupabaseClient, values: Pick<Guide, 'title' | 'icon' | 'body'> & Partial<Pick<Guide, 'category_id' | 'has_log'>>, id?: string): Promise<{ guide?: Guide; error?: string }> {
  const clean = {
    title: values.title.trim(), icon: values.icon?.trim() || null, body: values.body.trim(),
    ...(values.category_id !== undefined ? { category_id: values.category_id } : {}), ...(values.has_log !== undefined ? { has_log: values.has_log } : {}),
  }
  if (!clean.title) return { error: 'Give the guide a title.' }
  const q = id
    ? sb.from('guides').update({ ...clean, updated_at: new Date().toISOString() }).eq('id', id).select(GUIDE_COLS).single()
    : sb.from('guides').insert({ ...clean, sort_order: 1000 }).select(GUIDE_COLS).single()
  const { data, error } = await q
  if (error || !data) return { error: `Not saved: ${error?.message ?? 'unknown error'}` }
  return { guide: data as Guide }
}

export async function setGuideArchived(sb: SupabaseClient, g: Pick<Guide, 'id' | 'title'>, archived: boolean): Promise<string | null> {
  const { data, error } = await sb.from('guides')
    .update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', g.id).select('id').single()
  return error || !data ? `Couldn't ${archived ? 'archive' : 'restore'} “${g.title}”: ${error?.message ?? 'not saved'}` : null
}

/** Which area a guide is in: his choice, else a guess from its title (gym/sport → Athletic, study → Study, else Personal). */
export function guideArea(g: Pick<Guide, 'title' | 'category_id'>, categories: { id: string; name: string }[]): { id: string | null; name: string; guessed: boolean } {
  const set = g.category_id ? categories.find((c) => c.id === g.category_id) : undefined
  if (set) return { id: set.id, name: set.name, guessed: false }
  const t = g.title.toLowerCase()
  const name = /gym|athletic|lower|training|sport|football|height|posture|run|sprint|stretch|mobility/.test(t) ? 'Athletic'
    : /study|revision|exam|maths|physics|school|homework|learn/.test(t) ? 'Study' : 'Personal'
  const c = categories.find((x) => x.name.toLowerCase() === name.toLowerCase())
  return { id: c?.id ?? null, name: c?.name ?? name, guessed: true }
}

// ---- the weekly log of a guide that changes often (Athletic & Lower): dated entries under its fixed rules

export type GuideLog = { id: string; guide_id: string; week_start: string; body: string; archived_at: string | null; created_at: string }

export async function loadGuideLogs(sb: SupabaseClient, guideId: string): Promise<GuideLog[]> {
  const res = await sb.from('guide_logs').select('id,guide_id,week_start,body,archived_at,created_at').eq('guide_id', guideId).is('archived_at', null).order('week_start', { ascending: false }).order('created_at')
  return rows<GuideLog>(res, 'guide log')
}

export async function addGuideLog(sb: SupabaseClient, guideId: string, weekStart: string, body: string): Promise<{ id?: string; error?: string }> {
  const text = body.trim().slice(0, 4000)
  if (!text) return { error: 'Write something for the log.' }
  const { data, error } = await sb.from('guide_logs').insert({ guide_id: guideId, week_start: weekStart, body: text }).select('id').single()
  return error || !data ? { error: `Not saved: ${error?.message ?? 'unknown error'}` } : { id: data.id }
}

export async function setGuideLogArchived(sb: SupabaseClient, id: string, archived: boolean): Promise<string | null> {
  const { error } = await sb.from('guide_logs').update({ archived_at: archived ? new Date().toISOString() : null }).eq('id', id).select('id').single()
  return error ? `Not saved: ${error.message}` : null
}
