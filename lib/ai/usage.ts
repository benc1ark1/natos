// The AI usage meter: one row per AI call in ai_usage (as Nat, under row level security),
// today's and this month's spend, and the bot's daily cap (profiles.ai_daily_cap_usd).
import type { SupabaseClient } from '@supabase/supabase-js'
import { todayISO, zonedToUTC } from '../time'
import { costOf, type Usage } from './models'

export const DEFAULT_CAP_USD = 1.5

export type Feature = 'chat' | 'sort' | 'ask' | 'plan' | 'mail'

/** Log one AI call. Never throws: a meter problem must not break the feature that used the AI. */
export async function recordUsage(sb: SupabaseClient, feature: Feature, model: string, u: Usage | null | undefined): Promise<number> {
  const usage = u ?? {}
  const cost = costOf(model, usage)
  try {
    await sb.from('ai_usage').insert({
      feature, model,
      input_tokens: usage.input_tokens ?? 0, output_tokens: usage.output_tokens ?? 0,
      cache_read_tokens: usage.cache_read_input_tokens ?? 0, cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
      cost_usd: Math.round(cost * 1e6) / 1e6,
    })
  } catch {}
  return cost
}

type Row = { feature: string; model: string; cost_usd: number | string; created_at: string }

async function rowsSince(sb: SupabaseClient, since: string): Promise<Row[]> {
  const out: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('ai_usage').select('feature,model,cost_usd,created_at')
      .gte('created_at', since).order('id').range(from, from + 999)
    if (error) throw new Error(`Couldn't read AI usage: ${error.message}`)
    out.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) return out
  }
}

const sum = (rs: Row[]) => rs.reduce((a, r) => a + Number(r.cost_usd || 0), 0)

/** The bot's daily cap in US dollars (the default until it has been set). */
export async function dailyCap(sb: SupabaseClient): Promise<number> {
  const { data } = await sb.from('profiles').select('ai_daily_cap_usd').maybeSingle()
  const raw = data?.ai_daily_cap_usd
  return raw === null || raw === undefined || Number.isNaN(Number(raw)) ? DEFAULT_CAP_USD : Number(raw)
}

/** Today's spend (London day) against the cap. */
export async function budget(sb: SupabaseClient): Promise<{ spent: number; cap: number; over: boolean }> {
  const [spent, cap] = await Promise.all([rowsSince(sb, zonedToUTC(todayISO(), '00:00')).then(sum), dailyCap(sb)])
  return { spent, cap, over: spent >= cap }
}

/** For /usage: today and this month, by job. */
export async function usageReport(sb: SupabaseClient) {
  const today = todayISO()
  const month = await rowsSince(sb, zonedToUTC(`${today.slice(0, 8)}01`, '00:00'))
  const dayStart = Date.parse(zonedToUTC(today, '00:00'))
  const todays = month.filter((r) => Date.parse(r.created_at) >= dayStart)
  const byFeature = (rs: Row[]) => {
    const m = new Map<string, { calls: number; cost: number }>()
    for (const r of rs) {
      const f = m.get(r.feature) ?? { calls: 0, cost: 0 }
      f.calls++
      f.cost += Number(r.cost_usd || 0)
      m.set(r.feature, f)
    }
    return m
  }
  const cap = await dailyCap(sb)
  return { today: sum(todays), month: sum(month), todayCalls: todays.length, monthCalls: month.length, byFeature: byFeature(todays), cap }
}
