'use client'
// The study tracker (plans/contracts.md §3): Maths / Further Maths / Physics → upcoming tests with days left, then the
// topics in school order grouped by strand, each with its colour (⚪🔴🟡🟢), ✅ Taught / ⏭ Next up / Later, its step
// and its next review (DUE). A teacher filter and a show filter. Tap a topic: change its colour (saved only when the
// database confirms, with Undo) and see what to open. Loading, empty, error and "run the SQL" states.
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { safeUrl } from '@/lib/data'
import { daysBetween, dowShort, shortDate, todayISO } from '@/lib/time'
import { isDue, nextReview, pctOf, taughtState } from '@/lib/tracker/rules'
import { loadTrackerData, restoreTopicColour, RUN_SQL, setTopicColour, type TrackerData } from '@/lib/tracker/data'
import { COLOUR_DOT, STEPS, type Colour, type TrackerLinks, type TrackerTest, type TrackerTopic } from '@/lib/tracker/types'
import Select from './controls/Select'
import { Empty, ErrorBox, Loading, useLoad, type ShowToast } from './ui'
import css from './Tracker.module.css'

type Tab = 'Maths' | 'Further Maths' | 'Physics'
const TABS: { key: Tab; label: string }[] = [{ key: 'Maths', label: 'Maths' }, { key: 'Further Maths', label: 'Further Maths' }, { key: 'Physics', label: 'Physics' }]
type Show = 'all' | 'taught' | 'next_up' | 'due'
const SHOWS: { key: Show; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'taught', label: 'Taught' }, { key: 'next_up', label: 'Next up' }, { key: 'due', label: 'Due' }]
const COLOURS: Colour[] = ['not_started', 'not_secure', 'understand', 'exam_ready']
const WORD: Record<Colour, string> = { not_started: 'Not rated', not_secure: 'Red', understand: 'Yellow', exam_ready: 'Green' }
const STATE = { taught: { text: '✅ Taught', cls: css.taught }, next_up: { text: '⏭ Next up', cls: css.next }, later: { text: 'Later', cls: css.later } } as const
const PROGRESS = { done: '✅ done', doing: '⏳ doing', todo: '❌ to do' } as const
const day = (iso: string) => `${dowShort(iso)} ${shortDate(iso)}`

/** The exam-question bank for a topic's strand (Bicen, or Integral Further for Further Stats / Mech). */
function bankLink(t: TrackerTopic, links: TrackerLinks): string {
  const s = (t.strand ?? '').toLowerCase()
  if (/further (stat|mech)/.test(s)) return links.integralFurther
  if (/further pure|core pure/.test(s)) return links.bicenCorePure
  if (/stat/.test(s)) return links.bicenStats
  if (/mech/.test(s)) return links.bicenMech
  return links.bicenPure
}

export default function TrackerView({ toast }: { toast: ShowToast }) {
  const { data, error, loading, reload } = useLoad(() => loadTrackerData(getSupabase(), todayISO()))
  const [tab, setTab] = useState<Tab>('Maths')
  const [teacher, setTeacher] = useState('all')
  const [show, setShow] = useState<Show>('all')
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  if (error) return <section className={`card ${css.card}`}><ErrorBox message={error} onRetry={reload} /></section>
  if (!data && loading) return <section className={`card ${css.card}`} aria-label="Study tracker"><Loading lines={6} /></section>
  if (!data) return null

  async function colour(t: TrackerTopic, to: Colour) {
    if (t.status === to) { setOpen(null); return }
    setSaving(t.id)
    const sb = getSupabase()
    const r = await setTopicColour(sb, t.id, to, data!.world.today)
    if (r.error) { setSaving(null); toast({ kind: 'error', text: r.error }); return }
    await reload()
    setSaving(null)
    const next = nextReview({ lastDone: data!.world.today, status: to }, data!.world.reviewDays)
    toast({
      kind: 'ok', text: `${t.code ? `${t.code} ` : ''}${t.name}: ${COLOUR_DOT[to]}${next ? ` · review ${day(next)}` : ''}`,
      action: { label: 'Undo', run: async () => { const e = await restoreTopicColour(sb, r.before!, to); if (e) toast({ kind: 'error', text: e }); reload() } },
    })
  }

  return (
    <Board data={data} tab={tab} setTab={(t) => { setTab(t); setTeacher('all'); setOpen(null) }} teacher={teacher} setTeacher={setTeacher}
      show={show} setShow={setShow} open={open} setOpen={setOpen} saving={saving} onColour={colour} />
  )
}

