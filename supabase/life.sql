-- Queue item 4: events and life by chat (overnight build, 19 Oct 2026).
-- Safe to run more than once. Nothing is dropped or deleted.
-- Events by chat need nothing new (they use events / event_exceptions). Routines by chat: a block or step he removes
-- is archived (hidden from the app, kept in the database), never deleted, so Undo can bring it back.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

alter table public.habit_items add column if not exists archived_at timestamptz;
alter table public.routine_steps add column if not exists archived_at timestamptz;
