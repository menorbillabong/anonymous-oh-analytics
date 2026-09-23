-- Add only account-scoped appearance preferences. Existing RLS/grants are unchanged.
set lock_timeout = '5s';
set statement_timeout = '30s';
alter table public.user_settings
  add column matrix_enabled boolean not null default true,
  add column matrix_color text not null default '#3de879'
    constraint user_settings_matrix_color_check check (matrix_color ~ '^#[0-9a-fA-F]{6}$');
comment on column public.user_settings.matrix_enabled is 'User preference: decorative Matrix background, enabled by default.';
comment on column public.user_settings.matrix_color is 'User preference: six-digit hexadecimal Matrix color.';
