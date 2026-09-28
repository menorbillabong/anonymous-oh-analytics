-- Version aligned with the migration applied by Supabase.
-- Built-in identity is independent of the editable display name.
alter table public.mission_profiles add column builtin_kind text
  check (builtin_kind in ('normal','hq'));
create unique index mission_profiles_builtin_owner_key
  on public.mission_profiles(user_id,builtin_kind) where builtin_kind is not null;

-- Private, fixed copies of the administrator's verified defaults. New accounts
-- do not depend on the administrator keeping these names or settings forever.
create table private.mission_default_templates (
  kind text primary key check(kind in ('normal','hq')),
  name text not null, description text not null, color text not null,
  multiplier numeric not null, reward bigint not null, submission_limit integer not null
);
alter table private.mission_default_templates enable row level security;
revoke all on private.mission_default_templates from public,anon,authenticated,service_role;
insert into private.mission_default_templates
select case when m.name='FOTOS NORMAIS' then 'normal' else 'hq' end,
  m.name,coalesce(m.description,''),m.color,m.multiplier,m.reward,m.submission_limit
from public.mission_profiles m join public.admin_users a on a.user_id=m.user_id
where m.name in ('FOTOS NORMAIS','FOTOS HIGH QUALITY') and m.network='X';
do $$ begin
  if (select count(*) from private.mission_default_templates)<>2 then
    raise exception 'Os dois modelos administrativos precisam ser confirmados antes da migração.';
  end if;
end $$;

-- Recoverable, scoped snapshot; never exposed by the API.
create table private.mission_profile_rollout_backup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), profiles jsonb not null, posts jsonb not null
);
alter table private.mission_profile_rollout_backup enable row level security;
revoke all on private.mission_profile_rollout_backup from public,anon,authenticated,service_role;

-- INVOKER is intentional: direct API writes may not claim/remove built-in identity.
-- The private signup/migration routines run as the database owner.
create function private.guard_builtin_mission_identity()
returns trigger language plpgsql set search_path='' as $$ begin
  if current_user in ('anon','authenticated','service_role') and
    ((tg_op='INSERT' and new.builtin_kind is not null) or
     (tg_op='UPDATE' and (new.builtin_kind is distinct from old.builtin_kind or
       (old.builtin_kind is not null and new.user_id is distinct from old.user_id)))) then
    raise exception using errcode='42501',message='A identificação dos perfis padrão não pode ser alterada.';
  end if;
  if new.builtin_kind='normal' and new.is_special then
    raise exception 'FOTOS NORMAIS não pode ser uma missão especial.';
  end if;
  return new;
end $$;
revoke all on function private.guard_builtin_mission_identity() from public,anon,authenticated,service_role;
create trigger builtin_mission_identity before insert or update on public.mission_profiles
  for each row execute function private.guard_builtin_mission_identity();

create function private.guard_builtin_mission_deletion()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  -- Allow only the existing, protected auth account-deletion cascade.
  if old.builtin_kind is not null and exists(select 1 from auth.users where id=old.user_id) then
    raise exception 'Os perfis padrão podem ser editados, mas não excluídos.';
  end if;
  return old;
end $$;
revoke all on function private.guard_builtin_mission_deletion() from public,anon,authenticated,service_role;
create trigger builtin_mission_deletion before delete on public.mission_profiles
  for each row execute function private.guard_builtin_mission_deletion();

-- Revocation must be allowed to uncheck HQ. Permission is always read from DB,
-- never from user-editable metadata. Custom profiles retain their existing choice.
create or replace function private.protect_mission_special_setting()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.is_special and (tg_op='INSERT' or new.is_special is distinct from old.is_special)
    and not coalesce((select enabled from public.google_sheets_user_config where user_id=new.user_id),false) then
    raise exception 'GOOGLE_SHEETS_NOT_ENABLED';
  end if;
  return new;
end $$;
revoke all on function private.protect_mission_special_setting() from public,anon,authenticated,service_role;

create function private.ensure_builtin_missions(target_user uuid)
returns void language plpgsql security definer set search_path='' as $$ begin
  insert into public.mission_profiles(user_id,name,description,color,multiplier,reward,submission_limit,
    network,active,is_special,builtin_kind)
  select target_user,t.name,t.description,t.color,t.multiplier,t.reward,t.submission_limit,'X',true,
    t.kind='hq' and coalesce((select enabled from public.google_sheets_user_config where user_id=target_user),false),t.kind
  from private.mission_default_templates t
  on conflict(user_id,builtin_kind) where builtin_kind is not null do nothing;
end $$;
revoke all on function private.ensure_builtin_missions(uuid) from public,anon,authenticated,service_role;
create function private.create_signup_builtin_missions()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  perform private.ensure_builtin_missions(new.id);
  return new;
end $$;
revoke all on function private.create_signup_builtin_missions() from public,anon,authenticated,service_role;
create trigger create_signup_builtin_missions after insert on auth.users
  for each row execute function private.create_signup_builtin_missions();

-- A permission change only changes classification, not the fixed bonus.
create function private.sync_builtin_hq_permission()
returns trigger language plpgsql security definer set search_path='' as $$
declare prior_guard text:=coalesce(current_setting('app.closed_period_internal',true),'');
begin
  if tg_op='UPDATE' and new.enabled is not distinct from old.enabled then return new; end if;
  perform set_config('app.closed_period_internal','true',true);
  update public.mission_profiles set is_special=new.enabled
    where user_id=new.user_id and builtin_kind='hq' and is_special is distinct from new.enabled;
  perform set_config('app.closed_period_internal',prior_guard,true);
  return new;
