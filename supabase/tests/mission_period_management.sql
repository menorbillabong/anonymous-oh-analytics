-- Execute after the migration inside BEGIN ... ROLLBACK only.
create temporary table mission_v2_context(admin_id uuid,user_a uuid,user_b uuid,old_period uuid,new_period uuid,unconfigured uuid);
insert into mission_v2_context(admin_id,user_a,user_b)
select (select user_id from public.admin_users limit 1),
 (select id from auth.users u where not exists(select 1 from public.admin_users a where a.user_id=u.id) and private.account_active(u.id) order by id limit 1),
 (select id from auth.users u where not exists(select 1 from public.admin_users a where a.user_id=u.id) and private.account_active(u.id) order by id offset 1 limit 1);
grant select,update on mission_v2_context to authenticated;
create function pg_temp.expect_error(statement text,expected text) returns void language plpgsql as $$
declare raised boolean:=false;begin
 begin execute statement; exception when others then
 if position(expected in sqlerrm)=0 then raise exception 'Unexpected error: %',sqlerrm; end if;raised:=true;end;
 if not raised then raise exception 'Expected rejection containing %',expected;end if;
end;$$;
create function pg_temp.assert_true(condition boolean,label text) returns void language plpgsql as $$
begin if condition is distinct from true then raise exception 'FAIL: %',label;end if;end;$$;

-- Synthetic fixtures only, no identity sequence consumption.
set local session_replication_role=replica;
insert into public.mission_profiles(id,user_id,name,reward,active,network)
select -992001,user_a,'TEST V2 normal',0,true,'X' from mission_v2_context union all
select -992002,user_a,'TEST V2 bonus',100,true,'X' from mission_v2_context union all
select -992003,user_b,'TEST V2 bonus B',100,true,'X' from mission_v2_context;
insert into public.posts(id,user_id,title,published_at,x_published_at,mission_profile_id,special_reward,counting_excluded)
select -993010,user_a,'TEST old','2098-09-12'::date,null::timestamptz,-992002,100,false from mission_v2_context union all
select -993009,user_a,'TEST shared first','2098-09-15'::date,null::timestamptz,-992002,100,false from mission_v2_context union all
select -993008,user_a,'TEST shared second','2098-09-16'::date,'2098-09-16 02:59:59+00'::timestamptz,-992002,100,false from mission_v2_context union all
select -993007,user_a,'TEST shared overflow','2098-09-15'::date,null::timestamptz,-992002,100,false from mission_v2_context union all
select -993006,user_a,'TEST normal','2098-09-15'::date,null::timestamptz,-992001,0,false from mission_v2_context union all
select -993005,user_a,'TEST outside','2098-09-25'::date,null::timestamptz,-992001,0,false from mission_v2_context union all
select -993004,user_a,'TEST closed bonus','2098-10-12'::date,null::timestamptz,-992002,100,true from mission_v2_context union all
select -993003,user_a,'TEST no dates','2098-11-12'::date,null::timestamptz,-992002,100,false from mission_v2_context union all
select -993002,user_b,'TEST B shared','2098-09-15'::date,null::timestamptz,-992003,100,false from mission_v2_context;
set local session_replication_role=origin;
create temporary table mission_v2_posts_before as select id,to_jsonb(p) as body from public.posts p where id between -993010 and -993002;

select set_config('request.jwt.claim.sub',admin_id::text,true) from mission_v2_context;
set local role authenticated;
update mission_v2_context set old_period=public.create_mission_selection_period('2098-09-10','2098-09-15',2);
update mission_v2_context set new_period=public.create_mission_selection_period('2098-09-15','2098-09-20',1);
select pg_temp.expect_error($q$select public.create_mission_selection_period('2098-10-10','2098-10-15',null)$q$,'MISSION_PERIOD_INVALID');
select pg_temp.expect_error($q$select public.create_mission_selection_period('2098-10-10','2098-10-15',0)$q$,'MISSION_PERIOD_INVALID');
reset role;
with inserted as(insert into public.mission_selection_periods(start_date,end_date,created_by)
 select '2098-10-10','2098-10-15',admin_id from mission_v2_context returning id)
 update mission_v2_context set unconfigured=(select id from inserted);

select set_config('request.jwt.claim.sub',user_a::text,true) from mission_v2_context;
set local role authenticated;
select public.sync_my_mission_period_selections();
select pg_temp.assert_true((select period_id=(select old_period from mission_v2_context) from public.mission_period_selections where post_id=-993010),'exclusive old publication');
select pg_temp.assert_true((select period_id=(select old_period from mission_v2_context) from public.mission_period_selections where post_id=-993009),'old window filled first');
select pg_temp.assert_true((select period_id=(select new_period from mission_v2_context) from public.mission_period_selections where post_id=-993008),'shared day overflow to newer, Sao Paulo date');
select pg_temp.assert_true(not exists(select 1 from public.mission_period_selections where post_id in(-993007,-993004,-993003)),'full/unconfigured/outside remain pending');
select pg_temp.assert_true(public.sync_my_mission_period_selections()=0,'repeated synchronization is idempotent');
reset role;
select pg_temp.assert_true(not exists(select 1 from public.posts p join mission_v2_posts_before b using(id) where to_jsonb(p)<>b.body),'automatic linkage never changes posts/bonuses');

