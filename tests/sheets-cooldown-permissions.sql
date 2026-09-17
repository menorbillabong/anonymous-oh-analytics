-- Integration checks: all fixture changes and claims are rolled back.
begin;
select set_config('test.sheets_admin',(select user_id::text from public.admin_users where private.account_active(user_id) order by user_id limit 1),true);
select set_config('test.sheets_user',(select user_id::text from public.google_sheets_user_config where enabled and trim(sheet_tab_name)<>'' and private.account_active(user_id) and not private.is_admin(user_id) order by user_id limit 1),true);
select set_config('test.sheets_other',(select id::text from auth.users where private.account_active(id) and id::text<>current_setting('test.sheets_user') order by id limit 1),true);
do $$ begin
  assert nullif(current_setting('test.sheets_admin'),'') is not null,'admin fixture required';
  assert nullif(current_setting('test.sheets_user'),'') is not null,'user fixture required';
  assert (select cooldown_seconds=90 from public.google_sheets_sync_settings),'initial setting';
  assert not has_table_privilege('anon','public.google_sheets_sync_settings','SELECT'),'anon read';
  assert not has_function_privilege('anon','public.get_my_google_sheets_sync_status()','EXECUTE'),'anon status';
end $$;
update public.google_sheets_user_config set last_sync_started_at=now()-interval '89 seconds' where user_id=current_setting('test.sheets_user')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.sheets_user'),true);
do $$ declare result jsonb; affected integer; begin
  update public.google_sheets_sync_settings set cooldown_seconds=1 where singleton;
  get diagnostics affected=row_count;
  assert affected=0,'ordinary user changed duration';
  assert (select cooldown_seconds=90 from public.google_sheets_sync_settings),'ordinary read';
  result:=public.get_my_google_sheets_sync_status();
  assert (result->>'enabled')::boolean and (result->>'retry_after_seconds')::int=1,'89 second status';
  result:=public.claim_google_sheets_sync();
  assert not (result->>'allowed')::boolean and (result->>'retry_after_seconds')::int=1,'89 second block';
  begin update public.google_sheets_user_config set last_sync_started_at=null where user_id=auth.uid();raise exception 'user reset cooldown';exception when insufficient_privilege then null;end;
  begin delete from public.google_sheets_sync_settings;raise exception 'user deleted setting';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.sheets_admin'),true);
do $$ begin
  update public.google_sheets_sync_settings set cooldown_seconds=120 where singleton;
  assert (select cooldown_seconds=120 from public.google_sheets_sync_settings),'admin save';
  begin update public.google_sheets_sync_settings set cooldown_seconds=0;raise exception 'zero accepted';exception when check_violation then null;end;
  begin update public.google_sheets_sync_settings set cooldown_seconds=86401;raise exception 'oversized accepted';exception when check_violation then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.sheets_user'),true);
do $$ begin
  assert (public.get_my_google_sheets_sync_status()->>'retry_after_seconds')::int=31,'changed duration not reflected';
  assert (public.claim_google_sheets_sync()->>'retry_after_seconds')::int=31,'server disagrees with status';
end $$;
reset role;
update public.google_sheets_sync_settings set cooldown_seconds=90;
update public.google_sheets_user_config set last_sync_started_at=now()-interval '90 seconds' where user_id=current_setting('test.sheets_user')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.sheets_user'),true);
do $$ declare result jsonb; begin
  assert (public.get_my_google_sheets_sync_status()->>'retry_after_seconds')::int=0,'90 second boundary';
  result:=public.claim_google_sheets_sync();
  assert (result->>'allowed')::boolean and (result->>'cooldown_seconds')::int=90,'90 second release';
  assert (result->>'cooldown_ends_at')::timestamptz=now()+interval '90 seconds','deadline';
  result:=public.claim_google_sheets_sync();
  assert not (result->>'allowed')::boolean and (result->>'retry_after_seconds')::int=90,'second claim allowed';
  assert (public.get_my_google_sheets_sync_status()->>'retry_after_seconds')::int=90,'reload resets countdown';
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.sheets_other'),true);
do $$ begin
  assert (select count(*)=0 from public.google_sheets_user_config where user_id=current_setting('test.sheets_user')::uuid),'other user config exposed';
end $$;
reset role;
update public.google_sheets_user_config set last_sync_started_at=null,enabled=false where user_id=current_setting('test.sheets_user')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.sheets_user'),true);
do $$ begin
  assert not (public.get_my_google_sheets_sync_status()->>'enabled')::boolean,'disabled access visible';
  begin perform public.claim_google_sheets_sync();raise exception 'disabled user claimed';exception when raise_exception then if sqlerrm<>'GOOGLE_SHEETS_NOT_ENABLED' then raise;end if;end;
end $$;
reset role;
select 'PASS: global default, admin-only writes, validation, timing boundaries, repeat/reload blocking, dynamic duration, isolation, disabled access' as verification;
rollback;
