-- Queue item 2: the ACT upgrade (overnight build, 19 Oct 2026). Run after supabase/tracker.sql (it uses programmes).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run more than once. Nothing is dropped or deleted.
-- The retake date is a test goal (goals.test_kind = 'act'); the books are programmes (area 'act'); misses are
-- mistakes on the ACT subject with the grammar rule in mistakes.rule. Only the scores need a table of their own.

create table if not exists public.act_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  taken_on date not null default current_date,
  kind text not null check (kind in ('real', 'practice', 'section')),   -- the real test · a full practice test · one timed section
  english smallint check (english is null or english between 1 and 36),
  maths smallint check (maths is null or maths between 1 and 36),
  reading smallint check (reading is null or reading between 1 and 36),
  science smallint check (science is null or science between 1 and 36),
  composite smallint check (composite is null or composite between 1 and 36),   -- enhanced ACT: mean of English, Maths, Reading
  notes text check (notes is null or char_length(notes) <= 1000),
  source_text text check (source_text is null or char_length(source_text) <= 1000),   -- his message
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (english is not null or maths is not null or reading is not null or science is not null)
);
create index if not exists act_scores_user_idx on public.act_scores (user_id, taken_on) where archived_at is null;

drop trigger if exists act_scores_set_updated_at on public.act_scores;
create trigger act_scores_set_updated_at before update on public.act_scores for each row execute function public.set_updated_at();
alter table public.act_scores enable row level security;
drop policy if exists act_scores_owner_all on public.act_scores;
create policy act_scores_owner_all on public.act_scores for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
