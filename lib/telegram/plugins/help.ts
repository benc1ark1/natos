// Item 8: how to use (/help). A bot plug-in (lib/telegram/plugin-types.ts, plans/contracts.md §11).
// /help, "/help all" and /start themselves are answered in lib/telegram/bot.ts before the queue; this plug-in answers
// the same guide (with his times) when he asks in words ("help", "what can you do?"), and every command for
// "commands" / "all commands", with no AI. The guide is lib/help.ts.
import type { BotPlugin } from '../plugin-types'
import { helpCommandsTelegram, helpTelegram } from '../../help'

/** "help", "how do I use this?", "what can you do?", "what can I say?" (strict: the whole message). */
export const HELP_WORDS = /^(?:(?:hey |ok |so )?(?:help(?: me)?|how do i use (?:this|you|it|nat os|the bot|the app)|how does (?:this|it|nat os|the bot) work|what can you do|what can i (?:say|send|ask|type)(?: you)?|user guide|how to use(?: this| nat os)?))$/
/** "commands", "show me the commands", "all commands", "list commands". */
export const COMMAND_WORDS = /^(?:(?:show me |list |send me )?(?:the |your |all (?:the |your )?|all )?commands)$/

const normal = (m: string) => m.toLowerCase().replace(/[’']/g, "'").replace(/[?!.]+$/, '').replace(/\s+/g, ' ').trim()

export const plugin: BotPlugin = {
  name: 'help',
  fast: async (message, env) => {
    const m = normal(message)
    if (COMMAND_WORDS.test(m)) return { kind: 'answer', html: helpCommandsTelegram() }
    if (!HELP_WORDS.test(m)) return null
    let planning: unknown = null
    try {
      const { data, error } = await env.sb.from('profiles').select('planning').maybeSingle()
      if (!error) planning = data?.planning ?? null
    } catch { /* the default times */ }
    return { kind: 'answer', html: helpTelegram(planning) }
  },
}
