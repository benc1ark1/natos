// Server-only: calls the Telegram Bot API. The bot token stays in this file's request URL;
// error messages are cleaned so the token can never reach a reply or a response.
import 'server-only'
import { markReply, soon } from './speed'

// Tests can point the bot at a local fake Telegram (localhost only); real deployments never set this.
function base(): string {
  const b = process.env.TELEGRAM_API_BASE
  return b && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b) ? b : 'https://api.telegram.org'
}

export class TelegramError extends Error {}

const clean = (s: string) => {
  const token = process.env.TELEGRAM_BOT_TOKEN
  return token ? s.split(token).join('[token]') : s
}

export async function tg<T = unknown>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new TelegramError('The bot token isn’t set up (TELEGRAM_BOT_TOKEN).')
  let res: Response
  try {
    res = await fetch(`${base()}/bot${token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    })
  } catch {
    throw new TelegramError(`Couldn’t reach Telegram (${method}).`)
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
  if (!json?.ok) throw new TelegramError(clean(`Telegram ${method} failed: ${json?.description ?? res.status}`))
  return json.result as T
}

export type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } }

// Telegram's HTML: only these tags; anything else is text. safeHtml() escapes stray < > &, drops a closing tag
// with no opening one, closes what's left open, and cuts long messages between tags (never mid-tag).
const TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 'ins', 's', 'strike', 'del', 'code', 'pre', 'a', 'tg-spoiler', 'blockquote'])
const TAG = /^<(\/?)([a-z][a-z-]*)(\s[^<>]*)?>/i
const ENTITY = /^&(?:amp|lt|gt|quot|#\d{1,6}|#x[0-9a-f]{1,6});/i
export const MAX_TEXT = 4000

/** Valid Telegram HTML from any string, at most `max` characters. */
export function safeHtml(html: string, max = MAX_TEXT): string {
  const open: string[] = []
  let out = ''
  let closeLen = 0   // length of the closing tags still owed
  for (let i = 0; i < html.length;) {
    const rest = html.slice(i, i + 300)
    const tag = rest[0] === '<' ? rest.match(TAG) : null
    let piece: string
    let step: number
    if (tag && TAGS.has(tag[2].toLowerCase()) && !(tag[1] && tag[3])) {
      const name = tag[2].toLowerCase()
      step = tag[0].length
      if (!tag[1]) piece = tag[0]
      else if (open.includes(name)) {
        // close it (and anything opened inside it that was left open)
        piece = ''
        for (let k = open.length - 1; k >= 0 && open[k + 1] !== name; k--) piece += `</${open[k]}>`
      } else { i += step; continue }   // a closing tag with no opening one: dropped
    } else if (rest[0] === '&') {
      const ent = rest.match(ENTITY)
      piece = ent ? ent[0] : '&amp;'
      step = ent ? ent[0].length : 1
    } else if (rest[0] === '<' || rest[0] === '>') { piece = rest[0] === '<' ? '&lt;' : '&gt;'; step = 1 }
    else { piece = rest[0]; step = 1 }
    const opening = tag && !tag[1] ? tag[2].toLowerCase() : null
    if (out.length + piece.length + closeLen + (opening ? opening.length + 3 : 0) + 1 > max) { out += '…'; break }
    out += piece
    i += step
    if (opening) { open.push(opening); closeLen += opening.length + 3 }
    else if (tag && piece) { while (open.length) { const t = open.pop()!; closeLen -= t.length + 3; if (t === tag[2].toLowerCase()) break } }
  }
  return out + open.map((t) => `</${t}>`).reverse().join('')
}

/** The same message as plain text (no tags, entities turned back into characters). */
export const plainText = (html: string) =>
  html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').slice(0, MAX_TEXT)

let lastShown = 0   // when a message was last sent or changed (Telegram stops showing "typing…" then)

/** Send or edit as HTML; if Telegram still can't read the HTML, the same words go as plain text. */
async function withHtml<T>(method: string, body: Record<string, unknown>, html: string): Promise<T> {
  let out: T
  try {
    out = await tg<T>(method, { ...body, text: safeHtml(html), parse_mode: 'HTML' })
  } catch (e) {
    if (!(e instanceof TelegramError) || !/can.t parse entities/i.test(e.message)) throw e
    out = await tg<T>(method, { ...body, text: plainText(html) })
  }
  lastShown = Date.now()
  markReply()   // the turn's first reply (lib/telegram/speed.ts)
  return out
}

/** Send an HTML message (always valid HTML, cut to Telegram's 4096-character limit). */
export const send = (chatId: number, html: string, buttons?: Button[][]) =>
  withHtml('sendMessage', {
    chat_id: chatId, link_preview_options: { is_disabled: true },
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  }, html)

export const typing = (chatId: number) => tg('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => null)

/**
 * "typing…" straight away, and again every 4 s until stop() (Telegram shows it for about 5 s, or until the next
 * message). A refresh is skipped right after a message went out, so it never reappears under a finished reply.
 */
export function keepTyping(chatId: number): () => void {
  const show = () => void soon(() => typing(chatId), { inOrder: false })   // tracked, so the run waits for it before it ends
  show()
  let since = Date.now()
  const timer = setInterval(() => {
    if (lastShown < since) show()
    since = Date.now()
  }, 4000)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** Remove a message's buttons once one has been tapped. */
export const clearButtons = (chatId: number, messageId: number) =>
  tg('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).catch(() => null)

export const answerTap = (id: string, text?: string) => tg('answerCallbackQuery', { callback_query_id: id, ...(text ? { text } : {}) }).catch(() => null)

/** Escape text for Telegram's HTML mode. */
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Change a message's text in place (no notification). */
export const editText = (chatId: number, messageId: number, html: string) =>
  withHtml('editMessageText', { chat_id: chatId, message_id: messageId, link_preview_options: { is_disabled: true } }, html)

/** Pin a message quietly at the top of the chat / unpin one (messages are never deleted). */
export const pin = (chatId: number, messageId: number) => tg('pinChatMessage', { chat_id: chatId, message_id: messageId, disable_notification: true })
export const unpin = (chatId: number, messageId: number) => tg('unpinChatMessage', { chat_id: chatId, message_id: messageId }).catch(() => null)

/** The bot's menu button opens the dashboard inside Telegram (a Mini App, signed in: app/tg). */
export const setCommands = (commands: { command: string; description: string }[]) => tg('setMyCommands', { commands })
export const setMenuButton = (chatId: number, url: string) =>
  tg('setChatMenuButton', { chat_id: chatId, menu_button: { type: 'web_app', text: 'Dashboard', web_app: { url } } })

/** Change a card in place: its text and its buttons (no notification). */
export const editCard = (chatId: number, messageId: number, html: string, buttons: Button[][]) =>
  withHtml('editMessageText', { chat_id: chatId, message_id: messageId, link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: buttons } }, html)

/** Send a file as a document (the study tracker's CSV export): multipart, with an optional HTML caption (≤ 1024). */
export async function sendDocument(chatId: number, file: { name: string; content: string; type?: string }, caption?: string): Promise<{ message_id?: number } | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new TelegramError('The bot token isn’t set up (TELEGRAM_BOT_TOKEN).')
  const form = new FormData()
  form.append('chat_id', String(chatId))
  form.append('document', new Blob([file.content], { type: file.type ?? 'text/csv' }), file.name)
  if (caption) { form.append('caption', safeHtml(caption, 1000)); form.append('parse_mode', 'HTML') }
  let res: Response
  try {
    res = await fetch(`${base()}/bot${token}/sendDocument`, { method: 'POST', body: form, cache: 'no-store' })
  } catch {
    throw new TelegramError('Couldn’t reach Telegram (sendDocument).')
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: { message_id?: number }; description?: string } | null
  if (!json?.ok) throw new TelegramError(clean(`Telegram sendDocument failed: ${json?.description ?? res.status}`))
  return json.result ?? null
}
