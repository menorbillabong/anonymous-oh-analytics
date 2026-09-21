# Account deletion safety — 2026-09-20

## Scope and guarantees

Account inactivity is now an administrative review signal, not an automatic deletion rule. This change does not alter publication dates, exports, Sheets calculations, mission selection, or the separately configured retention of posts in closed periods.

- Automatic account cleanup is disabled at the settings, cron, legacy-function and database-constraint layers.
- The six existing deletion schedules were cancelled after copying their previous state into the restricted `private.account_queue_safety_archive` table. Three had more recent activity than the configured inactivity threshold. All six accounts were retained.
- Last activity considers actual post insertion, archive creation, period actions, Sheets sync initiation, sign-in and recorded visits. Historical activity is backfilled without marking every user active at the current time.
- Visible visits and interactions send a throttled activity call even with a persistent login. Authenticated writes to owned application records also register activity. Service-role background metrics updates do not.
- Manual deletion requires an existing administrator session, an inactive non-admin target, an exact email confirmation, a reason and unchanged activity since the preview. The database rechecks these conditions.
- App-data backup and deletion run in one transaction. A late error rolls back both. A database trigger rejects account deletion without a backup created by that administrator in that transaction.
- Backups live in an unexposed private table without a cascading FK to the removed user. Only administrator RPCs may list/download them. Ordinary users, anonymous callers and direct API table access cannot retrieve or forge them.
- Audit history is preserved. Login sessions are removed before account deletion. No real account was deleted during this release.

## Administrator interface

In **Admin → Usuários**, inactive accounts show **INATIVA PARA REVISÃO** and **REVISAR CONTA INATIVA**. Opening a review never deletes anything. Keeping the account requires no action.

Within **Gestão de contas**, **Todas as contas** is the default tab; **Contas para revisão** filters the same loaded accounts by the saved inactivity threshold, excluding administrators. Both tabs show total counts independent of the name search. Search remains active across tab changes. Arrow keys/Home/End switch tabs. The empty review state is explicit. This is a client-side view only: switching tabs does not write data or change permissions. Verified with isolated desktop/mobile browser fixtures, including search, keyboard navigation, one eligible account, and zero eligible accounts after refresh.

In **Admin → Controles**, the inactivity threshold can be changed between 30 and 365 days. This does not enable scheduled deletion. Backups from subsequent manually confirmed deletions appear under **Cópias de exclusões manuais**.

## Recovery limitations and procedure

The snapshot contains the account ID, email and selected identity metadata, all public/private application rows owned via `user_id`, and relevant audit history. Password hashes, authentication tokens, sessions and MFA credentials are deliberately excluded. It is an application-data recovery copy, not a whole-project/PITR backup or automatic account-restore button.

Recovery must be separately authorized and performed by a trusted administrator:

1. Export the selected backup into a secure location and verify its identity, deletion timestamp and table inventory. Do not commit personal data to the repository.
2. Compare the current database schema and all referenced shared resources against the snapshot. Test reconstruction on an isolated copy first, including foreign-key order, identities, tracking periods and mission relationships. Existing archive triggers must not be blindly replayed: they perform additional business actions.
3. Re-establish the user's authentication identity through an approved administrative recovery procedure. Prefer the original ID when supported; otherwise explicitly remap every owned/reference row. Do not reuse old sessions or ask for the user's existing password.
4. Restore only the authorized user's application records in a checked transaction, preserving post timestamps and IDs when possible; reconcile generated sequences and any removed shared references. Never replace the whole production database to restore one user.
5. Set current account activity, arrange a secure new-password/access flow, and verify account access, publication/archive counts, settings and mission links before declaring recovery complete.

Previously deleted accounts are not restored or retroactively backed up by this migration. Their recovery requires the older backup and separate approval.

## Verification

- 107 automated JavaScript/TypeScript tests pass; production build and type checking pass.
- `tests/account-review-permissions.sql` uses generated synthetic users and always rolls the transaction back. It verifies legacy-path blocking, current activity protection, session checks, non-admin denial, confirmation, stale preview rejection, backup survival, and full rollback after an intentionally induced late FK failure.
- Database inventory before/after synthetic tests: 13 users, 543 posts, 5 archives; zero fixture users/backups remain and zero account deletion schedules remain.
- Local browser fixtures target only `127.0.0.1:3107` and fake Supabase `127.0.0.1:54321`. They test the actual application components without real credentials or external writes. Desktop and mobile dialogs render; protected users have disabled review actions; email/reason gate the confirmation; the mocked API receives the expected user and activity timestamp.
- Download limitation: the administrator RPC and JSON creation were verified, but the isolated automated Chrome cancels both the application download and a separate minimal Blob download on the same machine. Saving the file to disk therefore remains unverified in a normal browser. The database backup does not depend on a successful local download.
- React review: user-scoped effect, event cleanup, throttled activity requests, native modal focus containment/Escape handling, labelled inputs, no new dependencies and no changes to unrelated interface actions.

## Existing advisor notices

No new publicly exposed security-definer RPCs were introduced. The two private snapshot tables intentionally have RLS with no user policy and revoked direct privileges; access is exclusively through the checked administrator functions ([RLS notice explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)).

The project also reports pre-existing public security-definer functions and disabled leaked-password protection. These unrelated settings were not broadly rewritten in this release. See [function exposure guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Rollback safety

Do not restore the old cleanup function or re-enable its cron. An interface rollback is compatible with the safety migration: old scheduling/enabling requests fail safely. Keep the private backups and queue archive. Any database rollback requires a separately reviewed migration that preserves these protections and all backup data.
