# X import resilience — 2026-09-28

Scope: public timeline fetching and partial-result notice only. No database migrations, account permissions, saved posts, spreadsheet data, dates, or mission-selection changes.

## Automated verification

- Full Node test suite: 204 passing tests, including 21 new tests for timeline failure handling and API integration.
- Production build and TypeScript: passed with placeholder public Supabase configuration for local build validation. No real credentials used or committed.
- Missing authentication, disabled access, missing profile/period, and cooldown still block before public queries. The authorization/cooldown claim is never retried.
- Transient network, JSON, timeout, and 5xx failures: at most two retries, short backoff, one shared 40-second public-timeline budget.
- HTTP 429/403 and Retry-After responses: not retried. Logs contain only source, attempt, failure category and HTTP status, not tokens, handles or response bodies.
- Later-page failure preserves earlier pages and explicitly marks the result incomplete. Empty valid timelines remain distinct from failed retrievals.
- Older-page stopping checks the entire parsed page, preserving mixed old pinned/current posts. Original author, replies/reposts, date filters, and cross-page deduplication retained.
- Partial notice is separate from duplicate/monthly-limit notices and stays above the cards, including when all results were already added.
- API still retrieves and merges the pinned publication.

## Read-only live probe

The corrected helper queried the public profile Anonimous_OH for 2026-09-01 through 2026-09-28: 4 requests, 45 unique in-period publications, complete result, 3478 ms. No posts were inserted and no account request/cooldown was claimed. This was a direct local-to-source test, not a signed-in production browser test.

## Limits

The external public service can still deny or rate-limit requests. This change makes transient failures recoverable and partial responses explicit; it does not bypass external restrictions or guarantee availability. Maximum 5 pages / 100 eligible posts remains bounded and is reported as incomplete when more pages remain.
