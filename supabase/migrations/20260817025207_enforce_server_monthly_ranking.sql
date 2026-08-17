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

  -- Serialize recalculations for the same account so concurrent post updates
  -- cannot overwrite a newer ranking total with an older one.
  perform pg_catalog.pg_advisory_xact_lock(73201, pg_catalog.hashtext(target_user::text));

  -- Day 1 is the exhibition day for the previous, frozen month.
  if extract(day from local_today) = 1 then
    return;
  end if;

  cycle_month := pg_catalog.date_trunc('month', local_today)::date;
  next_month := (cycle_month + interval '1 month')::date;

  select
    coalesce(settings.ranking_opt_in, false),
    coalesce(
      nullif(pg_catalog.btrim(settings.app_name), ''),
      nullif(pg_catalog.btrim(settings.x_handle), '')
    )
  into participant, profile_name
  from public.user_settings as settings
  where settings.user_id = target_user;

  if not found or not participant or profile_name is null then
    delete from public.monthly_rankings
    where user_id = target_user
      and month = cycle_month;
    return;
  end if;

  select exists (
    select 1
    from public.user_moderation as moderation
    where moderation.user_id = target_user
      and (coalesce(moderation.ranking_blocked, false) or coalesce(moderation.suspended, false))
  ) into blocked;

  select
    count(*)::integer,
    coalesce(sum(coalesce(posts.views, 0)), 0)::bigint,
    coalesce(sum(coalesce(posts.likes, 0)), 0)::bigint,
    coalesce(sum(coalesce(posts.special_reward, 0)), 0)::bigint
  into total_posts, total_views, total_likes, total_special
  from public.posts as posts
  where posts.user_id = target_user
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
    user_id,
    month,
    x_handle,
    crystalgin,
    likes,
    posts_count,
    total_views,
    published,
    updated_at
  ) values (
    target_user,
    cycle_month,
    profile_name,
    total_crystalgin,
    total_likes,
    total_posts,
    total_views,
    not blocked,
    at_time
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

revoke all on function private.recalculate_monthly_ranking(uuid, timestamp with time zone) from public;
revoke all on function private.recalculate_monthly_ranking(uuid, timestamp with time zone) from anon;
revoke all on function private.recalculate_monthly_ranking(uuid, timestamp with time zone) from authenticated;

create or replace function public.sync_my_monthly_ranking()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'not authorized';
  end if;

  perform private.recalculate_monthly_ranking(actor, now());
  return true;
end;
$$;

revoke all on function public.sync_my_monthly_ranking() from public;
revoke all on function public.sync_my_monthly_ranking() from anon;
grant execute on function public.sync_my_monthly_ranking() to authenticated;

create or replace function public.refresh_current_rankings()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  local_today date := (now() at time zone 'America/Sao_Paulo')::date;
  account record;
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'not authorized';
  end if;

  if extract(day from local_today) = 1 then
    return true;
  end if;

  for account in
    select settings.user_id
    from public.user_settings as settings
    union
    select ranking.user_id
    from public.monthly_rankings as ranking
    where ranking.month = pg_catalog.date_trunc('month', local_today)::date
  loop
    perform private.recalculate_monthly_ranking(account.user_id, now());
  end loop;

  return true;
end;
$$;

revoke all on function public.refresh_current_rankings() from public;
revoke all on function public.refresh_current_rankings() from anon;
grant execute on function public.refresh_current_rankings() to authenticated;

create or replace function public.ranking_access_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  global_control boolean := false;
  individual_control boolean := false;
  blocked boolean := false;
begin
  if actor is null or not private.account_active(actor) then
    raise exception 'not authorized';
  end if;

  select coalesce((
    select controls.ranking_self_service_enabled
    from public.app_controls as controls
    where controls.id = 1
  ), false)
  into global_control;

  select
    coalesce((
      select moderation.ranking_control_unlocked
      from public.user_moderation as moderation
      where moderation.user_id = actor
    ), false),
    coalesce((
      select moderation.ranking_blocked
      from public.user_moderation as moderation
      where moderation.user_id = actor
    ), false)
  into individual_control, blocked;

  return pg_catalog.jsonb_build_object(
    'can_choose', global_control or individual_control,
    'blocked', blocked,
    'self_service_enabled', global_control,
    'individual_unlocked', individual_control
  );
end;
$$;

revoke all on function public.ranking_access_state() from public;
revoke all on function public.ranking_access_state() from anon;
grant execute on function public.ranking_access_state() to authenticated;

create or replace function private.sync_ranking_after_post_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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

revoke all on function private.sync_ranking_after_post_change() from public;
revoke all on function private.sync_ranking_after_post_change() from anon;
revoke all on function private.sync_ranking_after_post_change() from authenticated;

drop trigger if exists sync_monthly_ranking_after_post_change on public.posts;
create trigger sync_monthly_ranking_after_post_change
after insert or update or delete on public.posts
for each row execute function private.sync_ranking_after_post_change();

create or replace function private.sync_ranking_after_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform private.recalculate_monthly_ranking(old.user_id, now());
  end if;

  perform private.recalculate_monthly_ranking(new.user_id, now());
  return new;
end;
$$;

revoke all on function private.sync_ranking_after_settings_change() from public;
revoke all on function private.sync_ranking_after_settings_change() from anon;
revoke all on function private.sync_ranking_after_settings_change() from authenticated;

drop trigger if exists sync_monthly_ranking_after_settings_change on public.user_settings;
create trigger sync_monthly_ranking_after_settings_change
after insert or update of ranking_opt_in, app_name, x_handle on public.user_settings
for each row execute function private.sync_ranking_after_settings_change();

create or replace function private.sync_ranking_after_moderation_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.recalculate_monthly_ranking(new.user_id, now());
  return new;
end;
$$;

revoke all on function private.sync_ranking_after_moderation_change() from public;
revoke all on function private.sync_ranking_after_moderation_change() from anon;
revoke all on function private.sync_ranking_after_moderation_change() from authenticated;

drop trigger if exists sync_monthly_ranking_after_moderation_change on public.user_moderation;
create trigger sync_monthly_ranking_after_moderation_change
after insert or update of ranking_blocked, suspended on public.user_moderation
for each row execute function private.sync_ranking_after_moderation_change();

revoke insert, update, delete on public.monthly_rankings from authenticated;
grant select on public.monthly_rankings to authenticated;

drop policy if exists "account must be active" on public.monthly_rankings;
drop policy if exists "rank authenticated read" on public.monthly_rankings;
drop policy if exists "rank own delete" on public.monthly_rankings;
drop policy if exists "rank own insert" on public.monthly_rankings;
drop policy if exists "rank own update" on public.monthly_rankings;
drop policy if exists "ranking must be allowed insert" on public.monthly_rankings;
drop policy if exists "ranking must be allowed update" on public.monthly_rankings;

create policy "ranking authenticated read"
on public.monthly_rankings
for select
to authenticated
using (
  private.account_active((select auth.uid()))
  and (published or user_id = (select auth.uid()))
);

drop policy if exists "account must be active" on public.user_settings;
drop policy if exists "ranking preference locked insert" on public.user_settings;
drop policy if exists "ranking preference locked update" on public.user_settings;
drop policy if exists "settings own insert" on public.user_settings;
drop policy if exists "settings own select" on public.user_settings;
drop policy if exists "settings own update" on public.user_settings;

create policy "settings own active select"
on public.user_settings
for select
to authenticated
using (
  user_id = (select auth.uid())
  and private.account_active((select auth.uid()))
);

create policy "settings own active insert"
on public.user_settings
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and private.account_active((select auth.uid()))
  and (
    private.ranking_control_unlocked((select auth.uid()))
    or coalesce(ranking_opt_in, false)
  )
);

create policy "settings own active update"
on public.user_settings
for update
to authenticated
using (
  user_id = (select auth.uid())
  and private.account_active((select auth.uid()))
)
with check (
  user_id = (select auth.uid())
  and private.account_active((select auth.uid()))
  and (
    private.ranking_control_unlocked((select auth.uid()))
    or coalesce(ranking_opt_in, false)
  )
);

do $$
declare
  account record;
begin
  if extract(day from (now() at time zone 'America/Sao_Paulo')::date) <> 1 then
    for account in
      select settings.user_id
      from public.user_settings as settings
      union
      select ranking.user_id
      from public.monthly_rankings as ranking
      where ranking.month = pg_catalog.date_trunc(
        'month',
        (now() at time zone 'America/Sao_Paulo')::date
      )::date
    loop
      perform private.recalculate_monthly_ranking(account.user_id, now());
    end loop;
  end if;
end;
$$;



