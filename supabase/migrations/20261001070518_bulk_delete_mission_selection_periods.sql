-- One transaction for the whole selection. Reuse the audited single-delete
-- operation; never modify posts, profiles, rewards or accounting closures.
set lock_timeout='5s';
set statement_timeout='30s';
create function private.delete_mission_selection_periods(p_periods jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target record; total integer;
begin
  if actor is null or not private.account_active(actor) or not private.is_admin(actor) then
    raise exception 'MISSION_PERIOD_ADMIN_REQUIRED';
  end if;
  if p_periods is null or jsonb_typeof(p_periods)<>'array' then
    raise exception 'MISSION_PERIOD_BULK_INVALID';
  end if;
  total:=jsonb_array_length(p_periods);
  if total=0 or total>1000 then raise exception 'MISSION_PERIOD_BULK_INVALID'; end if;
  if exists(select 1 from jsonb_to_recordset(p_periods) as r(id uuid,revision integer)
    where r.id is null or r.revision is null or r.revision<1)
    or (select count(distinct r.id) from jsonb_to_recordset(p_periods) as r(id uuid,revision integer))<>total then
    raise exception 'MISSION_PERIOD_BULK_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mission-selection:definitions',0));
  -- Validate the entire batch before the first deletion. Revisions prevent a
  -- confirmation based on an old screen from deleting a newly edited period.
  if exists(select 1 from jsonb_to_recordset(p_periods) as r(id uuid,revision integer)
    left join public.mission_selection_periods p on p.id=r.id
    where p.id is null or p.revision is distinct from r.revision) then
    raise exception 'MISSION_PERIOD_STALE';
  end if;
  for target in select r.id,r.revision from jsonb_to_recordset(p_periods) as r(id uuid,revision integer) order by r.id loop
    perform private.delete_mission_selection_period(target.id,target.revision);
  end loop;
  return total;
end;
$$;
revoke all on function private.delete_mission_selection_periods(jsonb) from public,anon,authenticated;
grant execute on function private.delete_mission_selection_periods(jsonb) to authenticated;
create function public.delete_mission_selection_periods(p_periods jsonb)
returns integer language sql security invoker set search_path='' as $$
  select private.delete_mission_selection_periods(p_periods);
$$;
revoke all on function public.delete_mission_selection_periods(jsonb) from public,anon;
grant execute on function public.delete_mission_selection_periods(jsonb) to authenticated;
notify pgrst,'reload schema';
