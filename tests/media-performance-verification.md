# Card media and Matrix verification — 2026-09-25

Historical report for 0b9651f. The card loading optimization was subsequently reverted; see card-rollback-verification.md. The browser script now checks immediate media mounting instead of deferred mounting.

## Changes

- A shared IntersectionObserver prepares card media within 600px of the viewport; it loads once, disconnects, and leaves prepared media mounted. Unsupported browsers load immediately.
- Card images retain their original URLs/quality (unoptimized Next Image). No media URL changes or image proxy are introduced.
- Videos still seek to a decoded frame around 1.2 seconds, or just before the end for shorter clips. Automatic buffering is retained only for mounted card sources. Play and manual seeking take precedence over frame preparation.
- React-managed videos are excluded from the older thumbnail enhancer. Its observer ignores unrelated changes and coalesces relevant work.
- Matrix glyphs are cached in a small canvas atlas. During scrolling it draws at most 12 times/second; existing normal budgets, colors, defaults and reduced-motion behavior remain.
- No database migrations, metric/date/reward changes, or account writes.

## Evidence

- 122 Node tests pass, including shared-observer, once-only activation, cleanup and unsupported-browser coverage.
- Next.js production build / TypeScript pass.
- Isolated Chrome test with 80 fictitious posts (40 actual generated WebM videos, 40 images): 2 videos mounted initially instead of all 40; visiting later cards loads more, without unmounting already loaded videos.
- Decoded video pixel check confirms the green frame at 1.2 seconds, rather than the black opening or blue poster. Play advances past 1.6 seconds; manual seeking to 0.5 seconds is not reset.
- Zero legacy poster layers on React video cards. Matrix uses cached image draws, with zero repeated fillText calls on the display canvas.
- Both regular video frame callback and the fallback path pass, including list expansion, edit open/close and the legacy video preview in Add Publication.
- Desktop/mobile visual inspection, no horizontal overflow at 390px, reduced-motion animation stop, no uncaught browser errors.

## Reproduction and limits

Build with dummy local public Supabase settings; start on 127.0.0.1:3107. Run `node tests/media-performance.browser.cjs` with Playwright resolvable, then repeat with `TEST_VIDEO_FRAME_FALLBACK=1`.
The fixture only operates on that local host/port; it generates its own media, intercepts API/database calls and never contacts X or the production database.
The agent-browser executable was blocked by Windows application control. Tests used the application's bundled Playwright library and an isolated installed Chrome instead; no security setting was changed.
These are local synthetic checks, not an FPS guarantee for the user's hardware or a measurement of X/CDN latency. Unavailable remote video files cannot yield a decoded frame; the existing thumbnail fallback remains.
