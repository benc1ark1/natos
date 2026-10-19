// Server-only: every bot plug-in, in the order their fast paths are tried (most specific first), and the small
// helpers the shared bot files use to call them (plans/contracts.md §2). A plug-in that throws never breaks the bot:
// its fast path / snapshot / tick is skipped and the message goes on to the brain as before.
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BotPlugin, CommandEnv, FastEnv, FastResult, PluginApplied, SnapshotPart, TickEnv } from '../plugin-types'
import { plugin as act } from './act'
import { plugin as gym } from './gym'
import { plugin as tracker } from './tracker'
import { plugin as life } from './life'
import { plugin as today } from './today'
import { plugin as weekly } from './weekly'
import { plugin as help } from './help'

export const PLUGINS: readonly BotPlugin[] = [act, gym, tracker, life, today, weekly, help]

/** Every op a plug-in owns. Checked once: two plug-ins can't own the same op. */
export const PLUGIN_OPS: readonly string[] = (() => {
  const seen = new Map<string, string>()
  for (const p of PLUGINS) for (const op of p.ops ?? []) {
    if (seen.has(op)) throw new Error(`plug-ins ${seen.get(op)} and ${p.name} both own the op "${op}"`)
    seen.set(op, p.name)
  }
  return [...seen.keys()]
})()

export const pluginFor = (op: string): BotPlugin | null => PLUGINS.find((p) => p.ops?.includes(op)) ?? null

/** The plug-ins' lines for the brain prompt (stable text, so the prompt cache keeps working). */
export const pluginPrompt = (): string => PLUGINS.map((p) => p.prompt?.trim()).filter(Boolean).join('\n')

/** The first plug-in that understands the message without the AI. */
export async function runFast(message: string, env: FastEnv): Promise<{ plugin: BotPlugin; result: FastResult } | null> {
  if (env.cardEditing) return null
  for (const p of PLUGINS) {
    if (!p.fast) continue
    try {
      const result = await p.fast(message, env)
      if (result) return { plugin: p, result }
    } catch { /* a broken fast path never blocks the message: the brain still gets it */ }
  }
  return null
}

/** "/maths 3" → the plug-in command for it (plug-in commands win over the bot's own). */
export function pluginCommand(text: string): { run: (env: CommandEnv) => Promise<{ html: string; buttons?: import('../plugin-types').Button[][] } | null>; args: string } | null {
  const m = text.match(/^\/([a-z0-9_]+)(?:@\w+)?\b\s*([\s\S]*)$/i)
  if (!m) return null
  const name = m[1].toLowerCase()
  for (const p of PLUGINS) for (const c of p.commands ?? []) if (c.command === name) return { run: c.run, args: m[2].trim() }
  return null
}

/** The plug-ins' "/" menu entries. */
export const pluginCommands = (): { command: string; description: string }[] =>
  PLUGINS.flatMap((p) => (p.commands ?? []).map((c) => ({ command: c.command, description: c.description })))

/** Every plug-in's snapshot lines for the brain, read in parallel (a failing one is left out). */
export async function pluginSnapshots(sb: SupabaseClient, today: string): Promise<SnapshotPart> {
  const parts = await Promise.all(PLUGINS.map((p) => (p.snapshot ? p.snapshot(sb, today).catch(() => null) : Promise.resolve(null))))
  return { sections: parts.flatMap((x) => x?.sections ?? []), refs: parts.flatMap((x) => x?.refs ?? []) }
}

/** The plug-ins' messages on the 5-minute tick (each one on its own: one failing doesn't stop the others). */
export async function runPluginTicks(env: TickEnv): Promise<void> {
  for (const p of PLUGINS) {
    if (!p.tick) continue
    try { await p.tick(env) } catch { /* the next tick tries again */ }
  }
}

/** A button tap a plug-in owns ("trk:done:…"). */
export function pluginTap(data: string): ((sb: SupabaseClient, chatId: number, data: string, messageId: number | undefined) => Promise<void>) | null {
  const m = data.match(/^([a-z]{2,6}):/)
  if (!m) return null
  for (const p of PLUGINS) for (const t of p.taps ?? []) if (t.prefix === m[1]) return t.run
  return null
}

/** After ✅: each plug-in's extra lines for the changes it applied ("Next: …"). */
export async function pluginAfterApply(sb: SupabaseClient, applied: { op: string }[], today: string): Promise<string[]> {
  const out: string[] = []
  for (const p of PLUGINS) {
    if (!p.afterApply || !p.ops?.length) continue
    const mine = applied.filter((a) => p.ops!.includes(a.op)) as PluginApplied[]
    if (!mine.length) continue
    try { const line = await p.afterApply(sb, mine, today); if (line) out.push(line) } catch { /* the change itself is saved */ }
  }
  return out
}
