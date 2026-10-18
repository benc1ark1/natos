-- Jarvis phase C1: change saved tasks, reminders, projects and training targets from Telegram, always through
-- a ✅ card with ↩️ Undo (plans/jarvis.md, my-spec 44).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-a.sql first.
-- Safe to re-run. Only widens three checks and adds one table; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- C1a. "Drop the guitar idea": the task is archived with reason 'dropped' (shows in Archive as Dropped,
-- can be restored, never deleted).
-- ---------------------------------------------------------------
alter table public.tasks drop constraint if exists tasks_archive_reason_check;
alter table public.tasks add constraint tasks_archive_reason_check
  check (archive_reason is null or archive_reason in ('done','expired','skipped','dropped'));

-- ---------------------------------------------------------------
-- C1b. Change cards: kind 'action' (a list of changes to saved records), and 'undone' after ↩️ Undo.
-- ---------------------------------------------------------------
alter table public.telegram_pending drop constraint if exists telegram_pending_kind_check;
alter table public.telegram_pending add constraint telegram_pending_kind_check
  check (kind in ('capture','fact','action'));
alter table public.telegram_pending drop constraint if exists telegram_pending_status_check;
alter table public.telegram_pending add constraint telegram_pending_status_check
  check (status in ('open','editing','saved','cancelled','replaced','undone'));

-- ---------------------------------------------------------------
-- C1c. "Coach set 3 lower this week": a weekly target's number for ONE week only.
-- The usual number (weekly_targets.target_count) stays as it is; this row wins for that week.
-- ---------------------------------------------------------------
create table if not exists public.target_weeks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  target_id uuid not null references public.weekly_targets(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),   -- the Monday
  target_count integer not null check (target_count between 0 and 50),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, target_id, week_start)
);
drop trigger if exists target_weeks_set_updated_at on public.target_weeks;
create trigger target_weeks_set_updated_at before update on public.target_weeks
  for each row execute function public.set_updated_at();

alter table public.target_weeks enable row level security;
drop policy if exists target_weeks_owner_all on public.target_weeks;
create policy target_weeks_owner_all on public.target_weeks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
