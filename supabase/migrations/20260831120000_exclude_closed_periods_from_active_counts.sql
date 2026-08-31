alter table public.posts
  add column if not exists counting_excluded boolean not null default false,
  add column if not exists counting_cleanup_id bigint;

comment on column public.posts.counting_excluded is
  'True while the publication belongs to a closed period and must stay outside active metrics, goals and rankings.';

comment on column public.posts.counting_cleanup_id is
  'Durable link to the closed-period counting state. It remains valid even if the visible archive is deleted.';

alter table private.closed_period_post_cleanups
  add column if not exists counting_reopened_at timestamp with time zone,
  add column if not exists counting_reopened_by uuid,
  add column if not exists counting_reopened_posts integer not null default 0;

alter table public.posts
  drop constraint if exists posts_counting_cleanup_id_fkey,
  add constraint posts_counting_cleanup_id_fkey
    foreign key (counting_cleanup_id)
    references private.closed_period_post_cleanups(id);

alter table private.closed_period_post_cleanups
  drop constraint if exists closed_period_counting_reopened_by_fkey,
  add constraint closed_period_counting_reopened_by_fkey
    foreign key (counting_reopened_by)
    references auth.users(id)
    on delete set null,
  drop constraint if exists closed_period_counting_reopened_posts_check,
  add constraint closed_period_counting_reopened_posts_check
    check (counting_reopened_posts >= 0);

create index if not exists posts_active_counting_user_date_idx
  on public.posts (user_id, published_at, id)
  where not counting_excluded;

create index if not exists posts_counting_cleanup_idx
  on public.posts (counting_cleanup_id)
  where counting_cleanup_id is not null;

create index if not exists closed_period_active_counting_idx
  on private.closed_period_post_cleanups (user_id, period_start, period_end)
  where counting_reopened_at is null;

create or replace function private.protect_post_counting_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.closed_period_internal', true), '') = 'true' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.counting_excluded := false;
    new.counting_cleanup_id := null;
    return new;
  end if;

  if old.counting_excluded is distinct from new.counting_excluded
     or old.counting_cleanup_id is distinct from new.counting_cleanup_id then
    raise exception 'POST_COUNTING_STATE_PROTECTED' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_post_counting_state on public.posts;
create trigger protect_post_counting_state
before insert or update of counting_excluded, counting_cleanup_id on public.posts
for each row execute function private.protect_post_counting_state();

create or replace function private.sync_post_counting_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post_date date;
  v_cleanup_id bigint;
begin
  if coalesce(current_setting('app.closed_period_internal', true), '') = 'true' then
    return new;
  end if;

  v_post_date := coalesce(
    (new.x_published_at at time zone 'America/Sao_Paulo')::date,
    new.published_at,
    (new.created_at at time zone 'America/Sao_Paulo')::date
  );

  select cleanup.id
  into v_cleanup_id
  from private.closed_period_post_cleanups cleanup
  where cleanup.user_id = new.user_id
    and cleanup.counting_reopened_at is null
    and v_post_date between cleanup.period_start and cleanup.period_end
  order by cleanup.closed_at desc, cleanup.id desc
  limit 1;

  new.counting_cleanup_id := v_cleanup_id;
  new.counting_excluded := v_cleanup_id is not null;
  return new;
end;
$$;

drop trigger if exists zzzz_sync_post_counting_state on public.posts;
create trigger zzzz_sync_post_counting_state
before insert or update of user_id, post_url, x_published_at, published_at on public.posts
for each row execute function private.sync_post_counting_state();

