-- Stage 1 schema additions (PROPOSAL — not run yet)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: only adds tables/columns; nothing is dropped or renamed.
-- Days of week use ISO numbers: 1 = Mon ... 7 = Sun.

-- ---------------------------------------------------------------
-- 1. Profile (name for the greeting, timezone). Not hardcoded.
-- ---------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  display_name text not null default 'Nat',
  timezone text not null default 'Europe/London',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 2. Subjects: tags inside Study / Athletic / Personal
-- ---------------------------------------------------------------
create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null check (char_length(trim(name)) > 0),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- ---------------------------------------------------------------
-- 3. Weekly targets + progress log (Football 4/week, SMC 3/week)
-- ---------------------------------------------------------------
create table if not exists public.weekly_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),          -- "Upper", "Lower + plyo"
  activity_type text,                                                -- free text, e.g. 'upper', 'football'
  subject_id uuid references public.subjects(id) on delete set null,
  target_count integer not null check (target_count > 0),
  sync_source text not null default 'manual'
    check (sync_source in ('manual','hevy','trainheroic','whoop')),  -- where progress usually comes from
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per session done. Weekly progress = rows this week (Mon-Sun),
-- so nothing ever needs "resetting" and history is kept.
create table if not exists public.target_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_id uuid not null references public.weekly_targets(id) on delete cascade,
  done_on date not null default current_date,
  amount integer not null default 1 check (amount > 0),
  source text not null default 'manual'
    check (source in ('manual','capture','task','hevy','trainheroic','whoop')),
  external_id text,                 -- e.g. Hevy workout id, so a sync never double-counts
  note text,
  created_at timestamptz not null default now()
);
create unique index if not exists target_logs_external_uidx
  on public.target_logs(user_id, source, external_id) where external_id is not null;

-- ---------------------------------------------------------------
-- 4. Tasks: new columns
-- ---------------------------------------------------------------
alter table public.tasks
  add column if not exists subject_id uuid references public.subjects(id) on delete set null,
  add column if not exists importance text not null default 'nice'
    check (importance in ('must','nice')),                           -- must-do vs nice-to-do
  add column if not exists window_start date,                        -- flexible deadline window
  add column if not exists window_end date,                          -- last OK day ("before Wed" = Tue)
  add column if not exists window_label text,                        -- as said: "this weekend"
  add column if not exists origin text not null default 'own'
    check (origin in ('school','tutor_maths_physics','tutor_cs','own')),
  add column if not exists duration_minutes integer check (duration_minutes > 0),
  add column if not exists postpone_count integer not null default 0,
  add column if not exists last_postponed_at timestamptz,
  add column if not exists target_id uuid references public.weekly_targets(id) on delete set null;
  -- target_id: completing e.g. "Football touches" can add 1 to the Football target.

-- Count postponements automatically (deadline/window pushed later,
-- or moved from Today/This week to a later column).
create or replace function public.track_task_postpone()
returns trigger
language plpgsql
as $function$
begin
  if (old.due_at is not null and new.due_at is not null and new.due_at > old.due_at)
     or (old.window_end is not null and new.window_end is not null and new.window_end > old.window_end)
     or (old.status = 'today' and new.status in ('this_week','this_month','inbox'))
     or (old.status = 'this_week' and new.status in ('this_month','inbox')) then
    new.postpone_count := old.postpone_count + 1;
    new.last_postponed_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists tasks_track_postpone on public.tasks;
create trigger tasks_track_postpone before update on public.tasks
  for each row execute function public.track_task_postpone();

-- ---------------------------------------------------------------
-- 5. Routines: reuse habits (= routine) and habit_items (= block)
-- ---------------------------------------------------------------
alter table public.habits
  add column if not exists days_of_week smallint[] not null default '{1,2,3,4,5,6,7}';

alter table public.habit_items
  add column if not exists guide_url text,                -- later: guide_id when Guides exist
  add column if not exists condition_label text,          -- e.g. "Shave days only"; null = always
  add column if not exists days_of_week smallint[];       -- null = every day the routine runs

