create extension if not exists pgcrypto;

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  title text not null check (char_length(trim(title)) > 0),
  details text,
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'inbox' check (status in ('inbox','today','this_week','this_month','waiting','completed')),
  due_at timestamptz,
  is_key boolean not null default false,
  source text not null default 'manual' check (source in ('manual','dashboard','telegram_text','telegram_voice','import')),
  source_text text,
  completed_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.habits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  name text not null,
  is_required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_item_id uuid not null references public.habit_items(id) on delete cascade,
  log_date date not null default current_date,
  completed boolean not null default true,
  completed_at timestamptz,
  unique (user_id, habit_item_id, log_date)
);

create table if not exists public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_date date not null default current_date,
  raw_text text not null,
  summary text,
  source text not null default 'manual' check (source in ('manual','dashboard_voice','telegram_voice')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  period text not null check (period in ('week','month')),
  status text not null default 'active' check (status in ('active','completed','archived')),
  target_date date,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  item_type text not null check (item_type in ('note','link','risk','summary')),
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_user_status_idx on public.tasks(user_id, status);
create index if not exists tasks_user_due_idx on public.tasks(user_id, due_at);
create index if not exists tasks_user_key_idx on public.tasks(user_id, is_key);
create index if not exists habit_logs_user_date_idx on public.habit_logs(user_id, log_date);
create index if not exists journal_user_date_idx on public.journal_entries(user_id, entry_date desc);
create index if not exists goals_user_period_idx on public.goals(user_id, period, status);
create index if not exists memory_user_category_idx on public.memory_items(user_id, category_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists tasks_set_updated_at on public.tasks;
create trigger tasks_set_updated_at before update on public.tasks for each row execute function public.set_updated_at();

drop trigger if exists journals_set_updated_at on public.journal_entries;
create trigger journals_set_updated_at before update on public.journal_entries for each row execute function public.set_updated_at();

drop trigger if exists memory_set_updated_at on public.memory_items;
create trigger memory_set_updated_at before update on public.memory_items for each row execute function public.set_updated_at();

alter table public.categories enable row level security;
alter table public.tasks enable row level security;
alter table public.habits enable row level security;
alter table public.habit_items enable row level security;
alter table public.habit_logs enable row level security;
alter table public.journal_entries enable row level security;
alter table public.goals enable row level security;
alter table public.memory_items enable row level security;

create policy categories_owner_all on public.categories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy tasks_owner_all on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habits_owner_all on public.habits for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habit_items_owner_all on public.habit_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy habit_logs_owner_all on public.habit_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy journals_owner_all on public.journal_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy goals_owner_all on public.goals for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy memory_owner_all on public.memory_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);