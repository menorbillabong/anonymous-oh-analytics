-- Run inside BEGIN ... ROLLBACK. Existing rows are restored by rollback.
create temporary table x_handle_check as
select s.user_id, to_jsonb(s) as before from public.user_settings s
join public.user_moderation m on m.user_id=s.user_id
where m.x_import_enabled and private.account_active(s.user_id)
and (private.ranking_control_unlocked(s.user_id) or s.ranking_opt_in)
limit 1;
grant select on x_handle_check to authenticated;
do $$ begin if not exists(select 1 from x_handle_check) then raise exception 'No eligible test account'; end if; end $$;
create function pg_temp.expect_x_error(statement text, expected text) returns void language plpgsql as $$
declare rejected boolean:=false; begin
 begin execute statement; exception when others then
  if position(expected in sqlerrm)=0 then raise exception 'Unexpected rejection: %',sqlerrm; end if;
  rejected:=true;
 end;
 if not rejected then raise exception 'Expected rejection: %',expected; end if;
end $$;
select set_config('request.jwt.claim.sub',(select user_id::text from x_handle_check),true);
set local role authenticated;
update public.user_settings set x_handle='Test_Profile',updated_at=now()
where user_id=(select user_id from x_handle_check);
do $$ declare actual jsonb; touched integer; begin
 select to_jsonb(s) into actual from public.user_settings s where user_id=auth.uid();
 if actual->>'x_handle'<>'Test_Profile' then raise exception 'Handle not saved'; end if;
 if (actual-'x_handle'-'updated_at') is distinct from (select before-'x_handle'-'updated_at' from x_handle_check) then raise exception 'Other settings changed'; end if;
 if public.get_my_x_import_access()->>'handle'<>'Test_Profile' then raise exception 'Import uses different handle'; end if;
 update public.user_settings set x_handle='ShouldNotChange' where user_id<>auth.uid();
 get diagnostics touched=row_count;
 if touched<>0 then raise exception 'Cross-user update allowed'; end if;
end $$;
update public.user_settings set x_handle='' where user_id=auth.uid();
select pg_temp.expect_x_error('select public.claim_my_x_import_request()','X_IMPORT_HANDLE_REQUIRED');
update public.user_settings set x_handle='not valid!' where user_id=auth.uid();
select pg_temp.expect_x_error('select public.claim_my_x_import_request()','X_IMPORT_HANDLE_REQUIRED');
reset role;
-- Revoke within the transaction to verify authoritative server enforcement.
update public.user_moderation set x_import_enabled=false where user_id=(select user_id from x_handle_check);
set local role authenticated;
select pg_temp.expect_x_error('select public.claim_my_x_import_request()','X_IMPORT_NOT_ENABLED');
reset role;
set local role anon;
select pg_temp.expect_x_error('select public.get_my_x_import_access()','permission denied');
reset role;
select 'PASS: own handle persistence, shared settings/import value, unchanged unrelated settings, cross-user RLS and required handle/permission enforcement' as result;
