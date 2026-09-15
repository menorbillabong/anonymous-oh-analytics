alter table public.user_moderation
  add column if not exists x_import_enabled boolean not null default false;

comment on column public.user_moderation.x_import_enabled is
  'Allows this user to request a best-effort import of recent public X posts.';

create table if not exists private.x_import_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_requested_at timestamptz not null default clock_timestamp()
);

revoke all on table private.x_import_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table private.x_import_rate_limits to service_role;

create or replace function public.get_my_x_import_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'enabled', coalesce((select moderation.x_import_enabled from public.user_moderation moderation where moderation.user_id = actor), false),
    'handle', coalesce((select settings.x_handle from public.user_settings settings where settings.user_id = actor), '')
  );
end;
$$;

create or replace function public.claim_my_x_import_request()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  handle text;
  claimed_at timestamptz;
begin
  if actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not coalesce((select moderation.x_import_enabled from public.user_moderation moderation where moderation.user_id = actor), false) then
    raise exception 'X_IMPORT_NOT_ENABLED' using errcode = '42501';
  end if;

  select regexp_replace(trim(settings.x_handle), '^@', '')
  into handle
  from public.user_settings settings
  where settings.user_id = actor;

  if handle is null or handle = '' or handle !~ '^[A-Za-z0-9_]{1,15}$' then
    raise exception 'X_IMPORT_HANDLE_REQUIRED' using errcode = '22023';
  end if;

  insert into private.x_import_rate_limits(user_id, last_requested_at)
  values (actor, clock_timestamp())
  on conflict (user_id) do update
    set last_requested_at = excluded.last_requested_at
    where private.x_import_rate_limits.last_requested_at <= clock_timestamp() - interval '30 seconds'
  returning last_requested_at into claimed_at;

  if claimed_at is null then
    raise exception 'X_IMPORT_RATE_LIMIT' using errcode = 'P0001';
  end if;

  return jsonb_build_object('handle', handle, 'limit', 12);
end;
$$;

create or replace function public.admin_x_import_users()
returns table(user_id uuid, enabled boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin(auth.uid()) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  return query
  select users.id, coalesce(moderation.x_import_enabled, false)
  from auth.users users
  left join public.user_moderation moderation on moderation.user_id = users.id;
end;
$$;

create or replace function public.admin_set_x_import_access(
  p_target_user uuid,
  p_enabled boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
begin
  if not private.is_admin(actor) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;
  if p_target_user is null or not exists (select 1 from auth.users users where users.id = p_target_user) then
    raise exception 'User not found' using errcode = 'P0002';
  end if;
  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(trim(p_reason)) > 500 then
    raise exception 'Administrative reason must contain between 3 and 500 characters';
  end if;

  insert into public.user_moderation(user_id, x_import_enabled, updated_at, updated_by)
  values (p_target_user, p_enabled, clock_timestamp(), actor)
  on conflict (user_id) do update
    set x_import_enabled = excluded.x_import_enabled,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by;

  insert into public.admin_audit_logs(admin_user_id, target_user_id, action, reason, metadata)
  values (
    actor,
    p_target_user,
    case when p_enabled then 'enable_x_import' else 'disable_x_import' end,
    trim(p_reason),
    jsonb_build_object('enabled', p_enabled)
  );
end;
$$;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check check (action = any (array[
    'suspend','reactivate','block_ranking','unblock_ranking',
    'unlock_ranking_control','lock_ranking_control',
    'enable_global_ranking_control','disable_global_ranking_control',
    'disqualify_post','requalify_post','configure_account_cleanup',
    'schedule_account_deletion','cancel_account_deletion','delete_inactive_account',
    'configure_google_sheets','configure_closed_period_post_cleanup',
    'schedule_closed_period_post_cleanup','cancel_closed_period_post_cleanup',
    'delete_closed_period_posts','delete_user_posts_by_date',
    'update_account_access','reopen_closed_period','reset_period_close_cooldown',
    'enable_x_import','disable_x_import'
  ]));

revoke all on function public.get_my_x_import_access() from public, anon, authenticated;
revoke all on function public.claim_my_x_import_request() from public, anon, authenticated;
revoke all on function public.admin_x_import_users() from public, anon, authenticated;
revoke all on function public.admin_set_x_import_access(uuid, boolean, text) from public, anon, authenticated;

grant execute on function public.get_my_x_import_access() to authenticated;
grant execute on function public.claim_my_x_import_request() to authenticated;
grant execute on function public.admin_x_import_users() to authenticated;
grant execute on function public.admin_set_x_import_access(uuid, boolean, text) to authenticated;

