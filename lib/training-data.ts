// Training rules and session types, as stored (as Nat, under row level security). No rows = the defaults in
// lib/training.ts. Shared by the bot and (later) the dashboard.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CostRow } from './load'
import { DEFAULT_RULES, DEFAULT_TYPES, defaultLoad, guessType, isTrainingType, NOT_TRAINING, type Load, type Rule, type TrainingType, type TypeDef } from './training'

type RuleRow = { id: string; kind: Rule['kind']; params: Record<string, unknown>; label: string; enabled: boolean; sort_order: number }

// a rule keeps the type keys it was written with, even if he later archives or renames a type
const types = (v: unknown): TrainingType[] => (Array.isArray(v) ? v.filter((x): x is TrainingType => typeof x === 'string' && /^[a-z][a-z0-9_]{0,24}$/.test(x)) : [])

const strengthOf = (p: Record<string, unknown>): { strength?: 'prefer' } => (p.strength === 'prefer' ? { strength: 'prefer' } : {})

export function ruleFromRow(r: RuleRow): Rule | null {
  const p = r.params ?? {}
  if (r.kind === 'gap') {
    const side = ['before', 'after', 'both'].includes(p.side as string) ? (p.side as 'before' | 'after' | 'both') : 'before'
    const days = Number.isInteger(p.days) && (p.days as number) >= 0 && (p.days as number) <= 3 ? (p.days as number) : 1
    const what = types(p.what), near = types(p.near)
    const minLoad = p.minLoad === 'light' || p.minLoad === 'moderate' || p.minLoad === 'hard' ? p.minLoad : undefined
    const hours = Number.isInteger(p.hours) && (p.hours as number) >= 1 && (p.hours as number) <= 168 ? (p.hours as number) : undefined
    return what.length && near.length ? { id: r.id, kind: 'gap', what, near, side, days, label: r.label, enabled: r.enabled, ...(minLoad ? { minLoad } : {}), ...(hours ? { hours } : {}), ...strengthOf(p) } : null
  }
  if (r.kind === 'max_hard') {
    const n = Number.isInteger(p.n) && (p.n as number) >= 1 && (p.n as number) <= 3 ? (p.n as number) : 1
    const pairs = Array.isArray(p.pairs) ? (p.pairs as unknown[]).map((x) => types(x)).filter((x) => x.length === 2) as [TrainingType, TrainingType][] : []
    return { id: r.id, kind: 'max_hard', n, pairs, label: r.label, enabled: r.enabled, ...strengthOf(p) }
  }
  return { id: r.id, kind: 'after_double', label: r.label, enabled: r.enabled, ...strengthOf(p) }
}

export const ruleToRow = (r: Rule, i: number) => ({
  kind: r.kind, label: r.label, enabled: r.enabled, sort_order: i,
  params: {
    ...(r.kind === 'gap' ? { what: r.what, near: r.near, side: r.side, days: r.days, ...(r.minLoad ? { minLoad: r.minLoad } : {}), ...(r.hours ? { hours: r.hours } : {}) } : r.kind === 'max_hard' ? { n: r.n, pairs: r.pairs } : {}),
    ...(r.strength === 'prefer' ? { strength: 'prefer' } : {}),
  },
})

/** His rules, or the defaults if he has never changed one. Never throws (before jarvis-d2.sql runs: the defaults). */
export async function loadRules(sb: SupabaseClient): Promise<{ rules: Rule[]; saved: boolean }> {
  const { data, error } = await sb.from('training_rules').select('*').order('sort_order')
  if (error || !data?.length) return { rules: DEFAULT_RULES, saved: false }
  return { rules: (data as RuleRow[]).map(ruleFromRow).filter((r): r is Rule => !!r), saved: true }
}

/** The first time he changes a rule, the defaults are written down so each can be edited. Returns the saved rules. */
export async function saveDefaultRules(sb: SupabaseClient): Promise<Rule[]> {
  const { data, error } = await sb.from('training_rules').insert(DEFAULT_RULES.map(ruleToRow)).select('*')
  if (error || !data) throw new Error(`Couldn’t save the training rules: ${error?.message ?? 'not saved'}`)
  return (data as RuleRow[]).sort((a, b) => a.sort_order - b.sort_order).map(ruleFromRow).filter((r): r is Rule => !!r)
}

/** A session's training type and load: as set, else guessed from its name (until he answers), else not training. */
export function typeOf(x: { title?: string; name?: string; training_type?: string | null; load?: string | null }, list: TypeDef[] = DEFAULT_TYPES): { type: TrainingType; load: Load } | null {
  if (x.training_type === NOT_TRAINING) return null   // he said it isn't training
  const set = isTrainingType(x.training_type, list) ? x.training_type! : null
  const guess = guessType(x.title ?? x.name ?? '', list)
  const type = set ?? guess?.type ?? null
  if (!type) return null
  return { type, load: x.load === 'hard' || x.load === 'light' || x.load === 'moderate' ? x.load : set ? defaultLoad(set, list) : guess?.load ?? 'hard' }
}

/** Switch one rule (by its place in the list) on or off; the defaults are written down first if need be. */
export async function setRuleEnabled(sb: SupabaseClient, idx: number, enabled: boolean): Promise<string | null> {
  try {
    const { rules, saved } = await loadRules(sb)
    const list = saved ? rules : await saveDefaultRules(sb)
    const id = list[idx]?.id
    if (!id) return 'Couldn’t find that rule.'
    const { error } = await sb.from('training_rules').update({ enabled }).eq('id', id).select('id').single()
    return error ? `Not saved: ${error.message}` : null
  } catch (e) {
    return e instanceof Error ? e.message : 'Not saved.'
  }
}

/** His recovery costs (load_costs, not archived). None, or before build-n.sql runs: the defaults in lib/load.ts. */
export async function loadCosts(sb: SupabaseClient): Promise<CostRow[]> {
  // the 🧠 column comes with build-o.sql: read it when it's there
  const withMental = await sb.from('load_costs').select('id,scope,type_key,title,weekday,legs,upper,cns,mental').is('archived_at', null).order('created_at')
  if (!withMental.error) return (withMental.data ?? []) as CostRow[]
  const { data, error } = await sb.from('load_costs').select('id,scope,type_key,title,weekday,legs,upper,cns').is('archived_at', null).order('created_at')
  return error ? [] : (data ?? []) as CostRow[]
}
