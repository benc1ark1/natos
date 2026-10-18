'use client'
// Settings: everything that used to be fixed in code and is likely to change (my-spec 28: nothing about his schedule
// is hardcoded). The Telegram bot can change all of it too ("brief at 7:30", "add swimming as a training type").
// Each change saves on its own, confirmed by the database, with Undo.
import { useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { SETTINGS, currentSettings, parseSetting, showSetting, type Group } from '@/lib/settings'
import { savePlanningKey } from '@/lib/settings-data'
import { newKey, taskSources, type Source } from '@/lib/lists'
import { trainingTypes, type TypeDef } from '@/lib/training'
import { loadRules, setRuleEnabled } from '@/lib/training-data'
import { setPlanningCache } from '@/lib/usePlanning'
import { activePlaces, activeSessions, daysWords, owenDays, placeWords, sessionWords } from '@/lib/setup'
import { TIMES_15 } from '@/lib/time'
import Select from './controls/Select'
import Toggle from './controls/Toggle'
import GoogleSettings from './GoogleSettings'
import WhoopSettings from './WhoopSettings'
import MailSettings from './MailSettings'
import LoadCosts from './LoadCosts'
import { ErrorBox, Loading, useLoad, useToast, type ShowToast } from './ui'

const GROUPS: { key: Group; title: string; note?: string }[] = [
  { key: 'you', title: 'About you', note: 'The AI reads this in every answer, so keep it current (school year, subjects, sport).' },
  { key: 'day', title: 'Your day', note: 'Every day is built around your morning and night routines; nothing is planned inside them, and nights are earlier before tests and games. Values you haven’t set are guesses: the bot asks you about them.' },
  { key: 'week', title: 'Week rhythm', note: 'Football days come from your calendar; this week’s game can be changed in the bot (“game is Saturday this week”).' },
  { key: 'planning', title: 'Planning' },
  { key: 'messages', title: 'Telegram messages' },
  { key: 'training', title: 'Training' },
  { key: 'load', title: 'Training load', note: 'How the week planner weighs recovery. Every session costs legs + upper body + CNS (0–10 each at heavy). The bot can change all of this (“games are max load”, “protect 2 days before a game”).' },
  { key: 'mental', title: 'Mental load', note: 'Each day’s 🧠 load: school, tutors, study, tests (and the day before a test), deadlines. No hard training on a high day or a test eve. One session can have its own number (“the SMC mock is max mental”).' },
  { key: 'optimiser', title: 'Optimiser weights', note: 'What each thing costs when the optimiser scores a week. Bigger = avoided more. None of these is a hard rule.' },
  { key: 'study', title: 'Study', note: 'Pipelines, topics and GoodNotes links are on each subject’s page (Subjects).' },
  { key: 'tests', title: 'Tests' },
  { key: 'travel', title: 'Travel' },
]

async function load() {
  const sb = getSupabase()
  const [prof, rules] = await Promise.all([sb.from('profiles').select('planning').maybeSingle(), loadRules(sb)])
  if (prof.error) throw new Error(`Couldn’t read your settings: ${prof.error.message}`)
  return { planning: (prof.data?.planning ?? {}) as Record<string, unknown>, rules: rules.rules }
}

export default function SettingsView() {
  const { data, error, reload } = useLoad(load)
  const toast = useToast()
  if (error) return <div className="rwrap"><ErrorBox message={error} onRetry={reload} /></div>
  if (!data) return <div className="rwrap"><section className="card"><Loading lines={6} /></section></div>

  /** Save one key; the toast offers Undo (back to what it was, or the default). */
  const save = async (key: string, value: unknown, words: string) => {
    const sb = getSupabase()
    const had = key in data.planning, old = data.planning[key]
    const r = await savePlanningKey(sb, key, value)
    if (r.error) { toast.show({ kind: 'error', text: r.error }); return false }
    setPlanningCache(r.planning)
    await reload()
    toast.show({
      kind: 'ok', text: words,
      action: { label: 'Undo', run: async () => {
        const u = await savePlanningKey(sb, key, had ? old : undefined)
        if (u.error) toast.show({ kind: 'error', text: u.error })
        else { setPlanningCache(u.planning); await reload() }
      } },
    })
    return true
  }

  const now = currentSettings(data.planning)
  return (
    <div className="rwrap">
      <div className="pagehead">
        <div>
          <span className="lbl">Yours to change · the bot can change these too</span>
          <h1 className="pagetitle serif">Settings</h1>
        </div>
      </div>

      {GROUPS.map((g) => (
        <section key={g.key} className="card setcard" aria-labelledby={`set-${g.key}`}>
          <div className="ch"><span className="lbl" id={`set-${g.key}`}>{g.title}</span></div>
          {g.note && <p className="usub" style={{ margin: '0 0 12px' }}>{g.note}</p>}
          <div className="formgrid">
            {Object.entries(SETTINGS).filter(([, s]) => s.group === g.key).map(([key, s]) => (
              <SettingField key={`${key}:${now[key]}`} k={key} value={now[key]} planning={data.planning} custom={key in data.planning}
                onSave={(v) => save(key, v, `${s.label}: ${showSetting(key, v)}.`)} onReset={() => save(key, undefined, `${s.label}: back to the default.`)} toast={toast.show} />
            ))}
          </div>
          {g.key === 'training' && <>
            <TypesEditor types={trainingTypes(data.planning)} onSave={(list, words) => save('trainingTypes', list, words)} />
            <RulesList rules={data.rules} reload={reload} toast={toast.show} />
          </>}
          {g.key === 'load' && <LoadCosts types={trainingTypes(data.planning)} toast={toast.show} />}
        </section>
      ))}

      <SetupList planning={data.planning} />

      <section className="card setcard" aria-labelledby="set-sources">
        <div className="ch"><span className="lbl" id="set-sources">Where tasks come from</span></div>
        <p className="usub" style={{ margin: '0 0 12px' }}>The “Where it came from” choices on tasks (a tutor, school…). Archived ones stay on old tasks.</p>
        <SourcesEditor sources={taskSources(data.planning)} onSave={(list, words) => save('sources', list, words)} />
      </section>
      <section className="card setcard" aria-labelledby="set-google">
        <div className="ch"><span className="lbl" id="set-google">Google Calendar</span></div>
        <GoogleSettings toast={toast.show} />
      </section>
      <section className="card setcard" aria-labelledby="set-whoop">
        <div className="ch"><span className="lbl" id="set-whoop">Whoop</span></div>
        <WhoopSettings toast={toast.show} />
      </section>
      <section className="card setcard" aria-labelledby="set-mail">
        <div className="ch"><span className="lbl" id="set-mail">Email watcher</span></div>
        <MailSettings toast={toast.show} />
      </section>
      {toast.node}
    </div>
  )
}

function SettingField({ k, value, planning, custom, onSave, onReset, toast }: {
  k: string; value: string | number; planning: unknown; custom: boolean
  onSave: (v: string | number) => Promise<boolean>; onReset: () => void; toast: ShowToast
}) {
  const s = SETTINGS[k]
  const [draft, setDraft] = useState(String(value))
  const [busy, setBusy] = useState(false)
  const commit = async (raw: string) => {
    if (raw === String(value)) return
    const v = parseSetting(k, raw, planning)
    if (v === null) { toast({ kind: 'error', text: `“${raw}” doesn’t work for “${s.label}”.` }); setDraft(String(value)); return }
    setBusy(true)
    if (!(await onSave(v))) setDraft(String(value))
    setBusy(false)
  }
  const reset = custom ? <button type="button" className="btn sm ghost setreset" onClick={onReset} disabled={busy}>Default</button> : null
  if (s.kind === 'time' || s.kind === 'choice') {
    const options = s.kind === 'time'
      ? [...new Set([String(value), ...TIMES_15])].sort().map((t) => ({ value: t, label: t }))
      : s.choices!.map((c) => ({ value: c, label: showSetting(k, c) }))
    return <div className="setfield"><Select label={s.label} value={String(value)} disabled={busy} onChange={(v) => { setDraft(v); commit(v) }} options={options} />{reset}</div>
  }
  const long = s.kind === 'text'
  return (
    <div className={`setfield ${long || s.kind === 'list' ? 'full' : ''}`}>
      <label className="field"><span>{s.label}{s.kind === 'minutes' ? ' (min)' : ''}</span>
        {long
          ? <textarea className="input" rows={5} maxLength={s.max} value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft.trim())} />
          : <input className="input" value={draft} disabled={busy} inputMode={s.kind === 'list' ? 'text' : 'numeric'}
              onChange={(e) => setDraft(e.target.value)} onBlur={() => commit(draft.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(draft.trim()) } }} />}
      </label>
      {s.help && <span className="usub">{s.help}</span>}
      {reset}
    </div>
  )
}

