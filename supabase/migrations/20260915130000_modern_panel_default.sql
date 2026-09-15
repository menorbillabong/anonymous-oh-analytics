alter table public.user_settings
  alter column panel_action_layout set default 'organized';

update public.user_settings
set
  panel_action_layout = 'organized',
  updated_at = now()
where panel_action_layout is distinct from 'organized';
