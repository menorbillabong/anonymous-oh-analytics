-- Separate from post imports: never writes posts, missions, metrics or Sheets.
set lock_timeout='5s';
set statement_timeout='30s';
create table private.x_lookup_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false
);
create table private.x_lookup_searches (
  user_id uuid primary key references auth.users(id) on delete cascade,
  run_id uuid not null default gen_random_uuid(),
  include_reposts boolean not null default false,
  revision bigint not null default 0,
  items jsonb not null default '[]',
  last_opened text,
  last_request_at timestamptz,
  claim_id uuid,
  claim_index integer,
  claim_until timestamptz
);
alter table private.x_lookup_access enable row level security;
alter table private.x_lookup_searches enable row level security;
revoke all on private.x_lookup_access,private.x_lookup_searches from public,anon,authenticated,service_role;

-- Preserve all previous audit actions.
do $$ declare expression text; begin
  select pg_get_expr(conbin,conrelid) into expression from pg_constraint
    where conrelid='public.admin_audit_logs'::regclass and conname='admin_audit_logs_action_check';
  if expression is null then raise exception 'Audit constraint missing'; end if;
  alter table public.admin_audit_logs drop constraint admin_audit_logs_action_check;
  execute format('alter table public.admin_audit_logs add constraint admin_audit_logs_action_check check ((%s) or action = %L)',expression,'set_x_lookup_access');
end $$;

