-- SAMPLE DATA for Stage 1. Sample only: change, archive or replace any of it later.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It fills in the only user under Authentication -> Users. If you have more than
-- one user, put your login email in v_email below first.
-- Running it again does nothing (it stops if your subjects already exist).
-- The result at the bottom says who it added data for (or that it was already there).

do $$
declare
  v_email text := null;  -- only needed if there is more than one user
  uid uuid;
  today date := (now() at time zone 'Europe/London')::date;
  dow int := extract(isodow from (now() at time zone 'Europe/London'))::int;
  next_fri date;
  this_sun date;
  c_study uuid; c_ath uuid; c_pers uuid;
  s_maths uuid; s_fm uuid; s_phys uuid; s_cs uuid; s_smc uuid; s_act uuid; s_foot uuid; s_gym uuid;
  t_foot uuid;
  h_morning uuid; h_night uuid; item uuid;
  who text;
begin
  if v_email is not null then
    select id into uid from auth.users where email = v_email;
  elsif (select count(*) from auth.users) = 1 then
    select id into uid from auth.users;
  end if;
  if uid is null then
    raise exception 'Could not pick your user. Put your login email in v_email at the top and run again.';
  end if;

  select email into who from auth.users where id = uid;

  if exists (select 1 from public.subjects where user_id = uid) then
    perform set_config('seed.result', 'Sample data was already there for ' || who || '. Nothing added.', false);
    return;
  end if;

  next_fri := today + ((5 - dow + 7) % 7);
  this_sun := today + (7 - dow);

  -- Profile (name for the greeting)
  insert into public.profiles (user_id, display_name) values (uid, 'Nat') on conflict (user_id) do nothing;

  -- Three areas
  insert into public.categories (user_id, name, description) values
    (uid, 'Study', 'School subjects, CS, SMC, ACT'),
    (uid, 'Athletic', 'Football, gym, sprint, recovery'),
    (uid, 'Personal', 'Everything else')
  on conflict (user_id, name) do nothing;
  select id into c_study from public.categories where user_id = uid and name = 'Study';
  select id into c_ath from public.categories where user_id = uid and name = 'Athletic';
  select id into c_pers from public.categories where user_id = uid and name = 'Personal';

  -- Subjects (tags inside the areas)
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_study, 'Maths', 1) returning id into s_maths;
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_study, 'Further Maths', 2) returning id into s_fm;
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_study, 'Physics', 3) returning id into s_phys;
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_study, 'CS', 4) returning id into s_cs;
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_study, 'SMC', 5) returning id into s_smc;
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_study, 'ACT', 6) returning id into s_act;
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_ath, 'Football', 7) returning id into s_foot;
  insert into public.subjects (user_id, category_id, name, sort_order) values (uid, c_ath, 'Gym', 8) returning id into s_gym;

  -- Weekly targets
  insert into public.weekly_targets (user_id, name, activity_type, subject_id, target_count, sync_source, sort_order)
    values (uid, 'Football', 'football', s_foot, 4, 'manual', 1) returning id into t_foot;
  insert into public.weekly_targets (user_id, name, activity_type, subject_id, target_count, sync_source, sort_order) values
    (uid, 'Upper', 'upper', s_gym, 3, 'hevy', 2),
    (uid, 'Lower + plyo', 'lower_plyo', s_gym, 2, 'trainheroic', 3),
    (uid, 'SMC', 'smc', s_smc, 3, 'manual', 4);

  -- Events (sample times; edit them in the events table)
  insert into public.events (user_id, title, category_id, subject_id, repeat_days, start_time, end_time, is_busy) values
    (uid, 'School', c_study, null, '{1,2,3,4,5}', '08:45', '16:00', true),
    (uid, 'CS tutor', c_study, s_cs, '{1,4}', '17:30', '18:30', true),
    (uid, 'Maths tutor', c_study, s_maths, '{3}', '17:00', '18:00', true);

  -- 5 sample tasks
  insert into public.tasks (user_id, title, category_id, subject_id, importance, status, origin, duration_minutes, due_at, source) values
    (uid, 'Physics homework', c_study, s_phys, 'must', 'today', 'school', 35, (next_fri + time '12:00') at time zone 'UTC', 'import');
  insert into public.tasks (user_id, title, category_id, subject_id, importance, status, origin, duration_minutes, source) values
    (uid, 'Further Maths bridging questions', c_study, s_fm, 'must', 'today', 'tutor_maths_physics', 45, 'import');
  insert into public.tasks (user_id, title, category_id, subject_id, importance, status, origin, duration_minutes, window_end, window_label, source) values
    (uid, 'CS hash-table video', c_study, s_cs, 'must', 'this_week', 'tutor_cs', 30, this_sun, 'before Mon', 'import');
  insert into public.tasks (user_id, title, category_id, subject_id, importance, status, origin, duration_minutes, source) values
    (uid, 'SMC 2020 Q11–16 review', c_study, s_smc, 'nice', 'today', 'own', 45, 'import');
  insert into public.tasks (user_id, title, details, category_id, subject_id, importance, status, origin, duration_minutes, target_id, source) values
    (uid, 'Football touches', 'Juggling + first touch', c_ath, s_foot, 'nice', 'today', 'own', 25, t_foot, 'import');

  -- Routines: ordered blocks with steps, no clock times
  insert into public.habits (user_id, name, sort_order, days_of_week) values (uid, 'Morning', 1, '{1,2,3,4,5,6,7}') returning id into h_morning;
  insert into public.habits (user_id, name, sort_order, days_of_week) values (uid, 'Night', 2, '{1,2,3,4,5,6,7}') returning id into h_night;

  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_morning, 'Wake', 1) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Feet on the floor', 'Curtains open', 'Glass of water']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_morning, 'Shower', 2) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Rinse', 'Body wash', 'Towel dry']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order, is_required, condition_label) values (uid, h_morning, 'Shave', 3, false, 'Shave days only') returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Prep', 'Shave', 'Rinse']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_morning, 'Teeth', 4) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Brush', 'Floss', 'Rinse']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_morning, 'Skincare', 5) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Cleanser', 'Moisturiser', 'SPF']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_morning, 'Eat, dress, bag', 6) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Breakfast', 'Get dressed', 'Check bag']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_morning, 'Leave', 7) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Phone, keys, card', 'Out the door']) with ordinality as x(t, o);

  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_night, 'Wind-down', 1) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Screens down', 'Tidy desk']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_night, 'Prep for tomorrow', 2) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Check calendar', 'Pack bag']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_night, 'Teeth', 3) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Brush', 'Floss']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_night, 'Skincare', 4) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Cleanser', 'Moisturiser']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_night, 'Reading', 5) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['10 pages']) with ordinality as x(t, o);
  insert into public.habit_items (user_id, habit_id, name, sort_order) values (uid, h_night, 'Lights out', 6) returning id into item;
  insert into public.routine_steps (user_id, habit_item_id, title, sort_order)
    select uid, item, t, o from unnest(array['Phone away from bed', 'Lights off']) with ordinality as x(t, o);

  perform set_config('seed.result', 'Added sample data for ' || who || '.', false);
end $$;

-- Shown as the result at the bottom of the SQL Editor.
select current_setting('seed.result', true) as result;
