-- Include the public profile name saved in Settings in the administrative user list.
-- The function remains restricted by the existing private.is_admin check.

create or replace function public.admin_dashboard()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare actor uuid := auth.uid();
begin
  if not private.is_admin(actor) then
    raise exception 'Administrative access required';
  end if;

  return jsonb_build_object(
    'controls', jsonb_build_object(
      'ranking_self_service_enabled', coalesce((select c.ranking_self_service_enabled from public.app_controls c where c.id = 1), false)
    ),
    'cleanup', coalesce((
      select jsonb_build_object(
        'auto_delete_enabled', s.auto_delete_enabled,
        'inactivity_days', s.inactivity_days,
        'grace_days', s.grace_days,
        'updated_at', s.updated_at
      )
      from public.account_cleanup_settings s
      where s.id = 1
    ), jsonb_build_object('auto_delete_enabled', false, 'inactivity_days', 90, 'grace_days', 7)),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id,
        'email', u.email,
        'username', credentials.username_display,
        'display_name', coalesce(u.raw_user_meta_data->>'display_name',''),
        'profile_name', coalesce(s.app_name,''),
        'created_at', u.created_at,
        'last_sign_in_at', u.last_sign_in_at,
        'last_activity_at', private.account_last_activity(u.id),
        'inactive_days', greatest(0, floor(extract(epoch from (now() - private.account_last_activity(u.id))) / 86400))::integer,
        'x_handle', coalesce(s.x_handle,''),
        'cap_unlocked', coalesce(s.cap_unlocked,false),
        'suspended', coalesce(m.suspended,false),
        'suspension_reason', m.suspension_reason,
        'ranking_blocked', coalesce(m.ranking_blocked,false),
        'ranking_control_unlocked', coalesce(m.ranking_control_unlocked,false),
        'is_admin', (a.user_id is not null),
        'deletion_scheduled_at', q.scheduled_at,
        'deletion_execute_after', q.execute_after,
        'deletion_source', q.source,
        'deletion_last_error', q.last_error
      ) order by u.created_at desc)
      from auth.users u
      left join public.username_credentials credentials on credentials.user_id = u.id
      left join public.user_settings s on s.user_id = u.id
      left join public.user_moderation m on m.user_id = u.id
      left join public.admin_users a on a.user_id = u.id
      left join public.account_deletion_queue q on q.user_id = u.id
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.published_at desc, p.created_at desc)
      from public.posts p
    ), '[]'::jsonb),
    'periods', coalesce((
      select jsonb_agg(to_jsonb(mp) order by mp.month desc)
      from public.mission_periods mp
    ), '[]'::jsonb),
    'logs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'admin_email', admin_user.email,
        'target_email', coalesce(target_user.email, l.metadata->>'target_email'),
        'target_username', coalesce(target_credentials.username_display, l.metadata->>'target_username'),
        'action', l.action,
        'reason', l.reason,
        'post_id', l.post_id,
        'created_at', l.created_at
      ) order by l.created_at desc)
      from public.admin_audit_logs l
      join auth.users admin_user on admin_user.id = l.admin_user_id
      left join auth.users target_user on target_user.id = l.target_user_id
      left join public.username_credentials target_credentials on target_credentials.user_id = l.target_user_id
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.admin_dashboard() from public, anon;
grant execute on function public.admin_dashboard() to authenticated, service_role;
