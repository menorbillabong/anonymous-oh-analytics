-- Keep a post's spreadsheet classification synchronized with its current
-- mission profile while preserving all historical reward and theme fields.

create or replace function private.snapshot_post_sheet_mission_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT'
     or new.mission_profile_id is distinct from old.mission_profile_id
     or new.sheets_is_special is distinct from old.sheets_is_special then
    new.sheets_is_special := coalesce((
      select m.is_special
      from public.mission_profiles m
      where m.id = new.mission_profile_id
        and m.user_id = new.user_id
    ), false);
  else
    new.sheets_is_special := old.sheets_is_special;
  end if;
  return new;
end;
$function$;

create or replace function private.sync_posts_sheet_mission_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.is_special is distinct from old.is_special then
    update public.posts
    set sheets_is_special = new.is_special
    where user_id = new.user_id
      and mission_profile_id = new.id
      and sheets_is_special is distinct from new.is_special;
  end if;
  return new;
end;
$function$;

drop trigger if exists sync_posts_sheet_mission_type on public.mission_profiles;
create trigger sync_posts_sheet_mission_type
after update of is_special on public.mission_profiles
for each row execute function private.sync_posts_sheet_mission_type();

create or replace function public.reassign_my_mission_posts(p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  actor uuid := auth.uid();
  changed_count integer := 0;
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'Authenticated active account required';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'INVALID_MISSION_POST_CHANGES';
  end if;
  if jsonb_array_length(p_changes) = 0 or jsonb_array_length(p_changes) > 500 then
    raise exception 'INVALID_MISSION_POST_CHANGES';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_changes) item
    where coalesce(item->>'post_id', '') !~ '^[1-9][0-9]*$'
       or (
         item->>'mission_profile_id' is not null
         and item->>'mission_profile_id' !~ '^[1-9][0-9]*$'
       )
  ) then
    raise exception 'INVALID_MISSION_POST_CHANGES';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_changes) item
    group by (item->>'post_id')::bigint
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_MISSION_POST_CHANGE';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_changes) item
    left join public.posts p
      on p.id = (item->>'post_id')::bigint
     and p.user_id = actor
    where p.id is null
  ) then
    raise exception 'MISSION_POST_NOT_FOUND';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_changes) item
    left join public.mission_profiles m
      on m.id = (item->>'mission_profile_id')::bigint
     and m.user_id = actor
     and m.active
    where item->>'mission_profile_id' is not null
      and m.id is null
  ) then
    raise exception 'MISSION_PROFILE_NOT_AVAILABLE';
  end if;

  with requested as (
    select
      (item->>'post_id')::bigint as post_id,
      (item->>'mission_profile_id')::bigint as mission_profile_id
    from jsonb_array_elements(p_changes) item
  )
  update public.posts p
  set mission_profile_id = requested.mission_profile_id
  from requested
  where p.id = requested.post_id
    and p.user_id = actor
    and p.mission_profile_id is distinct from requested.mission_profile_id;

  get diagnostics changed_count = row_count;
  return jsonb_build_object('updated_count', changed_count);
end;
$function$;

revoke all on function private.snapshot_post_sheet_mission_type() from public, anon, authenticated;
revoke all on function private.sync_posts_sheet_mission_type() from public, anon, authenticated;
revoke all on function public.reassign_my_mission_posts(jsonb) from public, anon;
grant execute on function public.reassign_my_mission_posts(jsonb) to authenticated, service_role;