end $$;
revoke all on function private.sync_builtin_hq_permission() from public,anon,authenticated,service_role;
create trigger sync_builtin_hq_permission after insert or update of enabled on public.google_sheets_user_config
  for each row execute function private.sync_builtin_hq_permission();

-- Defaulting occurs before the existing bonus/Sheets snapshot trigger.
create function private.default_post_to_normal_mission()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.mission_profile_id is null then
    select id,name into new.mission_profile_id,new.mission_name
      from public.mission_profiles where user_id=new.user_id and builtin_kind='normal';
    if not found then raise exception 'Perfil normal indisponível. Atualize a página e tente novamente.'; end if;
  end if;
  return new;
end $$;
revoke all on function private.default_post_to_normal_mission() from public,anon,authenticated,service_role;
create trigger default_post_to_normal_mission before insert or update of mission_profile_id,user_id on public.posts
  for each row execute function private.default_post_to_normal_mission();

-- Serialize the short backfill with profile/post/config changes.
lock table public.mission_profiles,public.posts,public.google_sheets_user_config in share row exclusive mode;
insert into private.mission_profile_rollout_backup(user_id,profiles,posts)
select u.id,
  coalesce((select jsonb_agg(to_jsonb(m)) from public.mission_profiles m where m.user_id=u.id),'[]'),
  coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'mission_profile_id',p.mission_profile_id,
    'mission_name',p.mission_name,'special_reward',p.special_reward,'sheets_is_special',p.sheets_is_special,
    'published_at',p.published_at,'x_published_at',p.x_published_at,'likes',p.likes,'views',p.views))
    from public.posts p where p.user_id=u.id),'[]')
from auth.users u;

do $$
declare account record; v_kind text; candidate_ids bigint[]; chosen bigint; permitted boolean;
  prior_guard text:=coalesce(current_setting('app.closed_period_internal',true),'');
begin
  perform set_config('app.closed_period_internal','true',true);
  for account in select id from auth.users loop
    permitted:=coalesce((select enabled from public.google_sheets_user_config where user_id=account.id),false);
    foreach v_kind in array array['normal','hq'] loop
      -- Recent links are evidence, not a date restriction on the final defaults.
      -- Match the administrator's bonus for photos; do not consume video missions.
      with candidates as (
        select m.id,m.name,count(p.id) filter(where coalesce((p.x_published_at at time zone 'America/Sao_Paulo')::date,p.published_at)>=date '2026-09-02') recent
        from public.mission_profiles m left join public.posts p on p.mission_profile_id=m.id and p.user_id=m.user_id
        where m.user_id=account.id and m.network='X' and m.builtin_kind is null
          and m.reward=(select reward from private.mission_default_templates t where t.kind=v_kind)
        group by m.id
      ), ranked as (
        select id,dense_rank() over(order by recent desc,
          case when upper(trim(name))=(select t.name from private.mission_default_templates t where t.kind=v_kind) then 1 else 0 end desc) rank
        from candidates
      ) select array_agg(id) into candidate_ids from ranked where rank=1;
      if coalesce(cardinality(candidate_ids),0)>1 then
        raise exception 'Perfis ambíguos para a conta %, tipo %. Nenhum dado foi migrado.',account.id,v_kind;
      end if;
      chosen:=candidate_ids[1];
      if chosen is not null then
        update public.mission_profiles m set builtin_kind=v_kind,
          name=(select t.name from private.mission_default_templates t where t.kind=v_kind),
          is_special=case when v_kind='normal' then false else permitted end
        where m.id=chosen and m.user_id=account.id;
      end if;
    end loop;
    perform private.ensure_builtin_missions(account.id);
  end loop;
  update public.posts p set mission_profile_id=m.id,mission_name=m.name
    from public.mission_profiles m where p.mission_profile_id is null and m.user_id=p.user_id and m.builtin_kind='normal';
  -- Keep the denormalized label used by CSV/TXT/Sheets consistent; no date,
  -- metric, bonus, historical archive, or already-existing link is changed here.
  update public.posts p set mission_name=m.name from public.mission_profiles m
    where m.id=p.mission_profile_id and m.user_id=p.user_id and m.builtin_kind is not null
      and p.mission_name is distinct from m.name;
  perform set_config('app.closed_period_internal',prior_guard,true);
  if exists(select 1 from auth.users u where (select count(*) from public.mission_profiles m where m.user_id=u.id and m.builtin_kind is not null)<>2)
    or exists(select 1 from public.posts where mission_profile_id is null) then
    raise exception 'A verificação dos perfis padrão falhou. Migração cancelada.';
  end if;
  if exists(
    select 1 from private.mission_profile_rollout_backup b cross join lateral jsonb_array_elements(b.posts) s
    left join public.posts p on p.id=(s->>'id')::bigint and p.user_id=b.user_id
    where p.id is null or (s->>'mission_profile_id' is not null and p.mission_profile_id is distinct from (s->>'mission_profile_id')::bigint)
      or p.special_reward is distinct from (s->>'special_reward')::bigint
      or to_jsonb(p.published_at) is distinct from nullif(s->'published_at','null'::jsonb)
      or to_jsonb(p.x_published_at) is distinct from nullif(s->'x_published_at','null'::jsonb)
      or to_jsonb(p.likes) is distinct from nullif(s->'likes','null'::jsonb)
      or to_jsonb(p.views) is distinct from nullif(s->'views','null'::jsonb)
  ) then raise exception 'A preservação das publicações falhou. Migração cancelada.'; end if;
end $$;

comment on column public.mission_profiles.builtin_kind is 'Stable system identity; name and other user settings remain editable. normal cannot be special. hq is initially special only with Sheets permission.';
