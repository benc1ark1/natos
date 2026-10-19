-- Queue item 3: Telegram speed (reply timings) and the ideas inbox (overnight build, 19 Oct 2026).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run more than once.
-- Only adds columns and an index; nothing is dropped or deleted. The bot works before this runs (it just doesn't log
-- reply times, and App ideas are saved without "what's needed").

-- ---------------------------------------------------------------
-- 1. Reply times: each of your messages records how long the bot took and which part answered it. /speed shows the
--    last 20. path: list (an exact list, no AI) · fast (a plug-in or plain-code fast path, no AI) · quick (the quick
--    router, Haiku) · brain (the full chat model) · simple (simple mode) · command (a / command).
-- ---------------------------------------------------------------
alter table public.telegram_turns add column if not exists path text check (path is null or char_length(path) between 1 and 20);
alter table public.telegram_turns add column if not exists ms_total integer check (ms_total is null or ms_total >= 0);   -- arrival to done
alter table public.telegram_turns add column if not exists ms_first integer check (ms_first is null or ms_first >= 0);   -- arrival to the first reply
create index if not exists telegram_turns_user_timed on public.telegram_turns (user_id, id desc) where ms_total is not null;

-- ---------------------------------------------------------------
-- 2. App ideas: besides your exact words (source_text) and a short title (request), what's needed to build it.
-- ---------------------------------------------------------------
alter table public.app_ideas add column if not exists needs text check (needs is null or char_length(needs) <= 500);

-- Row level security: both tables already allow only their owner (supabase/jarvis-a.sql, supabase/jarvis-g.sql);
-- new columns are covered by the same policies.

-- Check it worked (should show 4 rows):
-- select table_name, column_name from information_schema.columns where table_schema = 'public'
--   and ((table_name = 'telegram_turns' and column_name in ('path','ms_total','ms_first')) or (table_name = 'app_ideas' and column_name = 'needs'));
