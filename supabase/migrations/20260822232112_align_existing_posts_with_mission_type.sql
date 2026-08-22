-- Align publications that existed before mission classification became dynamic.
-- Historical reward, theme, metrics and dates remain untouched.

update public.posts p
set sheets_is_special = m.is_special
from public.mission_profiles m
where m.id = p.mission_profile_id
  and m.user_id = p.user_id
  and p.sheets_is_special is distinct from m.is_special;

