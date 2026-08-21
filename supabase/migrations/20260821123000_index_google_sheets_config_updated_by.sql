create index if not exists google_sheets_user_config_updated_by_idx
  on public.google_sheets_user_config(updated_by)
  where updated_by is not null;

