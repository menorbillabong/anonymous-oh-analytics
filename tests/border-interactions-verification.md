# Border light and dashboard button harmony

Current behavior is documented in the latest follow-up below; earlier sections record previous implementations.

Scope: CSS finishing layer, imported by the dashboard. Dashboard primary actions use the existing configurable accent; secondary actions use charcoal with light text. Destructive action borders/glow stay red. Mission cards use their own existing mission color. No new JavaScript listeners, media changes, persisted settings, API changes or database writes.

Existing card/button transforms remain in place. New hover rules apply only to fine pointers with hover support. Disabled controls do not lift/glow; keyboard focus has a distinct outline. Reduced-motion users do not receive the new card transitions.

Validated with an isolated local production build and fictitious accounts:

- Next.js production build and TypeScript: pass.
- `border-interactions.browser.cjs`: consistent primary/secondary palette, stable hover background/text, two mission edge colors, existing card lift, disabled controls, X gear dialog, red delete button, keyboard focus, reduced motion and 390px mobile layout: pass; no page errors.
- `card-photo.browser.cjs`: lightweight previews and fallback, current/previous periods, original images in editor/list: pass.
- `card-rollback.browser.cjs`: 80 photo cards, hover, scroll, editor and 80 list rows: pass.
- `media-performance.browser.cjs`: 40 actual decoded preview frames at 1.2 seconds, playback/manual seeking, mobile layout and add-publication video preview: pass. Run before the final warning-color-only additions; media code was not changed.
- Desktop and mobile screenshots inspected. No horizontal overflow on the tested mobile viewport.

This confirms the tested flows, not a guarantee of frame rates on every device. Rollback is a focused commit revert; no migration is involved.

## Follow-up: per-button colors (2026-09-25)

Removed the universal gold default. Neutral controls now use gray; metrics use their existing green; Sheets (including its gear and adjustment save) and period actions use their existing blue; primary/report actions retain the configurable accent. Secondary fills stay charcoal, with muted borders in the corresponding color. Active/pressed shadows no longer fall back to the legacy orange rule. Mission colors and media code are unchanged.

Expanded the browser regression to assert exact hover colors for eight button types, stable backgrounds/text, and unchanged colored shadows while pressed. Production build, browser regression (including mobile/disabled/focus/delete/mission colors), and both lightweight-photo/fallback scenarios passed without page errors. Desktop screenshot inspected. Backend behavior is outside this CSS-only change; no database writes or runtime-log scan was performed.

## Follow-up: actual rendered color, not role (2026-09-25)

The previous fixed role-based glow is replaced by `useOwnColorGlow`. It samples the element's actual visible border on entry, preferring a wider accent edge. Borderless controls use their background, then their text color if transparent. Existing base colors remain unchanged; the shadow alone uses the sampled color. Global legacy gold border/text/background hover overrides were removed, while existing movement remains.

Two delegated listeners (pointerover and focusin) support dynamically opened dialogs and cards. There are no move/scroll listeners, frame loops, observers, React state updates, requests or storage writes. Reads are batched before writes; entries between children of the same card do not resample its styles; unchanged colors do not rewrite attributes. Listeners and visual properties are cleaned up on dashboard unmount.

Final production build and updated border browser suite passed: eight real controls, custom purple/cyan/pink borders on buttons/boxes/cards, green/blue mission colors, borderless purple and opaque black fills, dialog input, no repeated card reads during internal pointer movement, keyboard focus, disabled state and mobile layout. No page errors.

Photo/fallback and 80-card hover/scroll/editor/list regressions passed. The video frame assertion failed once with concurrent browser suites; the unchanged video test passed when run alone, confirming 40 decoded frames, playback/manual seek, list/mobile and add-publication preview. No video code was modified. This is not a claim of guaranteed frame rates across devices.
