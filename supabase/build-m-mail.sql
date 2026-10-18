-- Build 2, phase M (11 Oct): Email watcher. plans/build-2.md.
-- Apps Scripts in his school and personal Gmail send each new email's sender, subject and Gmail's short snippet (never
-- the full text) to the app; the cheap model sorts it into homework / needs a reply / event / ignore.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run. Adds three tables and allows one more value in telegram_turns.intent.
-- No data is dropped or deleted.

-- ---------------------------------------------------------------
-- Ma. One row per email the watcher has seen (never twice: account + Gmail's message id).
-- ---------------------------------------------------------------
create table if not exists public.emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account text not null check (account in ('school','personal')),
  message_id text not null check (char_length(message_id) between 1 and 200),
  thread_id text check (thread_id is null or char_length(thread_id) <= 200),
  from_name text check (from_name is null or char_length(from_name) <= 200),
  from_email text check (from_email is null or char_length(from_email) <= 320),
  subject text check (subject is null or char_length(subject) <= 300),
  snippet text check (snippet is null or char_length(snippet) <= 300),   -- Gmail's preview line, never the whole email
  received_at timestamptz not null,
  labels text[] not null default '{}',          -- Gmail's tabs: promotions, social, updates, forums
  automated boolean not null default false,     -- a mailing list, bulk or auto-reply
  via text not null default 'url' check (via in ('url','calendar')),   -- how it arrived (calendar = the fallback)
  status text not null default 'new' check (status in ('new','sorting','sorted','failed')),
  attempts integer not null default 0,
  kind text check (kind is null or kind in ('homework','reply','event','ignore')),
  flagged boolean not null default false,       -- one of his "always flag" rules matched
  summary text check (summary is null or char_length(summary) <= 300),
  why text check (why is null or char_length(why) <= 200),   -- "your rule: ignore …", "automated", "AI"
  details jsonb not null default '{}'::jsonb,   -- an event's title, date and times, as the AI read them
  notified_at timestamptz,                      -- when Telegram was told (homework/event card, reply alert)
  pending_id uuid,                              -- the card it became (telegram_pending)
  drafted_at timestamptz,                       -- he asked for a draft reply
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account, message_id)
);
create index if not exists emails_user_status on public.emails (user_id, status);
create index if not exists emails_user_received on public.emails (user_id, received_at desc);
drop trigger if exists emails_set_updated_at on public.emails;
create trigger emails_set_updated_at before update on public.emails for each row execute function public.set_updated_at();
alter table public.emails enable row level security;
drop policy if exists emails_owner_all on public.emails;
create policy emails_owner_all on public.emails for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Mb. His rules: "always flag emails from @ucs.org.uk", "ignore the Hudl newsletter". A rule is an address, a whole
-- domain (@…), or words in the sender's name or the subject. Removing one archives it (never deleted).
-- ---------------------------------------------------------------
create table if not exists public.mail_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  pattern text not null check (char_length(pattern) between 2 and 200),
  action text not null check (action in ('flag','ignore')),
  label text check (label is null or char_length(label) <= 120),   -- his words, e.g. "ucs.org.uk teachers"
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists mail_rules_set_updated_at on public.mail_rules;
create trigger mail_rules_set_updated_at before update on public.mail_rules for each row execute function public.set_updated_at();
alter table public.mail_rules enable row level security;
drop policy if exists mail_rules_owner_all on public.mail_rules;
create policy mail_rules_owner_all on public.mail_rules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Mc. Each Gmail account's watcher: when it last checked in (it checks in every 15 minutes, even with no new mail).
-- ---------------------------------------------------------------
create table if not exists public.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account text not null check (account in ('school','personal')),
  address text check (address is null or char_length(address) <= 320),
  via text not null default 'url' check (via in ('url','calendar')),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, account)
);
drop trigger if exists mail_accounts_set_updated_at on public.mail_accounts;
create trigger mail_accounts_set_updated_at before update on public.mail_accounts for each row execute function public.set_updated_at();
alter table public.mail_accounts enable row level security;
drop policy if exists mail_accounts_owner_all on public.mail_accounts;
create policy mail_accounts_owner_all on public.mail_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Md. The bot remembers its email alerts and drafts (so "draft a reply to that" has something to point at).
-- Widens the allowed list; every existing value stays allowed.
-- ---------------------------------------------------------------
alter table public.telegram_turns drop constraint if exists telegram_turns_intent_check;
alter table public.telegram_turns add constraint telegram_turns_intent_check
  check (intent in ('new','question','correction','instruction','plan','app_idea','chat','unclear','command','tap','failed','email'));

-- Check: select table_name from information_schema.tables where table_schema = 'public' and table_name in ('emails','mail_rules','mail_accounts');
