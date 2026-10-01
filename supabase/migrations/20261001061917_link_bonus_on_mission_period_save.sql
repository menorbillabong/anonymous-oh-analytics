-- Only new/unlinked bonus classifications are reconciled. No post snapshots,
-- existing selections, manual limits or reward calculations are changed.
set lock_timeout = '5s';
set statement_timeout = '30s';

-- Internal invoker helper, called under the authenticated admin RPC's privileges.
-- Definitions lock -> user lock -> post rows is the existing lock order.
create function private.link_bonus_posts_for_mission_period(p_period uuid)
returns integer language plpgsql security invoker set search_path = '' as $$
declare owner_id uuid; linked integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:definitions',0));
  for owner_id in
    select distinct p.user_id
    from public.mission_selection_periods w
    join public.posts p on coalesce((p.x_published_at at time zone 'America/Sao_Paulo')::date,
      p.published_at,(p.created_at at time zone 'America/Sao_Paulo')::date) between w.start_date and w.end_date
    join public.mission_profiles mp on mp.id=p.mission_profile_id and mp.user_id=p.user_id
    where w.id=p_period and w.per_user_limit>0 and mp.reward>0
      and not exists(select 1 from public.mission_period_selections s where s.post_id=p.id)
    order by p.user_id
  loop
    linked:=linked+private.link_existing_mission_bonus_posts(owner_id);
  end loop;
  return linked;
end;
$$;
revoke all on function private.link_bonus_posts_for_mission_period(uuid) from public,anon,authenticated;

create or replace function private.create_mission_selection_period(p_start date,p_end date,p_limit integer)
returns uuid language plpgsql security definer set search_path = '' as $$
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
  perform private.link_bonus_posts_for_mission_period(result);
  return result;
end;
$$;

create or replace function private.update_mission_selection_period(p_period uuid,p_revision integer,p_start date,p_end date,p_limit integer)
returns void language plpgsql security definer set search_path = '' as $$
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
    where s.period_id=p_period and coalesce((p.x_published_at at time zone 'America/Sao_Paulo')::date,p.published_at,
      (p.created_at at time zone 'America/Sao_Paulo')::date) not between p_start and p_end)
    then raise exception 'MISSION_PERIOD_LINKED_OUTSIDE_DATES'; end if;
  insert into private.mission_selection_period_audit(actor_id,action,period_before,selections_before)
    select actor,'edit',to_jsonb(prior),coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)
    from public.mission_period_selections s where s.period_id=p_period;
  update public.mission_selection_periods set start_date=p_start,end_date=p_end,per_user_limit=p_limit,revision=revision+1 where id=p_period;
  perform private.link_bonus_posts_for_mission_period(p_period);
end;
$$;
-- CREATE OR REPLACE retains existing RPC grants; the new helper is not exposed.
notify pgrst,'reload schema';