create function private.admin_x_lookup_access(p_target uuid default null,p_enabled boolean default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; begin
  actor:=private.require_account_review_admin();
  if actor is null then raise exception using errcode='42501',message='Sessão inválida.'; end if;
  if p_target is not null then
    if p_enabled is null or length(trim(p_reason)) not between 3 and 500 or p_reason is null then
      raise exception 'Informe o motivo da alteração.';
    end if;
    insert into private.x_lookup_access(user_id,enabled) values(p_target,p_enabled)
      on conflict(user_id) do update set enabled=excluded.enabled;
    insert into public.admin_audit_logs(admin_user_id,target_user_id,action,reason,metadata)
      values(actor,p_target,'set_x_lookup_access',trim(p_reason),jsonb_build_object('enabled',p_enabled));
  end if;
  return coalesce((select jsonb_agg(to_jsonb(a)) from private.x_lookup_access a),'[]');
end $$;
create function public.admin_x_lookup_access(p_target uuid default null,p_enabled boolean default null,p_reason text default null)
returns jsonb language sql security invoker set search_path='' as $$
  select private.admin_x_lookup_access(p_target,p_enabled,p_reason);
$$;

-- All operations recheck the live permission/session and derive ownership from auth.uid().
-- The private function is the only writer; the public wrapper does not elevate privileges.
create function private.my_x_lookup(p_action text default 'get',p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); permitted boolean; s private.x_lookup_searches%rowtype;
  handles text[]; h text; i integer; item jsonb; result jsonb; token uuid;
begin
  if actor is null or not exists(select 1 from auth.users u join auth.sessions se on se.user_id=u.id
    where u.id=actor and se.id::text=auth.jwt()->>'session_id' and (se.not_after is null or se.not_after>now())) then
    raise exception using errcode='42501',message='Sessão inválida. Entre novamente.';
  end if;
  permitted:=coalesce((select enabled from private.x_lookup_access where user_id=actor),false)
    and not coalesce((select suspended from public.user_moderation where user_id=actor),false);
  if not permitted then
    if p_action='get' then return jsonb_build_object('enabled',false); end if;
    raise exception using errcode='42501',message='Busca em massa não liberada para esta conta.';
  end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>20000 then raise exception 'Dados inválidos.'; end if;
  insert into private.x_lookup_searches(user_id) values(actor) on conflict do nothing;
  select * into s from private.x_lookup_searches where user_id=actor for update;
  if p_action not in ('get','start','reset') and p_data->>'run_id' is distinct from s.run_id::text then
    raise exception 'A pesquisa mudou. Reabra a janela.';
  end if;
  if p_action='start' then
    if jsonb_array_length(s.items)>0 then raise exception 'Reinicie a pesquisa antes de iniciar outra.'; end if;
    if jsonb_typeof(p_data->'handles') is distinct from 'array' then raise exception 'Informe os perfis.'; end if;
    if jsonb_array_length(p_data->'handles') not between 1 and 100 then raise exception 'Informe de 1 a 100 perfis.'; end if;
    handles:=array(select lower(regexp_replace(trim(value),'^@','')) from jsonb_array_elements_text(p_data->'handles'));
    s.items:='[]';
    foreach h in array handles loop
      if h is null or h !~ '^[a-z0-9_]{1,15}$' then raise exception 'Perfil inválido.'; end if;
      if not s.items @> jsonb_build_array(jsonb_build_object('handle',h)) then
        s.items:=s.items||jsonb_build_array(jsonb_build_object('handle',h,'status','pending','opened',false));
      end if;
    end loop;
    s.run_id:=gen_random_uuid(); s.include_reposts:=coalesce((p_data->>'include_reposts')::boolean,false);
    s.last_opened:=null;
  elsif p_action='reset' then
    if p_data->>'run_id' is distinct from s.run_id::text or p_data->>'confirmation' is distinct from 'REINICIAR' then raise exception 'Confirme a reinicialização da pesquisa atual.'; end if;
    s.items:='[]'; s.run_id:=gen_random_uuid(); s.last_opened:=null;
    s.claim_id:=null; s.claim_index:=null; s.claim_until:=null;
  elsif p_action='open' then
    select (ordinality-1)::integer into i from jsonb_array_elements(s.items) with ordinality
      where value->>'handle'=p_data->>'handle' and value->>'status'='found';
    if i is null then raise exception 'Link não encontrado nesta pesquisa.'; end if;
    s.items:=jsonb_set(s.items,array[i::text,'opened'],'true'); s.last_opened:=p_data->>'handle';
  elsif p_action='claim' then
    if s.claim_until>clock_timestamp() or s.last_request_at>clock_timestamp()-interval '3 seconds' then
      raise exception 'Aguarde alguns segundos; uma consulta ainda está em andamento.';
    end if;
    select (ordinality-1)::integer into i from jsonb_array_elements(s.items) with ordinality
      where value->>'status'='pending' order by ordinality limit 1;
    if i is null then return jsonb_build_object('done',true); end if;
    s.claim_id:=gen_random_uuid(); s.claim_index:=i; s.claim_until:=clock_timestamp()+interval '45 seconds';
    s.last_request_at:=clock_timestamp();
    result:=jsonb_build_object('claim_id',s.claim_id,'handle',s.items->i->>'handle','include_reposts',s.include_reposts,'run_id',s.run_id);
  elsif p_action='complete' then
    if s.claim_id is null or p_data->>'claim_id' is distinct from s.claim_id::text then raise exception 'Consulta expirada. Continue a pesquisa.'; end if;
    item:=s.items->s.claim_index;
    if p_data->>'status' not in ('found','empty','error') or p_data->>'status' is null then raise exception 'Resultado inválido.'; end if;
    if p_data->>'status'='found' and (p_data->>'url' is null or p_data->>'url' !~ '^https://x\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,25}$') then raise exception 'Link inválido.'; end if;
    item:=item||jsonb_build_object('status',p_data->>'status','url',case when p_data->>'status'='found' then p_data->>'url' end,
      'repost',coalesce((p_data->>'repost')::boolean,false),'message',left(coalesce(p_data->>'message',''),240));
    s.items:=jsonb_set(s.items,array[s.claim_index::text],item);
    s.claim_id:=null; s.claim_index:=null; s.claim_until:=null;
  elsif p_action='retry' then
    s.items:=(select coalesce(jsonb_agg(case when value->>'status'='error' then value||'{"status":"pending"}'::jsonb else value end order by ordinality),'[]')
      from jsonb_array_elements(s.items) with ordinality);
  elsif p_action<>'get' then raise exception 'Operação inválida.';
  end if;
  if p_action<>'get' then
    s.revision:=s.revision+1;
    update private.x_lookup_searches set revision=s.revision,run_id=s.run_id,include_reposts=s.include_reposts,items=s.items,last_opened=s.last_opened,
      last_request_at=s.last_request_at,claim_id=s.claim_id,claim_index=s.claim_index,claim_until=s.claim_until where user_id=actor;
  end if;
  if result is not null then return result; end if;
  return jsonb_build_object('enabled',true,'revision',s.revision,'run_id',s.run_id,'include_reposts',s.include_reposts,'items',s.items,'last_opened',s.last_opened);
end $$;
create function public.my_x_lookup(p_action text default 'get',p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$ select private.my_x_lookup(p_action,p_data); $$;
revoke all on function private.my_x_lookup(text,jsonb),public.my_x_lookup(text,jsonb),
  private.admin_x_lookup_access(uuid,boolean,text),public.admin_x_lookup_access(uuid,boolean,text) from public,anon,authenticated,service_role;
grant execute on function private.my_x_lookup(text,jsonb),public.my_x_lookup(text,jsonb),
  private.admin_x_lookup_access(uuid,boolean,text),public.admin_x_lookup_access(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
