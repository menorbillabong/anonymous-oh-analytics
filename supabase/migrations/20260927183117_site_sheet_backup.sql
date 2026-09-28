-- One encrypted snapshot per account. No Sheets tabs, no accumulation.
create table public.google_sheets_site_backup (
  user_id uuid primary key references auth.users(id) on delete cascade,
  snapshot text not null check (octet_length(snapshot) between 1 and 8388608),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
alter table public.google_sheets_site_backup enable row level security;
revoke all on public.google_sheets_site_backup from public, anon, authenticated;
grant select on public.google_sheets_site_backup to authenticated;
grant insert (user_id,snapshot), update (user_id,snapshot) on public.google_sheets_site_backup to authenticated;
create policy own_backup_read on public.google_sheets_site_backup for select to authenticated
  using ((select auth.uid())=user_id);
create policy own_backup_insert on public.google_sheets_site_backup for insert to authenticated
  with check ((select auth.uid())=user_id and (select public.get_my_google_sheets_sync_status()->>'enabled')='true');
create policy own_backup_update on public.google_sheets_site_backup for update to authenticated
  using ((select auth.uid())=user_id)
  with check ((select auth.uid())=user_id and (select public.get_my_google_sheets_sync_status()->>'enabled')='true');
create function private.stamp_sheet_backup() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.created_at=now(); new.expires_at=now()+interval '7 days'; return new;
end;
$$;
revoke all on function private.stamp_sheet_backup() from public, anon, authenticated;
create trigger stamp_sheet_backup before insert or update on public.google_sheets_site_backup
  for each row execute function private.stamp_sheet_backup();
create index google_sheets_site_backup_expiry on public.google_sheets_site_backup(expires_at);
select cron.schedule('expire-site-sheet-backups','0 * * * *',
  $$delete from public.google_sheets_site_backup where expires_at <= now()$$);
