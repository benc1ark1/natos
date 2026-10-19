// Item 5: the Today list, the morning message and the evening wrap-up.
// A bot plug-in (lib/telegram/plugin-types.ts, plans/contracts.md §8):
// - tick: the morning message once a day at 07:30 (setting briefAt; on holidays not before holidayWakeAt): Today's
//   ≤ 5 things with a time, exactly what to open and a tap each, plus the fixed line. It is the pinned Today.
//   (The evening message runs with the built-in ones in lib/telegram/schedule.ts, at endOfDayAt.)
// - taps `tdy:…`: tick / untick an item (lib/today/done.ts); the tap is his confirmation.
// - /today (the list; "/today all" = with the hidden ones) and /brief (the morning message; "/brief full" = the old
//   whole-day brief).
import 'server-only'
import type { BotPlugin } from '../plugin-types'
import { minutesOf } from '../../time'
import { morningAt } from '../../today/holidays'
import { onTodayTap, sendMorning, todayMessage } from '../../today/send'
import { buildFullBrief, loadDay } from '../brief'

const CATCH_UP_MIN = 180   // a missed tick still sends within 3 hours (like the old brief)

export const plugin: BotPlugin = {
  name: 'today',
  commands: [
    {
      command: 'today', description: 'Today: your few things, with a tap each',
      run: async (env) => todayMessage(env.sb, { now: env.now, all: /^(all|more|everything)\b/i.test(env.args) }),
    },
    {
      command: 'brief', description: 'This morning’s message again (/brief full: the whole day)',
      run: async (env) => {
        if (/^full\b/i.test(env.args)) {
          const b = await buildFullBrief(env.sb, await loadDay(env.sb, env.today), env.now, env.appUrl)
          return { html: b.html, buttons: b.buttons }
        }
        return todayMessage(env.sb, { now: env.now })
      },
    },
  ],
  tick: async (env) => {
    const at = morningAt(env.planning, env.today)
    const now = minutesOf(env.time)
    if (now >= minutesOf(at) && now < minutesOf(at) + CATCH_UP_MIN) await sendMorning(env.sb, env.chatId, env.now)
  },
  taps: [{ prefix: 'tdy', run: (sb, chatId, data, messageId) => onTodayTap(sb, chatId, data, messageId) }],
}
