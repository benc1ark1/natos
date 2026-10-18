// Server-only: Whoop sync (BUILD-GUIDE step 11, my-spec 25/31), as Nat: by the tick every 30 minutes, after he
// connects, and on "Sync now". Read-only from Whoop:
// - one row a day (whoop_days): recovery %, HRV, resting heart rate, last night's sleep, the day's strain; the day is
//   the morning he woke up (London);
// - workouts (whoop_workouts); one whose activity he said counts toward a weekly target is logged toward it once.
// Whoop changes the refresh token on every refresh, so the new one is saved at once; if two runs refresh together the
// second one's old token fails, and it takes the token the first one saved instead of giving up.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserId } from '../data'
import { loadConnection, saveTokens, tokensOf, updateConnection, type Connection } from '../integrations/store'
import { moreSettings } from '../settings'
import { addDays, dateISOOf, todayISO } from '../time'
import { refreshWhoop, Whoop, WhoopReconnectError, type WCycle, type WRecovery, type WSleep, type WWorkout } from './api'

const EVERY_MIN = 30
const FIRST_DAYS = 14, LATER_DAYS = 3

export type WhoopDay = { on_date: string; recovery: number | null; hrv: number | null; resting_hr: number | null; sleep_minutes: number | null; sleep_performance: number | null; strain: number | null }
export type WhoopResult = { ok: boolean; error?: string; reconnect?: boolean; days: number; workouts: number; logged: { target: string; sport: string; date: string }[] }

/** A signed-in Whoop API for Nat; null if not connected. */
export async function whoopSession(sb: SupabaseClient): Promise<{ conn: Connection; api: Whoop } | null> {
  const conn = await loadConnection(sb, 'whoop')
  if (!conn || conn.status !== 'connected') return null
  const t = tokensOf(conn)
  if (!t) return null
  if (t.expires_at > Date.now() + 120_000) return { conn, api: new Whoop(t.access_token) }
  try {
    const fresh = await refreshWhoop(t.refresh_token)
    await saveTokens(sb, conn, { access_token: fresh.access_token, refresh_token: fresh.refresh_token, expires_at: fresh.expires_at })
    return { conn, api: new Whoop(fresh.access_token) }
  } catch (e) {
    if (!(e instanceof WhoopReconnectError)) throw e
    // another run may have just refreshed (Whoop then refuses the old token): use the one it saved
    const again = await loadConnection(sb, 'whoop')
    const t2 = again ? tokensOf(again) : null
    if (again && t2 && t2.refresh_token !== t.refresh_token && t2.expires_at > Date.now() + 60_000) return { conn: again, api: new Whoop(t2.access_token) }
    await updateConnection(sb, conn, { status: 'needs_reconnect', last_error: e.message })
    throw e
  }
}

