-- Build 2, phase I (11 Oct): Google Calendar (BUILD-GUIDE step 11, my-spec 25/26/28). plans/build-2.md.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Run supabase/build-h.sql first.
-- Safe to re-run. Adds two tables and a few columns. No data is dropped or deleted.

-- ---------------------------------------------------------------
-- Ia. Connections to other services (Google now, Whoop next). The sign-in tokens are stored ENCRYPTED with a key
-- that only the server has (TOKEN_KEY in Vercel), so this row is useless to anyone who reads it, browser included.
-- ---------------------------------------------------------------
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','whoop')),
  status text not null default 'connected' check (status in ('connected','needs_reconnect','disconnected')),
  token_enc text check (token_enc is null or char_length(token_enc) <= 8000),   -- encrypted; never plain
  account text,                                -- shown in Settings, e.g. the Google account's email
  scopes text,
  settings jsonb not null default '{}'::jsonb, -- Google: the Life OS calendar, which calendars to read, sync tokens
  last_sync_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
drop trigger if exists integrations_set_updated_at on public.integrations;
create trigger integrations_set_updated_at before update on public.integrations for each row execute function public.set_updated_at();
alter table public.integrations enable row level security;
drop policy if exists integrations_owner_all on public.integrations;
create policy integrations_owner_all on public.integrations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Ib. What the app has put in his "Life OS" Google calendar: one row per session or planned block, so a change on
-- either side goes to the right place and nothing is sent twice. Only ever points into the Life OS calendar.
-- ---------------------------------------------------------------
create table if not exists public.google_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item_key text not null check (char_length(item_key) between 1 and 200),   -- "event:<id>:<usual date>" or "block:<id>"
  on_date date not null,
  google_id text,                              -- the event in the Life OS calendar (null once removed there)
  hash text,                                   -- what was last sent, so unchanged items aren't sent again
  google_updated text,                         -- Google's "updated" after our last write (newer = he changed it there)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, item_key)
);
drop trigger if exists google_links_set_updated_at on public.google_links;
create trigger google_links_set_updated_at before update on public.google_links for each row execute function public.set_updated_at();
alter table public.google_links enable row level security;
drop policy if exists google_links_owner_all on public.google_links;
create policy google_links_owner_all on public.google_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Ic. Events read from his other Google calendars (read-only copies: external_source 'google'), and whether an app
-- event goes into Life OS.
-- ---------------------------------------------------------------
alter table public.events add column if not exists all_day boolean not null default false;
alter table public.events add column if not exists calendar_id text;               -- the Google calendar it came from
alter table public.events add column if not exists sync_google boolean not null default true;   -- app events: show in Life OS

-- ---------------------------------------------------------------
-- Id. Homework read from Google Classroom ("Assignment: …" events): one task per Google event, never twice.
-- ---------------------------------------------------------------
alter table public.tasks add column if not exists external_id text;
create unique index if not exists tasks_external_uidx on public.tasks(user_id, external_id) where external_id is not null;
