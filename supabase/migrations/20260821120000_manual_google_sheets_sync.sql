-- Manual, per-user Google Sheets synchronization.
-- The integration is disabled for every account by default.

create table if not exists public.google_sheets_user_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  sheet_tab_name text not null default '',
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_sync_status text not null default 'never'
    check (last_sync_status in ('never', 'running', 'success', 'error')),
  last_sync_normal_count integer not null default 0 check (last_sync_normal_count >= 0),
  last_sync_special_count integer not null default 0 check (last_sync_special_count >= 0),
  last_sync_error text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.google_sheets_user_config enable row level security;

revoke all on table public.google_sheets_user_config from anon, authenticated;
grant select on table public.google_sheets_user_config to authenticated;
grant all on table public.google_sheets_user_config to service_role;

drop policy if exists "users can view own sheets configuration" on public.google_sheets_user_config;
create policy "users can view own sheets configuration"
on public.google_sheets_user_config
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and private.account_active((select auth.uid()))
);

alter table public.mission_profiles
  add column if not exists is_special boolean not null default false;

alter table public.posts
  add column if not exists sheets_is_special boolean not null default false;

-- Preserve the site's existing meaning: profiles/posts with a fixed reward were
-- already treated as special before the explicit marker existed.
update public.mission_profiles
set is_special = (reward > 0);

update public.posts
set sheets_is_special = (special_reward > 0);

create or replace function private.protect_mission_special_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if ((tg_op = 'INSERT' and new.is_special)
      or (tg_op = 'UPDATE' and new.is_special is distinct from old.is_special))
     and not coalesce((
       select c.enabled
       from public.google_sheets_user_config c
       where c.user_id = new.user_id
     ), false) then
    raise exception 'GOOGLE_SHEETS_NOT_ENABLED';
  end if;
  return new;
end;
$function$;

drop trigger if exists protect_mission_special_setting on public.mission_profiles;
create trigger protect_mission_special_setting
before insert or update of is_special on public.mission_profiles
for each row execute function private.protect_mission_special_setting();

create or replace function private.snapshot_post_sheet_mission_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' or new.mission_profile_id is distinct from old.mission_profile_id then
    new.sheets_is_special := coalesce((
      select m.is_special
      from public.mission_profiles m
      where m.id = new.mission_profile_id
        and m.user_id = new.user_id
    ), false);
  else
    new.sheets_is_special := old.sheets_is_special;
  end if;
  return new;
end;
$function$;

drop trigger if exists snapshot_post_sheet_mission_type on public.posts;
create trigger snapshot_post_sheet_mission_type
before insert or update of mission_profile_id, sheets_is_special on public.posts
for each row execute function private.snapshot_post_sheet_mission_type();

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check check (action = any (array[
    'suspend'::text,
    'reactivate'::text,
    'block_ranking'::text,
    'unblock_ranking'::text,
    'unlock_ranking_control'::text,
    'lock_ranking_control'::text,
    'enable_global_ranking_control'::text,
    'disable_global_ranking_control'::text,
    'disqualify_post'::text,
    'requalify_post'::text,
    'configure_account_cleanup'::text,
    'schedule_account_deletion'::text,
    'cancel_account_deletion'::text,
    'delete_inactive_account'::text,
    'configure_google_sheets'::text
  ]));

