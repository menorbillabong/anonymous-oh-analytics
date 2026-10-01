-- Add a single, explicitly confirmed backup deletion. Never delete a user here.
set lock_timeout='5s';
set statement_timeout='30s';
-- Keep every existing audit action allowed, adding only the new action.
do $$ declare existing_expression text; begin
  select pg_get_expr(conbin,conrelid) into existing_expression from pg_constraint
  where conrelid='public.admin_audit_logs'::regclass and conname='admin_audit_logs_action_check';
  if existing_expression is null then raise exception 'Audit action constraint missing'; end if;
  alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
  execute format('alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check ((%s) or action = %L)',existing_expression,'delete_account_backup');
end $$;

create function private.admin_delete_account_backup(p_backup_id uuid,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=''
set lock_timeout='3s' set statement_timeout='15s' as $$
declare actor uuid; target_id uuid; completed_at timestamptz;
begin
  actor:=private.require_account_review_admin();
  if actor is null then raise exception using errcode='42501',message='Sessão administrativa válida obrigatória. Entre novamente.'; end if;
  if p_confirmation is null or trim(p_confirmation)<>'EXCLUIR' then
    raise exception using errcode='22023',message='Digite EXCLUIR para confirmar a exclusão definitiva desta cópia.';
  end if;
  select target_user_id,deleted_at into target_id,completed_at
    from private.account_deletion_backups where id=p_backup_id for update;
  if not found then raise exception using errcode='22023',message='Cópia não encontrada. Atualize a página para conferir a lista.'; end if;
  if completed_at is null then raise exception using errcode='22023',message='Esta cópia protege uma exclusão ainda não concluída e não pode ser removida.'; end if;
  -- Keep a minimal audit, not another copy of the personal data being removed.
  insert into public.admin_audit_logs(admin_user_id,action,reason,metadata)
    values(actor,'delete_account_backup','Exclusão definitiva de cópia confirmada pelo administrador.',jsonb_build_object('backup_id',p_backup_id));
  delete from private.account_deletion_backups where id=p_backup_id;
  return jsonb_build_object('deleted',true,'backup_id',p_backup_id);
end $$;
create function public.admin_delete_account_backup(p_backup_id uuid,p_confirmation text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_delete_account_backup(p_backup_id,p_confirmation);
$$;
revoke all on function private.admin_delete_account_backup(uuid,text),public.admin_delete_account_backup(uuid,text) from public,anon,authenticated,service_role;
grant execute on function private.admin_delete_account_backup(uuid,text),public.admin_delete_account_backup(uuid,text) to authenticated;
notify pgrst,'reload schema';
