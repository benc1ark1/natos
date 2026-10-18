-- Stage 1.5, steps 6, 7 and 8: tests + prep sessions, archive grouping,
-- projects, Someday and hand-in.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Only adds tables, columns and functions; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- Step 6a. A test is a goal with kind 'test' (a date is required).
-- (Goals moved to their own table in Simplify D, so tests live there.)
-- ---------------------------------------------------------------
alter table public.goals
  add column if not exists kind text not null default 'goal',
  add column if not exists subject_id uuid references public.subjects(id) on delete set null,
  add column if not exists topics text,
  add column if not exists priority text not null default 'normal';
alter table public.goals drop constraint if exists goals_kind_check;
alter table public.goals add constraint goals_kind_check check (kind in ('goal','test'));
alter table public.goals drop constraint if exists goals_priority_check;
alter table public.goals add constraint goals_priority_check check (priority in ('high','normal','low'));
alter table public.goals drop constraint if exists goals_test_date_check;
alter table public.goals add constraint goals_test_date_check check (kind <> 'test' or target_date is not null);

-- ---------------------------------------------------------------
-- Step 6b. Prep sessions are ordinary tasks linked to the test (goal_id,
-- already exists), marked as system items so they stay out of Archive.
-- ---------------------------------------------------------------
alter table public.tasks
  add column if not exists is_system boolean not null default false,
  add column if not exists session_no integer,
  add column if not exists archive_reason text;
alter table public.tasks drop constraint if exists tasks_archive_reason_check;
alter table public.tasks add constraint tasks_archive_reason_check
  check (archive_reason is null or archive_reason in ('done','expired','skipped'));

-- ---------------------------------------------------------------
-- Step 6c. The day after a test, archive its leftover sessions.
-- Runs as you, under row level security; the app calls it when it loads,
-- so no background job is needed. Ordinary tasks linked to a goal stay open.
-- ---------------------------------------------------------------
create or replace function public.archive_expired()
returns integer
language sql
security invoker
set search_path = ''
as $function$
  with t as (
    update public.tasks set archived_at = now(), archive_reason = 'expired'
    where user_id = auth.uid() and is_system and archived_at is null and goal_id in (
      select id from public.goals
      where user_id = auth.uid() and kind = 'test'
        and target_date < (now() at time zone 'Europe/London')::date)
    returning id
  )
  select count(*)::integer from t;
$function$;

-- ---------------------------------------------------------------
-- Step 7. Archive counts per group, so the Archive page loads counts
-- first and only loads a group's items when you open it.
-- Groups (London time): this week · earlier this month by week ·
-- earlier this year by month · older years. Prep sessions are left out.
-- ---------------------------------------------------------------
create index if not exists tasks_archived_at_idx
  on public.tasks(user_id, archived_at desc) where archived_at is not null;

create or replace function public.archive_counts()
returns table (bucket text, starts date, n integer)
language sql
stable
security invoker
set search_path = ''
as $function$
  with p as (
    select (now() at time zone 'Europe/London')::date as today
  ),
  b as (
    select today - (extract(isodow from today)::int - 1) as wk,
           date_trunc('month', today)::date as mo,
           date_trunc('year', today)::date as yr
    from p
  ),
  d as (
    select (t.archived_at at time zone 'Europe/London')::date as day
    from public.tasks t
    where t.user_id = auth.uid() and t.archived_at is not null and not t.is_system
  )
  select
    case when day >= wk then 'this_week' when day >= mo then 'week'
         when day >= yr then 'month' else 'year' end,
    case when day >= wk then wk
         when day >= mo then day - (extract(isodow from day)::int - 1)
         when day >= yr then date_trunc('month', day)::date
         else date_trunc('year', day)::date end,
    count(*)::integer
  from d cross join b
  group by 1, 2
  order by 2 desc;
$function$;

-- ---------------------------------------------------------------
-- Step 8a. Projects (background groups for tasks, goals and resources)
-- ---------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  category_id uuid references public.categories(id) on delete set null,
  notes text,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;
drop policy if exists projects_owner_all on public.projects;
create policy projects_owner_all on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.tasks
  add column if not exists project_id uuid references public.projects(id) on delete set null,
  -- how/where to hand it in (e.g. Google Classroom, email Vlad, paper) + optional link
  add column if not exists hand_in text,
  add column if not exists hand_in_url text;
alter table public.tasks drop constraint if exists tasks_hand_in_url_check;
alter table public.tasks add constraint tasks_hand_in_url_check
  check (hand_in_url is null or hand_in_url ~* '^https?://');

alter table public.goals
  add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.resources
  add column if not exists project_id uuid references public.projects(id) on delete set null;

-- ---------------------------------------------------------------
-- Step 8b. Someday column for the backlog (widens the allowed values; nothing removed)
-- ---------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check
  check (status in ('inbox','today','this_week','this_month','waiting','someday','completed'));

-- Postpone counter: moving to Someday counts as postponing.
-- Prep sessions moved by the app's re-plan never count.
create or replace function public.track_task_postpone()
returns trigger
language plpgsql
as $function$
begin
  if new.is_system then
    return new;
  end if;
  if (old.due_at is not null and new.due_at is not null and new.due_at > old.due_at)
     or (old.window_end is not null and new.window_end is not null and new.window_end > old.window_end)
     or (old.status = 'today' and new.status in ('this_week','this_month','inbox','someday'))
     or (old.status = 'this_week' and new.status in ('this_month','inbox','someday'))
     or (old.status = 'this_month' and new.status = 'someday') then
    new.postpone_count := old.postpone_count + 1;
    new.last_postponed_at := now();
  end if;
  return new;
end;
$function$;
