-- Stage 1.5, step 9: Guides + Notion import.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Only adds a table, columns and a function; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- 9a. Guides: reference pages (skincare, sleep, supplements...).
-- Never deleted: Archive sets archived_at.
-- ---------------------------------------------------------------
create table if not exists public.guides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  icon text,
  body text not null default '',
  sort_order integer not null default 0,
  import_key text,                 -- e.g. 'notion:<page id>', so re-importing never duplicates
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists guides_import_key_uidx
  on public.guides(user_id, import_key) where import_key is not null;

alter table public.guides enable row level security;
drop policy if exists guides_owner_all on public.guides;
create policy guides_owner_all on public.guides
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 9b. A routine block links to its guide. A routine remembers where it came from.
-- ---------------------------------------------------------------
alter table public.habit_items
  add column if not exists guide_id uuid references public.guides(id) on delete set null;
alter table public.habits
  add column if not exists import_key text;
create unique index if not exists habits_import_key_uidx
  on public.habits(user_id, import_key) where import_key is not null;

-- ---------------------------------------------------------------
-- 9c. Import guides + routines in one go (all or nothing).
-- Runs as you, under row level security. Already-imported guides and
-- routines are skipped. An older routine with the same name (e.g. the
-- sample Morning/Night) is hidden (is_active off), never deleted.
-- ---------------------------------------------------------------
create or replace function public.import_guides_routines(payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  uid uuid := auth.uid();
  g jsonb; r jsonb; b jsonb; s text;
  gid uuid; hid uuid; iid uuid;
  k integer; bi integer; si integer;
  n_guides integer := 0; n_routines integer := 0; n_hidden integer := 0;
begin
  if uid is null then raise exception 'Not signed in'; end if;

  for g in select * from jsonb_array_elements(coalesce(payload->'guides', '[]'::jsonb)) loop
    insert into public.guides (title, icon, body, sort_order, import_key)
    values (g->>'title', g->>'icon', trim(coalesce(g->>'body', '')), coalesce((g->>'sort')::integer, 0), g->>'key')
    on conflict (user_id, import_key) where import_key is not null do nothing;
    get diagnostics k = row_count;
    n_guides := n_guides + k;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(payload->'routines', '[]'::jsonb)) loop
    if exists (select 1 from public.habits where user_id = uid and import_key = r->>'key') then
      continue;
    end if;
    update public.habits set is_active = false
      where user_id = uid and is_active and import_key is null and lower(name) = lower(r->>'name');
    get diagnostics k = row_count;
    n_hidden := n_hidden + k;

    insert into public.habits (name, sort_order, days_of_week, import_key)
    values (r->>'name', coalesce((r->>'sort')::integer, 0), '{1,2,3,4,5,6,7}', r->>'key')
    returning id into hid;

    bi := 0;
    for b in select * from jsonb_array_elements(coalesce(r->'blocks', '[]'::jsonb)) loop
      bi := bi + 1;
      gid := null;
      if b ? 'guide' then
        select id into gid from public.guides
          where user_id = uid and import_key = b->>'guide' and archived_at is null limit 1;
      end if;
      insert into public.habit_items (habit_id, name, is_required, sort_order, condition_label, guide_id)
      values (hid, b->>'name', true, bi, nullif(b->>'condition', ''), gid)
      returning id into iid;

      si := 0;
      for s in select * from jsonb_array_elements_text(coalesce(b->'steps', '[]'::jsonb)) loop
        si := si + 1;
        insert into public.routine_steps (habit_item_id, title, sort_order) values (iid, s, si);
      end loop;
    end loop;
    n_routines := n_routines + 1;
  end loop;

  return jsonb_build_object('guides', n_guides, 'routines', n_routines, 'hidden', n_hidden);
end;
$function$;
