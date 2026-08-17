alter table public.posts
  add column if not exists x_published_at timestamp with time zone;

with derived as (
  select
    id,
    to_timestamp(
      ((((substring(post_url from '/status/([0-9]+)'))::bigint >> 22) + 1288834974657)::double precision) / 1000
    ) as exact_time
  from public.posts
  where post_url ~ '/status/[0-9]+'
)
update public.posts as posts
set
  x_published_at = derived.exact_time,
  published_at = (derived.exact_time at time zone 'UTC')::date
from derived
where posts.id = derived.id
  and (
    posts.x_published_at is distinct from derived.exact_time
    or posts.published_at is distinct from (derived.exact_time at time zone 'UTC')::date
  );

create index if not exists posts_user_x_published_idx
  on public.posts (user_id, x_published_at desc)
  where x_published_at is not null;

alter table public.posts
  drop constraint if exists posts_title_check;

alter table public.posts
  add constraint posts_title_check
  check (char_length(btrim(title)) >= 1)
  not valid;

alter table public.posts
  validate constraint posts_title_check;

alter table public.user_settings
  alter column app_name set default '';

update public.user_settings
set app_name = '', profile_name_confirmed = false
where lower(btrim(app_name)) in ('veneno', 'anonymous_oh analytics');

update public.user_settings
set profile_name_confirmed = true
where btrim(app_name) <> ''
  and lower(btrim(app_name)) not in ('veneno', 'anonymous_oh analytics')
  and profile_name_confirmed is distinct from true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_settings_confirmed_profile_name_check'
      and conrelid = 'public.user_settings'::regclass
  ) then
    alter table public.user_settings
      add constraint user_settings_confirmed_profile_name_check
      check (
        not profile_name_confirmed
        or char_length(btrim(app_name)) between 2 and 40
      )
      not valid;
  end if;
end
$$;

alter table public.user_settings
  validate constraint user_settings_confirmed_profile_name_check;
