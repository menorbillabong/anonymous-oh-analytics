-- Zero disables automatic linkage only. Existing periods, posts and selections stay unchanged.
set lock_timeout = '5s';
set statement_timeout = '30s';
alter table public.mission_selection_periods drop constraint mission_selection_periods_per_user_limit_check;
alter table public.mission_selection_periods add constraint mission_selection_periods_per_user_limit_check check (per_user_limit is null or per_user_limit >= 0);
comment on column public.mission_selection_periods.per_user_limit is 'Automatic linkage target per user. Zero disables automatic linkage; null awaits configuration. Manual selections are unlimited.';

CREATE OR REPLACE FUNCTION private.create_mission_selection_period(p_start date, p_end date, p_limit integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result uuid;
begin
  if actor is null or not private.account_active(actor) or not private.is_admin(actor) then
    raise exception 'MISSION_PERIOD_ADMIN_REQUIRED';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_limit is null or p_limit<0
     or not isfinite(p_start) or not isfinite(p_end) then raise exception 'MISSION_PERIOD_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:definitions',0));
  insert into public.mission_selection_periods(start_date,end_date,per_user_limit,created_by)
    values(p_start,p_end,p_limit,actor) returning id into result;
  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.link_existing_mission_bonus_posts(p_user uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare target record; destination uuid; inserted integer:=0; normal_profile bigint;
begin
  perform pg_advisory_xact_lock_shared(hashtextextended('mission-selection:definitions',0));
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:'||p_user::text,0));
  select id into normal_profile from public.mission_profiles
    where user_id=p_user and active and coalesce(reward,0)=0 order by name,id limit 1;
  for target in
    select p.id,p.mission_profile_id,
      coalesce((p.x_published_at at time zone 'America/Sao_Paulo')::date,p.published_at,(p.created_at at time zone 'America/Sao_Paulo')::date) as day
    from public.posts p join public.mission_profiles mp on mp.id=p.mission_profile_id and mp.user_id=p.user_id
    where p.user_id=p_user and mp.reward>0
      and not exists(select 1 from public.mission_period_selections s where s.post_id=p.id)
    order by day,p.id for update of p
  loop
    -- Old null definitions must be configured, not silently treated as 2.
    if exists(select 1 from public.mission_selection_periods w
      where target.day between w.start_date and w.end_date and w.per_user_limit is null) then continue; end if;
    select w.id into destination from public.mission_selection_periods w
      where target.day between w.start_date and w.end_date and w.per_user_limit > 0
        and (select count(*) from public.mission_period_selections s where s.user_id=p_user and s.period_id=w.id)<w.per_user_limit
      order by w.start_date,w.end_date,w.created_at,w.id limit 1;
    if destination is not null then
      insert into public.mission_period_selections(post_id,period_id,user_id,mission_profile_id,previous_profile_id,selection_source)
        values(target.id,destination,p_user,target.mission_profile_id,normal_profile,'automatic');
      inserted:=inserted+1;
    end if;
  end loop;
  return inserted;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.update_mission_selection_period(p_period uuid, p_revision integer, p_start date, p_end date, p_limit integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); prior public.mission_selection_periods%rowtype;
begin
  if actor is null or not private.account_active(actor) or not private.is_admin(actor) then
    raise exception 'MISSION_PERIOD_ADMIN_REQUIRED';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_limit is null or p_limit<0
     or not isfinite(p_start) or not isfinite(p_end) then raise exception 'MISSION_PERIOD_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:definitions',0));
  select * into prior from public.mission_selection_periods where id=p_period for update;
  if not found then raise exception 'MISSION_PERIOD_NOT_FOUND'; end if;
  if p_revision is distinct from prior.revision then raise exception 'MISSION_PERIOD_STALE'; end if;
  if exists(select 1 from public.mission_period_selections s join public.posts p on p.id=s.post_id
    where s.period_id=p_period and coalesce((p.x_published_at at time zone 'America/Sao_Paulo')::date,p.published_at,(p.created_at at time zone 'America/Sao_Paulo')::date) not between p_start and p_end)
    then raise exception 'MISSION_PERIOD_LINKED_OUTSIDE_DATES'; end if;
  insert into private.mission_selection_period_audit(actor_id,action,period_before,selections_before)
    select actor,'edit',to_jsonb(prior),coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
    from public.mission_period_selections s where s.period_id=p_period;
  update public.mission_selection_periods set start_date=p_start,end_date=p_end,per_user_limit=p_limit,revision=revision+1 where id=p_period;
end;
$function$
;
