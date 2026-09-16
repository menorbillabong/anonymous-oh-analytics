-- Additive feature: no existing posts, profiles, or closed accounting periods
-- are migrated or reclassified. Mission selection windows are separate.
create table public.mission_selection_periods (
  id uuid primary key default gen_random_uuid(),
  start_date date not null,
  end_date date not null,
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (start_date, end_date)
);
alter table public.mission_selection_periods enable row level security;
revoke all on public.mission_selection_periods from public, anon, authenticated;
grant select on public.mission_selection_periods to authenticated;
create policy mission_selection_periods_read on public.mission_selection_periods
  for select to authenticated using ((select auth.uid()) is not null);

create table public.mission_period_selections (
  post_id bigint primary key references public.posts(id) on delete cascade,
  period_id uuid not null references public.mission_selection_periods(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_profile_id bigint not null references public.mission_profiles(id),
  previous_profile_id bigint references public.mission_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index mission_period_selections_user_period_idx on public.mission_period_selections(user_id, period_id);
create index mission_period_selections_period_idx on public.mission_period_selections(period_id);
create index mission_period_selections_profile_idx on public.mission_period_selections(mission_profile_id);
create index mission_period_selections_previous_profile_idx on public.mission_period_selections(previous_profile_id) where previous_profile_id is not null;
alter table public.mission_period_selections enable row level security;
revoke all on public.mission_period_selections from public, anon, authenticated;
grant select on public.mission_period_selections to authenticated;
create policy mission_period_selections_own_read on public.mission_period_selections
  for select to authenticated using (user_id = (select auth.uid()));

-- Privileged operations stay in the unexposed private schema; public wrappers
-- run as invoker. Neither new table exposes client writes.
create function private.create_mission_selection_period(p_start date, p_end date, p_limit integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); result uuid;
begin
  if actor is null or not private.account_active(actor) or not private.is_admin(actor) then
    raise exception 'MISSION_PERIOD_ADMIN_REQUIRED';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_limit <= 0
     or not isfinite(p_start) or not isfinite(p_end) then
    raise exception 'MISSION_PERIOD_INVALID';
  end if;
  insert into public.mission_selection_periods(start_date,end_date,per_user_limit,created_by)
    values(p_start,p_end,p_limit,actor) returning id into result;
  return result;
end;
$$;
revoke all on function private.create_mission_selection_period(date,date,integer) from public, anon, authenticated;
grant execute on function private.create_mission_selection_period(date,date,integer) to authenticated;
create function public.create_mission_selection_period(p_start date, p_end date, p_limit integer default null)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_mission_selection_period(p_start,p_end,p_limit);
$$;
revoke all on function public.create_mission_selection_period(date,date,integer) from public, anon;
grant execute on function public.create_mission_selection_period(date,date,integer) to authenticated;

create function private.set_my_mission_period_selection(p_period uuid,p_post bigint,p_profile bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  target public.posts%rowtype;
  window_row public.mission_selection_periods%rowtype;
  selection public.mission_period_selections%rowtype;
  profile public.mission_profiles%rowtype;
  prior public.mission_profiles%rowtype;
  publication_date date;
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'MISSION_PERIOD_AUTH_REQUIRED';
  end if;
  -- Serialize all selections for this user, including separate browser tabs.
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:' || actor::text,0));
  select * into target from public.posts where id=p_post and user_id=actor for update;
  if not found then raise exception 'MISSION_PERIOD_POST_NOT_FOUND'; end if;
  select * into window_row from public.mission_selection_periods where id=p_period;
  if not found then raise exception 'MISSION_PERIOD_NOT_FOUND'; end if;
  select * into selection from public.mission_period_selections where post_id=p_post;
  if selection.post_id is not null and selection.period_id<>p_period then
    raise exception 'MISSION_PERIOD_ALREADY_ASSIGNED';
  end if;
  if coalesce(target.counting_excluded,false) then raise exception 'MISSION_PERIOD_INELIGIBLE'; end if;

  if p_profile is null then
    if selection.post_id is null then raise exception 'MISSION_PERIOD_STALE'; end if;
    -- Restore the prior normal profile, but never introduce a new bonus while
    -- releasing a selection (the prior profile may have changed meanwhile).
    select * into prior from public.mission_profiles
      where id=selection.previous_profile_id and user_id=actor and coalesce(reward,0)<=0;
    delete from public.mission_period_selections where post_id=p_post and user_id=actor;
    update public.posts set mission_profile_id=prior.id,mission_name=prior.name
      where id=p_post and user_id=actor;
    return jsonb_build_object('selected',false);
  end if;

  if selection.post_id is not null then
    if selection.mission_profile_id=p_profile then return jsonb_build_object('selected',true); end if;
    raise exception 'MISSION_PERIOD_STALE';
  end if;
  publication_date:=coalesce((target.x_published_at at time zone 'America/Sao_Paulo')::date,target.published_at,(target.created_at at time zone 'America/Sao_Paulo')::date);
  if publication_date is null or publication_date<window_row.start_date or publication_date>window_row.end_date then
    raise exception 'MISSION_PERIOD_INELIGIBLE';
  end if;
  if coalesce(target.special_reward,0)>0 or exists(select 1 from public.mission_profiles where id=target.mission_profile_id and user_id=actor and reward>0) then
    raise exception 'MISSION_PERIOD_HAS_BONUS';
  end if;
  select * into profile from public.mission_profiles where id=p_profile and user_id=actor and active and reward>0 for share;
  if not found then raise exception 'MISSION_PERIOD_PROFILE'; end if;
  if window_row.per_user_limit is not null and
     (select count(*) from public.mission_period_selections where user_id=actor and period_id=p_period)>=window_row.per_user_limit then
    raise exception 'MISSION_PERIOD_LIMIT';
  end if;
  insert into public.mission_period_selections(post_id,period_id,user_id,mission_profile_id,previous_profile_id)
    values(p_post,p_period,actor,p_profile,target.mission_profile_id);
  update public.posts set mission_profile_id=profile.id,mission_name=profile.name where id=p_post and user_id=actor;
  return jsonb_build_object('selected',true);
end;
$$;
revoke all on function private.set_my_mission_period_selection(uuid,bigint,bigint) from public, anon, authenticated;
grant execute on function private.set_my_mission_period_selection(uuid,bigint,bigint) to authenticated;
create function public.set_my_mission_period_selection(p_period uuid,p_post bigint,p_profile bigint default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_my_mission_period_selection(p_period,p_post,p_profile);
$$;
revoke all on function public.set_my_mission_period_selection(uuid,bigint,bigint) from public, anon;
grant execute on function public.set_my_mission_period_selection(uuid,bigint,bigint) to authenticated;

-- Existing editing screens may still edit metrics, but must not silently
-- detach a selected publication or move it outside its mission window.
create function private.guard_mission_period_selection()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare selection record; publication_date date;
begin
  select s.user_id,s.mission_profile_id,p.start_date,p.end_date into selection
    from public.mission_period_selections s join public.mission_selection_periods p on p.id=s.period_id
    where s.post_id=old.id;
  if not found then return new; end if;
  publication_date:=coalesce((new.x_published_at at time zone 'America/Sao_Paulo')::date,new.published_at,(new.created_at at time zone 'America/Sao_Paulo')::date);
  if new.user_id is distinct from selection.user_id or new.mission_profile_id is distinct from selection.mission_profile_id
     or publication_date is null or publication_date<selection.start_date or publication_date>selection.end_date then
    raise exception 'Corrija esta classificação em Períodos de Missão antes de alterar o perfil ou a data.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_mission_period_selection() from public,anon,authenticated;
create trigger zzzzz_guard_mission_period_selection before update of user_id,mission_profile_id,published_at,x_published_at on public.posts
  for each row execute function private.guard_mission_period_selection();
