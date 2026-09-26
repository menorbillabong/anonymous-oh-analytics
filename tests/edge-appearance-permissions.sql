-- Rollback-only: no account settings, activity or ranking changes survive.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '20s';
do $$
declare actor uuid; other_user uuid;
begin
  select user_id into actor from public.user_settings where private.account_active(user_id) and ranking_opt_in order by user_id limit 1;
  select user_id into other_user from public.user_settings where user_id <> actor order by user_id limit 1;
  if actor is null or other_user is null then raise exception 'Need two accounts'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',actor,'role','authenticated')::text,true);
  perform set_config('edge.test.other',other_user::text,true);
end $$;
set local role authenticated;
do $$
declare affected integer; response jsonb; before_name text; before_other jsonb;
begin
  select app_name into before_name from public.user_settings where user_id=auth.uid();
  update public.user_settings set border_glow_intensity=0,button_colors='{"metrics":"#9257da"}' where user_id=auth.uid();
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Own save failed'; end if;
  if not exists(select 1 from public.user_settings where user_id=auth.uid() and border_glow_intensity=0 and button_colors->>'metrics'='#9257da') then raise exception 'Readback failed'; end if;
  if exists(select 1 from public.user_settings where user_id=current_setting('edge.test.other')::uuid) then raise exception 'Cross-account read allowed'; end if;
  update public.user_settings set border_glow_intensity=100 where user_id=current_setting('edge.test.other')::uuid;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Cross-account update allowed'; end if;
  begin
    update public.user_settings set border_glow_intensity=101 where user_id=auth.uid();
    raise exception 'Invalid intensity accepted';
  exception when check_violation then null; end;
  begin
    update public.user_settings set button_colors='{"x":"red"}' where user_id=auth.uid();
    raise exception 'Invalid color accepted';
  exception when check_violation then null; end;
  begin
    update public.user_settings set button_colors='{"unknown":"#123abc"}' where user_id=auth.uid();
    raise exception 'Unknown button accepted';
  exception when check_violation then null; end;
  response := public.import_my_settings_preset('{"border_glow_intensity":100,"button_colors":{"x":"#123abc"},"app_name":"DO NOT IMPORT"}', '[]');
  if response->'settings'->>'border_glow_intensity' <> '100' or response->'settings'->'button_colors'->>'x' <> '#123abc' then raise exception 'Preset appearance failed'; end if;
  if response->'settings'->>'app_name' is distinct from before_name then raise exception 'Name changed'; end if;
  response := public.import_my_settings_preset('{"accent_color":"#abcdef"}', '[]');
  if response->'settings'->>'border_glow_intensity' <> '100' or response->'settings'->'button_colors'->>'x' <> '#123abc' then raise exception 'Old preset overwrote preferences'; end if;
  update public.user_settings set border_glow_intensity=50,button_colors='{}' where user_id=auth.uid();
  if not exists(select 1 from public.user_settings where user_id=auth.uid() and border_glow_intensity=50 and button_colors='{}') then raise exception 'Restore failed'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"anon"}',true);
set local role anon;
do $$
declare affected integer;
begin
  begin
    update public.user_settings set border_glow_intensity=100;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Anonymous update allowed'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: own save/read, zero/100/default, color validation, old/new preset, name preservation, cross-account and anonymous isolation; all writes rolled back' as result;
