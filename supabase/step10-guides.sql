-- Build 2, phase L (11 Oct): the rest of the Life Mastery guides (BUILD-GUIDE step 10). plans/build-2.md.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/step12-study.sql first.
-- Safe to re-run. Adds two columns and one table; turns the weekly log on for "Athletic & Lower" (the guide that changes
-- every week). No data is dropped or deleted.

-- ---------------------------------------------------------------
-- La. Each guide's area (Study / Athletic / Personal), for grouping the Guides page. Empty = guessed from the title.
-- ---------------------------------------------------------------
alter table public.guides add column if not exists category_id uuid references public.categories(id) on delete set null;

-- ---------------------------------------------------------------
-- Lb. Guides that change often: the guide text is the fixed rules, plus a dated weekly log underneath.
-- ---------------------------------------------------------------
alter table public.guides add column if not exists has_log boolean not null default false;
update public.guides set has_log = true where title = 'Athletic & Lower' and has_log = false;

create table if not exists public.guide_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  guide_id uuid not null references public.guides(id) on delete cascade,
  week_start date not null check (extract(isodow from week_start) = 1),   -- the Monday of the week it's for
  body text not null check (char_length(trim(body)) between 1 and 4000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists guide_logs_guide_idx on public.guide_logs(user_id, guide_id, week_start);
drop trigger if exists guide_logs_set_updated_at on public.guide_logs;
create trigger guide_logs_set_updated_at before update on public.guide_logs for each row execute function public.set_updated_at();
alter table public.guide_logs enable row level security;
drop policy if exists guide_logs_owner_all on public.guide_logs;
create policy guide_logs_owner_all on public.guide_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
