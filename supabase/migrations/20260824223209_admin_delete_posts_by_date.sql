-- Allow administrators to preview and delete one user's publications inside
-- an explicit date range. The account, settings and archived snapshots remain.

alter table public.admin_audit_logs
  drop constraint if exists admin_audit_logs_action_check;

alter table public.admin_audit_logs
  add constraint admin_audit_logs_action_check check (action = any (array[
    'suspend',
    'reactivate',
    'block_ranking',
    'unblock_ranking',
    'unlock_ranking_control',
    'lock_ranking_control',
    'enable_global_ranking_control',
    'disable_global_ranking_control',
    'disqualify_post',
    'requalify_post',
    'configure_account_cleanup',
    'schedule_account_deletion',
    'cancel_account_deletion',
    'delete_inactive_account',
    'configure_google_sheets',
    'configure_closed_period_post_cleanup',
    'schedule_closed_period_post_cleanup',
    'cancel_closed_period_post_cleanup',
    'delete_closed_period_posts',
    'delete_user_posts_by_date'
  ]));

create or replace function public.admin_preview_user_posts_by_date(
  p_target_user uuid,
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_count integer;
begin
  if not private.is_admin(v_actor) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  if p_target_user is null or not exists (
    select 1 from auth.users user_account where user_account.id = p_target_user
  ) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_period_start is null
     or p_period_end is null
     or p_period_end < p_period_start
     or p_period_end > v_today then
    raise exception 'INVALID_PUBLICATION_DATE_RANGE' using errcode = '22007';
  end if;

  select count(*)::integer
  into v_count
  from public.posts post
  where post.user_id = p_target_user
    and coalesce(
      (post.x_published_at at time zone 'America/Sao_Paulo')::date,
      post.published_at,
      (post.created_at at time zone 'America/Sao_Paulo')::date
    ) between p_period_start and p_period_end;

  return jsonb_build_object(
    'count', v_count,
    'period_start', p_period_start,
    'period_end', p_period_end
  );
end;
$$;

create or replace function public.admin_delete_user_posts_by_date(
  p_target_user uuid,
  p_period_start date,
  p_period_end date,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_deleted integer := 0;
begin
  if not private.is_admin(v_actor) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  if p_target_user is null or not exists (
    select 1 from auth.users user_account where user_account.id = p_target_user
  ) then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_period_start is null
     or p_period_end is null
     or p_period_end < p_period_start
     or p_period_end > v_today then
    raise exception 'INVALID_PUBLICATION_DATE_RANGE' using errcode = '22007';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(trim(p_reason)) > 500 then
    raise exception 'Administrative reason must contain between 3 and 500 characters';
  end if;

  update public.admin_audit_logs audit
  set metadata = coalesce(audit.metadata, '{}'::jsonb)
      || jsonb_build_object('deleted_post_id', audit.post_id),
      post_id = null
  where audit.post_id in (
    select post.id
    from public.posts post
    where post.user_id = p_target_user
      and coalesce(
        (post.x_published_at at time zone 'America/Sao_Paulo')::date,
        post.published_at,
        (post.created_at at time zone 'America/Sao_Paulo')::date
      ) between p_period_start and p_period_end
  );

  delete from public.posts post
  where post.user_id = p_target_user
    and coalesce(
      (post.x_published_at at time zone 'America/Sao_Paulo')::date,
      post.published_at,
      (post.created_at at time zone 'America/Sao_Paulo')::date
    ) between p_period_start and p_period_end;

  get diagnostics v_deleted = row_count;

  if v_deleted < 1 then
    raise exception 'NO_POSTS_IN_RANGE' using errcode = 'P0001';
  end if;

  insert into public.admin_audit_logs (
    admin_user_id,
    target_user_id,
    action,
    reason,
    metadata
  ) values (
    v_actor,
    p_target_user,
    'delete_user_posts_by_date',
    trim(p_reason),
    jsonb_build_object(
      'period_start', p_period_start,
      'period_end', p_period_end,
      'deleted_posts', v_deleted,
      'date_source', 'x_original_sao_paulo'
    )
  );

  return v_deleted;
end;
$$;

revoke all on function public.admin_preview_user_posts_by_date(uuid, date, date) from public, anon;
revoke all on function public.admin_delete_user_posts_by_date(uuid, date, date, text) from public, anon;

grant execute on function public.admin_preview_user_posts_by_date(uuid, date, date) to authenticated;
grant execute on function public.admin_delete_user_posts_by_date(uuid, date, date, text) to authenticated;

