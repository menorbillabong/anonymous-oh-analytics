create schema if not exists private;

create or replace function private.sync_post_x_publication_time()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  status_id_text text;
  exact_time timestamptz;
begin
  status_id_text := substring(new.post_url from '/status/([0-9]+)');

  if status_id_text is not null then
    exact_time := to_timestamp(
      ((((status_id_text::bigint >> 22) + 1288834974657)::numeric) / 1000)::double precision
    );
    new.x_published_at := exact_time;
    new.published_at := (exact_time at time zone 'America/Sao_Paulo')::date;
  elsif new.x_published_at is not null then
    new.published_at := (new.x_published_at at time zone 'America/Sao_Paulo')::date;
  end if;

  return new;
end;
$$;

revoke all on function private.sync_post_x_publication_time() from public, anon, authenticated;

drop trigger if exists sync_post_x_publication_time on public.posts;
create trigger sync_post_x_publication_time
before insert or update of post_url, x_published_at, published_at
on public.posts
for each row
execute function private.sync_post_x_publication_time();

comment on function private.sync_post_x_publication_time() is
  'Keeps X publication timestamps canonical in UTC and the legacy date aligned to America/Sao_Paulo.';

comment on column public.posts.x_published_at is
  'Canonical publication instant from the X status snowflake, stored as timestamptz (UTC internally).';

comment on column public.posts.published_at is
  'Legacy calendar date derived from x_published_at in America/Sao_Paulo.';

-- Repair existing X posts using the same rule enforced for future writes.
update public.posts
set post_url = post_url
where post_url ~ '/status/[0-9]+';


