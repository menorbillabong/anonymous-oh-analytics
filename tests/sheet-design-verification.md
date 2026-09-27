# Sheet design controls — 2026-09-27

Scope: move the existing manual-like gear to Update metrics; add four approved
template choices to Update sheet, gated by the existing Sheets permission. No
account, post, mission, color preference, or template content changes.

Safety: authenticated identity and current active-account/Sheets permission are
checked server-side. The target tab comes only from the caller's saved config.
Preflight fingerprints both sheets. A shared claim precedes the fresh read;
permission is rechecked immediately before the write. One native atomic batch
duplicates the original tab, replaces its layout in place, and restores recognized
inputs. Name and gid remain unchanged. Unsupported layouts, formulas in inputs,
custom tables/charts/filters, populated templates and excess rows block the action.
Network ambiguity requires inspecting the sheet, never an automatic write retry.

Verification:
- 154 automated tests passed, including all 16 template combinations and API
  permission, cooldown, stale-preview, revocation and uncertain-write paths.
- Live database transaction verified that a running request remains locked beyond
  the ordinary cooldown and a finished request can proceed after the cooldown.
  All test changes rolled back. Anonymous execute is denied.
- Security advisor findings unchanged: 17 RLS-without-policy informational items,
  27 existing authenticated security-definer warnings, disabled leaked-password
  protection warning. No new grants or policies.
- Native Sheets fixture converted Design 1 to Design 3 in place, preserving
  profile, one normal and one special post, and creating an original backup.
  Readback: 1100 views, 22 likes, 200 special reward, 994 calculated payout;
  no formula errors. No real user tab was transformed.
- Desktop dialog inspected with all four options; no browser error logs.
- Browser access became unavailable on the last continuation. Mobile inspection
  and authenticated production UI verification could not be repeated.

Temporary native fixture tabs (cleanup pending because Sheets connector/browser
became unavailable): AOH TESTE TEMPORARIO 20260927 MODELOS (gid 136060472),
AOH TEST BACKUP 20260927 MODELOS (gid 393896370). Only fictitious test inputs.
The local test-only page and native request generator were removed before release.

Rollback: revert this feature commit to restore the old gear placement. The
backward-compatible running-request guard may stay. A pre-migration function
definition is saved outside the repository in backups/sheet-claim-before-designs-20260927.json.
Restore a user's sheet only from its matching Backup AOH copy and after reviewing
any subsequent edits; never automatically overwrite newer changes.
