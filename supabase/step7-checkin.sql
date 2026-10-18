-- Step 7: Ask AI + Sunday check-in (my-spec.md section 40)
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: only adds a new table and its policy; nothing is dropped or changed.
-- One row per week: Nat's top 3 priorities and the week plan he confirmed.
-- Ask AI reads it all week (priorities, and planned vs done for "am I ahead or behind?").

create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,                       -- the Monday of the week being planned
  priorities text[] not null default '{}',        -- top 3, in Nat's words
  plan jsonb,                                     -- confirmed day-by-day plan (suggestions only; changes no records)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start),
  check (cardinality(priorities) <= 3)
);

drop trigger if exists weekly_reviews_set_updated_at on public.weekly_reviews;
create trigger weekly_reviews_set_updated_at before update on public.weekly_reviews
  for each row execute function public.set_updated_at();

-- Row level security: owner only
alter table public.weekly_reviews enable row level security;
drop policy if exists weekly_reviews_owner_all on public.weekly_reviews;
create policy weekly_reviews_owner_all on public.weekly_reviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
