-- Jarvis phase B2: the pinned live "Today" message (plans/jarvis.md).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-a.sql first.
-- Safe to re-run. Only adds three columns; nothing is dropped or deleted.

-- Which message is today's pinned "Today" (so the bot edits it instead of sending a new one),
-- which day it is for, and a fingerprint of its last text (so it's only edited when something changed).
alter table public.telegram_state add column if not exists today_message_id bigint;
alter table public.telegram_state add column if not exists today_date date;
alter table public.telegram_state add column if not exists today_hash text;
