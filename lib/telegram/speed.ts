// Server-only: how fast the bot answers (queue item 3). Two small tools the bot files share:
// - a per-turn clock (when the message arrived, when the first reply went out, which path answered it), logged on
//   telegram_turns after supabase/speed.sql and shown by /speed;
// - writes the reply doesn't have to wait for (the memory of a reply, a card's message number, the AI meter). They
//   run in order, one after another, and the bot waits for all of them before it reads the next message and before it
//   finishes (flushWrites), so nothing is ever read stale and nothing is lost when the function ends.
// Imports nothing from the bot, so every bot file can use it.
import 'server-only'
import { AsyncLocalStorage } from 'node:async_hooks'

/** Which part of the bot answered: an exact list (no AI) · a plug-in / plain-code fast path (no AI) · the quick router
 *  (Haiku) · the full brain · simple mode (AI limit reached or AI down) · a slash command. */
export type Path = 'list' | 'fast' | 'quick' | 'brain' | 'simple' | 'command'
export type Clock = { start: number; first: number | null; path: Path | null }

const store = new AsyncLocalStorage<Clock>()

/** Run `fn` with its own clock, started at `start` (ms). */
export function runTimed<T>(start: number, fn: () => Promise<T>): { clock: Clock; done: Promise<T> } {
  const clock: Clock = { start, first: null, path: null }
  return { clock, done: store.run(clock, fn) }
}

/** A message went out (called by lib/telegram/api.ts): the first one is the turn's "first reply". */
export function markReply(): void {
  const c = store.getStore()
  if (c && c.first == null) c.first = Date.now()
}

/** The path that answered this turn (the last one marked wins: the router handing over to the brain = brain). */
export function markPath(path: Path): void {
  const c = store.getStore()
  if (c) c.path = path
}

/** The turn's numbers for telegram_turns (ms since the message arrived). */
export const timingOf = (c: Clock) => ({
  ms_total: Math.max(0, Date.now() - c.start),
  ms_first: c.first == null ? null : Math.max(0, c.first - c.start),
  path: c.path,
})

let chain: Promise<void> = Promise.resolve()
const open = new Set<Promise<void>>()

/**
 * A write the reply doesn't wait for. Inside a turn or a tap it runs in the background (in order with the others) and
 * the returned promise resolves at once; anywhere else (the 5-minute tick) it is simply awaited. Never throws: these
 * writes are helps (the memory, a message number, the meter), never something Nat is told was saved.
 * `inOrder: false` for a write whose order doesn't matter (it starts at once instead of after the ones before it).
 */
export function soon(write: () => PromiseLike<unknown>, opts: { inOrder?: boolean } = {}): Promise<void> {
  const run = opts.inOrder === false ? Promise.resolve().then(() => write()) : chain.then(() => write())
  const p = run.then(() => undefined, () => undefined)
  if (opts.inOrder !== false) chain = p
  open.add(p)
  void p.then(() => open.delete(p))
  return store.getStore() ? Promise.resolve() : p
}

/** Wait until every background write has finished. */
export async function flushWrites(): Promise<void> {
  while (open.size) await Promise.all([...open])
}
