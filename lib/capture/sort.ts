// Server-only: sorts one captured note with the AI and returns a proposal. Saves nothing.
// Shared by the dashboard (app/api/capture) and the Telegram bot.
import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { recordUsage, type Feature } from '../ai/usage'
import { CAPTURE_MODEL, OUTPUT_SCHEMA, SYSTEM_PROMPT, checkProposal, contextMessage, findDuplicates, loadContext, nullify, type RawOutput } from './server'
import { KIND_LABELS, type CaptureKind, type CaptureResult } from './types'

const fail = (error: string): CaptureResult => ({ ok: false, error })

/** kind: Nat has said what it is ("make it a real task"), so the sorter must use that kind. feature: whose cost it is
 *  on the AI meter (the email watcher's homework cards count as 'mail'). */
export async function sortCapture(sb: SupabaseClient, input: string, opts: { kind?: CaptureKind; feature?: Feature } = {}): Promise<CaptureResult> {
  const text = input.trim().slice(0, 1000)
  if (!text) return fail('Nothing to sort.')
  if (!process.env.ANTHROPIC_API_KEY) return fail('The AI key isn’t set up (ANTHROPIC_API_KEY in .env.local).')

  let ctx
  try { ctx = await loadContext(sb) } catch (e) { return fail(e instanceof Error ? e.message : 'Couldn’t read your context.') }

  const client = new Anthropic({ timeout: 20_000, maxRetries: 1 })
  let raw: RawOutput
  try {
    const res = await client.messages.create({
      model: CAPTURE_MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contextMessage(text, ctx) + (opts.kind ? `\n\nNat has said this is a ${KIND_LABELS[opts.kind].toLowerCase()}: use kind "${opts.kind}".` : '') }],
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    })
    await recordUsage(sb, opts.feature ?? 'sort', res.model ?? CAPTURE_MODEL, res.usage)
    if (res.stop_reason === 'refusal') return fail('The AI declined to sort this.')
    if (res.stop_reason === 'max_tokens') return fail('The AI’s answer was cut off.')
    const block = res.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') return fail('The AI gave no answer.')
    raw = nullify(JSON.parse(block.text))
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail('The AI key was rejected. Check ANTHROPIC_API_KEY.')
    if (e instanceof Anthropic.RateLimitError) return fail('The AI is busy (rate limit). Try again in a minute.')
    if (e instanceof Anthropic.APIConnectionTimeoutError) return fail('The AI took too long to answer.')
    if (e instanceof Anthropic.APIError) return fail(`AI error ${e.status ?? ''}: ${e.message}`.trim())
    if (e instanceof SyntaxError) return fail('The AI’s answer wasn’t readable.')
    return fail(e instanceof Error ? e.message : 'The AI call failed.')
  }

  const proposal = checkProposal(raw, text, ctx)
  // A task and an idea hold the same fields, so Nat's word decides between them even if the sorter disagreed.
  if (opts.kind && proposal.kind !== opts.kind && ['task', 'idea'].includes(opts.kind) && ['task', 'idea'].includes(proposal.kind)) {
    proposal.kind = opts.kind
  }
  return { ok: true, proposal, duplicates: findDuplicates(proposal, text, ctx) }
}
