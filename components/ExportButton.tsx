'use client'
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { downloadJSON, exportAll } from '@/lib/export'
import { todayISO } from '@/lib/time'
import type { ShowToast } from './ui'

/** One-click backup: downloads every table as JSON. Says how many records, and names any table that failed. */
export default function ExportButton({ toast }: { toast: ShowToast }) {
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    try {
      const res = await exportAll(getSupabase())
      if (res.total === 0 && res.failed.length > 0) {
        toast({ kind: 'error', text: `Export failed: ${res.failed.map((f) => `${f.table} (${f.error})`).join(', ')}` })
        return
      }
      downloadJSON(`nat-os-backup-${todayISO()}.json`, res.file)
      const n = Object.keys(res.file.counts).length
      toast(res.failed.length
        ? { kind: 'error', text: `Downloaded ${res.total} records from ${n} tables, but these failed: ${res.failed.map((f) => `${f.table} (${f.error})`).join(', ')}` }
        : { kind: 'ok', text: `Downloaded ${res.total} records from ${n} tables (counts checked). Save it somewhere safe, e.g. Google Drive.` })
    } catch (e) {
      toast({ kind: 'error', text: `Export failed: ${e instanceof Error ? e.message : 'unknown error'}` })
    } finally {
      setBusy(false)
    }
  }

  return <button className="signout" onClick={run} disabled={busy}>{busy ? 'Exporting…' : <>Export<span className="wide"> my data</span></>}</button>
}
