-- Isolated, rollback-only database regression test. No production rows are changed.
begin;
set local statement_timeout = '15s';
create temp table mission_selection_periods as select * from public.mission_selection_periods with no data;
create temp table mission_period_selections as select * from public.mission_period_selections with no data;
create temp table mission_profiles as select * from public.mission_profiles with no data;
create temp table posts as select * from public.posts with no data;
create temp table mission_periods as select * from public.mission_periods with no data;
create temp table mission_selection_period_audit as select * from private.mission_selection_period_audit with no data;
alter table pg_temp.mission_selection_periods alter id set default gen_random_uuid(), alter created_at set default now(), alter revision set default 1;
alter table pg_temp.mission_selection_periods add check (per_user_limit is null or per_user_limit >= 0);
alter table pg_temp.mission_period_selections alter selection_source set default 'manual';
alter table pg_temp.mission_period_selections add primary key (post_id);
do $test$
declare name text; definition text; relation text;
begin
  foreach name in array array['create_mission_selection_period','update_mission_selection_period','link_existing_mission_bonus_posts','set_my_mission_period_selection'] loop
    select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=name;
    definition:=replace(definition,'FUNCTION private.'||name,'FUNCTION pg_temp.'||name);
    foreach relation in array array['mission_selection_periods','mission_period_selections','mission_profiles','posts','mission_periods'] loop
      definition:=replace(definition,'public.'||relation,'pg_temp.'||relation);
    end loop;
    definition:=replace(definition,'private.mission_selection_period_audit','pg_temp.mission_selection_period_audit');
    execute definition;
  end loop;
end $test$;
do $test$
declare actor uuid; first_period uuid; next_period uuid; snapshot jsonb; result integer;
begin
  select user_id into strict actor from public.admin_users where private.account_active(user_id) limit 1;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  first_period:=pg_temp.create_mission_selection_period('2090-01-01','2090-01-15',0);
  next_period:=pg_temp.create_mission_selection_period('2090-01-15','2090-01-31',1);
  insert into pg_temp.mission_profiles(id,user_id,name,active,reward) values (1,actor,'Normal',true,0),(2,actor,'Bonus',true,200);
  insert into pg_temp.posts(id,user_id,published_at,mission_profile_id,counting_excluded) values
    (1,actor,'2090-01-10',2,false),(2,actor,'2090-01-15',2,false),(3,actor,'2090-01-10',1,false);
  result:=pg_temp.link_existing_mission_bonus_posts(actor);
  assert result=1, 'positive overlapping period should receive one automatic post';
  assert not exists(select 1 from pg_temp.mission_period_selections where period_id=first_period), 'zero must receive no automatic links';
  assert exists(select 1 from pg_temp.mission_period_selections where post_id=2 and period_id=next_period), 'zero must not block eligible positive overlap';
  perform pg_temp.set_my_mission_period_selection(first_period,1,2);
  perform pg_temp.set_my_mission_period_selection(first_period,3,2);
  assert (select count(*) from pg_temp.mission_period_selections where period_id=first_period)=2, 'manual selection remains unlimited with zero';
  perform pg_temp.update_mission_selection_period(next_period,1,'2090-01-15','2090-01-31',0);
  select jsonb_agg(to_jsonb(s) order by post_id) into snapshot from pg_temp.mission_period_selections s;
  assert pg_temp.link_existing_mission_bonus_posts(actor)=0, 'zero must stay disabled on repeated sync';
  assert snapshot=(select jsonb_agg(to_jsonb(s) order by post_id) from pg_temp.mission_period_selections s), 'existing links must remain unchanged';
  perform pg_temp.set_my_mission_period_selection(first_period,3,null);
  assert (select mission_profile_id from pg_temp.posts where id=3)=1, 'manual unselection restores original profile';
  perform pg_temp.update_mission_selection_period(first_period,1,'2090-01-01','2090-01-15',3);
  update pg_temp.posts set mission_profile_id=2 where id=3;
  assert pg_temp.link_existing_mission_bonus_posts(actor)=1, 'positive value re-enables automatic linkage';
  begin
    perform pg_temp.create_mission_selection_period('2090-02-01','2090-02-10',-1);
    raise exception 'negative was accepted';
  exception when raise_exception then if sqlerrm<>'MISSION_PERIOD_INVALID' then raise; end if; end;
  begin
    perform pg_temp.update_mission_selection_period(first_period,2,'2090-01-01','2090-01-15',-1);
    raise exception 'negative update was accepted';
  exception when raise_exception then if sqlerrm<>'MISSION_PERIOD_INVALID' then raise; end if; end;
  perform set_config('request.jwt.claim.sub','',true);
  begin
    perform pg_temp.create_mission_selection_period('2090-02-01','2090-02-10',0);
    raise exception 'anonymous was accepted';
  exception when raise_exception then if sqlerrm<>'MISSION_PERIOD_ADMIN_REQUIRED' then raise; end if; end;
end $test$;
rollback;
select 'PASS: zero, positive overlap, manual selection/removal, preservation, re-enable, negative and anonymous rejection' as result;
