-- Queue item 6: training and gym progress (overnight build, 19 Oct 2026).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run more than once. Nothing is dropped or deleted.
-- One row per exercise per session ("bench 80x5x3" = 80 kg, 5 reps, 3 sets). Hevy CSV rows import once (source_ref).

create table if not exists public.lift_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  done_on date not null default current_date,
  exercise text not null check (char_length(trim(exercise)) between 1 and 80),     -- as he wrote it / Hevy's title
  exercise_key text not null check (char_length(trim(exercise_key)) between 1 and 80),   -- normalised ('bench press')
  weight_kg numeric(6,2) not null check (weight_kg >= 0 and weight_kg <= 500),
  reps smallint not null check (reps between 1 and 100),
  sets smallint not null default 1 check (sets between 1 and 20),
  rpe numeric(3,1) check (rpe is null or rpe between 1 and 10),
  source text not null default 'chat' check (source in ('chat', 'hevy', 'app')),
  source_ref text check (source_ref is null or char_length(source_ref) <= 300),   -- Hevy: workout start | exercise | set number
  notes text check (notes is null or char_length(notes) <= 500),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lift_sets_user_idx on public.lift_sets (user_id, exercise_key, done_on) where archived_at is null;
create unique index if not exists lift_sets_source_ref_once on public.lift_sets (user_id, source_ref) where source_ref is not null;

drop trigger if exists lift_sets_set_updated_at on public.lift_sets;
create trigger lift_sets_set_updated_at before update on public.lift_sets for each row execute function public.set_updated_at();
alter table public.lift_sets enable row level security;
drop policy if exists lift_sets_owner_all on public.lift_sets;
create policy lift_sets_owner_all on public.lift_sets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
