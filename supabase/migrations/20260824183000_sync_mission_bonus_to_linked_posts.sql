-- Keep the post classification and fixed reward aligned with its current
-- mission profile. This replaces the former historical reward snapshot rule.

create or replace function private.snapshot_post_sheet_mission_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_is_special boolean := false;
  profile_reward bigint := 0;
begin
  if tg_op = 'INSERT'
     or new.mission_profile_id is distinct from old.mission_profile_id then
    select
      coalesce(m.is_special, false),
      coalesce(m.reward, 0)
    into profile_is_special, profile_reward
    from public.mission_profiles m
    where m.id = new.mission_profile_id
      and m.user_id = new.user_id;

    if not found then
      profile_is_special := false;
      profile_reward := 0;
    end if;

    new.sheets_is_special := profile_is_special;
    new.special_reward := case when profile_is_special then profile_reward else 0 end;
  elsif new.sheets_is_special is distinct from old.sheets_is_special then
    select
      coalesce(m.is_special, false),
      coalesce(m.reward, 0)
    into profile_is_special, profile_reward
    from public.mission_profiles m
    where m.id = new.mission_profile_id
      and m.user_id = new.user_id;

    if not found then
      profile_is_special := false;
      profile_reward := 0;
    end if;

    new.sheets_is_special := profile_is_special;
    new.special_reward := case when profile_is_special then profile_reward else 0 end;
  end if;

  return new;
end;
$$;

revoke all on function private.snapshot_post_sheet_mission_type() from public;
revoke all on function private.snapshot_post_sheet_mission_type() from anon;
revoke all on function private.snapshot_post_sheet_mission_type() from authenticated;

create or replace function private.sync_posts_sheet_mission_type()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  desired_reward bigint := case
    when coalesce(new.is_special, false) then coalesce(new.reward, 0)
    else 0
  end;
begin
  if new.is_special is distinct from old.is_special
     or new.reward is distinct from old.reward then
    update public.posts
    set
      sheets_is_special = coalesce(new.is_special, false),
      special_reward = desired_reward
    where user_id = new.user_id
      and mission_profile_id = new.id
      and (
        sheets_is_special is distinct from coalesce(new.is_special, false)
        or special_reward is distinct from desired_reward
      );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_posts_sheet_mission_type() from public;
revoke all on function private.sync_posts_sheet_mission_type() from anon;
revoke all on function private.sync_posts_sheet_mission_type() from authenticated;

drop trigger if exists sync_posts_sheet_mission_type on public.mission_profiles;
create trigger sync_posts_sheet_mission_type
after update of is_special, reward on public.mission_profiles
for each row
execute function private.sync_posts_sheet_mission_type();

-- Adopt the new rule immediately for existing linked publications.
update public.posts p
set
  sheets_is_special = coalesce(m.is_special, false),
  special_reward = case
    when coalesce(m.is_special, false) then coalesce(m.reward, 0)
    else 0
  end
from public.mission_profiles m
where m.id = p.mission_profile_id
  and m.user_id = p.user_id
  and (
    p.sheets_is_special is distinct from coalesce(m.is_special, false)
    or p.special_reward is distinct from case
      when coalesce(m.is_special, false) then coalesce(m.reward, 0)
      else 0
    end
  );

