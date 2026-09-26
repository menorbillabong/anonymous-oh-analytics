# Online PWA — 2026-09-26

## Scope

Configurações → Aparência → Aplicativo no computador offers installation when the browser supplies a native install event. Otherwise it explains browser-menu installation, including Safari/Android instructions. A standalone window hides the install action. Installation is optional and is confirmed by the browser, not by saving account settings.

The root manifest has a stable same-origin identity, root scope/start URL, standalone display, 192/512 PNG icons and a separate maskable declaration. Apple touch icon and viewport metadata are included. Icons are committed assets; regenerating with scripts/generate-pwa-icons.cjs requires Sharp available in the local tooling (used the bundled runtime). No new production dependencies.

## Online-only design

No service worker, application response cache, offline data store, background sync, push notifications, authentication change, database migration, or new permission is introduced. API calls, Google Sheets, X, exports and login continue using the existing site. Normal browser storage/session behavior is unchanged. Closing the window does not promise continuous background work.

An already loaded page shows a connectivity warning on the browser's offline event and removes it on reconnection. Starting/reloading without internet uses the browser's network-error screen; there is intentionally no offline copy of authenticated pages. navigator.onLine is a connectivity hint, not a guarantee that every external service is reachable.

## Evidence

- Production Next.js build and 125 existing unit tests passed.
- Isolated persistent Chromium profile: Page.getAppManifest returned no errors; Page.getInstallabilityErrors returned no errors. All manifest PNG paths responded 200 with matching dimensions.
- Native install offer appeared in local settings. Automated accepted/dismissed/error outcomes and appinstalled events are simulated UI tests; no OS installation was performed on the user's profile.
- Standalone display-mode state tested; no duplicate install action. Offline/online warning tested; zero Cache Storage entries and zero registered service workers.
- Desktop and 390px mobile screenshots inspected; no horizontal overflow or uncaught JavaScript errors.
- Existing appearance controls, save/reload, account logout cleanup and card-photo browser regressions passed.
- Browser tool fallback: isolated Playwright suite, because the agent-browser executable was previously blocked by Windows application control. No security settings changed.

Final device installation remains a user action in Chrome/Edge. Safari/mobile platform installation behavior may differ and was not physically tested on an iPhone.