function TypesEditor({ types, onSave }: { types: TypeDef[]; onSave: (list: TypeDef[], words: string) => Promise<boolean> }) {
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const shown = types.filter((t) => !t.archived)
  const archived = types.filter((t) => t.archived)
  const put = (t: TypeDef, words: string) => onSave(types.some((x) => x.key === t.key) ? types.map((x) => (x.key === t.key ? t : x)) : [...types, t], words)
  return (
    <div className="setlist">
      <div className="ch" style={{ marginTop: 18 }}><span className="lbl">Training types</span>
        <button type="button" className="btn sm ghost" onClick={() => { setAdding(true); setOpen(null) }}>+ Type</button></div>
      <p className="usub" style={{ margin: '0 0 8px' }}>The rules and the week planner use these. “Spotted from” words let the app guess a session’s type from its name (the bot still asks you once).</p>
      {adding && <TypeForm onCancel={() => setAdding(false)} onSave={async (t) => { if (await put({ ...t, key: newKey(t.label, types.map((x) => x.key)) }, `Added training type ${t.label}.`)) setAdding(false) }} />}
      {shown.map((t) => (
        <div key={t.key} className="setrow">
          <button type="button" className="setrowhead" onClick={() => setOpen(open === t.key ? null : t.key)} aria-expanded={open === t.key}>
            <b>{t.label}</b> <span className="usub">{t.load} · {t.placeable ? 'planner can place it' : 'set times only'} · {t.words.join(', ') || 'no words'}</span>
          </button>
          {open === t.key && <TypeForm type={t} onCancel={() => setOpen(null)}
            onArchive={async () => { if (await put({ ...t, archived: true }, `Archived training type ${t.label}.`)) setOpen(null) }}
            onSave={async (x) => { if (await put({ ...t, ...x }, `Saved training type ${x.label}.`)) setOpen(null) }} />}
        </div>
      ))}
      {archived.length > 0 && <p className="usub">Archived: {archived.map((t) => (
        <button key={t.key} type="button" className="btn sm ghost" onClick={() => { const { archived: _, ...back } = t; void _; put(back, `${t.label} is back in use.`) }}>{t.label} ↺</button>
      ))}</p>}
    </div>
  )
}

