-- Additive manual adjustments. Original post metrics and historical records remain untouched.
create table public.manual_adjustment_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  reason text not null check (char_length(trim(reason)) between 3 and 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.manual_adjustment_access enable row level security;
revoke all on public.manual_adjustment_access from public, anon, authenticated;
grant select, insert, update on public.manual_adjustment_access to authenticated;
grant all on public.manual_adjustment_access to service_role;

create policy manual_adjustment_read on public.manual_adjustment_access for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin(auth.uid())));
create policy manual_adjustment_admin_insert on public.manual_adjustment_access for insert to authenticated
with check ((select private.is_admin(auth.uid())));
create policy manual_adjustment_admin_update on public.manual_adjustment_access for update to authenticated
using ((select private.is_admin(auth.uid())))
with check ((select private.is_admin(auth.uid())));

create table private.manual_adjustment_access_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  admin_user_id uuid not null,
  enabled boolean not null,
  previous_enabled boolean not null,
  reason text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.manual_adjustment_access_audit enable row level security;
revoke all on private.manual_adjustment_access_audit from public, anon, authenticated;
grant select on private.manual_adjustment_access_audit to service_role;
create index manual_adjustment_audit_user_time on private.manual_adjustment_access_audit (user_id, created_at desc);

create function private.audit_manual_adjustment_access()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or not private.is_admin(actor) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then
    raise exception 'Permission owner cannot change' using errcode = '42501';
  end if;
  if tg_when = 'BEFORE' then
    new.updated_by := actor;
    new.updated_at := clock_timestamp();
    new.reason := trim(new.reason);
  else
    insert into private.manual_adjustment_access_audit(user_id, admin_user_id, enabled, previous_enabled, reason)
    values(new.user_id, actor, new.enabled, case when tg_op = 'UPDATE' then old.enabled else false end, new.reason);
  end if;
  return new;
end;
$$;
revoke all on function private.audit_manual_adjustment_access() from public, anon, authenticated;
create trigger audit_manual_adjustment_access before insert or update on public.manual_adjustment_access
for each row execute function private.audit_manual_adjustment_access();
create trigger record_manual_adjustment_access after insert or update on public.manual_adjustment_access
for each row execute function private.audit_manual_adjustment_access();

create function public.get_my_manual_adjustment_access()
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  return jsonb_build_object('enabled', coalesce((select access.enabled from public.manual_adjustment_access access where access.user_id = auth.uid()), false));
end;
$$;

create function public.admin_manual_adjustment_users()
returns table(user_id uuid, enabled boolean)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;
  return query select access.user_id, access.enabled from public.manual_adjustment_access access;
end;
$$;

