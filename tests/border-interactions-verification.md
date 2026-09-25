# Border light and dashboard button harmony

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
