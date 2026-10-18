-- Jarvis phase A: conversation memory, ✏️ Edit that waits for the correction, AI usage meter + daily cap.
-- (plans/jarvis.md, my-spec section 44)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/step9-telegram.sql first.
-- Safe to re-run. Only adds tables, a column, and two widened checks; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- A1. The conversation: your messages and the bot's replies (the last ~10 / 30 min are the bot's memory).
-- Your messages queue here first, so they're handled one at a time in the order you sent them.
-- ---------------------------------------------------------------
create table if not exists public.telegram_turns (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('nat','bot')),
  text text not null default '' check (char_length(text) <= 4000),
  tg_message_id bigint,                                   -- Telegram's message number (orders and de-duplicates)
  status text not null default 'done' check (status in ('queued','working','done')),
  intent text check (intent in ('new','question','correction','instruction','chat','unclear','command','tap','failed')),
  pending_id uuid references public.telegram_pending(id) on delete set null,   -- the card this turn was about
  refs jsonb not null default '[]'::jsonb,                -- records it was about: [{"kind":"task","id":"…","title":"…"}]
  created_at timestamptz not null default now(),
  unique (user_id, tg_message_id)                         -- the same Telegram message is never handled twice
);
create index if not exists telegram_turns_user_created on public.telegram_turns (user_id, created_at desc);
create index if not exists telegram_turns_user_queued on public.telegram_turns (user_id, tg_message_id) where status <> 'done';

alter table public.telegram_turns enable row level security;
drop policy if exists telegram_turns_owner_all on public.telegram_turns;
create policy telegram_turns_owner_all on public.telegram_turns for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- One row per person: "the bot is busy with your messages until …" (so two messages never run at once).
create table if not exists public.telegram_state (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  busy_until timestamptz,
  updated_at timestamptz not null default now()
);
drop trigger if exists telegram_state_set_updated_at on public.telegram_state;
create trigger telegram_state_set_updated_at before update on public.telegram_state
  for each row execute function public.set_updated_at();

alter table public.telegram_state enable row level security;
drop policy if exists telegram_state_owner_all on public.telegram_state;
create policy telegram_state_owner_all on public.telegram_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- A2. Cards: ✏️ Edit now sets 'editing' (the card waits for your correction) instead of cancelling it,
-- and a corrected card marks the old one 'replaced'. Rows are still never deleted.
-- ---------------------------------------------------------------
alter table public.telegram_pending drop constraint if exists telegram_pending_status_check;
alter table public.telegram_pending add constraint telegram_pending_status_check
  check (status in ('open','editing','saved','cancelled','replaced'));

-- ---------------------------------------------------------------
-- A3. AI usage meter: one row per AI call (which model, tokens, cost in US dollars). /usage reads it.
-- ---------------------------------------------------------------
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  feature text not null check (char_length(feature) between 1 and 30),   -- chat, sort, ask, plan
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(10,6) not null default 0 check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_user_created on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
drop policy if exists ai_usage_owner_all on public.ai_usage;
create policy ai_usage_owner_all on public.ai_usage for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Daily AI spending cap for the bot (US dollars). Past it, the bot switches to simple mode until midnight.
-- Change it in Telegram with /cap 2 (or here).
alter table public.profiles add column if not exists ai_daily_cap_usd numeric(6,2) not null default 1.50
  check (ai_daily_cap_usd >= 0 and ai_daily_cap_usd <= 100);

-- Check it worked (should show 3 rows):
-- select table_name from information_schema.tables where table_schema = 'public' and table_name in ('telegram_turns','telegram_state','ai_usage');
