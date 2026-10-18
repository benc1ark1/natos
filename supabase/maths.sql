-- Maths + Further Maths system (13 Oct 2026): each topic's colour.
-- ⚪ not_started · 🔴 not_secure · 🟡 understand (but not secure) · 🟢 exam_ready. Green can drop back.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/step12-study.sql first.
-- Safe to re-run. Adds two columns to topics. Nothing is dropped or deleted.

alter table public.topics add column if not exists status text not null default 'not_started';
alter table public.topics add column if not exists status_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'topics_status_check') then
    alter table public.topics add constraint topics_status_check check (status in ('not_started', 'not_secure', 'understand', 'exam_ready'));
  end if;
end $$;
