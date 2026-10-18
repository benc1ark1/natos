-- Jarvis phase D2: "ready for anything" (plans/jarvis.md, my-spec 31 and 44).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-d1.sql first.
-- Safe to re-run. Only adds columns and one table; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- D2a. What kind of training each session is, so the rules can be checked.
-- Empty = guessed from the name (Owen -> sprint, Match -> match, Lower -> lower…) until you set it in Telegram
-- ("Owen's sessions are sprints").
-- ---------------------------------------------------------------
alter table public.weekly_targets add column if not exists training_type text
  check (training_type is null or training_type in ('upper','lower','plyo','sprint','football','match','gym','other'));
alter table public.weekly_targets add column if not exists load text check (load is null or load in ('hard','light'));
alter table public.weekly_targets add column if not exists session_minutes integer check (session_minutes is null or session_minutes between 10 and 240);

alter table public.events add column if not exists training_type text
  check (training_type is null or training_type in ('upper','lower','plyo','sprint','football','match','gym','other'));
alter table public.events add column if not exists load text check (load is null or load in ('hard','light'));

-- ---------------------------------------------------------------
-- D2b. Training rules as editable data (my-spec 31: "editable, check with Owen").
-- No rows = the five defaults built into the app. Once you change one in Telegram, all of them are saved here,
-- so each can be switched off or changed. Rules are never deleted, only switched off.
--   kind 'gap':          what [types] not within `days` days before/after/either side of near [types]
--   kind 'max_hard':     at most n hard sessions a day, except allowed pairs (e.g. upper + football)
--   kind 'after_double': after a day with two hard sessions, no hard session the next day
-- ---------------------------------------------------------------
create table if not exists public.training_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('gap','max_hard','after_double')),
  params jsonb not null default '{}'::jsonb,
  label text not null check (char_length(trim(label)) between 1 and 200),
  enabled boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists training_rules_set_updated_at on public.training_rules;
create trigger training_rules_set_updated_at before update on public.training_rules
  for each row execute function public.set_updated_at();

alter table public.training_rules enable row level security;
drop policy if exists training_rules_owner_all on public.training_rules;
create policy training_rules_owner_all on public.training_rules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