function TypeForm({ type, onSave, onCancel, onArchive }: { type?: TypeDef; onSave: (t: Omit<TypeDef, 'key'>) => void; onCancel: () => void; onArchive?: () => void }) {
  const [label, setLabel] = useState(type?.label ?? '')
  const [words, setWords] = useState(type?.words.join(', ') ?? '')
  const [load, setLoad] = useState<string>(type?.load ?? 'hard')
  const [placeable, setPlaceable] = useState(type?.placeable ?? true)
  return (
    <form className="formgrid setform" onSubmit={(e) => {
      e.preventDefault()
      if (!label.trim()) return
      onSave({ label: label.trim().slice(0, 30), words: words.toLowerCase().split(',').map((w) => w.trim()).filter((w) => w.length >= 2).slice(0, 12), load: load === 'light' ? 'light' : 'hard', placeable })
    }}>
      <label className="field"><span>Name</span><input className="input" value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} autoFocus={!type} placeholder="Swim" /></label>
      <Select label="Load" value={load} onChange={setLoad} options={[{ value: 'hard', label: 'Hard' }, { value: 'light', label: 'Light' }]} />
      <label className="field full"><span>Spotted from (words in a session’s name)</span><input className="input" value={words} onChange={(e) => setWords(e.target.value)} placeholder="swim, pool" /></label>
      <div className="full"><Toggle checked={placeable} onChange={setPlaceable} label={placeable ? 'The planner can fit it into free time' : 'Only at set times (from your calendar)'} /></div>
      <div className="full" style={{ display: 'flex', gap: 10 }}>
        <button className="btn primary" disabled={!label.trim()}>{type ? 'Save' : 'Add type'}</button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        {onArchive && <button type="button" className="btn ghost" style={{ marginLeft: 'auto' }} onClick={onArchive}>Archive</button>}
      </div>
    </form>
  )
}

