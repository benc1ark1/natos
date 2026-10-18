'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

export function CheckIcon() {
  return <svg className="ic" viewBox="0 0 24 24" width="14" height="14" style={{ strokeWidth: 3 }} aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
}
export function PlusIcon({ size = 20 }: { size?: number }) {
  return <svg className="ic" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
}
export function ArrowIcon() {
  return <svg className="ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
}
export function StarIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z" />
    </svg>
  )
}

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div role="status" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skel" style={{ width: `${90 - i * 15}%` }} />)}
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="err" role="alert">
      <span>{message}</span>
      {onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}
    </div>
  )
}

export type ToastInput = { text: string; kind: 'ok' | 'error'; action?: { label: string; run: () => void } }
export type ShowToast = (t: ToastInput) => void
type ToastState = ToastInput | null

/** Small toast for confirmations (only shown after the database confirms) and errors. */
export function useToast() {
  const [toast, setToast] = useState<ToastState>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((t: NonNullable<ToastState>) => {
    setToast(t)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), t.kind === 'error' ? 8000 : 5000)
  }, [])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const node = toast ? (
    <div className={`toast ${toast.kind === 'error' ? 'error' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      <span>{toast.text}</span>
      {toast.action && (
        <button className="btn sm" onClick={() => { toast.action!.run(); setToast(null) }}>{toast.action.label}</button>
      )}
      <button className="btn sm ghost" aria-label="Dismiss" onClick={() => setToast(null)}>✕</button>
    </div>
  ) : null
  return { show, node }
}

/** Standard load state for a page: loading → ready, or error with retry. */
export function useLoad<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setData(await loaderRef.current())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong while loading.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload }
}