create or replace function public.guard_closed_mission_period()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_user uuid;
  target_date date;
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('app.closed_period_internal', true), '') = 'true' then
    return new;
  end if;

  target_user := coalesce(new.user_id, old.user_id);
  target_date := coalesce(new.published_at, old.published_at);
  if exists (
    select 1 from public.mission_periods p
    where p.user_id = target_user
      and p.month = date_trunc('month', target_date)::date
      and p.status = 'closed'
  ) then
    raise exception 'Este período está fechado. Reabra o período para alterar publicações.';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function private.sync_ranking_after_post_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.closed_period_internal', true), '') = 'true' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    perform private.recalculate_monthly_ranking(old.user_id, now());
    return old;
  end if;

  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform private.recalculate_monthly_ranking(old.user_id, now());
  end if;

  perform private.recalculate_monthly_ranking(new.user_id, now());
  return new;
end;
$$;

create or replace function private.enforce_monthly_post_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  goal integer;
  current_count integer;
  target_instant timestamptz;
  target_month date;
  target_date date;
  v_cleanup_id bigint;
begin
  target_instant := coalesce(
    new.x_published_at,
    new.published_at::timestamp at time zone 'America/Sao_Paulo',
    new.created_at,
    now()
  );
  target_date := (target_instant at time zone 'America/Sao_Paulo')::date;
  target_month := date_trunc('month', target_date)::date;

  select cleanup.id
  into v_cleanup_id
  from private.closed_period_post_cleanups cleanup
  where cleanup.user_id = new.user_id
    and cleanup.counting_reopened_at is null
    and target_date between cleanup.period_start and cleanup.period_end
  order by cleanup.closed_at desc, cleanup.id desc
  limit 1;

  if v_cleanup_id is not null then
    new.counting_excluded := true;
    new.counting_cleanup_id := v_cleanup_id;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || target_month::text, 0)
  );

  select greatest(1, coalesce(s.monthly_post_goal, 60))
  into goal
  from public.user_settings s
  where s.user_id = new.user_id;

  goal := coalesce(goal, 60);

  select count(*)::integer
  into current_count
  from public.posts p
  where p.user_id = new.user_id
    and not p.counting_excluded
    and date_trunc(
      'month',
      coalesce(
        p.x_published_at,
        p.published_at::timestamp at time zone 'America/Sao_Paulo',
        p.created_at
      ) at time zone 'America/Sao_Paulo'
    )::date = target_month;

  if current_count >= goal then
    raise exception using
      errcode = 'P0001',
      message = 'MONTHLY_POST_LIMIT_REACHED',
      detail = format(
        'A meta mensal de %s publicações já foi atingida para %s.',
        goal,
        to_char(target_month, 'YYYY-MM')
      );
  end if;

  return new;
end;
$$;

