-- Let each permitted user choose the spreadsheet month manually.
-- The setting is independent from mission profiles and remains saved until changed.

alter table public.google_sheets_user_config
  add column if not exists sheet_month text not null default '';

alter table public.google_sheets_user_config
  drop constraint if exists google_sheets_user_config_sheet_month_check;

alter table public.google_sheets_user_config
  add constraint google_sheets_user_config_sheet_month_check
  check (sheet_month = '' or sheet_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

grant update (sheet_month) on table public.google_sheets_user_config to authenticated;

drop policy if exists "users can update own sheets month" on public.google_sheets_user_config;
create policy "users can update own sheets month"
on public.google_sheets_user_config
for update
to authenticated
using (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and enabled
  and trim(sheet_tab_name) <> ''
  and private.account_active((select auth.uid()))
)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and enabled
  and trim(sheet_tab_name) <> ''
  and private.account_active((select auth.uid()))
);

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
    'sheet_month', config.sheet_month,
    'cooldown_seconds', 300
  );
end;
$function$;

revoke all on function public.claim_google_sheets_sync() from public, anon;
grant execute on function public.claim_google_sheets_sync() to authenticated, service_role;

