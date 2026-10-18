-- Simplify, steps C and D (weekly target bonus + simple goals)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Nothing is dropped or deleted; existing rows keep their data.

-- ---------------------------------------------------------------
-- C. Weekly targets: optional bonus (e.g. Upper: target 2, bonus 3)
-- ---------------------------------------------------------------
alter table public.weekly_targets
  add column if not exists bonus_count integer;
alter table public.weekly_targets
  drop constraint if exists weekly_targets_bonus_check;
alter table public.weekly_targets
  add constraint weekly_targets_bonus_check
  check (bonus_count is null or bonus_count > target_count);

-- ---------------------------------------------------------------
-- D. Goals: a name, an optional date (none = ongoing), linked tasks.
-- Reuses the course schema's empty goals table (created here if missing).
-- ---------------------------------------------------------------
create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  period text check (period in ('week','month')),
  status text not null default 'active' check (status in ('active','completed','archived')),
  target_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
alter table public.goals alter column period drop not null;   -- goals no longer need a period
alter table public.goals add column if not exists archived_at timestamptz;

alter table public.tasks
  add column if not exists goal_id uuid references public.goals(id) on delete set null;
create index if not exists tasks_goal_idx on public.tasks(goal_id) where goal_id is not null;

-- Row level security: owner only
alter table public.goals enable row level security;
drop policy if exists goals_owner_all on public.goals;
create policy goals_owner_all on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
