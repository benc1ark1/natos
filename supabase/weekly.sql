-- Queue item 7: the weekly check (overnight build, 19 Oct 2026).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run more than once. Nothing is dropped or deleted.
-- Until it runs, the weekly check still goes out; it just can't say which topics went up a colour this week.
--
-- One row per week, written by the app on the first 5-minute tick of the week (Monday just after midnight): each
-- topic's colour and last-done date, and each open mistake's redo stage, as the week began. Sunday's check compares
-- against it ("⬆️ 3 topics up a colour", "reviews 4/6", "3 mistakes redone"). Nothing for Nat to fill in or maintain.

create table if not exists public.weekly_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),   -- the Monday of the week
  topics jsonb not null default '{}'::jsonb,      -- { "<topic id>": ["understand", "2026-10-17"] } (colour, last done)
  mistakes jsonb not null default '{}'::jsonb,    -- { "<mistake id>": 0 } (redo stage)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start)
);

drop trigger if exists weekly_snapshots_set_updated_at on public.weekly_snapshots;
create trigger weekly_snapshots_set_updated_at before update on public.weekly_snapshots
  for each row execute function public.set_updated_at();

-- Row level security: owner only
alter table public.weekly_snapshots enable row level security;
drop policy if exists weekly_snapshots_owner_all on public.weekly_snapshots;
create policy weekly_snapshots_owner_all on public.weekly_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
