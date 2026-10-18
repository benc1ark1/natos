// Shared set-up for the simulated Telegram conversations (one per phase file).
// The real bot code, a fake Telegram, a scripted AI and the TEST database; every test starts from a clean,
// small made-up starting point. Usage: const chat = useChat(); test('…', { skip: chat.skip }, async () => { … })
import { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { testEnv, connect, applySchema, ensureUsers, reset } from './testdb.mjs'
import { fakeTelegram, fakeAI } from './fakes.mjs'

export const OWNER_TG = 7001
export const CHAT = 'claude-sonnet-5-5'
export const SORT = 'claude-haiku-4-5'

export function useChat() {
  const { env, why } = testEnv()
  const c = { skip: env ? false : why, db: null, users: null, tg: null, ai: null, bot: null, time: null }
  let msgNo = 1, updNo = 1

  before(async () => {
    if (c.skip) return
    c.db = connect(env)
    await c.db.connect()
    await applySchema(c.db)
    c.users = await ensureUsers(env)
    c.tg = await fakeTelegram()
    c.ai = await fakeAI()
    Object.assign(process.env, {
      NEXT_PUBLIC_SUPABASE_URL: env.TEST_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.TEST_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: env.TEST_SUPABASE_SECRET_KEY,
      NAT_OS_OWNER_USER_ID: c.users.owner,
      TELEGRAM_BOT_TOKEN: 'test-bot-token',
      TELEGRAM_API_BASE: c.tg.url,
      ANTHROPIC_API_KEY: 'test-key-not-real',
      ANTHROPIC_BASE_URL: c.ai.url,
    })
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL
    c.bot = await import('../../lib/telegram/bot.ts')
    c.time = await import('../../lib/time.ts')
  })
  after(async () => { await c.db?.end(); c.tg?.close(); c.ai?.close() })
  beforeEach(async () => {
    if (c.skip) return
    await reset(c.db, c.users)
    c.tg.clear()
    c.ai.reset()
  })

  Object.assign(c, {
    nat: (text, opts = {}) => c.bot.handleUpdate({
      update_id: updNo++,
      message: { message_id: opts.messageId ?? msgNo++, from: { id: OWNER_TG }, chat: { id: OWNER_TG, type: 'private' }, text },
    }),
    tap: (data, messageId = 1) => c.bot.handleUpdate({
      update_id: updNo++,
      callback_query: { id: `q${updNo}`, from: { id: OWNER_TG }, data, message: { message_id: messageId, chat: { id: OWNER_TG, type: 'private' } } },
    }),
    last: () => c.tg.sent().at(-1),
    button: (m, label) => (m?.reply_markup?.inline_keyboard ?? []).flat().find((b) => b.text.includes(label))?.callback_data,
    q: async (sql, args = []) => (await c.db.query(sql, args)).rows,
    /** Insert one row as the owner; returns it. */
    add: async (table, values) => {
      const v = { user_id: c.users.owner, ...values }
      const keys = Object.keys(v)
      return (await c.db.query(`insert into public.${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(v))).rows[0]
    },
    /** The next date with this ISO weekday (1 = Mon … 7 = Sun), today counting. */
    next: (dow) => { let d = c.time.todayISO(); while (c.time.isoDow(d) !== dow) d = c.time.addDays(d, 1); return d },
    lastBrainText: () => c.ai.byModel(CHAT).at(-1).body.messages[0].content.map((x) => x.text).join('\n'),
    noSurprises: () => {
      assert.deepEqual(c.ai.unexpected, [], 'an AI call happened that the conversation did not expect')
      assert.equal(c.ai.pending(), 0, 'a scripted AI reply was never used (an expected AI call did not happen)')
    },
  })
  return c
}
