# The ideas inbox

When you ask the bot for something it can't do yet, it says so in one line:
**"I can't do that yet — it needs adding in Claude Code."** It saves the request to your **App ideas** with your exact
words, a short title, what's needed to build it, and the date. Nothing else changes.

## The routine

1. **The bot saves it.** Just ask for things normally. Anything it can't do goes into App ideas by itself.
   Didn't mean it? Tap **↩️ Undo** under the reply.
2. **Send /ideas.** When you have time to build (a Sunday, a free evening), send `/ideas`. You get **one block** with
   every open idea, numbered, oldest first: your words, what's needed and the date, plus a last line telling Claude how
   to work through them.
3. **Paste it into Claude Code.** Tap the block in Telegram to copy it. Paste it into Claude Code in the natos folder.
4. **Claude builds one at a time.** It proposes a plan for idea 1 and waits for your **"go"**. It builds and tests it,
   then you deploy as usual.
5. **Mark it done.** Send `/ideas done 1` (or `/ideas drop 1` if you don't want it any more). The numbers are the ones
   in your latest `/ideas` list.

## Good to know

- Ideas are never deleted. Done and dropped ones are kept, just marked.
- Vague requests aren't saved. The bot asks what you mean first.
- Before `supabase/speed.sql` has been run, ideas are saved without "what's needed". The block then shows the short
  title instead, and Claude asks you for the details.
- Claude checks open ideas when planning work, but only builds one when you ask (CLAUDE.md).
