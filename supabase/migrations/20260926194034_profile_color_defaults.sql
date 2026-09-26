-- Approved snapshot of Anonymous_OH's saved colors, verified 2026-09-26.
-- One-time rollout only: subsequent personal edits remain authoritative.
set local lock_timeout = '5s';
set local statement_timeout = '20s';
lock table public.user_settings in share row exclusive mode;

-- Only color values and an integrity hash of unrelated settings are retained.
-- Private, RLS-protected, not readable by browser/API roles.
create table private.profile_color_backup_20260926 (
  user_id uuid primary key,
  colors jsonb not null,
  other_settings_hash text not null,
  backed_up_at timestamptz not null default now()
);
alter table private.profile_color_backup_20260926 enable row level security;
revoke all on private.profile_color_backup_20260926 from public, anon, authenticated, service_role;
insert into private.profile_color_backup_20260926(user_id,colors,other_settings_hash)
select user_id,
  jsonb_build_object('accent_color',accent_color,'background_color',background_color,
    'surface_color',surface_color,'border_color',border_color,'button_colors',button_colors),
  md5((to_jsonb(s)-array['accent_color','background_color','surface_color','border_color','button_colors'])::text)
from public.user_settings s;

alter table public.user_settings
  alter column accent_color set default '#ffb042',
  alter column background_color set default '#000000',
  alter column surface_color set default '#000000',
  alter column border_color set default '#ff00c8',
  alter column button_colors set default '{"x":"#ffa97a","bulk":"#ffa97a","add":"#ffa97a","metrics":"#29dba8","sheets":"#29dba8","missions":"#650094","report":"#650094","open":"#352d71","close":"#352d71","txt":"#858993","csv":"#858993"}'::jsonb;

-- Do not touch updated_at, names, permissions, timers, glow or Matrix settings.
update public.user_settings set
  accent_color='#ffb042',background_color='#000000',surface_color='#000000',border_color='#ff00c8',
  button_colors='{"x":"#ffa97a","bulk":"#ffa97a","add":"#ffa97a","metrics":"#29dba8","sheets":"#29dba8","missions":"#650094","report":"#650094","open":"#352d71","close":"#352d71","txt":"#858993","csv":"#858993"}'::jsonb;

do $$ begin
  if exists (
    select 1 from public.user_settings s join private.profile_color_backup_20260926 b using(user_id)
    where b.other_settings_hash <> md5((to_jsonb(s)-array['accent_color','background_color','surface_color','border_color','button_colors'])::text)
  ) then raise exception 'Unrelated settings changed; aborting color rollout'; end if;
end $$;
