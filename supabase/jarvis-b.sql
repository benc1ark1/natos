-- Jarvis phase B: planning settings for free time (plans/jarvis.md, my-spec 41 and 44).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-a.sql first.
-- Safe to re-run. Only adds one column; nothing is dropped or deleted.

-- Free time is worked out by the app, never by the AI. These are its settings, as editable data
-- (empty = the defaults from my-spec 41). Keys, all optional:
--   dayStart "07:00" · dayEnd "22:30" (nothing planned after) · heavyUntil "21:30" (nothing heavy after)
--   bufferMin 10 (around every event) · schoolNightFocusMin 150 (about 2–3 h of focused work)
-- Example: update public.profiles set planning = planning || '{"dayEnd":"22:00"}'::jsonb;
alter table public.profiles add column if not exists planning jsonb not null default '{}'::jsonb;
