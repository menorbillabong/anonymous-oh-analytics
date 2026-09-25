# Selective card rollback — 2026-09-25

Restores card media mounting and hover behavior from 3044c24. Removes deferred mounting and wheel/scroll effect suppression, plus their unused helpers and tests. Historical verification reports remain marked as superseded. Deleted code remains recoverable from Git history.

## Preserved intentionally

- Matrix feature, preferences and current renderer are unchanged in this staged rollback.
- Video decoded-frame preparation, user playback/manual-seek protections and single-owner thumbnail handling remain. Card-specific sizing keeps native controls within the existing 122px media area.
- No database, API, account, metrics, mission, export or settings-import logic changes.

## Verification

- 120 Node tests pass; production build and TypeScript pass with dummy local-only service configuration. Hosting must rebuild source with its own environment; do not deploy this local prebuilt output.
- Isolated Chrome: 80 photo-only cards, Matrix preference disabled, original hover across five cards, repeated wheel events without scroll-effect flags, editor open/close, 80 list rows, zero page errors.
- Mixed-media Chrome check passes normally and with requestVideoFrameCallback unavailable: all 40 video sources mount immediately; decoded preview at 1.2 seconds has pixel 35/134/76/255, native controls fit the card, playback advances, manual seeking stays at 0.5 seconds, no duplicate legacy overlays.
- List expansion, add-publication video preview, mobile width 390px without horizontal overflow and reduced-motion Matrix stop pass. Desktop/mobile screenshots visually inspected.
- agent-browser executable was previously blocked by Windows application control; bundled Playwright with isolated installed Chrome used without changing security policy. Fixture is restricted to 127.0.0.1:3107; no real account or production database used.

These checks establish functional behavior, not elimination of lag on the user's computer. Matrix removal and its startup flash are outside this staged rollback.
