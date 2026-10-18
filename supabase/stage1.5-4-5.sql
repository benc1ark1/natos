-- Stage 1.5, steps 4 + 5: calendar editing, "just this week" changes,
-- travel minutes, and training sessions that count toward weekly targets.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Only adds a table and columns; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- Step 4a. One-week changes to an event (keyed by its usual date):
-- cancelled, moved (new day/times), or marked missed (step 5).
-- Undo flips the fields back; rows are never deleted.
-- ---------------------------------------------------------------
create table if not exists public.event_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  on_date date not null,                       -- the date it would normally happen
  cancelled boolean not null default false,    -- not happening this week
  new_date date,                               -- moved: new day (same week)
  new_start time,                              -- moved: new start time
  new_end time,                                -- moved: new end time
  missed boolean not null default false,       -- step 5: happened in the calendar, but I didn't go
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, event_id, on_date)
);

drop trigger if exists event_exceptions_set_updated_at on public.event_exceptions;
create trigger event_exceptions_set_updated_at before update on public.event_exceptions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- Step 4b. Travel time each way; busy time = event + travel before and after
-- ---------------------------------------------------------------
alter table public.events
  add column if not exists travel_minutes integer not null default 0;
alter table public.events drop constraint if exists events_travel_minutes_check;
alter table public.events add constraint events_travel_minutes_check
  check (travel_minutes between 0 and 240);

-- ---------------------------------------------------------------
-- Step 5. A calendar event can count toward a weekly target
-- (e.g. club football -> "Team"), and a target counts either
-- Log taps ('logs') or its linked calendar sessions ('events').
-- ---------------------------------------------------------------
alter table public.events
  add column if not exists target_id uuid references public.weekly_targets(id) on delete set null;

alter table public.weekly_targets
  add column if not exists counts_from text not null default 'logs';
alter table public.weekly_targets drop constraint if exists weekly_targets_counts_from_check;
alter table public.weekly_targets add constraint weekly_targets_counts_from_check
  check (counts_from in ('logs','events'));

-- ---------------------------------------------------------------
-- Row level security: owner only
-- ---------------------------------------------------------------
alter table public.event_exceptions enable row level security;
drop policy if exists event_exceptions_owner_all on public.event_exceptions;
create policy event_exceptions_owner_all on public.event_exceptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
