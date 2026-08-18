alter table public.archived_periods
  add column if not exists period_start date,
  add column if not exists period_end date,
  add column if not exists expires_at timestamp with time zone;

update public.archived_periods
set period_start = coalesce(period_start, month),
    period_end = coalesce(period_end, (date_trunc('month', month) + interval '1 month - 1 day')::date),
    expires_at = coalesce(expires_at, archived_at + interval '40 days');

alter table public.archived_periods
  alter column period_start set not null,
  alter column period_end set not null,
  alter column expires_at set not null,
  alter column expires_at set default (now() + interval '40 days');

alter table public.archived_periods
  drop constraint if exists archived_periods_valid_period,
  add constraint archived_periods_valid_period check (period_end >= period_start),
  drop constraint if exists archived_periods_user_period_key,
  add constraint archived_periods_user_period_key unique (user_id, period_start, period_end);

create index if not exists archived_periods_user_period_idx
  on public.archived_periods (user_id, period_start desc, period_end desc);

create index if not exists archived_periods_expiration_idx
  on public.archived_periods (expires_at);

create or replace function private.set_archived_period_values()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.period_start := coalesce(new.period_start, new.month, (now() at time zone 'America/Sao_Paulo')::date);
  new.period_end := coalesce(new.period_end, (date_trunc('month', new.period_start) + interval '1 month - 1 day')::date);
  new.archived_at := now();
  new.expires_at := new.archived_at + interval '40 days';
  new.month := date_trunc('month', new.period_start)::date;
  return new;
end;
$$;

drop trigger if exists set_archived_period_values on public.archived_periods;
create trigger set_archived_period_values
before insert on public.archived_periods
for each row execute function private.set_archived_period_values();

drop policy if exists "account must be active" on public.archived_periods;
drop policy if exists "archives own select" on public.archived_periods;
drop policy if exists "archives own insert" on public.archived_periods;
drop policy if exists "archives own update" on public.archived_periods;
drop policy if exists "archives own delete" on public.archived_periods;

create policy "archives own active select"
on public.archived_periods
for select
to authenticated
using (
  (select auth.uid()) = user_id
  and private.account_active((select auth.uid()))
  and expires_at > now()
);

create policy "archives own active insert"
on public.archived_periods
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and private.account_active((select auth.uid()))
);

create policy "archives own active delete"
on public.archived_periods
for delete
to authenticated
using (
  (select auth.uid()) = user_id
  and private.account_active((select auth.uid()))
);

revoke update on table public.archived_periods from anon, authenticated;
grant select, insert, delete on table public.archived_periods to authenticated;
grant usage, select on sequence public.archived_periods_id_seq to authenticated;

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
    v_posts,
    v_posts_count,
    v_views,
    v_likes,
    v_reposts,
    v_comments,
    v_special
  from public.posts p
  where p.user_id = v_actor
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
    user_id,
    month,
    period_start,
    period_end,
    summary,
    posts_snapshot
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
  )
  returning id into v_archive_id;

  return v_archive_id;
exception
  when unique_violation then
    raise exception 'ARCHIVED_PERIOD_DUPLICATE' using errcode = '23505';
end;
$$;

revoke all on function public.close_period(date, date) from public, anon;
grant execute on function public.close_period(date, date) to authenticated;

create or replace function private.delete_expired_archived_periods()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.archived_periods
  where expires_at <= now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function private.set_archived_period_values() from public, anon, authenticated;
revoke all on function private.delete_expired_archived_periods() from public, anon, authenticated;
grant execute on function private.delete_expired_archived_periods() to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'expired-archived-periods-cleanup';

select cron.schedule(
  'expired-archived-periods-cleanup',
  '30 3 * * *',
  'select private.delete_expired_archived_periods();'
);

