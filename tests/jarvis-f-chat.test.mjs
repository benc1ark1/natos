// Jarvis phase F: the Mini App sign-in route on the TEST database: genuine launch data gets a working session
// for Nat; the same launch can't be used twice. Run: npm run test:chat
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { useChat, OWNER_TG } from './support/chat.mjs'

const chat = useChat()
const skip = chat.skip
const sign = (fields, token) => {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(token).digest()
  return new URLSearchParams({ ...fields, hash: createHmac('sha256', secret).update(check).digest('hex') }).toString()
}

test('Open dashboard from the bot: a working session for Nat, once per launch', { skip }, async () => {
  process.env.TELEGRAM_OWNER_ID = String(OWNER_TG)
  const { POST } = await import('../app/api/telegram/miniapp/route.ts')
  const initData = sign({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: OWNER_TG }) }, process.env.TELEGRAM_BOT_TOKEN)
  const call = () => POST(new Request('http://x/api/telegram/miniapp', { method: 'POST', body: JSON.stringify({ initData }) }))
  const res = await call()
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.ok(json.access_token && json.refresh_token)
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.setSession({ access_token: json.access_token, refresh_token: json.refresh_token })
  assert.equal(error, null)
  assert.equal(data.user.id, chat.users.owner, 'signed in as Nat, and only Nat')
  const again = await call()
  assert.equal(again.status, 401, 'the same launch data can’t be used twice')
})
