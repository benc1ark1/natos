import { after } from 'next/server'
import { receiveMail } from '@/lib/mail/incoming'
import { processMail } from '@/lib/mail/watcher'

// Called every 15 minutes by the Gmail scripts (google-apps-script/mail-watcher.gs) in his school and personal accounts,
// with "Authorization: Bearer <MAIL_SECRET>". Without the key: 401 and nothing happens. New mail is sorted and sent to
// Telegram after the script has its answer (the 5-minute tick catches anything left over).

export const maxDuration = 120

export async function POST(request: Request) {
  const r = await receiveMail(request.headers.get('authorization'), await request.text())
  const owner = process.env.TELEGRAM_OWNER_ID
  if (r.sb && r.added && owner && /^\d+$/.test(owner)) {
    const sb = r.sb
    after(async () => { try { await processMail(sb, Number(owner)) } catch {} })
  }
  return Response.json(r.json, { status: r.status })
}
