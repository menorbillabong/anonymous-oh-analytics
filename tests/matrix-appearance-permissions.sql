-- Rollback-only verification: no account preferences or activity changes survive.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $$
declare actor uuid; other_user uuid;
begin
  select user_id into actor from public.user_settings
    where private.account_active(user_id) and ranking_opt_in order by user_id limit 1;
  select user_id into other_user from public.user_settings where user_id <> actor order by user_id limit 1;
  if actor is null or other_user is null then raise exception 'Need two existing accounts for ownership test'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
  perform set_config('matrix.test.other',other_user::text,true);
end $$;
set local role authenticated;
do $$
declare affected integer;
begin
  update public.user_settings set matrix_enabled=false,matrix_color='#b189ff' where user_id=auth.uid();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own settings update failed'; end if;
  if not exists(select 1 from public.user_settings where user_id=auth.uid() and not matrix_enabled and matrix_color='#b189ff') then raise exception 'Read back failed'; end if;
  update public.user_settings set matrix_color='#f9ad3e' where user_id=current_setting('matrix.test.other')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-account update allowed'; end if;
  begin
    update public.user_settings set matrix_color='invalid' where user_id=auth.uid();
    raise exception 'Invalid color accepted';
  exception when check_violation then null;
  end;
  update public.user_settings set matrix_enabled=true,matrix_color='#123456' where user_id=auth.uid();
  if not exists(select 1 from public.user_settings where user_id=auth.uid() and matrix_enabled and matrix_color='#123456') then raise exception 'Custom color/re-enable failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare affected integer;
begin
  begin
    update public.user_settings set matrix_enabled=false;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Anonymous write allowed'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
select 'PASS: own save/read, disable/re-enable, custom color, invalid color rejection, cross-account and anonymous isolation; rolled back' as result;
