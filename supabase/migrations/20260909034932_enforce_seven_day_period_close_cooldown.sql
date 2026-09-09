create table private.period_close_cooldowns (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_closed_at timestamptz not null,
  next_allowed_at timestamptz not null,
  reset_at timestamptz,
  reset_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint period_close_cooldown_dates_valid check (next_allowed_at >= last_closed_at)
);

comment on table private.period_close_cooldowns is
  'Durable seven-day cooldown for closing periods, isolated from the Data API.';

alter table private.period_close_cooldowns enable row level security;
revoke all on table private.period_close_cooldowns from public, anon, authenticated, service_role;

create index period_close_cooldowns_next_allowed_idx
  on private.period_close_cooldowns (next_allowed_at);

insert into private.period_close_cooldowns (user_id, last_closed_at, next_allowed_at, updated_at)
select
  cleanup.user_id,
  max(cleanup.closed_at),
  max(cleanup.closed_at) + interval '7 days',
  now()
from private.closed_period_post_cleanups cleanup
group by cleanup.user_id
on conflict (user_id) do nothing;

create or replace function private.enforce_period_close_cooldown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_next_allowed_at timestamptz;
begin
  if v_actor is null or new.user_id <> v_actor then
    raise exception 'ARCHIVED_PERIOD_AUTH_REQUIRED' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(82431, pg_catalog.hashtext(new.user_id::text));

  select cooldown.next_allowed_at
  into v_next_allowed_at
  from private.period_close_cooldowns cooldown
  where cooldown.user_id = new.user_id
  for update;

  if v_next_allowed_at is not null and v_next_allowed_at > clock_timestamp() then
    raise exception 'ARCHIVED_PERIOD_COOLDOWN:%',
      floor(extract(epoch from v_next_allowed_at))::bigint
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function private.record_period_close_cooldown()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed_at timestamptz := clock_timestamp();
begin
  insert into private.period_close_cooldowns (
    user_id, last_closed_at, next_allowed_at, reset_at, reset_by, updated_at
  ) values (
    new.user_id, v_closed_at, v_closed_at + interval '7 days', null, null, v_closed_at
  )
  on conflict (user_id) do update set
    last_closed_at = excluded.last_closed_at,
    next_allowed_at = excluded.next_allowed_at,
    reset_at = null,
    reset_by = null,
    updated_at = excluded.updated_at;

  return new;
end;
$$;

drop trigger if exists enforce_period_close_cooldown on public.archived_periods;
create trigger enforce_period_close_cooldown
before insert on public.archived_periods
for each row execute function private.enforce_period_close_cooldown();

drop trigger if exists record_period_close_cooldown on public.archived_periods;
create trigger record_period_close_cooldown
after insert on public.archived_periods
for each row execute function private.record_period_close_cooldown();

revoke all on function private.enforce_period_close_cooldown()
from public, anon, authenticated, service_role;
revoke all on function private.record_period_close_cooldown()
from public, anon, authenticated, service_role;

