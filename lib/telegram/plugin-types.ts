// The shapes a bot plug-in uses (plans/contracts.md §2). A plug-in adds one area to the bot (the study tracker, ACT,
// gym progress, events by chat, Today, the weekly check, help) without editing the shared files: its changes are
// checked, shown on the usual ✅ card, applied and undone exactly like the built-in ones (lib/telegram/actions.ts).
// This file imports nothing from the bot, so plug-ins can use it without import cycles.
import type { SupabaseClient } from '@supabase/supabase-js'

export type Button = { text: string; callback_data?: string; url?: string; web_app?: { url: string } }

/** What the brain (or a fast path) sends for each change ("" / 0 = not used). Same as RawAction in actions.ts. */
export type PluginRawAction = { op: string; ref: string; value: string; date: string; date_to: string; time: string; time_to: string; number: number; words: string }

/** A ref from the brain's snapshot, if the action named one ("PC1-03", "TS1"…). */
export type PluginRef = { kind: string; id: string; title: string; status: string | null; deadline: string | null }

/** One checked change, ready to show on the card and apply. `line` is the "before → after" text (HTML-escaped). */
export type PluginAction = {
  op: string
  table: string            // the main table it changes (for refs and logs)
  id: string | null        // the record it changes (null = a new one)
  title: string            // the record's real name
  line: string             // e.g. "PC1-01 Matrices: 🔴 → 🟡 (Bicen set 8/10 = 80%) · review Thu 22 Oct"
  patch: Record<string, unknown>
}

/** What was applied, so ↩️ Undo can put it back exactly (and only if nothing changed it since). */
export type PluginApplied = { op: string; table: string; id: string; title: string; before: Record<string, unknown> | null; after: Record<string, unknown> }

export type CheckEnv = {
  today: string                          // YYYY-MM-DD (Europe/London)
  said: string                           // his recent words (this message and the last 30 minutes)
  grounded: (words: string) => boolean   // are these date words really his?
  ref: PluginRef | undefined             // the snapshot ref the action named, if any
  others: PluginRawAction[]              // the other changes on the same card
}

export type FastEnv = {
  sb: SupabaseClient
  chatId: number
  today: string
  now: Date
  cardOpen: boolean        // a card is waiting for his tap (a fast path should not steal a correction to it)
  cardEditing: boolean     // he tapped ✏️ on it: his message is the correction, so fast paths are skipped
}

/** A message a plug-in understood without the AI. */
export type FastResult =
  // → checked, then the usual ✅ card. `refs`: the records its actions name ("E1" → that event), so a fast path can
  //   use built-in ops that need a ref (event_move, event_cancel, …) without the brain's snapshot
  | { kind: 'actions'; actions: PluginRawAction[]; head?: string; refs?: [string, PluginRef][] }
  | { kind: 'answer'; html: string; buttons?: Button[][] }                        // → sent as is (read-only)
  | { kind: 'idea'; request: string }                                             // → "I can't do that yet" + App ideas
  // → the plug-in already replied. `intent`: what it was, for the conversation log ('instruction' if it made a ✅ card;
  //   'question' when not given)
  | { kind: 'handled'; intent?: 'question' | 'instruction' | 'new' | 'plan' | 'chat' | 'unclear' }

export type CommandEnv = { sb: SupabaseClient; chatId: number; today: string; now: Date; args: string; appUrl: string | null }
export type CommandResult = { html: string; buttons?: Button[][] } | null

export type TickEnv = {
  sb: SupabaseClient
  chatId: number
  now: Date
  today: string
  time: string               // HH:MM now (Europe/London)
  planning: unknown          // profiles.planning
  /** Send once per key (claimed in telegram_sent first; released again if nothing went out). */
  once: (key: string, build: () => Promise<{ html: string; buttons?: Button[][] } | string | null>) => Promise<void>
}

/** Lines the plug-in adds to the brain's snapshot, and the refs they mention. */
export type SnapshotPart = { sections: { title: string; lines: string[] }[]; refs: [string, PluginRef][] }

export type BotPlugin = {
  name: string
  /** Changes it owns (names must not clash with lib/telegram/actions.ts OPS). */
  ops?: readonly string[]
  /** Lines for the brain prompt under "Changes" (how to fill op/ref/value/date/number/words for its ops). Keep short. */
  prompt?: string
  /** Read what check() needs for these actions (as Nat, under RLS). */
  loadRows?: (sb: SupabaseClient, raw: PluginRawAction[], today: string) => Promise<unknown>
  check?: (op: string, raw: PluginRawAction, rows: unknown, env: CheckEnv) => { action?: PluginAction; problem?: string }
  apply?: (sb: SupabaseClient, a: PluginAction, now: string, today: string) => Promise<PluginApplied>
  undo?: (sb: SupabaseClient, a: PluginApplied, today: string) => Promise<'undone' | 'skipped'>
  /** After ✅ applied its changes: an extra line or two for the "Done" message ("Next: Integral topic assessment"). */
  afterApply?: (sb: SupabaseClient, applied: PluginApplied[], today: string) => Promise<string | null>
  /** Snapshot lines for the brain (its records with refs), read once per message. */
  snapshot?: (sb: SupabaseClient, today: string) => Promise<SnapshotPart>
  /** Messages it understands without the AI (strict patterns only; return null when unsure). */
  fast?: (message: string, env: FastEnv) => Promise<FastResult | null>
  /** Slash commands ("/maths"). Checked before the built-in ones. */
  commands?: { command: string; description: string; run: (env: CommandEnv) => Promise<CommandResult> }[]
  /** Runs on every 5-minute tick, after the built-in messages. */
  tick?: (env: TickEnv) => Promise<void>
  /** Button taps it owns: callback_data starting with `${prefix}:` (prefix: 2–6 lowercase letters, not one of the bot's own). */
  taps?: { prefix: string; run: (sb: SupabaseClient, chatId: number, data: string, messageId: number | undefined) => Promise<void> }[]
}