-- Ordered steps inside a block (no clock times anywhere)
create table if not exists public.routine_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_item_id uuid not null references public.habit_items(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- "Off today" for a conditional block. Logs are per date, so a missed
-- day just has no row: nothing can become overdue.
alter table public.habit_logs
  add column if not exists skipped boolean not null default false;

-- ---------------------------------------------------------------
-- 6. Events: editable data, one-off or weekly repeating
-- ---------------------------------------------------------------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  category_id uuid references public.categories(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  location text,
  -- one-off event:
  starts_at timestamptz,
  ends_at timestamptz,
  -- weekly repeating event (local London time):
  repeat_days smallint[],
  start_time time,
  end_time time,
  repeat_from date,
  repeat_until date,
  is_busy boolean not null default true,       -- school = busy time for the planner
  external_source text not null default 'manual'
    check (external_source in ('manual','google')),
  external_id text,                            -- Google Calendar event id, later
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at is not null or (repeat_days is not null and start_time is not null))
);
create unique index if not exists events_external_uidx
  on public.events(user_id, external_source, external_id) where external_id is not null;

-- ---------------------------------------------------------------
-- 7. Resources: links, videos, GoodNotes — separate from tasks
-- ---------------------------------------------------------------
create table if not exists public.resources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  url text,
  kind text not null default 'link'
    check (kind in ('link','video','goodnotes','book','article','drill','other')),
  subject_id uuid references public.subjects(id) on delete set null,
  category_id uuid references public.categories(id) on delete set null,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- 8. Context facts the AI reads ("CS tutor Mon + Thu", "SMC is 7 Oct")
-- ---------------------------------------------------------------
create table if not exists public.context_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fact text not null check (char_length(trim(fact)) > 0),
  topic text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------
create index if not exists subjects_user_idx on public.subjects(user_id, sort_order);
create index if not exists targets_user_idx on public.weekly_targets(user_id, is_active);
create index if not exists target_logs_user_date_idx on public.target_logs(user_id, done_on);
create index if not exists tasks_user_subject_idx on public.tasks(user_id, subject_id);
create index if not exists tasks_user_window_idx on public.tasks(user_id, window_end);
create index if not exists routine_steps_item_idx on public.routine_steps(habit_item_id, sort_order);
create index if not exists events_user_start_idx on public.events(user_id, starts_at);
create index if not exists resources_user_subject_idx on public.resources(user_id, subject_id);
create index if not exists facts_user_idx on public.context_facts(user_id, is_active);

-- ---------------------------------------------------------------
-- updated_at triggers (reuses set_updated_at from the base schema)
-- ---------------------------------------------------------------
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
drop trigger if exists targets_set_updated_at on public.weekly_targets;
create trigger targets_set_updated_at before update on public.weekly_targets for each row execute function public.set_updated_at();
drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at before update on public.events for each row execute function public.set_updated_at();
drop trigger if exists resources_set_updated_at on public.resources;
create trigger resources_set_updated_at before update on public.resources for each row execute function public.set_updated_at();
drop trigger if exists facts_set_updated_at on public.context_facts;
create trigger facts_set_updated_at before update on public.context_facts for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- Row level security: owner only, on every new table
-- ---------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.weekly_targets enable row level security;
alter table public.target_logs enable row level security;
alter table public.routine_steps enable row level security;
alter table public.events enable row level security;
alter table public.resources enable row level security;
alter table public.context_facts enable row level security;

drop policy if exists profiles_owner_all on public.profiles;
create policy profiles_owner_all on public.profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists subjects_owner_all on public.subjects;
create policy subjects_owner_all on public.subjects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists targets_owner_all on public.weekly_targets;
create policy targets_owner_all on public.weekly_targets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists target_logs_owner_all on public.target_logs;
create policy target_logs_owner_all on public.target_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists routine_steps_owner_all on public.routine_steps;
create policy routine_steps_owner_all on public.routine_steps for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists events_owner_all on public.events;
create policy events_owner_all on public.events for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists resources_owner_all on public.resources;
create policy resources_owner_all on public.resources for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists facts_owner_all on public.context_facts;
create policy facts_owner_all on public.context_facts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
