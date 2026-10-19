// A stopwatch for the bot (queue item 3): wraps fetch so every Supabase, Telegram and AI call takes a realistic
// time, and records each one. The bot code, the test database, the fake Telegram and the fake AI are all real; only
// the network is simulated. Each call takes AT LEAST its latency below (max(real local time, latency)), so the
// numbers are "as if on Vercel", give or take the local machine's own speed.
//
// Assumptions (plans/speed-report.md):
// - Supabase: 40 ms per round trip (Vercel function → Supabase in the same region; PostgREST or auth).
// - Telegram: 100 ms per Bot API call.
// - AI: Haiku 0.8 s (small prompt, little or no thinking), Sonnet 4 s (the brain: big prompt, effort medium),
//   Opus 8 s (planning). A model that isn't listed takes 4 s.
import { performance } from 'node:perf_hooks'

export const LATENCY = {
  db: 40,
  tg: 100,
  ai: { 'claude-haiku-4-5': 800, 'claude-haiku-5-5': 800, 'claude-sonnet-5-5': 4000, 'claude-opus-5-5': 8000 },
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Install the stopwatch. `bases`: the URL prefixes of the test database, the fake Telegram and the fake AI.
 * start() begins a measurement; stop() ends it and returns its summary (see summarise).
 */
export function stopwatch(bases, latency = LATENCY) {
  const real = globalThis.fetch
  const calls = []
  let on = false, t0 = 0
  globalThis.fetch = async function timedFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const kind = url.startsWith(bases.db) ? 'db' : url.startsWith(bases.tg) ? 'tg' : url.startsWith(bases.ai) ? 'ai' : null
    if (!on || !kind) return real(input, init)
    const call = { kind, start: performance.now() - t0, end: 0, what: '' }
    let min = kind === 'db' ? latency.db : latency.tg
    if (kind === 'db') call.what = `${init.method ?? 'GET'} ${new URL(url).pathname.replace(/^\/rest\/v1\//, '')}`
    if (kind === 'tg') call.what = url.split('/').pop()
    if (kind === 'ai') {
      const body = typeof init.body === 'string' ? init.body : ''
      try { call.what = JSON.parse(body).model } catch { call.what = '?' }
      call.chars = body.length
      min = latency.ai[call.what] ?? 4000
    }
    calls.push(call)
    try {
      const [res] = await Promise.all([real(input, init), sleep(min)])
      return res
    } finally {
      call.end = performance.now() - t0
    }
  }
  return {
    calls,
    start() { calls.length = 0; on = true; t0 = performance.now() },
    stop() { on = false; return summarise(calls, performance.now() - t0) },
    restore() { globalThis.fetch = real },
  }
}

/**
 * One measurement: total ms; when the first "typing…" and the first reply (a sent or edited message) got to Telegram;
 * how many DB calls and sequential DB "waves" (calls that overlap in time are one wave), and how many of those waves Nat
 * actually waits for: before the first reply and not hidden behind an AI call running at the same time; the AI calls.
 */
export function summarise(calls, total) {
  const tg = calls.filter((c) => c.kind === 'tg')
  const firstEnd = (re) => { const c = tg.filter((x) => re.test(x.what)).sort((a, b) => a.end - b.end)[0]; return c ? Math.round(c.end) : null }
  const db = calls.filter((c) => c.kind === 'db').sort((a, b) => a.start - b.start)
  const aiCalls = calls.filter((c) => c.kind === 'ai')
  const reply = firstEnd(/^(sendMessage|editMessageText)$/)
  const clusters = []
  for (const c of db) {
    const last = clusters.at(-1)
    if (last && c.start < last.end) last.end = Math.max(last.end, c.end)
    else clusters.push({ start: c.start, end: c.end })
  }
  const hidden = (w) => aiCalls.some((a) => w.start >= a.start && w.end <= a.end)
  const waited = clusters.filter((w) => (reply == null || w.start < reply) && !hidden(w)).length
  const ai = aiCalls.map((c) => ({ model: c.what, tokens: Math.round((c.chars ?? 0) / 4) }))
  return {
    total: Math.round(total),
    typing: firstEnd(/^sendChatAction$/),
    reply,
    db: db.length,
    waves: clusters.length,
    waited,
    tg: tg.length,
    ai,
  }
}

const sec = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(2)} s`)
const short = (m) => m.replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2')

/** The results as a Markdown table (plans/speed-report.md). */
export function table(rows) {
  const out = [
    '| Message | Path | First “typing…” | First reply | Total | DB calls | DB waves (waited for) | AI calls (≈ prompt tokens) |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const r of rows) {
    const ai = r.ai.length ? r.ai.map((a) => `${short(a.model)} (${a.tokens.toLocaleString('en-GB')})`).join(' + ') : 'none'
    out.push(`| ${r.name} | ${r.path ?? ''} | ${sec(r.typing)} | ${sec(r.reply)} | ${sec(r.total)} | ${r.db} | ${r.waves} (${r.waited}) | ${ai} |`)
  }
  return out.join('\n')
}
