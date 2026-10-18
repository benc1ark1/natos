'use client'
import { useEffect, useState } from 'react'

/** Current time, refreshed every 30s. Null until mounted to avoid server/browser mismatch. */
export function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}
