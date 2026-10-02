# Bulk profile link lookup

- Separate lookup permission, disabled by default. No changes to posts, imports, missions, metrics or Sheets.
- Current session and account suspension/permission checked on every database operation.
- Private RLS-enabled tables; no direct client grants. Narrow public invoker wrappers delegate to guarded private functions.
- User-owned searches survive refresh/login. Per-search ID rejects stale writes after reset; monotonically increasing revision rejects out-of-order UI responses.
- One provider request at a time; per-user lease and cooldown survive resets. At most 100 handles per search. No automatic retry on access denial or rate limiting.
- Reposts are opt-in and validated against the requested reposter. Provider does not expose repost time, so included reposts use provider timeline order, not the original post's date. Only the first 100 available timeline entries are inspected. No guarantee that a public provider exposes every/latest X post.
- A check mark means the link was opened, not liked. No X mutation endpoints or credentials are used.

## Verification (2026-10-02)

- Unit tests: parsing, handle deduplication, repost switch, own-post sorting, author validation, safe links, rate-limit behavior.
- API fixtures: missing authentication, live authorization before upstream, persisted results, pause on provider rate limiting.
- Isolated PGlite: admin/user sessions, permission grant/revoke, default off, suspension, cross-user isolation, direct-table denial, persistence, opened markers, reset confirmation, cooldown and stale completion rejection; original posts unchanged.
- Browser local-only fixture: form, switch off/on, two results without cards, link click producing a check mark, reload retaining the marker and switch, reset cancellation/confirmation. Checked default narrow viewport and 1280x850. Fixture-only session mock corrected after initial missing-user errors; no production component changed for that mock. Temporary fixture removed before build/deploy.
- Live public read-only provider request for Adrianoramalhoo returned a valid repost link. No likes or other social actions performed.
- No existing user search or account permission was changed during verification.
- Full automated suite: 251 passed; production build completed successfully.
- Online migration applied. Security advisor warning counts unchanged (27 existing public definer functions and existing password-protection warning). Two new informational RLS-without-policy notices are intentional for private tables with direct grants revoked and guarded function-only access: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
