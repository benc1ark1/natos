'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="err" role="alert" style={{ marginTop: 24 }}>
      <span>Something broke on this page: {error.message}</span>
      <button className="btn sm" onClick={reset}>Try again</button>
    </div>
  )
}
