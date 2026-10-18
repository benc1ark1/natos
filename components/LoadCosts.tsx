'use client'
// Settings → Training load: each training type's recovery cost at heavy (legs, upper body, CNS: 0–10; light and
// moderate are a % of it), and his own costs for single sessions ("Wednesday training is high CNS"). A change archives
// the old row and adds a new one (never deleted), with Undo. The bot can change these too (“games are max load”).
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { DEFAULT_COSTS, typeCost, type Cost, type CostRow } from '@/lib/load'
import { activeTypes, type TypeDef } from '@/lib/training'
import { ErrorBox, Loading, useLoad, type ShowToast } from './ui'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

async function load(): Promise<{ rows: CostRow[]; ready: boolean }> {
  const { data, error } = await getSupabase().from('load_costs').select('id,scope,type_key,title,weekday,legs,upper,cns').is('archived_at', null).order('created_at')
  if (error) return { rows: [], ready: false }   // before supabase/build-n.sql runs: the defaults, read-only
  return { rows: (data ?? []) as CostRow[], ready: true }
}

export default function LoadCosts({ types, toast }: { types: TypeDef[]; toast: ShowToast }) {
  const { data, error, loading, reload } = useLoad(load)
  const [busy, setBusy] = useState(false)
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (loading && !data) return <Loading lines={3} />
  const { rows, ready } = data!

  /** Archive one row (and add its replacement); Undo puts the old one back. */
  async function replace(old: CostRow | null, next: Omit<CostRow, 'id'> | null, words: string) {
    setBusy(true)
    const sb = getSupabase()
    const now = new Date().toISOString()
    let added: string | null = null
    if (old?.id) {
      const { error: e } = await sb.from('load_costs').update({ archived_at: now }).eq('id', old.id).select('id').single()
      if (e) { setBusy(false); toast({ kind: 'error', text: `Not saved: ${e.message}` }); return }
    }
    if (next) {
      const { data: row, error: e } = await sb.from('load_costs').insert(next).select('id').single()
      if (e || !row) {
        if (old?.id) await sb.from('load_costs').update({ archived_at: null }).eq('id', old.id)
        setBusy(false); toast({ kind: 'error', text: `Not saved: ${e?.message ?? 'unknown error'}` }); return
      }
      added = row.id as string
    }
    setBusy(false)
    await reload()
    toast({ kind: 'ok', text: words, action: { label: 'Undo', run: async () => {
      if (added) await sb.from('load_costs').update({ archived_at: new Date().toISOString() }).eq('id', added)
      if (old?.id) await sb.from('load_costs').update({ archived_at: null }).eq('id', old.id)
      await reload()
    } } })
  }

  return (
    <div className="setlist">
      <div className="ch" style={{ marginTop: 18 }}><span className="lbl">Cost of a heavy session, 0 to 10</span></div>
      <p className="usub" style={{ margin: '0 0 8px' }}>
        The week planner adds these up per day and over any 7 days. Light and moderate sessions cost the % set above.
        {!ready && ' Run supabase/build-n.sql to change them (the defaults are used until then).'}
      </p>
      <div className="loadgrid" role="table" aria-label="Recovery cost per training type">
        <div className="loadrow loadhead" role="row"><span role="columnheader">Type</span><span role="columnheader">Legs</span><span role="columnheader">Upper</span><span role="columnheader">CNS</span><span /></div>
        {activeTypes(types).map((t) => {
          const mine = rows.find((r) => r.scope === 'type' && r.type_key === t.key) ?? null
          return <TypeRow key={`${t.key}:${mine?.id ?? 'd'}`} label={t.label} cost={typeCost(t.key, rows)} custom={!!mine} disabled={busy || !ready}
            onSave={(c) => replace(mine, { scope: 'type', type_key: t.key, title: null, weekday: null, ...c }, `${t.label}: legs ${c.legs} · upper ${c.upper} · CNS ${c.cns}.`)}
            onReset={mine ? () => replace(mine, null, `${t.label}: back to the default (${words(DEFAULT_COSTS[t.key] ?? { legs: 4, upper: 4, cns: 4 })}).`) : undefined} />
        })}
      </div>

      <div className="ch" style={{ marginTop: 18 }}><span className="lbl">Single sessions</span></div>
      {rows.filter((r) => r.scope === 'session').length === 0
        ? <p className="usub" style={{ margin: '0 0 8px' }}>None. Tell the bot “Wednesday training is high CNS” to give one session its own cost.</p>
        : rows.filter((r) => r.scope === 'session').map((r) => (
          <div key={r.id} className="setrow" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
            <span>{r.title}{r.weekday ? ` (${DAYS[r.weekday - 1]})` : ''}: {words(r)}</span>
            <button type="button" className="btn ghost" disabled={busy} onClick={() => replace(r, null, `${r.title}: back to its type’s cost.`)}>Remove</button>
          </div>
        ))}
    </div>
  )
}

const words = (c: Cost) => `legs ${c.legs} · upper ${c.upper} · CNS ${c.cns}`

function TypeRow({ label, cost, custom, disabled, onSave, onReset }: { label: string; cost: Cost; custom: boolean; disabled: boolean; onSave: (c: Cost) => void; onReset?: () => void }) {
  const [c, setC] = useState(cost)
  const changed = c.legs !== cost.legs || c.upper !== cost.upper || c.cns !== cost.cns
  const num = (k: keyof Cost) => (
    <input className="input loadnum" type="number" inputMode="numeric" min={0} max={10} value={c[k]} disabled={disabled} aria-label={`${label} ${k}`}
      onChange={(e) => setC({ ...c, [k]: Math.max(0, Math.min(10, Math.round(Number(e.target.value) || 0))) })} />
  )
  return (
    <div className="loadrow" role="row">
      <span role="cell">{label}{custom && <i className="usub"> (yours)</i>}</span>
      <span role="cell">{num('legs')}</span><span role="cell">{num('upper')}</span><span role="cell">{num('cns')}</span>
      <span role="cell">
        {changed ? <button type="button" className="btn primary sm" disabled={disabled} onClick={() => onSave(c)}>Save</button>
          : onReset ? <button type="button" className="btn ghost sm" disabled={disabled} onClick={onReset}>Default</button> : null}
      </span>
    </div>
  )
}
