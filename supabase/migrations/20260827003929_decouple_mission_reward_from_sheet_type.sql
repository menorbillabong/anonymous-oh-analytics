-- A mission profile's fixed reward is independent from its Google Sheets section.
-- The is_special flag only decides whether the post belongs to Special Mission.

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
    new.special_reward := profile_reward;
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
    new.special_reward := profile_reward;
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
  desired_reward bigint := coalesce(new.reward, 0);
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

-- Correct only linked publications whose stored classification or reward differs
-- from the mission profile currently assigned to them.
update public.posts p
set
  sheets_is_special = coalesce(m.is_special, false),
  special_reward = coalesce(m.reward, 0)
from public.mission_profiles m
where m.id = p.mission_profile_id
  and m.user_id = p.user_id
  and (
    p.sheets_is_special is distinct from coalesce(m.is_special, false)
    or p.special_reward is distinct from coalesce(m.reward, 0)
  );

