-- Defense in depth for server-only state.
--
-- These tables are intentionally accessed only by postgres-owned internal
-- functions and triggers. Enabling RLS without client policies keeps direct
-- access denied while preserving those controlled server-side flows.

alter table private.automatic_refresh_config enable row level security;
alter table private.automatic_refresh_runs enable row level security;
alter table private.automatic_refresh_claims enable row level security;
alter table private.automatic_refresh_failures enable row level security;
alter table private.closed_period_post_cleanup_settings enable row level security;
alter table private.closed_period_post_cleanups enable row level security;

revoke all on table private.automatic_refresh_config
  from public, anon, authenticated, service_role;
revoke all on table private.automatic_refresh_runs
  from public, anon, authenticated, service_role;
revoke all on table private.automatic_refresh_claims
  from public, anon, authenticated, service_role;
revoke all on table private.automatic_refresh_failures
  from public, anon, authenticated, service_role;
revoke all on table private.closed_period_post_cleanup_settings
  from public, anon, authenticated, service_role;
revoke all on table private.closed_period_post_cleanups
  from public, anon, authenticated, service_role;
