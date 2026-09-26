# Profile palette rollout — 2026-09-26

Source: saved Anonymous_OH settings, read from the connected project before editing.
Only accent/background/surface/border and the 11 dashboard button colors are copied.
No Matrix, glow intensity, account name, permissions, mission, period, publication,
refresh schedule, or login changes. This is a snapshot, not continuing synchronization.

Verification: production build and 126 unit tests passed. Isolated browser checks
passed for preview, custom colors, save/reload, reset to the new palette, zero/strong
glow, joined gears, classic layout, failed saves, mobile layout and logout cleanup.
PWA regression passed with no uncaught errors. Desktop default palette inspected.
Agent-browser remained unavailable under Windows application control; used the
existing isolated Playwright fixture without changing security settings.

Live database result: 16 settings rows, 16 matching palettes, 16 backups, zero
non-color hash differences, no authenticated SELECT access to backup. All five
column defaults match. No functions, policies, auth settings or public grants changed.
Security advisor delta: only an intentional private backup RLS-without-policy INFO
(deny all browser access). The 27 pre-existing security-definer warnings and disabled
leaked-password protection warning are unchanged and outside this color-only change.
References: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

The database migration atomically backs up all existing color values in
`private.profile_color_backup_20260926` (RLS, no API-role access), changes five column
defaults and updates those five fields for existing rows. An in-transaction hash
assertion aborts if unrelated settings change. Users without a settings row receive
the same frontend defaults; new inserts receive the matching database defaults.

Empty button overrides mean the approved palette, including after Restore colors.
Personal overrides still take priority and persist normally. Glow defaults stay 50.

Recovery, only if requested: restore the five color fields from the backup by
user_id and restore previous column defaults/frontend commit. Do not restore whole
settings rows, recreate users, or overwrite unrelated settings. Review personal color
changes made after rollout before a rollback. Previous database defaults were accent
`#a978ff`, background `#101010`, surface `#1e1e1e`, border `#303030`, buttons `{}`.
