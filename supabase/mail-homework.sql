-- Homework emails become tasks with the right deadline (fix, 19 Oct 2026).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run more than once. Nothing is dropped or deleted.
-- The Gmail scripts now send an email's text when it looks like homework, so the task gets the deadline and what to do
-- (e.g. the problem list). The text is kept only for emails sorted as homework; for anything else it's cleared after
-- sorting. Row level security is unchanged: emails are already owner-only.

alter table public.emails add column if not exists body text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'emails_body_check') then
    alter table public.emails add constraint emails_body_check check (body is null or char_length(body) <= 5000);
  end if;
end $$;
