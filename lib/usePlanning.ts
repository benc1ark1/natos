'use client'
import { useEffect, useState } from 'react'
import { getSupabase } from './supabase/client'

// His settings (profiles.planning: times, lists like task sources and training types), read once per page load and
// shared by every form that needs them. The Settings page calls setPlanningCache after each save.

let cached: Promise<unknown> | null = null
const listeners = new Set<(p: unknown) => void>()

export function loadPlanningOnce(): Promise<unknown> {
  cached ??= Promise.resolve(getSupabase().from('profiles').select('planning').maybeSingle())
    .then((r) => (r.error ? null : r.data?.planning ?? null))
    .catch(() => null)
  return cached
}

/** After a save: every open form sees the new settings. */
export function setPlanningCache(planning: unknown) {
  cached = Promise.resolve(planning)
  listeners.forEach((f) => f(planning))
}

/** His settings, or null while loading (callers fall back to the defaults, which is what null means anyway). */
export function usePlanning(): unknown {
  const [planning, setPlanning] = useState<unknown>(null)
  useEffect(() => {
    let live = true
    loadPlanningOnce().then((p) => { if (live) setPlanning(p) })
    listeners.add(setPlanning)
    return () => { live = false; listeners.delete(setPlanning) }
  }, [])
  return planning
}