select set_config('request.jwt.claim.sub',user_b::text,true) from mission_v2_context;
set local role authenticated;
select public.sync_my_mission_period_selections();
select pg_temp.assert_true((select period_id=(select old_period from mission_v2_context) from public.mission_period_selections where post_id=-993002),'capacity is per user');
select pg_temp.assert_true(not exists(select 1 from public.mission_period_selections where post_id=-993009),'RLS isolation');

select set_config('request.jwt.claim.sub',user_a::text,true) from mission_v2_context;
select pg_temp.expect_error($q$select public.update_mission_selection_period(old_period,1,'2098-09-10','2098-09-15',5) from mission_v2_context$q$,'MISSION_PERIOD_ADMIN_REQUIRED');
select pg_temp.expect_error($q$select public.delete_mission_selection_period(old_period,1) from mission_v2_context$q$,'MISSION_PERIOD_ADMIN_REQUIRED');
select pg_temp.expect_error($q$select private.link_existing_mission_bonus_posts(user_b) from mission_v2_context$q$,'permission denied');
select pg_temp.expect_error($q$select * from private.mission_selection_period_audit$q$,'permission denied');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(old_period,-993002,-992002) from mission_v2_context$q$,'MISSION_PERIOD_POST_NOT_FOUND');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(old_period,-993006,-992003) from mission_v2_context$q$,'MISSION_PERIOD_PROFILE');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(old_period,-993005,-992002) from mission_v2_context$q$,'MISSION_PERIOD_INELIGIBLE');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(new_period,-993009,-992002) from mission_v2_context$q$,'MISSION_PERIOD_ALREADY_ASSIGNED');
select public.set_my_mission_period_selection(old_period,-993007,-992002) from mission_v2_context;
select public.set_my_mission_period_selection(old_period,-993006,-992002) from mission_v2_context;
select pg_temp.assert_true((select count(*)=4 from public.mission_period_selections where period_id=(select old_period from mission_v2_context)),'manual selection exceeds automatic target');
select public.set_my_mission_period_selection(old_period,-993007,null) from mission_v2_context;
select pg_temp.assert_true((select mission_profile_id=(select id from public.mission_profiles where user_id=(select user_a from mission_v2_context) and active and coalesce(reward,0)=0 order by name,id limit 1) and special_reward=0 from public.posts where id=-993007),'legacy correction restores first normal profile');
select public.set_my_mission_period_selection(new_period,-993007,-992002) from mission_v2_context;
select pg_temp.expect_error($q$update public.posts set mission_profile_id=null where id=-993009$q$,'Períodos de Missão');
select pg_temp.expect_error($q$update public.posts set published_at='2098-09-25' where id=-993009$q$,'Períodos de Missão');

select set_config('request.jwt.claim.sub',admin_id::text,true) from mission_v2_context;
select pg_temp.expect_error($q$select public.update_mission_selection_period(old_period,1,'2098-09-10','2098-09-14',2) from mission_v2_context$q$,'MISSION_PERIOD_LINKED_OUTSIDE_DATES');
select public.update_mission_selection_period(old_period,1,'2098-09-10','2098-09-15',1) from mission_v2_context;
select pg_temp.expect_error($q$select public.update_mission_selection_period(old_period,1,'2098-09-10','2098-09-15',2) from mission_v2_context$q$,'MISSION_PERIOD_STALE');
select pg_temp.expect_error($q$select public.delete_mission_selection_period(old_period,1) from mission_v2_context$q$,'MISSION_PERIOD_STALE');
select public.update_mission_selection_period(unconfigured,1,'2098-10-10','2098-10-15',2) from mission_v2_context;
select set_config('request.jwt.claim.sub',user_a::text,true) from mission_v2_context;
select public.sync_my_mission_period_selections();
select pg_temp.assert_true(exists(select 1 from public.mission_period_selections where post_id=-993004),'closed bonus visible after linkage');
select pg_temp.expect_error($q$select public.set_my_mission_period_selection(unconfigured,-993004,null) from mission_v2_context$q$,'MISSION_PERIOD_INELIGIBLE');
reset role;
create temporary table mission_v2_before_delete as select id,to_jsonb(p) body from public.posts p;
select set_config('request.jwt.claim.sub',admin_id::text,true) from mission_v2_context;
set local role authenticated;
select public.delete_mission_selection_period(new_period,1) from mission_v2_context;
reset role;
select pg_temp.assert_true(not exists(select 1 from public.posts p full join mission_v2_before_delete b using(id) where p.id is null or b.id is null or to_jsonb(p)<>b.body),'delete preserves all posts and rewards');
select pg_temp.assert_true(exists(select 1 from private.mission_selection_period_audit where action='delete' and period_before->>'id'=(select new_period::text from mission_v2_context) and jsonb_array_length(selections_before)=2),'recoverable deletion snapshot');
select pg_temp.assert_true(not exists(select 1 from public.mission_period_selections where period_id=(select new_period from mission_v2_context)),'delete releases links');
select set_config('request.jwt.claim.sub','',true);
set local role anon;
select pg_temp.expect_error('select public.sync_my_mission_period_selections()','permission denied');
select pg_temp.expect_error($q$select public.delete_mission_selection_period(null,1)$q$,'permission denied');
reset role;
select 'PASS: automatic oldest-first linkage, per-user isolation, pending/closed posts, manual freedom, correction, admin edit/delete, revision checks and recovery snapshots' result;
