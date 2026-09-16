-- per_user_limit is now ONLY the automatic-fill target, never a manual cap.
-- Existing null targets remain pending until the administrator defines them.
alter table public.mission_selection_periods add column revision integer not null default 1;
alter table public.mission_period_selections add column selection_source text not null default 'manual'
  check(selection_source in ('manual','automatic'));
comment on column public.mission_selection_periods.per_user_limit is
  'Automatic linkage target per user. Manual selections are unlimited. Null suspends automatic linkage.';

-- Recoverable admin operations: snapshot definitions and links, not publications.
create table private.mission_selection_period_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  action text not null check(action in ('edit','delete')),
  period_before jsonb not null,
  selections_before jsonb not null,
  recorded_at timestamptz not null default now()
);
alter table private.mission_selection_period_audit enable row level security;
revoke all on private.mission_selection_period_audit from public,anon,authenticated;

create or replace function private.create_mission_selection_period(p_start date,p_end date,p_limit integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result uuid;
begin
  if actor is null or not private.account_active(actor) or not private.is_admin(actor) then
    raise exception 'MISSION_PERIOD_ADMIN_REQUIRED';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_limit is null or p_limit<=0
     or not isfinite(p_start) or not isfinite(p_end) then raise exception 'MISSION_PERIOD_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:definitions',0));
  insert into public.mission_selection_periods(start_date,end_date,per_user_limit,created_by)
    values(p_start,p_end,p_limit,actor) returning id into result;
  return result;
end;
$$;

create function private.update_mission_selection_period(p_period uuid,p_revision integer,p_start date,p_end date,p_limit integer)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior public.mission_selection_periods%rowtype;
begin
  if actor is null or not private.account_active(actor) or not private.is_admin(actor) then
    raise exception 'MISSION_PERIOD_ADMIN_REQUIRED';
  end if;
  if p_start is null or p_end is null or p_end<p_start or p_limit is null or p_limit<=0
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
$$;
revoke all on function private.update_mission_selection_period(uuid,integer,date,date,integer) from public,anon,authenticated;
grant execute on function private.update_mission_selection_period(uuid,integer,date,date,integer) to authenticated;
create function public.update_mission_selection_period(p_period uuid,p_revision integer,p_start date,p_end date,p_limit integer)
returns void language sql security invoker set search_path='' as $$
  select private.update_mission_selection_period(p_period,p_revision,p_start,p_end,p_limit);
$$;
revoke all on function public.update_mission_selection_period(uuid,integer,date,date,integer) from public,anon;
grant execute on function public.update_mission_selection_period(uuid,integer,date,date,integer) to authenticated;

create function private.delete_mission_selection_period(p_period uuid,p_revision integer)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); prior public.mission_selection_periods%rowtype;
begin
  if actor is null or not private.account_active(actor) or not private.is_admin(actor) then
    raise exception 'MISSION_PERIOD_ADMIN_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:definitions',0));
  select * into prior from public.mission_selection_periods where id=p_period for update;
  if not found then raise exception 'MISSION_PERIOD_NOT_FOUND'; end if;
  if p_revision is distinct from prior.revision then raise exception 'MISSION_PERIOD_STALE'; end if;
  insert into private.mission_selection_period_audit(actor_id,action,period_before,selections_before)
    select actor,'delete',to_jsonb(prior),coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
    from public.mission_period_selections s where s.period_id=p_period;
  delete from public.mission_period_selections where period_id=p_period;
  delete from public.mission_selection_periods where id=p_period;
  -- Deliberately do NOT update/delete posts, bonuses or closed accounting periods.
end;
$$;
revoke all on function private.delete_mission_selection_period(uuid,integer) from public,anon,authenticated;
grant execute on function private.delete_mission_selection_period(uuid,integer) to authenticated;
create function public.delete_mission_selection_period(p_period uuid,p_revision integer)
returns void language sql security invoker set search_path='' as $$
  select private.delete_mission_selection_period(p_period,p_revision);
$$;
revoke all on function public.delete_mission_selection_period(uuid,integer) from public,anon;
grant execute on function public.delete_mission_selection_period(uuid,integer) to authenticated;

-- Internal helper: not exposed or executable by clients. Called under the
-- authenticated wrapper below (or by the migration). Only creates links;
-- existing posts, bonuses, dates, and existing selections stay unchanged.
create function private.link_existing_mission_bonus_posts(p_user uuid)
returns integer language plpgsql security invoker set search_path='' as $$
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
      where target.day between w.start_date and w.end_date and w.per_user_limit is not null
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
$$;
revoke all on function private.link_existing_mission_bonus_posts(uuid) from public,anon,authenticated;

