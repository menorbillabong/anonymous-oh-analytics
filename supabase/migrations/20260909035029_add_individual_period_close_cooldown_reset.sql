create or replace function public.admin_period_close_cooldown_verified(
  p_actor uuid,
  p_action text,
  p_target_user uuid default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cooldown private.period_close_cooldowns%rowtype;
  v_reset_at timestamptz;
begin
  if not private.is_admin(p_actor) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  if p_action = 'status' then
    return coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', cooldown.user_id,
        'last_closed_at', cooldown.last_closed_at,
        'next_allowed_at', cooldown.next_allowed_at,
        'blocked', cooldown.next_allowed_at > clock_timestamp(),
        'reset_at', cooldown.reset_at
      ) order by cooldown.next_allowed_at desc)
      from private.period_close_cooldowns cooldown
    ), '[]'::jsonb);
  end if;

  if p_action <> 'reset' then
    raise exception 'PERIOD_CLOSE_COOLDOWN_ACTION_INVALID' using errcode = '22023';
  end if;

  if p_target_user is null or not exists (
    select 1 from auth.users target where target.id = p_target_user
  ) then
    raise exception 'PERIOD_CLOSE_COOLDOWN_USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 3
     or char_length(trim(p_reason)) > 500 then
    raise exception 'Administrative reason must contain between 3 and 500 characters';
  end if;

  select cooldown.*
  into v_cooldown
  from private.period_close_cooldowns cooldown
  where cooldown.user_id = p_target_user
  for update;

  if not found or v_cooldown.next_allowed_at <= clock_timestamp() then
    raise exception 'PERIOD_CLOSE_COOLDOWN_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  v_reset_at := clock_timestamp();

  update private.period_close_cooldowns
  set next_allowed_at = v_reset_at,
      reset_at = v_reset_at,
      reset_by = p_actor,
      updated_at = v_reset_at
  where user_id = p_target_user;

  insert into public.admin_audit_logs (
    admin_user_id, target_user_id, action, reason, metadata
  ) values (
    p_actor, p_target_user, 'reset_period_close_cooldown', trim(p_reason),
    jsonb_build_object(
      'previous_last_closed_at', v_cooldown.last_closed_at,
      'previous_next_allowed_at', v_cooldown.next_allowed_at,
      'reset_at', v_reset_at
    )
  );

  return jsonb_build_object(
    'user_id', p_target_user,
    'next_allowed_at', v_reset_at,
    'reset_at', v_reset_at
  );
end;
$$;

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check check (action = any (array[
    'suspend','reactivate','block_ranking','unblock_ranking',
    'unlock_ranking_control','lock_ranking_control',
    'enable_global_ranking_control','disable_global_ranking_control',
    'disqualify_post','requalify_post','configure_account_cleanup',
    'schedule_account_deletion','cancel_account_deletion','delete_inactive_account',
    'configure_google_sheets','configure_closed_period_post_cleanup',
    'schedule_closed_period_post_cleanup','cancel_closed_period_post_cleanup',
    'delete_closed_period_posts','delete_user_posts_by_date',
    'update_account_access','reopen_closed_period','reset_period_close_cooldown'
  ]));

revoke all on function public.admin_period_close_cooldown_verified(uuid, text, uuid, text)
from public, anon, authenticated;
grant execute on function public.admin_period_close_cooldown_verified(uuid, text, uuid, text)
to service_role;

