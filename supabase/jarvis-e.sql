-- Jarvis phase E: places, travel between them, leave-by (plans/jarvis.md, my-spec 41 and 44).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/jarvis-d2.sql first.
-- Safe to re-run. Only adds two tables and a column; nothing is dropped or deleted.

-- ---------------------------------------------------------------
-- Ea. Saved places (home, school, football, Owen's track, tutors). The address is optional: only needed for
-- automatic travel times (a maps service turns it into a map position, lat/lng).
-- ---------------------------------------------------------------
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  address text check (address is null or char_length(address) <= 200),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  is_home boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);
create unique index if not exists places_one_home on public.places (user_id) where is_home and archived_at is null;
drop trigger if exists places_set_updated_at on public.places;
create trigger places_set_updated_at before update on public.places for each row execute function public.set_updated_at();
alter table public.places enable row level security;
drop policy if exists places_owner_all on public.places;
create policy places_owner_all on public.places for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Eb. Minutes between two places: told by Nat ("school to football is 25 min by bus", source 'manual'),
-- or worked out by a maps service (Mapbox driving for an Uber, TfL for tube/bus), cached per hour of the day.
-- Undo archives a row; nothing is deleted.
-- ---------------------------------------------------------------
create table if not exists public.travel_times (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  from_place_id uuid not null references public.places(id) on delete cascade,
  to_place_id uuid not null references public.places(id) on delete cascade,
  mode text not null check (mode in ('walk','bus','tube','train','transit','car','uber','cycle','any')),
  minutes integer not null check (minutes between 1 and 300),
  source text not null default 'manual' check (source in ('manual','mapbox','tfl')),
  depart_hour smallint check (depart_hour is null or depart_hour between 0 and 23),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_place_id <> to_place_id),
  unique nulls not distinct (user_id, from_place_id, to_place_id, mode, source, depart_hour)
);
drop trigger if exists travel_times_set_updated_at on public.travel_times;
create trigger travel_times_set_updated_at before update on public.travel_times for each row execute function public.set_updated_at();
alter table public.travel_times enable row level security;
drop policy if exists travel_times_owner_all on public.travel_times;
create policy travel_times_owner_all on public.travel_times for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Ec. Where each event is. Travel is then worked out from where Nat will actually be before it
-- (the previous event's place, else home). Events without a place keep their own travel minutes.
-- ---------------------------------------------------------------
alter table public.events add column if not exists place_id uuid references public.places(id) on delete set null;

-- Travel settings live with the other planning settings (profiles.planning, from jarvis-b.sql):
--   uberPickupMin 5 (added to the driving time for an Uber) · transitSlackMin 10 (tube/bus wins if it's
--   no more than this many minutes slower than an Uber: "as fast or nearly as fast")
