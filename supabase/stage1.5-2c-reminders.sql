-- Stage 1.5, step 2c: Reminders (my-spec.md section 38)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: only adds a new table and its policy; nothing is dropped or changed.
-- Reminders live in their own table, so they never count as tasks, never go
-- overdue and never reach Archive.

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) > 0),
  kind text not null check (kind in ('day','time','person')),
  remind_on date,            -- day reminders: shows on this day only
  remind_at timestamptz,     -- time reminders: shows from this time, on its day
  person text,               -- person reminders: "next time I see Sam", until ticked
  done_at timestamptz,       -- ticked (Undo sets it back to null)
  created_at timestamptz not null default now(),
  check (kind <> 'day'    or remind_on is not null),
  check (kind <> 'time'   or remind_at is not null),
  check (kind <> 'person' or (person is not null and char_length(trim(person)) > 0))
);

create index if not exists reminders_user_open_idx
  on public.reminders(user_id) where done_at is null;

-- Row level security: owner only
alter table public.reminders enable row level security;
drop policy if exists reminders_owner_all on public.reminders;
create policy reminders_owner_all on public.reminders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
