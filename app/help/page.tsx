// Help (item 8): how to use Nat OS on one phone screen, with HIS times (profiles.planning, read as him under RLS; the
// defaults if it can't be read). The step-by-step backup and every command are folded away below. The content is
// lib/help.ts, the same source as /help in Telegram and docs/HOW-TO-USE.md. Server component: no client secrets.
import type { Metadata } from 'next'
import Link from 'next/link'
import { connection } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { GUIDE_URL, HELP_BACKUP, HELP_BACKUP_NOTE, HELP_BACKUP_SHORT, HELP_BUTTONS, HELP_COMMANDS, HELP_IDEAS, HELP_INTRO, HELP_MESSAGES, helpRoutine, helpTimes, segments } from '@/lib/help'
import css from './help.module.css'

export const metadata: Metadata = { title: 'Help · Nat OS' }

/** His settings, or null (and that it failed) when they can't be read. */
async function loadPlanning(): Promise<{ planning: unknown; failed: boolean }> {
  await connection()   // per request (his settings), never prerendered; outside the try so Next's bail-out isn't swallowed
  try {
    const sb = await getServerSupabase()
    const { data, error } = await sb.from('profiles').select('planning').maybeSingle()
    return { planning: error ? null : data?.planning ?? null, failed: !!error }
  } catch {
    return { planning: null, failed: true }
  }
}

function Rich({ text }: { text: string }) {
  return (
    <>
      {segments(text).map((s, i) => (s.kind === 'code' ? <code key={i} className={css.code}>{s.text}</code> : s.kind === 'bold' ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>))}
    </>
  )
}

export default async function Page() {
  const { planning, failed } = await loadPlanning()
  const routine = helpRoutine(helpTimes(planning))
  return (
    <div className={css.page}>
      <div className="pagehead">
        <div>
          <div className="lbl"><span className="n">//</span> Help</div>
          <h1 className="pagetitle serif">How to use it</h1>
        </div>
      </div>

      <section className={`card ${css.card}`} aria-label="How to use Nat OS">
        <p className={css.intro}><Rich text={HELP_INTRO} /></p>

        <h2 className={`lbl ${css.h}`}>Your day</h2>
        <ul className={css.list}>
          {routine.map((r) => (
            <li key={r.icon} className={css.row}>
              <span className={css.icon} aria-hidden="true">{r.icon}</span>
              <span><b className={css.when}>{r.when}</b> <Rich text={r.what} /></span>
            </li>
          ))}
        </ul>
        <p className={css.note}>
          {failed ? 'Default times (your settings couldn’t be read just now).' : 'Your times.'} <Link href="/settings" className={css.inline}>Change them in Settings</Link>
        </p>

        <h2 className={`lbl ${css.h}`}>Send things like</h2>
        <ul className={css.msgs}>
          {HELP_MESSAGES.map((m) => (
            <li key={m.say}><code className={css.code}>{m.say}</code> <span className={css.does}>{m.short || m.does}</span></li>
          ))}
        </ul>

        <ul className={`${css.list} ${css.tail}`}>
          <li className={css.line}><Rich text={HELP_BUTTONS} /></li>
          <li className={css.line}>💡 <Rich text={HELP_IDEAS} /></li>
          <li className={css.line}>📤 <Rich text={HELP_BACKUP_SHORT} /> (steps below).</li>
        </ul>
      </section>

      <details className={`card ${css.more}`}>
        <summary className="lbl">📤 Google Sheet backup, step by step</summary>
        <ol className={css.steps}>
          {HELP_BACKUP.map((t) => <li key={t}><Rich text={t} /></li>)}
        </ol>
        <p className={css.note}><Rich text={HELP_BACKUP_NOTE} /> <Link href="/subjects" className={css.inline}>Open Subjects</Link></p>
      </details>

      <details className={`card ${css.more}`}>
        <summary className="lbl">All Telegram commands</summary>
        <dl className={css.cmds}>
          {HELP_COMMANDS.map((g) => (
            <div key={g.group} className={css.cmdgroup}>
              <dt>{g.group}</dt>
              <dd>
                {g.commands.map((c) => (
                  <span key={c.command}><code className={css.code}>/{c.command}</code> <Rich text={c.what} /></span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </details>

      <p className={css.note}><a href={GUIDE_URL} className={css.inline} target="_blank" rel="noreferrer">The long guide (on GitHub)</a></p>
    </div>
  )
}
