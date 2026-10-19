-- Queue item 1: the study tracker (overnight build, 19 Oct 2026), from assets/Nat-Study-Tracker-FINAL.xlsx.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run more than once.
-- Nothing is dropped or deleted: it only adds columns, tables and indexes. Every new table is owner-only (RLS).
-- Until it runs, the app keeps working as before (the tracker parts say "run supabase/tracker.sql").

-- ---------------------------------------------------------------
-- 1. Topics: the tracker's columns (Maths+FM and Physics tabs)
-- ---------------------------------------------------------------
alter table public.topics add column if not exists code text;            -- 'Y1-01', 'PC1-03', 'P1.3'
alter table public.topics add column if not exists strand text;          -- 'Pure', 'Statistics', 'Mechanics', 'Further Pure', 'Further Stats', 'Further Mech', or the physics topic ('Kinematics')
alter table public.topics add column if not exists teacher text;         -- the teacher's name as he writes it, or 'TBC'
alter table public.topics add column if not exists half_term text;       -- 'HT1' … 'HT6'
alter table public.topics add column if not exists taught_from date;     -- when school teaches it (maths); drives Taught / Next up / Later
alter table public.topics add column if not exists taught text;          -- physics "Taught?": 'yes' | 'in_class' | 'not_yet' (wins over taught_from)
alter table public.topics add column if not exists step smallint not null default 0;   -- maths pipeline: 0 Not started · 1 Learnt · 2 Textbook exercise · 3 Mixed exercise · 4 Bicen exam Qs · 5 Integral ≥85% · 6 Stretch
alter table public.topics add column if not exists bicen text;           -- 'Bicen Core Pure → CP1: Matrices' (the exam-question section)
alter table public.topics add column if not exists integral_url text;    -- link to its Integral assessment / Further folder
alter table public.topics add column if not exists fresh_pct smallint;   -- latest fresh-question %
alter table public.topics add column if not exists last_done date;       -- last time he worked on it (reviews count from here)
alter table public.topics add column if not exists weak_notes text;      -- "Notes / weak bits"
alter table public.topics add column if not exists concepts text;        -- physics "Concepts I don't get"
alter table public.topics add column if not exists booklet text;         -- physics booklet Qs: 'done' | 'doing' | 'todo'
alter table public.topics add column if not exists pmt text;             -- physics PMT Qs: 'done' | 'doing' | 'todo'
alter table public.topics add column if not exists pmt_ref text;         -- 'PMT topic 1'
alter table public.topics add column if not exists book_ref text;        -- 'Y1 red · 1', 'PC1 blue · 3'

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'topics_code_check') then
    alter table public.topics add constraint topics_code_check check (code is null or code ~ '^[A-Za-z0-9][A-Za-z0-9.\-]{0,15}$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'topics_tracker_check') then
    alter table public.topics add constraint topics_tracker_check check (
      (strand is null or char_length(strand) <= 60) and (teacher is null or char_length(teacher) <= 60)
      and (half_term is null or half_term ~ '^HT[1-6]$') and (taught is null or taught in ('yes', 'in_class', 'not_yet'))
      and step between 0 and 6 and (bicen is null or char_length(bicen) <= 200)
      and (integral_url is null or integral_url ~* '^https?://') and (fresh_pct is null or fresh_pct between 0 and 100)
      and (weak_notes is null or char_length(weak_notes) <= 1000) and (concepts is null or char_length(concepts) <= 1000)
      and (booklet is null or booklet in ('done', 'doing', 'todo')) and (pmt is null or pmt in ('done', 'doing', 'todo'))
      and (pmt_ref is null or char_length(pmt_ref) <= 40) and (book_ref is null or char_length(book_ref) <= 40));
  end if;
end $$;
-- one live topic per code (duplicates are archived by the import, never deleted)
create unique index if not exists topics_code_live on public.topics (user_id, upper(code)) where archived_at is null and code is not null;

-- ---------------------------------------------------------------
-- 2. Tests & papers: a test stays a goal (kind 'test'), with the tracker's details
-- ---------------------------------------------------------------
alter table public.goals add column if not exists info text;                       -- "50 min · ~45 marks · calculator · booklets on Classroom"
alter table public.goals add column if not exists test_kind text;                  -- 'test' | 'consolidation' | 'paper' | 'mock' | 'act'
alter table public.goals add column if not exists topic_codes text[] not null default '{}';
alter table public.goals add column if not exists minutes_per_day smallint;        -- consolidation: "30–60 min/day" → 30
alter table public.goals add column if not exists minutes_max smallint;            -- …and 60
alter table public.goals add column if not exists limits text;                     -- "no momentum"
alter table public.goals add column if not exists length_min smallint;             -- the real test's length
alter table public.goals add column if not exists marks smallint;                  -- its marks
alter table public.goals add column if not exists source text;                     -- 'sheet' | 'classroom' | 'chat' | 'app'
alter table public.goals add column if not exists source_ref text;                 -- e.g. the Classroom assignment's title + due date (asked about once)

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_tracker_check') then
    alter table public.goals add constraint goals_tracker_check check (
      (info is null or char_length(info) <= 2000) and (test_kind is null or test_kind in ('test', 'consolidation', 'paper', 'mock', 'act'))
      and (minutes_per_day is null or minutes_per_day between 5 and 240) and (minutes_max is null or minutes_max between 5 and 240)
      and (limits is null or char_length(limits) <= 300) and (length_min is null or length_min between 5 and 600)
      and (marks is null or marks between 1 and 1000) and (source is null or source in ('sheet', 'classroom', 'chat', 'app'))
      and (source_ref is null or char_length(source_ref) <= 300) and cardinality(topic_codes) <= 60);
  end if;
end $$;
create unique index if not exists goals_source_ref_once on public.goals (user_id, source_ref) where source_ref is not null;

-- each try at a test: diagnostic, teacher booklet, timed practice, past paper, the real test
create table if not exists public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  done_on date not null default current_date,
  what text not null check (what in ('diagnostic', 'booklet', 'timed', 'paper', 'real', 'other')),
  label text check (label is null or char_length(label) <= 200),        -- his words: "HT2 practice"
  score numeric(6,1) check (score is null or score >= 0),
  out_of numeric(6,1) check (out_of is null or out_of > 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (score is null or out_of is null or score <= out_of)
);
create index if not exists test_attempts_goal_idx on public.test_attempts (user_id, goal_id, done_on);

-- ---------------------------------------------------------------
-- 3. Mistakes: question, type, rule, and two redos (+3 days, then ~1 week)
-- ---------------------------------------------------------------
alter table public.mistakes add column if not exists goal_id uuid references public.goals(id) on delete set null;   -- from a test or paper
alter table public.mistakes add column if not exists question text;     -- 'Q3b'
alter table public.mistakes add column if not exists code text;         -- the topic code he gave ('PC1-03')
alter table public.mistakes add column if not exists kind text;         -- Knowledge · Method · Algebra · Misread · Calculator · Time · Careless
alter table public.mistakes add column if not exists rule text;         -- rule for next time
alter table public.mistakes add column if not exists source text;       -- 'Bicen CP1 Linear Transformations' (sheet + Q)
alter table public.mistakes add column if not exists redo_stage smallint not null default 0;   -- 0: first redo due (review_on) · 1: second redo due · 2: done

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mistakes_tracker_check') then
    alter table public.mistakes add constraint mistakes_tracker_check check (
      (question is null or char_length(question) <= 40) and (code is null or char_length(code) <= 16)
      and (kind is null or kind in ('knowledge', 'method', 'algebra', 'misread', 'calculator', 'time', 'careless'))
      and (rule is null or char_length(rule) <= 300) and (source is null or char_length(source) <= 200) and redo_stage between 0 and 2);
  end if;
end $$;

-- ---------------------------------------------------------------
-- 4. Programmes: an ordered series with a weekly target (STEP, the ACT books…). New ones need no code.
-- ---------------------------------------------------------------
create table if not exists public.programmes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  area text not null default 'study' check (area in ('study', 'act', 'training', 'other')),
  subject_id uuid references public.subjects(id) on delete set null,
  per_week smallint not null default 1 check (per_week between 1 and 14),
  minutes smallint not null default 60 check (minutes between 5 and 300),
  days text check (days is null or char_length(days) <= 60),          -- 'weekend' · 'weekdays' · 'mon, wed' · null = any day
  starts_on date,
  ends_on date,
  status text not null default 'active' check (status in ('active', 'paused', 'stopped', 'done')),
  paused_until date,
  mode text not null default 'in_order' check (mode in ('in_order', 'gaps_only', 'optional')),   -- gaps_only: test each chapter first, only do the ones with dropped marks · optional: only when he asks / it stalls
  notes text check (notes is null or char_length(notes) <= 1000),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists programmes_user_idx on public.programmes (user_id, status) where archived_at is null;

create table if not exists public.programme_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  programme_id uuid not null references public.programmes(id) on delete cascade,
  position integer not null check (position >= 1),
  title text not null check (char_length(trim(title)) between 1 and 200),
  details text check (details is null or char_length(details) <= 1000),
  url text check (url is null or url ~* '^https?://'),
  minutes smallint check (minutes is null or minutes between 5 and 300),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done', 'skipped')),
  done_on date,
  result text check (result is null or char_length(result) <= 300),   -- "solved with hints · idea: …", "8/10"
  score numeric(6,1) check (score is null or score >= 0),
  out_of numeric(6,1) check (out_of is null or out_of > 0),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (programme_id, position)
);
create index if not exists programme_items_prog_idx on public.programme_items (user_id, programme_id, position);

-- ---------------------------------------------------------------
-- 5. Temporary rules by chat, with an end date ("pause getting ahead until 25 Oct"). Expired ones just stop counting.
-- ---------------------------------------------------------------
create table if not exists public.plan_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  words text not null check (char_length(trim(words)) between 1 and 300),   -- his words
  kind text not null check (kind in ('boost', 'pause', 'cap', 'note')),
  target text not null check (char_length(trim(target)) between 1 and 80),   -- see plans/contracts.md §3.6
  minutes smallint check (minutes is null or minutes between 5 and 600),     -- cap: minutes a day
  starts_on date not null default current_date,
  ends_on date not null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);
create index if not exists plan_rules_live_idx on public.plan_rules (user_id, ends_on) where archived_at is null;

-- ---------------------------------------------------------------
-- RLS (owner only) and updated_at on every new table
-- ---------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['test_attempts', 'programmes', 'programme_items', 'plan_rules'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_all', t);
    execute format('create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_owner_all', t);
  end loop;
end $$;
