-- Build 2, phase H (11 Oct): things that were fixed in code become his to change (plans/build-2.md).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-g.sql first.
-- Safe to re-run. Adds one column and removes three fixed lists from the database (the app now checks them against
-- his own lists in Settings). No data is dropped or deleted.

-- ---------------------------------------------------------------
-- Ha. Where a task came from is one of his own task sources now (Settings → "Where tasks come from"),
-- so the database no longer allows only school / tutor_maths_physics / tutor_cs / own. Existing tasks keep theirs.
-- ---------------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.tasks'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%origin%'
  loop
    execute format('alter table public.tasks drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.tasks drop constraint if exists tasks_origin_key_check;
alter table public.tasks add constraint tasks_origin_key_check check (origin ~ '^[a-z][a-z0-9_]{0,39}$');

-- ---------------------------------------------------------------
-- Hb. Training types are his own list too (Settings → Training types: "swim", "boxing"…), so events and weekly
-- targets accept any type key, or 'none' (not training). Same shape of key the app makes.
-- ---------------------------------------------------------------
alter table public.weekly_targets drop constraint if exists weekly_targets_training_type_check;
alter table public.weekly_targets add constraint weekly_targets_training_type_check
  check (training_type is null or training_type ~ '^[a-z][a-z0-9_]{0,24}$');
alter table public.events drop constraint if exists events_training_type_check;
alter table public.events add constraint events_training_type_check
  check (training_type is null or training_type ~ '^[a-z][a-z0-9_]{0,24}$');

-- ---------------------------------------------------------------
-- Hc. Is an event school? (school nights, "after school"). Empty = guessed as before (repeats on 5+ days).
-- ---------------------------------------------------------------
alter table public.events add column if not exists is_school boolean;
