create or replace function private.capture_closed_period_post_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_enabled boolean := false;
  v_days integer := 40;
  v_cleanup_id bigint;
  v_expected integer;
  v_marked integer;
begin
  if v_actor is null or new.user_id is distinct from v_actor then
    raise exception 'ARCHIVED_PERIOD_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if new.period_start is null
     or new.period_end is null
     or new.period_end < new.period_start
     or new.period_end > v_today then
    raise exception 'ARCHIVED_PERIOD_INVALID_DATES' using errcode = '22007';
  end if;

  if jsonb_typeof(new.posts_snapshot) is distinct from 'array'
     or coalesce(new.summary->>'posts', '') !~ '^[0-9]+$' then
    raise exception 'ARCHIVED_PERIOD_COUNTING_STATE_MISMATCH' using errcode = '40001';
  end if;

  v_expected := (new.summary->>'posts')::integer;
  if v_expected <= 0 or jsonb_array_length(new.posts_snapshot) <> v_expected then
    raise exception 'ARCHIVED_PERIOD_COUNTING_STATE_MISMATCH' using errcode = '40001';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    82431,
    pg_catalog.hashtext(new.user_id::text)
  );

  if exists (
    select 1
    from private.closed_period_post_cleanups cleanup
    where cleanup.user_id = new.user_id
      and cleanup.counting_reopened_at is null
      and daterange(cleanup.period_start, cleanup.period_end, '[]')
        && daterange(new.period_start, new.period_end, '[]')
  ) then
    raise exception 'ARCHIVED_PERIOD_ALREADY_CLOSED' using errcode = 'P0001';
  end if;

  select settings.auto_delete_enabled, settings.retention_days
  into v_enabled, v_days
  from private.closed_period_post_cleanup_settings settings
  where settings.id = 1;

  insert into private.closed_period_post_cleanups (
    archive_id,
    user_id,
    period_start,
    period_end,
    closed_at,
    retention_days,
    delete_after
  ) values (
    new.id,
    new.user_id,
    new.period_start,
    new.period_end,
    new.archived_at,
    case when coalesce(v_enabled, false) then coalesce(v_days, 40) else null end,
    case when coalesce(v_enabled, false)
      then new.archived_at + make_interval(days => coalesce(v_days, 40))
      else null
    end
  )
  returning id into v_cleanup_id;

  perform set_config('app.closed_period_internal', 'true', true);
  update public.posts post
  set counting_excluded = true,
      counting_cleanup_id = v_cleanup_id
  where post.user_id = new.user_id
    and not post.counting_excluded
    and coalesce(
      (post.x_published_at at time zone 'America/Sao_Paulo')::date,
      post.published_at,
      (post.created_at at time zone 'America/Sao_Paulo')::date
    ) between new.period_start and new.period_end;

  get diagnostics v_marked = row_count;
  if v_marked <> v_expected then
    raise exception 'ARCHIVED_PERIOD_COUNTING_STATE_MISMATCH' using errcode = '40001';
  end if;

  perform private.recalculate_monthly_ranking(new.user_id, now());
  return new;
end;
$$;

revoke all on function private.capture_closed_period_post_cleanup()
from public, anon, authenticated, service_role;

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

  select
    coalesce(jsonb_agg(to_jsonb(post) order by
      coalesce(
        (post.x_published_at at time zone 'America/Sao_Paulo')::date,
        post.published_at,
        (post.created_at at time zone 'America/Sao_Paulo')::date
      ),
      post.id
    ), '[]'::jsonb),
    count(*)::integer,
    coalesce(sum(post.views), 0)::bigint,
    coalesce(sum(post.likes), 0)::bigint,
    coalesce(sum(post.reposts), 0)::bigint,
    coalesce(sum(post.comments), 0)::bigint,
    coalesce(sum(post.special_reward), 0)::bigint
  into
    v_posts, v_posts_count, v_views, v_likes, v_reposts, v_comments, v_special
  from public.posts post
  where post.user_id = v_actor
    and not post.counting_excluded
    and coalesce(
      (post.x_published_at at time zone 'America/Sao_Paulo')::date,
      post.published_at,
      (post.created_at at time zone 'America/Sao_Paulo')::date
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

  select case when settings.cap_unlocked then settings.crystalgin_limit else 30000 end
  into v_limit
  from public.user_settings settings
  where settings.user_id = v_actor;

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

  return v_archive_id;
exception
  when unique_violation then
    raise exception 'ARCHIVED_PERIOD_DUPLICATE' using errcode = '23505';
end;
$$;

revoke all on function public.close_period(date, date) from public, anon;
grant execute on function public.close_period(date, date) to authenticated, service_role;

comment on function public.close_period(date, date) is
  'Fecha um intervalo do usuário; o gatilho privado registra e exclui as publicações das contagens ativas de forma atômica.';