function Board({ data, tab, setTab, teacher, setTeacher, show, setShow, open, setOpen, saving, onColour }: {
  data: TrackerData; tab: Tab; setTab: (t: Tab) => void; teacher: string; setTeacher: (t: string) => void; show: Show; setShow: (s: Show) => void
  open: string | null; setOpen: (id: string | null) => void; saving: string | null; onColour: (t: TrackerTopic, c: Colour) => void
}) {
  const w = data.world
  const today = w.today
  const all = useMemo(() => [...w.topics].sort((a, b) => a.order - b.order), [w.topics])
  const mine = all.filter((t) => t.subject === tab)
  const codes = new Set(mine.map((t) => t.code?.toUpperCase()).filter(Boolean))
  const tests = w.tests.filter((t) => t.date && t.date >= today && (t.subject === tab || t.topicCodes.some((c) => codes.has(c.toUpperCase()))))
  const soonest = w.tests.filter((t) => t.date && t.date >= today && daysBetween(today, t.date) <= data.testWindowDays).sort((a, b) => a.date!.localeCompare(b.date!))[0]
  const teachers = [...new Set(mine.map((t) => t.teacher).filter((x): x is string => !!x))].sort()
  const state = (t: TrackerTopic) => taughtState(t, today, data.nextUpDays)
  const shown = mine.filter((t) => (teacher === 'all' || t.teacher === teacher)
    && (show === 'all' || (show === 'due' ? isDue(t, today, w.reviewDays) : state(t) === show)))
  const strands: string[] = []
  for (const t of shown) { const s = t.strand ?? 'Other topics'; if (!strands.includes(s)) strands.push(s) }
  const n = (c: Colour) => mine.filter((t) => t.status === c).length
  const due = mine.filter((t) => isDue(t, today, w.reviewDays)).length
  const upcoming = new Set(w.tests.filter((t) => t.date && t.date >= today && daysBetween(today, t.date) <= data.testWindowDays).flatMap((t) => t.topicCodes.map((c) => c.toUpperCase())))
  const redo = (t: TrackerTopic) => w.mistakes.filter((m) => m.topicId === t.id || (!!t.code && m.code?.toUpperCase() === t.code.toUpperCase())).length

  return (
    <section className={`card ${css.card}`} aria-labelledby="trk-h">
      <div className={css.head}>
        <span className="lbl" id="trk-h">Study tracker</span>
        {soonest && <span className={css.testmode}>🔥 Test mode: {soonest.title} in {daysBetween(today, soonest.date!)} days</span>}
      </div>

      <div className={`seg2 ${css.tabs}`} role="tablist" aria-label="Subject">
        {TABS.map((x) => {
          const list = all.filter((t) => t.subject === x.key)
          return (
            <button key={x.key} role="tab" aria-selected={tab === x.key} className={tab === x.key ? 'on' : ''} onClick={() => setTab(x.key)}>
              {x.key === 'Further Maths' ? <><span className={css.wide}>Further Maths</span><span className={css.narrow}>FM</span></> : x.label}
              <span className={css.tabcount}>{list.filter((t) => t.status === 'exam_ready').length}/{list.length} 🟢</span>
            </button>
          )
        })}
      </div>

      {!data.ready && <p className={css.notice}>{RUN_SQL} Until then, topics show their colours only.</p>}

      {tests.length > 0 && (
        <ul className={css.tests} aria-label={`${tab} tests`}>
          {tests.map((t) => <TestRow key={t.id} t={t} today={today} soon={daysBetween(today, t.date!) <= data.testWindowDays} />)}
        </ul>
      )}

      {mine.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <Empty>{data.subjects.some((s) => s.name === tab)
            ? <>No {tab} topics yet. Use <b>Import tracker (.xlsx)</b> above to bring in your spreadsheet, or add topics on the subject’s page.</>
            : <>You don’t have a {tab} subject yet. Importing your tracker adds it, or add it with <b>+ Subject</b> below.</>}</Empty>
        </div>
      ) : (
        <>
          <div className={css.summary} aria-label="Colours">
            <span><b>{n('exam_ready')}</b> 🟢</span><span><b>{n('understand')}</b> 🟡</span><span><b>{n('not_secure')}</b> 🔴</span><span><b>{n('not_started')}</b> ⚪</span>
            {due > 0 && <span className={css.due}><b>{due}</b> due for review</span>}
          </div>
          <div className="mbar" role="img" aria-label={`${n('exam_ready')} green, ${n('understand')} yellow, ${n('not_secure')} red, ${n('not_started')} not rated`}>
            <span style={{ width: `${(n('exam_ready') / mine.length) * 100}%`, background: '#3dd68c' }} />
            <span style={{ width: `${(n('understand') / mine.length) * 100}%`, background: '#f5c542' }} />
            <span style={{ width: `${(n('not_secure') / mine.length) * 100}%`, background: '#e5484d' }} />
          </div>

          <div className={css.filters}>
            {teachers.length > 1 && (
              <div><Select ariaLabel="Teacher" size="sm" value={teacher} onChange={setTeacher}
                options={[{ value: 'all', label: 'All teachers' }, ...teachers.map((x) => ({ value: x, label: x }))]} /></div>
            )}
            <div className={css.chips} role="group" aria-label="Show">
              {SHOWS.map((x) => <button key={x.key} type="button" className={css.chip} aria-pressed={show === x.key} onClick={() => setShow(x.key)}>{x.label}</button>)}
            </div>
          </div>

          {shown.length === 0 && (
            <div style={{ marginTop: 14 }}><Empty>Nothing matches that filter.{' '}
              <button type="button" className="btn sm ghost" onClick={() => { setShow('all'); setTeacher('all') }}>Show all</button></Empty></div>
          )}
          {strands.map((s) => {
            const list = shown.filter((t) => (t.strand ?? 'Other topics') === s)
            return (
              <div key={s} className={css.strand}>
                <div className={css.strandhead}><span className="lbl">{s}</span><span className="usub">{list.filter((t) => t.status === 'exam_ready').length}/{list.length} 🟢</span></div>
                <ul className={css.list}>
                  {list.map((t) => (
                    <TopicRow key={t.id} t={t} data={data} open={open === t.id} saving={saving === t.id} inTest={!!t.code && upcoming.has(t.code.toUpperCase())}
                      redo={redo(t)} state={state(t)} onToggle={() => setOpen(open === t.id ? null : t.id)} onColour={(c) => onColour(t, c)} />
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}

function TestRow({ t, today, soon }: { t: TrackerTest; today: string; soon: boolean }) {
  const left = daysBetween(today, t.date!)
  const last = [...t.attempts].filter((a) => a.score !== null && a.outOf).sort((a, b) => a.doneOn.localeCompare(b.doneOn)).at(-1)
  const bits = [day(t.date!), t.kind === 'consolidation' && t.minutesPerDay ? `${t.minutesPerDay}${t.minutesMax && t.minutesMax !== t.minutesPerDay ? `–${t.minutesMax}` : ''} min/day` : null,
    t.topicCodes.length ? `${t.topicCodes.length} topic${t.topicCodes.length === 1 ? '' : 's'}` : null, t.lengthMin ? `${t.lengthMin} min` : null,
    last ? `last ${last.score}/${last.outOf} (${pctOf(last.score!, last.outOf!)}%)` : null].filter(Boolean)
  return (
    <li className={`${css.test} ${soon ? css.testsoon : ''}`}>
      <div className={css.days} aria-label={left === 0 ? 'today' : `${left} days left`}><b>{left}</b><span>{left === 1 ? 'day' : 'days'}</span></div>
      <div className={css.testbody}>
        <div className={css.testname}>📝 {t.title}</div>
        <div className={css.testmeta}>{bits.join(' · ')}</div>
        {t.limits && <div className={css.testmeta}>⚠️ {t.limits}</div>}
      </div>
    </li>
  )
}

function TopicRow({ t, data, open, saving, inTest, redo, state, onToggle, onColour }: {
  t: TrackerTopic; data: TrackerData; open: boolean; saving: boolean; inTest: boolean; redo: number; state: keyof typeof STATE
  onToggle: () => void; onColour: (c: Colour) => void
}) {
  const w = data.world
  const next = nextReview(t, w.reviewDays)
  const due = !!next && next <= w.today
  const physics = t.subject === 'Physics'
  const st = STATE[state]
  const bank = safeUrl(bankLink(t, w.links) || null)
  const integral = safeUrl(t.integralUrl)
  const pmt = safeUrl(w.links.pmtPhysics || null)
  return (
    <li>
      <button type="button" className={css.row} onClick={onToggle} aria-expanded={open} disabled={saving}>
        <span className={css.code}>{t.code ?? '—'}</span>
        <span className={css.dot} aria-label={WORD[t.status]}>{COLOUR_DOT[t.status]}</span>
        <span className={css.main}>
          <span className={css.name}>{t.name}</span>
          <span className={css.meta}>
            <span className={st.cls}>{physics && t.taught === 'in_class' ? '🟡 In class' : st.text}</span>
            {!physics && t.step > 0 && <span>Step {t.step} · {STEPS[t.step]}</span>}
            {physics && t.booklet && <span>Booklet {PROGRESS[t.booklet]}</span>}
            {due ? <span className={css.duetag}>DUE</span> : next ? <span>Review {day(next)}</span> : null}
            {inTest && <span className={css.intest}>📝 in a test</span>}
            {redo > 0 && <span>{redo} mistake{redo === 1 ? '' : 's'} to redo</span>}
            {saving && <span>Saving…</span>}
          </span>
        </span>
      </button>
      {open && (
        <div className={css.panel}>
          <div className={css.colours} role="group" aria-label={`Colour for ${t.name}`}>
            {COLOURS.map((c) => (
              <button key={c} type="button" className={`btn sm ${t.status === c ? 'primary' : 'ghost'}`} onClick={() => onColour(c)} disabled={saving} aria-pressed={t.status === c}>
                {COLOUR_DOT[c]} {WORD[c]}
              </button>
            ))}
          </div>
          <dl className={css.facts}>
            {t.teacher && <><dt>Teacher</dt><dd>{t.teacher}</dd></>}
            {!physics && (t.halfTerm || t.taughtFrom) && <><dt>School</dt><dd>{[t.halfTerm, t.taughtFrom ? `taught from ${day(t.taughtFrom)}` : null].filter(Boolean).join(' · ')}</dd></>}
            {physics && <><dt>Taught?</dt><dd>{t.taught === 'yes' ? 'Yes' : t.taught === 'in_class' ? 'In class now' : 'Not yet'}</dd></>}
            {!physics && <><dt>Step</dt><dd>{t.step} {STEPS[t.step]}{t.bookRef ? ` · ${t.bookRef}` : ''}</dd></>}
            {t.bicen && <><dt>Exam Qs</dt><dd>{bank ? <a href={bank} target="_blank" rel="noopener noreferrer">{t.bicen}</a> : t.bicen}</dd></>}
            {integral && <><dt>Integral</dt><dd><a href={integral} target="_blank" rel="noopener noreferrer">Open the Integral folder</a></dd></>}
            {physics && (t.booklet || t.pmt || t.pmtRef) && <><dt>Questions</dt><dd>{[t.booklet ? `Booklet ${PROGRESS[t.booklet]}` : null, t.pmt ? `PMT ${PROGRESS[t.pmt]}` : null].filter(Boolean).join(' · ')}
              {t.pmtRef && <> {pmt ? <a href={pmt} target="_blank" rel="noopener noreferrer">{t.pmtRef}</a> : t.pmtRef}</>}</dd></>}
            {t.freshPct !== null && <><dt>Fresh Qs</dt><dd>{t.freshPct}%</dd></>}
            <dt>Reviews</dt><dd>{t.lastDone ? `last done ${day(t.lastDone)} · ${next ? (due ? 'review due now' : `next review ${day(next)}`) : 'no review set'}` : 'not done yet'}</dd>
            {t.weakNotes && <><dt>Notes</dt><dd>{t.weakNotes}</dd></>}
            {t.concepts && <><dt>Concepts</dt><dd>{t.concepts}</dd></>}
          </dl>
          <div className={css.more}><Link href={`/subjects/${t.subjectId}`}>Open {t.subject}: pipeline, GoodNotes links, mistakes →</Link></div>
        </div>
      )}
    </li>
  )
}
