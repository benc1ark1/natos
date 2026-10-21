// The email watcher's plain rules (no AI, no database): reading what a Gmail script sends, his flag/ignore rules,
// and spotting automated mail (newsletters, promos, no-reply senders) so it's ignored for free.

export const ACCOUNTS = ['school', 'personal'] as const
export type Account = (typeof ACCOUNTS)[number]
export type MailKind = 'homework' | 'reply' | 'event' | 'ignore'
export type MailRule = { id: string; pattern: string; action: 'flag' | 'ignore'; label: string | null; archived_at?: string | null }

/** One email as the script sends it: Gmail's preview line, and the text only when it looks like homework (the script
 *  decides: homework words, or a sender the app named as setting homework). */
export type Incoming = {
  id: string; thread: string | null; from: string; subject: string; snippet: string; received: string
  labels: string[]; automated: boolean; body?: string
  to?: string; cc?: string   // the To and Cc headers (fix round 22; a script copied before then sends neither)
}

export const MAX_BODY = 4000

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, max) : '')
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
/** Gmail's snippet comes HTML-escaped ("Don&#39;t"). */
export const unescape = (s: string) =>
  s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m }
    return ENTITIES[e.toLowerCase()] ?? m
  })

/** The script's list, checked: at most 50, each field cut to size, anything malformed dropped. */
export function readIncoming(body: unknown): { account: Account; address: string | null; via: 'url' | 'calendar'; sent: string | null; messages: Incoming[]; aliases?: string[] } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (!ACCOUNTS.includes(b.account as Account)) return null
  const list = Array.isArray(b.messages) ? b.messages.slice(0, 50) : []
  const messages: Incoming[] = []
  for (const m of list) {
    if (!m || typeof m !== 'object') continue
    const x = m as Record<string, unknown>
    const id = str(x.id, 200), received = str(x.received, 40)
    if (!/^[A-Za-z0-9_-]+$/.test(id) || Number.isNaN(Date.parse(received))) continue
    messages.push({
      id, thread: /^[A-Za-z0-9_-]{1,200}$/.test(String(x.thread ?? '')) ? String(x.thread) : null,
      from: str(x.from, 400), subject: unescape(str(x.subject, 300)), snippet: unescape(str(x.snippet, 400)).slice(0, 300),
      received: new Date(received).toISOString(),
      labels: Array.isArray(x.labels) ? x.labels.filter((l): l is string => typeof l === 'string' && /^CATEGORY_[A-Z]+$/.test(l)).slice(0, 5) : [],
      automated: x.automated === true,
      ...(typeof x.body === 'string' && x.body.trim() ? { body: x.body.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim().slice(0, MAX_BODY) } : {}),
      ...(typeof x.to === 'string' ? { to: str(x.to, 2000), cc: str(x.cc, 2000) } : {}),
    })
  }
  const address = str(b.address, 320)
  const sent = str(b.sent, 40)
  const aliases = Array.isArray(b.aliases) ? b.aliases.map((a) => str(a, 320).toLowerCase()).filter((a) => /^[^\s@]+@[^\s@]+$/.test(a)).slice(0, 20) : []
  return {
    account: b.account as Account, address: /^[^\s@]+@[^\s@]+$/.test(address) ? address.toLowerCase() : null, via: b.via === 'calendar' ? 'calendar' : 'url',
    sent: sent && !Number.isNaN(Date.parse(sent)) && Date.parse(sent) <= Date.now() + 300_000 ? new Date(sent).toISOString() : null, messages,
    ...(aliases.length ? { aliases } : {}),
  }
}

/** The addresses in a To or Cc header ("Sam <sam@x.com>, dad@y.com" → both), lower case. */
export const addressesIn = (header: string | null | undefined) =>
  (header ?? '').match(/[^\s<>,;:"'()]+@[^\s<>,;:"'()]+\.[a-z]{2,}/gi)?.map((a) => a.toLowerCase()) ?? []

/** One address the way Gmail delivers it: "+tags" dropped; for Gmail, dots too, and googlemail = gmail. */
const sameBox = (a: string) => {
  const [u, h = ''] = a.toLowerCase().split('@')
  const host = h === 'googlemail.com' ? 'gmail.com' : h
  const user = u.replace(/\+.*$/, '')
  return `${host === 'gmail.com' ? user.replace(/\./g, '') : user}@${host}`
}

/** Was the email written to him (fix round 22)? 'to': he's in To (or nobody is: "undisclosed recipients", sent to him
 *  by Bcc); 'cc': he's only in Cc; 'others': it's between other people (he's in neither). null: the script sent no
 *  To/Cc (a copy from before) or his address isn't known, so it's sorted as before. */
export function addressedTo(m: Pick<Incoming, 'to' | 'cc'>, mine: (string | null | undefined)[]): 'to' | 'cc' | 'others' | null {
  const me = new Set(mine.filter((a): a is string => !!a && a.includes('@')).map(sameBox))
  if (m.to === undefined || !me.size) return null
  const to = addressesIn(m.to).map(sameBox), cc = addressesIn(m.cc).map(sameBox)
  if (!to.length && !cc.length) return 'to'
  if (to.some((a) => me.has(a))) return 'to'
  return cc.some((a) => me.has(a)) ? 'cc' : 'others'
}

/** "Sam Smith <sam@tutor.com>" → { name: 'Sam Smith', email: 'sam@tutor.com' } */
export function parseFrom(from: string): { name: string | null; email: string | null } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^<>\s]+@[^<>\s]+)>\s*$/)
  if (m) return { name: m[1].trim() || null, email: m[2].toLowerCase() }
  const e = from.trim().match(/^[^\s@<>]+@[^\s@<>]+$/)
  return e ? { name: null, email: e[0].toLowerCase() } : { name: from.trim() || null, email: null }
}

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9@.]+/g, ' ').trim()