create or replace function public.admin_google_sheets_users()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare actor uuid := auth.uid();
begin
  if not private.is_admin(actor) then
    raise exception 'Administrative access required';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', c.user_id,
      'enabled', c.enabled,
      'sheet_tab_name', c.sheet_tab_name,
      'last_sync_started_at', c.last_sync_started_at,
      'last_sync_completed_at', c.last_sync_completed_at,
      'last_sync_status', c.last_sync_status,
      'last_sync_normal_count', c.last_sync_normal_count,
      'last_sync_special_count', c.last_sync_special_count,
      'last_sync_error', c.last_sync_error,
      'updated_at', c.updated_at
    ) order by c.updated_at desc)
    from public.google_sheets_user_config c
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_set_google_sheets_user(
  p_target_user uuid,
  p_enabled boolean,
  p_sheet_tab_name text,
  p_reason text,
  p_sheet_tab_gid bigint default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := auth.uid();
  clean_tab text := trim(coalesce(p_sheet_tab_name, ''));
begin
  if not private.is_admin(actor) then
    raise exception 'Administrative access required';
  end if;
  if not exists (select 1 from auth.users where id = p_target_user) then
    raise exception 'User not found';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A reason with at least 3 characters is required';
  end if;
  if p_enabled and clean_tab = '' then
    raise exception 'Informe o nome da aba antes de permitir a atualização';
  end if;
  if char_length(clean_tab) > 100 or clean_tab ~ '[[:cntrl:]]' then
    raise exception 'Nome da aba inválido';
  end if;

  insert into public.google_sheets_user_config(
    user_id, enabled, sheet_tab_name, updated_at, updated_by
  ) values (
    p_target_user, p_enabled, clean_tab, now(), actor
  )
  on conflict (user_id) do update
  set enabled = excluded.enabled,
      sheet_tab_name = case
        when excluded.sheet_tab_name <> '' then excluded.sheet_tab_name
        else public.google_sheets_user_config.sheet_tab_name
      end,
      updated_at = now(),
      updated_by = actor;

  insert into public.admin_audit_logs(
    admin_user_id, target_user_id, action, reason, metadata
  ) values (
    actor,
    p_target_user,
    'configure_google_sheets',
    trim(p_reason),
    jsonb_build_object(
      'enabled', p_enabled,
      'sheet_tab_name', clean_tab,
      'sheet_tab_gid', p_sheet_tab_gid
    )
  );

  return true;
end;
$function$;

create or replace function public.claim_google_sheets_sync()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor uuid := auth.uid();
  config public.google_sheets_user_config%rowtype;
  retry_after integer;
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'Authenticated active account required';
  end if;

  select * into config
  from public.google_sheets_user_config
  where user_id = actor
  for update;

  if not found or not config.enabled or trim(config.sheet_tab_name) = '' then
    raise exception 'GOOGLE_SHEETS_NOT_ENABLED';
  end if;

  if config.last_sync_started_at is not null
     and config.last_sync_started_at > now() - interval '5 minutes' then
    retry_after := greatest(1, ceil(extract(epoch from (
      config.last_sync_started_at + interval '5 minutes' - now()
    )))::integer);
    return jsonb_build_object(
      'allowed', false,
      'retry_after_seconds', retry_after
    );
  end if;

  update public.google_sheets_user_config
  set last_sync_started_at = now(),
      last_sync_status = 'running',
      last_sync_error = null,
      updated_at = now()
  where user_id = actor;

  return jsonb_build_object(
    'allowed', true,
    'sheet_tab_name', config.sheet_tab_name,
    'cooldown_seconds', 300
  );
end;
$function$;

create or replace function public.complete_google_sheets_sync(
  p_success boolean,
  p_normal_count integer default 0,
  p_special_count integer default 0,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare actor uuid := auth.uid();
begin
  if actor is null then
    raise exception 'Authenticated account required';
  end if;

  update public.google_sheets_user_config
  set last_sync_completed_at = now(),
      last_sync_status = case when p_success then 'success' else 'error' end,
      last_sync_normal_count = greatest(0, coalesce(p_normal_count, 0)),
      last_sync_special_count = greatest(0, coalesce(p_special_count, 0)),
      last_sync_error = case
        when p_success then null
        else left(coalesce(p_error, 'Falha desconhecida'), 500)
      end,
      updated_at = now()
  where user_id = actor;

  return found;
end;
$function$;

revoke all on function public.admin_google_sheets_users() from public, anon;
revoke all on function public.admin_set_google_sheets_user(uuid, boolean, text, text, bigint) from public, anon;
revoke all on function public.claim_google_sheets_sync() from public, anon;
revoke all on function public.complete_google_sheets_sync(boolean, integer, integer, text) from public, anon;

grant execute on function public.admin_google_sheets_users() to authenticated, service_role;
grant execute on function public.admin_set_google_sheets_user(uuid, boolean, text, text, bigint) to authenticated, service_role;
grant execute on function public.claim_google_sheets_sync() to authenticated, service_role;
grant execute on function public.complete_google_sheets_sync(boolean, integer, integer, text) to authenticated, service_role;

