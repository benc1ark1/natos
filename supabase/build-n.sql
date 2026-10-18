-- Build 2, phase N (11 Oct): load-based training planner. plans/build-2.md.
-- Every session has a recovery cost (legs, upper body, CNS: 0–10 each) from its type and intensity; Nat can change any
-- of them by chat or in Settings. Intensity becomes light / moderate / heavy ('hard' stays as the stored word for heavy).
-- His sent week ("my week: Mon football 6–7:30 …") is kept for that week's planning.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run. No data is dropped or deleted.
-- The app works before this runs (default costs, no "moderate", the sent week only used in that message).

-- ---------------------------------------------------------------
-- Na. Intensity: allow 'moderate' as well as light and hard (= heavy).
-- ---------------------------------------------------------------
alter table public.weekly_targets drop constraint if exists weekly_targets_load_check;
alter table public.weekly_targets add constraint weekly_targets_load_check check (load is null or load in ('hard','moderate','light'));
alter table public.events drop constraint if exists events_load_check;
alter table public.events add constraint events_load_check check (load is null or load in ('hard','moderate','light'));

-- ---------------------------------------------------------------
-- Nb. His recovery costs. scope 'type': a training type's cost at heavy (light/moderate are scaled down).
-- scope 'session': one session by name (and weekday, if he said one: "Wednesday training is high CNS"); the cost as
-- it is, whatever its intensity. A change archives the old row (never deleted), so Undo can bring it back.
-- ---------------------------------------------------------------
create table if not exists public.load_costs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  scope text not null check (scope in ('type','session')),
  type_key text check (type_key is null or type_key ~ '^[a-z][a-z0-9_]{0,24}$'),
  title text check (title is null or char_length(trim(title)) between 1 and 120),
  weekday smallint check (weekday is null or weekday between 1 and 7),
  legs smallint not null check (legs between 0 and 10),
  upper smallint not null check (upper between 0 and 10),
  cns smallint not null check (cns between 0 and 10),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope = 'type' and type_key is not null) or (scope = 'session' and title is not null))
);
create index if not exists load_costs_user on public.load_costs (user_id) where archived_at is null;
drop trigger if exists load_costs_set_updated_at on public.load_costs;
create trigger load_costs_set_updated_at before update on public.load_costs for each row execute function public.set_updated_at();
alter table public.load_costs enable row level security;
drop policy if exists load_costs_owner_all on public.load_costs;
create policy load_costs_owner_all on public.load_costs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Nc. The week he sent ("my week: …"): what the AI read from it, used when planning that week (with his calendars).
-- ---------------------------------------------------------------
create table if not exists public.week_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_from date not null,
  week_to date not null check (week_to >= week_from),
  text text not null check (char_length(text) between 1 and 4000),
  items jsonb not null default '[]'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists week_notes_user_week on public.week_notes (user_id, week_from) where archived_at is null;
alter table public.week_notes enable row level security;
drop policy if exists week_notes_owner_all on public.week_notes;
create policy week_notes_owner_all on public.week_notes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
