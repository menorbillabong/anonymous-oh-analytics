-- Run inside a transaction and ALWAYS roll back. All fixture rows are synthetic.
-- Negative IDs avoid consuming the application's identity sequences.
create temporary table mission_test_context(admin_id uuid,user_a uuid,user_b uuid,period_a uuid,period_b uuid,unlimited uuid);
insert into mission_test_context(admin_id,user_a,user_b)
select (select user_id from public.admin_users limit 1),
       (select id from auth.users u where not exists(select 1 from public.admin_users a where a.user_id=u.id) and private.account_active(u.id) order by id limit 1),
       (select id from auth.users u where not exists(select 1 from public.admin_users a where a.user_id=u.id) and private.account_active(u.id) order by id offset 1 limit 1);
grant select,update on mission_test_context to authenticated;
do $$ begin
 if exists(select 1 from mission_test_context where admin_id is null or user_a is null or user_b is null) then raise exception 'Test requires admin and two active accounts'; end if;
end $$;

create function pg_temp.expect_error(statement text,expected text)
returns void language plpgsql as $$
declare raised boolean:=false;
begin
 begin execute statement;
 exception when others then
  if position(expected in sqlerrm)=0 then raise exception 'Unexpected error: %',sqlerrm; end if;
  raised:=true;
 end;
 if not raised then raise exception 'Expected rejection containing %',expected; end if;
end;
$$;

-- Fixture setup only; restore normal trigger behavior before exercising APIs.
set local session_replication_role=replica;
insert into public.mission_profiles(id,user_id,name,reward,active,network)
select -990001,user_a,'TEST normal',0,true,'X' from mission_test_context union all
select -990002,user_a,'TEST bonus',100,true,'X' from mission_test_context union all
select -990003,user_b,'TEST other bonus',100,true,'X' from mission_test_context;
insert into public.posts(id,user_id,title,published_at,x_published_at,mission_profile_id,special_reward,counting_excluded)
select -991001,user_a,'TEST first','2098-09-15'::date,null::timestamptz,-990001,0,false from mission_test_context union all
select -991002,user_a,'TEST second','2098-09-12'::date,null::timestamptz,-990001,0,false from mission_test_context union all
select -991003,user_b,'TEST other user','2098-09-12'::date,null::timestamptz,null,0,false from mission_test_context union all
select -991004,user_a,'TEST outside','2098-09-16'::date,null::timestamptz,null,0,false from mission_test_context union all
select -991005,user_a,'TEST legacy','2098-09-12'::date,null::timestamptz,-990002,100,false from mission_test_context union all
select -991006,user_a,'TEST closed','2098-09-12'::date,null::timestamptz,null,0,true from mission_test_context union all
select -991007,user_a,'TEST midnight','2098-09-16'::date,'2098-09-16 02:59:59+00'::timestamptz,null,0,false from mission_test_context;
set local session_replication_role=origin;

select set_config('request.jwt.claim.sub',admin_id::text,true) from mission_test_context;
set local role authenticated;
update mission_test_context set period_a=public.create_mission_selection_period('2098-09-10','2098-09-15',1);
update mission_test_context set period_b=public.create_mission_selection_period('2098-09-15','2098-09-20',1);
update mission_test_context set unlimited=public.create_mission_selection_period('2098-09-01','2098-09-30',null);
select pg_temp.expect_error($q$select public.create_mission_selection_period('2098-09-20','2098-09-10',1)$q$,'MISSION_PERIOD_INVALID');
select pg_temp.expect_error($q$select public.create_mission_selection_period('2098-09-10','2098-09-11',0)$q$,'MISSION_PERIOD_INVALID');
select pg_temp.expect_error($q$select public.create_mission_selection_period('2098-09-10','2098-09-15',5)$q$,'unique');

