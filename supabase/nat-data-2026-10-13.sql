-- One-off data for Nat's REAL database (13 Oct 2026): planner fixes, SMC finished, maths topics seeded.
-- One file: SQL Editor -> New query -> paste -> Run. Not for the test database (it changes your own settings).
-- Nothing is deleted: tasks, goals and the SMC subject are archived (restore from Archive). Safe to re-run.
-- Before: your settings are saved in planning_backups (one row per run) so they can be put back.

-- The topic colours (same as supabase/maths.sql).
alter table public.topics add column if not exists status text not null default 'not_started';
alter table public.topics add column if not exists status_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'topics_status_check') then
    alter table public.topics add constraint topics_status_check check (status in ('not_started', 'not_secure', 'understand', 'exam_ready'));
  end if;
end $$;

-- Your settings as they were, so they can be put back.
create table if not exists public.planning_backups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  planning jsonb, created_at timestamptz not null default now()
);
alter table public.planning_backups enable row level security;
drop policy if exists planning_backups_owner_all on public.planning_backups;
create policy planning_backups_owner_all on public.planning_backups for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
insert into public.planning_backups (user_id, planning) select user_id, planning from public.profiles;

-- 1–9. Planner: upper always heavy, 90 min, 2× (Mon after school, Sat 09:30); no Stretching session; leave school 16:05,
-- PureGym 20 min from school; heavy lower Thu, Owen Tue speed + circuits / Fri injury prevention / Sat core; nothing extra
-- on Wednesday; Tue + Wed high-CNS is the baseline (no warning); load limits that fit the real week (day 40, 7 days 160).
update public.profiles set planning = coalesce(planning, '{}'::jsonb) || '{"sessionTypes":[{"key":"speed","name":"Speed + circuits","type":"sprint","intensity":"heavy","minutes":null,"extraMinutes":7,"extraLabel":"5–7 min circuits after","perWeek":1,"places":["owen"],"owen":true,"target":null,"flexible":false,"noLower":false,"stackWith":null},{"key":"heavy_lower","name":"Heavy lower","type":"lower","intensity":"heavy","minutes":null,"perWeek":1,"needs":["barbell","squat_rack"],"wants":["leg_press","lower_machines"],"places":["school_gym","puregym"],"owen":true,"target":"Lower + plyo","flexible":false,"noLower":false,"stackWith":null},{"key":"injury","name":"Injury prevention","type":"injury","intensity":"moderate","minutes":null,"perWeek":1,"places":["home"],"owen":true,"target":null,"flexible":false,"noLower":false,"stackWith":null},{"key":"core","name":"Core","type":"core","intensity":"light","minutes":null,"perWeek":1,"places":["home"],"owen":true,"target":null,"flexible":false,"noLower":true,"stackWith":null},{"key":"stretch","name":"Stretching","type":"mobility","intensity":"light","minutes":null,"perWeek":2,"maxPerWeek":4,"places":["home"],"owen":false,"target":null,"flexible":true,"noLower":false,"stackWith":null,"archived":true},{"key":"upper","name":"Upper","type":"upper","intensity":"heavy","minutes":90,"perWeek":2,"wants":["upper_machines","cables","chest_machines","free_weights"],"places":["puregym","school_gym"],"owen":false,"target":"Upper","flexible":false,"noLower":false,"stackWith":null,"noLighter":true},{"key":"circuit","name":"Circuit","type":"plyo","intensity":"moderate","minutes":null,"perWeek":1,"places":["home"],"owen":false,"target":null,"flexible":false,"noLower":false,"stackWith":null}],"trainingPlaces":[{"key":"home","name":"Home","address":"29 New End, Hampstead","equipment":["plyo_space","circuit_space","bench","dumbbells","lunges","mat"],"goodFor":"plyos and circuits, injury prevention, lunges, Bulgarians, core, stretching","access":"any","fromHome":0,"fromSchool":null,"toHome":0,"mode":"walk"},{"key":"school_gym","name":"School gym","address":"UCS Hampstead","equipment":["barbell","squat_rack","free_weights","incline_bench","leg_press","lunges","chest_machines","cables","dumbbells","bench","upper_machines","lower_machines"],"poor":["upper_machines","lower_machines"],"goodFor":"barbells, squat rack, free weights, incline bench, leg press; good chest machines and cables","access":"school","fromHome":null,"fromSchool":0,"toHome":null,"mode":"walk","freePeriods":null},{"key":"puregym","name":"PureGym Swiss Cottage","address":"Swiss Cottage, London","equipment":["full"],"goodFor":"everything","access":"any","fromHome":30,"fromSchool":20,"toHome":30,"mode":"bus","bestAfterSchool":true},{"key":"owen","name":"Owen","equipment":["track","plyo_space"],"goodFor":"speed sessions with Owen","access":"owen","fromHome":null,"fromSchool":null,"toHome":null}],"owenDays":{"speed":[2],"heavy_lower":[4],"injury":[5],"core":[6],"circuit":[2],"upper":[1,6]},"owenBaseline":{"speed":[2],"heavy_lower":[4],"injury":[5],"core":[6]},"sessionTimes":{"upper":{"6":"09:30"}},"noTrainingDays":"wednesday","cnsBaseline":"tuesday, wednesday","leaveSchoolAt":"16:05","dayMaxLoad":40,"weekMaxLoad":160}'::jsonb;

