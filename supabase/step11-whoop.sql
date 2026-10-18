-- Build 2, phase J (11 Oct): Whoop (BUILD-GUIDE step 11, my-spec 25/31). plans/build-2.md.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/step11-google.sql first (it makes the
-- integrations table Whoop's sign-in is stored in, encrypted). Safe to re-run. Adds two tables and one column.
-- No data is dropped or deleted.

-- ---------------------------------------------------------------
-- Ja. One row per day from Whoop: recovery (and HRV, resting heart rate), last night's sleep, the day's strain.
-- The day is the morning he woke up (London).
-- ---------------------------------------------------------------
create table if not exists public.whoop_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  on_date date not null,
  recovery integer check (recovery is null or recovery between 0 and 100),   -- %
  hrv numeric(6,1),                             -- ms
  resting_hr integer,
  sleep_minutes integer check (sleep_minutes is null or sleep_minutes between 0 and 1440),
  sleep_performance integer check (sleep_performance is null or sleep_performance between 0 and 100),   -- %
  strain numeric(4,1) check (strain is null or strain between 0 and 21),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, on_date)
);
drop trigger if exists whoop_days_set_updated_at on public.whoop_days;
create trigger whoop_days_set_updated_at before update on public.whoop_days for each row execute function public.set_updated_at();
alter table public.whoop_days enable row level security;
drop policy if exists whoop_days_owner_all on public.whoop_days;
create policy whoop_days_owner_all on public.whoop_days for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Jb. Workouts Whoop recorded. One that matches a weekly target's Whoop activities is logged toward it once
-- (target_logs source 'whoop', external_id = the workout's id, which the existing unique index keeps single).
-- ---------------------------------------------------------------
create table if not exists public.whoop_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  whoop_id text not null,
  sport text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  strain numeric(4,1),
  created_at timestamptz not null default now(),
  unique (user_id, whoop_id)
);
alter table public.whoop_workouts enable row level security;
drop policy if exists whoop_workouts_owner_all on public.whoop_workouts;
create policy whoop_workouts_owner_all on public.whoop_workouts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Jc. Which Whoop activities count toward a weekly target (his choice, e.g. Upper ← "Weightlifting").
-- Empty = none (nothing counts on its own until he says).
-- ---------------------------------------------------------------
alter table public.weekly_targets add column if not exists whoop_sports text[] not null default '{}';
