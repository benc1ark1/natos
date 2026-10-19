// Server-only: which of the app's secret settings (Vercel → Settings → Environment Variables) are missing or not valid.
// Only their NAMES and what they're for ever leave this file, never a value. After the move to the Vercel project
// connected to GitHub (19 Oct 2026), a setting left behind silently stopped the calendar sync and the email watcher.
import 'server-only'

export const REQUIRED: { name: string; for: string; valid?: (v: string) => boolean }[] = [
  { name: 'NEXT_PUBLIC_SUPABASE_URL', for: 'the database' },
  { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', for: 'the database' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', for: 'the bot and the 5-minute job' },
  { name: 'NAT_OS_OWNER_USER_ID', for: 'the bot and the 5-minute job' },
  { name: 'TELEGRAM_BOT_TOKEN', for: 'Telegram' },
  { name: 'TELEGRAM_OWNER_ID', for: 'Telegram' },
  { name: 'TELEGRAM_WEBHOOK_SECRET', for: 'Telegram messages reaching the app' },
  { name: 'TELEGRAM_TICK_SECRET', for: 'the 5-minute job (calendar sync, reminders, email sorting)' },
  { name: 'ANTHROPIC_API_KEY', for: 'the AI (sorting messages, planning)' },
  { name: 'MAIL_SECRET', for: 'the email watcher scripts' },
  { name: 'TOKEN_KEY', for: 'reading the saved Google and Whoop sign-ins', valid: (v) => /^[0-9a-f]{64}$/i.test(v) },
  { name: 'GOOGLE_CLIENT_ID', for: 'Google Calendar' },
  { name: 'GOOGLE_CLIENT_SECRET', for: 'Google Calendar' },
]

/** The settings that are missing (or set but not valid), by name. */
export function missingEnv(env: Record<string, string | undefined> = process.env): { name: string; for: string; invalid?: boolean }[] {
  const out: { name: string; for: string; invalid?: boolean }[] = []
  for (const r of REQUIRED) {
    const v = env[r.name]?.trim() ?? ''
    if (!v) out.push({ name: r.name, for: r.for })
    else if (r.valid && !r.valid(v)) out.push({ name: r.name, for: r.for, invalid: true })
  }
  return out
}

/** One line for him: what's missing and where to add it. '' when nothing is. */
export function missingEnvText(env?: Record<string, string | undefined>): string {
  const m = missingEnv(env)
  if (!m.length) return ''
  return `⚠️ Vercel is missing ${m.length === 1 ? 'a setting' : `${m.length} settings`}: ${m.map((x) => `${x.name}${x.invalid ? ' (not valid)' : ''} (${x.for})`).join('; ')}. Copy ${m.length === 1 ? 'it' : 'them'} from your old Vercel project (or .env.local) into Vercel → personal-os → Settings → Environment Variables, then Redeploy.`
}