function RulesList({ rules, reload, toast }: { rules: Awaited<ReturnType<typeof loadRules>>['rules']; reload: () => Promise<void>; toast: ShowToast }) {
  const [busy, setBusy] = useState(false)
  const flip = async (i: number, on: boolean) => {
    setBusy(true)
    const sb = getSupabase()
    const err = await setRuleEnabled(sb, i, on)
    await reload()
    setBusy(false)
    if (err) return toast({ kind: 'error', text: err })
    toast({ kind: 'ok', text: `${on ? 'On' : 'Off'}: ${rules[i].label}.`, action: { label: 'Undo', run: async () => { const e = await setRuleEnabled(sb, i, !on); if (e) toast({ kind: 'error', text: e }); await reload() } } })
  }
  return (
    <div className="setlist">
      <div className="ch" style={{ marginTop: 18 }}><span className="lbl">Training rules</span></div>
      <p className="usub" style={{ margin: '0 0 8px' }}>Guidelines the week planner weighs (not hard blocks). To add or change one, tell the bot (“light lower is ok the day before a game”, “avoid heavy legs within 48h of a game”).</p>
      {rules.map((r, i) => <div key={r.id ?? i} className="setrow"><Toggle checked={r.enabled} onChange={(on) => { if (!busy) flip(i, on) }} label={r.label} /></div>)}
    </div>
  )
}

function SourcesEditor({ sources, onSave }: { sources: Source[]; onSave: (list: Source[], words: string) => Promise<boolean> }) {
  const [label, setLabel] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const shown = sources.filter((x) => !x.archived)
  const archived = sources.filter((x) => x.archived)
  const set = (key: string, change: Partial<Source>, words: string) => onSave(sources.map((x) => (x.key === key ? { ...x, ...change } : x)).map((x) => (x.archived ? x : (({ archived: _, ...rest }) => { void _; return rest })(x))), words)
  return (
    <div className="setlist">
      {shown.map((x) => (
        <div key={x.key} className="setrow setsrc">
          {editing === x.key
            ? <form style={{ display: 'flex', gap: 8, flex: 1 }} onSubmit={async (e) => { e.preventDefault(); if (draft.trim() && await set(x.key, { label: draft.trim().slice(0, 60) }, `Renamed to ${draft.trim()}.`)) setEditing(null) }}>
                <input className="input" value={draft} maxLength={60} autoFocus onChange={(e) => setDraft(e.target.value)} />
                <button className="btn sm primary">Save</button>
                <button type="button" className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            : <>
                <span style={{ flex: 1 }}>{x.label}</span>
                <button type="button" className="btn sm ghost" onClick={() => { setEditing(x.key); setDraft(x.label) }}>Rename</button>
                {x.key !== 'own' && <button type="button" className="btn sm ghost" onClick={() => set(x.key, { archived: true }, `Archived ${x.label}.`)}>Archive</button>}
              </>}
        </div>
      ))}
      <form className="gadd" style={{ marginTop: 12 }} onSubmit={async (e) => {
        e.preventDefault()
        const l = label.trim().slice(0, 60)
        if (!l) return
        if (await onSave([...sources, { key: newKey(l, sources.map((x) => x.key)), label: l }], `Added ${l}.`)) setLabel('')
      }}>
        <label className="field"><span>New source</span><input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Physics tutor (Sam)" /></label>
        <button className="btn" disabled={!label.trim()}>Add</button>
      </form>
      {archived.length > 0 && <p className="usub">Archived: {archived.map((x) => (
        <button key={x.key} type="button" className="btn sm ghost" onClick={() => set(x.key, { archived: false }, `${x.label} is back in use.`)}>{x.label} ↺</button>
      ))}</p>}
    </div>
  )
}

/** His training set-up (places, sessions, Owen's days): shown here, changed by telling the bot. */
function SetupList({ planning }: { planning: Record<string, unknown> }) {
  const places = activePlaces(planning), sessions = activeSessions(planning), owen = owenDays(planning)
  return (
    <section className="card setcard" aria-labelledby="set-setup">
      <div className="ch"><span className="lbl" id="set-setup">Training set-up</span></div>
      <p className="usub" style={{ margin: '0 0 12px' }}>Where you train and what you need each week; the optimiser decides the days. Tell the bot to change anything: “upper takes 50 min”, “PureGym is 25 min by bus from home”, “stack core onto injury prevention”. (guess) = not answered yet.</p>
      <div className="lbl" style={{ margin: '4px 0 6px' }}>Places</div>
      {places.map((p) => <p key={p.key} className="setupline">{placeWords(p, places)}</p>)}
      <div className="lbl" style={{ margin: '14px 0 6px' }}>Sessions each week</div>
      {sessions.map((x) => <p key={x.key} className="setupline">{sessionWords(x, places)}</p>)}
      <div className="lbl" style={{ margin: '14px 0 6px' }}>Owen’s days</div>
      <p className="setupline">{owen ? Object.entries(owen).map(([k, d]) => `${sessions.find((x) => x.key === k)?.name ?? k} ${daysWords(d)}`).join(', ') : 'Not settled: ask the bot “which days should I give Owen?”'}</p>
    </section>
  )
}
