create or replace function private.advance_google_sheets_month_after_period_close()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.google_sheets_user_config
  set sheet_month = to_char(
        date_trunc('month', new.period_end::timestamp) + interval '1 month',
        'YYYY-MM'
      )
  where user_id = new.user_id
    and enabled
    and trim(sheet_tab_name) <> '';

  return new;
end;
$$;