create function private.sync_my_mission_period_selections()
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null or not private.account_active(actor) then raise exception 'MISSION_PERIOD_AUTH_REQUIRED'; end if;
  return private.link_existing_mission_bonus_posts(actor);
end;
$$;
revoke all on function private.sync_my_mission_period_selections() from public,anon,authenticated;
grant execute on function private.sync_my_mission_period_selections() to authenticated;
create function public.sync_my_mission_period_selections()
returns integer language sql security invoker set search_path='' as $$
  select private.sync_my_mission_period_selections();
$$;
revoke all on function public.sync_my_mission_period_selections() from public,anon;
grant execute on function public.sync_my_mission_period_selections() to authenticated;

create or replace function private.set_my_mission_period_selection(p_period uuid,p_post bigint,p_profile bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); target public.posts%rowtype; window_row public.mission_selection_periods%rowtype;
  selection public.mission_period_selections%rowtype; profile public.mission_profiles%rowtype;
  prior public.mission_profiles%rowtype; publication_date date; previous_id bigint;
begin
  if actor is null or not private.account_active(actor) then raise exception 'MISSION_PERIOD_AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('mission-selection:definitions',0));
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:'||actor::text,0));
  select * into target from public.posts where id=p_post and user_id=actor for update;
  if not found then raise exception 'MISSION_PERIOD_POST_NOT_FOUND'; end if;
  select * into window_row from public.mission_selection_periods where id=p_period;
  if not found then raise exception 'MISSION_PERIOD_NOT_FOUND'; end if;
  select * into selection from public.mission_period_selections where post_id=p_post;
  if selection.post_id is not null and selection.period_id<>p_period then raise exception 'MISSION_PERIOD_ALREADY_ASSIGNED'; end if;
  if coalesce(target.counting_excluded,false) or exists(select 1 from public.mission_periods
    where user_id=actor and month=date_trunc('month',target.published_at)::date and status='closed')
    then raise exception 'MISSION_PERIOD_INELIGIBLE'; end if;
  if p_profile is null then
    if selection.post_id is null then raise exception 'MISSION_PERIOD_STALE'; end if;
    select * into prior from public.mission_profiles where id=selection.previous_profile_id and user_id=actor and coalesce(reward,0)=0;
    delete from public.mission_period_selections where post_id=p_post and user_id=actor;
    update public.posts set mission_profile_id=prior.id,mission_name=prior.name where id=p_post and user_id=actor;
    return jsonb_build_object('selected',false);
  end if;
  if selection.post_id is not null then
    if selection.mission_profile_id=p_profile then return jsonb_build_object('selected',true); end if;
    raise exception 'MISSION_PERIOD_STALE';
  end if;
  publication_date:=coalesce((target.x_published_at at time zone 'America/Sao_Paulo')::date,target.published_at,(target.created_at at time zone 'America/Sao_Paulo')::date);
  if publication_date is null or publication_date not between window_row.start_date and window_row.end_date then
    raise exception 'MISSION_PERIOD_INELIGIBLE';
  end if;
  select * into profile from public.mission_profiles where id=p_profile and user_id=actor and (active or id=target.mission_profile_id) and reward>0 for share;
  if not found then raise exception 'MISSION_PERIOD_PROFILE'; end if;
  previous_id:=target.mission_profile_id;
  if exists(select 1 from public.mission_profiles where id=previous_id and reward>0) then
    select id into previous_id from public.mission_profiles where user_id=actor and active and coalesce(reward,0)=0 order by name,id limit 1;
  end if;
  -- NO capacity check for manual selection, including previously classified posts.
  insert into public.mission_period_selections(post_id,period_id,user_id,mission_profile_id,previous_profile_id)
    values(p_post,p_period,actor,p_profile,previous_id);
  update public.posts set mission_profile_id=profile.id,mission_name=profile.name where id=p_post and user_id=actor;
  return jsonb_build_object('selected',true);
end;
$$;

-- One initial pass for already configured windows. Idempotent: links are never
-- reassigned and unconfigured windows are deliberately left pending.
do $$ declare owner_id uuid; begin
  for owner_id in select distinct p.user_id from public.posts p join public.mission_profiles mp on mp.id=p.mission_profile_id and mp.reward>0
  loop perform private.link_existing_mission_bonus_posts(owner_id); end loop;
end $$;
