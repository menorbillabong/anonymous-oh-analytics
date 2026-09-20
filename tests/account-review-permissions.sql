-- Synthetic fixtures only. The complete transaction is rolled back.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
select set_config('test.review_admin',gen_random_uuid()::text,true);
select set_config('test.review_target',gen_random_uuid()::text,true);
select set_config('test.review_session',gen_random_uuid()::text,true);
insert into auth.users(id,email,created_at,last_sign_in_at,raw_user_meta_data)
values(current_setting('test.review_admin')::uuid,'review-admin-'||current_setting('test.review_admin')||'@example.invalid',now()-interval '600 days',now(),'{}'),
      (current_setting('test.review_target')::uuid,'review-target-'||current_setting('test.review_target')||'@example.invalid',now()-interval '600 days',now()-interval '600 days','{"name":"Synthetic fixture"}');
insert into public.admin_users(user_id) values(current_setting('test.review_admin')::uuid);
insert into auth.sessions(id,user_id,created_at,updated_at) values(current_setting('test.review_session')::uuid,current_setting('test.review_admin')::uuid,now(),now());
insert into public.posts(user_id,title,published_at,created_at) values(current_setting('test.review_target')::uuid,'ROLLBACK safety fixture',date '2024-01-15',now()-interval '500 days');
insert into public.tracking_periods(user_id,start_date,opened_at) values(current_setting('test.review_target')::uuid,date '2024-01-01',now()-interval '500 days');
select set_config('request.jwt.claim.sub',current_setting('test.review_target'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.review_target'),'role','authenticated')::text,true);
insert into public.archived_periods(user_id,month,period_start,period_end,archived_at,summary,posts_snapshot)
values(current_setting('test.review_target')::uuid,date '2024-01-01',date '2024-01-01',date '2024-01-31',now()-interval '450 days','{"posts":1}','[{"title":"archived fixture"}]');
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.archived_periods set archived_at=now()-interval '450 days' where user_id=current_setting('test.review_target')::uuid;
update public.tracking_periods set closed_at=null,corrected_at=null where user_id=current_setting('test.review_target')::uuid;
delete from public.account_activity where user_id=current_setting('test.review_target')::uuid;

do $$ begin
  assert not (select auto_delete_enabled from public.account_cleanup_settings where id=1),'automatic deletion enabled';
  assert not exists(select 1 from cron.job where jobname='anonymous-oh-account-cleanup' and active),'cron enabled';
  assert private.schedule_eligible_accounts(null)=0,'legacy scheduler active';
  assert private.run_account_cleanup()->>'deleted'='0','legacy worker active';
  assert exists(select 1 from auth.users where id=current_setting('test.review_target')::uuid),'legacy cleanup deleted fixture';
  begin update public.account_cleanup_settings set auto_delete_enabled=true where id=1; raise exception 'constraint missing'; exception when check_violation then null; end;
  assert not has_table_privilege('authenticated','private.account_deletion_backups','SELECT'),'backup table exposed';
  assert not has_table_privilege('service_role','private.account_deletion_backups','INSERT'),'backup forgery possible';
  assert not has_function_privilege('anon','public.admin_delete_reviewed_account(uuid,text,text,timestamptz)','EXECUTE'),'anonymous delete allowed';
  assert not has_function_privilege('anon','public.admin_account_backups(uuid)','EXECUTE'),'anonymous backups allowed';
end $$;

select set_config('request.jwt.claim.sub',current_setting('test.review_target'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.review_target'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin perform public.admin_preview_account_review(auth.uid()); raise exception 'nonadmin preview allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_account_backups(); raise exception 'nonadmin backups allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_delete_reviewed_account(auth.uid(),'wrong','reason',now()); raise exception 'nonadmin deletion allowed'; exception when insufficient_privilege then null; end;
  perform public.record_account_activity();
end $$;
reset role;
-- A newly active account must be rejected even if the admin's list was stale.
select set_config('request.jwt.claim.sub',current_setting('test.review_admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.review_admin'),'role','authenticated','session_id',current_setting('test.review_session'))::text,true);
set local role authenticated;
do $$ declare p jsonb; begin
  p:=public.admin_preview_account_review(current_setting('test.review_target')::uuid);
  assert not (p->>'can_delete')::boolean,'active account marked for deletion';
  begin perform public.admin_delete_reviewed_account(current_setting('test.review_target')::uuid,p->>'email','test active account',(p->>'last_activity_at')::timestamptz); raise exception 'active account deleted'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
  assert private.account_last_activity(current_setting('test.review_target')::uuid)>now()-interval '1 minute','persistent login visit not counted';
  delete from public.account_activity where user_id=current_setting('test.review_target')::uuid;
end $$;

-- A user-authenticated metrics update records activity; a background update does not.
select set_config('request.jwt.claim.sub',current_setting('test.review_target'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.review_target'),'role','authenticated')::text,true);
set local role authenticated;
update public.posts set likes=1 where user_id=auth.uid();
reset role;
do $$ begin
  assert private.account_last_activity(current_setting('test.review_target')::uuid)>now()-interval '1 minute','manual action not counted';
  delete from public.account_activity where user_id=current_setting('test.review_target')::uuid;
end $$;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
update public.posts set likes=2 where user_id=current_setting('test.review_target')::uuid;
do $$ begin
  assert private.account_last_activity(current_setting('test.review_target')::uuid)<now()-interval '400 days','background metrics counted as human';
end $$;

-- Admin ID alone is insufficient: a valid, existing session is required.
select set_config('request.jwt.claim.sub',current_setting('test.review_admin'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.review_admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  begin perform public.admin_account_backups(); raise exception 'missing session accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('test.review_admin'),'role','authenticated','session_id',current_setting('test.review_session'))::text,true);

do $$ begin
  begin delete from auth.users where id=current_setting('test.review_target')::uuid; raise exception 'unbacked raw deletion allowed'; exception when insufficient_privilege then null; end;
end $$;
-- Force a late FK failure on the synthetic fixture and verify atomic rollback.
insert into public.admin_audit_logs(admin_user_id,action,reason)
values(current_setting('test.review_target')::uuid,'configure_account_cleanup','Synthetic rollback blocker');
set local role authenticated;
do $$ declare p jsonb; begin
  p:=public.admin_preview_account_review(current_setting('test.review_target')::uuid);
  begin
    perform public.admin_delete_reviewed_account(current_setting('test.review_target')::uuid,p->>'email','Synthetic rollback test',(p->>'last_activity_at')::timestamptz);
    raise exception 'late foreign key failure was not enforced';
  exception when foreign_key_violation then null; end;
end $$;
reset role;
do $$ begin
  assert exists(select 1 from auth.users where id=current_setting('test.review_target')::uuid),'failed transaction removed user';
  assert exists(select 1 from public.posts where user_id=current_setting('test.review_target')::uuid),'failed transaction removed posts';
  assert not exists(select 1 from private.account_deletion_backups where target_user_id=current_setting('test.review_target')::uuid),'failed transaction left a misleading backup';
end $$;
delete from public.admin_audit_logs where admin_user_id=current_setting('test.review_target')::uuid;
set local role authenticated;
do $$ declare preview jsonb; result jsonb; b jsonb; target_id uuid:=current_setting('test.review_target')::uuid; begin
  begin perform public.admin_schedule_account_deletion(target_id,'test legacy'); raise exception 'legacy scheduling allowed'; exception when insufficient_privilege then null; end;
  begin perform public.admin_set_account_cleanup(true,30,5); raise exception 'legacy auto enable allowed'; exception when invalid_parameter_value then null; end;
  preview:=public.admin_preview_account_review(target_id);
  assert (preview->>'can_delete')::boolean,'inactive fixture not eligible';
  assert preview->>'posts'='1' and preview->>'archives'='1','preview counts wrong';
  begin perform public.admin_delete_reviewed_account(target_id,'wrong','test',(preview->>'last_activity_at')::timestamptz); raise exception 'wrong confirmation accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_delete_reviewed_account(target_id,preview->>'email','',(preview->>'last_activity_at')::timestamptz); raise exception 'empty reason accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_delete_reviewed_account(target_id,preview->>'email','test',now()); raise exception 'stale activity accepted'; exception when invalid_parameter_value then null; end;
  begin perform public.admin_delete_reviewed_account(auth.uid(),'wrong','test',now()); raise exception 'self deletion accepted'; exception when insufficient_privilege then null; end;
  result:=public.admin_delete_reviewed_account(target_id,preview->>'email','Synthetic fixture verification',(preview->>'last_activity_at')::timestamptz);
  assert (result->>'deleted')::boolean and result->>'backup_id' is not null,'deletion response missing backup';
  b:=public.admin_account_backups((result->>'backup_id')::uuid);
  assert jsonb_array_length(b->'snapshot'->'tables'->'public.posts')=1,'posts backup missing';
  assert jsonb_array_length(b->'snapshot'->'tables'->'public.archived_periods')=1,'archive backup missing';
  assert b->'snapshot'->'auth_user'->>'id'=target_id::text,'identity missing';
  assert not (b->'snapshot'->'auth_user' ? 'encrypted_password'),'password leaked';
  assert not (b->'snapshot'->'tables' ? 'auth.sessions'),'session token leaked';
end $$;
reset role;
do $$ begin
  assert not exists(select 1 from auth.users where id=current_setting('test.review_target')::uuid),'fixture was not removed';
  assert not exists(select 1 from public.posts where user_id=current_setting('test.review_target')::uuid),'fixture posts left behind';
  assert exists(select 1 from private.account_deletion_backups where target_user_id=current_setting('test.review_target')::uuid and deleted_at is not null),'backup cascaded away';
end $$;
rollback;
select 'PASS: legacy paths blocked, human activity tracked, background ignored, admin session enforced, confirmation validated, backup survives synthetic deletion; all fixtures rolled back' as verification;
