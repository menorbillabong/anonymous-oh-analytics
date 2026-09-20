-- Account safety: inactivity is a review signal, NEVER an automatic deletion.
-- Existing post-retention rules are intentionally unchanged.
set lock_timeout = '5s';
set statement_timeout = '60s';

update public.account_cleanup_settings set auto_delete_enabled=false, updated_at=now() where id=1;
do $$ declare j record; begin
  for j in select jobid from cron.job where jobname='anonymous-oh-account-cleanup' loop
    perform cron.alter_job(job_id := j.jobid, active := false);
  end loop;
end $$;
alter table public.account_cleanup_settings add constraint account_cleanup_manual_review_only check (auto_delete_enabled=false);

create index if not exists posts_user_created_activity_idx on public.posts(user_id,created_at desc);
create or replace function private.account_last_activity(p_user_id uuid)
returns timestamptz language sql stable security definer set search_path='' as $$
  select greatest(u.created_at,u.last_sign_in_at,a.last_active_at,
    (select max(p.created_at) from public.posts p where p.user_id=u.id),
    (select max(p.archived_at) from public.archived_periods p where p.user_id=u.id),
    (select max(greatest(p.opened_at,p.closed_at,p.corrected_at)) from public.tracking_periods p where p.user_id=u.id),
    (select p.last_sync_started_at from public.google_sheets_user_config p where p.user_id=u.id))
  from auth.users u left join public.account_activity a on a.user_id=u.id where u.id=p_user_id;
$$;

-- Keep the former queue as a restricted audit snapshot before cancelling it.
create table private.account_queue_safety_archive (
  user_id uuid primary key, saved_at timestamptz not null default now(),
  previous_schedule jsonb not null, verified_last_activity timestamptz,
  still_inactive boolean not null
);
alter table private.account_queue_safety_archive enable row level security;
revoke all on private.account_queue_safety_archive from public,anon,authenticated,service_role;
insert into private.account_queue_safety_archive(user_id,previous_schedule,verified_last_activity,still_inactive)
select q.user_id,to_jsonb(q),private.account_last_activity(q.user_id),
  private.account_last_activity(q.user_id)<=now()-make_interval(days=>s.inactivity_days)
from public.account_deletion_queue q cross join public.account_cleanup_settings s where s.id=1;
insert into public.account_activity(user_id,last_active_at)
select id,private.account_last_activity(id) from auth.users
on conflict(user_id) do update set last_active_at=greatest(public.account_activity.last_active_at,excluded.last_active_at);
delete from public.account_deletion_queue;

create or replace function private.schedule_eligible_accounts(p_actor uuid default null)
returns integer language sql security definer set search_path='' as $$ select 0; $$;
create or replace function private.run_account_cleanup()
returns jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('mode','manual_review_only','scheduled',0,'deleted',0,'cancelled',0,'failed',0);
$$;
create or replace function private.admin_schedule_account_deletion(p_target_user uuid,p_reason text default 'Conta inativa')
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  raise exception using errcode='42501',message='Agendamento de exclusão desativado. Use a revisão manual com confirmação e cópia de segurança.';
end $$;
create or replace function private.admin_set_account_cleanup(p_enabled boolean,p_inactivity_days integer,p_grace_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); begin
  if not private.is_admin(actor) then raise exception using errcode='42501',message='Administrative access required'; end if;
  if p_enabled is distinct from false then raise exception using errcode='22023',message='A exclusão automática de contas foi desativada permanentemente.'; end if;
  if p_inactivity_days is null or p_inactivity_days not between 30 and 365 then raise exception using errcode='22023',message='Escolha entre 30 e 365 dias para revisão.'; end if;
  update public.account_cleanup_settings set inactivity_days=p_inactivity_days,auto_delete_enabled=false,updated_at=now(),updated_by=actor where id=1;
  insert into public.admin_audit_logs(admin_user_id,target_user_id,action,reason,metadata)
  values(actor,actor,'configure_account_cleanup','Prazo de revisão de contas inativas atualizado; exclusão automática bloqueada.',jsonb_build_object('inactivity_days',p_inactivity_days,'auto_delete_enabled',false));
  return jsonb_build_object('inactivity_days',p_inactivity_days,'auto_delete_enabled',false,'scheduled_count',0);
end $$;

create or replace function private.record_account_activity()
returns timestamptz language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); activity_time timestamptz:=clock_timestamp(); begin
  if actor is null then raise exception using errcode='42501',message='Authentication required'; end if;
  -- Serialize real actions with the manual account deletion transaction.
  perform 1 from auth.users where id=actor for key share;
  if not found then raise exception using errcode='42501',message='Authentication required'; end if;
  insert into public.account_activity(user_id,last_active_at) values(actor,activity_time)
  on conflict(user_id) do update set last_active_at=excluded.last_active_at
  where public.account_activity.last_active_at<activity_time-interval '1 minute';
  return activity_time;
