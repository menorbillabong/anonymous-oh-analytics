-- Keep the existing permission/cooldown contract; prevent overlapping sheet writes
-- even when the administrator sets a cooldown shorter than the request duration.
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
  if config.last_sync_status='running' then
    retry_after := greatest(retry_after,ceil(extract(epoch from (
      config.last_sync_started_at + interval '5 minutes' - now()
    )))::integer);
  end if;
  if retry_after>0 then
    return jsonb_build_object('allowed',false,'retry_after_seconds',retry_after,'cooldown_seconds',seconds);
  end if;
  update public.google_sheets_user_config
  set last_sync_started_at=now(),last_sync_status='running',last_sync_error=null,updated_at=now()
  where user_id=actor;
  return jsonb_build_object('allowed',true,'sheet_tab_name',config.sheet_tab_name,'sheet_month',config.sheet_month,
    'cooldown_seconds',seconds,'cooldown_ends_at',now()+make_interval(secs=>seconds));
end;
$function$;
revoke all on function public.claim_google_sheets_sync() from public,anon;
grant execute on function public.claim_google_sheets_sync() to authenticated,service_role;
