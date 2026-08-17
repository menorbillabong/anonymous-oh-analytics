create extension if not exists pg_net with schema extensions;

update public.user_settings
set refresh_interval = 0.5
where refresh_interval not in (0.5, 1, 3, 6, 12, 24);

alter table public.user_settings
  alter column refresh_interval set default 0.5;

alter table public.user_settings
  drop constraint if exists user_settings_refresh_interval_check;

alter table public.user_settings
  add constraint user_settings_refresh_interval_check
  check (refresh_interval in (0.5, 1, 3, 6, 12, 24));

create table if not exists private.automatic_refresh_config (
  id smallint primary key default 1 check (id = 1),
  secret_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.automatic_refresh_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  attempted integer not null default 0 check (attempted >= 0),
  succeeded integer not null default 0 check (succeeded >= 0),
  failed integer not null default 0 check (failed >= 0),
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  error_message text
);

create table if not exists private.automatic_refresh_claims (
  user_id uuid primary key references auth.users(id) on delete cascade,
  run_id uuid not null unique references private.automatic_refresh_runs(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists private.automatic_refresh_failures (
  post_id bigint primary key references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  error_count integer not null default 1 check (error_count > 0),
  retry_at timestamptz not null,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists automatic_refresh_failures_user_retry_idx
  on private.automatic_refresh_failures (user_id, retry_at);

create index if not exists automatic_refresh_runs_started_idx
  on private.automatic_refresh_runs (started_at desc);

revoke all on table private.automatic_refresh_config from public, anon, authenticated;
revoke all on table private.automatic_refresh_runs from public, anon, authenticated;
revoke all on table private.automatic_refresh_claims from public, anon, authenticated;
revoke all on table private.automatic_refresh_failures from public, anon, authenticated;

create or replace function public.validate_automatic_refresh_cron_secret(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    candidate is not null
    and length(candidate) >= 32
    and exists (
      select 1
      from private.automatic_refresh_config as config
      where config.id = 1
        and config.secret_hash = pg_catalog.encode(extensions.digest(candidate, 'sha256'), 'hex')
    );
$$;

create or replace function public.claim_due_automatic_refreshes(batch_limit integer default 2)
returns table (run_id uuid, user_id uuid, retry_post_ids bigint[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  setting record;
  new_run_id uuid;
  due_retry_ids bigint[];
begin
  update private.automatic_refresh_runs as run
  set
    finished_at = now(),
    status = 'failed',
    error_message = 'A execução anterior excedeu o tempo seguro.'
  from private.automatic_refresh_claims as claim
  where claim.run_id = run.id
    and claim.expires_at <= now()
    and run.status = 'running';

  delete from private.automatic_refresh_claims
  where expires_at <= now();

  delete from private.automatic_refresh_runs
  where started_at < now() - interval '30 days';

  for setting in
    select settings.user_id
    from public.user_settings as settings
    where settings.show_refresh_timer
      and (settings.next_refresh_at is null or settings.next_refresh_at <= now())
      and private.account_active(settings.user_id)
      and not exists (
        select 1
        from private.automatic_refresh_claims as active_claim
        where active_claim.user_id = settings.user_id
          and active_claim.expires_at > now()
      )
    order by settings.next_refresh_at asc nulls first, settings.user_id
    for update of settings skip locked
    limit greatest(1, least(coalesce(batch_limit, 2), 5))
  loop
    insert into private.automatic_refresh_runs (user_id)
    values (setting.user_id)
    returning id into new_run_id;

    insert into private.automatic_refresh_claims (user_id, run_id, expires_at)
    values (setting.user_id, new_run_id, now() + interval '10 minutes');

    update public.user_settings
    set next_refresh_at = now() + interval '10 minutes'
    where public.user_settings.user_id = setting.user_id;

    select array_agg(failure.post_id order by failure.post_id)
    into due_retry_ids
    from private.automatic_refresh_failures as failure
    where failure.user_id = setting.user_id
      and failure.retry_at <= now();

    run_id := new_run_id;
    user_id := setting.user_id;
    retry_post_ids := due_retry_ids;
    return next;
  end loop;
end;
$$;

create or replace function public.record_automatic_refresh_failure(
  target_user uuid,
  target_post bigint,
  error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_error_count integer;
  retry_minutes integer;
begin
  if not exists (
    select 1
    from public.posts as post
    where post.id = target_post
      and post.user_id = target_user
  ) then
    raise exception 'Publicação inválida para a atualização automática.';
  end if;

  select coalesce(failure.error_count, 0) + 1
  into next_error_count
  from private.automatic_refresh_failures as failure
  where failure.post_id = target_post;

  next_error_count := coalesce(next_error_count, 1);
  retry_minutes := least(60, (5 * power(2, least(next_error_count - 1, 4)))::integer);

  insert into private.automatic_refresh_failures (
    post_id,
    user_id,
    error_count,
    retry_at,
    last_error,
    updated_at
  )
  values (
    target_post,
    target_user,
    next_error_count,
    now() + make_interval(mins => retry_minutes),
    left(coalesce(error_message, 'Falha ao atualizar publicação.'), 500),
    now()
  )
  on conflict (post_id) do update
  set
    user_id = excluded.user_id,
    error_count = excluded.error_count,
    retry_at = excluded.retry_at,
    last_error = excluded.last_error,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.complete_automatic_refresh(
  target_run uuid,
  target_user uuid,
  attempted_count integer,
  succeeded_count integer,
  failed_count integer,
  account_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  earliest_retry timestamptz;
  final_status text;
  final_next_refresh timestamptz;
  safe_attempted integer := greatest(0, coalesce(attempted_count, 0));
  safe_succeeded integer := greatest(0, coalesce(succeeded_count, 0));
  safe_failed integer := greatest(0, coalesce(failed_count, 0));
begin
  delete from private.automatic_refresh_claims as claim
  where claim.run_id = target_run
    and claim.user_id = target_user;

  if not found then
    raise exception 'Execução automática não encontrada ou expirada.';
  end if;

  select min(failure.retry_at)
  into earliest_retry
  from private.automatic_refresh_failures as failure
  where failure.user_id = target_user;

  if nullif(btrim(coalesce(account_error, '')), '') is not null then
    final_status := 'failed';
    final_next_refresh := now() + interval '5 minutes';
  elsif earliest_retry is not null then
    final_status := case when safe_succeeded > 0 then 'partial' else 'failed' end;
    final_next_refresh := greatest(now() + interval '1 minute', earliest_retry);
  elsif safe_failed > 0 then
    final_status := case when safe_succeeded > 0 then 'partial' else 'failed' end;
    final_next_refresh := now() + interval '5 minutes';
  else
    final_status := 'success';
    select now() + settings.refresh_interval * interval '1 hour'
    into final_next_refresh
    from public.user_settings as settings
    where settings.user_id = target_user;
  end if;

  update public.user_settings as settings
  set
    last_refresh_at = case when final_status = 'success' then now() else settings.last_refresh_at end,
    next_refresh_at = case when settings.show_refresh_timer then final_next_refresh else null end
  where settings.user_id = target_user;

  update private.automatic_refresh_runs as run
  set
    finished_at = now(),
    attempted = safe_attempted,
    succeeded = safe_succeeded,
    failed = safe_failed,
    status = final_status,
    error_message = left(nullif(btrim(coalesce(account_error, '')), ''), 500)
  where run.id = target_run
    and run.user_id = target_user;
end;
$$;

create or replace function private.clear_automatic_refresh_failure_on_success()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.metrics_updated_at is not null
     and new.metrics_updated_at is distinct from old.metrics_updated_at then
    delete from private.automatic_refresh_failures
    where post_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists clear_automatic_refresh_failure_on_success on public.posts;
create trigger clear_automatic_refresh_failure_on_success
after update of metrics_updated_at on public.posts
for each row
execute function private.clear_automatic_refresh_failure_on_success();

create or replace function private.maintain_automatic_refresh_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  schedule_delay interval;
begin
  if new.refresh_interval not in (0.5, 1, 3, 6, 12, 24) then
    new.refresh_interval := 0.5;
  end if;

  schedule_delay := new.refresh_interval * interval '1 hour';

  if not new.show_refresh_timer then
    new.next_refresh_at := null;
  elsif tg_op = 'INSERT'
     or not old.show_refresh_timer
     or new.refresh_interval is distinct from old.refresh_interval
     or new.next_refresh_at is null then
    new.next_refresh_at := now() + schedule_delay;
  end if;

  return new;
end;
$$;

drop trigger if exists maintain_automatic_refresh_schedule on public.user_settings;
create trigger maintain_automatic_refresh_schedule
before insert or update of show_refresh_timer, refresh_interval on public.user_settings
for each row
execute function private.maintain_automatic_refresh_schedule();

create index if not exists user_settings_automatic_refresh_due_idx
  on public.user_settings (next_refresh_at)
  where show_refresh_timer;

update public.user_settings
set next_refresh_at = case
  when show_refresh_timer then coalesce(next_refresh_at, now())
  else null
end;

revoke all on function public.validate_automatic_refresh_cron_secret(text) from public, anon, authenticated;
revoke all on function public.claim_due_automatic_refreshes(integer) from public, anon, authenticated;
revoke all on function public.record_automatic_refresh_failure(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.complete_automatic_refresh(uuid, uuid, integer, integer, integer, text) from public, anon, authenticated;
revoke all on function private.clear_automatic_refresh_failure_on_success() from public, anon, authenticated;
revoke all on function private.maintain_automatic_refresh_schedule() from public, anon, authenticated;

grant execute on function public.validate_automatic_refresh_cron_secret(text) to service_role;
grant execute on function public.claim_due_automatic_refreshes(integer) to service_role;
grant execute on function public.record_automatic_refresh_failure(uuid, bigint, text) to service_role;
grant execute on function public.complete_automatic_refresh(uuid, uuid, integer, integer, integer, text) to service_role;

do $$
declare
  cron_secret text;
begin
  select secret.decrypted_secret
  into cron_secret
  from vault.decrypted_secrets as secret
  where secret.name = 'automatic_refresh_cron_secret'
  limit 1;

  if cron_secret is null then
    cron_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
    perform vault.create_secret(
      cron_secret,
      'automatic_refresh_cron_secret',
      'Segredo interno do agendador de métricas automáticas.'
    );
  end if;

  insert into private.automatic_refresh_config (id, secret_hash, updated_at)
  values (1, pg_catalog.encode(extensions.digest(cron_secret, 'sha256'), 'hex'), now())
  on conflict (id) do update
  set secret_hash = excluded.secret_hash,
      updated_at = excluded.updated_at;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'automatic_refresh_project_url'
  ) then
    perform vault.create_secret(
      'https://twklhbuefcktgllydtxr.supabase.co',
      'automatic_refresh_project_url',
      'URL interna usada pelo agendador de métricas automáticas.'
    );
  end if;
end;
$$;

select cron.schedule(
  'automatic-metrics-refresh',
  '*/5 * * * *',
  $scheduled$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'automatic_refresh_project_url'
        limit 1
      ) || '/functions/v1/automatic-metrics-refresh',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'automatic_refresh_cron_secret'
          limit 1
        )
      ),
      body := jsonb_build_object('scheduled_at', now()),
      timeout_milliseconds := 120000
    );
  $scheduled$
);