end $$;
create function private.touch_own_account_activity()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  -- A background/service-role metrics job is NOT a human activity event.
  if auth.uid() is not null and auth.uid()=new.user_id then perform private.record_account_activity(); end if;
  return new;
end $$;
revoke all on function private.touch_own_account_activity() from public,anon,authenticated,service_role;
do $$ declare t text; begin
  foreach t in array array['posts','user_settings','mission_profiles','tracking_periods','google_sheets_user_config','mission_period_selections','manual_like_adjustments'] loop
    execute format('create trigger account_human_activity before insert or update on public.%I for each row execute function private.touch_own_account_activity()',t);
  end loop;
end $$;

-- Durable app-data backups. No FK to the deleted account and no passwords/tokens.
create table private.account_deletion_backups (
  id uuid primary key default gen_random_uuid(), target_user_id uuid not null,
  created_at timestamptz not null default now(), created_by uuid not null,
  reason text not null, snapshot jsonb not null, transaction_id bigint not null,
  deleted_at timestamptz
);
alter table private.account_deletion_backups enable row level security;
revoke all on private.account_deletion_backups from public,anon,authenticated,service_role;
create index account_deletion_backups_target_idx on private.account_deletion_backups(target_user_id,created_at desc);

create function private.require_account_review_admin()
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); begin
  if not private.is_admin(actor) or not exists (
    select 1 from auth.sessions s where s.user_id=actor and s.id::text=auth.jwt()->>'session_id'
      and (s.not_after is null or s.not_after>now())
  ) then raise exception using errcode='42501',message='Sessão administrativa válida obrigatória. Entre novamente.'; end if;
  return actor;
end $$;
revoke all on function private.require_account_review_admin() from public,anon,authenticated,service_role;

