-- Step 9: Telegram assistant (two small tables + the 5-minute timer).
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run. Only adds tables, extensions and one scheduled job; nothing is dropped or deleted.
-- Also run supabase/step9-vault.local.sql once (it stores the tick secret). Either order works:
-- the timer sends nothing until that secret exists.

-- ---------------------------------------------------------------
-- 9a. Messages already handled or sent, so nothing goes out twice.
-- Keys look like 'brief:2026-10-11', 'rem:<reminder id>', 'upd:<telegram update id>'.
-- Not personal data: the bot removes a key again only if sending failed, so a later try can send it.
-- ---------------------------------------------------------------
create table if not exists public.telegram_sent (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null check (char_length(key) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, key)             -- a second insert of the same key fails, which means "already done"
);

alter table public.telegram_sent enable row level security;
drop policy if exists telegram_sent_owner_all on public.telegram_sent;
create policy telegram_sent_owner_all on public.telegram_sent for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 9b. Proposals waiting for a button tap (✅ Save / 📥 Inbox / ✏️ Edit / ✖ Cancel, or 💾 Save fact).
-- Nothing is saved to tasks etc. until Nat taps. Tapping only changes status; rows are never deleted.
-- ---------------------------------------------------------------
create table if not exists public.telegram_pending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('capture','fact')),
  text text not null check (char_length(trim(text)) > 0),   -- Nat's original words
  payload jsonb not null default '{}'::jsonb,                -- the AI's proposal (or the fact to save)
  status text not null default 'open' check (status in ('open','saved','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists telegram_pending_set_updated_at on public.telegram_pending;
create trigger telegram_pending_set_updated_at before update on public.telegram_pending
  for each row execute function public.set_updated_at();

alter table public.telegram_pending enable row level security;
drop policy if exists telegram_pending_owner_all on public.telegram_pending;
create policy telegram_pending_owner_all on public.telegram_pending for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- 9c. Every 5 minutes, Supabase calls the app's /api/telegram/tick, which sends whatever is due
-- (07:00 brief, 18:00 nudge, Sunday check-in reminder, time reminders, "leave in 10 min").
-- London time is worked out in the app, so the timer itself doesn't care about BST/GMT.
-- The secret is read from Vault at call time, so it never appears in this file or in the job list.
-- If the app's address ever changes, edit the URL below and run this file again.
-- ---------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'nat-os-telegram-tick',               -- same name = re-running replaces the job, never adds a second
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := 'https://personal-os-roan-rho.vercel.app/api/telegram/tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || s.decrypted_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  from vault.decrypted_secrets s
  where s.name = 'telegram_tick_secret';  -- no secret yet = no call
  $job$
);

-- Check it worked (should list one job, active = true):
-- select jobname, schedule, active from cron.job where jobname = 'nat-os-telegram-tick';
-- To pause it later (not delete): select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'nat-os-telegram-tick'), active := false);
