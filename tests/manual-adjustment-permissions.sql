-- Integration checks: all test permission/config changes are rolled back.
begin;

select set_config('test.adjustment_admin',(select user_id::text from public.admin_users order by user_id limit 1),true);
select set_config('test.adjustment_user',(select u.id::text from auth.users u join public.tracking_periods p on p.user_id=u.id and p.end_date is null where u.id not in(select user_id from public.admin_users) order by u.id limit 1),true);
select set_config('test.adjustment_other',(select id::text from auth.users where id not in(select user_id from public.admin_users) and id::text<>current_setting('test.adjustment_user') order by id limit 1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('test.adjustment_user'),true);
do $$ begin
  assert public.get_my_manual_adjustment_access() = '{"enabled":false}'::jsonb, 'must default disabled';
  begin perform public.admin_manual_adjustment_users(); raise exception 'nonadmin list allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_set_manual_adjustment_access(auth.uid(),true,'test'); raise exception 'self grant allowed'; exception when insufficient_privilege then null; end;
  begin insert into public.manual_adjustment_access(user_id,enabled,reason) values(auth.uid(),true,'test'); raise exception 'direct insert allowed'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.adjustment_admin'),true);
select public.admin_set_manual_adjustment_access(current_setting('test.adjustment_user')::uuid,true,'temporary rollback verification');
do $$ begin
  assert (select count(*)=1 from public.admin_manual_adjustment_users()), 'admin read';
  begin perform public.admin_set_manual_adjustment_access(current_setting('test.adjustment_user')::uuid,true,''); raise exception 'empty reason accepted'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.adjustment_other'),true);
do $$ begin assert (select count(*)=0 from public.manual_adjustment_access), 'cross-user data leaked'; end $$;
select set_config('request.jwt.claim.sub',current_setting('test.adjustment_user'),true);
do $$ begin
 assert public.get_my_manual_adjustment_access()='{"enabled":true}'::jsonb, 'own permission';
 update public.manual_adjustment_access set enabled=false where user_id=auth.uid();
 assert public.get_my_manual_adjustment_access()='{"enabled":true}'::jsonb, 'nonadmin update';
end $$;
do $$ declare cfg jsonb; again jsonb; pid bigint; begin
 cfg:=public.get_my_manual_like_adjustment();
 assert (cfg->>'allowed')::boolean and not (cfg->>'enabled')::boolean;
 pid:=(cfg->>'period_id')::bigint;
 assert pid is not null, 'test needs open period';
 cfg:=public.save_my_manual_like_adjustment(pid,150,true);
 assert (cfg->>'amount')::int=150 and (cfg->>'enabled')::boolean, 'save failed';
 again:=public.save_my_manual_like_adjustment(pid,150,true);
 assert cfg->>'seed'=again->>'seed','repeat save rerolled';
 cfg:=public.save_my_manual_like_adjustment(pid,150,false);
 assert not (cfg->>'enabled')::boolean and (cfg->>'amount')::int=150, 'disable lost quantity';
 begin perform public.save_my_manual_like_adjustment(pid,-1,true);raise exception 'negative accepted';exception when invalid_parameter_value then null;end;
 begin perform public.save_my_manual_like_adjustment(pid,1000001,true);raise exception 'oversized accepted';exception when invalid_parameter_value then null;end;
 begin perform public.save_my_manual_like_adjustment(-1,150,true);raise exception 'other period accepted';exception when invalid_parameter_value then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.adjustment_other'),true);
do $$ begin
 assert (select count(*)=0 from public.manual_like_adjustments),'other user config leaked';
 begin perform public.save_my_manual_like_adjustment(-1,150,true);raise exception 'unapproved user saved';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub',current_setting('test.adjustment_admin'),true);
select public.admin_set_manual_adjustment_access(current_setting('test.adjustment_user')::uuid,false,'temporary rollback revoke');
select set_config('request.jwt.claim.sub',current_setting('test.adjustment_user'),true);
do $$ begin assert public.get_my_manual_adjustment_access()='{"enabled":false}'::jsonb, 'revocation'; end $$;
do $$ begin
 assert not (public.get_my_manual_like_adjustment()->>'allowed')::boolean,'revoked config allowed';
 begin perform public.save_my_manual_like_adjustment(-1,150,true);raise exception 'revoked user saved';exception when insufficient_privilege then null;end;
 update public.manual_like_adjustments set enabled=true;
 assert not (public.get_my_manual_like_adjustment()->>'enabled')::boolean,'revoked direct mutation succeeded';
end $$;
reset role;
do $$ begin
 assert (select count(*)=2 from private.manual_adjustment_access_audit),'audit duplicates';
 assert not has_function_privilege('anon','public.get_my_manual_adjustment_access()','EXECUTE'),'anon execute';
 assert not has_table_privilege('authenticated','private.manual_adjustment_access_audit','SELECT'),'audit leaked';
end $$;
select 'PASS: defaults, admin grant/revoke, self-grant denied, direct writes denied, cross-user isolation, reason validation, audit' as verification;
rollback;