/** How a rule's pattern matches: an address, a domain ("@ucs.org.uk", subdomains too) or words (sender or subject). */
export function patternKind(pattern: string): 'address' | 'domain' | 'words' {
  const p = pattern.trim().toLowerCase()
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p)) return 'address'
  if (/^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(p) && (p.startsWith('@') || !/\s/.test(p))) return 'domain'
  return 'words'
}

/** "ucs.org.uk" or "@ucs.org.uk" → "@ucs.org.uk"; addresses lower-case; words as he said them. */
export function cleanPattern(raw: string): string | null {
  const p = raw.trim().replace(/^["“”']+|["“”']+$/g, '').trim().slice(0, 200)
  if (p.length < 2) return null
  const k = patternKind(p)
  if (k === 'domain') return `@${p.toLowerCase().replace(/^@/, '')}`
  if (k === 'address') return p.toLowerCase()
  return norm(p).length >= 2 ? p : null
}

/** Does this rule match the email? */
export function ruleMatches(rule: Pick<MailRule, 'pattern'>, e: { from_email: string | null; from_name: string | null; subject: string | null }): boolean {
  const p = rule.pattern.trim().toLowerCase()
  const email = (e.from_email ?? '').toLowerCase()
  switch (patternKind(p)) {
    case 'address': return email === p
    case 'domain': { const d = p.replace(/^@/, ''); const host = email.split('@')[1] ?? ''; return host === d || host.endsWith(`.${d}`) }
    default: {
      const w = norm(p)
      return !!w && ` ${norm(`${e.from_name ?? ''} ${email} ${e.subject ?? ''}`)} `.includes(` ${w} `)
    }
  }
}

const RANK = { address: 3, domain: 2, words: 1 }
/** The rule that decides: the most exact match wins (an address beats a domain beats words); at the same level, flag wins. */
export function decidingRule(rules: MailRule[], e: { from_email: string | null; from_name: string | null; subject: string | null }): MailRule | null {
  const hits = rules.filter((r) => !r.archived_at && ruleMatches(r, e))
  hits.sort((a, b) => RANK[patternKind(b.pattern)] - RANK[patternKind(a.pattern)] || (a.action === 'flag' ? -1 : 1) - (b.action === 'flag' ? -1 : 1))
  return hits[0] ?? null
}

const BULK_TABS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']
/** Newsletters, promos and robots: ignored without asking the AI (unless he flagged the sender). */
export function isAutomated(e: { automated: boolean; labels: string[]; from_email: string | null }): boolean {
  if (e.automated) return true
  if (e.labels.some((l) => BULK_TABS.includes(l))) return true
  return /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|newsletters?|marketing)([+._-][^@]*)?@/i.test(e.from_email ?? '')
}

/** How a rule reads: "always flag emails from @ucs.org.uk (ucs.org.uk teachers)". */
export const ruleWords = (r: Pick<MailRule, 'pattern' | 'action' | 'label'>) => {
  const k = patternKind(r.pattern)
  const what = k === 'words' ? `emails mentioning “${r.pattern}”` : `emails from ${r.pattern}`
  return `${r.action === 'flag' ? 'always flag' : 'ignore'} ${what}${r.label && r.label.toLowerCase() !== r.pattern.toLowerCase() ? ` (${r.label})` : ''}`
}

/** Gmail on the web, at this thread, in the right account. */
export const gmailLink = (address: string | null, thread: string | null) =>
  `https://mail.google.com/mail/${address ? `?authuser=${encodeURIComponent(address)}` : 'u/0/'}${thread ? `#all/${thread}` : '#inbox'}`
