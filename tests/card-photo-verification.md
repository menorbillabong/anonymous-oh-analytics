# Lightweight card photos

Scope: photo previews in PostLibrary cards only. No database writes, no saved URL changes, no CSS or video component changes. Expanded/list/editor media retains original URLs. X photo assets use the tested `small` variant, with a one-time fallback to the original on image error. Other hosts and non-photo assets remain unchanged.

Validated against an isolated production build:

- `node --experimental-strip-types tests/card-photo.test.ts`: URL allowlist, extension/query/legacy formats, idempotence and unchanged unsupported sources passed.
- `next build`: compilation and TypeScript passed.
- `tests/card-photo.browser.cjs`: current/previous cards, original images in editor and expanded list, successful preview, failed-preview fallback, no JavaScript errors.
- `tests/card-rollback.browser.cjs`: 80 photos, hover effect, editor, scrolling and list mode passed.
- `tests/media-performance.browser.cjs`: 40 decoded video preview frames at 1.2 seconds, controls, playback, manual seeking, list, mobile layout and add-publication video preview passed. No JavaScript errors.
- Same 43 public photo URLs from the diagnostic, supplied as original URLs to the changed app: all loaded as previews (10,946,640 natural pixels instead of 388,091,220). At 4× CPU slowdown, scroll frame p95 16.8ms, zero intervals over 34ms, zero long tasks. Hover retained glow; two intervals over 34ms (max 89ms), no long tasks. This is a controlled headless measurement, not a guarantee for every browser/device.
- Desktop screenshot inspected: cards and images rendered with the original layout and hover glow.

Rollback: revert this focused commit; no data migration is required.
