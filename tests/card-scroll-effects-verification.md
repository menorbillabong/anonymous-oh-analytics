# Card hover during scrolling — verification

2026-09-25. Scoped client-only change: passive wheel/scroll listeners mark the card grid during a scroll burst; decorative transitions, lift and shadows are suspended, restored after 180ms idle. No pointer-event suppression, media source changes, database changes, settings changes or API changes. List mode registers no listeners; switching views/unmounting cleans listeners, timer and attribute.

## Checks

- 124 Node tests pass, including passive listener registration, burst coalescing, idle restoration, cleanup and ctrl-wheel/zero-delta exclusions.
- Production build and TypeScript succeed using dummy local-only service configuration; deployment must rebuild from source with actual hosting configuration, never publish this local prebuilt.
- `tests/card-scroll-effects.browser.cjs` passes on isolated Chrome with local fake data: hover present at idle, transform/shadow absent during wheel scroll, restored on idle; editor still opens during suppression; video displays a decoded green frame (pixel 35/134/76/255), controls enabled, playback and manual seek work; list mode and expansion work; no page errors.
- Existing `tests/media-performance.browser.cjs` passes: lazy media, real video frame, playback/manual seek, editor, mobile layout, reduced-motion Matrix pause, list expansion and add-publication video preview.

## Performance comparison

Same diagnostic script as investigation: 80 fake posts (40 videos), headless Chrome, 1440x900, CPU throttled 4x, 75 wheel events, pointer over content. Warm second-pass results:

| Scenario | Main-thread task duration before → after | Frame gaps >34ms before → after | p95 gap before → after |
|---|---|---|---|
| Cards + Matrix | 6.301s → 2.353s | 77 → 7 | 44.5ms → 27.7ms |
| Cards, Matrix off | 5.653s → 1.573s | 31 → 2 | 38.9ms → 16.7ms |

These are synthetic local comparisons, not a guarantee on every device. Initial media-loading spikes remain; no claim that all page lag is eliminated. Real video frames and native playback retained unchanged.