select set_config('request.jwt.claim.sub',user_a::text,true) from mission_test_context;
select pg_temp.expect_error($q$select public.create_mission_selection_period('2098-10-01','2098-10-20',5)$q$,'MISSION_PERIOD_ADMIN_REQUIRED');
select pg_temp.expect_error($q$insert into public.mission_selection_periods(start_date,end_date,created_by) values ('2098-10-01','2098-10-20',auth.uid())$q$,'permission denied');
select pg_temp.expect_error($q$insert into public.mission_period_selections(post_id,period_id,user_id,mission_profile_id) select -991001,period_a,user_a,-990002 from mission_test_context$q$,'permission denied');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991003,-990002) from mission_test_context$q$,'MISSION_PERIOD_POST_NOT_FOUND');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991001,-990003) from mission_test_context$q$,'MISSION_PERIOD_PROFILE');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991001,-990001) from mission_test_context$q$,'MISSION_PERIOD_PROFILE');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991004,-990002) from mission_test_context$q$,'MISSION_PERIOD_INELIGIBLE');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991005,-990002) from mission_test_context$q$,'MISSION_PERIOD_HAS_BONUS');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991006,-990002) from mission_test_context$q$,'MISSION_PERIOD_INELIGIBLE');
select public.set_my_mission_period_selection(period_a,-991001,-990002) from mission_test_context;
do $$ begin
 if (select count(*) from public.mission_period_selections where post_id=-991001)<>1 then raise exception 'Selection missing'; end if;
 if not exists(select 1 from public.posts where id=-991001 and special_reward=100 and mission_profile_id=-990002 and mission_name='TEST bonus') then raise exception 'Profile/bonus not synchronized'; end if;
end $$;
select public.set_my_mission_period_selection(period_a,-991001,-990002) from mission_test_context;
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991002,-990002) from mission_test_context$q$,'MISSION_PERIOD_LIMIT');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_b,-991001,-990002) from mission_test_context$q$,'MISSION_PERIOD_ALREADY_ASSIGNED');
select pg_temp.expect_error($q$update public.posts set mission_profile_id=null where id=-991001$q$,'Períodos de Missão');

-- The same limit applies separately to another account; RLS hides user A.
select set_config('request.jwt.claim.sub',user_b::text,true) from mission_test_context;
do $$ begin
 if exists(select 1 from public.mission_period_selections where post_id=-991001) then raise exception 'Cross-user selection leak'; end if;
 if (select count(*) from public.mission_selection_periods where start_date>='2098-09-01')<3 then raise exception 'Shared periods missing'; end if;
end $$;
select public.set_my_mission_period_selection(period_a,-991003,-990003) from mission_test_context;

select set_config('request.jwt.claim.sub',user_a::text,true) from mission_test_context;
select public.set_my_mission_period_selection(period_a,-991001,null) from mission_test_context;
do $$ begin
 if not exists(select 1 from public.posts where id=-991001 and mission_profile_id=-990001 and special_reward=0) then raise exception 'Previous normal profile not restored'; end if;
end $$;
select public.set_my_mission_period_selection(period_b,-991001,-990002) from mission_test_context;
select public.set_my_mission_period_selection(period_a,-991002,-990002) from mission_test_context;
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(period_a,-991001,null) from mission_test_context$q$,'MISSION_PERIOD_ALREADY_ASSIGNED');
select public.set_my_mission_period_selection(period_a,-991002,null) from mission_test_context;
select public.set_my_mission_period_selection(period_a,-991007,-990002) from mission_test_context;
select public.set_my_mission_period_selection(unlimited,-991002,-990002) from mission_test_context;
select public.set_my_mission_period_selection(unlimited,-991004,-990002) from mission_test_context;
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(unlimited,-991006,null) from mission_test_context$q$,'MISSION_PERIOD_INELIGIBLE');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect_error($q$select * from public.mission_selection_periods$q$,'permission denied');
select pg_temp.expect_error($q$select public.create_mission_selection_period('2098-09-10','2098-09-15',1)$q$,'permission denied');
reset role;
select 'PASS: admin-only creation, validation, per-user limit, inclusive dates, overlap, bonus sync, restore, isolation and anonymous access' as result;
