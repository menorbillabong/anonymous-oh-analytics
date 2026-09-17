# Google Sheets sync cooldown

Administration → Controles → Tempo de espera da planilha controls a global duration,
initially 90 seconds. Only active administrators can update the singleton setting;
authenticated active users can read it. Validation accepts 1–86400 whole seconds.
No user, post, mission, metric or spreadsheet data is changed by saving this setting.

Each user's existing last_sync_started_at remains the start of their own cooldown.
Changing the global duration recalculates existing waits, without clearing timestamps.
The server claim keeps its row lock and permission guards. The new status RPC is
read-only/security invoker and respects existing ownership RLS.

The button shows m:ss, checks on load/focus and every 30 seconds while visible,
and refreshes its server status after each sync attempt. API responses carry the
remaining duration, including errors after a successful claim. Waiting starts at
the claim, not at the end of the spreadsheet request.

Verification: tests/sheets-cooldown.test.ts and rollback-only
tests/sheets-cooldown-permissions.sql. Apply the migration before deploying UI.
No automated test writes to the actual Google spreadsheet.
