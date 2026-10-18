-- One-off for Nat's REAL database (13 Oct 2026, his answers). Safe to run twice. Nothing is deleted.
-- 1. Evening tutor events archived (CS tutor Mon/Thu 17:30, Maths tutor Wed 17:00) so Monday upper fits after school.
update public.events set archived_at = now()
where archived_at is null and coalesce(external_source, 'manual') <> 'google'
  and title in ('CS tutor', 'Maths tutor') and start_time >= '16:00';
-- 2. Circuit no longer pinned to Tuesday (any light day); free periods every week from the setting, not the school calendar.
update public.profiles set planning = jsonb_set(coalesce(planning, '{}'::jsonb), '{owenDays}', coalesce(planning->'owenDays', '{}'::jsonb) - 'circuit')
  || '{"schoolFreePeriods":"mon 11:40-12:50, tue 09:10-10:15, thu 14:20-14:50, fri 09:10-10:15"}'::jsonb;
-- 3. Circuit is low CNS (Owen sets it): its own load cost.
insert into public.load_costs (user_id, scope, type_key, title, weekday, legs, upper, cns)
select p.user_id, 'session', 'plyo', 'Circuit', null, 4, 2, 2 from public.profiles p
where not exists (select 1 from public.load_costs c where c.user_id = p.user_id and c.scope = 'session' and c.title = 'Circuit' and c.archived_at is null);
