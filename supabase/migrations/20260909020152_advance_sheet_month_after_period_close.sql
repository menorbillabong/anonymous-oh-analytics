-- Keep the Google Sheets month aligned with the next period.
-- This runs inside the same transaction as the successful period closure.

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
      ),
      updated_at = now()
  where user_id = new.user_id
    and enabled
    and trim(sheet_tab_name) <> '';

  return new;
end;
$$;

drop trigger if exists advance_sheet_month_after_period_close
on public.archived_periods;

create trigger advance_sheet_month_after_period_close
after insert on public.archived_periods
for each row
execute function private.advance_google_sheets_month_after_period_close();
