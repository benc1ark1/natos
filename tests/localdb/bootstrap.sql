-- The bits of Supabase that the app's SQL expects, on a plain local Postgres (test-only).
-- start.mjs runs this on every test database before the app's own SQL. Safe to re-run.

-- Roles: PostgREST logs in as "authenticator" and switches to anon / authenticated / service_role
-- (the JWT's "role"). service_role skips row level security, like Supabase's.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
alter role service_role bypassrls;
grant anon, authenticated, service_role to authenticator;

-- Extensions live in their own schema, as on Supabase (pgcrypto: crypt() for passwords, digest(), ...)
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists pgcrypto with schema extensions;
do $$ begin execute format('alter database %I set search_path = "$user", public, extensions', current_database()); end $$;

-- auth: the users table (the columns Supabase's auth server keeps that matter here) and the JWT helpers
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud text default 'authenticated',
  role text default 'authenticated',
  email text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  invited_at timestamptz,
  confirmation_sent_at timestamptz,
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb not null default '{"provider": "email", "providers": ["email"]}',
  raw_user_meta_data jsonb not null default '{}',
  is_super_admin boolean,
  phone text unique,
  phone_confirmed_at timestamptz,
  confirmed_at timestamptz generated always as (least(email_confirmed_at, phone_confirmed_at)) stored,
  banned_until timestamptz,
  deleted_at timestamptz,
  is_sso_user boolean not null default false,
  is_anonymous boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- PostgREST v12+ puts the JWT's claims in request.jwt.claims (JSON); older ones used request.jwt.claim.*
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Supabase's default grants: the API roles can use public tables; row level security does the restricting.
-- "for role postgres" covers every table the app's SQL creates later (the tests connect as postgres).
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- After any schema change, tell PostgREST to reload its schema cache (it listens on "pgrst").
create or replace function extensions.pgrst_watch() returns event_trigger language plpgsql as $$
begin
  notify pgrst, 'reload schema';
end $$;
drop event trigger if exists pgrst_ddl_watch;
create event trigger pgrst_ddl_watch on ddl_command_end execute function extensions.pgrst_watch();
drop event trigger if exists pgrst_drop_watch;
create event trigger pgrst_drop_watch on sql_drop execute function extensions.pgrst_watch();