-- Upper barely touches legs or CNS: his cost for the upper type (legs 0, upper 9, CNS 2).
insert into public.load_costs (user_id, scope, type_key, legs, upper, cns)
select p.user_id, 'type', 'upper', 0, 9, 2 from public.profiles p
where not exists (select 1 from public.load_costs c where c.user_id = p.user_id and c.scope = 'type' and c.type_key = 'upper' and c.archived_at is null);

-- "No heavy gym the day before a game": upper taken out (Saturday-morning upper before Sunday games is fine).
update public.training_rules set params = jsonb_set(params, '{what}', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(params->'what') x where x <> '"upper"')),
  label = 'No heavy lower, plyo or gym the day before a game (upper is fine)'
where kind = 'gap' and params->'what' ? 'upper' and params->'near' ? 'match';

-- 7. SMC is finished: every SMC task and goal archived, and the SMC subject.
update public.tasks set archived_at = now(), archive_reason = 'dropped'
where archived_at is null and (title ilike '%smc%' or subject_id in (select id from public.subjects where name = 'SMC'));
update public.goals set archived_at = now() where archived_at is null and (title ilike '%smc%' or subject_id in (select id from public.subjects where name = 'SMC'));
update public.subjects set archived_at = now() where name = 'SMC' and archived_at is null;

-- No maths/FM homework now, and the last FM test is done: open maths/FM homework with a due date and past maths tests archived.
update public.tasks set status = 'completed', completed_at = now(), archived_at = now(), archive_reason = 'done'
where archived_at is null and status <> 'completed' and due_at is not null and subject_id in (select id from public.subjects where name in ('Maths', 'Further Maths'));
update public.goals set archived_at = now()
where archived_at is null and kind = 'test' and (target_date is null or target_date <= current_date) and subject_id in (select id from public.subjects where name in ('Maths', 'Further Maths'));

-- Maths + Further Maths topics, all ⚪, in textbook order ("Book 1 · 3" = section and chapter). Only if the course has none.
insert into public.topics (user_id, subject_id, name, spec_ref, sort_order, status)
select s.user_id, s.id, v.name, v.spec_ref, v.sort_order, 'not_started'
from public.subjects s, (values
  ('Proof & mathematical communication', 'Book 1 · 1', 0),
  ('Indices & surds', 'Book 1 · 2', 1),
  ('Quadratic functions', 'Book 1 · 3', 2),
  ('Polynomials', 'Book 1 · 4', 3),
  ('Using graphs', 'Book 1 · 5', 4),
  ('Coordinate geometry', 'Book 1 · 6', 5),
  ('Logarithms', 'Book 1 · 7', 6),
  ('Exponential models', 'Book 1 · 8', 7),
  ('Binomial expansion', 'Book 1 · 9', 8),
  ('Trigonometric functions & equations', 'Book 1 · 10', 9),
  ('Triangle geometry', 'Book 1 · 11', 10),
  ('Vectors', 'Book 1 · 12', 11),
  ('Differentiation', 'Book 1 · 13', 12),
  ('Applications of differentiation', 'Book 1 · 14', 13),
  ('Integration', 'Book 1 · 15', 14),
  ('Working with data', 'Book 1 · 16', 15),
  ('Probability', 'Book 1 · 17', 16),
  ('Statistical hypothesis testing', 'Book 1 · 18', 17),
  ('Introduction to kinematics', 'Book 1 · 19', 18),
  ('Motion with constant acceleration', 'Book 1 · 20', 19),
  ('Force and motion', 'Book 1 · 21', 20),
  ('Objects in contact', 'Book 1 · 22', 21),
  ('Proof', 'Book 2 · 1', 22),
  ('Functions', 'Book 2 · 2', 23),
  ('Further transformations of graphs', 'Book 2 · 3', 24),
  ('Sequences & series', 'Book 2 · 4', 25),
  ('Rational functions & partial fractions', 'Book 2 · 5', 26),
  ('General binomial expansion', 'Book 2 · 6', 27),
  ('Radian measure', 'Book 2 · 7', 28),
  ('Further trigonometry', 'Book 2 · 8', 29),
  ('Calculus of exponential & trig functions', 'Book 2 · 9', 30),
  ('Further differentiation', 'Book 2 · 10', 31),
  ('Further integration techniques', 'Book 2 · 11', 32),
  ('Further applications of calculus', 'Book 2 · 12', 33),
  ('Differential equations', 'Book 2 · 13', 34),
  ('Numerical solution of equations', 'Book 2 · 14', 35),
  ('Numerical integration', 'Book 2 · 15', 36),
  ('Conditional probability', 'Book 2 · 16', 37),
  ('Normal distribution', 'Book 2 · 17', 38),
  ('Further hypothesis testing', 'Book 2 · 18', 39),
  ('Applications of vectors', 'Book 2 · 19', 40),
  ('Projectiles', 'Book 2 · 20', 41),
  ('Forces in context', 'Book 2 · 21', 42),
  ('Moments', 'Book 2 · 22', 43)
) as v(name, spec_ref, sort_order)
where s.name = 'Maths' and s.archived_at is null
  and not exists (select 1 from public.topics t where t.subject_id = s.id and t.archived_at is null);

