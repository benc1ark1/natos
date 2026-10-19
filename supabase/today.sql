-- Queue item 5: the Today screen and the morning/evening messages (overnight build, 19 Oct 2026).
-- Run after supabase/tracker.sql. Run once in Supabase → SQL Editor → New query → paste → Run. Safe to run more than once.
-- Nothing is dropped or deleted. Today's items are plan blocks; these columns say exactly what to open and what "done"
-- moves forward (a topic's next step, a programme item, a test's attempt).

alter table public.plan_blocks add column if not exists pick_key text;            -- the planner's key, e.g. 'topic:<id>:ahead'
alter table public.plan_blocks add column if not exists source text;              -- 'auto' (the morning plan) · 'week' · 'day' · 'chat'
alter table public.plan_blocks add column if not exists open_text text;           -- the exact thing to open
alter table public.plan_blocks add column if not exists open_url text;
alter table public.plan_blocks add column if not exists topic_id uuid references public.topics(id) on delete set null;
alter table public.plan_blocks add column if not exists programme_item_id uuid references public.programme_items(id) on delete set null;
alter table public.plan_blocks add column if not exists rolled_from date;         -- not done that day → rolled forward to this one

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plan_blocks_today_check') then
    alter table public.plan_blocks add constraint plan_blocks_today_check check (
      (pick_key is null or char_length(pick_key) <= 200) and (source is null or source in ('auto', 'week', 'day', 'chat'))
      and (open_text is null or char_length(open_text) <= 400) and (open_url is null or open_url ~* '^https?://'));
  end if;
end $$;
create index if not exists plan_blocks_pick_idx on public.plan_blocks (user_id, on_date, pick_key) where pick_key is not null;
