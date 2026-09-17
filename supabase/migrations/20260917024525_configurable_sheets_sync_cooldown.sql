-- Global duration; each user's last sync still starts their own waiting period.
create table public.google_sheets_sync_settings (
  singleton boolean primary key default true check (singleton),
  cooldown_seconds integer not null default 90 check (cooldown_seconds between 1 and 86400)
);
insert into public.google_sheets_sync_settings(singleton,cooldown_seconds) values(true,90);
alter table public.google_sheets_sync_settings enable row level security;
revoke all on public.google_sheets_sync_settings from public,anon,authenticated;
grant select on public.google_sheets_sync_settings to authenticated;
grant update(cooldown_seconds) on public.google_sheets_sync_settings to authenticated;
grant all on public.google_sheets_sync_settings to service_role;
create policy "active users read global sheets cooldown"
on public.google_sheets_sync_settings for select to authenticated
using ((select auth.uid()) is not null and private.account_active((select auth.uid())));
create policy "active admins change global sheets cooldown"
on public.google_sheets_sync_settings for update to authenticated
using (private.is_admin((select auth.uid())) and private.account_active((select auth.uid())))
with check (private.is_admin((select auth.uid())) and private.account_active((select auth.uid())));

-- Read-only and invoker: existing RLS restricts config to the caller's account.
create function public.get_my_google_sheets_sync_status()
returns jsonb language plpgsql stable security invoker set search_path=''
as $function$
declare
  actor uuid := auth.uid();
  config public.google_sheets_user_config%rowtype;
  seconds integer;
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'Authenticated active account required' using errcode='42501';
  end if;
  select cooldown_seconds into strict seconds from public.google_sheets_sync_settings where singleton;
  select * into config from public.google_sheets_user_config where user_id=actor;
  return jsonb_build_object(
    'enabled',coalesce(config.enabled and trim(config.sheet_tab_name)<>'',false),
    'cooldown_seconds',seconds,
    'retry_after_seconds',greatest(0,ceil(extract(epoch from (
      config.last_sync_started_at + make_interval(secs=>seconds) - now()
    )))::integer)
  );
end;
$function$;
revoke all on function public.get_my_google_sheets_sync_status() from public,anon;
grant execute on function public.get_my_google_sheets_sync_status() to authenticated,service_role;

-- Preserve the existing privileged claim and its per-user row lock/guards.
create or replace function public.claim_google_sheets_sync()
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  actor uuid := auth.uid();
  config public.google_sheets_user_config%rowtype;
  seconds integer;
  retry_after integer;
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'Authenticated active account required';
  end if;
  select * into config from public.google_sheets_user_config where user_id=actor for update;
  if not found or not config.enabled or trim(config.sheet_tab_name)='' then
    raise exception 'GOOGLE_SHEETS_NOT_ENABLED';
  end if;
  select cooldown_seconds into strict seconds from public.google_sheets_sync_settings where singleton;
  retry_after := greatest(0,ceil(extract(epoch from (
    config.last_sync_started_at + make_interval(secs=>seconds) - now()
  )))::integer);
  if retry_after>0 then
    return jsonb_build_object('allowed',false,'retry_after_seconds',retry_after,'cooldown_seconds',seconds);
  end if;
  update public.google_sheets_user_config
  set last_sync_started_at=now(),last_sync_status='running',last_sync_error=null,updated_at=now()
  where user_id=actor;
  return jsonb_build_object(
    'allowed',true,'sheet_tab_name',config.sheet_tab_name,'sheet_month',config.sheet_month,
    'cooldown_seconds',seconds,'cooldown_ends_at',now()+make_interval(secs=>seconds)
  );
end;
$function$;
revoke all on function public.claim_google_sheets_sync() from public,anon;
grant execute on function public.claim_google_sheets_sync() to authenticated,service_role;
