# Settings preset verification — 2026-09-24 UTC

- Full suite: 118 passing tests; production build and TypeScript pass.
- Browser (localhost-only fixture): import changes name, goal, accent and Matrix setting; one profile added; repeating the same file reports zero added/one existing.
- Browser export: version 7 contains regular and special profiles, including is_special, without profile IDs or owner IDs.
- Browser failure simulation: server error leaves the previous name, goal and persisted settings unchanged. Console has no uncaught errors.
- Database: authenticated SECURITY INVOKER RPC tested in a rolled-back transaction with two existing test accounts (with and without Sheets permission).
- Database assertions: special flag retained with permission; stripped without permission while reward remains 200; repeated import skips existing profile; invalid second mission rolls back all mission inserts and settings; cross-account rows remain invisible; anonymous execute denied.
- After rollback, no test profiles remain. Security advisors match the pre-change baseline (no new warnings).
- Existing missions are not overwritten because changing their reward/is_special could also change linked publications. Same trimmed, case-insensitive name and network means existing profile is retained.
- Old settings files still import preferences, but cannot restore missions absent from the file. Download a fresh version 7 file from the source account.
- Permissions, posts, mission periods, account identifiers and administrator controls are never portable.
