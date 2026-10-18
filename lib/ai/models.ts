// Which AI model does which job. To switch one, change its line and redeploy.
// Server-only use: the API key is read by the Anthropic client on the server, never here.

export const CHAT_MODEL = 'claude-sonnet-5-5'   // Telegram chat: reads every message, answers, cards (and Ask AI)
export const PLAN_MODEL = 'claude-opus-5-5'     // planning: plan my day/week, re-plans after a change
export const SORT_MODEL = 'claude-haiku-4-5'    // quick sorting of a new item into a card

export const CHAT_EFFORT = 'medium' as const    // how hard the chat model thinks: low · medium · high

/** US dollars per million tokens. Cache reads are cheap; cache writes cost 1.25× the input price. */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
}
// A model that isn't listed (e.g. a fallback) is costed at the highest price, so the meter never under-counts.
const UNKNOWN = { input: 10, output: 50, cacheRead: 0.25 }

export type Usage = {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** What one AI call cost, in US dollars. */
export function costOf(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')] ?? UNKNOWN
  const n = (x: number | null | undefined) => (typeof x === 'number' && x > 0 ? x : 0)
  return (n(u.input_tokens) * p.input + n(u.output_tokens) * p.output
    + n(u.cache_read_input_tokens) * p.cacheRead + n(u.cache_creation_input_tokens) * p.input * 1.25) / 1_000_000
}
