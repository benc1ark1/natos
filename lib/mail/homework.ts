// Homework emails, in plain code (no AI, no database): who always sets homework (his "Homework senders" setting and his
// school's own domain), a clear title from the subject, and the notes (what to do, e.g. the problem list) from the
// email's text without greetings, sign-offs, signatures or the quoted older emails.
import { cleanPattern, ruleMatches } from './rules'

/** His "Homework senders" setting (addresses or @domains, comma-separated), checked. */
export function homeworkSenders(raw: unknown): string[] {
  if (typeof raw !== 'string' || /^\s*none\s*$/i.test(raw)) return []
  return raw.split(/[,;\n]+/).map((x) => cleanPattern(x)).filter((x): x is string => !!x && /@/.test(x))
}

/** His school's domain, from the school Gmail account's address ("nat@ucs.org.uk" → "ucs.org.uk"). */
export const schoolDomain = (address: string | null | undefined) => {
  const d = (address ?? '').toLowerCase().split('@')[1] ?? ''
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !PUBLIC_MAIL.test(d) ? d : null
}
// a personal-mail domain is never "the school" (a school account on gmail.com would make every Gmail user a teacher)
const PUBLIC_MAIL = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|proton|protonmail)\.[a-z.]+$/

export type HomeworkSender = 'listed' | 'school' | null

/** Does this sender always set homework? 'listed' (his setting) or 'school' (a teacher at his school's domain). */
export function homeworkSender(e: { from_email: string | null; from_name: string | null; subject: string | null }, o: { listed: string[]; school: string | null }): HomeworkSender {
  const email = (e.from_email ?? '').toLowerCase()
  if (!email) return null
  if (o.listed.some((p) => ruleMatches({ pattern: p }, { ...e, subject: null }))) return 'listed'
  const host = email.split('@')[1] ?? ''
  if (o.school && (host === o.school || host.endsWith(`.${o.school}`))) return 'school'
  return null
}

/** Words that say an email sets work (the Gmail script uses the same idea to decide when to send the body). */
export const HOMEWORK_WORDS = /\b(home ?work|hw|due|deadline|assignment|worksheet|exercises?|problems?|questions?|coursework|essay|submit|hand ?in|past paper|revise|revision)\b/i

/** "Re: Computer Science Homework - Due 20th October 2026" → "Computer Science homework" (≤ 80 characters). */
export function homeworkTitle(subject: string | null, sender: string | null): string {
  let t = (subject ?? '').replace(/^\s*((re|fwd?|fw|aw)\s*:\s*)+/i, '')
  // the deadline part goes in the due date: "- Due …", "(due Friday)", ", by Monday"
  t = t.replace(/\s*[-–—:,(\[]*\s*\b(due|deadline|by|before|for)\b.*$/i, '')
  t = t.replace(/\bHomework\b/g, 'homework').replace(/\s+/g, ' ').replace(/[\s\-–—:,]+$/, '').trim()
  const who = (sender ?? '').trim().split(/\s+/)[0]
  if (!t || /^(homework|hw|work|task)$/i.test(t)) t = `Homework${who ? ` from ${who}` : ''}`
  return t.slice(0, 80)
}

const GREETING = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b[^\n]{0,40}[,!]?\s*$/i
// a sign-off line on its own ("Thanks,", "Many thanks!", "Best wishes,"), not "Thanks, here's part 2:"
const SIGN_OFF = /^(thanks|thank you|many thanks|cheers|best|best wishes|kind regards|regards|warm regards|all the best|see you|speak soon)(\s+(again|so much|a lot|very much|mate|all))?\s*[,!.]*$/i
const QUOTE_START = /^(on .{3,120} wrote:|-{2,}\s*original message\s*-{2,}|from:\s.+|sent from my \w+)/i

/** What to do, from the email's text: greetings, sign-offs, signatures and quoted older emails left out. */
export function homeworkNotes(text: string | null, max = 1500): string {
  const lines: string[] = []
  for (const raw of (text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (QUOTE_START.test(line.trim()) || line.trim() === '--' || line.trim() === '-- ') break   // the rest is older mail or a signature
    if (/^\s*>/.test(line)) continue
    lines.push(line.trim())
  }
  while (lines.length && !lines.at(-1)) lines.pop()
  // a short last line after the sign-off is the sender's name ("Thanks,\nSam"): drop the sign-off and what follows
  const signOff = lines.findIndex((l, i) => SIGN_OFF.test(l) && i >= lines.length - 3)
  const kept = signOff >= 0 ? lines.slice(0, signOff) : lines
  const first = kept.findIndex((l) => !!l)
  const body = kept.filter((l, i) => !(i === first && GREETING.test(l)))
  const out = body.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out
}
