-- Preserve the destination account name and confirmation state, even for old presets.
-- Atomic, account-scoped preset import. Existing missions (and their posts) are
-- never updated; the file cannot grant permissions or supply an owner/ID.
create or replace function public.import_my_settings_preset(
  p_settings jsonb, p_missions jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.user_settings%rowtype;
  v_clean jsonb := '{}'::jsonb;
  v_key text;
  v_value jsonb;
  v_text text;
  v_mission jsonb;
  v_name text;
  v_network text;
  v_special boolean;
  v_allowed_special boolean := false;
  v_imported integer := 0;
  v_existing integer := 0;
  v_unmarked integer := 0;
begin
  if v_uid is null then raise exception 'PRESET_NOT_AUTHENTICATED'; end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object'
     or p_missions is null or jsonb_typeof(p_missions) <> 'array'
     or jsonb_array_length(p_missions) > 1000
     or octet_length(p_settings::text) + octet_length(p_missions::text) > 1048576
  then raise exception 'INVALID_PRESET'; end if;

  -- Serialize imports for this account, retaining all normal RLS protections.
  select * into v_settings from public.user_settings where user_id = v_uid for update;
  if not found then raise exception 'PRESET_PROFILE_UNAVAILABLE'; end if;

  for v_key, v_value in select key, value from jsonb_each(p_settings) loop
    if not (v_key = any(array['matrix_enabled','matrix_color','x_handle',
      'panel_action_layout','ranking_opt_in','refresh_interval','show_refresh_timer',
      'cap_unlocked','crystalgin_limit','accent_color','background_color',
      'surface_color','border_color','language','monthly_post_goal'])) then continue; end if;
    v_text := v_value #>> '{}';
    if v_value = 'null'::jsonb then raise exception 'INVALID_PRESET'; end if;
    if v_key = any(array['matrix_enabled','ranking_opt_in','show_refresh_timer','cap_unlocked']) then
      if jsonb_typeof(v_value) <> 'boolean' then raise exception 'INVALID_PRESET'; end if;
    elsif v_key = any(array['matrix_color','accent_color','background_color','surface_color','border_color']) then
      if jsonb_typeof(v_value) <> 'string' or v_text !~ '^#[0-9a-fA-F]{6}$' then raise exception 'INVALID_PRESET'; end if;
    elsif v_key = any(array['crystalgin_limit','monthly_post_goal','refresh_interval']) then
      if jsonb_typeof(v_value) <> 'number' then raise exception 'INVALID_PRESET'; end if;
      if v_key = 'refresh_interval' then
        if v_text::numeric not in (0.5,1,3,6,12,24) then raise exception 'INVALID_PRESET'; end if;
      elsif v_text::numeric < 1 or v_text::numeric > 2147483647 or trunc(v_text::numeric) <> v_text::numeric then
        raise exception 'INVALID_PRESET';
      end if;
    else
      if jsonb_typeof(v_value) <> 'string' then raise exception 'INVALID_PRESET'; end if;
      if v_key = 'x_handle' then
        v_text := regexp_replace(btrim(v_text), '^@', '');
        if v_text <> '' and v_text !~ '^[A-Za-z0-9_]{1,15}$' then raise exception 'INVALID_PRESET'; end if;
      elsif v_key = 'language' and v_text not in ('pt-BR','en','es') then raise exception 'INVALID_PRESET';
      elsif v_key = 'panel_action_layout' and v_text not in ('classic','organized') then raise exception 'INVALID_PRESET';
      end if;
      v_value := to_jsonb(v_text);
    end if;
    v_clean := v_clean || jsonb_build_object(v_key, v_value);
  end loop;
  v_settings := jsonb_populate_record(v_settings, v_clean);
  if not coalesce((public.ranking_access_state()->>'can_choose')::boolean, false) then
    v_settings.ranking_opt_in := true;
  end if;

  select coalesce(c.enabled and length(btrim(c.sheet_tab_name)) > 0, false)
  into v_allowed_special from public.google_sheets_user_config c where c.user_id = v_uid;

  for v_mission in select value from jsonb_array_elements(p_missions) loop
    if jsonb_typeof(v_mission) <> 'object' then raise exception 'INVALID_PRESET_MISSION'; end if;
    foreach v_key in array array['name','network','description','color'] loop
      if jsonb_typeof(v_mission->v_key) is distinct from 'string' then raise exception 'INVALID_PRESET_MISSION'; end if;
    end loop;
    foreach v_key in array array['active','is_special'] loop
      if jsonb_typeof(v_mission->v_key) is distinct from 'boolean' then raise exception 'INVALID_PRESET_MISSION'; end if;
    end loop;
    foreach v_key in array array['multiplier','reward','submission_limit'] loop
      if jsonb_typeof(v_mission->v_key) is distinct from 'number' then raise exception 'INVALID_PRESET_MISSION'; end if;
    end loop;
    v_name := btrim(v_mission->>'name');
    v_network := btrim(v_mission->>'network');
    if length(v_name) not between 1 and 200 or length(v_network) not between 1 and 40
      or length(v_mission->>'description') > 5000 or (v_mission->>'color') !~ '^#[0-9a-fA-F]{6}$'
      or (v_mission->>'multiplier')::numeric not between 0.000001 and 1000000
      or (v_mission->>'reward')::numeric not between 0 and 9007199254740991
      or trunc((v_mission->>'reward')::numeric) <> (v_mission->>'reward')::numeric
      or (v_mission->>'submission_limit')::numeric not between 0 and 2147483647
      or trunc((v_mission->>'submission_limit')::numeric) <> (v_mission->>'submission_limit')::numeric
    then raise exception 'INVALID_PRESET_MISSION'; end if;

    if exists (select 1 from public.mission_profiles m where m.user_id = v_uid
      and lower(btrim(m.name)) = lower(v_name) and lower(btrim(m.network)) = lower(v_network)) then
      v_existing := v_existing + 1;
      continue;
    end if;
    v_special := (v_mission->>'is_special')::boolean and coalesce(v_allowed_special, false);
    if (v_mission->>'is_special')::boolean and not v_special then v_unmarked := v_unmarked + 1; end if;
    insert into public.mission_profiles(user_id,name,network,description,multiplier,reward,submission_limit,color,active,is_special)
      values(v_uid,v_name,v_network,v_mission->>'description',(v_mission->>'multiplier')::numeric,
        (v_mission->>'reward')::bigint,(v_mission->>'submission_limit')::integer,v_mission->>'color',
        (v_mission->>'active')::boolean,v_special);
    v_imported := v_imported + 1;
  end loop;

  update public.user_settings set
    matrix_enabled=v_settings.matrix_enabled,matrix_color=v_settings.matrix_color,
    x_handle=v_settings.x_handle,panel_action_layout=v_settings.panel_action_layout,
    ranking_opt_in=v_settings.ranking_opt_in,refresh_interval=v_settings.refresh_interval,
    show_refresh_timer=v_settings.show_refresh_timer,cap_unlocked=v_settings.cap_unlocked,
    crystalgin_limit=v_settings.crystalgin_limit,
    accent_color=v_settings.accent_color,background_color=v_settings.background_color,
    surface_color=v_settings.surface_color,border_color=v_settings.border_color,
    language=v_settings.language,monthly_post_goal=v_settings.monthly_post_goal,
    updated_at=now()
  where user_id=v_uid returning * into v_settings;
  return jsonb_build_object('settings',to_jsonb(v_settings),'imported_count',v_imported,
    'existing_count',v_existing,'special_unmarked_count',v_unmarked);
end;
$$;
revoke all on function public.import_my_settings_preset(jsonb,jsonb) from public, anon;
grant execute on function public.import_my_settings_preset(jsonb,jsonb) to authenticated;
