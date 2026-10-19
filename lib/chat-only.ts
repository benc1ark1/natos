// "hello", "ok thanks", "that okay maybe", "👍": chat, never a task or an Inbox item. Pure: no database (used by the
// bot before it makes a card, and by every raw save to Inbox, so a failed sort can't keep chat as an item either).

const CHAT = new Set([
  'hi', 'hii', 'hey', 'heyy', 'hello', 'hiya', 'yo', 'sup', 'morning', 'evening', 'night', 'gm', 'gn', 'good', 'afternoon',
  'ok', 'okay', 'okk', 'k', 'kk', 'alright', 'aight', 'fine', 'sure', 'cool', 'nice', 'great', 'perfect', 'lovely', 'sweet',
  'thanks', 'thank', 'you', 'u', 'ty', 'thx', 'cheers', 'ta', 'mate', 'bro', 'man',
  'yes', 'yeah', 'yep', 'yup', 'no', 'nah', 'nope', 'maybe', 'perhaps', 'probably',
  'that', 'thats', 'this', 'it', 'its', 'is', 'was', 'be', 'will', 'do', 'so', 'and', 'then', 'too', 'very', 'much', 'a', 'lot', 'all',
  'lol', 'haha', 'hahaha', 'hmm', 'hm', 'mm', 'oh', 'ah', 'wow', 'oops', 'sorry', 'np', 'right', 'got', 'gotcha', 'noted', 'understood',
])

/** Only greetings, acknowledgements and filler (or only emoji/punctuation): nothing to save. */
export function isChatOnly(text: string): boolean {
  const t = text.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]+/g, ' ').trim()
  if (!t) return true
  const words = t.split(/\s+/)
  return words.length <= 6 && words.every((w) => CHAT.has(w.replace(/^(h+m+|m+)$/, 'hmm').replace(/^(ha)+h?$/, 'haha')))
}