create or replace function private.recalculate_monthly_ranking(
  target_user uuid,
  at_time timestamp with time zone default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_today date := (at_time at time zone 'America/Sao_Paulo')::date;
  cycle_month date;
  next_month date;
  participant boolean := false;
  profile_name text;
  blocked boolean := false;
  total_posts integer := 0;
  total_views bigint := 0;
  total_likes bigint := 0;
  total_special bigint := 0;
  view_bonus bigint := 0;
  total_crystalgin bigint := 0;
begin
  if target_user is null then
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(73201, pg_catalog.hashtext(target_user::text));

  if extract(day from local_today) = 1 then
    return;
  end if;

  cycle_month := pg_catalog.date_trunc('month', local_today)::date;
  next_month := (cycle_month + interval '1 month')::date;

  select
    coalesce(settings.ranking_opt_in, false)
      and coalesce(settings.profile_name_confirmed, false),
    nullif(pg_catalog.btrim(settings.app_name), '')
  into participant, profile_name
  from public.user_settings settings
  where settings.user_id = target_user;

  if not found or not participant or profile_name is null then
    delete from public.monthly_rankings
    where user_id = target_user
      and month = cycle_month;
    return;
  end if;

  select exists (
    select 1
    from public.user_moderation moderation
    where moderation.user_id = target_user
      and (coalesce(moderation.ranking_blocked, false) or coalesce(moderation.suspended, false))
  ) into blocked;

  select
    count(*)::integer,
    coalesce(sum(coalesce(posts.views, 0)), 0)::bigint,
    coalesce(sum(coalesce(posts.likes, 0)), 0)::bigint,
    coalesce(sum(coalesce(posts.special_reward, 0)), 0)::bigint
  into total_posts, total_views, total_likes, total_special
  from public.posts posts
  where posts.user_id = target_user
    and not posts.counting_excluded
    and coalesce(posts.admin_eligible, true)
    and (coalesce(posts.x_published_at, posts.created_at) at time zone 'America/Sao_Paulo')::date >= cycle_month
    and (coalesce(posts.x_published_at, posts.created_at) at time zone 'America/Sao_Paulo')::date < next_month;

  view_bonus := case
    when total_posts = 0 then 0
    when total_views <= 1000 then 250
    when total_views <= 3000 then 750
    when total_views <= 5000 then 1250
    when total_views <= 8000 then 2000
    when total_views <= 10000 then 2500
    when total_views <= 15000 then 3750
    when total_views <= 20000 then 5000
    when total_views <= 25000 then 6250
    when total_views <= 30000 then 7500
    else 12500
  end;

  total_crystalgin := (case when total_posts >= 10 then 800 else 0 end)
    + view_bonus
    + total_likes * 2
    + total_special;

  insert into public.monthly_rankings (
    user_id, month, x_handle, crystalgin, likes, posts_count,
    total_views, published, updated_at
  ) values (
    target_user, cycle_month, profile_name, total_crystalgin, total_likes,
    total_posts, total_views, not blocked, at_time
  )
  on conflict (user_id, month) do update set
    x_handle = excluded.x_handle,
    crystalgin = excluded.crystalgin,
    likes = excluded.likes,
    posts_count = excluded.posts_count,
    total_views = excluded.total_views,
    published = excluded.published,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.close_period(
  p_period_start date,
  p_period_end date
)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_posts jsonb;
  v_posts_count integer;
  v_views bigint;
  v_likes bigint;
  v_reposts bigint;
  v_comments bigint;
  v_special bigint;
  v_base bigint;
  v_views_reward bigint;
  v_engagement_reward bigint;
  v_raw bigint;
  v_limit integer := 30000;
  v_total bigint;
  v_archive_id bigint;
  v_cleanup_id bigint;
  v_marked integer;
begin
  if v_actor is null then
    raise exception 'ARCHIVED_PERIOD_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_period_start is null
     or p_period_end is null
     or p_period_end < p_period_start
     or p_period_end > v_today then
    raise exception 'ARCHIVED_PERIOD_INVALID_DATES' using errcode = '22007';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(82431, pg_catalog.hashtext(v_actor::text));

  if exists (
    select 1
    from private.closed_period_post_cleanups cleanup
    where cleanup.user_id = v_actor
      and cleanup.counting_reopened_at is null
      and daterange(cleanup.period_start, cleanup.period_end, '[]')
        && daterange(p_period_start, p_period_end, '[]')
  ) then
    raise exception 'ARCHIVED_PERIOD_ALREADY_CLOSED' using errcode = 'P0001';
  end if;

  select
    coalesce(jsonb_agg(to_jsonb(p) order by
      coalesce(
        (p.x_published_at at time zone 'America/Sao_Paulo')::date,
        p.published_at,
        (p.created_at at time zone 'America/Sao_Paulo')::date
      ),
      p.id
    ), '[]'::jsonb),
    count(*)::integer,
    coalesce(sum(p.views), 0)::bigint,
    coalesce(sum(p.likes), 0)::bigint,
    coalesce(sum(p.reposts), 0)::bigint,
    coalesce(sum(p.comments), 0)::bigint,
    coalesce(sum(p.special_reward), 0)::bigint
  into
    v_posts, v_posts_count, v_views, v_likes, v_reposts, v_comments, v_special
  from public.posts p
  where p.user_id = v_actor
    and not p.counting_excluded
    and coalesce(
      (p.x_published_at at time zone 'America/Sao_Paulo')::date,
      p.published_at,
      (p.created_at at time zone 'America/Sao_Paulo')::date
    ) between p_period_start and p_period_end;

  if v_posts_count = 0 then
    raise exception 'ARCHIVED_PERIOD_EMPTY' using errcode = 'P0001';
  end if;

  v_base := case when v_posts_count >= 10 then 800 else 0 end;
  v_views_reward := case
    when v_views <= 1000 then 250
    when v_views <= 3000 then 750
    when v_views <= 5000 then 1250
    when v_views <= 8000 then 2000
    when v_views <= 10000 then 2500
    when v_views <= 15000 then 3750
    when v_views <= 20000 then 5000
    when v_views <= 25000 then 6250
    when v_views <= 30000 then 7500
    else 12500
  end;
  v_engagement_reward := v_likes * 2;
  v_raw := v_base + v_views_reward + v_engagement_reward + v_special;

  select case when s.cap_unlocked then s.crystalgin_limit else 30000 end
  into v_limit
  from public.user_settings s
  where s.user_id = v_actor;

  v_limit := coalesce(v_limit, 30000);
  v_total := least(v_raw, v_limit);

  insert into public.archived_periods (
    user_id, month, period_start, period_end, summary, posts_snapshot
  ) values (
    v_actor,
    date_trunc('month', p_period_start)::date,
    p_period_start,
    p_period_end,
    jsonb_build_object(
      'total', v_total,
      'total_raw', v_raw,
      'crystalgin_limit', v_limit,
      'posts', v_posts_count,
      'views', v_views,
      'likes', v_likes,
      'reposts', v_reposts,
      'comments', v_comments,
      'base', v_base,
      'viewsReward', v_views_reward,
      'engagementReward', v_engagement_reward,
      'special', v_special
    ),
    v_posts
  ) returning id into v_archive_id;

  select cleanup.id
  into v_cleanup_id
  from private.closed_period_post_cleanups cleanup
  where cleanup.archive_id = v_archive_id;

  if v_cleanup_id is null then
    raise exception 'ARCHIVED_PERIOD_COUNTING_STATE_FAILED' using errcode = 'P0001';
  end if;

  perform set_config('app.closed_period_internal', 'true', true);
  update public.posts p
  set counting_excluded = true,
      counting_cleanup_id = v_cleanup_id
  where p.user_id = v_actor
    and not p.counting_excluded
    and coalesce(
      (p.x_published_at at time zone 'America/Sao_Paulo')::date,
      p.published_at,
      (p.created_at at time zone 'America/Sao_Paulo')::date
    ) between p_period_start and p_period_end;

  get diagnostics v_marked = row_count;
  if v_marked <> v_posts_count then
    raise exception 'ARCHIVED_PERIOD_COUNTING_STATE_MISMATCH' using errcode = '40001';
  end if;

  perform private.recalculate_monthly_ranking(v_actor, now());
  return v_archive_id;
exception
  when unique_violation then
    raise exception 'ARCHIVED_PERIOD_DUPLICATE' using errcode = '23505';
end;
$$;

create or replace function public.admin_closed_period_counting_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if not private.is_admin(v_actor) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', cleanup.id,
      'counting_active', cleanup.counting_reopened_at is null,
      'counting_reopened_at', cleanup.counting_reopened_at,
      'counting_reopened_by', cleanup.counting_reopened_by,
      'counting_reopened_posts', cleanup.counting_reopened_posts,
      'counting_excluded_posts', (
        select count(*)::integer
        from public.posts post
        where post.counting_cleanup_id = cleanup.id
          and post.counting_excluded
      )
    ) order by cleanup.closed_at desc, cleanup.id desc)
    from private.closed_period_post_cleanups cleanup
  ), '[]'::jsonb);
