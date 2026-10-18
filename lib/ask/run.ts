// Server-only: Ask AI. Answers a question from Nat's own data, or drafts the week for the check-in.
// Read-only: saves nothing. Shared by the dashboard (app/api/ask) and the Telegram bot.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ANSWER_SCHEMA, ASK_MODEL, SYSTEM_PROMPT, WEEK_SCHEMA, askMessage, checkAnswer, checkWeek, checkinRange,
  historyMessages, loadPlannerContext, weekPrompt, type RawAnswer, type RawWeek,
} from './server'
import type { AskResult, Turn, WeekPlanResult } from './types'
import { recordUsage } from '../ai/usage'

type Args = { mode: 'ask'; question: string; history?: Turn[] } | { mode: 'week' }

export async function runAsk(sb: SupabaseClient, args: { mode: 'ask'; question: string; history?: Turn[] }): Promise<AskResult>
export async function runAsk(sb: SupabaseClient, args: { mode: 'week' }): Promise<WeekPlanResult>
export async function runAsk(sb: SupabaseClient, args: Args): Promise<AskResult | WeekPlanResult> {
  const fail = (error: string) => ({ ok: false as const, error })
  const question = args.mode === 'ask' ? args.question.trim().slice(0, 1000) : ''
  if (args.mode === 'ask' && !question) return fail('Ask a question first.')
  if (!process.env.ANTHROPIC_API_KEY) return fail('The AI key isn’t set up (ANTHROPIC_API_KEY).')

  let ctx
  try { ctx = await loadPlannerContext(sb) } catch (e) { return fail(e instanceof Error ? e.message : 'Couldn’t read your data.') }

  const range = checkinRange(ctx.today)
  const client = new Anthropic({ timeout: 55_000, maxRetries: 1 })
  let text: string
  try {
    const res = await client.beta.messages.create({
      model: ASK_MODEL,
      max_tokens: 8000,
      // If the model declines, the API retries on a fallback model automatically.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: args.mode === 'week' ? `${SYSTEM_PROMPT}\n\n${weekPrompt(range.from, range.to)}` : SYSTEM_PROMPT,
      messages: [
        ...(args.mode === 'ask' ? historyMessages(args.history ?? []) : []),
        { role: 'user', content: askMessage(ctx, args.mode === 'week' ? `Draft my week from ${range.from} to ${range.to}.` : question) },
      ],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: args.mode === 'week' ? WEEK_SCHEMA : ANSWER_SCHEMA } },
    })
    await recordUsage(sb, 'ask', res.model ?? ASK_MODEL, res.usage)
    if (res.stop_reason === 'refusal') return fail('The AI declined to answer that.')
    if (res.stop_reason === 'max_tokens') return fail('The AI’s answer was cut off. Try a narrower question.')
    const block = res.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') return fail('The AI gave no answer.')
    text = block.text
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail('The AI key was rejected. Check ANTHROPIC_API_KEY.')
    if (e instanceof Anthropic.RateLimitError) return fail('The AI is busy (rate limit). Try again in a minute.')
    if (e instanceof Anthropic.APIConnectionTimeoutError) return fail('The AI took too long to answer. Try again.')
    if (e instanceof Anthropic.APIError) return fail(`AI error ${e.status ?? ''}: ${e.message}`.trim())
    return fail(e instanceof Error ? e.message : 'The AI call failed.')
  }

  try {
    if (args.mode === 'week') {
      const { plan, notes } = checkWeek(JSON.parse(text) as RawWeek, ctx, range.from, range.to)
      return { ok: true, plan, notes }
    }
    return { ok: true, answer: checkAnswer(JSON.parse(text) as RawAnswer, ctx) }
  } catch {
    return fail('The AI’s answer wasn’t readable. Try again.')
  }
}
