# Individual appearance — 2026-09-26

- Scope: Configurações → Aparência. 0–100 glow slider, named dashboard-button color overrides, static preview, individual/default restoration. Joined gears inherit their button. Existing palette and glow are preserved at defaults (50, empty overrides).
- No new scroll/mousemove handlers, animation loops, media changes, permissions, calculations or action-handler changes. Only hover shadows scale (max 24px); custom button text chooses higher-contrast black/white.
- Account data uses existing user_settings row and ownership/active-account RLS. Styles are removed on logout/unmount. No global browser preference cache for the new fields.
- Additive migration adds constrained smallint and JSONB fields. Existing invoker preset RPC now imports these fields atomically, retaining name/permission protections and old-file compatibility.
- Build and 125 unit tests pass. Local browser: live 0/100 preview, custom colors and joined gears, save/reload, restore, failed save, classic layout, mobile width and keyboard-compatible controls. Screenshots inspected at desktop and 390px mobile. No uncaught browser errors.
- Existing border interactions suite passed: actual edge colors, disabled/focus states, no repeated reads inside a card, preserved card lift. Media suite passed: 40 video frames, seek/play, list/mobile/add preview.
- Database rollback-only test passed: own save/read, 0/100/default, invalid values rejected, presets old/new, name preservation, cross-account read/update denial and anonymous update denial. No test preferences/activity survive.
- Security advisors unchanged: 16 RLS-without-policy info items (private/internal tables), 27 existing exposed SECURITY DEFINER warnings, 1 existing leaked-password-protection warning. No new findings or authorization changes. References: https://supabase.com/docs/guides/database/database-linter and https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection.
- Automated local tests do not guarantee frame rate on every device. Higher user-selected glow can cost more paint work; slider can reduce/disable it.