create function private.admin_preview_account_review(p_target_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; target auth.users; activity timestamptz; days integer; begin
  actor:=private.require_account_review_admin();
  select * into target from auth.users where id=p_target_user;
  if not found then raise exception using errcode='22023',message='Conta não encontrada.'; end if;
  activity:=private.account_last_activity(p_target_user);
  select inactivity_days into days from public.account_cleanup_settings where id=1;
  return jsonb_build_object('user_id',target.id,'email',target.email,'last_activity_at',activity,'inactivity_days',days,
    'can_delete',target.id<>actor and not private.is_admin(target.id) and activity<=now()-make_interval(days=>days),
    'posts',(select count(*) from public.posts where user_id=target.id),
    'archives',(select count(*) from public.archived_periods where user_id=target.id));
end $$;

-- This guard also blocks direct/legacy paths that try to delete without a backup.
create function private.guard_account_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
declare actor uuid; begin
  actor:=private.require_account_review_admin();
  if old.id=actor or private.is_admin(old.id) or not exists (
    select 1 from private.account_deletion_backups b where b.target_user_id=old.id
      and b.created_by=actor and b.transaction_id=txid_current() and b.deleted_at is null
  ) then raise exception using errcode='42501',message='Exclusão bloqueada: revisão manual e cópia de segurança obrigatórias.'; end if;
  return old;
end $$;
revoke all on function private.guard_account_deletion() from public,anon,authenticated,service_role;
create trigger require_confirmed_account_backup before delete on auth.users for each row execute function private.guard_account_deletion();

create function private.admin_delete_reviewed_account(p_target_user uuid,p_confirmation text,p_reason text,p_expected_activity timestamptz)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='3s' set statement_timeout='30s' as $$
declare actor uuid; target auth.users; activity timestamptz; days integer; backup_id uuid;
  snapshot jsonb; table_rows jsonb; t record;
begin
  actor:=private.require_account_review_admin();
  select * into target from auth.users where id=p_target_user for update;
  if not found then raise exception using errcode='22023',message='Conta não encontrada. Atualize a lista antes de tentar novamente.'; end if;
  if target.id=actor or private.is_admin(target.id) then raise exception using errcode='42501',message='Contas administrativas são protegidas.'; end if;
  if p_confirmation is null or trim(p_confirmation) is distinct from target.email then raise exception using errcode='22023',message='Digite exatamente o e-mail indicado para confirmar.'; end if;
  if p_reason is null or length(trim(p_reason)) not between 3 and 500 then raise exception using errcode='22023',message='Informe um motivo entre 3 e 500 caracteres.'; end if;
  activity:=private.account_last_activity(target.id);
  select inactivity_days into days from public.account_cleanup_settings where id=1 for share;
  if activity is null or days is null or activity>now()-make_interval(days=>days) then raise exception using errcode='22023',message='A conta tem atividade recente e não pode ser excluída por inatividade.'; end if;
  if p_expected_activity is distinct from activity then raise exception using errcode='22023',message='A atividade da conta mudou. Faça uma nova revisão.'; end if;
  snapshot:=jsonb_build_object('format_version',1,'recovery_note','Restauração administrativa dos dados; login requer recriação segura e nova senha. Tokens e senhas não são incluídos.',
    'auth_user',jsonb_build_object('id',target.id,'email',target.email,'phone',target.phone,'created_at',target.created_at,'last_sign_in_at',target.last_sign_in_at,'email_confirmed_at',target.email_confirmed_at,'raw_user_meta_data',target.raw_user_meta_data),
    'last_activity_at',activity,'tables','{}'::jsonb);
  -- Capture all application tables owned by this user, including private settings.
  for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    join pg_attribute a on a.attrelid=c.oid and a.attname='user_id' and not a.attisdropped
    where n.nspname in ('public','private') and c.relkind='r' and a.atttypid='uuid'::regtype
    order by n.nspname,c.relname
  loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) from (select * from %I.%I where user_id=$1 for update) r',t.nspname,t.relname) into table_rows using target.id;
    snapshot:=jsonb_set(snapshot,array['tables',t.nspname||'.'||t.relname],table_rows);
  end loop;
  snapshot:=snapshot||jsonb_build_object('audit_logs',coalesce((select jsonb_agg(to_jsonb(l)) from public.admin_audit_logs l where l.target_user_id=target.id or l.post_id in(select id from public.posts where user_id=target.id)),'[]'::jsonb));
  insert into private.account_deletion_backups(target_user_id,created_by,reason,snapshot,transaction_id)
    values(target.id,actor,trim(p_reason),snapshot,txid_current()) returning id into backup_id;
  -- Preserve existing audit references instead of cascading away their history.
  update public.admin_audit_logs set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('preserved_target_user_id',target.id,'preserved_target_email',target.email),target_user_id=null where target_user_id=target.id;
  update public.admin_audit_logs set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('preserved_post_id',post_id),post_id=null where post_id in(select id from public.posts where user_id=target.id);
  update public.user_moderation set updated_by=null where updated_by=target.id;
  update public.posts set admin_reviewed_by=null where admin_reviewed_by=target.id;
  update public.app_controls set updated_by=null where updated_by=target.id;
  update public.google_sheets_user_config set updated_by=null where updated_by=target.id;
  insert into public.admin_audit_logs(admin_user_id,action,reason,metadata)
    values(actor,'delete_inactive_account',trim(p_reason),jsonb_build_object('deleted_user_id',target.id,'email',target.email,'source','admin_confirmed_backup','backup_id',backup_id));
  delete from auth.sessions where user_id=target.id;
  delete from auth.users where id=target.id;
  update private.account_deletion_backups set deleted_at=clock_timestamp() where id=backup_id;
  return jsonb_build_object('deleted',true,'backup_id',backup_id);
end $$;

create function private.admin_account_backups(p_backup_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  perform private.require_account_review_admin();
  if p_backup_id is not null then
    return (select jsonb_build_object('id',id,'target_user_id',target_user_id,'created_at',created_at,'reason',reason,'snapshot',snapshot) from private.account_deletion_backups where id=p_backup_id);
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',snapshot->'auth_user'->>'email','created_at',created_at,'deleted_at',deleted_at) order by created_at desc) from private.account_deletion_backups),'[]'::jsonb);
end $$;

create function public.admin_preview_account_review(p_target_user uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_preview_account_review(p_target_user); $$;
create function public.admin_delete_reviewed_account(p_target_user uuid,p_confirmation text,p_reason text,p_expected_activity timestamptz) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_delete_reviewed_account(p_target_user,p_confirmation,p_reason,p_expected_activity); $$;
create function public.admin_account_backups(p_backup_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.admin_account_backups(p_backup_id); $$;
revoke all on function private.admin_preview_account_review(uuid),public.admin_preview_account_review(uuid),private.admin_delete_reviewed_account(uuid,text,text,timestamptz),public.admin_delete_reviewed_account(uuid,text,text,timestamptz),private.admin_account_backups(uuid),public.admin_account_backups(uuid) from public,anon,authenticated,service_role;
grant execute on function private.admin_preview_account_review(uuid),public.admin_preview_account_review(uuid),private.admin_delete_reviewed_account(uuid,text,text,timestamptz),public.admin_delete_reviewed_account(uuid,text,text,timestamptz),private.admin_account_backups(uuid),public.admin_account_backups(uuid) to authenticated;
notify pgrst,'reload schema';
