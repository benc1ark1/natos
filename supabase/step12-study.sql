-- Build 2, phase K (11 Oct): study pipelines + GoodNotes (BUILD-GUIDE step 12, my-spec 26/27). plans/build-2.md.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/step11-whoop.sql first.
-- Safe to re-run. Adds four tables and one column. No data is dropped or deleted (stages, topics and mistakes are
-- archived; a stage marked done by mistake is "undone", the row stays).

-- ---------------------------------------------------------------
-- Ka. A subject's learning pipeline: its stages in order (Further Maths: Bicen video → GoodNotes notes → textbook
-- questions → exam questions → past papers → review mistakes). Edit, reorder or archive any time: progress points
-- at the stage itself, so it's never lost.
-- ---------------------------------------------------------------
create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pipeline_stages_subject_idx on public.pipeline_stages(user_id, subject_id, sort_order);

-- ---------------------------------------------------------------
-- Kb. Topics from his exam board's specification, per subject, each with an optional link to its GoodNotes notes
-- (the PDF GoodNotes backs up to Google Drive).
-- ---------------------------------------------------------------
create table if not exists public.topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 120),
  spec_ref text check (spec_ref is null or char_length(spec_ref) <= 40),   -- e.g. "4.2" in the specification
  notes_url text check (notes_url is null or notes_url ~* '^https?://'),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists topics_subject_idx on public.topics(user_id, subject_id, sort_order);

-- ---------------------------------------------------------------
-- Kc. Which stage of which topic is done. One row per topic and stage; "undone" keeps the row.
-- ---------------------------------------------------------------
create table if not exists public.topic_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete cascade,
  done_at timestamptz not null default now(),
  undone_at timestamptz,
  source_text text check (source_text is null or char_length(source_text) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, topic_id, stage_id)
);

-- ---------------------------------------------------------------
-- Kd. Mistakes he logs ("Q5 wrong: sign error"); each comes back for review a few days later (setting).
-- ---------------------------------------------------------------
create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  topic_id uuid references public.topics(id) on delete set null,
  body text not null check (char_length(trim(body)) between 1 and 500),
  source_text text check (source_text is null or char_length(source_text) <= 1000),
  logged_on date not null default current_date,
  review_on date not null,
  reviewed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mistakes_review_idx on public.mistakes(user_id, review_on) where reviewed_at is null and archived_at is null;

-- ---------------------------------------------------------------
-- Ke. Resources can belong to a topic (a video, a question set, notes).
-- ---------------------------------------------------------------
alter table public.resources add column if not exists topic_id uuid references public.topics(id) on delete set null;

-- updated_at, row level security (owner only) for the four new tables
do $$
declare t text;
begin
  foreach t in array array['pipeline_stages','topics','topic_progress','mistakes'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_owner_all', t);
  end loop;
end $$;
