# Built-in mission profiles

Applied 2026-09-28. `mission_profiles.builtin_kind` identifies `normal` and `hq`
independently of editable display names. Exactly one of each per account is
protected by the unique index and creation routines. Direct API callers cannot
claim or remove this identity. Both remain editable; neither is deletable while
its account exists. The existing protected account-deletion cascade still works.

## Defaults and permissions

- Templates are a private snapshot of the administrator's verified profiles:
  FOTOS NORMAIS: multiplier 2, bonus 0, blue #0822e7; FOTOS HIGH QUALITY:
  multiplier 2, bonus 200, purple #c400fa. Both have unlimited submissions.
- Signup creates both profiles in the same database transaction as the user.
- Normal cannot have `is_special=true`. Other editable fields retain existing behavior.
- HQ initially has `is_special` equal to the existing Sheets permission (`enabled`).
  A permission grant checks HQ; revocation unchecks it. Re-saving an unchanged
  permission does not overwrite a user's manual choice. Custom missions are untouched.
- The fixed bonus remains independent of the Sheets classification flag.
- A post saved with no profile is assigned its owner's built-in normal before
  the existing reward/classification snapshot trigger runs. The shared client
  default helper prioritizes the built-in normal across individual, bulk and X additions.

## Existing-account rollout

Recent publication links from 2026-09-02 onward identify profiles matching the
admin template's bonus (0 or 200). Exact template names break ties; unresolved
ties abort the whole migration. Profiles for videos and other custom missions
remain intact. Existing profile IDs, colors, descriptions and other settings
are reused. Only missing defaults are created. Profile names and corresponding
live post labels are standardized; stored historical archives are untouched.

Result: 19 accounts, 38 built-ins, 25 reused profiles, 66 formerly unassigned
posts assigned to normal. Migration assertions verified existing links, dates,
views, likes and fixed bonuses did not change. New-account behavior, permission
grant/revoke and guards were also tested against the real schema inside a rolled-back
transaction; no fixture account was retained.

`private.mission_profile_rollout_backup` stores the scoped pre-change profile
and post classification snapshots, denied to all API roles. Do not blindly
restore it: review subsequent user edits first. Any rollback must preserve
new accounts/posts and current permissions. `private.mission_default_templates`
is likewise intentionally not exposed to clients. Security advisors reported
no new warnings; two added private tables intentionally have deny-all RLS.

## Reproducible checks

- `node --experimental-strip-types --test tests/*.test.ts` (206 passed)
- Production Next.js build (passed)
- `tests/builtin-missions.integration.mjs` uses an isolated PGlite 0.5.8 module,
  supplied via `PGLITE_TEST_MODULE` (absolute path to its `dist/index.js`). It
  never contacts Supabase. Covers signup, legacy reuse, private access, owner
  isolation, delete/identity guards, grant/revoke, closed-post metadata,
  legitimate account cascade and atomic rollback on ambiguous matches.
