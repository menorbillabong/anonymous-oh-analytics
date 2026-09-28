# Embedded sheet designs and site backups — 2026-09-28

Supersedes the native-backup behavior described in sheet-design-verification.md.

## Scope

- Four approved native templates are embedded in lib/sheet-design-blueprints.json
  (captured 2026-09-27, writable cells packed by dictionary). Transform no longer
  reads or copies the original template tabs. Those original tabs were not deleted.
- Transform retains the registered tab title/gid and recognized profile/post inputs.
  Extra columns/customizations are explicitly removed after preview/confirmation.
  No automatic backup or extra Sheets tab is created.
- Orange BACKUP is immediately before CANCELAR in the existing dialog footer.
  One manual encrypted backup per authenticated account, seven-day validity,
  replacement by atomic upsert, restore by explicit preview and confirmation.
- Existing permission gate and shared sync claim serialize destructive operations.
  Permission is rechecked immediately before a write. Stale preview, mismatched
  account/workbook/tab, unsupported native objects and uncertain outcomes fail closed.

## Backup limits and operations

Supported: literal values/formulas, native cell formats, notes, rich text, links,
validation, merges, conditional formatting, row heights/column widths, hidden
dimensions and frozen grid. This is an individual-tab snapshot, not a workbook
backup; it does not claim to restore workbook sharing, comments or revision history.
Charts, tables, filters, protected ranges, grouping, chips and external-data cells
block automatic backup/transformation rather than silently losing their structure.
Grid bounded to 2,000 rows/100 columns; payload bounded before encryption/decryption.

AES-256-GCM, random IV, account-bound AAD, gzip and HKDF key derived from the existing
server service-account private key. Never delivered to browsers. Rotating that key
invalidates existing backups; create new backups after rotation. Expiry is checked
on every read/restore; hourly cleanup removes expired ciphertext. No service-role
client is used by these endpoints. RLS restricts rows to owners; database grants
prevent users overriding server-managed expiry timestamps.

## Evidence

- Native integration in a separate workbook containing only fictitious fixture
  data: Design 1 -> 4 -> 3 -> 2 -> 1 -> original saved snapshot. Same tab name/gid
  throughout. Inputs: 1 normal/1 special, 1,100 views, 22 likes, bonus 200; calculated
  payout 994. No formula errors. Original extra V20 recovered on restore; 22 columns
  recovered from the reduced 19-column design.
- Compared all 2,574 restored cells' writable fields with the original snapshot:
  zero differences, including both clickable X links. The native test discovered
  Sheets clears whole-cell links when clearing text runs; a final narrow-mask link
  write fixes this, with a regression test.
- Database owner-upsert/replacement/expiry and cross-account-denial checks ran in
  a rolled-back transaction. Migration 20260927183117 already applied. No new
  advisor findings attributable to the new table/function.
- Route tests cover read-only previews, owner scope, failed-save preservation,
  missing/revoked permissions, corrupt/expired/changed backups, stale sheet preview,
  wrong tab/gid, explicit confirmation, shared cooldown and uncertain restore.
- Browser visual verification could not finish: local browser access was blocked
  by browser URL policy. No alternate-browser workaround attempted. UI placement
  is code-reviewed; visual/mobile and authenticated production end-to-end remain
  unverified. Native styling was checked structurally rather than via a render.
- No real user's spreadsheet data was transformed during testing.
- 173 automated tests passed. Temporary local verification page/fixtures removed.
- Separate native fixture workbook remains: 1Rc0whkInG3y-SaqN2sqpFDg1WDNCoO3VNoTeG_awxAU.
  Cleanup was rejected because the connector supports permanent deletion, not
  trash. No deletion occurred; manual move to trash or explicit approval pending.

Rollback: revert this feature commit; the additive backup table and expiry job can
remain without affecting the prior application. Never restore a user's sheet
automatically after rollback; ask them to review changes since backup and confirm.
