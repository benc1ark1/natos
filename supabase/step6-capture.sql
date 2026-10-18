-- Step 6: AI capture.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Only adds columns; nothing is dropped or deleted.
-- (No new tables, so row level security is unchanged: every table below
-- already has its owner-only policy.)

-- "Not sorted yet": the AI failed, so the raw text went straight to Inbox.
alter table public.tasks
  add column if not exists needs_sorting boolean not null default false;

-- Keep your original words on everything capture can create
-- (tasks already have source_text; target logs use their existing note).
alter table public.reminders     add column if not exists source_text text;
alter table public.resources     add column if not exists source_text text;
alter table public.context_facts add column if not exists source_text text;
alter table public.goals         add column if not exists source_text text;