end;
$$;

create or replace function public.admin_reopen_closed_period_verified(
  p_actor uuid,
  p_cleanup_id bigint,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleanup private.closed_period_post_cleanups%rowtype;
  v_reopened integer := 0;
begin
  if not private.is_admin(p_actor) then
    raise exception 'Administrative access required' using errcode = '42501';
  end if;

  if p_reason is null or char_length(trim(p_reason)) < 3 or char_length(trim(p_reason)) > 500 then
    raise exception 'Administrative reason must contain between 3 and 500 characters';
  end if;

  select cleanup.*
  into v_cleanup
  from private.closed_period_post_cleanups cleanup
  where cleanup.id = p_cleanup_id
  for update;

  if not found then
    raise exception 'CLOSED_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_cleanup.counting_reopened_at is not null then
    raise exception 'CLOSED_PERIOD_ALREADY_REOPENED' using errcode = 'P0001';
  end if;

  perform set_config('app.closed_period_internal', 'true', true);
  update public.posts post
  set counting_excluded = false,
      counting_cleanup_id = null
  where post.counting_cleanup_id = p_cleanup_id
    and post.counting_excluded;

  get diagnostics v_reopened = row_count;

  update private.closed_period_post_cleanups
  set counting_reopened_at = now(),
      counting_reopened_by = p_actor,
      counting_reopened_posts = v_reopened,
      retention_days = null,
      delete_after = null,
      last_error = null,
      updated_at = now()
  where id = p_cleanup_id;

  delete from public.archived_periods archive
  where archive.id = v_cleanup.archive_id
    and archive.user_id = v_cleanup.user_id;

  insert into public.admin_audit_logs (
    admin_user_id, target_user_id, action, reason, metadata
  ) values (
    p_actor,
    v_cleanup.user_id,
    'reopen_closed_period',
    trim(p_reason),
    jsonb_build_object(
      'cleanup_id', p_cleanup_id,
      'period_start', v_cleanup.period_start,
      'period_end', v_cleanup.period_end,
      'reopened_posts', v_reopened,
      'password_verified', true
    )
  );

  perform private.recalculate_monthly_ranking(v_cleanup.user_id, now());
  return v_reopened;
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
    'update_account_access','reopen_closed_period'
  ]));

