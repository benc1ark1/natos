-- Jarvis follow-up (10 Oct): journey ranges, the "App ideas" list, training type questions (plans/jarvis.md).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-e.sql first.
-- Safe to re-run. Only adds columns and one table, widens checks, and widens travel_times' "one row per journey"
-- rule to include the weekday. No data is dropped or deleted.

-- ---------------------------------------------------------------
-- Ga. Journeys as ranges ("Uber 15–20 min + 0–8 min wait"). `minutes` stays the slow end of the journey itself;
-- minutes_low is the quick end; wait_low/wait_high are the wait for the car (Uber). Leave-by uses the slow end
-- (drive max + wait max) unless the setting travelEnd says otherwise ('slow' / 'middle' / 'fast').
-- ---------------------------------------------------------------
alter table public.travel_times add column if not exists minutes_low integer check (minutes_low is null or minutes_low between 1 and 300);
alter table public.travel_times add column if not exists wait_low integer check (wait_low is null or wait_low between 0 and 60);
alter table public.travel_times add column if not exists wait_high integer check (wait_high is null or wait_high between 0 and 60);
-- A journey for one weekday only (1 = Mon … 7 = Sun; empty = every day): "Wed training 15–20", "Mon training 10–15".
alter table public.travel_times add column if not exists weekday smallint check (weekday is null or weekday between 1 and 7);
-- "One row per journey" now includes the weekday. The old rule is swapped for the wider one; no rows change.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.travel_times'::regclass and contype = 'u' and conname <> 'travel_times_journey_key'
  loop
    execute format('alter table public.travel_times drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conrelid = 'public.travel_times'::regclass and conname = 'travel_times_journey_key') then
    alter table public.travel_times add constraint travel_times_journey_key
      unique nulls not distinct (user_id, from_place_id, to_place_id, mode, source, depart_hour, weekday);
  end if;
end $$;

-- ---------------------------------------------------------------
-- Gb. App ideas: things Nat asked the bot that it can't do yet ("it needs adding in Claude Code"), kept so he can
-- bring them to Claude Code later. Never deleted: done or dropped ones are marked.
-- ---------------------------------------------------------------
create table if not exists public.app_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  request text not null check (char_length(trim(request)) between 1 and 500),   -- what he wanted, in one sentence
  source_text text check (source_text is null or char_length(source_text) <= 2000),   -- his own words
  status text not null default 'open' check (status in ('open','done','dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists app_ideas_set_updated_at on public.app_ideas;
create trigger app_ideas_set_updated_at before update on public.app_ideas for each row execute function public.set_updated_at();
alter table public.app_ideas enable row level security;
drop policy if exists app_ideas_owner_all on public.app_ideas;
create policy app_ideas_owner_all on public.app_ideas for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Gc. The conversation memory knows "app idea" messages, and app-idea cards can be undone.
-- ---------------------------------------------------------------
alter table public.telegram_turns drop constraint if exists telegram_turns_intent_check;
alter table public.telegram_turns add constraint telegram_turns_intent_check
  check (intent in ('new','question','correction','instruction','plan','app_idea','chat','unclear','command','tap','failed'));
alter table public.telegram_pending drop constraint if exists telegram_pending_kind_check;
alter table public.telegram_pending add constraint telegram_pending_kind_check
  check (kind in ('capture','fact','action','plan','idea','type'));

-- ---------------------------------------------------------------
-- Gd. Training type: the bot asks once ("What type of training is Owen training?"); the guess from the name is only
-- a suggestion. 'none' = Nat said it isn't training (never asked or guessed again). Cards of kind 'type' hold the question.
-- ---------------------------------------------------------------
alter table public.weekly_targets drop constraint if exists weekly_targets_training_type_check;
alter table public.weekly_targets add constraint weekly_targets_training_type_check
  check (training_type is null or training_type in ('upper','lower','plyo','sprint','football','match','gym','other','none'));
alter table public.events drop constraint if exists events_training_type_check;
alter table public.events add constraint events_training_type_check
  check (training_type is null or training_type in ('upper','lower','plyo','sprint','football','match','gym','other','none'));
