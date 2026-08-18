-- Make the configured monthly post goal an authoritative insert limit.
-- Existing posts are intentionally left untouched.

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
begin
  target_instant := coalesce(
    new.x_published_at,
    new.published_at::timestamp at time zone 'America/Sao_Paulo',
    new.created_at,
    now()
  );
  target_month := date_trunc(
    'month',
    target_instant at time zone 'America/Sao_Paulo'
  )::date;

  -- Serialize inserts for the same user/month so concurrent bulk requests
  -- cannot both pass the count check and exceed the goal.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.user_id::text || ':' || target_month::text, 0)
  );

  select greatest(1, coalesce(s.monthly_post_goal, 60))
    into goal
  from public.user_settings as s
  where s.user_id = new.user_id;

  goal := coalesce(goal, 60);

  select count(*)::integer
    into current_count
  from public.posts as p
  where p.user_id = new.user_id
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

revoke all on function private.enforce_monthly_post_goal() from public;
revoke all on function private.enforce_monthly_post_goal() from anon;
revoke all on function private.enforce_monthly_post_goal() from authenticated;

drop trigger if exists zz_enforce_monthly_post_goal on public.posts;
create trigger zz_enforce_monthly_post_goal
before insert on public.posts
for each row
execute function private.enforce_monthly_post_goal();

comment on function private.enforce_monthly_post_goal() is
  'Prevents a user from inserting more posts than their monthly_post_goal, using the X publication month in America/Sao_Paulo.';