revoke all on function private.protect_post_counting_state() from public, anon, authenticated;
revoke all on function private.sync_post_counting_state() from public, anon, authenticated;
revoke all on function public.admin_closed_period_counting_status() from public, anon;
grant execute on function public.admin_closed_period_counting_status() to authenticated;
revoke all on function public.admin_reopen_closed_period_verified(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.admin_reopen_closed_period_verified(uuid, bigint, text) to service_role;

select set_config('app.closed_period_internal', 'true', true);

with selected_cleanup as (
  select
    post.id as post_id,
    (
      select cleanup.id
      from private.closed_period_post_cleanups cleanup
      where cleanup.user_id = post.user_id
        and cleanup.counting_reopened_at is null
        and coalesce(
          (post.x_published_at at time zone 'America/Sao_Paulo')::date,
          post.published_at,
          (post.created_at at time zone 'America/Sao_Paulo')::date
        ) between cleanup.period_start and cleanup.period_end
      order by cleanup.closed_at desc, cleanup.id desc
      limit 1
    ) as cleanup_id
  from public.posts post
)
update public.posts post
set counting_excluded = selected_cleanup.cleanup_id is not null,
    counting_cleanup_id = selected_cleanup.cleanup_id
from selected_cleanup
where selected_cleanup.post_id = post.id
  and selected_cleanup.cleanup_id is not null;

do $$
declare
  affected_user uuid;
begin
  for affected_user in
    select distinct cleanup.user_id
    from private.closed_period_post_cleanups cleanup
    where cleanup.counting_reopened_at is null
  loop
    perform private.recalculate_monthly_ranking(affected_user, now());
  end loop;
end;
$$;

