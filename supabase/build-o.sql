-- Build O (12 Oct 2026): the week optimiser, gap questions, Owen's days, daily ticks, ROI suggestions. plans/build-o.md.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run. No data is dropped or deleted.
-- The app works before this runs: everything new lives in your settings; this only adds what's below.

-- ---------------------------------------------------------------
-- Oa. Your own 🧠 (mental) number for a session or a type ("the SMC mock is max mental"), next to its legs / upper / CNS.
-- ---------------------------------------------------------------
alter table public.load_costs add column if not exists mental smallint;
alter table public.load_costs drop constraint if exists load_costs_mental_check;
alter table public.load_costs add constraint load_costs_mental_check check (mental is null or mental between 0 and 10);

-- ---------------------------------------------------------------
-- Ob. What you answered to the gap questions (the answers themselves are your settings; this is the history).
-- ---------------------------------------------------------------
create table if not exists public.gap_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  gap_key text not null check (char_length(gap_key) between 1 and 120),
  question text not null check (char_length(question) between 1 and 500),
  answer text not null check (char_length(answer) between 1 and 200),
  created_at timestamptz not null default now()
);
create index if not exists gap_answers_user on public.gap_answers (user_id, created_at desc);
alter table public.gap_answers enable row level security;
drop policy if exists gap_answers_owner_all on public.gap_answers;
create policy gap_answers_owner_all on public.gap_answers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Oc. Time-saving suggestions you applied or put off, per week (Insights on Home and "where can I save time?").
-- ---------------------------------------------------------------
create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  key text not null check (char_length(key) between 1 and 120),
  title text not null check (char_length(title) between 1 and 300),
  saves_min integer not null default 0 check (saves_min between 0 and 2000),
  status text not null check (status in ('applied','dismissed')),
  created_at timestamptz not null default now(),
  unique (user_id, week_start, key)
);
alter table public.recommendations enable row level security;
drop policy if exists recommendations_owner_all on public.recommendations;
create policy recommendations_owner_all on public.recommendations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