insert into public.topics (user_id, subject_id, name, spec_ref, sort_order, status)
select s.user_id, s.id, v.name, v.spec_ref, v.sort_order, 'not_started'
from public.subjects s, (values
  ('Matrices', 'Pure Core 1 · 1', 0),
  ('Further vectors', 'Pure Core 1 · 2', 1),
  ('Applications of matrices', 'Pure Core 1 · 3', 2),
  ('Complex numbers', 'Pure Core 1 · 4', 3),
  ('Roots of polynomials', 'Pure Core 1 · 5', 4),
  ('Mathematical induction', 'Pure Core 1 · 6', 5),
  ('Series & induction', 'Pure Core 2 · 1', 6),
  ('Powers & roots of complex numbers', 'Pure Core 2 · 2', 7),
  ('Complex numbers & trigonometry', 'Pure Core 2 · 3', 8),
  ('Lines & planes in space', 'Pure Core 2 · 4', 9),
  ('Simultaneous equations & planes', 'Pure Core 2 · 5', 10),
  ('Hyperbolic functions', 'Pure Core 2 · 6', 11),
  ('Further calculus techniques', 'Pure Core 2 · 7', 12),
  ('Applications of calculus', 'Pure Core 2 · 8', 13),
  ('Polar coordinates', 'Pure Core 2 · 9', 14),
  ('Differential equations', 'Pure Core 2 · 10', 15),
  ('Applications of differential equations', 'Pure Core 2 · 11', 16),
  ('Counting principles & probability', 'Statistics · 1', 17),
  ('Discrete random variables', 'Statistics · 2', 18),
  ('Poisson distribution', 'Statistics · 3', 19),
  ('Non-parametric hypothesis tests', 'Statistics · 4', 20),
  ('Correlation & regression', 'Statistics · 5', 21),
  ('Chi-squared tests', 'Statistics · 6', 22),
  ('Continuous distributions', 'Statistics · 7', 23),
  ('Combining random variables', 'Statistics · 8', 24),
  ('Further hypothesis tests & confidence intervals', 'Statistics · 9', 25),
  ('Work energy & power 1', 'Mechanics · 1', 26),
  ('Dimensional analysis', 'Mechanics · 2', 27),
  ('Momentum & collisions 1', 'Mechanics · 3', 28),
  ('Circular motion 1', 'Mechanics · 4', 29),
  ('Centres of mass 1', 'Mechanics · 5', 30),
  ('Work energy & power 2', 'Mechanics · 6', 31),
  ('Linear motion under variable force', 'Mechanics · 7', 32),
  ('Momentum & collisions 2', 'Mechanics · 8', 33),
  ('Circular motion 2', 'Mechanics · 9', 34),
  ('Centres of mass 2', 'Mechanics · 10', 35)
) as v(name, spec_ref, sort_order)
where s.name = 'Further Maths' and s.archived_at is null
  and not exists (select 1 from public.topics t where t.subject_id = s.id and t.archived_at is null);