create function public.admin_set_manual_adjustment_access(p_target_user uuid, p_enabled boolean, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_admin(auth.uid()) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;
  if p_target_user is null or p_enabled is null or p_reason is null or char_length(trim(p_reason)) not between 3 and 500 then
    raise exception 'Invalid permission or administrative reason' using errcode = '22023';
  end if;
  insert into public.manual_adjustment_access(user_id, enabled, reason)
  values(p_target_user, p_enabled, trim(p_reason))
  on conflict(user_id) do update set enabled = excluded.enabled, reason = excluded.reason;
end;
$$;
revoke all on function public.get_my_manual_adjustment_access() from public, anon, authenticated;
revoke all on function public.admin_manual_adjustment_users() from public, anon, authenticated;
revoke all on function public.admin_set_manual_adjustment_access(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.get_my_manual_adjustment_access() to authenticated;
grant execute on function public.admin_manual_adjustment_users() to authenticated;
grant execute on function public.admin_set_manual_adjustment_access(uuid, boolean, text) to authenticated;

comment on table public.manual_adjustment_access is 'Explicit per-user permission for transparent manual adjustments. Missing row means disabled. No metric or payout is changed by granting access.';

create table public.manual_like_adjustments (
  period_id bigint primary key references public.tracking_periods(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  amount integer not null default 0 check(amount between 0 and 1000000),
  seed uuid not null default gen_random_uuid(),
  updated_at timestamptz not null default clock_timestamp()
);
create index manual_like_adjustments_user on public.manual_like_adjustments(user_id);
alter table public.manual_like_adjustments enable row level security;
revoke all on public.manual_like_adjustments from public, anon, authenticated;
grant select,insert,update on public.manual_like_adjustments to authenticated;
grant all on public.manual_like_adjustments to service_role;
create policy manual_likes_read on public.manual_like_adjustments for select to authenticated
using(user_id=(select auth.uid()));
create policy manual_likes_insert on public.manual_like_adjustments for insert to authenticated
with check(user_id=(select auth.uid()) and exists(select 1 from public.manual_adjustment_access a where a.user_id=(select auth.uid()) and a.enabled)
and exists(select 1 from public.tracking_periods p where p.id=period_id and p.user_id=(select auth.uid()) and p.end_date is null));
create policy manual_likes_update on public.manual_like_adjustments for update to authenticated
using(user_id=(select auth.uid()) and exists(select 1 from public.manual_adjustment_access a where a.user_id=(select auth.uid()) and a.enabled)
and exists(select 1 from public.tracking_periods p where p.id=period_id and p.user_id=(select auth.uid()) and p.end_date is null))
with check(user_id=(select auth.uid()) and exists(select 1 from public.manual_adjustment_access a where a.user_id=(select auth.uid()) and a.enabled)
and exists(select 1 from public.tracking_periods p where p.id=period_id and p.user_id=(select auth.uid()) and p.end_date is null));

create function public.get_my_manual_like_adjustment()
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); period public.tracking_periods%rowtype; config public.manual_like_adjustments%rowtype; allowed boolean;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select p.* into period from public.tracking_periods p where p.user_id=actor and p.end_date is null;
  select c.* into config from public.manual_like_adjustments c where c.period_id=period.id and c.user_id=actor;
  select coalesce(a.enabled,false) into allowed from public.manual_adjustment_access a where a.user_id=actor;
  return jsonb_build_object('allowed',coalesce(allowed,false),'enabled',coalesce(config.enabled,false),
    'amount',coalesce(config.amount,0),'seed',coalesce(config.seed::text,''),'period_id',period.id,
    'start_date',period.start_date,'revision',coalesce(config.updated_at::text,''));
end;
$$;
create function public.save_my_manual_like_adjustment(p_period_id bigint,p_amount integer,p_enabled boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); current_period bigint;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(82432,pg_catalog.hashtext(actor::text));
  if not coalesce((select a.enabled from public.manual_adjustment_access a where a.user_id=actor),false) then
    raise exception 'MANUAL_ADJUSTMENT_NOT_ALLOWED' using errcode='42501'; end if;
  if p_amount is null or p_amount<0 or p_amount>1000000 or p_enabled is null then
    raise exception 'MANUAL_ADJUSTMENT_INVALID' using errcode='22023'; end if;
  select p.id into current_period from public.tracking_periods p where p.user_id=actor and p.end_date is null;
  if current_period is null or p_period_id is distinct from current_period then
    raise exception 'MANUAL_ADJUSTMENT_PERIOD_CHANGED' using errcode='22023'; end if;
  insert into public.manual_like_adjustments(period_id,user_id,amount,enabled)
    values(current_period,actor,p_amount,p_enabled)
  on conflict(period_id) do update set amount=excluded.amount,enabled=excluded.enabled,updated_at=clock_timestamp();
  return public.get_my_manual_like_adjustment();
end;
$$;
revoke all on function public.get_my_manual_like_adjustment() from public,anon,authenticated;
revoke all on function public.save_my_manual_like_adjustment(bigint,integer,boolean) from public,anon,authenticated;
grant execute on function public.get_my_manual_like_adjustment() to authenticated;
grant execute on function public.save_my_manual_like_adjustment(bigint,integer,boolean) to authenticated;
comment on table public.manual_like_adjustments is 'User-declared manual additions, separately stored from real X likes, scoped to an open period. Never represent these as measured engagement.';