/** One sync. Never throws: problems are returned and saved on the connection (shown in Settings). */
export async function syncWhoop(sb: SupabaseClient, opts: { force?: boolean; now?: Date } = {}): Promise<WhoopResult | null> {
  const out: WhoopResult = { ok: true, days: 0, workouts: 0, logged: [] }
  let conn: Connection | null = null
  try {
    const now = opts.now ?? new Date()
    const peek = await loadConnection(sb, 'whoop')
    if (!peek || peek.status !== 'connected') return null
    const last = (peek.settings as { synced_at?: string }).synced_at
    if (!opts.force && last && now.getTime() - Date.parse(last) < EVERY_MIN * 60_000) return null   // not due yet
    const s = await whoopSession(sb)
    if (!s) return null
    conn = s.conn
    const userId = await getUserId(sb)
    const today = todayISO()
    const start = new Date(`${addDays(today, -(last ? LATER_DAYS : FIRST_DAYS))}T00:00:00Z`).toISOString()

    const [recoveries, sleeps, cycles, workouts] = await Promise.all([
      s.api.list<WRecovery>('recovery', start), s.api.list<WSleep>('activity/sleep', start),
      s.api.list<WCycle>('cycle', start), s.api.list<WWorkout>('activity/workout', start),
    ])

    // ---- days: keyed by the morning he woke up
    const nights = sleeps.filter((x) => !x.nap)
    const sleepById = new Map(nights.map((x) => [x.id, x]))
    const cycleById = new Map(cycles.map((c) => [c.id, c]))
    const days = new Map<string, WhoopDay>()
    const dayOf = (d: string) => { let r = days.get(d); if (!r) { r = { on_date: d, recovery: null, hrv: null, resting_hr: null, sleep_minutes: null, sleep_performance: null, strain: null }; days.set(d, r) } return r }
    for (const n of nights) {
      if (n.score_state !== 'SCORED' || !n.score) continue
      const r = dayOf(dateISOOf(n.end))
      const st = n.score.stage_summary
      if (st?.total_in_bed_time_milli != null) r.sleep_minutes = Math.round((st.total_in_bed_time_milli - (st.total_awake_time_milli ?? 0)) / 60_000)
      if (n.score.sleep_performance_percentage != null) r.sleep_performance = Math.round(n.score.sleep_performance_percentage)
    }
    for (const rec of recoveries) {
      const night = sleepById.get(rec.sleep_id)
      const r = dayOf(dateISOOf(night?.end ?? rec.created_at))
      if (rec.score_state === 'SCORED' && rec.score && !rec.score.user_calibrating) {
        if (rec.score.recovery_score != null) r.recovery = Math.round(rec.score.recovery_score)
        if (rec.score.hrv_rmssd_milli != null) r.hrv = Math.round(rec.score.hrv_rmssd_milli * 10) / 10
        if (rec.score.resting_heart_rate != null) r.resting_hr = Math.round(rec.score.resting_heart_rate)
      }
      const c = cycleById.get(rec.cycle_id)
      if (c?.score?.strain != null) r.strain = Math.round(c.score.strain * 10) / 10
    }
    if (days.size) {
      const { error } = await sb.from('whoop_days').upsert([...days.values()].map((d) => ({ ...d, user_id: userId })), { onConflict: 'user_id,on_date' })
      if (error) throw new Error(`Couldn’t save the Whoop days: ${error.message}`)
    }
    out.days = days.size

    // ---- workouts, and the ones that count toward a target (his choice of activities per target)
    if (workouts.length) {
      const { error } = await sb.from('whoop_workouts').upsert(workouts.map((w) => ({
        user_id: userId, whoop_id: w.id, sport: w.sport_name ?? null, starts_at: w.start, ends_at: w.end ?? null,
        strain: w.score?.strain != null ? Math.round(w.score.strain * 10) / 10 : null,
      })), { onConflict: 'user_id,whoop_id' })
      if (error) throw new Error(`Couldn’t save the Whoop workouts: ${error.message}`)
    }
    out.workouts = workouts.length
    out.logged = await countWorkouts(sb, workouts, userId)

    await updateConnection(sb, conn, { settings: { ...conn.settings, synced_at: now.toISOString() }, last_sync_at: now.toISOString(), last_error: null })
    return out
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Whoop sync failed.'
    if (conn) await updateConnection(sb, conn, { last_error: msg.slice(0, 300) }).catch(() => null)
    if (conn && e instanceof WhoopReconnectError && conn.status === 'connected') {
      try { const t = tokensOf(conn); if (t) await saveTokens(sb, conn, { ...t, expires_at: 0 }) } catch {}
    }
    return { ...out, ok: false, error: msg, reconnect: e instanceof WhoopReconnectError && conn?.status !== 'connected' }
  }
}

/** Log each workout toward the target whose Whoop activities include it, once (target_logs source 'whoop'). */
async function countWorkouts(sb: SupabaseClient, workouts: WWorkout[], userId: string) {
  const { data: targets } = await sb.from('weekly_targets').select('id,name,whoop_sports').eq('is_active', true)
  const wanted = (targets ?? []).filter((t) => (t.whoop_sports ?? []).length)
  if (!wanted.length || !workouts.length) return []
  const { data: have } = await sb.from('target_logs').select('external_id').eq('source', 'whoop').in('external_id', workouts.map((w) => w.id))
  const done = new Set((have ?? []).map((l) => l.external_id))
  const logged: { target: string; sport: string; date: string }[] = []
  for (const w of workouts) {
    if (done.has(w.id) || !w.sport_name) continue
    const t = wanted.find((x) => (x.whoop_sports as string[]).some((s) => s.toLowerCase() === w.sport_name!.toLowerCase()))
    if (!t) continue
    const date = dateISOOf(w.start)
    const { error } = await sb.from('target_logs').insert({ user_id: userId, target_id: t.id, done_on: date, amount: 1, source: 'whoop', external_id: w.id, note: w.sport_name })
    if (error && !/duplicate/i.test(error.message)) throw new Error(`Couldn’t log a Whoop workout: ${error.message}`)
    if (!error) logged.push({ target: t.name as string, sport: w.sport_name, date })
  }
  return logged
}

/** His Whoop day (today unless asked), or null. */
export async function whoopDay(sb: SupabaseClient, date = todayISO()): Promise<WhoopDay | null> {
  const { data, error } = await sb.from('whoop_days').select('on_date,recovery,hrv,resting_hr,sleep_minutes,sleep_performance,strain').eq('on_date', date).maybeSingle()
  return error ? null : (data as WhoopDay | null)
}

/** Low recovery (below his setting, 33% unless he changes it): plan a lighter day and protect sleep. */
export const isLowRecovery = (d: Pick<WhoopDay, 'recovery'> | null, planning: unknown) => d?.recovery != null && d.recovery < moreSettings(planning).lowRecovery

/** "62% recovery · 7h 40m sleep · strain 11.2" */
export function whoopWords(d: WhoopDay): string {
  const sleep = d.sleep_minutes != null ? `${Math.floor(d.sleep_minutes / 60)}h ${String(d.sleep_minutes % 60).padStart(2, '0')}m sleep` : ''
  return [d.recovery != null ? `${d.recovery}% recovery` : '', d.hrv != null ? `HRV ${d.hrv}` : '', sleep, d.strain != null ? `strain ${d.strain}` : ''].filter(Boolean).join(' · ')
}
