-- Jarvis phase D1: "plan my day" (plans/jarvis.md, my-spec 44).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-c1.sql first.
-- Safe to re-run. Only adds two tables and widens one check; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- D1a. The day's plan: time blocks Nat applied with ✅ (Home, the morning brief and the pinned Today show them).
-- A re-plan marks the old blocks 'replaced'; ↩️ Undo marks them 'cancelled'. Never deleted.
-- ---------------------------------------------------------------
create table if not exists public.plan_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id uuid not null,                       -- the card that made it (one plan = one card)
  on_date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  title text not null check (char_length(trim(title)) between 1 and 200),
  kind text not null default 'focus' check (kind in ('focus','light','training','rest')),
  task_id uuid references public.tasks(id) on delete set null,
  target_id uuid references public.weekly_targets(id) on delete set null,
  goal_id uuid references public.goals(id) on delete set null,
  status text not null default 'planned' check (status in ('planned','done','replaced','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists plan_blocks_user_date on public.plan_blocks (user_id, on_date) where status = 'planned';
drop trigger if exists plan_blocks_set_updated_at on public.plan_blocks;
create trigger plan_blocks_set_updated_at before update on public.plan_blocks
  for each row execute function public.set_updated_at();

alter table public.plan_blocks enable row level security;
drop policy if exists plan_blocks_owner_all on public.plan_blocks;
create policy plan_blocks_owner_all on public.plan_blocks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- D1b. How Nat is that day ("I'm ill today", "wrecked after training"): makes that day's plan lighter.
-- Later Whoop recovery can fill this in.
-- ---------------------------------------------------------------
create table if not exists public.day_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  on_date date not null,
  energy text check (energy in ('normal','tired','ill')),
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, on_date)
);
drop trigger if exists day_state_set_updated_at on public.day_state;
create trigger day_state_set_updated_at before update on public.day_state
  for each row execute function public.set_updated_at();

alter table public.day_state enable row level security;
drop policy if exists day_state_owner_all on public.day_state;
create policy day_state_owner_all on public.day_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- D1c. Plan cards in Telegram (kind 'plan').
-- ---------------------------------------------------------------
alter table public.telegram_pending drop constraint if exists telegram_pending_kind_check;
alter table public.telegram_pending add constraint telegram_pending_kind_check
  check (kind in ('capture','fact','action','plan'));

-- D1d. The conversation memory knows plan messages too.
alter table public.telegram_turns drop constraint if exists telegram_turns_intent_check;
alter table public.telegram_turns add constraint telegram_turns_intent_check
  check (intent in ('new','question','correction','instruction','plan','chat','unclear','command','tap','failed'));
